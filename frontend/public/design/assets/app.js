/* ============================================================================
   OfferMind · 共享运行时
   ----------------------------------------------------------------------------
   1) Om.ENDPOINTS   —— 全量接口清单（与 backend/app/api/v1 一一对应，单一事实来源）
   2) Om.DB          —— 演示数据（题库 / 作答 / 会话 / 配置）
   3) Om.api()       —— 模拟接口层：按 method+path 返回该端点的真实响应结构
   4) Om.sse()       —— 模拟 SSE 流：按项目的 step event 契约逐步推事件
                        {id, type, status: running|done, payload, duration_ms}
   5) UI 原语        —— 侧栏 / Toast / Modal / 雷达 / 评分条 / 空态
   ========================================================================== */

const Om = (window.Om = window.Om || {});

/* ------------------------------------------------------------------ 1. 接口 */

Om.ENDPOINTS = [
  // health
  { tag: "health", m: "GET", p: "/api/v1/health", auth: false, d: "存活探针：进程是否运行" },
  { tag: "health", m: "GET", p: "/api/v1/health/ready", auth: false, d: "就绪探针：DB / Redis / 向量库连通性" },

  // auth
  { tag: "auth", m: "POST", p: "/api/v1/auth/register", auth: false, d: "注册新用户，邮箱重复返回 400" },
  { tag: "auth", m: "POST", p: "/api/v1/auth/login", auth: false, d: "登录，签发 JWT（OAuth2 password flow）" },
  { tag: "auth", m: "GET", p: "/api/v1/auth/me", auth: true, d: "返回当前登录用户信息" },

  // training
  { tag: "training", m: "POST", p: "/api/v1/training/question", auth: true, d: "AI 出题，返回题目与 Agent 执行轨迹" },
  { tag: "training", m: "POST", p: "/api/v1/training/question/stream", auth: true, sse: true, d: "AI 出题（SSE 流式），生成后写入题库并回传 question_id" },
  { tag: "training", m: "POST", p: "/api/v1/training/grade", auth: true, d: "AI 四维评分（正确性/完整性/表达/术语）" },
  { tag: "training", m: "POST", p: "/api/v1/training/grade/stream", auth: true, sse: true, d: "AI 四维评分（SSE 流式），评分结果落库供错题本与微调使用" },
  { tag: "training", m: "POST", p: "/api/v1/training/followup", auth: true, d: "AI 追问" },
  { tag: "training", m: "POST", p: "/api/v1/training/followup/stream", auth: true, sse: true, d: "AI 追问（SSE 流式）" },

  // answers
  { tag: "answers", m: "GET", p: "/api/v1/answers", auth: true, d: "作答记录列表，支持 only_wrong / only_favorite / limit" },
  { tag: "answers", m: "GET", p: "/api/v1/answers/stats", auth: true, d: "错题本统计：总数 / 错题 / 收藏 / 待复习" },
  { tag: "answers", m: "GET", p: "/api/v1/answers/due", auth: true, d: "到期待复习（SM-2 排期）" },
  { tag: "answers", m: "PATCH", p: "/api/v1/answers/{id}", auth: true, d: "改错题 / 收藏标记" },
  { tag: "answers", m: "POST", p: "/api/v1/answers/{id}/review", auth: true, d: "复习一次，按 SM-2 重排下次到期时间" },

  // resume
  { tag: "resume", m: "POST", p: "/api/v1/resume/parse", auth: true, up: true, d: "上传 PDF 简历，提取文本并结构化" },
  { tag: "resume", m: "POST", p: "/api/v1/resume/parse/stream", auth: true, up: true, sse: true, d: "上传 PDF 简历并结构化（SSE 流式）" },
  { tag: "resume", m: "POST", p: "/api/v1/resume/diagnose", auth: true, d: "简历 + JD 诊断，返回匹配度与优化建议" },
  { tag: "resume", m: "POST", p: "/api/v1/resume/diagnose/stream", auth: true, sse: true, d: "解析简历 → 解析 JD → 对比诊断，逐步推送" },

  // interview
  { tag: "interview", m: "POST", p: "/api/v1/interview/question", auth: true, d: "基于简历生成深挖式面试提问" },
  { tag: "interview", m: "POST", p: "/api/v1/interview/question/stream", auth: true, sse: true, d: "深挖式面试提问（SSE 流式）" },
  { tag: "interview", m: "POST", p: "/api/v1/interview/chat/stream", auth: true, sse: true, d: "一问一答面试：开新面试 / 候选人发言 / summarize 出总结" },
  { tag: "interview", m: "GET", p: "/api/v1/interview/sessions", auth: true, d: "列出当前用户的面试会话" },
  { tag: "interview", m: "GET", p: "/api/v1/interview/sessions/{id}", auth: true, d: "取一场面试的完整内容（配置 + 对话 + 报告）" },
  { tag: "interview", m: "POST", p: "/api/v1/interview/report", auth: true, d: "基于逐轮记录生成面试报告" },
  { tag: "interview", m: "POST", p: "/api/v1/interview/report/stream", auth: true, sse: true, d: "面试报告（SSE 流式）" },

  // report
  { tag: "report", m: "POST", p: "/api/v1/report/training", auth: true, d: "生成训练报告" },
  { tag: "report", m: "POST", p: "/api/v1/report/training/stream", auth: true, sse: true, d: "训练报告（SSE 流式）" },
  { tag: "report", m: "POST", p: "/api/v1/report/profile", auth: true, d: "更新能力画像（掌握度 + 维度分）" },
  { tag: "report", m: "GET", p: "/api/v1/report/profile", auth: true, d: "查询能力画像（雷达数据源）" },

  // history
  { tag: "history", m: "POST", p: "/api/v1/history", auth: true, d: "记录一次交互（快照整体 POST）" },
  { tag: "history", m: "GET", p: "/api/v1/history", auth: true, d: "列出历史（可按 module 过滤），最近更新在前" },
  { tag: "history", m: "GET", p: "/api/v1/history/{id}", auth: true, d: "取一条历史的完整快照" },
  { tag: "history", m: "DELETE", p: "/api/v1/history/{id}", auth: true, d: "删除一条历史（跨用户返回 404 而非 403）" },

  // admin
  { tag: "admin", m: "GET", p: "/api/v1/admin/users", auth: true, admin: true, d: "用户列表，按邮箱 / 昵称模糊搜索" },
  { tag: "admin", m: "PATCH", p: "/api/v1/admin/users/{id}", auth: true, admin: true, d: "改昵称 / 管理员标记 / 重置密码" },
  { tag: "admin", m: "DELETE", p: "/api/v1/admin/users/{id}", auth: true, admin: true, d: "删除用户（不能删自己）" },
  { tag: "admin", m: "GET", p: "/api/v1/admin/questions", auth: true, admin: true, d: "题库分页查询：keyword + direction" },
  { tag: "admin", m: "POST", p: "/api/v1/admin/questions", auth: true, admin: true, d: "新建题目，PG 落库后向量化入 Qdrant" },
  { tag: "admin", m: "PUT", p: "/api/v1/admin/questions/{id}", auth: true, admin: true, d: "编辑题目，同一 point id 覆盖写回 Qdrant" },
  { tag: "admin", m: "DELETE", p: "/api/v1/admin/questions/{id}", auth: true, admin: true, d: "删除题目，PG 与 Qdrant 同步删" },
  { tag: "admin", m: "GET", p: "/api/v1/admin/stats", auth: true, admin: true, d: "后台概览：用户数 / 题目数" },
  { tag: "admin", m: "GET", p: "/api/v1/admin/llm/options", auth: true, admin: true, d: "模型候选：服务商预置 + 端点实时拉取（失败降级）" },
  { tag: "admin", m: "GET", p: "/api/v1/admin/config", auth: true, admin: true, d: "配置快照：默认值 / 生效值 / 是否被覆盖" },
  { tag: "admin", m: "PUT", p: "/api/v1/admin/config", auth: true, admin: true, d: "批量更新配置，改完即时生效（缓存失效）" },
  { tag: "admin", m: "DELETE", p: "/api/v1/admin/config/{key}", auth: true, admin: true, d: "把配置项恢复成 .env 默认值" },
];

Om.TAGS = {
  health: "健康检查", auth: "认证", training: "刷题训练", answers: "错题本",
  resume: "简历诊断", interview: "模拟面试", report: "报告与画像",
  history: "历史记录", admin: "管理后台",
};

/* ------------------------------------------------------------------ 2. 数据 */

const DIRECTIONS = ["后端", "前端", "算法", "数据库", "操作系统", "计算机网络"];
const DIFFICULTIES = ["初级", "中级", "高级"];
const TYPES = ["八股", "算法", "业务"];

const Q = (id, direction, difficulty, type, content, key) => ({
  id, direction, difficulty, question_type: type, content, key_points: key,
  reference_answer: "（参考答案见题库详情）", embedding_ref: `q_${id}_v1`,
});

Om.DB = {
  user: { id: 1, email: "maqianen@example.com", nickname: "马乾恩", is_admin: true },

  questions: [
    Q(101, "后端", "中级", "八股", "谈谈你对 MySQL 索引最左前缀原则的理解，以及在联合索引 (a,b,c) 上哪些查询能用上索引。", "最左前缀、范围查询中断、覆盖索引"),
    Q(102, "后端", "中级", "八股", "Redis 缓存穿透、缓存击穿、缓存雪崩分别是什么？各自的工程解法。", "布隆过滤器、互斥锁、过期时间打散"),
    Q(103, "后端", "高级", "业务", "设计一个支持千万级用户的短链服务，说明发号策略、存储选型与热点 key 处理。", "发号器、分库分表、CDC"),
    Q(104, "算法", "中级", "算法", "给定一个整数数组，找出和为 target 的两个数的下标。要求时间复杂度优于 O(n²)。", "哈希表、一次遍历"),
    Q(105, "算法", "高级", "算法", "实现 LRU 缓存，要求 get 与 put 均为 O(1)。", "哈希表 + 双向链表"),
    Q(106, "数据库", "中级", "八股", "事务的四种隔离级别分别解决了什么问题？MySQL 默认级别是什么，为什么？", "脏读、不可重复读、幻读、RR + MVCC"),
    Q(107, "操作系统", "中级", "八股", "进程与线程的区别？协程又解决了什么问题？", "地址空间、调度开销、用户态调度"),
    Q(108, "计算机网络", "中级", "八股", "HTTPS 的握手过程，以及为什么需要非对称 + 对称两次加密。", "证书链、密钥交换、会话密钥"),
    Q(109, "前端", "中级", "八股", "说说浏览器的事件循环，宏任务与微任务的执行顺序。", "调用栈、任务队列、渲染时机"),
    Q(110, "后端", "高级", "业务", "线上接口 P99 从 200ms 涨到 2s，你的排查路径是什么？", "分层定位、火焰图、慢查询"),
    Q(111, "数据库", "高级", "业务", "分库分表后如何做跨库分页与聚合统计？", "二次查询法、异构索引、离线汇总"),
    Q(112, "算法", "初级", "算法", "判断一个字符串是否是有效的括号序列。", "栈、配对消除"),
  ],

  answers: [
    { id: 9001, question_id: 101, question_content: Om.DB?.questions?.[0]?.content || "MySQL 索引最左前缀原则", answer_content: "联合索引 (a,b,c) 只有从 a 开始连续匹配才能用上……", total_score: 3.4, is_wrong: true, is_favorite: false, review_due_at: "2026-10-06T09:00:00", review_interval_days: 1, review_count: 2, created_at: "2026-10-03T14:20:00", score_json: { correctness: { score: 3 }, completeness: { score: 3 }, clarity: { score: 4 }, terminology: { score: 4 } } },
    { id: 9002, question_id: 105, question_content: "实现 LRU 缓存，要求 get 与 put 均为 O(1)。", answer_content: "用 LinkedHashMap 或者自己维护双向链表 + HashMap……", total_score: 4.3, is_wrong: false, is_favorite: true, review_due_at: null, review_interval_days: 6, review_count: 3, created_at: "2026-10-04T10:02:00", score_json: { correctness: { score: 5 }, completeness: { score: 4 }, clarity: { score: 4 }, terminology: { score: 4 } } },
    { id: 9003, question_id: 102, question_content: "Redis 缓存穿透、缓存击穿、缓存雪崩分别是什么？", answer_content: "穿透是查不存在的数据，击穿是热点 key 过期……雪崩我记不太清了", total_score: 2.6, is_wrong: true, is_favorite: true, review_due_at: "2026-10-06T09:00:00", review_interval_days: 1, review_count: 1, created_at: "2026-10-05T09:41:00", score_json: { correctness: { score: 2 }, completeness: { score: 2 }, clarity: { score: 3 }, terminology: { score: 4 } } },
    { id: 9004, question_id: 108, question_content: "HTTPS 的握手过程，以及为什么需要非对称 + 对称两次加密。", answer_content: "先非对称协商出会话密钥，再用对称加密传数据……", total_score: 4.0, is_wrong: false, is_favorite: false, review_due_at: "2026-10-08T09:00:00", review_interval_days: 4, review_count: 2, created_at: "2026-10-05T20:12:00", score_json: { correctness: { score: 4 }, completeness: { score: 4 }, clarity: { score: 4 }, terminology: { score: 4 } } },
    { id: 9005, question_id: 110, question_content: "线上接口 P99 从 200ms 涨到 2s，你的排查路径是什么？", answer_content: "先看监控，再定位是哪个环节，可能是慢 SQL……", total_score: 3.0, is_wrong: true, is_favorite: false, review_due_at: "2026-10-07T09:00:00", review_interval_days: 2, review_count: 1, created_at: "2026-10-06T08:30:00", score_json: { correctness: { score: 3 }, completeness: { score: 2 }, clarity: { score: 4 }, terminology: { score: 3 } } },
  ],

  profile: [
    { knowledge_point: "MySQL 索引", mastery: 0.52, dimension_scores: { 正确性: 3.0, 完整性: 2.6, 表达: 3.8, 术语: 4.0 } },
    { knowledge_point: "Redis 缓存", mastery: 0.46, dimension_scores: { 正确性: 2.8, 完整性: 2.2, 表达: 3.4, 术语: 3.9 } },
    { knowledge_point: "算法与数据结构", mastery: 0.74, dimension_scores: { 正确性: 4.4, 完整性: 4.0, 表达: 4.1, 术语: 4.2 } },
    { knowledge_point: "计算机网络", mastery: 0.66, dimension_scores: { 正确性: 3.9, 完整性: 3.7, 表达: 3.9, 术语: 4.1 } },
    { knowledge_point: "操作系统", mastery: 0.58, dimension_scores: { 正确性: 3.4, 完整性: 3.2, 表达: 3.6, 术语: 3.7 } },
    { knowledge_point: "系统设计", mastery: 0.41, dimension_scores: { 正确性: 2.6, 完整性: 2.4, 表达: 3.2, 术语: 3.3 } },
  ],

  sessions: [
    { id: 501, status: "finished", config: { direction: "后端", difficulty: "中级", style: "项目深挖" }, updated_at: "2026-10-05T21:04:00", rounds: 6, total_score: 78 },
    { id: 502, status: "active", config: { direction: "算法", difficulty: "高级", style: "压力面" }, updated_at: "2026-10-06T09:12:00", rounds: 3, total_score: null },
    { id: 503, status: "finished", config: { direction: "数据库", difficulty: "中级", style: "项目深挖" }, updated_at: "2026-10-02T15:40:00", rounds: 8, total_score: 71 },
  ],

  history: [
    { id: 7001, module: "practice", title: "后端·中级·八股｜MySQL 索引最左前缀", updated_at: "2026-10-06T09:22:00", snapshot: {} },
    { id: 7002, module: "interview", title: "算法·高级·压力面｜3 轮", updated_at: "2026-10-06T09:12:00", session_id: 502, snapshot: {} },
    { id: 7003, module: "resume", title: "简历诊断｜后端开发实习 JD", updated_at: "2026-10-05T22:31:00", snapshot: {} },
    { id: 7004, module: "report", title: "训练报告｜LRU 缓存实现", updated_at: "2026-10-04T10:14:00", snapshot: {} },
    { id: 7005, module: "practice", title: "算法·中级·算法｜两数之和", updated_at: "2026-10-03T16:50:00", snapshot: {} },
    { id: 7006, module: "interview", title: "后端·中级·项目深挖｜6 轮", updated_at: "2026-10-02T21:04:00", session_id: 501, snapshot: {} },
  ],

  users: [
    { id: 1, email: "maqianen@example.com", nickname: "马乾恩", is_admin: true, created_at: "2026-09-18T10:00:00" },
    { id: 2, email: "jiangzhimin@example.com", nickname: "蒋志敏", is_admin: true, created_at: "2026-09-18T10:04:00" },
    { id: 3, email: "lixianxing@example.com", nickname: "李贤星", is_admin: false, created_at: "2026-09-19T09:12:00" },
    { id: 4, email: "test01@stu.edu.cn", nickname: "内测-01", is_admin: false, created_at: "2026-09-24T14:38:00" },
    { id: 5, email: "test02@stu.edu.cn", nickname: "内测-02", is_admin: false, created_at: "2026-09-26T11:07:00" },
    { id: 6, email: "test03@stu.edu.cn", nickname: "内测-03", is_admin: false, created_at: "2026-09-30T16:45:00" },
  ],

  /* 配置项：与 app/services/settings_service.py 的 SPECS 登记表一致 */
  config: [
    { key: "llm_base_url", label: "模型端点 Base URL", value: "https://opencode.ai/zen/go/v1", default: "https://opencode.ai/zen/go/v1", kind: "text", overridden: false, description: "OpenAI 兼容端点的根地址，需带 /v1" },
    { key: "llm_api_key", label: "模型 API Key", value: "", default: "", kind: "secret", has_value: true, overridden: true, description: "出于安全考虑不回显，留空表示沿用已保存的值" },
    { key: "llm_model", label: "主生成模型", value: "deepseek-v4-flash", default: "deepseek-v4-flash", kind: "select", options: ["deepseek-v4-flash", "deepseek-v4.1-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"], overridden: false, description: "出题 / 评分 / 报告 / 面试对话使用的模型名" },
    { key: "llm_temperature", label: "生成温度", value: "0.0", default: "0.0", kind: "number", overridden: false, description: "结构化输出的温度，0 最稳定；面试对话另有固定 0.7" },
    { key: "retrieval_top_k", label: "检索召回条数", value: "5", default: "5", kind: "number", overridden: true, description: "评分时从题库召回多少条相似题目作为参照" },
    { key: "retrieval_mode", label: "检索模式", value: "hybrid", default: "dense", kind: "select", options: ["dense", "sparse", "hybrid"], overridden: true, description: "dense=纯向量 / sparse=纯 BM25 / hybrid=两路召回 + RRF 融合" },
    { key: "retrieval_use_rerank", label: "启用精排", value: "1", default: "1", kind: "bool", overridden: false, description: "是否用 bge-reranker 对召回结果精排" },
    { key: "question_dup_threshold", label: "出题查重阈值", value: "0.92", default: "0.92", kind: "number", overridden: false, description: "新题与题库中最近似题的余弦相似度超过此值即判重、重新生成" },
    { key: "llm_gateway_enabled", label: "启用 LLM 网关", value: "1", default: "0", kind: "bool", overridden: true, description: "开启后按部署列表做路由与失败回退；关闭则直连单一端点" },
    { key: "llm_gateway_deployments", label: "网关部署列表", value: "[\n  {\"name\":\"cloud-deepseek\",\"model\":\"openai/deepseek-v4-flash\",\"api_base\":\"https://opencode.ai/zen/go/v1\",\"api_key\":\"oc_sk_***\"},\n  {\"name\":\"local-qwen\",\"model\":\"openai/Qwen2.5-7B-Instruct\",\"api_base\":\"http://127.0.0.1:8001/v1\",\"api_key\":\"EMPTY\"}\n]", default: "[]", kind: "textarea", overridden: true, description: "JSON 数组，每项一个可路由的部署" },
    { key: "llm_gateway_primary", label: "网关主部署", value: "cloud-deepseek", default: "", kind: "text", overridden: true, description: "默认走哪个部署（填 name）；留空取列表第一个" },
    { key: "llm_gateway_fallbacks", label: "失败回退规则", value: "{\"cloud-deepseek\":[\"local-qwen\"]}", default: "{}", kind: "textarea", overridden: true, description: "云端失败时自动降级到本地" },
  ],

  /* 实测数据：云端基线取自 backend/benchmark/cloud-test.json
     （deepseek-flash · 并发 4 · 8 次请求 · prompt 200 字符 · max_tokens 64）。
     本地 vLLM 三档与评分器微调对比**尚未产出有效数据** —— 显式留 null，
     由页面渲染成「待测」，不填编造值。 */
  bench: {
    cloud: { p50: 3.74, p95: 5.45, p99: 5.55, ttft: 2.75, rps: 0.89, n: 8, wall: 8.96, err: 0 },
    local_vllm_fp16: null, // 待有 GPU 跑 vLLM 后补
    local_vllm_awq: null,
    local_vllm_gptq: null,
    finetune: null, // 人工标注评测集待完成，train_lora 待跑
  },
};

/* 修正：answers 的题干在 DB 定义之后取，避免引用未初始化 */
Om.DB.answers.forEach((a) => {
  const q = Om.DB.questions.find((x) => x.id === a.question_id);
  if (q) a.question_content = q.content;
});

Om.answerStats = () => ({
  total: Om.DB.answers.length,
  wrong: Om.DB.answers.filter((a) => a.is_wrong).length,
  favorite: Om.DB.answers.filter((a) => a.is_favorite).length,
  due: Om.DB.answers.filter((a) => a.review_due_at && a.review_due_at <= "2026-10-07T23:59:59").length,
});

/** 单条作答记录的响应体（对应后端 answers.py 的 _to_out） */
Om.answerOut = function (id) {
  const a = Om.DB.answers.find((x) => x.id === id) || Om.DB.answers[0];
  const q = Om.DB.questions.find((x) => x.id === a.question_id) || {};
  return {
    id: a.id,
    question_id: a.question_id,
    question_content: q.content || "",
    answer_content: a.answer_content,
    score_json: a.score_json || {},
    total_score: a.total_score,
    is_wrong: a.is_wrong,
    is_favorite: a.is_favorite,
    review_due_at: a.review_due_at,
    review_interval_days: a.review_interval_days,
    review_count: a.review_count,
    created_at: a.created_at,
  };
};

/* ------------------------------------------------------------- 3. 模拟接口层 */

/** 按 method + path 返回该端点的真实响应结构。未登记的端点抛 404。 */
Om.api = function (method, path, body) {
  const key = `${method.toUpperCase()} ${path.split("?")[0]}`;
  const q = Om.parseQuery(path);

  // health
  if (key === "GET /api/v1/health") return { status: "ok" };
  if (key === "GET /api/v1/health/ready")
    return { status: "ready", checks: { postgres: "up", redis: "up", qdrant: "up", bge_m3: "warm", reranker: "warm" } };

  // auth
  if (key === "GET /api/v1/auth/me") return Om.DB.user;

  // training
  if (key === "POST /api/v1/training/question")
    return {
      output: {
        content: Om.DB.questions[0].content,
        samples: "输入：nums = [2,7,11,15], target = 9\n输出：[0,1]\n约束：n ≤ 10^5",
        key_points: "哈希表 / 一次遍历 / 边界条件",
        reference_answer: "遍历时用哈希表记录已见元素与其下标，查 target - x 是否出现过。",
        question_id: 113,
      },
      traces: Om.traceFixture("question"),
    };
  if (key === "POST /api/v1/training/grade")
    return Om.gradeFixture();
  if (key === "POST /api/v1/training/followup")
    return { output: { question: "如果数组已经有序，你的解法的复杂度会变化吗？还可以怎么优化？", reference_answer: "双指针可降到 O(n)/O(1)。", key_points: "有序性利用 / 双指针" }, traces: Om.traceFixture("followup") };

  // resume
  if (key === "POST /api/v1/resume/parse") return Om.resumeFixture();
  if (key === "POST /api/v1/resume/diagnose")
    return { structured_resume: Om.resumeFixture().output, jd_profile: Om.jdFixture(), diagnosis: Om.diagnosisFixture(), traces: Om.traceFixture("diagnose") };

  // interview
  if (key === "GET /api/v1/interview/sessions") return Om.DB.sessions;
  if (key.startsWith("GET /api/v1/interview/sessions/")) {
    const id = Number(key.split("/").pop());
    const s = Om.DB.sessions.find((x) => x.id === id);
    if (!s) return null;
    return { ...s, messages: Om.sessionMessages(id), report: s.status === "finished" ? Om.interviewReportFixture() : {} };
  }
  if (key === "POST /api/v1/interview/report") return { output: Om.interviewReportFixture(), traces: Om.traceFixture("interview_report") };

  // report
  if (key === "POST /api/v1/report/training") return { output: Om.trainingReportFixture(), traces: Om.traceFixture("training_report") };
  if (key === "GET /api/v1/report/profile") return Om.DB.profile;

  // history
  if (key === "GET /api/v1/history")
    return q.module ? Om.DB.history.filter((h) => h.module === q.module) : Om.DB.history;
  if (method.toUpperCase() === "POST" && key === "POST /api/v1/history")
    return { id: 7999 };

  // answers
  if (key === "GET /api/v1/answers") {
    let rows = Om.DB.answers.slice();
    if (q.only_wrong === "true") rows = rows.filter((a) => a.is_wrong);
    if (q.only_favorite === "true") rows = rows.filter((a) => a.is_favorite);
    return rows.slice(0, Number(q.limit || 100));
  }
  if (key === "GET /api/v1/answers/stats") return Om.answerStats();
  if (key === "GET /api/v1/answers/due")
    return Om.DB.answers.filter((a) => a.review_due_at && a.review_due_at <= "2026-10-07T23:59:59");

  // admin
  if (key === "GET /api/v1/admin/stats") return { users: Om.DB.users.length, questions: Om.DB.questions.length };
  if (key === "GET /api/v1/admin/users") {
    const kw = (q.keyword || "").toLowerCase();
    return Om.DB.users.filter((u) => !kw || u.email.toLowerCase().includes(kw) || u.nickname.toLowerCase().includes(kw));
  }
  if (key === "GET /api/v1/admin/questions") {
    const kw = q.keyword || "";
    const dir = q.direction || "";
    let rows = Om.DB.questions.filter(
      (x) => (!kw || x.content.includes(kw)) && (!dir || x.direction === dir)
    );
    const page = Number(q.page || 1);
    const size = Number(q.size || 20);
    return { total: rows.length, page, size, items: rows.slice((page - 1) * size, page * size) };
  }
  if (key === "GET /api/v1/admin/config") return Om.DB.config;
  if (key === "GET /api/v1/admin/llm/options")
    return {
      presets: [
        { key: "opencode-go", label: "OpenCode Go 套餐", base_url: "https://opencode.ai/zen/go/v1", note: "订阅制套餐，密钥以 oc_sk_ 开头" },
        { key: "opencode-zen", label: "OpenCode Zen（按量计费）", base_url: "https://opencode.ai/inference/openai/v1", note: "控制台里建的 service account key" },
        { key: "deepseek", label: "DeepSeek 官方", base_url: "https://api.deepseek.com/v1", note: "密钥以 sk- 开头" },
      ],
      models: ["deepseek-v4-flash", "deepseek-v4.1-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
      source: "live",
      error: "",
    };

  /* ---- 写操作端点：真实后端都返回「改动后的对象」或 {status:"ok"} ---- */
  if (key === "POST /api/v1/admin/questions") {
    const id = Math.max(0, ...Om.DB.questions.map((q) => q.id)) + 1;
    return { id, embedding_ref: `q_${id}_v1` };
  }
  if (/^PUT \/api\/v1\/admin\/questions\/\d+$/.test(key)) {
    const id = Number(key.split("/").pop());
    return { id, embedding_ref: `q_${id}_v1` };
  }
  if (/^DELETE \/api\/v1\/admin\/questions\/\d+$/.test(key)) return { status: "ok" };

  if (/^PATCH \/api\/v1\/admin\/users\/\d+$/.test(key)) {
    const id = Number(key.split("/").pop());
    const u = Om.DB.users.find((x) => x.id === id);
    if (!u) return null;
    return { id: u.id, email: u.email, nickname: u.nickname, is_admin: u.is_admin };
  }
  if (/^DELETE \/api\/v1\/admin\/users\/\d+$/.test(key)) return { status: "ok" };

  if (key === "PUT /api/v1/admin/config") return Om.api("GET", "/api/v1/admin/config");
  if (/^DELETE \/api\/v1\/admin\/config\/.+$/.test(key)) return Om.api("GET", "/api/v1/admin/config");

  if (/^PATCH \/api\/v1\/answers\/\d+$/.test(key)) {
    const id = Number(key.split("/")[4]);
    return Om.answerOut(id);
  }
  if (/^POST \/api\/v1\/answers\/\d+\/review$/.test(key)) {
    const id = Number(key.split("/")[4]);
    return Om.answerOut(id);
  }

  if (key === "POST /api/v1/report/profile")
    return { knowledge_point: (body || {}).knowledge_point || "", mastery: (body || {}).mastery ?? 0 };

  const e = Om.ENDPOINTS.find((x) => `${x.m} ${x.p}` === key);
  if (e) return { _stub: true, note: `演示环境未实现 ${key} 的副作用，返回该端点的响应结构占位。`, endpoint: e };
  throw new Error(`404 Not Found: ${key}`);
};

Om.parseQuery = function (path) {
  const i = path.indexOf("?");
  const out = {};
  if (i < 0) return out;
  new URLSearchParams(path.slice(i + 1)).forEach((v, k) => (out[k] = v));
  return out;
};

/* ------------------------------------------------- 4. SSE 流式事件模拟 */

/**
 * 按项目的 step event 契约推事件：
 *   每个节点在开始 / 结束各推一条同 id 的事件，前端按 id 原地替换。
 * 支持的特殊事件：token（文本分片）、hr_message（整句）、结果、已记录、错误、session。
 */
Om.sse = function (script, handlers, speed = 1) {
  const H = Object.assign({ onEvent() {}, onToken() {}, onDone() {}, onError() {} }, handlers || {});
  let i = 0;
  let cancelled = false;

  function step() {
    if (cancelled) return;
    if (i >= script.length) {
      H.onDone();
      return;
    }
    const ev = script[i++];
    const wait = Math.max(40, (ev.__wait || 420) / speed);
    setTimeout(() => {
      if (cancelled) return;
      if (ev.type === "token") H.onToken(ev.payload.text, ev);
      else if (ev.type === "结果") {
        // 「结果」不是终点：真实链路上它后面还可能跟「已记录」等尾部事件，
        // 所以只推事件、继续走脚本，终止统一由脚本耗尽触发。
        H.onEvent(ev);
      } else if (ev.type === "错误") {
        H.onEvent(ev);
        H.onError(ev);
        return;
      } else H.onEvent(ev);
      if (ev.__last) {
        H.onDone(ev);
        return;
      }
      step();
    }, wait);
  }
  step();
  return () => { cancelled = true; };
};

/* 步骤脚本由各页自行拼装：每个流程的尾部事件不同（结果 / 已记录 / 会话），
   放在页面里比塞进共享层更直观，也避免多一个全站无人调用的抽象。 */

/* ------------------------------------------------------ 演示轨迹数据 */

Om.traceFixture = function (kind) {
  const map = {
    question: [
      { id: "embed:q", type: "检索", status: "done", payload: { 阶段: "查询向量化", 模型: "BGE-M3", 维度: 1024 }, duration_ms: 63 },
      { id: "recall:q", type: "检索", status: "done", payload: { 阶段: "召回", 模式: "hybrid", 候选数: 20 }, duration_ms: 41 },
      { id: "rerank:q", type: "检索", status: "done", payload: { 阶段: "精排", 模型: "bge-reranker-v2-m3", 保留: 5 }, duration_ms: 188 },
      { id: "generate:1", type: "模型", status: "done", payload: { 工具: "generate_question", 模型: "deepseek-v4-flash", 第几次尝试: 1 }, duration_ms: 3720 },
      { id: "dedup:1", type: "检索", status: "done", payload: { 阶段: "查重", 最高相似度: 0.71, 阈值: 0.92, 判定: "通过" }, duration_ms: 58 },
    ],
    followup: [{ id: "followup", type: "模型", status: "done", payload: { 工具: "generate_followup", 模型: "deepseek-v4-flash" }, duration_ms: 2410 }],
    grade: [
      { id: "embed:g", type: "检索", status: "done", payload: { 阶段: "查询向量化", 模型: "BGE-M3" }, duration_ms: 58 },
      { id: "recall:g", type: "检索", status: "done", payload: { 阶段: "召回", 模式: "hybrid", 候选数: 20 }, duration_ms: 39 },
      { id: "rerank:g", type: "检索", status: "done", payload: { 阶段: "精排", 保留: 5 }, duration_ms: 176 },
      { id: "grade", type: "模型", status: "done", payload: { 工具: "grade_answer", 总分: 3.4 }, duration_ms: 4180 },
    ],
    diagnose: [
      { id: "pdf_extract", type: "工具", status: "done", payload: { 工具: "extract_pdf_text", 提取字符数: 2841 }, duration_ms: 112 },
      { id: "parse_resume", type: "模型", status: "done", payload: { 工具: "parse_resume" }, duration_ms: 3260 },
      { id: "parse_jd", type: "模型", status: "done", payload: { 工具: "parse_jd" }, duration_ms: 2110 },
      { id: "diagnose", type: "模型", status: "done", payload: { 工具: "diagnose", 匹配度: 68 }, duration_ms: 3940 },
    ],
    interview_report: [{ id: "interview_report", type: "模型", status: "done", payload: { 工具: "interview_report", 总分: 78 }, duration_ms: 5240 }],
    training_report: [{ id: "training_report", type: "模型", status: "done", payload: { 工具: "training_report" }, duration_ms: 4460 }],
  };
  return map[kind] || map.question;
};

Om.gradeFixture = function () {
  return {
    output: {
      correctness: { score: 3, reason: "说对了「最左前缀」这一条，但没讲清范围查询会中断后续列的匹配。" },
      completeness: { score: 3, reason: "漏了覆盖索引与索引下推两个常见追问点。" },
      clarity: { score: 4, reason: "结构清楚，先结论后解释。" },
      terminology: { score: 4, reason: "术语使用准确，没有混淆聚簇索引与二级索引。" },
      total_score: 3.4,
      strengths: "结论先行、表达有条理；对最左前缀的定义准确。",
      suggestions: "补齐「范围查询中断匹配」与「覆盖索引避免回表」两点，并给一个 (a,b,c) 上的反例查询。",
      reference_answer: "联合索引按定义顺序逐列比较；遇到范围条件（>、<、between、like 前缀）后，其右侧列不再用于定位，只用于 ICP 过滤。",
    },
    traces: Om.traceFixture("grade"),
  };
};

Om.resumeFixture = function () {
  return {
    resume_text: "马乾恩 / 计算机科学与技术 / 2023.09-2027.06 ……",
    output: {
      name: "马乾恩",
      education: "某大学 计算机科学与技术 本科 2023.09 - 2027.06",
      skills: ["Python", "FastAPI", "LangGraph", "PostgreSQL", "Redis", "Docker", "React"],
      projects: [
        { name: "OfferMind 求职训练平台", description: "可观测 Agentic RAG 驱动的 AI 面试训练系统，独立完成后端 47 个接口与 LangGraph 编排。", tech_stack: "FastAPI / LangGraph / Qdrant / Next.js" },
        { name: "课程实验：简易 RPC 框架", description: "基于 Netty 实现服务注册发现与负载均衡。", tech_stack: "Java / Netty / Zookeeper" },
      ],
      work_experience: "暂无实习经历",
      summary: "后端方向，熟悉 Python 服务端与 LLM 应用工程化，有从 0 到 1 落地完整系统的经验。",
    },
    traces: [{ id: "parse_resume", type: "模型", status: "done", payload: { 工具: "parse_resume" }, duration_ms: 3260 }],
  };
};

Om.jdFixture = function () {
  return {
    position: "后端开发实习生（AI 应用方向）",
    responsibilities: ["参与 LLM 应用后端服务的设计与开发", "负责 RAG 检索链路的效果调优", "编写接口文档与单元测试"],
    required_skills: ["Python", "FastAPI 或同类框架", "MySQL / PostgreSQL", "Redis", "Linux"],
    preferred_skills: ["LangChain / LangGraph", "向量数据库", "Docker / K8s", "模型部署与微调经验"],
  };
};

Om.diagnosisFixture = function () {
  return {
    match_score: 68,
    strengths: ["有完整 LLM 应用落地经验，与岗位方向高度一致", "技术栈匹配 FastAPI / PostgreSQL / Redis", "有向量检索与 Agent 编排的实操"],
    weaknesses: ["缺少实习经历，工程协作流程描述不足", "项目中的量化结果偏少（QPS、延迟、准确率）"],
    missing_skills: ["Docker / K8s 生产部署", "单元测试与 CI", "模型微调全链路"],
    suggestions: [
      "把 OfferMind 项目里的实测数据写进简历：P50 3.7s / P99 5.6s、47 个接口、11 张表。",
      "补一段「容器化部署」描述，Docker Compose 起 PG/Redis/Qdrant 是现成素材。",
      "用 STAR 结构重写项目描述，每条控制在两行内。",
    ],
  };
};

Om.interviewReportFixture = function () {
  return {
    total_score: 78,
    overall_comment: "整体表达清晰、项目细节记得住，是本次面试的加分项。系统设计类问题停留在「知道名词」层面，缺少取舍分析。",
    round_feedback: [
      "第 1 轮 · 项目深挖：能讲清 OfferMind 的数据流，但被追问「为什么用 Qdrant 而不是 pgvector」时只回答了「老师推荐」。",
      "第 2 轮 · 八股：MySQL 索引回答完整，Redis 雪崩的解法漏了「过期时间打散」。",
      "第 3 轮 · 系统设计：短链服务只说了分库分表，未涉及发号器选型与热点 key。",
    ],
    improvements: ["每个技术选型准备一句「为什么不是另一个」", "系统设计按「容量估算 → 存储 → 接口 → 瓶颈」四步走", "复习 Redis 三大缓存问题的完整解法"],
    radar: { 正确性: 78, 完整性: 66, 表达: 84, 术语: 82, 系统设计: 58, 项目深度: 81 },
  };
};

Om.trainingReportFixture = function () {
  return {
    summary: "本题作答掌握了核心思路，但边界条件与复杂度分析缺失，属于「会做但讲不透」。",
    weak_points: ["复杂度分析未给出", "边界条件（空数组、重复元素）未讨论", "未主动提及空间换时间的取舍"],
    suggestions: ["作答固定收尾一句复杂度分析", "先复述约束再动手", "准备一个「如果数据量到 10^8 怎么办」的延伸答案"],
    radar: { 正确性: 78, 完整性: 62, 表达: 80, 术语: 85, 算法: 74, 工程实践: 60 },
  };
};

Om.sessionMessages = function (id) {
  if (id === 501)
    return [
      { role: "hr", content: "你好，我是本次的技术面试官。先请你用两分钟介绍一下 OfferMind 这个项目，重点说你自己负责的部分。" },
      { role: "user", content: "这个项目是一个 AI 求职面试训练平台，我负责后端，用 FastAPI 和 LangGraph 实现了出题、评分、面试对话三条链路。" },
      { role: "hr", content: "你提到了 LangGraph。为什么这里要用图编排而不是直接串几个函数调用？" },
      { role: "user", content: "因为出题有查重后重新生成的循环，用图表达条件边更自然，而且每个节点能推 step event 做可观测。" },
      { role: "hr", content: "很好。那如果模型返回的 JSON 不合法，你的链路会怎么表现？" },
      { role: "user", content: "我们走的是 response_format=json_object，由服务端约束解码，所以基本不会出现非法 JSON。" },
      { role: "hr", content: "明白了，今天先到这里。" },
    ];
  if (id === 502)
    return [
      { role: "hr", content: "我们直接开始。请实现 LRU 缓存，要求 get 和 put 都是 O(1)，先讲思路再写。" },
      { role: "user", content: "用哈希表存 key 到链表节点的映射，双向链表维护访问顺序。" },
      { role: "hr", content: "链表为什么必须是双向的？单向能行吗？" },
    ];
  return [
    { role: "hr", content: "请说说分库分表之后，跨库分页你会怎么做？" },
    { role: "user", content: "可以对每个分片都取前 N 条，再在内存里归并。" },
    { role: "hr", content: "如果分片很多这个方法会有什么问题？" },
  ];
};

/* ------------------------------------------------------------ 5. UI 原语 */

/** 侧栏：app 类页面统一调用 Om.rail("practice") */
Om.rail = function (active, opts) {
  const o = opts || {};
  const NAV = [
    { g: "训练" },
    { href: "dashboard.html", label: "工作台", ico: "◇", k: "dashboard" },
    { href: "practice.html", label: "刷题训练", ico: "▸", k: "practice" },
    { href: "wrongbook.html", label: "错题本", ico: "★", k: "wrongbook", n: Om.answerStats().due },
    { href: "interview.html", label: "模拟面试", ico: "◉", k: "interview" },
    { g: "分析" },
    { href: "resume.html", label: "简历诊断", ico: "≡", k: "resume" },
    { href: "report.html", label: "能力报告", ico: "◈", k: "report" },
    { g: "管理" },
    { href: "admin.html", label: "后台概览", ico: "⌘", k: "admin" },
    { href: "admin-questions.html", label: "题库管理", ico: "▤", k: "admin-questions" },
    { href: "admin-config.html", label: "模型与检索", ico: "⚙", k: "admin-config" },
    { href: "admin-api.html", label: "接口总览", ico: "⌗", k: "admin-api" },
    { g: "展示" },
    { href: "bigscreen.html", label: "数据大屏", ico: "▣", k: "bigscreen" },
  ];
  const groups = [];
  let cur = null;
  NAV.forEach((it) => {
    if (it.g) { cur = { g: it.g, items: [] }; groups.push(cur); }
    else cur.items.push(it);
  });

  return `
  <nav class="rail">
    <a class="rail-brand" href="index.html">
      <span class="mark">OfferMind</span>
      <span class="tag">v0.9</span>
    </a>
    ${groups
      .map(
        (gr) => `
      <div class="rail-group">${gr.g}</div>
      ${gr.items
        .map(
          (it) => `<a class="rail-link${it.k === active ? " active" : ""}" href="${it.href}">
            <span class="ico">${it.ico}</span><span class="grow truncate">${it.label}</span>
            ${it.n ? `<span class="badge-n num">${it.n}</span>` : ""}
          </a>`
        )
        .join("")}`
      )
      .join("")}
    <div class="rail-foot">
      <div class="rail-user" title="${o.email || Om.DB.user.email}">
        ${o.name || Om.DB.user.nickname}
        <small>${o.email || Om.DB.user.email}</small>
      </div>
      <a class="rail-out" href="login.html" style="display:block">退出登录</a>
    </div>
  </nav>`;
};

/** 挂载侧栏 + 页面骨架 */
Om.mount = function (active, opts) {
  const el = document.getElementById("rail-slot");
  if (el) el.outerHTML = Om.rail(active, opts);
};

/** Toast */
Om.toast = function (kind, title, msg) {
  let host = document.querySelector(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  const K = { ok: "OK", err: "ERROR", info: "INFO" };
  t.innerHTML = `<div class="grow"><div class="tk">${K[kind] || kind}</div><div>${msg}</div></div>`;
  host.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity .3s, transform .3s";
    t.style.opacity = "0";
    t.style.transform = "translateY(6px)";
    setTimeout(() => t.remove(), 320);
  }, 3400);
  return t;
};

/** 模态：Om.modal({title, body, foot, wide}) → 返回关闭函数 */
Om.modal = function (o) {
  const mask = document.createElement("div");
  mask.className = "mask";
  mask.innerHTML = `
    <div class="modal${o.wide ? " wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div class="h2">${o.title}</div>
        <button class="x" type="button" data-close aria-label="关闭">✕</button>
      </div>
      <div class="modal-body">${o.body || ""}</div>
      ${o.foot ? `<div class="modal-foot">${o.foot}</div>` : ""}
    </div>`;
  document.body.appendChild(mask);
  const close = () => {
    mask.style.opacity = "0";
    setTimeout(() => mask.remove(), 160);
  };
  mask.addEventListener("click", (e) => {
    if (e.target === mask || e.target.closest("[data-close]")) close();
  });
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  return { el: mask, close };
};

/** 确认框：Om.confirm({title,msg,ok,danger}) → Promise<boolean> */
Om.confirm = function (o) {
  return new Promise((res) => {
    const m = Om.modal({
      title: o.title || "确认操作",
      body: `<p class="lead">${o.msg || ""}</p>${o.detail ? `<div class="mt-4">${o.detail}</div>` : ""}`,
      foot: `<button class="btn" data-close>取消</button><button class="btn ${o.danger ? "btn-danger" : "btn-primary"}" data-ok>${o.ok || "确认"}</button>`,
    });
    m.el.querySelector("[data-ok]").addEventListener("click", () => { m.close(); res(true); });
    m.el.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) res(false); });
  });
};

/** SVG 雷达图 */
Om.radar = function (values, o) {
  const opt = Object.assign({ size: 260, rings: 4, max: 100, label: true }, o);
  const keys = Object.keys(values);
  const n = keys.length;
  const c = opt.size / 2;
  const r = c - (opt.label ? 42 : 10);
  const pt = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rr = (v / opt.max) * r;
    return [c + Math.cos(a) * rr, c + Math.sin(a) * rr];
  };
  const poly = keys.map((k, i) => pt(i, values[k]).map((v) => v.toFixed(1)).join(",")).join(" ");
  const rings = Array.from({ length: opt.rings }, (_, ri) => {
    const rr = ((ri + 1) / opt.rings) * r;
    const p = Array.from({ length: n }, (_, i) => {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      return `${(c + Math.cos(a) * rr).toFixed(1)},${(c + Math.sin(a) * rr).toFixed(1)}`;
    }).join(" ");
    return `<polygon points="${p}" fill="none" stroke="var(--border)" stroke-width="1"/>`;
  }).join("");
  const spokes = keys
    .map((k, i) => {
      const [x, y] = pt(i, opt.max);
      return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;
    })
    .join("");
  const labels = opt.label
    ? keys
        .map((k, i) => {
          const a = (Math.PI * 2 * i) / n - Math.PI / 2;
          const x = c + Math.cos(a) * (r + 22);
          const y = c + Math.sin(a) * (r + 22);
          const anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
          const v = Math.round(values[k]);
          return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}"
            font-family="var(--font-sans)" font-size="11" fill="var(--muted)">${k}
            <tspan font-family="var(--font-mono)" font-size="10.5" fill="var(--fg-2)" dx="4">${v}</tspan></text>`;
        })
        .join("")
    : "";
  return `<svg viewBox="0 0 ${opt.size} ${opt.size}" width="100%" style="max-width:${opt.size}px" role="img" aria-label="能力雷达图">
    ${rings}${spokes}
    <polygon points="${poly}" fill="oklch(63% 0.135 195 / 0.19)" stroke="var(--accent-ink)" stroke-width="1.6" stroke-linejoin="round"/>
    ${keys
      .map((k, i) => {
        const [x, y] = pt(i, values[k]);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="var(--accent-ink)"/>`;
      })
      .join("")}
    ${labels}
  </svg>`;
};

/** 四维评分条 */
Om.rubric = function (score) {
  const dims = [
    ["正确性", "correctness", 0.4],
    ["完整性", "completeness", 0.3],
    ["表达与结构", "clarity", 0.15],
    ["术语准确性", "terminology", 0.15],
  ];
  return `<div class="rubric">${dims
    .map(([label, key, w]) => {
      const d = score[key] || { score: 0, reason: "" };
      const tone = d.score >= 4 ? "success" : d.score >= 3 ? "accent" : d.score >= 2 ? "warn" : "danger";
      return `<div class="rubric-row">
        <div class="name">${label}<em>权重 ${w.toFixed(2)}</em></div>
        <div class="bar"><i class="${tone}" style="width:${(d.score / 5) * 100}%"></i></div>
        <div class="val">${d.score}<span> / 5</span></div>
      </div>`;
    })
    .join("")}</div>`;
};

/** 步骤时间线（可观测面板主体） */
Om.tracePanel = function (id, title) {
  return `
  <section class="card" id="${id}">
    <div class="trace-head">
      <span class="eyebrow">Agent Trace</span>
      <span class="num small" style="color:var(--ink-muted)" data-role="title">${title || "等待执行"}</span>
      <span class="live" data-role="live"><span class="dot done"></span><span data-role="livetext">IDLE</span></span>
    </div>
    <div class="trace-body" data-role="body">
      <div class="trace-empty">执行 Agent 后，这里会逐步出现每个节点的「进行中 → 已完成 + 耗时」。</div>
    </div>
  </section>`;
};

/** 绑定时序：把 tracePanel 接到 SSE 事件上 */
Om.bindTrace = function (rootId) {
  const root = document.getElementById(rootId);
  if (!root) return { reset() {}, push() {}, setTitle() {}, live() {} };
  const body = root.querySelector('[data-role="body"]');
  const liveDot = root.querySelector('[data-role="live"] .dot');
  const liveTxt = root.querySelector('[data-role="livetext"]');
  const titleEl = root.querySelector('[data-role="title"]');
  const rows = new Map();
  let seq = 0;
  let t0 = performance.now();

  function ensureEmpty() {
    if (!rows.size) body.innerHTML = `<div class="trace-empty">执行 Agent 后，这里会逐步出现每个节点的「进行中 → 已完成 + 耗时」。</div>`;
  }
  function render(ev) {
    const ph = body.querySelector(".trace-empty");
    if (ph) ph.remove();
    const kv = Object.entries(ev.payload || {})
      .map(([k, v]) => `<span class="k">${k}</span>=<span class="v">${typeof v === "object" ? JSON.stringify(v) : v}</span>`)
      .join("  ");
    const cls = ev.status === "running" ? "is-running" : ev.type === "错误" ? "is-error" : "is-done";
    const ms = ev.duration_ms == null ? (ev.status === "running" ? "运行中…" : "—") : `${ev.duration_ms} ms`;
    const hot = ev.duration_ms > 3000 ? " hot" : "";
    let row = rows.get(ev.id);
    if (!row) {
      seq += 1;
      row = document.createElement("div");
      row.className = `trace-row ${cls}`;
      row.innerHTML = `<div class="seq num">${String(seq).padStart(2, "0")}</div>
        <div class="kind ${ev.type}">${ev.type}</div>
        <div class="what"><strong>${ev.id}</strong>  ${kv}</div>
        <div class="ms${hot}">${ms}</div>`;
      body.appendChild(row);
      rows.set(ev.id, row);
    } else {
      row.className = `trace-row ${cls}`;
      row.querySelector(".what").innerHTML = `<strong>${ev.id}</strong>  ${kv}`;
      const msEl = row.querySelector(".ms");
      msEl.className = `ms${hot}`;
      msEl.textContent = ms;
    }
    body.scrollTop = body.scrollHeight;
  }

  return {
    reset() {
      rows.clear();
      seq = 0;
      t0 = performance.now();
      body.innerHTML = "";
      ensureEmpty();
      liveDot.className = "dot running";
      liveTxt.textContent = "RUNNING";
    },
    setTitle(t) { titleEl.textContent = t; },
    push(ev) {
      if (ev.type === "token") return;
      if (ev.type === "结果") { liveDot.className = "dot done"; liveTxt.textContent = "DONE"; return; }
      if (ev.type === "错误") { liveDot.className = "dot error"; liveTxt.textContent = "ERROR"; }
      render(ev);
    },
    live(state) {
      liveDot.className = `dot ${state}`;
      liveTxt.textContent = state.toUpperCase();
    },
  };
};

/** 日期显示：今天 / 昨天 / 更早 */
Om.relDay = function (iso) {
  const d = new Date(iso);
  const today = new Date("2026-10-07T23:59:59");
  const diff = Math.floor((today - d) / 86400000);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff <= 7) return `${diff} 天前`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};
Om.hhmm = function (iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 简易分段控件绑定 */
Om.seg = function (root, onChange) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    root.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    onChange && onChange(b.dataset.v, b);
  });
};

window.Om = Om;
