"""错题本 / 收藏夹请求响应模型。"""
from datetime import datetime

from pydantic import BaseModel


class AnswerOut(BaseModel):
    """一条作答记录（错题本列表项）。"""

    id: int
    question_id: int
    question_content: str = ""  # 联表带出的题干
    answer_content: str
    score_json: dict
    total_score: float = 0.0
    is_wrong: bool
    is_favorite: bool
    review_due_at: datetime | None = None
    review_interval_days: int = 0
    review_count: int = 0
    created_at: datetime


class AnswerFlags(BaseModel):
    """改错题 / 收藏标记。"""

    is_wrong: bool | None = None
    is_favorite: bool | None = None


class ReviewRequest(BaseModel):
    """复习一次，quality 0-5（不传则用上次总分）。"""

    quality: int | None = None


class AnswerStats(BaseModel):
    """错题本统计。"""

    total: int
    wrong: int
    favorite: int
    due: int
