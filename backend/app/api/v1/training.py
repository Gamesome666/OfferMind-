"""训练端点：AI 出题、评分、追问（一次性 + SSE 流式）。"""
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import service as agent_service
from app.api.deps import get_current_user, get_db, get_runtime
from app.api.sse import sse_response
from app.models.user import User
from app.schemas.training import FollowupRequest, GenerateQuestionRequest, GradeRequest

router = APIRouter(prefix="/training", tags=["training"])


@router.post("/question")
async def generate_question(
    payload: GenerateQuestionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> dict:
    """AI 出题，返回题目与 Agent 执行轨迹。"""
    return await agent_service.generate_question(
        db, payload.direction, payload.difficulty, payload.question_type, payload.weak_points, runtime
    )


@router.post("/question/stream")
async def generate_question_stream(
    payload: GenerateQuestionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> StreamingResponse:
    """AI 出题（SSE 流式，供执行面板实时展示）。"""
    return sse_response(
        agent_service.generate_question_stream(
            db, payload.direction, payload.difficulty, payload.question_type, payload.weak_points, runtime
        )
    )


@router.post("/grade")
async def grade(
    payload: GradeRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> dict:
    """AI 四维评分。"""
    return await agent_service.grade_answer(payload.question, payload.answer, runtime)


@router.post("/grade/stream")
async def grade_stream(
    payload: GradeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> StreamingResponse:
    """AI 四维评分（SSE 流式）。评分结果会落库（供错题本与微调数据集使用）。"""
    return sse_response(
        agent_service.grade_stream(
            db,
            current_user.id,
            payload.question,
            payload.answer,
            payload.question_id,
            runtime,
        )
    )


@router.post("/followup")
async def followup(
    payload: FollowupRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> dict:
    """AI 追问。"""
    return await agent_service.generate_followup(
        payload.question, payload.answer, payload.score_summary, runtime
    )


@router.post("/followup/stream")
async def followup_stream(
    payload: FollowupRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> StreamingResponse:
    """AI 追问（SSE 流式）。"""
    return sse_response(
        agent_service.followup_stream(payload.question, payload.answer, payload.score_summary, runtime)
    )
