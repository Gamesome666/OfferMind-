"""历史记录数据访问。"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.history import HistoryRecord


async def create(
    db: AsyncSession,
    user_id: int,
    module: str,
    title: str,
    snapshot_json: str,
    session_id: int | None = None,
) -> HistoryRecord:
    """写入一条历史记录。"""
    record = HistoryRecord(
        user_id=user_id,
        module=module,
        title=title,
        snapshot_json=snapshot_json,
        session_id=session_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def list_by_user(
    db: AsyncSession, user_id: int, module: str | None = None, limit: int = 50
) -> list[HistoryRecord]:
    """按用户列出历史，可按模块过滤，按更新时间倒序（最近在前）。"""
    stmt = select(HistoryRecord).where(HistoryRecord.user_id == user_id)
    if module:
        stmt = stmt.where(HistoryRecord.module == module)
    stmt = stmt.order_by(HistoryRecord.updated_at.desc()).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, record_id: int, user_id: int) -> HistoryRecord | None:
    """按 id 取一条历史，强制 user_id 过滤防越权。"""
    record = await db.get(HistoryRecord, record_id)
    if record is None or record.user_id != user_id:
        return None
    return record


async def delete(db: AsyncSession, record_id: int, user_id: int) -> bool:
    """删除一条历史，强制 user_id 过滤。"""
    record = await get_by_id(db, record_id, user_id)
    if record is None:
        return False
    await db.delete(record)
    await db.commit()
    return True
