"""BM25 稀疏检索：稠密向量之外的第二路召回。

**为什么需要它**：纯稠密向量（BGE-M3）对语义相近但用词不同的内容很强，但对
**专有名词、算法题名、精确术语**是弱项 —— 比如「LRU」「CAS」「ThreadLocal」这类词，
语义空间里容易和别的概念混在一起，而字面匹配能一击命中。加一路 BM25 正好互补。

**语料从哪来**：从 Qdrant 滚动拉取全部题目的 payload。这样不依赖 PostgreSQL 连接，
而且符合项目的数据边界 —— 向量库里本来就是「可检索文本 + 元数据」。

**中文分词**：用 jieba。BM25 依赖词频，中文不切词就没有词频可言。

**缓存**：索引常驻内存，题量在千级以内构建只要几十毫秒。题库发生增删改时由
调用方调 `invalidate()` 显式失效 —— 不做 TTL 轮询，避免「改了题还在用旧索引」。
"""
from __future__ import annotations

import threading
from typing import Callable

from app.core.config import settings

# jieba 首次导入会加载词典（约 0.5 秒），放到模块级只做一次
_JIEBA = None


def _tokenize(text: str) -> list[str]:
    """中文分词 + 小写归一。BM25 靠词频，不切词就无从统计。"""
    global _JIEBA
    if _JIEBA is None:
        import jieba

        # 关掉 jieba 的初始化日志，否则每次首用都会往 stderr 打一行
        jieba.setLogLevel(60)
        _JIEBA = jieba
    return [t.strip().lower() for t in _JIEBA.lcut_for_search(text or "") if t.strip()]


class Bm25Index:
    """题目的 BM25 索引。"""

    def __init__(self, docs: list[dict]) -> None:
        self.docs = docs
        self._tokens = [_tokenize(f"{d.get('text', '')} {d.get('key_points', '')}") for d in docs]
        self._bm25 = None
        if self._tokens and any(self._tokens):
            from rank_bm25 import BM25Okapi

            # 全空文档会让 BM25 的 IDF 出现除零，所以只在有内容时建索引
            self._bm25 = BM25Okapi(self._tokens)

    def search(
        self,
        query: str,
        top_k: int = 10,
        direction: str | None = None,
        difficulty: str | None = None,
        question_type: str | None = None,
    ) -> list[dict]:
        """按关键词相关度返回命中，结构与 vectorstore.search 保持一致。"""
        if self._bm25 is None:
            return []
        tokens = _tokenize(query)
        if not tokens:
            return []

        scores = self._bm25.get_scores(tokens)
        ranked = sorted(range(len(self.docs)), key=lambda i: scores[i], reverse=True)

        hits: list[dict] = []
        for index in ranked:
            score = float(scores[index])
            if score <= 0:
                # BM25 分数为 0 表示一个词都没命中，后面的更差，直接停
                break
            doc = self.docs[index]
            # 元数据过滤放在打分之后：BM25 是全量打分，过滤只用于筛选结果集
            if direction and doc.get("direction") != direction:
                continue
            if difficulty and doc.get("difficulty") != difficulty:
                continue
            if question_type and doc.get("question_type") != question_type:
                continue
            hits.append({**doc, "score": score, "source": "bm25"})
            if len(hits) >= top_k:
                break
        return hits

    def __len__(self) -> int:
        return len(self.docs)


# ------------------------------------------------------------------ 单例与失效

_index: Bm25Index | None = None
_lock = threading.Lock()


def _scroll_all() -> list[dict]:
    """从 Qdrant 拉取全部题目 payload，作为 BM25 语料。"""
    from app.rag import vectorstore

    client = vectorstore.get_client()
    vectorstore.ensure_collection()

    docs: list[dict] = []
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=vectorstore.QUESTION_COLLECTION,
            limit=256,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        for point in points:
            payload = point.payload or {}
            docs.append({"chunk_id": str(point.id), **payload})
        if offset is None:
            break
    return docs


def get_index(force_rebuild: bool = False) -> Bm25Index:
    """取索引单例。加锁原因同 embeddings：并发构建会产生半初始化实例。"""
    global _index
    if _index is None or force_rebuild:
        with _lock:
            if _index is None or force_rebuild:
                _index = Bm25Index(_scroll_all())
    return _index


def invalidate() -> None:
    """题库变更后调用，让下次检索重建索引。"""
    global _index
    with _lock:
        _index = None


def index_size() -> int:
    """当前索引里的文档数（为 0 表示还没建或题库为空）。"""
    return len(_index) if _index is not None else 0


def search(
    query: str,
    top_k: int = 10,
    direction: str | None = None,
    difficulty: str | None = None,
    question_type: str | None = None,
    on_event: Callable[[dict], None] | None = None,
) -> list[dict]:
    """对外入口：确保索引可用再检索，并推一条可观测事件。"""
    index = get_index()
    hits = index.search(query, top_k, direction, difficulty, question_type)
    if on_event is not None:
        on_event(
            {
                "id": "retrieve:稀疏召回",
                "type": "检索",
                "status": "done",
                "payload": {
                    "阶段": "稀疏召回(BM25)",
                    "索引文档数": len(index),
                    "命中": len(hits),
                    "查询词": query[:60],
                },
                "duration_ms": 0,
            }
        )
    return hits


def rrf_fuse(
    dense: list[dict], sparse: list[dict], top_k: int, k: int = 60
) -> list[dict]:
    """Reciprocal Rank Fusion：把两路召回按名次融合。

    用名次而不是分数，是因为稠密余弦相似度（0-1）和 BM25 分数（无上界）量纲完全不同，
    直接加权求和需要调参且不稳定。RRF 只看「排第几」，天然免调参，是小规模混合检索
    的默认选择。k=60 是原论文的建议值，作用是压低头部名次的权重差距。

    两路都命中时分数叠加，所以「语义像 + 字面也像」的结果会排到最前。
    """
    scores: dict[str, float] = {}
    merged: dict[str, dict] = {}

    for source_name, hits in (("dense", dense), ("sparse", sparse)):
        for rank, hit in enumerate(hits):
            key = str(hit.get("chunk_id") or hit.get("question_id"))
            if not key:
                continue
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank + 1)
            # 保留先出现的那份 payload（稠密的字段更全），只补记命中来源
            if key not in merged:
                merged[key] = {**hit}
                merged[key]["sources"] = []
            merged[key]["sources"].append(source_name)

    ordered = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:top_k]
    return [
        {**merged[key], "rrf_score": round(score, 6), "score": round(score, 6)}
        for key, score in ordered
    ]
