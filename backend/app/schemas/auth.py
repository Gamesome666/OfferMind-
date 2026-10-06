"""认证相关的请求 / 响应模型。"""
from pydantic import BaseModel, Field


class UserRegister(BaseModel):
    """注册请求。"""

    email: str
    password: str = Field(min_length=6, max_length=64)
    nickname: str = ""


class UserLogin(BaseModel):
    """登录请求。"""

    email: str
    password: str


class Token(BaseModel):
    """登录响应。"""

    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    """用户信息响应。"""

    id: int
    email: str
    nickname: str
    is_admin: bool = False

    model_config = {"from_attributes": True}
