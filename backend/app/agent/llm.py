"""LLM 封装：OpenAI 兼容端点，懒加载。

「用哪个模型」由三件事共同决定：base_url（服务商端点）、api_key（密钥）、model（模型名）。
三者都可以由管理员在后台改，所以它们一律由调用方从运行时配置里取出来传进来；
只有调用方没传时才回落到 .env（settings）里的默认值。

网关类端点（OpenCode Go）还额外要求两样东西，否则一律被拒：
- 自己的 **User-Agent**（不能是 generic SDK/HTTP 库名）；
- 每个会话稳定的 **x-opencode-session** 头，Gateway 用它做路由与 prompt 缓存亲和。
详见 https://opencode.ai/v2/docs/console/go/ 。两样都由本模块统一加上。
"""
import uuid
from functools import lru_cache

import httpx
from langchain_core.messages import HumanMessage
from langchain_core.output_parsers import PydanticOutputParser
from langchain_openai import ChatOpenAI

from app.core.config import settings

# 需要会话头的网关：只有命中这些域名的端点才附加 x-opencode-session
_SESSION_HEADER_HOSTS = ("opencode.ai",)
_SESSION_HEADER_NAME = "x-opencode-session"


def new_session_id() -> str:
    """生成一个会话 id。调用方按「一次用户请求 = 一个会话」的粒度生成一次，整轮复用。"""
    return uuid.uuid4().hex


def _client_headers(base_url: str, session_id: str | None) -> dict[str, str]:
    """构造本次请求要带的头。

    User-Agent 一律带 —— 网关明确要求客户端表明身份，带上对其它服务商也无害。
    x-opencode-session 只在网关端点上带，避免给不认识的厂商发无关头。
    """
    headers = {"User-Agent": settings.llm_user_agent}
    if session_id and any(host in (base_url or "") for host in _SESSION_HEADER_HOSTS):
        headers[_SESSION_HEADER_NAME] = session_id
    return headers


@lru_cache(maxsize=64)
def _get_llm_cached(model: str, base_url: str, api_key: str, temperature: float) -> ChatOpenAI:
    """按 (model, base_url, api_key, temperature) 缓存的底层实现。

    管理员在后台改了端点 / 密钥 / 模型后，调用方传进来的这几个值会变，于是走到新的
    缓存条目；旧条目虽然还在但不会再被命中。这样不用清缓存就能让配置即时生效。
    密钥必须进缓存键，否则「只换了 key」不会构造新客户端，会拿着旧 key 继续请求。

    会话头不进缓存键：它是每次请求变的，进了缓存键会让客户端缓存彻底失效。
    所以这里只固定 User-Agent，会话头由 get_llm 在缓存之外按调用附加。
    """
    kwargs: dict = {"model": model, "temperature": temperature}
    if api_key:
        kwargs["api_key"] = api_key
    if base_url:
        kwargs["base_url"] = base_url
    kwargs["default_headers"] = {"User-Agent": settings.llm_user_agent}
    # DeepSeek 系模型（含各家网关转发的 deepseek-v4-*）默认开启 thinking，thinking 模式下
    # 结构化输出会退化/报错。thinking 是 DeepSeek 特有的请求体字段，经 extra_body 透传。
    # 判据放在模型名上而不是 base_url 上：走 OpenCode 这类网关时 base_url 里并没有
    # "deepseek" 字样，但底下转发的仍是同一个模型，同样需要关掉。
    if "deepseek" in model.lower():
        kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
    return ChatOpenAI(**kwargs)


@lru_cache(maxsize=8)
def _get_gateway_cached(deployments_json: str, fallbacks_json: str, primary: str):
    """按配置内容缓存的 LiteLLM 路由器。

    配置文本进缓存键：管理员改了部署列表或回退规则，就是一条新缓存条目，
    旧条目不再命中 —— 与 _get_llm_cached 同一套「改完即时生效」的思路。
    """
    from app.agent.gateway import LlmGateway, parse_deployments, parse_fallbacks

    deployments = parse_deployments(deployments_json)
    if not deployments:
        return None
    return LlmGateway(
        deployments,
        fallbacks=parse_fallbacks(fallbacks_json),
        primary=primary,
    )


def get_llm(
    temperature: float = 0.0,
    model: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    session_id: str | None = None,
    gateway: dict | None = None,
):
    """获取聊天模型。

    前四个参数为 None 表示「调用方没指定」，用 .env 的默认值兜底。
    session_id 是本次会话的稳定标识（见模块 docstring），由调用方按请求生成。
    gateway 非空且 enabled 时改走 LiteLLM Router（多部署路由 + 失败回退）。
    """
    resolved_base = base_url or settings.llm_base_url
    headers = _client_headers(resolved_base, session_id)

    # 网关分支：多部署 + 回退。配置解析不出来（比如列表为空）就静默回落到直连，
    # 不能因为网关配置写错就让整个服务不可用。
    if gateway and gateway.get("enabled"):
        router_gateway = _get_gateway_cached(
            gateway.get("deployments") or "",
            gateway.get("fallbacks") or "",
            gateway.get("primary") or "",
        )
        if router_gateway is not None:
            params: dict = {"temperature": temperature}
            if session_id:
                # LiteLLM 用 extra_headers 透传自定义头（网关要求见模块 docstring）
                params["extra_headers"] = headers
            return router_gateway.chat(params)

    client = _get_llm_cached(
        model or settings.llm_model,
        resolved_base,
        api_key or settings.deepseek_api_key,
        temperature,
    )
    # 会话头按调用附加：走 bind 而不是重建客户端，这样连接池与客户端缓存都还能复用
    return client.bind(extra_headers=headers) if session_id else client


async def list_models(base_url: str, api_key: str) -> list[str]:
    """向 OpenAI 兼容端点拉取可用模型 id，供管理后台的模型下拉框使用。

    拉不到不算错误（端点不支持 /models、网络不通、key 无效……），调用方回退到
    静态候选列表即可，不要因此让整个配置页打不开。
    """
    url = f"{(base_url or '').rstrip('/')}/models"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        payload = resp.json()
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    return sorted({row["id"] for row in rows if isinstance(row, dict) and row.get("id")})


class JsonSchemaLLM:
    """让模型按给定 Pydantic schema 输出 JSON。

    用 response_format=json_object 而不是 function calling，原因是 DeepSeek 在工具调用
    模式下**不保证** arguments 是合法 JSON：模型只要在某个字符串里写了未转义的引号，
    比如 `"采用"总分总"结构作答"`，整段 JSON 就坏掉，langchain 解析不出工具调用，
    返回 None，上层报 'NoneType' object has no attribute 'model_dump'（实测约三成概率，
    报告类这种长文本输出尤其容易触发）。json_object 模式由服务端约束解码，返回的必然
    是合法 JSON，再由 Pydantic 校验字段。

    代价：json_object 要求 prompt 里出现 "json" 字样，所以这里把 schema 的格式说明作为
    最后一条消息追加进去（PydanticOutputParser 生成的说明文本里含 JSON）。
    """

    def __init__(self, llm: ChatOpenAI, schema) -> None:
        self._llm = llm.bind(response_format={"type": "json_object"})
        self._schema = schema
        self._instructions = PydanticOutputParser(pydantic_object=schema).get_format_instructions()

    def invoke(self, messages):
        """调用模型，并把返回的 JSON 解析成 schema 实例。"""
        result = self._llm.invoke([*messages, HumanMessage(content=self._instructions)])
        return self._schema.model_validate_json(result.content)

    async def astream_text(self, messages):
        """流式产出纯文本（不进 Pydantic 校验）。

        用于面试这种「HR 说话」的场景：用户要看到字一个一个蹦出来，
        而不是等一整段 JSON 编码完。调用方负责把分片拼起来。
        """
        async for chunk in self._llm.astream(messages):
            content = chunk.content
            if isinstance(content, str) and content:
                yield content


def get_structured_llm(
    schema,
    temperature: float = 0.0,
    model: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    session_id: str | None = None,
    gateway: dict | None = None,
) -> JsonSchemaLLM:
    """获取按 schema 返回结构化结果的模型。"""
    return JsonSchemaLLM(
        get_llm(temperature, model, base_url, api_key, session_id, gateway), schema
    )


async def astream_chat(
    messages,
    temperature: float = 0.7,
    model: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    session_id: str | None = None,
    gateway: dict | None = None,
):
    """纯文本 token 流：HR 面试官说话用。

    不走 JsonSchemaLLM，因为这里是开放式对话（不是结构化输出），
    用户要看到字一个一个蹦出来。temperature 默认 0.7，比结构化输出高一点，
    让 HR 的口吻自然一些，不要每句都像模板。
    """
    llm = get_llm(temperature, model, base_url, api_key, session_id, gateway)
    async for chunk in llm.astream(messages):
        content = chunk.content
        if isinstance(content, str) and content:
            yield content
