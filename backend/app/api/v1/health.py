"""健康检查端点。"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """存活探针：进程是否运行。"""
    return {"status": "ok"}


@router.get("/health/ready")
async def ready() -> dict:
    """就绪探针：M0 仅检查进程存活，后续里程碑接入数据库/Redis/向量库连通性。"""
    return {"status": "ready"}
