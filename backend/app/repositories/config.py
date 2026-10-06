"""系统配置数据访问：管理员在后台改的模型与检索开关。

读路径走进程内缓存 + 显式失效：graph 每个节点每跑一次都要读好几次配置，
如果每次都查库会平白多出 N 次往返；管理员改配置是低频操作，改完调
invalidate() 立刻生效，不用重启。
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.history import SystemConfig

_cache: dict[str, str] = {}


def invalidate(key: str | None = None) -> None:
    """清掉配置缓存。key 为空则全清。"""
    if key is None:
        _cache.clear()
    else:
        _cache.pop(key, None)


async def get(db: AsyncSession, key: str, default: str = "") -> str:
    """读一个配置项，读不到返回 default。带进程内缓存。"""
    if key in _cache:
        return _cache[key]
    stmt = select(SystemConfig).where(SystemConfig.key == key)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    value = row.value if row else default
    _cache[key] = value
    return value


async def set(db: AsyncSession, key: str, value: str, description: str = "") -> SystemConfig:
    """写一个配置项（不存在则创建），写完立刻让缓存失效。"""
    stmt = select(SystemConfig).where(SystemConfig.key == key)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None:
        row = SystemConfig(key=key, value=value, description=description)
        db.add(row)
    else:
        row.value = value
        if description:
            row.description = description
    await db.commit()
    await db.refresh(row)
    invalidate(key)
    return row


async def list_all(db: AsyncSession) -> list[SystemConfig]:
    """列出全部配置，管理后台用。"""
    stmt = select(SystemConfig).order_by(SystemConfig.key.asc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def delete(db: AsyncSession, key: str) -> bool:
    """删掉一条覆盖记录，使该配置回落到 .env 默认值。"""
    stmt = select(SystemConfig).where(SystemConfig.key == key)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        return False
    await db.delete(row)
    await db.commit()
    invalidate(key)
    return True
