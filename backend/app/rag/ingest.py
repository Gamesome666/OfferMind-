"""题库入库脚本：将种子题写入 PostgreSQL 与 Qdrant。

用法：python -m app.rag.ingest
前置：Postgres 与 Qdrant 已启动（docker compose up -d），且已运行 init_db.py 建表。
"""
import asyncio

from app.core.database import async_session
from app.models.question import Question
from app.rag import vectorstore
from app.rag.seed_data import SEED_QUESTIONS


async def ingest() -> None:
    """逐题入库：先写 PG 拿 id，再写向量库，最后回填 embedding_ref。"""
    async with async_session() as db:
        for item in SEED_QUESTIONS:
            question = Question(
                direction=item["direction"],
                difficulty=item["difficulty"],
                question_type=item["question_type"],
                content=item["content"],
                reference_answer=item["reference_answer"],
                key_points=item["key_points"],
            )
            db.add(question)
            await db.flush()  # 获取自增主键 id

            # embedding 为同步计算，放入线程池避免阻塞事件循环
            chunk_id = await asyncio.to_thread(
                vectorstore.upsert_question,
                question.id,
                question.direction,
                question.difficulty,
                question.question_type,
                question.content,
                question.reference_answer,
                question.key_points,
            )
            question.embedding_ref = chunk_id
            print(f"已入库 [{question.direction}/{question.difficulty}/{question.question_type}] "
                  f"{question.content[:24]}...")
        await db.commit()
    print(f"题库入库完成，共 {len(SEED_QUESTIONS)} 道题。")


if __name__ == "__main__":
    asyncio.run(ingest())
