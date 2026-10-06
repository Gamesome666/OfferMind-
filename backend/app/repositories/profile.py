"""能力画像数据访问。"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profile import SkillProfile


async def upsert(
    db: AsyncSession,
    user_id: int,
    knowledge_point: str,
    mastery: float,
    dimension_scores_json: str,
) -> SkillProfile:
    """按「用户 + 知识点」upsert 掌握度与维度分。"""
    result = await db.execute(
        select(SkillProfile).where(
            SkillProfile.user_id == user_id,
            SkillProfile.knowledge_point == knowledge_point,
        )
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = SkillProfile(
            user_id=user_id,
            knowledge_point=knowledge_point,
            mastery=mastery,
            dimension_scores_json=dimension_scores_json,
        )
        db.add(profile)
    else:
        profile.mastery = mastery
        profile.dimension_scores_json = dimension_scores_json
    await db.commit()
    await db.refresh(profile)
    return profile


async def list_by_user(db: AsyncSession, user_id: int) -> list[SkillProfile]:
    """查询某用户的全部能力画像。"""
    result = await db.execute(select(SkillProfile).where(SkillProfile.user_id == user_id))
    return list(result.scalars().all())
