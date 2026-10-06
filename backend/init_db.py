"""建表脚本：启动 Postgres 后运行一次。用法：python init_db.py

Base.metadata.create_all 只建「缺失的表」，不会给已存在的表加列。本次迭代给
users 加了 is_admin、给 interview_sessions 加了 status，都是已有表上的新列，
所以这里补一段幂等的 ALTER ... ADD COLUMN IF NOT EXISTS。重复执行安全。
"""
import asyncio

from sqlalchemy import text

from app.core.database import engine
from app.models import Base

# 已有表的新增列（表名, 列名, 类型定义）—— 幂等，重复跑不报错
_COLUMN_MIGRATIONS: tuple[tuple[str, str, str], ...] = (
    ("users", "is_admin", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("interview_sessions", "status", "VARCHAR(16) NOT NULL DEFAULT 'active'"),
    # 错题本 / 间隔重复（SM-2）的调度状态
    ("answers", "review_due_at", "TIMESTAMP"),
    ("answers", "review_interval_days", "INTEGER NOT NULL DEFAULT 0"),
    ("answers", "review_ease", "DOUBLE PRECISION NOT NULL DEFAULT 2.5"),
    ("answers", "review_count", "INTEGER NOT NULL DEFAULT 0"),
)

# 需要建的索引（索引名, 表名, 列名）—— 幂等
_INDEX_MIGRATIONS: tuple[tuple[str, str, str], ...] = (
    ("ix_answers_review_due_at", "answers", "review_due_at"),
)

# 需要放宽约束的旧列：rounds_json 已被 interview_messages 取代，模型里不再声明它。
# 这张表原本建的是 NOT NULL，不放开的话新会话插入会报 NotNullViolation。
# 只去掉 NOT NULL、不删列不删数据，老会话的逐轮记录仍可读。
_COLUMN_RELAX: tuple[tuple[str, str], ...] = (
    ("interview_sessions", "rounds_json"),
)


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table, column, ddl in _COLUMN_MIGRATIONS:
            await conn.execute(
                text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl}")
            )
        for table, column in _COLUMN_RELAX:
            await conn.execute(
                text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL")
            )
        for index_name, table, column in _INDEX_MIGRATIONS:
            await conn.execute(
                text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({column})")
            )
    print("数据库表已创建 / 更新")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
