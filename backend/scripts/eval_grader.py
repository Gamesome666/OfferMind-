"""评分器评测：产出「微调前 vs 微调后」的对比指标。

这是微调章节可量化结论的来源。核心指标：
- **一致率**：与人工评分相差 ≤1 分算一致（评分是主观量表，精确相等过于苛刻）
- **MAE**：平均绝对误差，衡量整体偏移

**为什么默认不走向量检索**：评测要回答的是「模型本身变好了吗」。线上评分会先检索
题库参照，那是另一个变量；把它掺进来，微调前后的差异就说不清是模型还是检索带来的。
所以默认直接用 gold 集里标注的参考作答喂给模型，隔离出模型这一个变量。
需要看端到端表现时加 `--with-retrieval`。

用法：
    # 1. 先从库里抽 N 条作答，生成待标注模板
    python scripts/eval_grader.py --make-template 50

    # 2. 人工填完 gold.jsonl 里的 human_* 字段后，跑评测
    python scripts/eval_grader.py --gold finetune/data/gold.jsonl --label before
    # 3. 微调后换个模型再跑一次
    python scripts/eval_grader.py --gold finetune/data/gold.jsonl --label after \
        --model qwen2.5-1.5b-grader --base-url http://127.0.0.1:8001/v1

    # 4. 对比两次结果
    python scripts/eval_grader.py --compare finetune/eval/before.json finetune/eval/after.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402
from langchain_core.messages import HumanMessage, SystemMessage  # noqa: E402

from app.agent import prompts  # noqa: E402
from app.agent.llm import get_structured_llm, new_session_id  # noqa: E402
from app.agent.schemas import GradeOutput  # noqa: E402
from app.core.database import async_session, engine  # noqa: E402
from app.models.answer import Answer  # noqa: E402
from app.models.question import Question  # noqa: E402

DIMENSIONS = ("correctness", "completeness", "clarity", "terminology")
DIM_LABELS = {
    "correctness": "正确性",
    "completeness": "完整性",
    "clarity": "表达结构",
    "terminology": "术语准确",
}
# 一致判定容差：评分量表是主观的，差 1 分视为一致
TOLERANCE = 1


# ---------------------------------------------------------------- 生成标注模板


async def make_template(count: int, out_path: Path) -> None:
    """从库里随机抽 count 条作答，生成待人工标注的 gold 模板。"""
    async with async_session() as db:
        rows = list((await db.execute(select(Answer))).scalars().all())
        if not rows:
            print("库里没有作答记录，先去刷题页做几次评分。")
            return
        qids = {r.question_id for r in rows}
        qrows = await db.execute(select(Question).where(Question.id.in_(qids)))
        questions = {q.id: q for q in qrows.scalars().all()}

        picked = random.sample(rows, min(count, len(rows)))
        template = []
        for row in picked:
            question = questions.get(row.question_id)
            if question is None:
                continue
            template.append(
                {
                    "answer_id": row.id,
                    "question": question.content,
                    "reference": question.reference_answer,
                    "answer": row.content,
                    "model_score": json.loads(row.score_json or "{}"),
                    # ↓ 这几项需要人工填写，作为评测的 ground truth
                    "human_scores": {dim: None for dim in DIMENSIONS},
                    "human_total": None,
                }
            )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for item in template:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    print(f"已生成 {len(template)} 条待标注样本 → {out_path}")
    print("请人工填写每条的 human_scores（各维 0-5）与 human_total，然后跑评测。")


# ---------------------------------------------------------------- 评测


def grade_one(item: dict, model: str | None, base_url: str | None,
              api_key: str | None, temperature: float, session_id: str | None = None) -> dict | None:
    """用指定模型给一条样本打分。"""
    prompt = prompts.GRADE_TEMPLATE.format(
        question=item["question"],
        reference=item.get("reference") or "无",
        answer=item["answer"],
        GRADE_RUBRIC=prompts.GRADE_RUBRIC,
    )
    llm = get_structured_llm(
        GradeOutput, temperature=temperature, model=model, base_url=base_url,
        api_key=api_key, session_id=session_id,
    )
    try:
        result = llm.invoke(
            [SystemMessage(content=prompts.SYSTEM_PROMPT), HumanMessage(content=prompt)]
        )
    except Exception as exc:  # noqa: BLE001
        print(f"    [跳过] 模型调用失败: {str(exc)[:100]}")
        return None
    return result.model_dump()


def compute_metrics(rows: list[dict]) -> dict:
    """按 gold 与预测算一致率与 MAE。"""
    per_dim: dict[str, dict] = {}
    for dim in DIMENSIONS:
        errors, agree, exact, n = [], 0, 0, 0
        for row in rows:
            gold = row["gold"][dim]
            pred = row["pred"][dim]
            if gold is None or pred is None:
                continue
            diff = abs(gold - pred)
            errors.append(diff)
            agree += 1 if diff <= TOLERANCE else 0
            exact += 1 if diff == 0 else 0
            n += 1
        per_dim[dim] = {
            "n": n,
            "agreement": round(agree / n, 4) if n else None,
            "exact": round(exact / n, 4) if n else None,
            "mae": round(sum(errors) / n, 4) if n else None,
        }

    total_errors, total_agree, total_n = [], 0, 0
    for row in rows:
        gold, pred = row["gold"].get("total"), row["pred"].get("total_score")
        if gold is None or pred is None:
            continue
        diff = abs(gold - pred)
        total_errors.append(diff)
        total_agree += 1 if diff <= TOLERANCE else 0
        total_n += 1

    return {
        "n_samples": len(rows),
        "n_scored": total_n,
        "per_dimension": per_dim,
        "total": {
            "n": total_n,
            "agreement": round(total_agree / total_n, 4) if total_n else None,
            "mae": round(sum(total_errors) / total_n, 4) if total_errors else None,
        },
    }


def print_metrics(label: str, metrics: dict) -> None:
    print(f"\n=== [{label}] 评测结果（{metrics['n_scored']} 条可评分 / 共 {metrics['n_samples']} 条）===")
    print(f"  {'维度':<10} {'一致率':>8} {'完全相同':>10} {'MAE':>8}")
    for dim in DIMENSIONS:
        m = metrics["per_dimension"][dim]
        if m["agreement"] is None:
            print(f"  {DIM_LABELS[dim]:<10} {'—':>8}")
            continue
        print(f"  {DIM_LABELS[dim]:<10} {m['agreement']:>8.1%} {m['exact']:>10.1%} {m['mae']:>8.3f}")
    t = metrics["total"]
    if t["agreement"] is not None:
        print(f"  {'总分':<10} {t['agreement']:>8.1%} {'—':>10} {t['mae']:>8.3f}")


async def resolve_runtime() -> dict:
    """读数据库里的运行时配置（即线上实际在用的端点/密钥/模型）。

    必须读库而不是读 .env：管理员在后台改过模型的话，.env 那份是过期的，
    拿它评测等于测了另一个模型，对比表就没意义了。
    """
    from app.services import settings_service

    async with async_session() as db:
        return await settings_service.runtime_config(db)


def run_eval(gold_path: Path, model, base_url, api_key, temperature, label, out_dir) -> dict:
    items = []
    with gold_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(json.loads(line))

    labeled = [i for i in items if i.get("human_total") is not None]
    print(f"载入 {len(items)} 条，其中已人工标注 {len(labeled)} 条")
    if not labeled:
        print("还没有人工标注（human_total 为空）。先填 gold 文件再评测。")
        return {}

    print(f"被测模型: {model or '(.env 默认)'}  @ {base_url or '(.env 默认)'}")

    # 整轮评测共用一个会话 id：网关据此做路由，且同一会话内 system prompt + 评分量表
    # 这部分前缀能命中 prompt 缓存。（网关要求见 app/agent/llm.py 的模块说明）
    session_id = new_session_id()

    rows = []
    for index, item in enumerate(labeled, 1):
        print(f"  [{index}/{len(labeled)}] 评分中…")
        pred = grade_one(item, model, base_url, api_key, temperature, session_id)
        if pred is None:
            continue
        rows.append(
            {
                "answer_id": item.get("answer_id"),
                "gold": {**item["human_scores"], "total": item["human_total"]},
                "pred": {
                    **{d: pred[d]["score"] for d in DIMENSIONS},
                    "total_score": pred["total_score"],
                },
            }
        )

    metrics = compute_metrics(rows)
    metrics["label"] = label
    metrics["model"] = model or "(.env 默认)"
    print_metrics(label, metrics)

    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{label}.json"
    out_file.write_text(
        json.dumps({"metrics": metrics, "rows": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n明细已写出 → {out_file}")
    return metrics


def compare(path_a: Path, path_b: Path) -> None:
    """对比两次评测，产出「微调前 vs 微调后」表。"""
    a = json.loads(path_a.read_text(encoding="utf-8"))["metrics"]
    b = json.loads(path_b.read_text(encoding="utf-8"))["metrics"]
    print(f"\n=== 对比：{a['label']} ({a['model']})  →  {b['label']} ({b['model']}) ===")
    print(f"  {'维度':<10} {'一致率':>18} {'MAE':>18}  {'判定':>6}")
    improved = 0
    for dim in list(DIMENSIONS) + ["total"]:
        if dim == "total":
            ma, mb = a["total"], b["total"]
            name = "总分"
        else:
            ma, mb = a["per_dimension"][dim], b["per_dimension"][dim]
            name = DIM_LABELS[dim]
        if ma["agreement"] is None or mb["agreement"] is None:
            continue
        delta_agree = mb["agreement"] - ma["agreement"]
        delta_mae = mb["mae"] - ma["mae"]
        verdict = "↑ 改善" if delta_mae < 0 else ("↓ 变差" if delta_mae > 0 else "持平")
        if delta_mae < 0:
            improved += 1
        print(
            f"  {name:<10} {ma['agreement']:>7.1%} → {mb['agreement']:<7.1%} "
            f"{ma['mae']:>8.3f} → {mb['mae']:<8.3f}  {verdict:>6}"
        )
    print(f"\n  {improved}/5 个维度 MAE 下降")


async def main() -> None:
    parser = argparse.ArgumentParser(description="评分器评测（微调前后对比）")
    parser.add_argument("--make-template", type=int, metavar="N", help="从库里抽 N 条生成待标注模板")
    parser.add_argument("--gold", default="finetune/data/gold.jsonl", help="gold 标注文件")
    parser.add_argument("--out-dir", default="finetune/eval", help="评测结果输出目录")
    parser.add_argument("--label", default="run", help="本次评测的标签（如 before / after）")
    parser.add_argument("--model", default=None, help="被测模型名，默认用 .env 的")
    parser.add_argument("--base-url", default=None, help="被测模型端点，默认用 .env 的")
    parser.add_argument("--api-key", default=None, help="被测模型密钥，默认用 .env 的")
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--compare", nargs=2, metavar=("A", "B"), help="对比两份评测结果")
    args = parser.parse_args()

    if args.compare:
        compare(Path(args.compare[0]), Path(args.compare[1]))
        return

    if args.make_template:
        await make_template(args.make_template, Path(args.gold))
        await engine.dispose()
        return

    gold = Path(args.gold)
    if not gold.exists():
        print(f"gold 文件不存在：{gold}\n先用 --make-template 生成再标注。")
        return

    # 默认用「线上实际在用的模型」（读库），命令行参数可覆盖 —— 这样 before/after
    # 两次评测同源可比；要测微调后的本地模型时用 --model/--base-url 指过去。
    runtime = await resolve_runtime()
    print(f"线上运行时配置: model={runtime['llm_model']}  base_url={runtime['llm_base_url']}")

    # 评测本身是同步阻塞调用（逐条打模型）；关引擎要用异步接口，放到最后
    run_eval(
        gold,
        args.model or runtime["llm_model"],
        args.base_url or runtime["llm_base_url"],
        args.api_key or runtime["llm_api_key"],
        args.temperature,
        args.label,
        Path(args.out_dir),
    )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
