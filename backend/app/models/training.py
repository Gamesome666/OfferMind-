"""训练会话与 Agent 执行轨迹模型。"""
from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class TrainingSession(Base, TimestampMixin):
    """一次刷题训练会话。"""

    __tablename__ = "training_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    conditions_json: Mapped[str] = mapped_column(Text, default="{}")  # 出题条件
    question_ids_json: Mapped[str] = mapped_column(Text, default="[]")  # 题目 ID 列表
    report_json: Mapped[str] = mapped_column(Text, default="{}")  # 训练报告


class ToolTrace(Base, TimestampMixin):
    """Agent 执行轨迹，供可观测面板回溯。"""

    __tablename__ = "tool_traces"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)  # 会话标识
    step: Mapped[int] = mapped_column(Integer, nullable=False)  # 步骤序号
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)  # 模型/工具/记忆/检索
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
