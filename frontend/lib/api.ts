/** API 客户端与类型定义。 */

// 直连后端，不走 next.config 的 rewrites 代理：Next 的 rewrite 会把整个 SSE 响应缓冲到
// 请求结束才交给浏览器，执行面板就拿不到「进行中」的分步事件。跨域由后端 CORSMiddleware 放行。
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";
const API = `${API_BASE}/api/v1`;

/* ---------- 类型 ---------- */

export type User = { id: number; email: string; nickname: string; is_admin?: boolean };

export type Trace = {
  id?: string; // 步骤唯一标识（后端原值，用于展示）
  // 合并用的键 = 运行序号 + id。同一页面上多次执行会跑同一个节点（如模拟面试的多轮
  // 都会跑 interview_question），不加序号的话后一轮会把前一轮的轨迹覆盖掉。
  // 与 `id` 分开是因为面板要显示干净的 `retrieve:向量化`，而不是 `2:retrieve:向量化`。
  runKey?: string;
  type: string; // 检索 / 模型 / 工具 / 结果 / 错误
  status?: "running" | "done";
  payload: Record<string, unknown>;
  duration_ms?: number | null;
};

// SSE 里除了步骤事件，还有两类特殊事件：
// - token：面试对话时 HR 逐字吐出的文本分片
// - session / hr_message / 结果 / 错误：控制类事件
export type StreamEvent = Trace & { type: string };

export type QuestionOutput = {
  content: string;
  samples: string;
  key_points: string;
  reference_answer: string;
};

export type DimensionScore = { score: number; reason: string };

export type GradeOutput = {
  correctness: DimensionScore;
  completeness: DimensionScore;
  clarity: DimensionScore;
  terminology: DimensionScore;
  total_score: number;
  strengths: string;
  suggestions: string;
  reference_answer: string;
};

export type FollowupOutput = {
  question: string;
  reference_answer: string;
  key_points: string;
};

export type ProjectItem = { name: string; description: string; tech_stack: string };

export type ResumeOutput = {
  name: string;
  education: string;
  skills: string[];
  projects: ProjectItem[];
  work_experience: string;
  summary: string;
};

export type JDOutput = {
  position: string;
  responsibilities: string[];
  required_skills: string[];
  preferred_skills: string[];
};

export type DiagnoseOutput = {
  match_score: number;
  strengths: string[];
  weaknesses: string[];
  missing_skills: string[];
  suggestions: string[];
};

export type InterviewQuestionOutput = {
  question: string;
  reference_answer: string;
  key_points: string;
};

export type InterviewReportOutput = {
  total_score: number;
  overall_comment: string;
  round_feedback: string[];
  improvements: string[];
  radar: Record<string, number>;
};

export type TrainingReportOutput = {
  summary: string;
  weak_points: string[];
  suggestions: string[];
  radar: Record<string, number>;
};

/* ---------- 基础请求 ---------- */

export class ApiError extends Error {}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = `请求失败（${res.status}）`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (Array.isArray(body?.detail)) detail = body.detail[0]?.msg ?? detail;
    } catch {
      /* 保留默认错误信息 */
    }
    throw new ApiError(detail);
  }
  return res.json() as Promise<T>;
}

/* ---------- 认证 ---------- */

export function register(email: string, password: string, nickname: string) {
  return request<User>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, nickname }),
  });
}

export function login(email: string, password: string) {
  return request<{ access_token: string; token_type: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function me(token: string) {
  return request<User>("/auth/me", {}, token);
}

/* ---------- 报告画像 ---------- */

export function updateProfile(
  token: string,
  body: { knowledge_point: string; mastery: number; dimension_scores?: Record<string, number> },
) {
  return request<{ status: string }>(
    "/report/profile",
    { method: "POST", body: JSON.stringify(body) },
    token,
  );
}

/** 能力画像条目：工作台的雷达图与「最该补的短板」都从这里来。 */
export type ProfileItem = {
  knowledge_point: string;
  mastery: number;
  dimension_scores: Record<string, number>;
};

export function getProfile(token: string) {
  return request<ProfileItem[]>("/report/profile", {}, token);
}

/* ---------- SSE 流式 ---------- */

export async function* stream(
  path: string,
  body: unknown,
  token: string,
): AsyncGenerator<StreamEvent> {
  // 简历解析走 multipart，此时不能自己设 Content-Type，否则会丢掉 boundary
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (!isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: isForm ? body : JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let detail = `请求失败（${res.status}）`;
    try {
      const b = await res.json();
      if (typeof b?.detail === "string") detail = b.detail;
    } catch {
      /* 忽略 */
    }
    throw new ApiError(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data) as StreamEvent;
      } catch {
        /* 跳过无法解析的事件 */
      }
    }
  }
}

/**
 * 把一条流式链路跑完，返回最终「结果」事件的 payload。
 *
 * `stream()` 是异步生成器，适合"边推边渲染"（执行面板要逐步显示）。但多步流程——
 * 简历的「解析 PDF → 再诊断」、面试的「多轮对话 → 再总结」——需要"等这一步跑完再决定
 * 下一步"，回调式的 `useAgentRun.run()` 用起来别扭。这里是它的 await 版。
 *
 * 静态设计稿里 `Om.sseAsync` 承担同样的职责。失败时抛 ApiError，调用方 catch 后提示。
 */
export async function streamToResult<T>(
  path: string,
  body: unknown,
  token: string,
  onEvent?: (event: StreamEvent) => void,
): Promise<T | null> {
  let result: T | null = null;
  for await (const event of stream(path, body, token)) {
    onEvent?.(event);
    if (event.type === "错误") {
      const message = (event.payload as { message?: string })?.message;
      throw new ApiError(message || "流式请求失败");
    }
    if (event.type === "结果") {
      result = event.payload as T;
    }
  }
  return result;
}

export const streamQuestion = (token: string, body: unknown) =>
  stream("/training/question/stream", body, token);
export const streamGrade = (token: string, body: unknown) =>
  stream("/training/grade/stream", body, token);
export const streamFollowup = (token: string, body: unknown) =>
  stream("/training/followup/stream", body, token);

/* ---------- 简历 / 面试 / 报告 的流式 ---------- */

export function streamResumeParse(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return stream("/resume/parse/stream", form, token);
}

export const streamDiagnose = (token: string, body: unknown) =>
  stream("/resume/diagnose/stream", body, token);

export const streamInterviewQuestion = (token: string, body: unknown) =>
  stream("/interview/question/stream", body, token);

export const streamInterviewReport = (token: string, body: unknown) =>
  stream("/interview/report/stream", body, token);

export const streamTrainingReport = (token: string, body: unknown) =>
  stream("/report/training/stream", body, token);

export const streamInterviewChat = (token: string, body: unknown) =>
  stream("/interview/chat/stream", body, token);

/* ---------- 历史记录 ---------- */

export type HistoryModule = "practice" | "resume" | "interview" | "report";

export type HistoryItem = {
  id: number;
  module: HistoryModule;
  title: string;
  snapshot: Record<string, unknown>;
  session_id: number | null;
  updated_at: string;
};

export function listHistory(token: string, module?: HistoryModule) {
  const query = module ? `?module=${module}` : "";
  return request<HistoryItem[]>(`/history${query}`, {}, token);
}

export function createHistory(
  token: string,
  body: { module: HistoryModule; title: string; snapshot: Record<string, unknown>; session_id?: number | null },
) {
  return request<{ id: number }>("/history", { method: "POST", body: JSON.stringify(body) }, token);
}

export function deleteHistory(token: string, id: number) {
  return request<{ status: string }>(`/history/${id}`, { method: "DELETE" }, token);
}

/* ---------- 面试会话 ---------- */

export type ChatMessage = { role: "hr" | "user"; content: string };

export type SessionOut = {
  id: number;
  status: string;
  config: { direction?: string; difficulty?: string; style?: string; resume?: string };
  messages: ChatMessage[];
  report: InterviewReportOutput | Record<string, never>;
};

export function getSession(token: string, id: number) {
  return request<SessionOut>(`/interview/sessions/${id}`, {}, token);
}

/** 会话列表项：后端已联表带出轮数与总分，列表卡片不用再逐场查。 */
export type SessionBrief = {
  id: number;
  status: string;
  config: { direction?: string; difficulty?: string; style?: string };
  updated_at: string;
  rounds: number;
  total_score: number | null;
};

export function listSessions(token: string) {
  return request<SessionBrief[]>("/interview/sessions", {}, token);
}

/* ---------- 管理员后台 ---------- */

export type AdminUser = {
  id: number;
  email: string;
  nickname: string;
  is_admin: boolean;
  created_at: string;
};

export type AdminQuestion = {
  id: number;
  direction: string;
  difficulty: string;
  question_type: string;
  content: string;
  reference_answer: string;
  key_points: string;
  embedding_ref: string;
  created_at: string;
};

export type ConfigItem = {
  key: string;
  label: string;
  default: string;
  value: string;
  /** kind === "secret" 时，value 恒为空串（不回显密钥），用这个字段判断「到底配没配」 */
  has_value: boolean;
  overridden: boolean;
  description: string;
  kind: "text" | "select" | "bool" | "number" | "secret";
  options: string[];
};

export type LlmPreset = {
  key: string;
  label: string;
  base_url: string;
  note: string;
};

export type LlmOptions = {
  presets: LlmPreset[];
  models: string[];
  /** live = 从端点实时拉到；fallback = 拉取失败，给的是静态候选 */
  source: "live" | "fallback";
  error: string;
};

export function adminStats(token: string) {
  return request<{ users: number; questions: number }>("/admin/stats", {}, token);
}

export function adminListUsers(token: string, keyword = "") {
  return request<AdminUser[]>(`/admin/users?keyword=${encodeURIComponent(keyword)}`, {}, token);
}

export function adminUpdateUser(
  token: string,
  id: number,
  body: { nickname?: string; is_admin?: boolean; password?: string },
) {
  return request<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token);
}

export function adminDeleteUser(token: string, id: number) {
  return request<{ status: string }>(`/admin/users/${id}`, { method: "DELETE" }, token);
}

export function adminListQuestions(
  token: string,
  params: { keyword?: string; direction?: string; page?: number; size?: number } = {},
) {
  const query = new URLSearchParams();
  if (params.keyword) query.set("keyword", params.keyword);
  if (params.direction) query.set("direction", params.direction);
  query.set("page", String(params.page ?? 1));
  query.set("size", String(params.size ?? 20));
  return request<{ total: number; page: number; size: number; items: AdminQuestion[] }>(
    `/admin/questions?${query.toString()}`,
    {},
    token,
  );
}

export function adminCreateQuestion(
  token: string,
  body: Omit<AdminQuestion, "id" | "embedding_ref" | "created_at">,
) {
  return request<{ id: number }>("/admin/questions", { method: "POST", body: JSON.stringify(body) }, token);
}

export function adminUpdateQuestion(
  token: string,
  id: number,
  body: Omit<AdminQuestion, "id" | "embedding_ref" | "created_at">,
) {
  return request<{ id: number }>(`/admin/questions/${id}`, { method: "PUT", body: JSON.stringify(body) }, token);
}

export function adminDeleteQuestion(token: string, id: number) {
  return request<{ status: string }>(`/admin/questions/${id}`, { method: "DELETE" }, token);
}

export function adminGetConfig(token: string) {
  return request<ConfigItem[]>("/admin/config", {}, token);
}

/** 模型下拉框的候选：服务商预置 + 从当前端点实时拉到的模型 id */
export function adminLlmOptions(token: string) {
  return request<LlmOptions>("/admin/llm/options", {}, token);
}

export function adminUpdateConfig(token: string, values: Record<string, string>) {
  return request<ConfigItem[]>("/admin/config", { method: "PUT", body: JSON.stringify({ values }) }, token);
}

export function adminResetConfig(token: string, key: string) {
  return request<ConfigItem[]>(`/admin/config/${key}`, { method: "DELETE" }, token);
}

/* ---------- 错题本 / 间隔重复 ---------- */

export type AnswerItem = {
  id: number;
  question_id: number;
  question_content: string;
  // 后端 /answers 联表顺带带出的题目元信息，列表页直接用，不必再查题
  question_direction: string;
  question_difficulty: string;
  question_type: string;
  answer_content: string;
  score_json: {
    correctness?: DimensionScore;
    completeness?: DimensionScore;
    clarity?: DimensionScore;
    terminology?: DimensionScore;
    total_score?: number;
    strengths?: string;
    suggestions?: string;
  };
  total_score: number;
  is_wrong: boolean;
  is_favorite: boolean;
  review_due_at: string | null;
  review_interval_days: number;
  review_count: number;
  created_at: string;
};

export type AnswerStats = { total: number; wrong: number; favorite: number; due: number };

export function answerStats(token: string) {
  return request<AnswerStats>("/answers/stats", {}, token);
}

export function listAnswers(
  token: string,
  params: { onlyWrong?: boolean; onlyFavorite?: boolean; limit?: number } = {},
) {
  const q = new URLSearchParams();
  if (params.onlyWrong) q.set("only_wrong", "true");
  if (params.onlyFavorite) q.set("only_favorite", "true");
  if (params.limit) q.set("limit", String(params.limit));
  const query = q.toString();
  return request<AnswerItem[]>(`/answers${query ? `?${query}` : ""}`, {}, token);
}

export function listDueAnswers(token: string, limit = 50) {
  return request<AnswerItem[]>(`/answers/due?limit=${limit}`, {}, token);
}

export function updateAnswerFlags(
  token: string,
  id: number,
  body: { is_wrong?: boolean; is_favorite?: boolean },
) {
  return request<AnswerItem>(`/answers/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token);
}

/** 复习一次。quality 是 0-5 的回忆质量，不传则用上次总分。 */
export function reviewAnswer(token: string, id: number, quality?: number) {
  return request<AnswerItem>(
    `/answers/${id}/review`,
    { method: "POST", body: JSON.stringify({ quality: quality ?? null }) },
    token,
  );
}
