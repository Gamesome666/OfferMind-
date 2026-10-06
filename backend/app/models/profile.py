"""长期能力画像模型。"""
from sqlalchemy import Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SkillProfile(Base, TimestampMixin):
    """用户在某知识点上的能力画像。"""

    __tablename__ = "skill_profiles"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    knowledge_point: Mapped[str] = mapped_column(String(128), nullable=False)  # 知识点
    mastery: Mapped[float] = mapped_column(Float, default=0.0)  # 掌握度 0-1
    dimension_scores_json: Mapped[str] = mapped_column(Text, default="{}")  # 各维度得分
