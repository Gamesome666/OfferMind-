"""面试会话与消息数据访问。"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.resume import InterviewMessage, InterviewSession


async def create_session(db: AsyncSession, user_id: int, config_json: str) -> InterviewSession:
    """开一场新面试。"""
    session = InterviewSession(user_id=user_id, config_json=config_json, status="active")
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def get_session(db: AsyncSession, session_id: int, user_id: int) -> InterviewSession | None:
    """按 id 取面试会话，强制 user_id 过滤防越权。"""
    session = await db.get(InterviewSession, session_id)
    if session is None or session.user_id != user_id:
        return None
    return session


async def finish_session(db: AsyncSession, session_id: int, report_json: str) -> None:
    """面试结束：写入总结报告并标记 finished。"""
    session = await db.get(InterviewSession, session_id)
    if session is None:
        return
    session.report_json = report_json
    session.status = "finished"
    await db.commit()


async def list_sessions(db: AsyncSession, user_id: int, limit: int = 50) -> list[InterviewSession]:
    """列出用户的面试会话，按更新时间倒序。"""
    stmt = (
        select(InterviewSession)
        .where(InterviewSession.user_id == user_id)
        .order_by(InterviewSession.updated_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def add_message(
    db: AsyncSession, session_id: int, role: str, content: str, meta_json: str = "{}"
) -> InterviewMessage:
    """往会话追加一条消息（HR 提问或用户作答）。"""
    message = InterviewMessage(
        session_id=session_id, role=role, content=content, meta_json=meta_json
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message


async def list_messages(db: AsyncSession, session_id: int) -> list[InterviewMessage]:
    """按时间顺序取会话全部消息。"""
    stmt = (
        select(InterviewMessage)
        .where(InterviewMessage.session_id == session_id)
        .order_by(InterviewMessage.id.asc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())
