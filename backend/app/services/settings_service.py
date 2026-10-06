"""运行时配置服务：把「管理员可改的配置项」集中登记在一处。

每个配置项声明 key、默认值（来自 .env 的 settings）与说明。graph 节点每次执行时
读一次生效值，所以后台改完无需重启。默认值不落库 —— 库里没有该 key 就用默认值，
只有管理员真的改过才写库，这样 .env 依然是唯一的事实来源，配置表只存「覆盖」。
"""
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.repositories import config as config_repo


@dataclass(frozen=True)
class ConfigSpec:
    """一个可配置项的声明。"""

    key: str
    label: str
    default: str
    description: str
    kind: str = "text"  # text / select / bool / number / secret
    options: tuple[str, ...] = ()  # kind=select 时的候选值（拉不到实时列表时用的兜底）


# 「换一个服务商」这件事在后台是一次性要改三样东西的：端点、密钥、模型名。
# 预置把前两样固化下来，管理员点一下就把端点填好，只剩选模型 —— 手写 base_url
# 是最容易出错的一步（少写 /v1、多写斜杠都会 404）。
LLM_PRESETS: tuple[dict[str, str], ...] = (
    {
        "key": "opencode-go",
        "label": "OpenCode Go 套餐",
        "base_url": "https://opencode.ai/zen/go/v1",
        "note": "订阅制套餐，密钥以 oc_sk_ 开头；模型 id 形如 deepseek-v4-flash",
    },
    {
        "key": "opencode-zen",
        "label": "OpenCode Zen（按量计费）",
        "base_url": "https://opencode.ai/inference/openai/v1",
        "note": "控制台里建的 service account key，同样是 oc_sk_ 开头",
    },
    {
        "key": "deepseek",
        "label": "DeepSeek 官方",
        "base_url": "https://api.deepseek.com/v1",
        "note": "密钥以 sk- 开头；模型名是 deepseek-chat / deepseek-reasoner",
    },
)


# 登记表：管理后台读它渲染表单，业务侧读它取生效值
SPECS: tuple[ConfigSpec, ...] = (
    ConfigSpec(
        key="llm_base_url",
        label="模型端点 Base URL",
        default=settings.llm_base_url,
        description="OpenAI 兼容端点的根地址，需带 /v1（如 https://opencode.ai/zen/go/v1）",
    ),
    ConfigSpec(
        key="llm_api_key",
        label="模型 API Key",
        default=settings.deepseek_api_key,
        description="上面端点对应的密钥。出于安全考虑不回显，留空表示沿用已保存的值",
        kind="secret",
    ),
    ConfigSpec(
        key="llm_model",
        label="主生成模型",
        default=settings.llm_model,
        description="出题 / 评分 / 报告 / 面试对话使用的模型名。可点「拉取模型列表」从端点读实时的",
        kind="select",
        options=(
            "deepseek-v4-flash",
            "deepseek-v4.1-flash",
            "deepseek-v4-pro",
            "deepseek-chat",
            "deepseek-reasoner",
        ),
    ),
    ConfigSpec(
        key="llm_temperature",
        label="生成温度",
        default="0.0",
        description="结构化输出（出题/评分/报告）的温度，0 最稳定；面试对话另有固定 0.7",
        kind="number",
    ),
    ConfigSpec(
        key="retrieval_top_k",
        label="检索召回条数",
        default="5",
        description="评分时从题库召回多少条相似题目作为参照",
        kind="number",
    ),
    ConfigSpec(
        key="retrieval_mode",
        label="检索模式",
        default="dense",
        description=(
            "dense=纯向量（语义强）/ sparse=纯 BM25（专有名词、算法题名强）/ "
            "hybrid=两路召回 + RRF 融合（推荐）"
        ),
        kind="select",
        options=("dense", "sparse", "hybrid"),
    ),
    ConfigSpec(
        key="retrieval_use_rerank",
        label="启用精排",
        default="1",
        description="评分流程是否用 bge-reranker 对召回结果精排（关闭可省一次模型前向）",
        kind="bool",
    ),
    ConfigSpec(
        key="question_dup_threshold",
        label="出题查重阈值",
        default=str(settings.question_dup_threshold),
        description="新题与题库中最近似题的余弦相似度超过此值即判重、重新生成",
        kind="number",
    ),
    # ---- LLM 网关（多部署路由 + 失败回退，见 app/agent/gateway.py）----
    ConfigSpec(
        key="llm_gateway_enabled",
        label="启用 LLM 网关",
        default="0",
        description="开启后按下面的部署列表做路由与失败回退；关闭则直连单一端点",
        kind="bool",
    ),
    ConfigSpec(
        key="llm_gateway_deployments",
        label="网关部署列表",
        default="[]",
        description=(
            'JSON 数组。[{"name":"cloud-deepseek","model":"openai/deepseek-flash",'
            '"api_base":"https://opencode.ai/zen/go/v1","api_key":"..."},'
            '{"name":"local-qwen","model":"openai/Qwen2.5-7B-Instruct",'
            '"api_base":"http://127.0.0.1:8001/v1","api_key":"EMPTY"}]'
        ),
        kind="textarea",
    ),
    ConfigSpec(
        key="llm_gateway_primary",
        label="网关主部署",
        default="",
        description="默认走哪个部署（填 name）；留空取列表第一个",
    ),
    ConfigSpec(
        key="llm_gateway_fallbacks",
        label="失败回退规则",
        default="{}",
        description='JSON 对象，如 {"cloud-deepseek":["local-qwen"]} —— 云端失败时自动降级到本地',
        kind="textarea",
    ),
)

_SPEC_MAP = {spec.key: spec for spec in SPECS}


def all_specs() -> tuple[ConfigSpec, ...]:
    """返回全部配置项声明。"""
    return SPECS


def all_presets() -> tuple[dict[str, str], ...]:
    """返回内置的服务商预置（端点一键填充用）。"""
    return LLM_PRESETS


def model_options() -> tuple[str, ...]:
    """模型名的静态兜底候选：拉不到端点实时列表时给后台下拉框用。"""
    return _SPEC_MAP["llm_model"].options


async def effective(db: AsyncSession, key: str) -> str:
    """取一个配置项的生效值（库里有覆盖用覆盖，否则用默认）。"""
    spec = _SPEC_MAP.get(key)
    default = spec.default if spec else ""
    return await config_repo.get(db, key, default)


async def effective_float(db: AsyncSession, key: str, fallback: float) -> float:
    """取数值配置，解析失败回退。"""
    raw = await effective(db, key)
    try:
        return float(raw)
    except (TypeError, ValueError):
        return fallback


async def effective_int(db: AsyncSession, key: str, fallback: int) -> int:
    """取整数配置，解析失败回退。"""
    raw = await effective(db, key)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return fallback


async def effective_bool(db: AsyncSession, key: str, fallback: bool) -> bool:
    """取布尔配置（"1"/"true"/"yes" 为真），解析失败回退。"""
    raw = (await effective(db, key)).strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return fallback


async def snapshot(db: AsyncSession) -> list[dict[str, Any]]:
    """给管理后台用的配置快照：每项带默认值、当前生效值、说明。

    kind=secret 的项（API Key）只回报「有没有配」，绝不回显明文 —— 后台页面是发给
    浏览器的，密钥一旦进了响应体就等于泄给了任何一个能打开这个页面的管理员会话。
    """
    overrides = {row.key: row.value for row in await config_repo.list_all(db)}
    items: list[dict[str, Any]] = []
    for spec in SPECS:
        effective_value = overrides.get(spec.key, spec.default)
        secret = spec.kind == "secret"
        items.append(
            {
                "key": spec.key,
                "label": spec.label,
                "default": "" if secret else spec.default,
                "value": "" if secret else effective_value,
                "has_value": bool(effective_value) if secret else False,
                "overridden": spec.key in overrides,
                "description": spec.description,
                "kind": spec.kind,
                "options": list(spec.options),
            }
        )
    return items


async def runtime_config(db: AsyncSession) -> dict[str, Any]:
    """一次性读出 agent 需要的全部运行时配置，注入 LangGraph state。

    每次请求读一遍（带进程内缓存），所以管理员改完配置即刻生效。

    这里还生成一个**每次请求唯一**的会话 id：网关（OpenCode Go）要求客户端为每个会话
    发送稳定的 x-opencode-session，它据此做路由与 prompt 缓存亲和。一次用户请求
    = 一个会话，所以在这一层生成最自然 —— 整条链路（图节点、面试多轮）复用同一个 id。
    """
    from app.agent.llm import new_session_id

    return {
        "llm_model": await effective(db, "llm_model"),
        "llm_base_url": await effective(db, "llm_base_url"),
        "llm_api_key": await effective(db, "llm_api_key"),
        "llm_session_id": new_session_id(),
        # 网关：开启后 llm.py 走 LiteLLM Router（多部署 + 回退），否则直连单一端点。
        # 打包成一个子字典，这样上层只需透传一个字段，不用记住四个 key。
        "llm_gateway": {
            "enabled": await effective_bool(db, "llm_gateway_enabled", False),
            "deployments": await effective(db, "llm_gateway_deployments"),
            "primary": await effective(db, "llm_gateway_primary"),
            "fallbacks": await effective(db, "llm_gateway_fallbacks"),
        },
        "temperature": await effective_float(db, "llm_temperature", 0.0),
        "top_k": await effective_int(db, "retrieval_top_k", 5),
        "retrieval_mode": (await effective(db, "retrieval_mode")) or "dense",
        "use_rerank": await effective_bool(db, "retrieval_use_rerank", True),
        "dup_threshold": await effective_float(
            db, "question_dup_threshold", settings.question_dup_threshold
        ),
        "max_attempts": settings.question_max_attempts,
    }
