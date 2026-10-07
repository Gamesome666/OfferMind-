"""模拟面试端点：一问一答对话（HR）、面试报告与历史会话。"""
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import service as agent_service
from app.api.deps import get_current_user, get_db, get_runtime
from app.api.sse import sse_response
from app.models.user import User
from app.repositories import interview as interview_repo
from app.schemas.interview import (
    InterviewChatRequest,
    InterviewQuestionRequest,
    InterviewReportRequest,
)

router = APIRouter(prefix="/interview", tags=["interview"])


@router.post("/question")
async def interview_question(
    payload: InterviewQuestionRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> dict:
    """基于简历生成深挖式面试提问。"""
    return await agent_service.generate_interview_question(
        payload.resume, payload.direction, payload.difficulty, payload.style, runtime
    )


@router.post("/question/stream")
async def interview_question_stream(
    payload: InterviewQuestionRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> StreamingResponse:
    """基于简历生成深挖式面试提问（SSE 流式）。"""
    return sse_response(
        agent_service.generate_interview_question_stream(
            payload.resume, payload.direction, payload.difficulty, payload.style, runtime
        )
    )


@router.post("/chat/stream")
async def interview_chat_stream(
    payload: InterviewChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> StreamingResponse:
    """一问一答面试（SSE 流式）。

    session_id 为空 → 开新面试；message 非空 → 候选人发言；summarize=True → 生成总结。
    """
    return sse_response(
        agent_service.interview_chat_stream(
            db=db,
            user_id=current_user.id,
            session_id=payload.session_id,
            resume=payload.resume,
            direction=payload.direction,
            difficulty=payload.difficulty,
            style=payload.style,
            message=payload.message,
            summarize=payload.summarize,
            runtime=runtime,
        )
    )


@router.get("/sessions")
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """列出当前用户的面试会话（历史侧栏用）。

    顺带带出「轮数」与「总分」——列表卡片要显示这两个数，不带的话前端得为每场面试
    再查两次接口。
    """
    sessions = await interview_repo.list_sessions(db, current_user.id)
    rounds = await interview_repo.count_hr_by_sessions(db, [s.id for s in sessions])
    out: list[dict] = []
    for s in sessions:
        try:
            report = json.loads(s.report_json or "{}")
        except json.JSONDecodeError:
            report = {}
        out.append(
            {
                "id": s.id,
                "status": s.status,
                "config": json.loads(s.config_json or "{}"),
                "updated_at": s.updated_at,
                "rounds": rounds.get(s.id, 0),
                "total_score": report.get("total_score"),
            }
        )
    return out


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """取一场面试的完整内容（配置 + 对话 + 报告），用于历史恢复。"""
    session = await interview_repo.get_session(db, session_id, current_user.id)
    if session is None:
        raise HTTPException(status_code=404, detail="面试会话不存在或无权访问")
    messages = await interview_repo.list_messages(db, session_id)
    return {
        "id": session.id,
        "status": session.status,
        "config": json.loads(session.config_json or "{}"),
        "messages": [{"role": m.role, "content": m.content} for m in messages],
        "report": json.loads(session.report_json or "{}"),
    }


@router.post("/report")
async def interview_report(
    payload: InterviewReportRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> dict:
    """基于逐轮记录生成面试报告。"""
    return await agent_service.generate_interview_report(payload.config, payload.rounds, runtime)


@router.post("/report/stream")
async def interview_report_stream(
    payload: InterviewReportRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> StreamingResponse:
    """基于逐轮记录生成面试报告（SSE 流式）。"""
    return sse_response(
        agent_service.generate_interview_report_stream(payload.config, payload.rounds, runtime)
    )
