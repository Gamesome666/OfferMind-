"""训练报告与能力画像请求模型。"""
from pydantic import BaseModel, Field


class TrainingReportRequest(BaseModel):
    """训练报告请求。"""

    question: str
    answer: str
    score_summary: str = ""
    followup: str = ""


class ProfileUpdateRequest(BaseModel):
    """能力画像更新请求。"""

    knowledge_point: str
    mastery: float = Field(ge=0.0, le=1.0)
    dimension_scores: dict = {}
