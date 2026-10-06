"""历史记录与系统配置模型。

历史记录（HistoryRecord）是「侧栏一条可点的会话条目」的最小单元：
刷题 / 简历诊断 / 模拟面试 / 训练报告 各算一个 module，一条记录对应一次完整的交互
（一次出题、一次诊断、一场面试……）。snapshot_json 存恢复现场所需的全部数据，
前端点击历史条目时直接把 snapshot 塞回对应页面的状态，不需要重新调模型。
"""
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class HistoryRecord(Base, TimestampMixin):
    """一次可回看的历史交互。"""

    __tablename__ = "history_records"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    # 所属模块：practice / resume / interview / report
    module: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    # 侧栏展示的标题（如题干前 30 字 / "后端·中级·八股"）
    title: Mapped[str] = mapped_column(String(255), default="")
    # 恢复现场用的完整快照（页面 state 的 JSON 序列化）
    snapshot_json: Mapped[str] = mapped_column(Text, default="{}")
    # 面试类记录关联的会话 id（其余模块为空）
    session_id: Mapped[int] = mapped_column(ForeignKey("interview_sessions.id"), nullable=True)


class SystemConfig(Base, TimestampMixin):
    """系统级配置（管理员在后台改的模型与检索开关）。

    用 key-value 表而不是加字段，是因为配置项会随运营加多（换 embedding 模型、
    调 rerank top_k、开关闭精排……），改表结构太贵。graph 节点每跑一次读一次，
    所以改完即时生效，无需重启。
    """

    __tablename__ = "system_configs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    value: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(String(255), default="")
