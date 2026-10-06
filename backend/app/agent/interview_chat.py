"""模拟面试的一问一答对话（HR 角色）。

与 graph.py 里那批「一问一答一张表」的单轮节点不同，面试是一场有上下文的连续对话：
HR 说完候选人说、候选人说完 HR 接着说，最后再基于整场对话出总结。所以这里不用
StateGraph 建图，而是一个带会话状态的异步生成器 —— 每说一句话推一串 token 事件，
前端把 token 拼成气泡。可观测性与别处保持一致：一轮 HR 回复两边各推一条同 id 的
「模型」事件（进行中 / 已完成），所以执行面板里能看到「HR 正在思考」。
"""
import time
from typing import Any, AsyncIterator

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.agent import prompts
from app.agent.llm import astream_chat
from app.core.config import settings


def _now_ms() -> int:
    return int(time.time() * 1000)


def build_messages(
    resume: str,
    direction: str,
    difficulty: str,
    style: str,
    history: list[dict[str, str]],
) -> list:
    """把简历配置 + 历史对话拼成模型消息序列。

    history 里 role 为 hr 的映射成 AI 消息，user 的映射成 Human 消息。
    """
    messages: list = [
        SystemMessage(content=prompts.INTERVIEW_CHAT_SYSTEM),
        HumanMessage(
            content=prompts.build_interview_chat_prompt(resume, direction, difficulty, style)
        ),
    ]
    for item in history:
        content = item.get("content", "")
        if item.get("role") == "hr":
            messages.append(AIMessage(content=content))
        else:
            messages.append(HumanMessage(content=content))
    return messages


async def stream_hr_reply(
    resume: str,
    direction: str,
    difficulty: str,
    style: str,
    history: list[dict[str, str]],
    model: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    session_id: str | None = None,
    gateway: dict | None = None,
    turn: int = 1,
) -> AsyncIterator[dict[str, Any]]:
    """HR 说一句话，token 级流式推给前端。

    事件类型：
    - step：与别处一致的步骤事件（id=hr_reply:{turn}），执行面板用它显示「进行中」；
    - token：一个文本分片，前端追加到当前气泡；
    - done：本句话结束，带上完整文本与耗时，前端落库/写历史用。
    """
    step_id = f"hr_reply:{turn}"
    payload = {"工具": "interview_chat", "模型": model or settings.llm_model, "第几轮": turn}
    yield {"id": step_id, "type": "模型", "status": "running", "payload": payload, "duration_ms": None}

    start = _now_ms()
    parts: list[str] = []
    try:
        messages = build_messages(resume, direction, difficulty, style, history)
        async for piece in astream_chat(
            messages,
            temperature=0.7,
            model=model,
            base_url=base_url,
            api_key=api_key,
            session_id=session_id,
            gateway=gateway,
        ):
            parts.append(piece)
            yield {"type": "token", "id": step_id, "payload": {"text": piece}}
    except Exception as exc:  # noqa: BLE001
        yield {"type": "错误", "payload": {"message": str(exc)}}
        return

    full_text = "".join(parts)
    duration = _now_ms() - start
    yield {
        "id": step_id,
        "type": "模型",
        "status": "done",
        "payload": payload,
        "duration_ms": duration,
    }
    yield {"type": "hr_message", "payload": {"content": full_text, "turn": turn}}
