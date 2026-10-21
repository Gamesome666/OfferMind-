# OfferMind

> **可观测 Agentic RAG 驱动的 AI 求职面试训练平台**
>
> 大模型部署与微调 · 课程设计 + 竞赛项目 · 计算机方向求职者

给计算机方向求职者提供**四条训练闭环**——定向刷题、简历诊断、模拟面试、能力报告——四条闭环共享一份长期能力画像，全程由**可观测的 Agent 执行面板**贯穿：用户能实时看到 Agent 在检索什么、调用哪个模型、每一步花了多久。

与直接拿通用大模型问问题的关键差别：

| 维度 | 通用大模型 | OfferMind |
|---|---|---|
| 答案 | 凭模型记忆编造 | **有参照**：RAG 检索题库，附来源 |
| 评分 | 一个笼统的分数 | **四维可解释评分**，每维带理由 |
| 过程 | 一个黑盒输入框 | **全链路 SSE 事件**，每步可见耗时 |
| 结果 | 聊完就没了 | **可追溯**：历史快照 + 错题间隔复习 |

---

## 目录

- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [核心机制](#核心机制)
- [离线脚本：微调与部署](#离线脚本微调与部署)
- [文档](#文档)
- [已知问题](#已知问题)

---

## 核心特性

**① 显式建图 + 全链路可观测**

9 张 LangGraph 状态图。每个节点在开始/结束各推一条**同 id** 的事件，前端按 id 原地替换，所以同一步骤始终只占一行，从「进行中」变成「已完成 + 耗时」。

**② 四维可解释评分**

正确性 0.40 / 完整性 0.30 / 表达 0.15 / 术语 0.15，各 0–5 分，**每维必须给出理由**，禁止返回裸分数。

**③ 混合检索**

稠密向量（BGE-M3）+ BM25 稀疏（jieba 分词）+ RRF 名次融合，三种模式后台可切换，可选 bge-reranker-v2-m3 精排。

**④ 运行时热配置**

模型端点 / 模型名 / 温度 / 检索模式 / 网关路由全在管理后台可改，**改完即时生效，无需重启**。新增一个配置项只需改 `app/services/settings_service.py` 的 `SPECS` 登记表，前端表单自动生成。

**⑤ 数据飞轮**

每条评分记录就是一条 SFT 样本。系统的副产品即训练资料——不用另找数据集，用户每做一次评分，数据集就长一条。

**⑥ 问答式模拟面试**

不是「一次性生成 N 轮」，而是真的一问一答：HR 说一句 → 候选人回一句 → HR 接着追问，HR 回复**按 token 逐字流式**出现，想结束时点「总结面试」生成评价与改进建议。

---

## 技术栈

| 层面 | 选型 |
|---|---|
| AI 编排 | Python + **LangGraph**（9 张状态图） |
| RAG | LangChain + **Qdrant**（稠密/稀疏/混合三模式 + RRF 融合） |
| 本地模型 | **BGE-M3**（嵌入，1024 维）+ **bge-reranker-v2-m3**（精排） |
| 生成模型 | 云端 DeepSeek（可经 **LiteLLM 网关**路由到本地 vLLM） |
| 后端 | **FastAPI** + SQLAlchemy 2.0 async + asyncpg |
| 存储 | **PostgreSQL**（事务主数据）+ Qdrant（检索索引） |
| 前端 | **Next.js 15.1** + React 19 + TypeScript（零 UI 库依赖） |
| 部署 | Docker Compose（基础设施）+ vLLM（本地推理） |
| 微调 | LLaMA-Factory + LoRA（Qwen2.5-1.5B） |

---

## 快速开始

### 前置要求

| 项 | 要求 |
|---|---|
| Python | **3.11+**（项目用 conda 环境 `langchain_latest`） |
| Node.js | 支持 Next.js 15 |
| Docker | 起基础设施（Postgres / Redis / Qdrant / MinIO） |
| GPU | 可选。跑本地 BGE-M3 建议有独显；无 GPU 也能跑，只是慢 |

### 六步跑起来

```bash
# ---------- 1. 起基础设施 ----------
cd backend
docker compose up -d
docker compose ps          # 应看到 5 个容器 Up

# ---------- 2. 配置环境变量 ----------
cp .env.example .env
# 编辑 .env，至少填 DEEPSEEK_API_KEY 与 JWT_SECRET

# ---------- 3. 建表与迁移 ----------
python init_db.py          # 应打印「数据库表已创建 / 更新」

# ---------- 4. 题库入库 ----------
python -m app.rag.ingest   # 应打印「题库入库完成，共 12 道题」

# ---------- 5. 启动后端（另开一个终端）----------
uvicorn app.main:app --reload
# 启动后约 25 秒，日志出现两条「模型预热完成」

# ---------- 6. 启动前端（再开一个终端）----------
cd frontend
npm install
npm run dev                # 3000 端口
```

然后：

- 打开 <http://127.0.0.1:3000> 注册账号
- **建第一个管理员**：后端终端执行 `python promote_admin.py <你的邮箱>`，之后侧栏才会出现「管理后台」入口

> ⚠️ **管理员只能从命令行给**。管理后台需要管理员权限才能进，第一个管理员否则就成「鸡生蛋」了。

### 端口一览

| 服务 | 端口 |
|---|---|
| 前端 | 3000 |
| 后端 | 8000 |
| PostgreSQL | 5432 |
| Qdrant | 6333（HTTP）/ 6334（gRPC） |
| Redis | 6379（已编排未接入） |
| MinIO | 9000（API）/ 9001（控制台） |
| Adminer | 8080 |
| vLLM（本地推理） | 8001 |

### 两个新手最容易踩的坑

| 坑 | 说明 |
|---|---|
| **必须用 `127.0.0.1` 而不是 `localhost`** | Windows 下 `localhost` 会优先解析到 IPv6 的 `::1`，而 Docker 只映射了 IPv4，连 `::1` 会静默超时 20 秒以上 |
| **前后端分别在不同终端启** | 后端 `uvicorn`、前端 `npm run dev`，不要混在一个终端 |

### 依赖安装

后端依赖声明在 `backend/pyproject.toml`：

```bash
cd backend
pip install -e ".[dev]"
```

但 **`pyproject.toml` 漏声明了 4 个运行时实际用到的包**（见[已知问题](#已知问题)），首次跑通需手动补装：

```bash
pip install sentence-transformers FlagEmbedding jieba rank_bm25
```

---

## 项目结构

```
backend/                    FastAPI + LangGraph 后端
├── app/core/               config / database / security(JWT+bcrypt)
├── app/models/             11 张表
├── app/schemas/            请求/响应模型
├── app/repositories/       数据访问（按 user_id 隔离）
├── app/services/           业务服务（PDF 解析、运行时配置）
├── app/rag/                embeddings / reranker / vectorstore / bm25 / ingest
├── app/agent/              llm / prompts / tools / state / graph / gateway
├── app/api/v1/             health / auth / training / answers / resume
│                           / interview / report / history / admin
├── scripts/                bench_llm / export_sft_dataset / eval_grader
├── deploy/                 vLLM 启动脚本 + LiteLLM Proxy 配置
├── finetune/               LoRA 训练配置 + 数据集 + 评测
├── init_db.py              建表与幂等迁移
└── promote_admin.py        提升管理员

frontend/                   Next.js 15 + React 19 + TypeScript
├── app/(landing)/          落地页（含 canvas 星图，不套外壳）
├── app/login/              登录注册（不套外壳）
├── app/(app)/              登录后外壳（Rail 侧栏 + 鉴权门）
│                           / dashboard / practice / wrongbook / resume
│                           / interview / report / admin{,/questions,/config,/api}
├── app/bigscreen/          数据大屏（1920×1080 固定画布，不套外壳）
├── components/             Rail / TracePanel / Radar / Rubric / Seg / Modal ...
├── lib/                    api(SSE 解析) / agentRun / auth / pageState / history
└── scripts/                scope_css.py（设计稿 CSS → 作用域 CSS）

docs/                       技术方案文档（18 篇，见下方文档地图）
```

---

## 核心机制

### SSE 流式事件协议

所有 Agent 执行都走 SSE。事件统一五字段：

```json
{ "id": "grade", "type": "node", "status": "running|done", "payload": {}, "duration_ms": 1234 }
```

前端按 `id` **原地替换**同一步骤。共 9 个流式端点：

```
POST /api/v1/training/{question,grade,followup}/stream
POST /api/v1/resume/{parse,diagnose}/stream
POST /api/v1/interview/{question,report,chat}/stream
POST /api/v1/report/training/stream
```

`/interview/chat/stream` 额外推两类对话事件：`token`（文本分片）与 `hr_message`（一整句说完），前端把 token 拼成气泡。

### 结构化输出的可靠性

一律走 `response_format=json_object`，**不用 function calling**。DeepSeek 在工具调用模式下不保证 arguments 是合法 JSON——模型只要在字符串里写了未转义的引号，整段 JSON 就废掉（实测约三成概率，报告类长文本尤其容易触发）。json_object 由服务端约束解码，必然返回合法 JSON，再由 Pydantic 校验字段。

### 错题本与间隔重复

完整 SM-2 算法，ease 动态调整间隔。**毕业规则**：连续答对 2 次才移出错题本——不要改成「答对一次就移出」，待复习队列是按 `is_wrong` 过滤的，那样刚排的复习计划永远不会触发。

### 页面状态保持与历史恢复

`lib/pageState.ts` 的 `usePageState(key, initial)` 把状态挂在模块级 Map 上并镜像到 `sessionStorage`，Next.js App Router 切路由卸载组件时内容不丢，刷新也在。

历史记录按模块（practice / resume / interview / report）存快照，点一条即把现场灌回对应页面并跳转，不用重跑模型。接口全部强制 `user_id` 过滤，跨用户访问返回 **404**（不是 403，避免泄露记录是否存在）。

### 前端样式作用域

静态设计稿每页是独立文档，样式天然隔离；Next 客户端路由下 CSS 一旦加载就常驻，多页同名选择器（`.side` / `.card`）会互相覆盖。

解法：每页内容包一层 `data-page="X"`，该页私有样式全部加 `[data-page="X"] ` 前缀；页面 CSS 由 `frontend/scripts/scope_css.py <设计稿> <页面名> <输出>` 生成，JSX 里的类名一个字不改。弹层用 `createPortal` 挂到 `<body>`，跑出了包裹层，所以页面还要调 `usePageScope("X")` 把 `data-page` 镜像到 `body`。

---

## 离线脚本：微调与部署

课程主题是「大模型**部署**与微调」，这两块都有完整脚本，**离线跑，不进服务进程**。

### 微调（评分器 LoRA）

数据不用另找——系统每次评分都往 `answers` 表写 `(题目, 参考答案, 作答, 四维评分)`，就是一条 SFT 样本。

```bash
cd backend

# 1. 看攒了多少样本
python scripts/export_sft_dataset.py --stats-only

# 2. 导出 SFT 数据集（打印总分分布，全挤中档说明没区分度）
python scripts/export_sft_dataset.py --drop-degenerate

# 3. 抽 50 条生成待标注模板，然后人工填 gold.jsonl
python scripts/eval_grader.py --make-template 50

# 4. 测「微调前」基线（默认测数据库里配置的线上模型，不是 .env）
python scripts/eval_grader.py --gold finetune/data/gold.jsonl --label before

# 5. 训练
pip install llamafactory
llamafactory-cli train finetune/train_lora.yaml

# 6. 合并导出 + 起本地服务
llamafactory-cli export finetune/train_lora.yaml \
  --export_dir finetune/output/qwen2.5-1.5b-grader-merged
vllm serve finetune/output/qwen2.5-1.5b-grader-merged --port 8001

# 7. 测「微调后」并出对比表
python scripts/eval_grader.py --gold finetune/data/gold.jsonl --label after \
    --model finetune/output/qwen2.5-1.5b-grader-merged \
    --base-url http://127.0.0.1:8001/v1 --api-key EMPTY
python scripts/eval_grader.py --compare finetune/eval/before.json finetune/eval/after.json
```

prompt 与线上逐字一致（直接复用 `app.agent.prompts.GRADE_TEMPLATE`），避免训推不一致。评测默认**不走向量检索**——那是另一个变量，掺进来就分不清差异是模型带来的还是检索带来的。

### 部署（vLLM + LiteLLM 网关）

```bash
# 起本地 vLLM（FP16 基线 / awq / gptq 三档）
bash deploy/vllm/serve.sh fp16      # Windows 用 serve.ps1
bash deploy/vllm/serve.sh awq       # 量化版，显存约 1/3

# 压测：P50/P95/P99 + 吞吐 + 首 token 延迟
python scripts/bench_llm.py --base-url http://127.0.0.1:8001/v1 --api-key EMPTY \
    --model Qwen2.5-7B-Instruct --label vllm-awq
```

起好后把管理后台的 **Base URL** 改成 `http://127.0.0.1:8001/v1` 就切过去了，**不用改代码、不用重启**。

网关有两种形态：**进程内 Router**（`app/agent/gateway.py`，默认，管理后台配置，改完即时生效）与 **Proxy 服务**（`deploy/litellm/config.yaml`）。云端失败时按配置的 fallback 链自动降级；**网关配置写坏不会拖垮服务**——部署列表解析不出来时静默回落到直连。

**已实测的云端基线**（prompt 200 字 / max_tokens 64 / 并发 4）：

| 指标 | deepseek-flash（云端） |
|---|---|
| 总延迟 P50 | 3741 ms |
| 总延迟 P95 | 5452 ms |
| 总延迟 P99 | 5551 ms |
| 首 token P50 | 2753 ms |
| 吞吐 | 0.89 req/s |
| 错误率 | 0.0% |

这组数字就是本地部署要打的目标：**首 token 延迟**和**单位成本**是本地部署最可能赢的两项。

> ⚠️ vLLM 与 LLaMA-Factory 建议装**独立 conda 环境**——它们会引入自己的 `transformers` / `torch` 版本约束，装进主环境可能与 BGE-M3 的 `sentence-transformers`（依赖 `transformers 4.x`）冲突。

---

## 文档

完整技术方案在 [`docs/`](docs/README.md)，18 篇：

| 文档 | 回答什么问题 |
|---|---|
| [00-项目概述](./docs/00-项目概述.md) | 为什么做、做了什么、做到哪一步了 |
| [01-需求分析](./docs/01-需求分析.md) | FR-A~G 的完整清单 + 实现状态 |
| [02-总体架构设计](./docs/02-总体架构设计.md) | 分层架构、部署架构、三条关键数据流、ADR |
| [03-技术选型与论证](./docs/03-技术选型与论证.md) | 每项选型的**备选对比与取舍理由** |
| [04-数据模型设计](./docs/04-数据模型设计.md) | 11 张表 ER 图 + 字段 + 隔离与迁移策略 |
| [05-Agentic-RAG设计](./docs/05-Agentic-RAG设计.md) | 检索链路、9 张图、State、结构化输出可靠性 |
| [06-可观测设计](./docs/06-可观测设计.md) | SSE 事件协议、双流分工、前端状态机 |
| [07-核心业务模块设计](./docs/07-核心业务模块设计.md) | 七个模块的流程与关键决策 |
| [08-接口设计](./docs/08-接口设计.md) | 端点清单 + SSE 契约 + 鉴权 + 错误码 |
| [09-模型微调方案](./docs/09-模型微调方案.md) | 数据飞轮、LoRA 配置、评测口径 |
| [10-模型部署与网关](./docs/10-模型部署与网关.md) | 进程内网关、vLLM 方案、压测方法学与实测数据 |
| [11-工程实践与踩坑记录](./docs/11-工程实践与踩坑记录.md) | 9 个坑的**现象 → 根因 → 解法 → 防回归** |
| [12-测试与验收](./docs/12-测试与验收.md) | 端到端验收清单 + 已有验证证据 |
| [13-设计边界与演进规划](./docs/13-设计边界与演进规划.md) | 设计边界 + PRD 规划 vs 实现对照 + 路线图 |
| [14-附录](./docs/14-附录.md) | 术语表、环境搭建、配置清单、目录结构 |
| [16-管理端ReAct助手方案](./docs/16-管理端ReAct助手方案.md) | 写操作「拟→批→行」闸门方案 |
| [答辩PPT大纲](./docs/答辩PPT大纲.md) | 18 页 PPT 提纲：标题 + 要点 + 配图 + 讲稿提示 |

**按读者选路径：**

| 你是 | 从这里开始 |
|---|---|
| **评委 / 评审** | 00 → 02 → 05 / 09 / 10 → 13 |
| **接手开发的工程师** | 02 → 04 → 05 / 06 → 08 → 11 |
| **想把系统跑起来** | [14-附录 §2 环境搭建](./docs/14-附录.md) |
| **关心实验数据** | [10 §5.5 实测数据](./docs/10-模型部署与网关.md) |
| **准备答辩** | [答辩PPT大纲](./docs/答辩PPT大纲.md) |

**其他文档：**

| 文档 | 内容 |
|---|---|
| [`PRD-ai-interview-platform.html`](./PRD-ai-interview-platform.html) | 产品需求文档 v0.9，13 章——需求的权威来源 |
| [`课程设计选题报告.md`](./课程设计选题报告.md) | 选题答辩材料 |
| [`CLAUDE.md`](./CLAUDE.md) | AI 协作指引 |
| [`docs/微调与部署入门指南.md`](./docs/微调与部署入门指南.md) | 微调/部署的科普版说明 |
| [`backend/deploy/README.md`](./backend/deploy/README.md) | 模型部署详解 |
| [`backend/finetune/README.md`](./backend/finetune/README.md) | 评分器微调详解 |

---

## 实现状态

### ✅ 已完成并验证

认证与隔离 · 刷题闭环 · RAG 混合检索 · 错题本 SM-2 · 简历诊断 · 问答式模拟面试 · 能力报告 · 全链路可观测 · 历史记录与页面状态保持 · 管理后台（用户/题库/运行时配置）· LiteLLM 网关与回退 · 压测方法学

### ⏳ 已实现待实测

| 项 | 现状 |
|---|---|
| **微调链路** | 导出/评测/LoRA 配置全部完成；**数据集未导出、人工标注仅 2 条、LoRA 未训练、无对比数据** |
| **本地 vLLM 部署** | 启动脚本（三档量化）与压测脚本就绪；**从未在真实 GPU 上起过服务，无本地实测数据** |

### 📋 规划中

Langfuse 轨迹归档 + 成本看板 · 画像自动更新并注入 Agent · RAG 面经企业库 · 补纯函数单测与 CI · 管理端 ReAct 智能助手 · 混合检索模式后台化

完整路线图见 [13-设计边界与演进规划.md](./docs/13-设计边界与演进规划.md)。

---

## 已知问题

诚实起见，以下是当前代码里真实存在的缺口：

| 问题 | 影响 | 说明 |
|---|---|---|
| **`pyproject.toml` 漏声明 4 个运行时依赖** | 按文档装环境会失败 | `sentence-transformers`、`FlagEmbedding`、`jieba`、`rank_bm25` 都在代码里实际使用，但未写进依赖列表，需手动补装 |
| **`admin.py` 有重复路由** | `/api/v1/admin/llm/options` 的第一处定义（行 229）会吃掉请求 | 行 297 的第二处定义是死代码，永远不会被执行 |
| **无自动化测试** | 回归靠手工验证 | `backend/` 与 `frontend/` 下都没有 tests 目录；SM-2、RRF、网关解析等 6 个高风险纯函数缺单测 |
| **`Redis` / `MinIO` 依赖未真正接入** | 声明了但没用上 | `pyproject.toml` 装了、`docker-compose.yml` 编排了，但应用层没有实际读写 |
| **`CLAUDE.md` 与代码有出入** | 协作时可能误导 | 例如把已实现的混合检索列为待办、把图的数量写成 8 张。**技术事实以代码与 `docs/` 为准** |

关于数据可信度：项目中**唯一真实的性能数据**是 `backend/benchmark/cloud-test.json`（云端压测，8 请求 / 并发 4）。`backend/finetune/eval/test_before.json` 与 `test_after.json` 是演示 `--compare` 输出格式的**占位产物，不是实测结果**——其中 `test_after.json` 的指标与自身数据在数学上不自洽。申报材料里引用的每个数字都应可追溯到原始产物文件。

---

## 安全提醒

- `backend/.env` 含真实 API 密钥明文。`.gitignore` 已排除它，但工作区里是明文——**截图、录屏、答辩演示前务必脱敏**
- 文档与示例中一律使用 `oc_sk_xxxxxxxxxxxxxxxx` 这类占位符
- 所有用户数据强制 `user_id` 过滤；跨用户访问返回 404
- JWT 密钥生产环境必须改掉默认值 `change-me`

---

## 致谢与分工

课程设计项目 · 团队成员：马乾恩、蒋志敏、李贤星

技术栈经团队明确拍板：Python + LangGraph 编排、LangChain + Qdrant 检索、FastAPI 后端、Next.js 前端、PostgreSQL + Redis + MinIO 存储、Docker Compose → K8s 部署、LoRA 微调 + vLLM 推理。
