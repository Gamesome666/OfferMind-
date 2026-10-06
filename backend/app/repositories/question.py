"""题目数据访问。"""
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.question import Question


async def create(
    db: AsyncSession,
    direction: str,
    difficulty: str,
    question_type: str,
    content: str,
    reference_answer: str,
    key_points: str,
) -> Question:
    """新建题目入库（PG）。返回的 id 用作向量库中的 point id。"""
    question = Question(
        direction=direction,
        difficulty=difficulty,
        question_type=question_type,
        content=content,
        reference_answer=reference_answer,
        key_points=key_points,
    )
    db.add(question)
    await db.commit()
    await db.refresh(question)
    return question


async def set_embedding_ref(db: AsyncSession, question_id: int, chunk_id: str) -> None:
    """回填向量库 chunk_id，建立 PG 与 Qdrant 的关联。"""
    question = await db.get(Question, question_id)
    if question is None:
        return
    question.embedding_ref = chunk_id
    await db.commit()


async def get_by_id(db: AsyncSession, question_id: int) -> Question | None:
    """按 id 取题目。"""
    return await db.get(Question, question_id)


async def list_paged(
    db: AsyncSession,
    keyword: str = "",
    direction: str = "",
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[Question], int]:
    """分页查询题目（管理员后台用），返回 (当页列表, 总数)。"""
    stmt = select(Question)
    count_stmt = select(func.count()).select_from(Question)
    conditions = []
    if keyword:
        like = f"%{keyword}%"
        conditions.append(or_(Question.content.ilike(like), Question.key_points.ilike(like)))
    if direction:
        conditions.append(Question.direction == direction)
    if conditions:
        stmt = stmt.where(*conditions)
        count_stmt = count_stmt.where(*conditions)

    stmt = stmt.order_by(Question.id.desc()).offset(offset).limit(limit)
    rows = list((await db.execute(stmt)).scalars().all())
    total = int((await db.execute(count_stmt)).scalar_one())
    return rows, total


async def update(
    db: AsyncSession,
    question_id: int,
    direction: str,
    difficulty: str,
    question_type: str,
    content: str,
    reference_answer: str,
    key_points: str,
) -> Question | None:
    """编辑题目。"""
    question = await db.get(Question, question_id)
    if question is None:
        return None
    question.direction = direction
    question.difficulty = difficulty
    question.question_type = question_type
    question.content = content
    question.reference_answer = reference_answer
    question.key_points = key_points
    await db.commit()
    await db.refresh(question)
    return question


async def delete(db: AsyncSession, question_id: int) -> bool:
    """删除题目（PG）。"""
    question = await db.get(Question, question_id)
    if question is None:
        return False
    await db.delete(question)
    await db.commit()
    return True


async def count(db: AsyncSession) -> int:
    """题库总题数。"""
    return int((await db.execute(select(func.count()).select_from(Question))).scalar_one())
