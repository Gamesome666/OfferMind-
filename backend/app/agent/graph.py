"""LangGraph 编排：出题、评分、追问等 Agent 图。

每个节点产出结构化 step event（traces），供 M4 可观测面板消费。
节点开始时用 _start() 通过 LangGraph 的 stream writer 立即推送一条「进行中」事件，
结束时用 _finish() 推送同 id 的「已完成」事件，前端据此把进行中的那行原地替换 ——
所以面板是逐步实时出现的，而不是等整张图跑完才一次性刷出来。
"""
import time

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from pydantic import ValidationError

from app.agent import prompts, schemas
from app.agent.llm import get_structured_llm
from app.agent.state import AgentState
from app.core.config import settings


def _now_ms() -> int:
    return int(time.time() * 1000)


def _push(event: dict) -> None:
    """把事件实时推给 SSE 流。非图内运行时没有 stream writer，静默忽略。"""
    try:
        get_stream_writer()(event)
    except Exception:  # noqa: BLE001 —— 非流式调用场景下没有 writer，属于正常情况
        pass


def _start(step_id: str, kind: str, payload: dict) -> None:
    """节点开始执行：立即推送一条「进行中」事件。"""
    _push({"id": step_id, "type": kind, "status": "running", "payload": payload, "duration_ms": None})


def _finish(traces: list[dict], step_id: str, kind: str, payload: dict, duration_ms: int) -> None:
    """节点执行完成：推送并记录一条「已完成」事件（与 _start 同 id）。"""
    event = {"id": step_id, "type": kind, "status": "done", "payload": payload, "duration_ms": duration_ms}
    traces.append(event)
    _push(event)


def _invoke_structured(llm, prompt: str):
    """按给定 schema 调一次结构化输出。

    JSON 由服务端保证合法，但字段仍可能缺失或类型不符导致 Pydantic 校验不过，
    所以失败时重试一次；仍失败就抛一个能看懂的异常，而不是让上层报 NoneType 的错。
    """
    messages = [SystemMessage(content=prompts.SYSTEM_PROMPT), HumanMessage(content=prompt)]
    last_error: Exception | None = None
    for _ in range(2):
        try:
            return llm.invoke(messages)
        except ValidationError as exc:
            last_error = exc
    raise RuntimeError("模型返回的结构化结果不合法（字段缺失或类型不符），请重试") from last_error


def _llm_for(state: AgentState, schema):
    """按运行时配置构造结构化模型。

    端点 / 密钥 / 模型名 / 会话 id 都由 service 层从数据库读出来后注入 state（管理员可改），
    这里原样透传；哪一项没注入就由 llm 层回落到 .env 的默认值。
    """
    return get_structured_llm(
        schema,
        temperature=state.get("temperature", 0.0),
        model=state.get("llm_model") or None,
        base_url=state.get("llm_base_url") or None,
        api_key=state.get("llm_api_key") or None,
        session_id=state.get("llm_session_id") or None,
        gateway=state.get("llm_gateway") or None,
    )


def _model_name(state: AgentState) -> str:
    """当前生效的模型名，用于 step event 展示。"""
    return state.get("llm_model") or settings.llm_model


def retrieve_node(state: AgentState) -> dict:
    """检索题库知识库，产出细粒度可观测轨迹（向量化/召回/精排）。"""
    from app.rag import vectorstore

    query = state.get("question") or state.get("weak_points") or state.get("direction", "")
    step_traces: list[dict] = []
    # 出题流程的检索只用于避免重复，不必加载 reranker；评分流程（已有明确题目）才精排。
    # 管理员可以在后台把精排整体关掉（省一次模型前向）。
    default_rerank = bool(state.get("question"))
    hits = vectorstore.search(
        query,
        state.get("direction") or None,
        state.get("difficulty") or None,
        state.get("question_type") or None,
        top_k=state.get("top_k", 5),
        use_rerank=state.get("use_rerank", default_rerank) and default_rerank,
        traces=step_traces,
        on_event=_push,
        mode=state.get("retrieval_mode") or "dense",
    )
    if not hits:
        text = "未检索到相关内容。"
    else:
        text = "\n\n".join(
            f"[{h['direction']}/{h['difficulty']}] {h['text']}\n"
            f"参考答案：{h['answer']}\n考点：{h['key_points']}"
            for h in hits
        )
    return {
        "reference": text,
        "similar": text,
        "traces": step_traces,
    }


def generate_question_node(state: AgentState) -> dict:
    """LLM 出题，结构化输出。已有相似题目会作为「避免重复」的参考喂给模型。"""
    attempt = state.get("attempts", 0) + 1
    step_id = f"generate:{attempt}"
    payload = {"工具": "generate_question", "模型": _model_name(state), "第几次尝试": attempt}
    _start(step_id, "模型", payload)
    start = _now_ms()
    prompt = prompts.GENERATE_QUESTION_TEMPLATE.format(
        direction=state.get("direction", ""),
        difficulty=state.get("difficulty", ""),
        question_type=state.get("question_type", ""),
        weak_points=state.get("weak_points", "无"),
        similar=state.get("similar", "无"),
    )
    llm = _llm_for(state, schemas.QuestionOutput)
    result = _invoke_structured(llm, prompt)
    duration = _now_ms() - start
    traces: list[dict] = []
    _finish(traces, step_id, "模型", payload, duration)
    return {"output": result.model_dump(), "attempts": attempt, "traces": traces}


def dedup_node(state: AgentState) -> dict:
    """把新生成的题目在题库里查最近似的一条，相似度超阈值即判为重复。"""
    from app.rag import vectorstore

    attempt = state.get("attempts", 1)
    step_id = f"dedup:{attempt}"
    _start(step_id, "检索", {"阶段": "查重", "模型": "BGE-M3"})
    start = _now_ms()
    content = (state.get("output") or {}).get("content", "")
    hits = vectorstore.search(content, top_k=1, use_rerank=False)
    top = float(hits[0]["score"]) if hits else 0.0
    threshold = state.get("dup_threshold", settings.question_dup_threshold)
    duplicate = top >= threshold
    duration = _now_ms() - start
    traces: list[dict] = []
    _finish(
        traces,
        step_id,
        "检索",
        {
            "阶段": "查重",
            "最高相似度": round(top, 4),
            "阈值": threshold,
            "判定": "与题库重复，重新生成" if duplicate else "通过",
        },
        duration,
    )
    return {"duplicate": duplicate, "traces": traces}


def _route_after_dedup(state: AgentState) -> str:
    """仍在重复且未达尝试上限则回到生成，否则收尾。"""
    max_attempts = state.get("max_attempts", settings.question_max_attempts)
    if state.get("duplicate") and state.get("attempts", 0) < max_attempts:
        return "generate"
    return END


def grade_node(state: AgentState) -> dict:
    """LLM 四维评分，结构化输出。"""
    _start("grade", "模型", {"工具": "grade_answer", "模型": _model_name(state)})
    start = _now_ms()
    prompt = prompts.GRADE_TEMPLATE.format(
        question=state.get("question", ""),
        reference=state.get("reference", "无"),
        answer=state.get("answer", ""),
        GRADE_RUBRIC=prompts.GRADE_RUBRIC,
    )
    llm = _llm_for(state, schemas.GradeOutput)
    result = _invoke_structured(llm, prompt)
    duration = _now_ms() - start
    traces: list[dict] = []
    _finish(traces, "grade", "模型", {"工具": "grade_answer", "总分": result.total_score}, duration)
    return {"output": result.model_dump(), "traces": traces}


def followup_node(state: AgentState) -> dict:
    """LLM 追问，结构化输出。"""
    _start("followup", "模型", {"工具": "generate_followup", "模型": _model_name(state)})
    start = _now_ms()
    prompt = prompts.FOLLOWUP_TEMPLATE.format(
        question=state.get("question", ""),
        answer=state.get("answer", ""),
        score_summary=state.get("score_summary", ""),
    )
    llm = _llm_for(state, schemas.FollowupOutput)
    result = _invoke_structured(llm, prompt)
    duration = _now_ms() - start
    traces: list[dict] = []
    _finish(traces, "followup", "模型", {"工具": "generate_followup"}, duration)
    return {"output": result.model_dump(), "traces": traces}


def _build_generate_question_graph():
    """出题图：先检索题库已有题目（避免重复），生成后再回投向量库查重，重复则重生成。"""
    g = StateGraph(AgentState)
    g.add_node("retrieve", retrieve_node)
    g.add_node("generate", generate_question_node)
    g.add_node("dedup", dedup_node)
    g.add_edge(START, "retrieve")
    g.add_edge("retrieve", "generate")
    g.add_edge("generate", "dedup")
    g.add_conditional_edges("dedup", _route_after_dedup, {"generate": "generate", END: END})
    return g.compile()


def _build_grade_graph():
    g = StateGraph(AgentState)
    g.add_node("retrieve", retrieve_node)
    g.add_node("grade", grade_node)
    g.add_edge(START, "retrieve")
    g.add_edge("retrieve", "grade")
    g.add_edge("grade", END)
    return g.compile()


def _build_followup_graph():
    g = StateGraph(AgentState)
    g.add_node("followup", followup_node)
    g.add_edge(START, "followup")
    g.add_edge("followup", END)
    return g.compile()


generate_question_graph = _build_generate_question_graph()
grade_graph = _build_grade_graph()
followup_graph = _build_followup_graph()


def parse_resume_node(state: AgentState) -> dict:
    """LLM 解析简历为结构化信息。"""
    _start("parse_resume", "模型", {"工具": "parse_resume", "模型": _model_name(state)})
    start = _now_ms()
    prompt = prompts.PARSE_RESUME_TEMPLATE.format(resume_text=state.get("resume_text", ""))
    llm = _llm_for(state, schemas.ResumeOutput)
    result = _invoke_structured(llm, prompt)
    duration = _now_ms() - start
    traces: list[dict] = []
    _finish(traces, "parse_resume", "模型", {"工具": "parse_resume"}, duration)
    return {"output": result.model_dump(), "traces": traces}


def parse_jd_node(state: AgentState) -> dict:
    """LLM 解析 JD 为岗位画像。"""
    _start("parse_jd", "模型", {"工具": "parse_jd", "模型": _model_name(state)})
    start = _now_ms()
    prompt = prompts.PARSE_JD_TEMPLATE.format(jd_text=state.get("jd_text", ""))
    llm = _llm_for(state, schemas.JDOutput)
    result = _invoke_structured(llm, prompt)
    duration = _now_ms() - start
    traces: list[dict] = []
    _finish(traces, "parse_jd", "模型", {"工具": "parse_jd"}, duration)
    return {"output": result.model_dump(), "traces": traces}


def diagnose_node(state: AgentState) -> dict:
    """LLM 对比简历与 JD，产出诊断报告。"""
    _start("diagnose", "模型", {"工具": "diagnose", "模型": _model_name(state)})
    start = _now_ms()
    prompt = prompts.DIAGNOSE_TEMPLATE.format(
        resume=state.get("resume", ""), jd=state.get("jd", "")
    )
    llm = _llm_for(state, schemas.DiagnoseOutput)
    result = _invoke_structured(llm, prompt)
    duration = _now_ms() - start
    traces: list[dict] = []
    _finish(traces, "diagnose", "模型", {"工具": "diagnose", "匹配度": result.match_score}, duration)
    return {"output": result.model_dump(), "traces": traces}


def _build_parse_resume_graph():
    g = StateGraph(AgentState)
    g.add_node("parse", parse_resume_node)
    g.add_edge(START, "parse")
    g.add_edge("parse", END)
    return g.compile()


def _build_parse_jd_graph():
    g = StateGraph(AgentState)
    g.add_node("parse", parse_jd_node)
    g.add_edge(START, "parse")
    g.add_edge("parse", END)
    return g.compile()


def _build_diagnose_graph():
    g = StateGraph(AgentState)
    g.add_node("diagnose", diagnose_node)
    g.add_edge(START, "diagnose")
    g.add_edge("diagnose", END)
    return g.compile()


parse_resume_graph = _build_parse_resume_graph()
parse_jd_graph = _build_parse_jd_graph()
diagnose_graph = _build_diagnose_graph()


def interview_question_node(state: AgentState) -> dict:
    """LLM 基于简历生成深挖式面试提问。"""
    _start("interview_question", "模型", {"工具": "interview_question", "模型": _model_name(state)})
    start = _now_ms()
    prompt = prompts.INTERVIEW_QUESTION_TEMPLATE.format(
        resume=state.get("resume", ""),
        direction=state.get("direction", ""),
        difficulty=state.get("difficulty", ""),
        style=state.get("style", "项目深挖"),
    )
    llm = _llm_for(state, schemas.InterviewQuestionOutput)
    result = _invoke_structured(llm, prompt)
    duration = _now_ms() - start
    traces: list[dict] = []
    _finish(traces, "interview_question", "模型", {"工具": "interview_question"}, duration)
    return {"output": result.model_dump(), "traces": traces}


def interview_report_node(state: AgentState) -> dict:
    """LLM 基于逐轮记录生成面试报告。"""
    _start("interview_report", "模型", {"工具": "interview_report", "模型": _model_name(state)})
    start = _now_ms()
    prompt = prompts.INTERVIEW_REPORT_TEMPLATE.format(
        config=state.get("config", ""), rounds=state.get("rounds", "")
    )
    llm = _llm_for(state, schemas.InterviewReportOutput)
    result = _invoke_structured(llm, prompt)
    duration = _now_ms() - start
    traces: list[dict] = []
    _finish(
        traces, "interview_report", "模型", {"工具": "interview_report", "总分": result.total_score}, duration
    )
    return {"output": result.model_dump(), "traces": traces}


def _build_interview_question_graph():
    g = StateGraph(AgentState)
    g.add_node("question", interview_question_node)
    g.add_edge(START, "question")
    g.add_edge("question", END)
    return g.compile()


def _build_interview_report_graph():
    g = StateGraph(AgentState)
    g.add_node("report", interview_report_node)
    g.add_edge(START, "report")
    g.add_edge("report", END)
    return g.compile()


interview_question_graph = _build_interview_question_graph()
interview_report_graph = _build_interview_report_graph()


def training_report_node(state: AgentState) -> dict:
    """LLM 基于训练记录生成训练报告。"""
    _start("training_report", "模型", {"工具": "training_report", "模型": _model_name(state)})
    start = _now_ms()
    prompt = prompts.TRAINING_REPORT_TEMPLATE.format(
        question=state.get("question", ""),
        answer=state.get("answer", ""),
        score=state.get("score_summary", ""),
        followup=state.get("followup", ""),
    )
    llm = _llm_for(state, schemas.TrainingReportOutput)
    result = _invoke_structured(llm, prompt)
    duration = _now_ms() - start
    traces: list[dict] = []
    _finish(traces, "training_report", "模型", {"工具": "training_report"}, duration)
    return {"output": result.model_dump(), "traces": traces}


def _build_training_report_graph():
    g = StateGraph(AgentState)
    g.add_node("report", training_report_node)
    g.add_edge(START, "report")
    g.add_edge("report", END)
    return g.compile()


training_report_graph = _build_training_report_graph()
