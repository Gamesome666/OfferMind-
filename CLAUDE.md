# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

OfferMind —— 可观测 Agentic RAG 驱动的 AI 求职面试训练平台。这是「大模型部署与微调」课程的课程设计 + 竞赛项目，面向计算机方向求职者，提供 AI 定向刷题评测、AI 简历优化、AI 模拟面试的一站式系统。

**当前状态：后端 + 前端全链路已实现并移植到 Next.js（13 个页面），`next build` 通过。**
刷题 / 错题本 / 简历 / 面试 / 报告五条链路已用真数据端到端验证过；管理后台四页与数据大屏
目前只过了构建与类型检查，浏览器实测待补。技术方案与架构见下方文档。

## 项目结构

```
backend/                    FastAPI + LangGraph 后端
├── app/core/               config / database / security(JWT+bcrypt)
├── app/models/             11 张表：User Question Answer TrainingSession
│                           ToolTrace Resume InterviewSession InterviewMessage
│                           SkillProfile HistoryRecord SystemConfig
├── app/schemas/            请求/响应模型
├── app/repositories/       数据访问（按 user_id 隔离）
├── app/services/           业务服务（PDF 解析、运行时配置 settings_service）
├── app/rag/                embeddings(BGE-M3) / reranker / vectorstore(Qdrant)
│                           / seed_data / ingest
├── app/agent/              llm / prompts / tools / state / graph(LangGraph×8)
│                           / interview_chat(面试对话) / service
└── app/api/               sse.py（SSE 响应封装）+ v1/ health / auth / training
                            / resume / interview / report / history / admin

frontend/                   Next.js 15 + React 19 + TypeScript（无额外 UI 依赖）
├── app/(landing)/          落地页 /（含 canvas 星图，不套外壳）
├── app/login/              登录注册（不套外壳）
├── app/(app)/              登录后外壳（Rail 侧栏 + 鉴权门）：
│                           dashboard / practice / wrongbook / resume
│                           / interview / report / admin{,/questions,/config,/api}
├── app/bigscreen/          数据大屏（1920×1080 固定画布，不套外壳）
├── components/             Rail（侧栏）、TracePanel（执行面板）、Radar / Rubric / Seg
│                           / Modal / ToastProvider / ConfirmProvider
├── lib/                    api.ts（含 SSE 流式解析）、agentRun.ts（执行面板状态机）
│                           auth.tsx、pageState.ts（页面状态保持 + 历史恢复）
│                           history.tsx、pageScope.ts、format.ts
├── scripts/                scope_css.py（设计稿 CSS → 作用域 CSS）、extract_landing_js.py
└── public/design/          原始静态设计稿（13 页 HTML），仅作视觉回退参考，不再对外服务
```

### 样式作用域（改前端样式前必读）

静态设计稿每页是独立文档，样式天然隔离；Next 客户端路由下 CSS 一旦加载就常驻，
多页同名选择器（`.side` / `.card` / `.row-item`）会互相覆盖。

- **解法**：每页内容包一层 `data-page="X"`，该页私有样式全部加 `[data-page="X"] ` 前缀。
  页面 CSS 由 `scripts/scope_css.py <设计稿> <页面名> <输出>` 生成，JSX 里的类名一个字不改。
- **弹层要挂到 body**：`Modal` 用 `createPortal` 渲染到 `<body>`，跑出了 `data-page` 包裹层。
  所以页面还要调 `usePageScope("X")`（`lib/pageScope.ts`）把 `data-page` 镜像到 `body` 上，
  否则弹层里的样式全部匹配不到。
- **⚠ 这个脚本是整份覆盖**，页面 CSS 里手工修订过的部分会被冲掉。已知两处：
  `login.css` 的 `@keyframes slidein → login-slidein`、`landing.css` 的 `rise → landing-rise`
  —— 关键帧名**不参与** `[data-page]` 作用域，与 `tokens.css` 的同名 keyframes 会互相覆盖。
  改这两页前先看文件头注释。
- **不要用 CSS Modules**：设计稿里有 `.trace-row .kind.模型` 这类 CJK 类选择器，Modules 处理不了。

## 历史记录与页面状态保持

**历史记录**：工作台（`app/(app)/dashboard/page.tsx` 的「最近交互」卡片）按时间列出每个模块的
历史交互，点一条即把该次交互的快照灌回对应页面并跳转，不用重跑模型。

- 数据模型 `HistoryRecord`：`(user_id, module, title, snapshot_json, session_id)`，
  `module` ∈ practice / resume / interview / report。`snapshot_json` 存恢复现场所需的**全部页面状态**。
- **快照字段名必须与前端页面状态对象的字段名一致** —— 恢复时是整块覆盖，key 对不上就恢复不出来。
- 写入口有两处：前端在拿到结果后 POST `/history`（刷题评分、简历诊断、训练报告）；
  面试是后端在「总结面试」时写入（因为会话与消息都在服务端）。
  面试的 snapshot key 是后端定的（`sessionId` / `direction` / `messages` / `report` …），
  改前端字段名时要同步改 `app/agent/service.py` 的 summarize 分支。
- 接口：`POST /history`、`GET /history?module=`、`GET /history/{id}`、`DELETE /history/{id}`，
  全部强制 `user_id` 过滤；跨用户访问返回 **404**（不是 403，避免泄露记录是否存在）。

**页面状态保持**：`lib/pageState.ts` 的 `usePageState(key, initial)` 是与 `useState` 同形态的钩子，
状态挂在模块级 Map 上并镜像到 `sessionStorage`。Next.js App Router 切路由会卸载页面组件、
丢掉 `useState`，这个钩子保证「切走再回来内容还在」，刷新也不丢（仅当前标签页）。
`useAgentRun(key)` 也接了同一套，所以执行面板的轨迹一起保留。

**历史恢复靠 `useSnapshot(key, snapshot, apply)`**（同文件的钩子，页面自己的 useState 仍照常写）：
它把零散 state 组装成的快照与页面状态 key 双向绑定 —— 挂载时若有快照就灌一次、页面内状态变化时写回。
两个坑：

- `snapshot` 必须 `useMemo` 出来。否则每次渲染都写一次 sessionStorage，面试页按 token 流式渲染时
  会变成每个 token 写一次。
- 挂载后**必须跳过第一轮回写**。顺序是「① 灌快照 → ② 回写效应把尚未更新的初始快照写回同一个 key」，
  而 React StrictMode 开发模式下会挂载两次，第二次读到的就是 ② 写坏的空快照，恢复出来的现场又被清空。

## 模拟面试（一问一答对话）

面试不是「一次性生成 N 轮」，而是像聊天一样一问一答：HR 说一句 → 候选人回一句 → HR 接着追问，
想结束时点「总结面试」，后端拿整场对话生成评价与改进建议。

- 前端 `app/(app)/interview/page.tsx` 是气泡式对话界面；HR 的回复**按 token 流式**逐字出现。
- 后端 `app/agent/interview_chat.py` 是对话生成器（不是 StateGraph）：除了一般的步骤事件，
  还推两类对话事件 —— `token`（文本分片）与 `hr_message`（一整句说完）。前端把 token 拼成气泡。
  `useAgentRun` 里 `CHAT_EVENTS` 集合保证这些事件不会混进执行面板，而是走 `onEvent` 回调。
- 会话与消息落库：`InterviewSession`（config / report / status）+ `InterviewMessage`（role / content）。
  一问一答单独建表而不是塞 JSON 字段，是为了读某场面试的对话时不必反序列化整块大 JSON。
- 端点：`POST /interview/chat/stream`（`session_id` 为空=开新面试；`message` 非空=发言；
  `summarize=true`=总结）、`GET /interview/sessions`、`GET /interview/sessions/{id}`。

## 管理后台

前端 `app/(app)/admin/page.tsx`（侧栏入口只对 `user.is_admin` 显示），后端 `app/api/v1/admin.py`
全部挂在 `get_current_admin` 之下，非管理员一律 403。

- **用户管理**：列表 / 搜索 / 设或取消管理员 / 重置密码 / 删除。不能取消或删除自己（后端拦截）。
- **题库管理**：分页 + 关键词 + 方向筛选；新建 / 编辑 / 删除会**同步 Qdrant**
  （`vectorstore.upsert_question` / `delete_question`），否则检索会命中已删的旧题。
- **模型与检索配置**：`SystemConfig` 是 key-value 表，登记表在 `app/services/settings_service.py`
  的 `SPECS`（新增配置项只改这里）。默认值来自 `.env`，**库里只存「覆盖」**，所以 .env 仍是唯一事实来源。
- 配置通过 `get_runtime` 依赖注入进 LangGraph state（`state.llm_model` / `temperature` / `top_k` /
  `use_rerank` / `dup_threshold`），节点每次执行读一次，**改完即时生效，无需重启**。
  读路径带进程内缓存，管理员改配置时 `config_repo.set/delete` 会让缓存失效。

## 错题本与间隔重复

评分结果落进 `answers` 表（`app/repositories/answer.py`），这张表同时供两条链路使用：
错题本（SM-2 复习排期）与 **LoRA 微调数据集**（`(题目, 作答, 四维评分)` 就是一条 SFT 样本）。

- 端点：`GET /answers`（可按 `only_wrong` / `only_favorite` 过滤）、`GET /answers/stats`、
  `GET /answers/due`（到期待复习）、`PATCH /answers/{id}`（改错题/收藏）、
  `POST /answers/{id}/review`（复习一次，按 SM-2 重排）。
- **SM-2 的 quality 直接取四维加权总分四舍五入** —— 评分量表本身就是 0-5，天然对齐，不用另做映射。
- **毕业规则**：连续答对 `MASTERED_REVIEWS`(=2) 次才移出错题本。**不要改成「答对一次就移出」** ——
  待复习队列是按 `is_wrong` 过滤的，那样刚排的复习计划永远不会触发（这个 bug 犯过一次）。
- 评分要落库必须带 `question_id`（出题结果里回传，前端评分时带回）。缺失时不落库 ——
  宁可不记录，也不要挂到错的题上。

## 模型部署与网关

「部署」与「微调」是课程主题，也是项目原本的两块空白（主生成模型 100% 走云端）。
补齐后的结构见 `backend/deploy/README.md` 与 `backend/finetune/README.md`。

- **vLLM 本地部署**：`deploy/vllm/serve.{sh,ps1}`，支持 fp16 / awq / gptq 三档。
  起好后把管理后台的 Base URL 指向 `http://127.0.0.1:8001/v1` 即可切换，**不用改代码不用重启**。
- **LiteLLM 网关**：`app/agent/gateway.py` 是**进程内 Router**（默认关），配置来自管理后台
  （`llm_gateway_enabled` / `_deployments` / `_primary` / `_fallbacks`），改完即时生效。
  另有等价的 Proxy 服务形态配置 `deploy/litellm/config.yaml`。
- **LiteLLM 是原生 SDK，不是 langchain 组件**，所以 `gateway.py` 里写了薄适配器
  `LiteLLMChat`，只对齐我们真正用到的 `bind()` / `invoke()` / `astream()` 三个方法，
  这样上层 `JsonSchemaLLM` 一行都不用改。
- **网关配置写坏不会拖垮服务**：部署列表解析不出来时静默回落直连。
- **压测**：`scripts/bench_llm.py` 产出 P50/P95/P99 与吞吐，固定 prompt 长度保证可比，
  区分首 token 与总延迟。已实测云端基线：P50 3.7s / P99 5.6s / 0.89 req/s。

## 评分器微调

`finetune/` 下是完整的 LoRA 微调链路，数据来自系统自身产出的评分记录（数据飞轮）。

- `scripts/export_sft_dataset.py` 导出 LLaMA-Factory alpaca 格式数据集。
  **prompt 必须与线上逐字一致**（直接复用 `prompts.GRADE_TEMPLATE`），否则训推不一致；
  导出时会打印总分分布，**分布全挤在中档说明数据没区分度**，微调学不出东西。
- `scripts/eval_grader.py` 是「微调前 vs 微调后」对比表的产出工具，指标 = 一致率（±1 分内算一致）+ MAE。
  **默认读数据库的运行时配置而不是 .env** —— 管理员改过模型的话 .env 是过期的，拿它评测等于测了另一个模型。
  评测默认不走向量检索，隔离出「模型」这一个变量。

## 可观测（SSE 流式）约定

**所有模块的 Agent 执行都走 SSE 流式**，前端逐步显示每一步的状态，不是等跑完一次性出结果。

- 每个节点在开始/结束各推一条**同 id** 的事件：`{id, type, status: running|done, payload, duration_ms}`。
  前端按 id **原地替换**，所以同一步骤始终只占一行，从「进行中」变成「已完成 + 耗时」。
- 后端统一用 `app/api/sse.py` 的 `sse_response()` 包装；节点用 `langgraph.config.get_stream_writer()`
  在 `_start()` / `_finish()`（见 `app/agent/graph.py`）里推事件，`service._stream()` 同时订阅
  `["custom", "updates"]` 两种流。
- 前端统一用 `lib/agentRun.ts` 的 `useAgentRun()`；它按「运行序号 + 节点 id」合并，
  所以同一页面多次执行（如模拟面试的多轮）不会互相覆盖轨迹。
- 流式端点（9 个）：`/training/{question,grade,followup}/stream`、`/resume/{parse,diagnose}/stream`、
  `/interview/{question,report,chat}/stream`、`/report/training/stream`。非流式版本保留给 curl/测试用。
  其中 `/interview/chat/stream` 除了步骤事件还推 `token` 对话分片（见「模拟面试」一节）。
- **结构化输出走 `response_format=json_object`，不用 function calling**（见 `app/agent/llm.py`
  的 `JsonSchemaLLM`）：DeepSeek 在工具调用模式下**不保证** arguments 是合法 JSON ——
  模型只要在字符串里写了未转义的引号（如 `"采用"总分总"结构"`），整段 JSON 就废掉，
  langchain 拿到 `None`，上层报 `'NoneType' object has no attribute 'model_dump'`
  （实测约三成概率，报告类长文本尤其容易触发）。json_object 由服务端约束解码，
  必然返回合法 JSON，再由 Pydantic 校验字段。注意 json_object 要求 prompt 里出现
  "json"，所以 `JsonSchemaLLM` 会把 schema 的格式说明作为最后一条消息追加进去。

环境：conda 环境 `langchain_latest`（Python 3.11）。前端用 `npm run dev`（3000 端口），
后端 `uvicorn app.main:app --reload`（8000 端口）。前端**直连**后端（`frontend/.env.local`
的 `NEXT_PUBLIC_API_BASE`），跨域由后端 CORSMiddleware 放行 —— 不用 next.config 的 rewrites
代理，因为 Next 的 rewrite 会把整个 SSE 响应缓冲到请求结束，执行面板就拿不到逐步的实时事件。

后端启动时会在**后台线程预热** BGE-M3 与 bge-reranker-v2-m3（各跑一次真实推理，合计约 25 秒），
所以启动不会被阻塞，但 `--reload` 下每次改代码重启都会重新预热一轮。

模型单例与加载都加了锁（`app/rag/embeddings.py` / `reranker.py`）：预热线程和第一个真实请求
会同时进 `_load()`，不加锁两边都会构造一份模型，并发构造同一个 HF 模型会得到半初始化实例，
之后所有调用都报 `Cannot copy out of meta tensor; no data!`，而且坏实例被缓存后永久生效。

**建表 / 改表**：`python init_db.py`。`Base.metadata.create_all` 只建缺失的表，不会给已有表加列，
所以新增列（如 `users.is_admin`）和放宽约束（`interview_sessions.rounds_json`）写在 `init_db.py`
的迁移列表里，幂等，可重复执行。

**第一个管理员**：`python promote_admin.py <邮箱>`。管理后台需要管理员权限才能进，
第一个管理员只能从命令行给，否则是「鸡生蛋」。

## 权威文档

开工前先读这三份，避免重复决策或偏离既定方案：

- `PRD-ai-interview-platform.html` — 完整产品需求文档 v0.9，需求的权威来源。13 章：功能需求（FR-A~G）、AI Agent 设计（编排/工具集/记忆/评分量表）、RAG 与向量库落点、技术架构、数据模型、验收标准。
- `课程设计选题报告.md` — 选题答辩材料（题目名称、选题来源与佐证、简介、解决思路）。
- `马乾恩 蒋志敏 李贤星 OfferMind —— 可观测 Agentic RAG 驱动的AI 求职面试训练平台项目选题报告.docx` — 上述选题报告的 Word 排版版本。

## 已确定的技术栈

技术栈经用户明确拍板，不要再建议替换（尤其不要再提 Spring Boot / Java，用户已确认放弃该路线）：

- **AI 编排**：Python + LangGraph（ReAct 循环、checkpoint、流式事件）
- **RAG**：LangChain（vectorstore + retriever + LCEL）；向量库 Qdrant（MVP）→ Milvus（规模化）
- **后端**：FastAPI；LLM 网关 LiteLLM
- **模型**：Embedding BGE-M3 + Rerank bge-reranker-v2-m3（本地部署）；主生成模型经 LiteLLM 接入 DeepSeek / Qwen / Claude 等
- **存储**：PostgreSQL（事务）+ Redis（缓存/会话/短记忆）+ MinIO（简历 PDF）
- **异步任务**：ARQ + Redis；**可观测**：Langfuse + OpenTelemetry
- **前端**：React + Next.js + TypeScript
- **部署**：Docker Compose → K8s

## 核心架构决策

- **模块化单体起步**：MVP 用单进程 FastAPI 按领域分包，不提前拆微服务。
- **Agentic RAG 为核心**：LangGraph 编排器显式建图（而非黑盒框架），让用户实时看到 Agent 的工具/记忆/向量检索调用——这是产品差异化卖点（PRD 的 FR-F）。
- **三个 RAG 知识库**：题库库（出题/评分参照）、面经企业库（模拟面试真实性）、用户简历库（按 user_id 隔离）。
- **向量库边界**：向量库只存可检索文本片段 + 元数据，不替代事务数据；答案/评分/画像/报告在 PostgreSQL，用 chunk_id 关联。
- **可解释评分**：四维 rubric（正确性 0.40 / 完整性 0.30 / 表达 0.15 / 术语 0.15，各 0–5 分），结构化 JSON 输出，禁止裸分数。

## 协作偏好

- 所有回复、代码注释、错误提示均使用中文。
- 讲解代码时倾向逐行拆解 + 类比 + 表格（见用户全局记忆 `code_explanation_style.md`）。

## 实现计划

总目标：交付 P0 MVP（可内测的核心闭环），对应 PRD 第 11 章 P0 里程碑。里程碑顺序遵循 PRD 建议：认证 → 题库 RAG → Agent → 可观测 → 简历 → 面试 → 报告。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 项目骨架 | FastAPI 目录结构、配置、依赖、Docker Compose、健康检查 | 已完成 |
| M1 数据模型 + 认证 | SQLAlchemy 模型、JWT、多租户数据隔离 | 已完成 |
| M2 RAG 检索闭环 | Qdrant + BGE-M3，题库知识库入库与检索 | 已完成 |
| M3 出题/评分/追问 Agent | LangGraph 编排、工具注册表、四维评分、追问 | 已完成 |
| M4 执行面板可观测 | SSE 流式 step event | 已完成 |
| M5 简历解析 + 诊断 | PDF 解析、JD 匹配、优化建议 | 已完成 |
| M6 模拟面试 | 基于简历深挖提问、实时评分、面试报告 | 已完成 |
| M7 训练报告 + 能力画像 | 报告生成、画像更新、雷达数据 | 已完成 |
| F1 前端 | 设计稿重写进 Next.js 15（13 页）+ Rail / TracePanel / Radar 等组件 | 已完成 |
| M8 历史记录 + 页面状态保持 | HistoryRecord、工作台历史卡片、usePageState / useSnapshot 跨路由保状态 | 已完成 |
| M9 问答式模拟面试 | 一问一答对话、HR 按 token 流式、总结出评价与建议 | 已完成 |
| M10 管理后台 | 用户管理、题库增删改查（同步向量库）、模型与检索配置、接口调试台 | 已完成 |
| F2 数据大屏 | /bigscreen 1920×1080 固定画布，答辩演示用作战室 | 已完成 |
| E1 端到端联调 | 起基础设施、建表、题库入库、全链路验证 | 进行中（五条业务链路已验证，管理端与大屏待实测） |

## 待完善规划（P0 / P1 / P2）

MVP 闭环之外的已知缺口与增强项，分三块：课程主题补全（微调 / 部署）、RAG 增强、功能缺口。
E1 联调完成后按下面的总优先级推进。

### 总优先级

| # | 项 | 为什么排这里 | 优先级 |
|---|---|---|---|
| 1 | 评分器 LoRA 微调 + 前后对比评测集 | ✅ **代码件已完成**（导出+评测+LLaMA-Factory 配置），待跑训练 | P0 |
| 2 | vLLM 本地部署 + LiteLLM 网关路由 | ✅ **已完成并验证**（网关进程内运行、回退实测通过、压测出数），待有 GPU 跑 vLLM | P0 |
| 3 | 错题本 + 间隔重复 | ✅ **已完成并验证**（后端 SM-2 + 前端页面全通） | P1 |
| 4 | RAG 面经企业库 | PRD 规划的第三个知识库，落地后「模拟面试」真实性上一个台阶 | P1 |
| 5 | Langfuse 轨迹归档 | 依赖已装未用；把 step event 从「刷新即丢」变成可回看的轨迹 + 成本看板 | P1 |
| 6 | 管理端检索模式管理（混合检索等） | 把检索策略做成后台可切换，能演示「同一问题、不同召回策略」的对比 | P2 |
| 7 | 管理端 prompt 管理 | 提示词从代码搬到数据库，改完即时生效，可对比可回滚 | P2 |
| 8 | 查询改写 / HyDE | 提升模糊提问的召回质量，对「答得不准」的长尾场景收益明显 | P2 |
| 9 | 管理端智能助手（自然语言批量管理） | 第一个真正的 ReAct 工具循环落点，填上 `tools.py` 空壳；答辩演示 tool-closing 的最佳场景 | P2 |

### 一、课程主题补全（微调 / 部署）——P0，最高优先

**为什么排第一**：课程名是「大模型部署与微调」，但当前实现**前两者都是空的** ——
主生成模型 100% 走云端 API，本地只部署了 BGE-M3 与 bge-reranker 两个**判别**模型；
`pyproject.toml` 声明了 `litellm` / `arq` / `langfuse`，但 app 代码 **0 引用**。
答辩必问「你的微调在哪、部署在哪」，这一块优先补，且这两项都能出可量化的对比表。

#### 1. 评分器 LoRA 微调 + 前后对比评测集

- **数据从哪来**：不用另找数据集 —— 系统自身就在产出训练样本。每次评分落库的
  `(题目, 作答, 四维分数, 理由)` 就是一条天然 SFT 样本，攒够即成数据集（数据飞轮）。
- **怎么做**：LLaMA-Factory + Qwen2.5-1.5B/3B 做 LoRA SFT，让本地小模型学会按四维 rubric
  输出**同样的结构化 JSON**（沿用 `schemas.GradeOutput`，评测口径一致）。
- **怎么量化**：人工标注 200 条作为 ground truth，指标 = 与人工评分的一致率（±1 分内算一致）
  + 每维 MAE。答辩出「微调前 vs 微调后」对比表 —— 这是别的组大概率拿不出来的东西。
- **落点**：`app/agent/llm.py` 的 `get_structured_llm` 指向本地服务；数据导出与训练脚本**离线跑**，
  不进服务进程。

#### 2. vLLM 本地部署 + LiteLLM 网关路由

- **现状**：`llm.py` 直接用 `ChatOpenAI` 打云端；`litellm` 声明了但没接。
- **怎么做**：Qwen2.5-7B-Instruct 用 vLLM 起 OpenAI 兼容服务；LiteLLM 做网关，按任务难度路由
  （简单任务走本地、难任务走云端），并配 fallback（云端超时/限流自动切本地）。
- **接入成本低**：`llm.py` 已支持运行时 `base_url` / `api_key` 覆盖（管理后台可改），
  接 vLLM 本质上只是把 base_url 指向本地端口。
- **加分素材**：FP16 / AWQ-4bit / GPTQ 的「显存–延迟–质量」三角对比表；
  locust 压测出 P50/P99 与 QPS 上限。这两张表基本就是「部署」章节的核心内容。

### 二、RAG 增强——P1 / P2

#### 3. 错题本 + 间隔重复（P1）

`Answer` 表已存在；历史记录能回看**单次**作答，但缺**跨次聚合**。答错的题按 SM-2 排下次复习时间。
刷题产品的核心留存机制，也是这一批里实现成本最低的。

#### 4. RAG 面经企业库（P1）

PRD 规划的第三个知识库（题库库 / 面经企业库 / 用户简历库），目前**只有题库库落地**。
真实面经入库后，模拟面试可检索「这家公司爱问什么」，提问真实度显著提升。
数据边界不变：向量库存文本片段 + 元数据，主记录在 PostgreSQL。

#### 5. Langfuse 轨迹归档（P1）

现状：step event 只推给前端实时展示，**刷新即丢**（历史记录存的是页面快照，不是轨迹）。
上报 Langfuse 后轨迹可回看、可按会话聚合，还能出**成本看板**（每次训练/面试的 token 与费用）。
依赖已声明未使用，属于「补上就是纯赚」。

#### 6. 管理端检索模式管理（P2）

把检索策略做成后台可切换：**稠密 / 稀疏（BM25）/ 混合（RRF 融合）**、重排开关、top_k、召回条数。

- **复用现有机制**：`app/services/settings_service.py` 的 `SPECS` 登记表 —— 新增配置项只改那一处，
  后台表单自动出现，改完即时生效（无需重启）。
- **实现要点**：当前只有 BGE-M3 一路稠密向量，混合检索要加一路 BM25，再用 RRF 融合。
  对**算法题名、专有名词**的召回明显好于纯向量（这是纯语义检索的已知短板）。

#### 7. 管理端 prompt 管理（P2）

把 `app/agent/prompts.py` 的模板搬到数据库，做成「key + 版本 + 内容」，后台可编辑、可对比、可回滚，
改完即时生效。两种做法：

- 复用 `SystemConfig`（简单，但没有版本历史）；
- 新建 `PromptTemplate` 表（有多版本与 A/B 能力，为「评测集回归」打基础）。

建议先按前者落地，等有了评测集（第 1 项）再升级成后者。

#### 8. 查询改写 / HyDE（P2）

用户提问模糊时（如「缓存那个问题」），先用一次轻量模型调用把它改写成检索友好的查询，再拿去召回。
**HyDE 变体**：先让模型生成一段假想答案，用假想答案的向量去检索 —— 对短查询效果通常更好。
落点：`app/rag/vectorstore.py` 的 `search()` 之前插一个改写节点；改写过程本身也推 step event，
所以这一步在面板上是**可见**的（符合项目「可观测」卖点）。

#### 9. 管理端智能助手（自然语言批量管理，P2）

管理员用一句话驱动批量操作（「把所有 MySQL 索引相关题改成中级」「删掉语义重复的题」）。
模型不碰数据库，只输出「要调哪个工具 + 参数」，执行由服务端接管。四个关键设计：

- **手写 JSON ReAct，不用 `bind_tools`**：DeepSeek 工具调用的 arguments 不保证合法 JSON
  （项目已知坑），而 `create_question` 恰好要传长文本。改成模型每轮输出 `json_object`
  `{thinking, tool, arguments, reply}`，服务端执行工具后把结果塞回对话再问一轮，
  `tool: null` 即结束。每轮推 step event，接 `<TracePanel>`。
- **写操作走「拟→批→行」闸门**：写工具必须先出影响面预览（工具 `preview`），
  前端渲染确认卡片；服务端固化 `(工具名, 参数, plan_id)`，确认带回 plan_id 才执行且只能执行一次
  —— 确认时不让模型重新生成参数（类比 sudo：授权的是那一次具体操作）。
- **id 必须出自本轮检索**：服务端记「本轮出现过的 id 集合」，写操作引用集合外的 id 一律拒，
  防模型瞎编 id。硬护栏（服务端拦，不靠提示词）：删除类 > 20 条直接拒、写操作全量审计落库。

工具注册表填进 `app/agent/tools.py` 的 `ALL_TOOLS` 空壳；读工具复用
`question_repo.list_paged` / `vectorstore.search` / `user_repo.list_all` / `settings_service.snapshot`，
写工具复用 `admin.py` 现有的增删改逻辑。确认卡片、token 流式、step event 全部复用面试对话那套。
**落地按只读版 → 单写工具+确认闸门 → 批量写+审计 → 高危操作四步走**，第一步零风险可单独演示。

### 三、功能缺口（影响内测完整体验）

| 项 | 内容 | 优先级 |
|---|---|---|
| 画像自动更新 | SkillProfile 表已建，但缺少刷题/面试后自动更新画像的逻辑 | P1 |
| 简历存 MinIO | 简历 PDF 目前仅解析文本，未上传对象存储留档 | P2 |

### Laya 决策引擎接入（可选增强）

**Laya**（`NandhaKishorM/laya`，Apache-2.0）：非自回归 System 1 决策引擎，单次前向传播对任意文本输出结构化决策（`choice` / `score` / `noul` 三种 typed questions），延迟约 33ms、100+ 语言、不生成文本故无幻觉。底座 ModernBERT-large（421M）/ mmBERT-base（322M），本地 HF 加载。

**定位**：只做「确定性判断」，**不替代生成式 LLM，也不替代四维评分**。四维 rubric 要求每维给出 `reason`，Laya 只输出分数 + 置信度、给不出理由，故仅可作为评分的辅助信号，不可作为评分主体。参考答案、改进建议、面试提问、诊断报告等生成类任务仍全部走 DeepSeek。

**接入方式**：仿 `app/rag/embeddings.py` 的单例懒加载模式，新建 `app/decision/` 包（`engine.py` 懒加载 Router 单例 + `prompts.py` typed questions 定义），供 service 层调用。

| 候选落点 | 现有实现 | Laya 用法 | 收益 | 优先级 |
|---|---|---|---|---|
| 简历技能匹配 | `diagnose_node` 靠 DeepSeek 对比简历与 JD 判断缺失技能 | 对每个必备技能发 `noul`（"简历是否提到 X？"），批量出确定清单 | 从秒级生成变 33ms 判断，且不漏项 | P1 |
| 追问触发信号 | `followup_node` 无条件追问 | `noul` 判断作答是否含糊/未命中考点，作为「是否追问、追问哪点」的决策信号 | 避免无效追问，降本 | P2 |
| 输入意图路由 | 用户需手动选模块 | `choice` 把一句话输入路由到 刷题/简历/面试 | 交互更自然 | P2 |
| 方向/难度标注 | 出题时用户手选 | `choice` 自动判定题目的方向与难度 | 出题回写题库时可自动打标 | P2 |

**约束与风险**：
- 依赖 `transformers 5.x`，与 BGE-M3 所用的 `sentence-transformers`（`transformers 4.x`）存在同环境版本冲突风险 —— 优先用 `laya-serve` HTTP 方式或独立 conda 环境隔离，不直接装进 `langchain_latest`。
- 简历属敏感数据，**禁用 impossibl hosted API**，必须本地推理（对应下方「安全」约束）。
- 接入前需先在 HF 下载 `convaiinnovations/laya` 检查点（可用 `HF_ENDPOINT=https://hf-mirror.com`）。

## 开发约束

实现时必须遵守（偏离需先说明理由）：

- **技术栈锁定**：严格按上方技术栈，不引入替代框架（如用 Flask 替 FastAPI、用 LangChain 替 LangGraph）。
- **模块化单体**：MVP 用单进程 FastAPI，按领域分包（auth / question / training / resume / interview / report），不拆微服务、不引入服务网格。
- **分层**：`api`（路由/依赖注入）→ `service`（业务编排）→ `repository`（数据访问）；`agent`（LangGraph 编排 + 工具）、`rag`（LangChain 检索）为独立包，供 service 调用。
- **数据边界**：事务数据（用户/答案/评分/会话/画像/报告）只存 PostgreSQL；向量库只存可检索文本片段 + 元数据，以 chunk_id 关联；禁止把业务主数据放向量库。
- **代码规范**：Python 3.11+；函数与数据类加类型标注；代码注释、docstring、错误提示用中文；用 ruff 做 lint/format（行宽 100）。
- **可观测**：Agent 的每个步骤（模型调用/工具调用/记忆读写/向量检索）必须产出结构化 step event；默认不暴露原始思维链。
- **评分约束**：一律走四维 rubric（正确性 0.40 / 完整性 0.30 / 表达 0.15 / 术语 0.15，各 0–5 分），结构化 JSON 输出，禁止返回裸分数。
- **安全**：JWT + 用户级数据隔离（所有查询强制带 user_id 过滤）；简历/报告加密存储、日志脱敏；LLM 输出不作为代码执行。
