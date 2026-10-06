"""Embedding 封装：BGE-M3 本地模型，懒加载避免启动时下载模型。"""
import threading

from app.core.config import settings


class BgeEmbeddings:
    """基于 sentence-transformers 的 BGE-M3 embedding。"""

    def __init__(self, model_name: str | None = None) -> None:
        self.model_name = model_name or settings.embedding_model
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        """首次使用时才加载模型（耗时且占用显存/内存）。

        必须加锁：启动预热的线程和第一个真实请求的线程会同时进来，
        不加锁两边都会看到 _model 为 None 并各构造一份 —— 并发构造同一个
        HF 模型会得到半初始化的实例，典型症状是后续调用报
        「Cannot copy out of meta tensor; no data!」，而且坏实例被缓存后永久生效。
        """
        if self._model is None:
            with self._lock:
                if self._model is None:
                    from sentence_transformers import SentenceTransformer

                    self._model = SentenceTransformer(self.model_name)
        return self._model

    def embed_query(self, text: str) -> list[float]:
        """单条 query 向量化。"""
        return self._load().encode(text, normalize_embeddings=True).tolist()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """批量文档向量化。"""
        return self._load().encode(texts, normalize_embeddings=True).tolist()


_singleton_lock = threading.Lock()
_instance: BgeEmbeddings | None = None


def get_embeddings() -> BgeEmbeddings:
    """全局单例。

    不用 lru_cache：它不加锁，预热线程与请求线程可能各自构造一个实例
    （缓存只留一个，另一个白占一份显存）。这里用锁保证只构造一次。
    """
    global _instance
    if _instance is None:
        with _singleton_lock:
            if _instance is None:
                _instance = BgeEmbeddings()
    return _instance
