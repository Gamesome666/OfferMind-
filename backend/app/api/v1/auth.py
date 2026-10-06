"""认证端点：注册、登录、当前用户。"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.repositories import user as user_repo
from app.schemas.auth import Token, UserLogin, UserOut, UserRegister

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(payload: UserRegister, db: AsyncSession = Depends(get_db)) -> UserOut:
    """注册新用户。"""
    if await user_repo.get_by_email(db, payload.email):
        raise HTTPException(status_code=400, detail="该邮箱已注册")
    user = await user_repo.create(
        db, payload.email, hash_password(payload.password), payload.nickname
    )
    return UserOut.model_validate(user)


@router.post("/login", response_model=Token)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)) -> Token:
    """登录，签发 JWT。"""
    user = await user_repo.get_by_email(db, payload.email)
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="邮箱或密码错误")
    return Token(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> UserOut:
    """返回当前登录用户信息。"""
    return UserOut.model_validate(current_user)
