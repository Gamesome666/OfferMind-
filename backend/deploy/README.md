# 模型部署

课程主题是「大模型**部署**与微调」。这个目录补的是「部署」那一半 ——
项目原本主生成模型 100% 走云端 API，本地只跑了 BGE-M3 和 bge-reranker 两个**判别**模型。

## 三块拼图

```
                    ┌──────────────────────────────┐
   应用（OfferMind） │  app/agent/llm.py            │
                    │  └ 管理后台可切换端点/模型/密钥  │
                    └──────────────┬───────────────┘
                                   │  OpenAI 兼容协议
                    ┌──────────────▼───────────────┐
                    │  LiteLLM 网关                 │
                    │  · 多部署路由                  │
                    │  · 失败自动回退                │
                    └───────┬──────────────┬───────┘
                            │              │
                 ┌──────────▼───┐   ┌──────▼─────────┐
                 │ 本地 vLLM     │   │ 云端 API        │
                 │ Qwen2.5 (GPU) │   │ deepseek-flash │
                 │ 微调后的小模型 │   │ 能力强、按量计费 │
                 └──────────────┘   └────────────────┘
```

## 一、本地 vLLM

```bash
# Linux / WSL（FP16 基线）
bash deploy/vllm/serve.sh

# 量化版本（显存约 1/3）
bash deploy/vllm/serve.sh awq

# 起微调后的模型
MODEL=finetune/output/qwen2.5-1.5b-grader-merged bash deploy/vllm/serve.sh awq
```

Windows 用 `deploy/vllm/serve.ps1`。

**为什么用 vLLM 而不是 transformers 直接跑**：vLLM 的 PagedAttention + 连续批处理把
吞吐拉高一个数量级，而且 `--enable-prefix-caching` 对评分/面试这种「system prompt +
评分量表前缀固定、只有尾部变化」的负载特别有效 —— 首 token 延迟能降下来。

起好后把管理后台的 **模型端点 Base URL** 改成 `http://127.0.0.1:8001/v1` 就切过去了。
配置是运行时热生效的，**不用改代码、不用重启**。

## 二、LiteLLM 网关

两种形态，按需要选：

| 形态 | 位置 | 配置来源 | 适用 |
|---|---|---|---|
| **进程内 Router**（默认） | `app/agent/gateway.py` | 管理后台，改完即时生效 | 单实例部署，要可观测 |
| Proxy 服务 | `deploy/litellm/config.yaml` | YAML 文件 | 多服务共用，网关独立成容器 |

在管理后台开网关：**模型配置 → 启用 LLM 网关**，然后填部署列表：

```json
[
  {"name": "cloud-deepseek", "model": "openai/deepseek-flash",
   "api_base": "https://opencode.ai/zen/go/v1", "api_key": "oc_sk_..."},
  {"name": "local-qwen", "model": "openai/Qwen2.5-7B-Instruct",
   "api_base": "http://127.0.0.1:8001/v1", "api_key": "EMPTY"}
]
```

回退规则：

```json
{"cloud-deepseek": ["local-qwen"]}
```

含义：云端失败（超时 / 限流 / 5xx）时自动降级到本地，用户不会看到报错。

**网关配置写坏不会拖垮服务**：部署列表解析不出来时静默回落到直连模式，不会因为
少个逗号就把整个系统弄挂。

## 三、量化对比（答辩素材）

同一条命令换 `--label` 跑三次，就是「显存–延迟–质量」三角对比表：

```bash
# 1. 起 FP16
bash deploy/vllm/serve.sh fp16
python scripts/bench_llm.py --base-url http://127.0.0.1:8001/v1 --api-key EMPTY \
    --model Qwen2.5-7B-Instruct --label vllm-fp16

# 2. 换 AWQ 4bit 重起后再跑
bash deploy/vllm/serve.sh awq
python scripts/bench_llm.py --base-url http://127.0.0.1:8001/v1 --api-key EMPTY \
    --model Qwen2.5-7B-Instruct --label vllm-awq

# 3. 云端基线
python scripts/bench_llm.py --label cloud
```

延迟分位数与吞吐落在 `benchmark/<label>.json`，直接进对比表。

**别忘了质量那一维**：量化后的质量用评测脚本量，和延迟放同一张表：

```bash
python scripts/eval_grader.py --gold finetune/data/gold.jsonl --label vllm-awq \
    --base-url http://127.0.0.1:8001/v1 --api-key EMPTY --model Qwen2.5-7B-Instruct
```

## 已实测的云端基线

（prompt 200 字 / max_tokens 64 / 并发 4）

| 指标 | deepseek-flash（云端） |
|---|---|
| 总延迟 P50 | 3741 ms |
| 总延迟 P95 | 5452 ms |
| 总延迟 P99 | 5551 ms |
| 首 token P50 | 2753 ms |
| 吞吐 | 0.89 req/s |
| 错误率 | 0.0% |

这组数字就是本地部署要打的目标：**首 token 延迟**和**单位成本**是本地部署最可能赢的两项。

## 压测脚本的取舍

`scripts/bench_llm.py` 三个设计决定，都是为了让数字可比、可解释：

- **固定 prompt 长度**（`--prompt-chars`）：不同输入长度的延迟没有可比性
- **区分首 token 与总延迟**：首 token 决定体感，总时长决定吞吐，混在一起看不出问题
- **同时报 P50/P95/P99**：只看均值会漏掉排队和限流的尾巴
