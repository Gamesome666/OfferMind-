"""简历端点：上传解析与 JD 匹配诊断。"""
import json
import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.agent import service as agent_service
from app.api.deps import get_current_user, get_runtime
from app.api.sse import sse_response
from app.models.user import User
from app.schemas.resume import DiagnoseRequest
from app.services.resume_parser import extract_pdf_text

router = APIRouter(prefix="/resume", tags=["resume"])


async def _read_pdf_text(file: UploadFile) -> str:
    """读取上传的 PDF 并抽出纯文本（流式接口在进入 SSE 之前调用）。"""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="文件为空")
    text = extract_pdf_text(content)
    if not text.strip():
        raise HTTPException(status_code=400, detail="无法从 PDF 提取文本，可能是扫描件")
    return text


@router.post("/parse")
async def parse_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> dict:
    """上传 PDF 简历，提取文本并结构化。"""
    text = await _read_pdf_text(file)
    result = await agent_service.parse_resume(text, runtime)
    return {"resume_text": text, "structured": result["output"], "traces": result["traces"]}


@router.post("/parse/stream")
async def parse_resume_stream(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> StreamingResponse:
    """上传 PDF 简历并结构化（SSE 流式，供执行面板实时展示）。"""
    # 抽文本是本地同步操作，很快，放在进 SSE 之前做；它的耗时作为一条步骤事件补推出去
    started = time.perf_counter()
    text = await _read_pdf_text(file)
    extract_ms = int((time.perf_counter() - started) * 1000)

    async def gen() -> AsyncIterator[dict]:
        yield {
            "id": "pdf_extract",
            "type": "工具",
            "status": "done",
            "payload": {"工具": "extract_pdf_text", "提取字符数": len(text)},
            "duration_ms": extract_ms,
        }
        async for event in agent_service.parse_resume_stream(text, runtime):
            if event["type"] == "结果":
                # 把原文一起带回去，前端后续「诊断」步骤要用
                yield {"type": "结果", "payload": {**event["payload"], "resume_text": text}}
            else:
                yield event

    return sse_response(gen())


@router.post("/diagnose")
async def diagnose(
    payload: DiagnoseRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> dict:
    """简历 + JD 诊断，返回匹配度与优化建议。"""
    resume_result = await agent_service.parse_resume(payload.resume_text, runtime)
    jd_result = await agent_service.parse_jd(payload.jd_text, runtime)
    resume_json = json.dumps(resume_result["output"], ensure_ascii=False)
    jd_json = json.dumps(jd_result["output"], ensure_ascii=False)
    diag_result = await agent_service.diagnose(resume_json, jd_json, runtime)
    return {
        "structured_resume": resume_result["output"],
        "jd_profile": jd_result["output"],
        "diagnosis": diag_result["output"],
        "traces": resume_result["traces"] + jd_result["traces"] + diag_result["traces"],
    }


@router.post("/diagnose/stream")
async def diagnose_stream(
    payload: DiagnoseRequest,
    current_user: User = Depends(get_current_user),
    runtime: dict[str, Any] = Depends(get_runtime),
) -> StreamingResponse:
    """简历 + JD 诊断（SSE 流式）：解析简历 → 解析 JD → 对比诊断，逐步推送。"""
    return sse_response(
        agent_service.diagnose_stream(payload.resume_text, payload.jd_text, runtime)
    )
