"""RAG 模块：Embedding、Rerank、向量库与题库入库。"""
import os

# 本地模型（BGE-M3 / bge-reranker-v2-m3）已缓存到本地，但 huggingface_hub 每次加载
# 仍会先向 huggingface.co 发 HEAD 请求校验版本。国内直连该域名会超时并重试 5 次，
# 每次冷启动白等 20~30 秒。置为离线模式直接读本地缓存；如需联网校验可用环境变量覆盖。
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
