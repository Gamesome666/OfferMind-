"""题目模型。"""
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Question(Base, TimestampMixin):
    """题目（题库），可跨用户复用。"""

    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    direction: Mapped[str] = mapped_column(String(32), index=True, nullable=False)  # 技术方向
    difficulty: Mapped[str] = mapped_column(String(16), index=True, nullable=False)  # 难度
    question_type: Mapped[str] = mapped_column(String(16), nullable=False)  # 题型：八股/算法/业务
    content: Mapped[str] = mapped_column(Text, nullable=False)  # 题干
    reference_answer: Mapped[str] = mapped_column(Text, default="")  # 参考答案
    key_points: Mapped[str] = mapped_column(Text, default="")  # 考点
    embedding_ref: Mapped[str] = mapped_column(String(64), default="")  # 向量库 chunk_id
