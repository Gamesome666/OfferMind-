"""Qdrant 向量存储封装：题库知识库的入库与检索。

注意数据边界：Qdrant 只存「可检索文本片段 + 元数据」，题目主记录仍存 PostgreSQL，
以 question_id 关联。
"""
import time
from typing import Callable

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.core.config import settings
from app.rag.embeddings import get_embeddings
from app.rag.reranker import get_reranker

QUESTION_COLLECTION = "question_bank"
VECTOR_SIZE = 1024  # BGE-M3 dense 维度


def get_client() -> QdrantClient:
    """获取 Qdrant 客户端。"""
    return QdrantClient(url=settings.qdrant_url)


def ensure_collection() -> None:
    """确保题库 collection 存在。"""
    client = get_client()
    if not client.collection_exists(QUESTION_COLLECTION):
        client.create_collection(
            collection_name=QUESTION_COLLECTION,
            vectors_config=qmodels.VectorParams(
                size=VECTOR_SIZE, distance=qmodels.Distance.COSINE
            ),
        )


def _invalidate_sparse_index() -> None:
    """题库向量有变更时让 BM25 索引失效。

    放在这里而不是 repository：BM25 的语料就是从 Qdrant 拉的，所以「Qdrant 写完」
    才是失效的正确时机。放在 PG 写入处会早一步 —— 索引重建时还看不到新题。
    """
    from app.rag import bm25

    bm25.invalidate()


def upsert_question(
    question_id: int,
    direction: str,
    difficulty: str,
    question_type: str,
    content: str,
    answer: str,
    key_points: str,
) -> str:
    """将题目写入向量库，返回 chunk_id（即 str(question_id)）。"""
    ensure_collection()
    vector = get_embeddings().embed_query(content)
    get_client().upsert(
        collection_name=QUESTION_COLLECTION,
        points=[
            qmodels.PointStruct(
                id=question_id,
                vector=vector,
                payload={
                    "question_id": question_id,
                    "direction": direction,
                    "difficulty": difficulty,
                    "question_type": question_type,
                    "text": content,
                    "answer": answer,
                    "key_points": key_points,
                },
            )
        ],
    )
    _invalidate_sparse_index()
    return str(question_id)


def delete_question(question_id: int) -> None:
    """从向量库删除一道题（管理员在后台删题时同步调用，避免检索到已删的题）。"""
    ensure_collection()
    get_client().delete(
        collection_name=QUESTION_COLLECTION,
        points_selector=qmodels.PointIdsList(points=[question_id]),
    )
    _invalidate_sparse_index()


def search(
    query: str,
    direction: str | None = None,
    difficulty: str | None = None,
    question_type: str | None = None,
    top_k: int = 8,
    use_rerank: bool = False,
    traces: list[dict] | None = None,
    on_event: Callable[[dict], None] | None = None,
    mode: str = "dense",
) -> list[dict]:
    """检索题目，支持元数据过滤、可选 rerank 与三种检索模式。

    - traces 非空时收集每个阶段「已完成」的事件（供非流式接口一次性返回）；
    - on_event 非空时在每个阶段开始/结束时立即回调，供 SSE 实时展示「进行中」；
      两个回调收到的事件共用同一 id，调用方据此把「进行中」替换为「已完成」。
    - mode: dense（只用稠密向量，默认）/ sparse（只用 BM25）/ hybrid（RRF 融合两路）
    """

    def _report(step_id: str, payload: dict, status: str, duration_ms: int | None = None) -> None:
        event = {
            "id": step_id,
            "type": "检索",
            "status": status,
            "payload": payload,
            "duration_ms": duration_ms,
        }
        if status == "done" and traces is not None:
            traces.append(event)
        if on_event is not None:
            on_event(event)

    ensure_collection()

    # 稀疏模式不需要向量化，省掉一次 BGE-M3 前向
    vector = None
    if mode in ("dense", "hybrid"):
        _report("retrieve:向量化", {"阶段": "向量化", "模型": "BGE-M3"}, "running")
        t0 = time.time()
        vector = get_embeddings().embed_query(query)
        _report(
            "retrieve:向量化",
            {"阶段": "向量化", "模型": "BGE-M3", "query": query},
            "done",
            int((time.time() - t0) * 1000),
        )

    must = []
    if direction:
        must.append(qmodels.FieldCondition(key="direction", match=qmodels.MatchValue(value=direction)))
    if difficulty:
        must.append(qmodels.FieldCondition(key="difficulty", match=qmodels.MatchValue(value=difficulty)))
    if question_type:
        must.append(qmodels.FieldCondition(key="question_type", match=qmodels.MatchValue(value=question_type)))
    query_filter = qmodels.Filter(must=must) if must else None

    hits: list[dict] = []

    if vector is not None:
        # 混合模式下两路各取 top_k，融合后再截断；单路模式按原逻辑（精排要大候选池）
        dense_limit = top_k if mode == "hybrid" else (top_k * 2 if use_rerank else top_k)
        _report(
            "retrieve:召回",
            {"阶段": "向量召回", "模式": mode, "候选数": dense_limit},
            "running",
        )
        t0 = time.time()
        result = get_client().query_points(
            collection_name=QUESTION_COLLECTION,
            query=vector,
            query_filter=query_filter,
            limit=dense_limit,
        )
        dense_hits = [
            {"chunk_id": str(s.id), "score": s.score, "source": "dense", **s.payload}
            for s in result.points
        ]
        _report(
            "retrieve:召回",
            {"阶段": "向量召回", "命中": len(dense_hits)},
            "done",
            int((time.time() - t0) * 1000),
        )
        hits = dense_hits

    if mode in ("sparse", "hybrid"):
        # 延迟导入：不用混合检索时不加载 jieba 与 BM25，省掉启动开销
        from app.rag import bm25

        _report("retrieve:稀疏", {"阶段": "稀疏召回(BM25)", "模式": mode}, "running")
        t0 = time.time()
        sparse_hits = bm25.search(
            query, top_k=top_k, direction=direction, difficulty=difficulty,
            question_type=question_type,
        )
        _report(
            "retrieve:稀疏",
            {"阶段": "稀疏召回(BM25)", "命中": len(sparse_hits)},
            "done",
            int((time.time() - t0) * 1000),
        )
        if mode == "sparse":
            hits = sparse_hits
        else:
            fused = bm25.rrf_fuse(hits, sparse_hits, top_k=top_k)
            both = sum(1 for h in fused if len(h.get("sources", [])) > 1)
            _report(
                "retrieve:融合",
                {"阶段": "RRF 融合", "稠密": len(hits), "稀疏": len(sparse_hits),
                 "两路共同命中": both, "结果": len(fused)},
                "done",
            )
            hits = fused

    if use_rerank and hits:
        _report("retrieve:精排", {"阶段": "精排", "模型": "bge-reranker-v2-m3"}, "running")
        t0 = time.time()
        docs = [h["text"] for h in hits]
        ranked = get_reranker().rerank(query, docs, top_n=top_k)
        hits = [hits[i] for i in ranked]
        _report(
            "retrieve:精排",
            {"阶段": "精排", "模型": "bge-reranker-v2-m3", "保留": len(hits)},
            "done",
            int((time.time() - t0) * 1000),
        )
    return hits
