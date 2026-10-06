"""FastAPI 应用入口。"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings

# 走 uvicorn 自己的 logger，否则 app 模块的 INFO 日志在 uvicorn 控制台里看不到
logger = logging.getLogger("uvicorn.error")


def _warm_up_models() -> None:
    """预热本地模型：各跑一次真实推理。

    BGE-M3 与 bge-reranker-v2-m3 都是 2GB+ 权重，首次加载加 GPU 首次推理要约 20~30 秒。
    把这段开销挪到启动阶段的后台线程里，服务照常接受请求，第一个「出题」/「评分」请求
    就不用白等。用真实推理而不是只加载权重，顺带把 GPU 上的首次推理开销也一起消化掉。
    """
    from app.rag.embeddings import get_embeddings
    from app.rag.reranker import get_reranker

    warmups = (
        ("BGE-M3", lambda: get_embeddings().embed_query("模型预热")),
        ("bge-reranker-v2-m3", lambda: get_reranker().rerank("模型预热", ["模型预热的占位文档"])),
    )
    for name, run in warmups:
        try:
            run()
            logger.info("模型预热完成：%s", name)
        except Exception:  # noqa: BLE001 —— 预热失败不影响服务可用，首次真实调用时会再加载一次
            logger.exception("模型预热失败：%s（不影响服务启动，首次调用时会重试）", name)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：后台预热本地模型，不阻塞启动。"""
    # 用变量持有 task，避免被垃圾回收导致预热中途夭折
    warmup_task = asyncio.create_task(asyncio.to_thread(_warm_up_models))
    try:
        yield
    finally:
        warmup_task.cancel()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

# 允许前端开发服务器直接访问（SSE 流式不经 rewrite 时使用）
# 用正则而不是固定端口列表：Next dev server 在 3000 被占用时会自动顺延到 3001/3002，
# 固定列表会让新端口上的前端每个请求的 CORS 预检都返回 400「Disallowed CORS origin」。
# 生产部署时应收紧成真实前端域名。
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/")
async def root() -> dict:
    """根路径：返回应用名与文档地址。"""
    return {"name": settings.app_name, "docs": "/docs"}
