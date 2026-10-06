"""数据库引擎与会话工厂（SQLAlchemy 2.0 async）。"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(settings.database_url, echo=settings.debug, future=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
