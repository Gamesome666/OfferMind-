"""历史记录请求 / 响应模型。"""
from datetime import datetime

from pydantic import BaseModel


class HistoryCreate(BaseModel):
    """前端在一次交互完成后，把恢复现场所需的快照整体 POST 上来。"""

    module: str  # practice / resume / interview / report
    title: str
    snapshot: dict  # 页面 state 的 JSON
    session_id: int | None = None  # 面试会话才会有


class HistoryOut(BaseModel):
    """历史记录响应（列表项只带 title + snapshot，由前端决定怎么用）。"""

    id: int
    module: str
    title: str
    snapshot: dict
    session_id: int | None = None
    updated_at: datetime

    model_config = {"from_attributes": True}
