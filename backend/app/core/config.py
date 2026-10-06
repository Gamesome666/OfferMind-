"""应用配置：从环境变量 / .env 读取。"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全局配置，字段对应 .env 中的同名变量。"""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # 应用
    app_name: str = "OfferMind"
    debug: bool = False
    api_prefix: str = "/api/v1"

    # 数据库
    # 统一用 127.0.0.1：Windows 下 localhost 会先解析到 IPv6 ::1，而 Docker 端口只映射了 IPv4，
    # 连 ::1 会静默超时 20 秒以上才回退到 IPv4。
    database_url: str = "postgresql+asyncpg://offermind:offermind@127.0.0.1:5432/offermind"

    # 缓存 / 会话
    redis_url: str = "redis://127.0.0.1:6379/0"

    # 向量库
    qdrant_url: str = "http://127.0.0.1:6333"

    # 对象存储（简历 PDF）
    minio_endpoint: str = "127.0.0.1:9000"
    minio_access_key: str = "offermind"
    minio_secret_key: str = "offermind-secret"
    minio_bucket: str = "resumes"

    # LLM（OpenAI 兼容端点）。这三项只是 .env 默认值，管理后台可以覆盖成别的服务商，
    # 所以变量名沿用 DEEPSEEK_API_KEY 只是历史包袱，实际可以是任意服务商的密钥。
    llm_model: str = "deepseek-v4-flash"
    llm_base_url: str = "https://opencode.ai/zen/go/v1"
    deepseek_api_key: str = ""  # 对应环境变量 DEEPSEEK_API_KEY
    # 客户端标识：OpenCode Go 这类网关要求客户端用自己的 UA，不能用 SDK / HTTP 库的默认名
    # （用默认名会被判定为非预期流量而拒绝）。要换标识改这里即可。
    llm_user_agent: str = "OfferMind/0.1"

    # 本地部署的 Embedding / Rerank 模型
    embedding_model: str = "BAAI/bge-m3"
    rerank_model: str = "BAAI/bge-reranker-v2-m3"

    # 出题去重：新题与题库中最近似题目的余弦相似度超过该阈值即判为重复
    question_dup_threshold: float = 0.90
    # 判为重复后最多重新生成的次数（含首次），用于兜住延迟
    question_max_attempts: int = 3

    # 认证
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24


settings = Settings()
