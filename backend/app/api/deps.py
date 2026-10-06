"""API 依赖注入：数据库会话、当前用户、运行时配置。"""
from typing import Any, AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.core.security import decode_access_token
from app.models.user import User
from app.repositories import user as user_repo
from app.services import settings_service

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """获取数据库会话。"""
    async with async_session() as session:
        yield session


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """从 JWT 解析当前用户，失败抛 401。"""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="认证失败，请重新登录",
        headers={"WWW-Authenticate": "Bearer"},
    )
    subject = decode_access_token(token)
    if subject is None:
        raise credentials_exc
    user = await user_repo.get_by_id(db, int(subject))
    if user is None:
        raise credentials_exc
    return user


async def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """管理员专用：非管理员一律 403。"""
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


async def get_runtime(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """读出管理员配置的运行时参数（模型名/温度/检索开关），注入 agent。"""
    return await settings_service.runtime_config(db)
