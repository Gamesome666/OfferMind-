"""简历与模拟面试会话模型。"""
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Resume(Base, TimestampMixin):
    """用户简历（敏感，需加密存储）。"""

    __tablename__ = "resumes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    original_file_ref: Mapped[str] = mapped_column(String(255), default="")  # MinIO 对象 key
    structured_json: Mapped[str] = mapped_column(Text, default="{}")  # 解析后的结构化简历


class InterviewSession(Base, TimestampMixin):
    """一次模拟面试会话（一问一答的多轮对话）。"""

    __tablename__ = "interview_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    # 面试配置：direction / difficulty / style / resume 快照
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    report_json: Mapped[str] = mapped_column(Text, default="{}")  # 总结报告
    # 会话状态：active（进行中）/ finished（已总结）
    status: Mapped[str] = mapped_column(String(16), default="active")


class InterviewMessage(Base, TimestampMixin):
    """面试会话中的一条消息（HR 提问或用户作答）。

    一问一答的对话历史单独建表而不是塞进 session 的 JSON 字段，
    是为了让「加载某场面试的历史对话」不需要反序列化整个大 JSON，
    也方便按轮次分页或单条编辑。
    """

    __tablename__ = "interview_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("interview_sessions.id"), index=True, nullable=False
    )
    # role: hr（AI 面试官）/ user（候选人）
    role: Mapped[str] = mapped_column(String(8), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 消息附带的结构化信息（提问的考察点、参考答案等），仅 hr 消息有
    meta_json: Mapped[str] = mapped_column(Text, default="{}")
