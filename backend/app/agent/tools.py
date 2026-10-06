"""工具注册表：供 Agent 编排调用的工具。"""
from langchain_core.tools import tool

from app.rag import vectorstore


@tool
def retrieve_knowledge(
    query: str,
    direction: str = "",
    difficulty: str = "",
    question_type: str = "",
) -> str:
    """检索题库知识库，返回相似题目的题干、参考答案与考点。

    Args:
        query: 检索查询文本。
        direction: 技术方向过滤（如 后端/前端/算法），可为空。
        difficulty: 难度过滤，可为空。
        question_type: 题型过滤（八股/算法/业务），可为空。
    """
    hits = vectorstore.search(
        query,
        direction or None,
        difficulty or None,
        question_type or None,
        top_k=5,
        use_rerank=True,
    )
    if not hits:
        return "未检索到相关内容。"
    lines = []
    for h in hits:
        lines.append(
            f"[{h['direction']}/{h['difficulty']}] {h['text']}\n"
            f"参考答案：{h['answer']}\n考点：{h['key_points']}"
        )
    return "\n\n".join(lines)


ALL_TOOLS = [retrieve_knowledge]
