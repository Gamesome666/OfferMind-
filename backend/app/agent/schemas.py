"""Agent 结构化输出模型。"""
from pydantic import BaseModel, Field


class QuestionOutput(BaseModel):
    """出题结果。"""

    content: str = Field(description="题干")
    samples: str = Field(description="输入输出样例与约束（算法题）")
    key_points: str = Field(description="考察点")
    reference_answer: str = Field(description="参考答案")


class DimensionScore(BaseModel):
    """单维评分。"""

    score: int = Field(description="0-5 分")
    reason: str = Field(description="评分理由")


class GradeOutput(BaseModel):
    """四维评分结果。"""

    correctness: DimensionScore = Field(description="正确性")
    completeness: DimensionScore = Field(description="完整性/深度")
    clarity: DimensionScore = Field(description="表达与结构")
    terminology: DimensionScore = Field(description="术语准确性")
    total_score: float = Field(description="加权总分，0-5")
    strengths: str = Field(description="优点")
    suggestions: str = Field(description="改进建议")
    reference_answer: str = Field(description="参考答案")


class FollowupOutput(BaseModel):
    """追问结果。"""

    question: str = Field(description="追问问题")
    reference_answer: str = Field(description="追问的参考答案")
    key_points: str = Field(description="追问考察点")


class ProjectItem(BaseModel):
    """简历中的项目经历。"""

    name: str = Field(description="项目名称")
    description: str = Field(description="项目描述")
    tech_stack: str = Field(description="技术栈")


class ResumeOutput(BaseModel):
    """结构化简历。"""

    name: str = Field(description="姓名")
    education: str = Field(description="教育背景")
    skills: list[str] = Field(description="技能列表")
    projects: list[ProjectItem] = Field(description="项目经历")
    work_experience: str = Field(description="工作/实习经历")
    summary: str = Field(description="个人总结")


class JDOutput(BaseModel):
    """岗位画像。"""

    position: str = Field(description="岗位名称")
    responsibilities: list[str] = Field(description="岗位职责")
    required_skills: list[str] = Field(description="必备技能")
    preferred_skills: list[str] = Field(description="加分技能")


class DiagnoseOutput(BaseModel):
    """简历诊断结果。"""

    match_score: int = Field(description="匹配度 0-100")
    strengths: list[str] = Field(description="亮点")
    weaknesses: list[str] = Field(description="短板")
    missing_skills: list[str] = Field(description="缺失技能")
    suggestions: list[str] = Field(description="优化建议")


class InterviewQuestionOutput(BaseModel):
    """面试提问结果。"""

    question: str = Field(description="面试问题")
    reference_answer: str = Field(description="参考答案")
    key_points: str = Field(description="考察点")


class InterviewReportOutput(BaseModel):
    """面试报告。"""

    total_score: float = Field(description="总分 0-100")
    overall_comment: str = Field(description="总体评价")
    round_feedback: list[str] = Field(description="逐轮评价")
    improvements: list[str] = Field(description="改进建议")
    radar: dict[str, float] = Field(description="能力雷达：维度→分数")


class TrainingReportOutput(BaseModel):
    """训练报告。"""

    summary: str = Field(description="总体评价")
    weak_points: list[str] = Field(description="薄弱点")
    suggestions: list[str] = Field(description="改进建议")
    radar: dict[str, float] = Field(description="能力雷达：维度→分数")
