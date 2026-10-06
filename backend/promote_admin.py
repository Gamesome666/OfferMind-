"""把某个用户提升为管理员。用法：python promote_admin.py user@example.com

管理员页面本身需要管理员权限才能进，所以第一个管理员必须从命令行给 —— 否则
就成「鸡生蛋」了。重复执行安全。
"""
import asyncio
import sys

from sqlalchemy import select

from app.core.database import async_session, engine
from app.models.user import User
from app.repositories import user as user_repo


async def main(email: str) -> None:
    async with async_session() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is None:
            print(f"找不到用户：{email}")
            return
        await user_repo.update(db, user.id, is_admin=True)
        print(f"已将 {email} 设为管理员")
    await engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("用法：python promote_admin.py <邮箱>")
        raise SystemExit(1)
    asyncio.run(main(sys.argv[1]))
