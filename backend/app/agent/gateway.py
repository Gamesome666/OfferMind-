"""LLM 网关：基于 LiteLLM Router 的多部署路由与失败回退。

**为什么需要网关**：项目原来只有「一个端点、一个模型」。真部署要面对的是：
本地 vLLM 起的 Qwen 便宜但要 GPU 常驻、云端 API 强但按量计费且会限流。
网关负责在两者之间做决定 —— 简单任务走本地，难任务走云端，云端挂了自动切本地。

**为什么是进程内 Router 而不是 LiteLLM Proxy 服务**：
Proxy 是独立进程 + YAML 配置，改一次路由要改文件、重启服务；进程内 Router 的配置
来自 `SystemConfig`，管理后台改完即时生效，而且每次路由/回退都能推一条 step event
进可观测面板 —— 这与项目「可观测」的卖点是同一个方向。要独立服务形态的话，
`deploy/litellm/config.yaml` 里有等价的 Proxy 配置。

**接口对齐**：LiteLLM 是原生 SDK，不是 langchain 组件。我们的 `JsonSchemaLLM` 只用到
`bind()` / `invoke()` / `astream()` 三个方法，所以这里写一个薄适配器对齐，而不是引入
`langchain-litellm` 另加一个依赖。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

# 网关默认关闭：开着但不配部署列表会把原有链路弄坏，所以必须显式启用
DEFAULT_ENABLED = False


@dataclass
class Deployment:
    """一个可路由的模型部署。"""

    name: str  # 逻辑名，如 local-qwen / cloud-deepseek
    model: str  # LiteLLM 模型串，如 openai/Qwen2.5-7B-Instruct
    api_base: str = ""
    api_key: str = ""
    weight: float = 1.0  # 同优先级里的负载权重
    # 路由策略：simple / complex。按任务难度分流时用
    tiers: tuple[str, ...] = field(default_factory=lambda: ("all",))

    def to_litellm(self) -> dict[str, Any]:
        entry: dict[str, Any] = {"model_name": self.name, "litellm_params": {"model": self.model}}
        if self.api_base:
            entry["litellm_params"]["api_base"] = self.api_base
        if self.api_key:
            entry["litellm_params"]["api_key"] = self.api_key
        # DeepSeek 系（含各家网关转发的 deepseek-*）默认开 thinking：一来结构化输出会退化，
        # 二来思考 token 也计入费用。判据放在模型名上，与 llm.py 的直连路径保持一致 ——
        # 本地 Qwen 部署不会命中这条，也就不会被塞进无意义的请求体字段。
        if "deepseek" in self.model.lower():
            entry["litellm_params"]["extra_body"] = {"thinking": {"type": "disabled"}}
        return entry


def _msg_to_dict(message: BaseMessage) -> dict[str, str]:
    """langchain 消息 → OpenAI 消息格式。"""
    if isinstance(message, SystemMessage):
        role = "system"
    elif isinstance(message, AIMessage):
        role = "assistant"
    elif isinstance(message, HumanMessage):
        role = "user"
    else:
        # 其它类型（ToolMessage 等）本项目用不到，统一当 user 处理，避免静默丢消息
        role = "user"
    content = message.content
    if not isinstance(content, str):
        content = json.dumps(content, ensure_ascii=False)
    return {"role": role, "content": content}


class _Result:
    """对齐 langchain AIMessage 的最小结果对象（我们只用到 .content）。"""

    __slots__ = ("content",)

    def __init__(self, content: str) -> None:
        self.content = content


class LiteLLMChat:
    """用 LiteLLM Router 驱动的聊天客户端，接口对齐 langchain 的子集。

    只暴露 `bind()` / `invoke()` / `astream()` —— 正好是 JsonSchemaLLM 与 astream_chat
    用到的那三个。这样切换网关不需要动上层任何代码。
    """

    def __init__(self, router, model: str, params: dict[str, Any] | None = None) -> None:
        self._router = router
        self._model = model
        self._params: dict[str, Any] = dict(params or {})

    def bind(self, **kwargs: Any) -> LiteLLMChat:
        """累积参数，返回新实例（不可变语义，和 langchain 的 bind 一致）。"""
        merged = {**self._params, **kwargs}
        return LiteLLMChat(self._router, self._model, merged)

    def _request(self, messages: list[BaseMessage]) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [_msg_to_dict(m) for m in messages],
        }
        payload.update(self._params)
        # LiteLLM 用 max_tokens 而非 langchain 的其它命名；response_format 直接透传
        return payload

    def invoke(self, messages: list[BaseMessage]) -> _Result:
        response = self._router.completion(**self._request(messages))
        content = response.choices[0].message.content or ""
        return _Result(content)

    async def astream(self, messages: list[BaseMessage]) -> AsyncIterator[_Result]:
        stream = await self._router.acompletion(stream=True, **self._request(messages))
        async for chunk in stream:
            delta = chunk.choices[0].delta
            text = getattr(delta, "content", None)
            if text:
                yield _Result(text)


def parse_deployments(raw: str) -> list[Deployment]:
    """把管理后台存的 JSON 文本解析成部署列表。

    格式（数组）：
        [{"name": "cloud-deepseek", "model": "openai/deepseek-flash",
          "api_base": "https://opencode.ai/zen/go/v1", "api_key": "oc_sk_..."},
         {"name": "local-qwen", "model": "openai/Qwen2.5-7B-Instruct",
          "api_base": "http://127.0.0.1:8001/v1", "api_key": "EMPTY"}]
    """
    if not raw or not raw.strip():
        return []
    try:
        rows = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(rows, list):
        return []
    out: list[Deployment] = []
    for row in rows:
        if not isinstance(row, dict) or not row.get("name") or not row.get("model"):
            continue
        out.append(
            Deployment(
                name=str(row["name"]),
                model=str(row["model"]),
                api_base=str(row.get("api_base") or ""),
                api_key=str(row.get("api_key") or ""),
                weight=float(row.get("weight") or 1.0),
                tiers=tuple(row.get("tiers") or ("all",)),
            )
        )
    return out


def parse_fallbacks(raw: str) -> list[dict[str, list[str]]]:
    """把「主部署 → 备选部署」的映射解析成 LiteLLM 的 fallbacks 格式。

    格式（对象）：{"cloud-deepseek": ["local-qwen"]}
    含义：cloud-deepseek 失败时依次降级到 local-qwen。
    """
    if not raw or not raw.strip():
        return []
    try:
        mapping = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(mapping, dict):
        return []
    return [{str(k): [str(x) for x in v]} for k, v in mapping.items() if isinstance(v, list)]


class LlmGateway:
    """路由器封装：按部署列表构建 Router，暴露一个模型入口。"""

    def __init__(
        self,
        deployments: list[Deployment],
        fallbacks: list[dict[str, list[str]]] | None = None,
        primary: str = "",
        num_retries: int = 2,
        timeout: float = 120.0,
    ) -> None:
        from litellm import Router

        if not deployments:
            raise ValueError("网关至少要有一个部署")
        self.deployments = deployments
        self.primary = primary or deployments[0].name
        self._router = Router(
            model_list=[d.to_litellm() for d in deployments],
            fallbacks=fallbacks or [],
            num_retries=num_retries,
            timeout=timeout,
        )

    def chat(self, params: dict[str, Any] | None = None) -> LiteLLMChat:
        return LiteLLMChat(self._router, self.primary, params)

    def deployment_names(self) -> list[str]:
        return [d.name for d in self.deployments]
