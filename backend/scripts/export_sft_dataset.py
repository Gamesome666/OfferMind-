"""导出评分器 SFT 数据集（LoRA 微调用）。

**数据从哪来**：不用另找数据集 —— 系统每次评分都往 answers 表写一条
`(题目, 参考答案, 用户作答, 四维评分 JSON)`，这就是一条天然的 SFT 样本。
攒够几百条，微调的数据就有了（数据飞轮）。

**为什么输入要和线上一致**：训练时的 prompt 必须和推理时的 prompt 逐字一致，
否则模型学到的是「另一个任务」。所以这里直接复用 `app.agent.prompts.GRADE_TEMPLATE`
和 `GRADE_RUBRIC`，不另写一套模板。

**参考从哪来**：线上评分用的是向量检索召回的参照题；导出时没法重跑检索（要起
Qdrant + BGE-M3），所以用**该题自己的参考答案**代替 —— 对这道题而言，它就是最相关
的那条参照，语义上等價，且可复现。

用法：
    python scripts/export_sft_dataset.py                     # 导出全部
    python scripts/export_sft_dataset.py --out data/sft.jsonl --min-score-gap
    python scripts/export_sft_dataset.py --stats-only        # 只看有多少可训练样本

输出格式：LLaMA-Factory 的 alpaca 格式，每行一条：
    {"system": "...", "instruction": "...", "input": "...", "output": "..."}
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# 允许直接 `python scripts/xxx.py` 运行（把 backend 根目录加进 sys.path）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.agent import prompts  # noqa: E402
from app.core.database import async_session, engine  # noqa: E402
from app.models.answer import Answer  # noqa: E402
from app.models.question import Question  # noqa: E402

# 评分输出里必须齐备的字段 —— 缺任何一个这条样本就不可训练
_REQUIRED_FIELDS = ("correctness", "completeness", "clarity", "terminology", "total_score")


def build_grade_prompt(question: str, reference: str, answer: str) -> str:
    """构造与线上完全一致的评分 prompt。"""
    return prompts.GRADE_TEMPLATE.format(
        question=question,
        reference=reference or "无",
        answer=answer,
        GRADE_RUBRIC=prompts.GRADE_RUBRIC,
    )


def normalize_score(raw: dict) -> dict | None:
    """规整评分 JSON；字段不全则返回 None（该样本丢弃，不要污染训练集）。"""
    if not isinstance(raw, dict):
        return None
    for field in _REQUIRED_FIELDS:
        if field not in raw:
            return None
    # 四维必须都是 {score, reason} 结构
    for dim in ("correctness", "completeness", "clarity", "terminology"):
        value = raw.get(dim)
        if not isinstance(value, dict) or "score" not in value or "reason" not in value:
            return None
    return raw


def to_alpaca(prompt: str, score: dict) -> dict:
    """转成 LLaMA-Factory 的 alpaca 单条样本。"""
    return {
        "system": prompts.SYSTEM_PROMPT,
        "instruction": prompt,
        # alpaca 的 input 需要非空才是多轮/带输入样本，这里塞一个占位说明
        "input": "",
        "output": json.dumps(score, ensure_ascii=False),
    }


async def collect(limit: int | None, drop_degenerate: bool) -> tuple[list[dict], dict]:
    """从库里捞出可训练样本，返回 (样本列表, 统计)。"""
    stats = {"total_answers": 0, "skipped_no_score": 0, "skipped_bad_score": 0,
             "skipped_no_question": 0, "skipped_degenerate": 0, "kept": 0}
    samples: list[dict] = []

    async with async_session() as db:
        stmt = select(Answer).order_by(Answer.id.asc())
        if limit:
            stmt = stmt.limit(limit)
        rows = list((await db.execute(stmt)).scalars().all())
        stats["total_answers"] = len(rows)

        # 一次性把要用的题目查出来，避免 N+1
        qids = {r.question_id for r in rows}
        questions: dict[int, Question] = {}
        if qids:
            qrows = await db.execute(select(Question).where(Question.id.in_(qids)))
            questions = {q.id: q for q in qrows.scalars().all()}

        for row in rows:
            try:
                raw = json.loads(row.score_json or "{}")
            except json.JSONDecodeError:
                stats["skipped_no_score"] += 1
                continue
            score = normalize_score(raw)
            if score is None:
                stats["skipped_bad_score"] += 1
                continue

            question = questions.get(row.question_id)
            if question is None:
                stats["skipped_no_question"] += 1
                continue

            # 全 0 分或全 5 分的样本信息量低（模型学不到区分度），可选剔除
            if drop_degenerate:
                dims = [score[d]["score"] for d in
                        ("correctness", "completeness", "clarity", "terminology")]
                if all(s == 0 for s in dims) or all(s == 5 for s in dims):
                    stats["skipped_degenerate"] += 1
                    continue

            prompt = build_grade_prompt(question.content, question.reference_answer, row.content)
            samples.append(to_alpaca(prompt, score))

    stats["kept"] = len(samples)
    return samples, stats


async def main() -> None:
    parser = argparse.ArgumentParser(description="导出评分器 SFT 数据集")
    parser.add_argument("--out", default="finetune/data/grader_sft.jsonl", help="输出文件")
    parser.add_argument("--limit", type=int, default=None, help="最多处理多少条作答")
    parser.add_argument("--drop-degenerate", action="store_true",
                        help="剔除四维全 0 或全 5 的样本（信息量低）")
    parser.add_argument("--stats-only", action="store_true", help="只统计，不写文件")
    args = parser.parse_args()

    samples, stats = await collect(args.limit, args.drop_degenerate)
    await engine.dispose()

    print("=== 数据集统计 ===")
    print(f"  作答记录总数      {stats['total_answers']}")
    print(f"  评分 JSON 缺失    {stats['skipped_no_score']}")
    print(f"  评分字段不完整    {stats['skipped_bad_score']}")
    print(f"  题目已删          {stats['skipped_no_question']}")
    if args.drop_degenerate:
        print(f"  全0/全5 已剔除    {stats['skipped_degenerate']}")
    print(f"  → 可用样本        {stats['kept']}")

    if args.stats_only:
        return

    if not samples:
        print("\n没有可用样本，未写文件。先去刷题页做几次评分，数据会自动攒起来。")
        return

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        for sample in samples:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")
    print(f"\n已写出 {len(samples)} 条 → {out}")

    # 顺带输出分数分布，一眼看出数据是否偏斜（全挤在中档就学不出区分度）
    dist: dict[int, int] = {}
    for s in samples:
        bucket = int(round(json.loads(s["output"])["total_score"]))
        dist[bucket] = dist.get(bucket, 0) + 1
    print("总分分布（0-5）：")
    for bucket in range(6):
        count = dist.get(bucket, 0)
        bar = "█" * min(40, count)
        print(f"  {bucket} 分 {count:4d} {bar}")


if __name__ == "__main__":
    asyncio.run(main())
