"""简历相关请求模型。"""
from pydantic import BaseModel


class DiagnoseRequest(BaseModel):
    """简历诊断请求。"""

    resume_text: str
    jd_text: str
