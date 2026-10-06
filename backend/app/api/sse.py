"""SSE 响应封装：把 Agent 的异步事件生成器包装成 text/event-stream 响应。"""
import json
from typing import AsyncIterator

from fastapi.responses import StreamingResponse

# 关掉各级代理的缓冲，保证事件产生一条就往前端送一条
_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # nginx 等反向代理据此关闭响应缓冲
}


def sse_response(gen: AsyncIterator[dict]) -> StreamingResponse:
    """将异步事件生成器包装为 SSE 响应，流末尾补一个 [DONE] 标记。"""

    async def event_stream():
        async for event in gen:
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS
    )
