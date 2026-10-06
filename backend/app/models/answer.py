"""作答与评分历史模型。"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Answer(Base, TimestampMixin):
    """一次作答及其评分结果。

    既是错题本的数据源，也是 LoRA 微调的数据源 —— (题目, 作答, 四维评分) 就是一条 SFT 样本。
    review_* 四个字段是 SM-2 间隔重复的调度状态。
    """

    __tablename__ = "answers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), index=True, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)  # 作答内容
    score_json: Mapped[str] = mapped_column(Text, default="{}")  # 评分结果 JSON
    followup_chain: Mapped[str] = mapped_column(Text, default="[]")  # 追问链 JSON
    is_wrong: Mapped[bool] = mapped_column(Boolean, default=False)  # 是否错题
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)  # 是否收藏

    # ---- SM-2 间隔重复调度状态 ----
    review_due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    review_interval_days: Mapped[int] = mapped_column(Integer, default=0)
    review_ease: Mapped[float] = mapped_column(Float, default=2.5)
    review_count: Mapped[int] = mapped_column(Integer, default=0)
