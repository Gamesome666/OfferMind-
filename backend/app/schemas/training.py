"""训练相关请求模型。"""
from pydantic import BaseModel


class GenerateQuestionRequest(BaseModel):
    """出题请求。"""

    direction: str
    difficulty: str
    question_type: str
    weak_points: str = ""


class GradeRequest(BaseModel):
    """评分请求。"""

    question: str
    answer: str
    # 出题时拿到的题库 id，回传后作答才能挂到题上（错题本与微调数据靠它关联）
    question_id: int | None = None


class FollowupRequest(BaseModel):
    """追问请求。"""

    question: str
    answer: str
    score_summary: str = ""
