"""历史记录端点：每个模块一次交互的侧栏条目，可点开恢复现场。"""
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import service as agent_service
from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.repositories import history as history_repo
from app.schemas.history import HistoryCreate

router = APIRouter(prefix="/history", tags=["history"])

MODULES = {"practice", "resume", "interview", "report"}


def _to_out(record) -> dict:
    """ORM → 响应：把 snapshot_json 反序列化成对象给前端直接用。"""
    try:
        snapshot = json.loads(record.snapshot_json or "{}")
    except json.JSONDecodeError:
        snapshot = {}
    return {
        "id": record.id,
        "module": record.module,
        "title": record.title,
        "snapshot": snapshot,
        "session_id": record.session_id,
        "updated_at": record.updated_at,
    }


@router.post("")
async def create_history(
    payload: HistoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """记录一次交互（前端在拿到结果后把页面快照整体 POST 上来）。"""
    if payload.module not in MODULES:
        raise HTTPException(status_code=400, detail=f"未知模块：{payload.module}")
    record_id = await agent_service.record_history(
        db,
        current_user.id,
        payload.module,
        payload.title,
        payload.snapshot,
        payload.session_id,
    )
    return {"id": record_id}


@router.get("")
async def list_history(
    module: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """列出当前用户的历史（可按模块过滤），最近更新在前。"""
    records = await history_repo.list_by_user(db, current_user.id, module)
    return [_to_out(r) for r in records]


@router.get("/{record_id}")
async def get_history(
    record_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """取一条历史的完整快照。"""
    record = await history_repo.get_by_id(db, record_id, current_user.id)
    if record is None:
        raise HTTPException(status_code=404, detail="历史记录不存在")
    return _to_out(record)


@router.delete("/{record_id}")
async def delete_history(
    record_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """删除一条历史。"""
    ok = await history_repo.delete(db, record_id, current_user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="历史记录不存在")
    return {"status": "ok"}
