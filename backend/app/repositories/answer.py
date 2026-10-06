"""作答与评分数据访问。

这张表同时服务两件事：
1. 错题本 —— is_wrong / is_favorite 标记 + SM-2 复习排期；
2. 微调数据集 —— (题目, 作答, 四维评分 JSON) 就是一条天然 SFT 样本。
所以评分一旦产生就必须落库，否则这两条链路都没有数据源。
"""
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.answer import Answer

# 总分低于此值判为错题（满分 5）。四维加权总分 3.0 大致对应「答得勉强及格」。
WRONG_SCORE_THRESHOLD = 3.0

# SM-2 参数
_MIN_EASE = 1.3
_DEFAULT_EASE = 2.5
# 连续答对多少次算「已掌握」，可以移出错题本
MASTERED_REVIEWS = 2


def sm2_next(
    quality: int, interval_days: int, ease: float, repetitions: int
) -> tuple[int, float, int]:
    """SM-2 间隔重复调度，返回 (下次间隔天数, 新 ease, 新重复次数)。

    quality 取 0-5，正好用四维加权总分四舍五入——评分量表本身就是 0-5，天然对齐。
    quality < 3 判为「没记住」：重置重复次数、明天再来。
    """
    quality = max(0, min(5, quality))
    if quality < 3:
        return 1, ease, 0

    if repetitions == 0:
        new_interval = 1
    elif repetitions == 1:
        new_interval = 6
    else:
        new_interval = max(1, round(interval_days * ease))

    new_ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    new_ease = max(_MIN_EASE, new_ease)
    return new_interval, new_ease, repetitions + 1


async def create(
    db: AsyncSession,
    user_id: int,
    question_id: int,
    content: str,
    score_json: str,
    total_score: float,
    followup_chain: str = "[]",
) -> Answer:
    """记录一次作答与评分，并按 SM-2 排好首次复习时间。"""
    quality = int(round(total_score))
    interval, ease, reps = sm2_next(quality, 0, _DEFAULT_EASE, 0)
    answer = Answer(
        user_id=user_id,
        question_id=question_id,
        content=content,
        score_json=score_json,
        followup_chain=followup_chain,
        is_wrong=total_score < WRONG_SCORE_THRESHOLD,
        is_favorite=False,
        review_interval_days=interval,
        review_ease=ease,
        review_count=reps,
        review_due_at=datetime.now() + timedelta(days=interval),
    )
    db.add(answer)
    await db.commit()
    await db.refresh(answer)
    return answer


async def get_by_id(db: AsyncSession, answer_id: int, user_id: int) -> Answer | None:
    """按 id 取一条作答，强制 user_id 过滤。"""
    answer = await db.get(Answer, answer_id)
    if answer is None or answer.user_id != user_id:
        return None
    return answer


async def list_by_user(
    db: AsyncSession,
    user_id: int,
    only_wrong: bool = False,
    only_favorite: bool = False,
    limit: int = 100,
) -> list[Answer]:
    """列出用户的作答记录（错题本 / 收藏夹都用它）。"""
    stmt = select(Answer).where(Answer.user_id == user_id)
    if only_wrong:
        stmt = stmt.where(Answer.is_wrong.is_(True))
    if only_favorite:
        stmt = stmt.where(Answer.is_favorite.is_(True))
    stmt = stmt.order_by(Answer.id.desc()).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def list_due(db: AsyncSession, user_id: int, limit: int = 50) -> list[Answer]:
    """取出到期待复习的错题（间隔重复的核心查询）。"""
    stmt = (
        select(Answer)
        .where(
            Answer.user_id == user_id,
            Answer.is_wrong.is_(True),
            Answer.review_due_at.is_not(None),
            Answer.review_due_at <= datetime.now(),
        )
        .order_by(Answer.review_due_at.asc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def set_flags(
    db: AsyncSession, answer_id: int, user_id: int, is_wrong: bool | None = None,
    is_favorite: bool | None = None,
) -> Answer | None:
    """改错题 / 收藏标记。"""
    answer = await get_by_id(db, answer_id, user_id)
    if answer is None:
        return None
    if is_wrong is not None:
        answer.is_wrong = is_wrong
        # 手动标为错题时，若还没排期就补一个明天的复习
        if is_wrong and answer.review_due_at is None:
            answer.review_due_at = datetime.now() + timedelta(days=1)
            answer.review_interval_days = 1
    if is_favorite is not None:
        answer.is_favorite = is_favorite
    await db.commit()
    await db.refresh(answer)
    return answer


async def review(
    db: AsyncSession, answer_id: int, user_id: int, quality: int
) -> Answer | None:
    """复习一次：用 SM-2 重排下次到期时间。

    注意不要「答对一次就移出错题本」—— 那会让刚排的复习计划永远不会触发
    （待复习队列是按 is_wrong 过滤的）。改为**连续答对 MASTERED_REVIEWS 次**才毕业，
    这样中间的复习节点都能正常到期。SM-2 在 quality<3 时会把重复次数清零，
    所以 review_count 正好等于「连续答对次数」。
    """
    answer = await get_by_id(db, answer_id, user_id)
    if answer is None:
        return None
    interval, ease, reps = sm2_next(
        quality, answer.review_interval_days, answer.review_ease, answer.review_count
    )
    answer.review_interval_days = interval
    answer.review_ease = ease
    answer.review_count = reps
    answer.review_due_at = datetime.now() + timedelta(days=interval)
    if reps >= MASTERED_REVIEWS:
        answer.is_wrong = False
    await db.commit()
    await db.refresh(answer)
    return answer


async def count(db: AsyncSession, user_id: int) -> dict[str, int]:
    """错题本统计：总数 / 错题 / 收藏 / 待复习。"""
    async def _count(extra=None) -> int:
        stmt = select(func.count()).select_from(Answer).where(Answer.user_id == user_id)
        if extra is not None:
            stmt = stmt.where(extra)
        return int((await db.execute(stmt)).scalar_one())

    return {
        "total": await _count(),
        "wrong": await _count(Answer.is_wrong.is_(True)),
        "favorite": await _count(Answer.is_favorite.is_(True)),
        "due": await _count(
            (Answer.is_wrong.is_(True))
            & (Answer.review_due_at.is_not(None))
            & (Answer.review_due_at <= datetime.now())
        ),
    }
