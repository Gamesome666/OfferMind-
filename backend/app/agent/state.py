"""LangGraph Agent 状态定义。"""
import operator
from typing import Annotated, Any, TypedDict

from langgraph.graph.message import add_messages


class AgentState(TypedDict, total=False):
    """Agent 图的状态。"""

    messages: Annotated[list, add_messages]
    task: str  # 任务类型：generate_question / grade / followup
    direction: str
    difficulty: str
    question_type: str
    weak_points: str
    question: str
    answer: str
    reference: str
    score_summary: str
    similar: str
    attempts: int  # 出题已尝试次数（用于查重后重生成的上限控制）
    duplicate: bool  # 最近一次生成的题目是否被判为与题库重复
    resume_text: str
    jd_text: str
    resume: str
    jd: str
    style: str
    config: str
    rounds: str
    followup: str
    traces: Annotated[list[dict[str, Any]], operator.add]  # 可观测轨迹
    output: dict[str, Any]
    # ---- 运行时配置（由 service 层从数据库读出后注入，管理员在后台改的即时生效）----
    llm_model: str | None
    llm_base_url: str | None
    llm_api_key: str | None
    # 本次请求的会话标识：网关据此做路由与 prompt 缓存亲和（见 settings_service.runtime_config）
    llm_session_id: str | None
    # 网关配置（多部署 + 回退），enabled 时改走 LiteLLM Router
    llm_gateway: dict | None
    temperature: float
    top_k: int
    retrieval_mode: str
    use_rerank: bool
    dup_threshold: float
    max_attempts: int
