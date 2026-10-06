"""用户数据访问。"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def get_by_email(db: AsyncSession, email: str) -> User | None:
    """按邮箱查询用户。"""
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_by_id(db: AsyncSession, user_id: int) -> User | None:
    """按 ID 查询用户。"""
    return await db.get(User, user_id)


async def create(db: AsyncSession, email: str, hashed_password: str, nickname: str) -> User:
    """创建用户。"""
    user = User(email=email, hashed_password=hashed_password, nickname=nickname)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def list_all(db: AsyncSession, keyword: str = "", limit: int = 200) -> list[User]:
    """列出用户（管理员后台用），可按邮箱 / 昵称模糊搜。"""
    stmt = select(User)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(User.email.ilike(like) | User.nickname.ilike(like))
    stmt = stmt.order_by(User.id.desc()).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update(
    db: AsyncSession,
    user_id: int,
    nickname: str | None = None,
    is_admin: bool | None = None,
    hashed_password: str | None = None,
) -> User | None:
    """更新用户资料（只改传入的字段）。"""
    user = await db.get(User, user_id)
    if user is None:
        return None
    if nickname is not None:
        user.nickname = nickname
    if is_admin is not None:
        user.is_admin = is_admin
    if hashed_password is not None:
        user.hashed_password = hashed_password
    await db.commit()
    await db.refresh(user)
    return user


async def delete(db: AsyncSession, user_id: int) -> bool:
    """删除用户。"""
    user = await db.get(User, user_id)
    if user is None:
        return False
    await db.delete(user)
    await db.commit()
    return True


async def count(db: AsyncSession) -> int:
    """用户总数。"""
    from sqlalchemy import func

    return int((await db.execute(select(func.count()).select_from(User))).scalar_one())
