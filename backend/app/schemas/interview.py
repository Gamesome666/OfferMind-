"""模拟面试请求模型。"""
from pydantic import BaseModel


class InterviewQuestionRequest(BaseModel):
    """面试提问请求。"""

    resume: str  # 结构化简历 JSON 字符串
    direction: str
    difficulty: str
    style: str = "项目深挖"


class InterviewReportRequest(BaseModel):
    """面试报告请求。"""

    config: str  # 面试配置 JSON 字符串
    rounds: str  # 逐轮记录 JSON 字符串


class InterviewChatRequest(BaseModel):
    """一问一答面试的请求。

    session_id 为空表示开一场新面试（服务端建会话、存配置、由 HR 说开场白）；
    不为空表示续聊（服务端按 session 取历史消息作为上下文）。

    两种动作：
    - message 非空：候选人发言，HR 回复；
    - summarize=True：不再发言，直接根据整场对话生成总结报告。
    """

    resume: str = ""  # 首条消息才需要，结构化简历 JSON 字符串
    direction: str = ""
    difficulty: str = ""
    style: str = "项目深挖"
    session_id: int | None = None
    message: str = ""
    summarize: bool = False
