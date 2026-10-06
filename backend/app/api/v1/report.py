"""训练报告与能力画像端点。"""
import json
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import service as agent_service
from app.api.deps import get_current_user, get_db, get_runtime
from app.api.sse import sse_response
from app.models.user import User
from app.repositories import profile as profile_repo
from app.schemas.report import ProfileUpdateRequest, TrainingReportRequest

router = APIRouter(prefix="/report", tags=["report"])


@router.post("/training")
async def training_report(
    payload: TrainingReportRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> dict:
    """生成训练报告。"""
    return await agent_service.generate_training_report(
        payload.question, payload.answer, payload.score_summary, payload.followup, runtime
    )


@router.post("/training/stream")
async def training_report_stream(
    payload: TrainingReportRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> StreamingResponse:
    """生成训练报告（SSE 流式）。"""
    return sse_response(
        agent_service.generate_training_report_stream(
            payload.question, payload.answer, payload.score_summary, payload.followup, runtime
        )
    )


@router.post("/profile")
async def update_profile(
    payload: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """更新能力画像（掌握度 + 维度分）。"""
    profile = await profile_repo.upsert(
        db,
        current_user.id,
        payload.knowledge_point,
        payload.mastery,
        json.dumps(payload.dimension_scores, ensure_ascii=False),
    )
    return {"knowledge_point": profile.knowledge_point, "mastery": profile.mastery}


@router.get("/profile")
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """查询当前用户的能力画像（雷达数据源）。"""
    profiles = await profile_repo.list_by_user(db, current_user.id)
    return [
        {
            "knowledge_point": p.knowledge_point,
            "mastery": p.mastery,
            "dimension_scores": json.loads(p.dimension_scores_json or "{}"),
        }
        for p in profiles
    ]
