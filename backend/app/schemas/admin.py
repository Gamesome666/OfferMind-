"""管理员后台请求 / 响应模型。"""
from datetime import datetime

from pydantic import BaseModel


class AdminUserOut(BaseModel):
    """用户管理列表项。"""

    id: int
    email: str
    nickname: str
    is_admin: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminUserUpdate(BaseModel):
    """用户管理可改字段（只传需要改的）。"""

    nickname: str | None = None
    is_admin: bool | None = None
    password: str | None = None  # 传了就重置密码


class AdminQuestionIn(BaseModel):
    """新建 / 编辑题目。"""

    direction: str
    difficulty: str
    question_type: str
    content: str
    reference_answer: str = ""
    key_points: str = ""


class AdminQuestionOut(AdminQuestionIn):
    """题目列表项。"""

    id: int
    embedding_ref: str = ""
    created_at: datetime

    model_config = {"from_attributes": True}


class ConfigItem(BaseModel):
    """单个配置项。"""

    key: str
    value: str
    description: str = ""


class ConfigUpdate(BaseModel):
    """批量更新配置：{key: value}。"""

    values: dict[str, str]
