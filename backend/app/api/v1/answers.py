"""错题本 / 收藏夹端点。

数据源是 answers 表（评分时写入）。列表项联表带出题干，前端不用再逐条查题。
"待复习" 用 SM-2 排期算出来的 review_due_at 过滤。
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.answer import Answer
from app.models.user import User
from app.repositories import answer as answer_repo
from app.repositories import question as question_repo
from app.schemas.answer import AnswerFlags, AnswerStats, ReviewRequest

router = APIRouter(prefix="/answers", tags=["answers"])


async def _to_out(db: AsyncSession, row: Answer) -> dict:
    """作答记录 → 响应体，顺带把题干查出来（前端列表要显示题目）。"""
    question = await question_repo.get_by_id(db, row.question_id)
    try:
        score = json.loads(row.score_json or "{}")
    except json.JSONDecodeError:
        score = {}
    return {
        "id": row.id,
        "question_id": row.question_id,
        "question_content": (question.content if question else "") or "",
        # 联表顺带带出方向/难度/题型：列表页要显示这三个标签，不带的话前端得为每条再查一次题
        "question_direction": (question.direction if question else "") or "",
        "question_difficulty": (question.difficulty if question else "") or "",
        "question_type": (question.question_type if question else "") or "",
        "answer_content": row.content,
        "score_json": score,
        "total_score": float(score.get("total_score") or 0.0),
        "is_wrong": row.is_wrong,
        "is_favorite": row.is_favorite,
        "review_due_at": row.review_due_at,
        "review_interval_days": row.review_interval_days,
        "review_count": row.review_count,
        "created_at": row.created_at,
    }


@router.get("")
async def list_answers(
    only_wrong: bool = Query(False),
    only_favorite: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """列出作答记录（错题本 / 收藏夹）。"""
    rows = await answer_repo.list_by_user(
        db, current_user.id, only_wrong=only_wrong, only_favorite=only_favorite, limit=limit
    )
    return [await _to_out(db, row) for row in rows]


@router.get("/stats", response_model=AnswerStats)
async def stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AnswerStats:
    """错题本统计：总数 / 错题 / 收藏 / 待复习。"""
    counts = await answer_repo.count(db, current_user.id)
    return AnswerStats(**counts)


@router.get("/due")
async def list_due(
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """到期待复习的错题（间隔重复）。"""
    rows = await answer_repo.list_due(db, current_user.id, limit=limit)
    return [await _to_out(db, row) for row in rows]


@router.patch("/{answer_id}")
async def update_flags(
    answer_id: int,
    payload: AnswerFlags,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """改错题 / 收藏标记。"""
    row = await answer_repo.set_flags(
        db, answer_id, current_user.id, payload.is_wrong, payload.is_favorite
    )
    if row is None:
        raise HTTPException(status_code=404, detail="作答记录不存在")
    return await _to_out(db, row)


@router.post("/{answer_id}/review")
async def review(
    answer_id: int,
    payload: ReviewRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """复习一次，按 SM-2 重排下次到期时间。quality 不传则用上次总分取整。"""
    row = await answer_repo.get_by_id(db, answer_id, current_user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="作答记录不存在")
    if payload.quality is None:
        try:
            quality = int(round(float(json.loads(row.score_json or "{}").get("total_score") or 0)))
        except (json.JSONDecodeError, TypeError, ValueError):
            quality = 3
    else:
        quality = payload.quality
    updated = await answer_repo.review(db, answer_id, current_user.id, quality)
    if updated is None:
        raise HTTPException(status_code=404, detail="作答记录不存在")
    return await _to_out(db, updated)
