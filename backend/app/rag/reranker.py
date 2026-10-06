"""Rerank 封装：bge-reranker-v2-m3，懒加载。"""
import threading

from app.core.config import settings


class BgeReranker:
    """基于 FlagEmbedding 的 BGE reranker。"""

    def __init__(self, model_name: str | None = None) -> None:
        self.model_name = model_name or settings.rerank_model
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        """加载模型。加锁原因同 embeddings：预热线程与请求线程会并发进来，
        并发构造同一个 HF 模型会产生半初始化实例（meta tensor 报错）。"""
        if self._model is None:
            with self._lock:
                if self._model is None:
                    from FlagEmbedding import FlagReranker

                    self._model = FlagReranker(self.model_name)
        return self._model

    def rerank(self, query: str, docs: list[str], top_n: int = 5) -> list[int]:
        """返回重排后文档在原列表中的下标（按相关度降序）。"""
        if not docs:
            return []
        pairs = [[query, doc] for doc in docs]
        scores = self._load().compute_score(pairs)
        ranked = sorted(range(len(docs)), key=lambda i: scores[i], reverse=True)
        return ranked[:top_n]


_singleton_lock = threading.Lock()
_instance: BgeReranker | None = None


def get_reranker() -> BgeReranker:
    """全局单例（加锁，理由同 embeddings）。"""
    global _instance
    if _instance is None:
        with _singleton_lock:
            if _instance is None:
                _instance = BgeReranker()
    return _instance
