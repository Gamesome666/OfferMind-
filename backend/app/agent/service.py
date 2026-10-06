"""Agent 业务服务：对 API 暴露的高层接口，负责编排、异步化与流式可观测。"""
import asyncio
import json
from typing import Any, AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import graph, interview_chat
from app.rag import vectorstore
from app.repositories import answer as answer_repo
from app.repositories import history as history_repo
from app.repositories import interview as interview_repo
from app.repositories import question as question_repo


def _invoke(g, initial: dict[str, Any], runtime: dict[str, Any] | None = None) -> dict[str, Any]:
    """同步执行图，返回输出与轨迹。"""
    initial.setdefault("traces", [])
    if runtime:
        initial = {**runtime, **initial}
    result = g.invoke(initial)
    return {"output": result.get("output", {}), "traces": result.get("traces", [])}


async def _stream(
    g, initial: dict[str, Any], runtime: dict[str, Any] | None = None
) -> AsyncIterator[dict[str, Any]]:
    """流式执行图，实时产出可观测事件，供 SSE 推送。

    - custom：节点内 _start/_finish 主动推送的步骤事件（含「进行中」），立即转发；
    - updates：只用于取最终结果。轨迹不再从 updates 里取，避免与 custom 重复；
      「结果」按最后一个节点输出为准 —— 出题被判重复会重生成，中间产物不推也不落库。
    """
    initial.setdefault("traces", [])
    if runtime:
        # 运行时配置作为底，业务入参可以覆盖（这里业务入参优先，所以放后面）
        initial = {**runtime, **initial}
    final: dict[str, Any] | None = None
    try:
        async for mode, chunk in g.astream(initial, stream_mode=["custom", "updates"]):
            if mode == "custom":
                yield chunk
                continue
            for _node_name, update in chunk.items():
                if "output" in update:
                    final = update["output"]
    except Exception as exc:  # noqa: BLE001
        yield {"type": "错误", "payload": {"message": str(exc)}}
        return
    if final is not None:
        yield {"type": "结果", "payload": final}


async def _save_question(
    db: AsyncSession, direction: str, difficulty: str, question_type: str, output: dict[str, Any]
) -> int:
    """把生成的题目同时写入题库：PostgreSQL 存主记录，Qdrant 存可检索片段。

    返回题库里的 question_id —— 后续评分要把作答挂到这道题上（错题本与微调数据都靠它关联）。
    """
    content = output.get("content", "")
    samples = output.get("samples", "")
    if samples:
        content = f"{content}\n\n{samples}"
    reference_answer = output.get("reference_answer", "")
    key_points = output.get("key_points", "")

    question = await question_repo.create(
        db,
        direction=direction,
        difficulty=difficulty,
        question_type=question_type,
        content=content,
        reference_answer=reference_answer,
        key_points=key_points,
    )
    # 向量化与 upsert 是同步阻塞调用（本地模型 + HTTP），放到线程里避免卡事件循环
    chunk_id = await asyncio.to_thread(
        vectorstore.upsert_question,
        question.id,
        direction,
        difficulty,
        question_type,
        content,
        reference_answer,
        key_points,
    )
    await question_repo.set_embedding_ref(db, question.id, chunk_id)
    return question.id


async def record_history(
    db: AsyncSession,
    user_id: int,
    module: str,
    title: str,
    snapshot: dict[str, Any],
    session_id: int | None = None,
) -> int:
    """把一次交互的快照写成一条历史记录，返回记录 id。"""
    record = await history_repo.create(
        db,
        user_id=user_id,
        module=module,
        title=title[:255],
        snapshot_json=json.dumps(snapshot, ensure_ascii=False),
        session_id=session_id,
    )
    return record.id


async def generate_question(
    db: AsyncSession,
    direction: str,
    difficulty: str,
    question_type: str,
    weak_points: str = "",
    runtime: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """出题（一次性），生成后写入题库。"""
    result = await asyncio.to_thread(
        _invoke,
        graph.generate_question_graph,
        {
            "direction": direction,
            "difficulty": difficulty,
            "question_type": question_type,
            "weak_points": weak_points,
        },
        runtime,
    )
    if result.get("output"):
        await _save_question(db, direction, difficulty, question_type, result["output"])
    return result


async def generate_question_stream(
    db: AsyncSession,
    direction: str,
    difficulty: str,
    question_type: str,
    weak_points: str = "",
    runtime: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """出题（流式，逐节点产出事件），生成后写入题库。

    结果里带上 question_id —— 前端留着它，评分时回传，作答才能挂到这道题上。
    """
    initial = {
        "direction": direction,
        "difficulty": difficulty,
        "question_type": question_type,
        "weak_points": weak_points,
    }
    async for event in _stream(graph.generate_question_graph, initial, runtime):
        if event["type"] == "结果":
            question_id = await _save_question(
                db, direction, difficulty, question_type, event["payload"]
            )
            yield {**event, "payload": {**event["payload"], "question_id": question_id}}
            continue
        yield event


async def grade_answer(
    question: str, answer: str, runtime: dict[str, Any] | None = None
) -> dict[str, Any]:
    """评分（一次性）。"""
    return await asyncio.to_thread(
        _invoke, graph.grade_graph, {"question": question, "answer": answer}, runtime
    )


async def grade_stream(
    db: AsyncSession,
    user_id: int,
    question: str,
    answer: str,
    question_id: int | None = None,
    runtime: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """评分（流式），评分结果落库（错题本与微调数据都依赖它）。

    question_id 由前端回传（出题时拿到）。缺失时不落库 —— 宁可不记录，也不要挂到错的题上。
    """
    score: dict[str, Any] | None = None
    async for event in _stream(graph.grade_graph, {"question": question, "answer": answer}, runtime):
        if event["type"] == "结果":
            score = event["payload"]
        yield event

    if score and question_id:
        total = float(score.get("total_score") or 0.0)
        record = await answer_repo.create(
            db,
            user_id=user_id,
            question_id=question_id,
            content=answer,
            score_json=json.dumps(score, ensure_ascii=False),
            total_score=total,
        )
        # 把作答 id 补推给前端，方便它跳「错题本」或标收藏
        yield {"type": "已记录", "payload": {"answer_id": record.id, "is_wrong": record.is_wrong}}


async def generate_followup(
    question: str, answer: str, score_summary: str, runtime: dict[str, Any] | None = None
) -> dict[str, Any]:
    """追问（一次性）。"""
    return await asyncio.to_thread(
        _invoke,
        graph.followup_graph,
        {"question": question, "answer": answer, "score_summary": score_summary},
        runtime,
    )


async def followup_stream(
    question: str, answer: str, score_summary: str, runtime: dict[str, Any] | None = None
) -> AsyncIterator[dict[str, Any]]:
    """追问（流式）。"""
    initial = {"question": question, "answer": answer, "score_summary": score_summary}
    async for event in _stream(graph.followup_graph, initial, runtime):
        yield event


async def parse_resume(resume_text: str, runtime: dict[str, Any] | None = None) -> dict[str, Any]:
    """解析简历为结构化信息。"""
    return await asyncio.to_thread(
        _invoke, graph.parse_resume_graph, {"resume_text": resume_text}, runtime
    )


async def parse_jd(jd_text: str, runtime: dict[str, Any] | None = None) -> dict[str, Any]:
    """解析 JD 为岗位画像。"""
    return await asyncio.to_thread(_invoke, graph.parse_jd_graph, {"jd_text": jd_text}, runtime)


async def diagnose(
    resume: str, jd: str, runtime: dict[str, Any] | None = None
) -> dict[str, Any]:
    """对比简历与 JD，产出诊断报告。"""
    return await asyncio.to_thread(
        _invoke, graph.diagnose_graph, {"resume": resume, "jd": jd}, runtime
    )


async def parse_resume_stream(
    resume_text: str, runtime: dict[str, Any] | None = None
) -> AsyncIterator[dict[str, Any]]:
    """解析简历为结构化信息（流式）。"""
    async for event in _stream(graph.parse_resume_graph, {"resume_text": resume_text}, runtime):
        yield event


async def diagnose_stream(
    resume_text: str, jd_text: str, runtime: dict[str, Any] | None = None
) -> AsyncIterator[dict[str, Any]]:
    """简历诊断（流式）。

    三步串行跑（解析简历 → 解析 JD → 对比诊断），每一步的「进行中 / 已完成」事件连续
    推给前端，所以面板上会依次出现三个节点，而不是等整条链跑完才一次性冒出来。
    末尾把三份结构化结果合并成一个「结果」事件。
    """
    resume_out: dict[str, Any] = {}
    jd_out: dict[str, Any] = {}

    async for event in _stream(graph.parse_resume_graph, {"resume_text": resume_text}, runtime):
        if event["type"] == "结果":
            resume_out = event["payload"]
        else:
            yield event
            if event["type"] == "错误":
                return

    async for event in _stream(graph.parse_jd_graph, {"jd_text": jd_text}, runtime):
        if event["type"] == "结果":
            jd_out = event["payload"]
        else:
            yield event
            if event["type"] == "错误":
                return

    initial = {
        "resume": json.dumps(resume_out, ensure_ascii=False),
        "jd": json.dumps(jd_out, ensure_ascii=False),
    }
    async for event in _stream(graph.diagnose_graph, initial, runtime):
        if event["type"] == "结果":
            yield {
                "type": "结果",
                "payload": {
                    "structured_resume": resume_out,
                    "jd_profile": jd_out,
                    "diagnosis": event["payload"],
                    "resume_text": resume_text,
                    "jd_text": jd_text,
                },
            }
        else:
            yield event


async def generate_interview_question(
    resume: str, direction: str, difficulty: str, style: str,
    runtime: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """基于简历生成深挖式面试提问。"""
    return await asyncio.to_thread(
        _invoke,
        graph.interview_question_graph,
        {"resume": resume, "direction": direction, "difficulty": difficulty, "style": style},
        runtime,
    )


async def generate_interview_report(
    config: str, rounds: str, runtime: dict[str, Any] | None = None
) -> dict[str, Any]:
    """基于逐轮记录生成面试报告。"""
    return await asyncio.to_thread(
        _invoke, graph.interview_report_graph, {"config": config, "rounds": rounds}, runtime
    )


async def generate_training_report(
    question: str, answer: str, score_summary: str, followup: str,
    runtime: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """基于训练记录生成训练报告。"""
    return await asyncio.to_thread(
        _invoke,
        graph.training_report_graph,
        {"question": question, "answer": answer, "score_summary": score_summary, "followup": followup},
        runtime,
    )


async def generate_interview_question_stream(
    resume: str, direction: str, difficulty: str, style: str,
    runtime: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """基于简历生成深挖式面试提问（流式）。"""
    initial = {"resume": resume, "direction": direction, "difficulty": difficulty, "style": style}
    async for event in _stream(graph.interview_question_graph, initial, runtime):
        yield event


async def generate_interview_report_stream(
    config: str, rounds: str, runtime: dict[str, Any] | None = None
) -> AsyncIterator[dict[str, Any]]:
    """基于逐轮记录生成面试报告（流式）。"""
    async for event in _stream(
        graph.interview_report_graph, {"config": config, "rounds": rounds}, runtime
    ):
        yield event


async def generate_training_report_stream(
    question: str, answer: str, score_summary: str, followup: str,
    runtime: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """基于训练记录生成训练报告（流式）。"""
    initial = {
        "question": question,
        "answer": answer,
        "score_summary": score_summary,
        "followup": followup,
    }
    async for event in _stream(graph.training_report_graph, initial, runtime):
        yield event


async def interview_chat_stream(
    db: AsyncSession,
    user_id: int,
    session_id: int | None,
    resume: str,
    direction: str,
    difficulty: str,
    style: str,
    message: str,
    summarize: bool,
    runtime: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """一问一答面试的统一流式入口。

    - session_id 为空 → 建会话（存配置），HR 说开场白 + 第一个问题；
    - message 非空 → 存候选人发言，HR 接着说；
    - summarize=True → 不再发言，按整场对话生成总结报告并落库。

    每轮 HR 回复都会把消息写进 interview_messages，会话结束时再写一条历史记录
    （snapshot 里带 session_id 与完整对话），前端点历史就能恢复整场面试。
    """
    # ---- 1. 拿到或新建会话 ----
    if session_id is None:
        config_json = json.dumps(
            {"direction": direction, "difficulty": difficulty, "style": style, "resume": resume},
            ensure_ascii=False,
        )
        session = await interview_repo.create_session(db, user_id, config_json)
        session_id = session.id
    else:
        session = await interview_repo.get_session(db, session_id, user_id)
        if session is None:
            yield {"type": "错误", "payload": {"message": "面试会话不存在或无权访问"}}
            return
        config = json.loads(session.config_json or "{}")
        direction = config.get("direction", direction)
        difficulty = config.get("difficulty", difficulty)
        style = config.get("style", style)
        resume = config.get("resume", resume)

    # 会话 id 先告诉前端，后续每轮都带上它
    yield {"type": "session", "payload": {"session_id": session_id}}

    history_rows = await interview_repo.list_messages(db, session_id)

    # ---- 2. 总结分支：基于整场对话出报告 ----
    if summarize:
        if not history_rows:
            yield {"type": "错误", "payload": {"message": "还没有对话内容，无法总结"}}
            return
        rounds_text = "\n\n".join(
            f"{'面试官' if row.role == 'hr' else '候选人'}：{row.content}" for row in history_rows
        )
        config_text = f"方向：{direction}；难度：{difficulty}；风格：{style}"
        report: dict[str, Any] = {}
        async for event in _stream(
            graph.interview_report_graph,
            {"config": config_text, "rounds": rounds_text},
            runtime,
        ):
            if event["type"] == "结果":
                report = event["payload"]
            else:
                yield event
                if event["type"] == "错误":
                    return
        await interview_repo.finish_session(
            db, session_id, json.dumps(report, ensure_ascii=False)
        )
        # 整场面试写成一条历史记录：snapshot 的字段名与前端页面状态保持一致，
        # 点历史条目时直接整块灌回页面 state 即可（key 对不上就恢复不出来了）
        await record_history(
            db,
            user_id,
            module="interview",
            title=f"{direction}·{difficulty}·{style}｜{len([r for r in history_rows if r.role == 'hr'])} 轮",
            snapshot={
                "sessionId": session_id,
                "direction": direction,
                "difficulty": difficulty,
                "style": style,
                "resumeJson": resume,
                "messages": [{"role": r.role, "content": r.content} for r in history_rows],
                "report": report,
            },
            session_id=session_id,
        )
        yield {"type": "结果", "payload": {"report": report, "session_id": session_id}}
        return

    # ---- 3. 对话分支 ----
    if message:
        await interview_repo.add_message(db, session_id, "user", message)
        history_rows = await interview_repo.list_messages(db, session_id)

    history = [{"role": row.role, "content": row.content} for row in history_rows]
    turn = len([row for row in history_rows if row.role == "hr"]) + 1
    runtime = runtime or {}
    full_reply = ""
    async for event in interview_chat.stream_hr_reply(
        resume,
        direction,
        difficulty,
        style,
        history,
        model=runtime.get("llm_model"),
        base_url=runtime.get("llm_base_url"),
        api_key=runtime.get("llm_api_key"),
        session_id=runtime.get("llm_session_id"),
        gateway=runtime.get("llm_gateway"),
        turn=turn,
    ):
        if event["type"] == "hr_message":
            full_reply = event["payload"]["content"]
            continue
        yield event

    if full_reply:
        await interview_repo.add_message(db, session_id, "hr", full_reply)
        yield {
            "type": "结果",
            "payload": {"session_id": session_id, "reply": full_reply, "turn": turn},
        }
