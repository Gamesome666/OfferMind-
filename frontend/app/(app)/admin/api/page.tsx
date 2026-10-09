"use client";

/**
 * 接口总览与调试台。对应设计稿 admin-api.html。
 *
 * 端点清单**不写死** —— 从后端 /openapi.json 按 tag 分组生成，所以路由函数一改
 * 这里自动跟着变。带 SSE 标记的走 text/event-stream，调试台只收集前若干条事件展示，
 * 不死等 [DONE]（长链路要跑十几秒，等完调试台就卡住了）。
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Seg from "@/components/Seg";
import { useToast } from "@/components/ToastProvider";
import { API_BASE, ApiError, stream, type StreamEvent } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePageScope } from "@/lib/pageScope";

import "./api.css";

type Endpoint = {
  p: string;
  m: string;
  tag: string;
  d: string;
  sse: boolean;
  up: boolean;
  admin: boolean;
  auth: boolean;
};

const TAGS: Record<string, string> = {
  health: "健康检查",
  auth: "认证",
  training: "刷题训练",
  answers: "错题本",
  resume: "简历诊断",
  interview: "模拟面试",
  report: "能力报告",
  history: "历史记录",
  admin: "管理后台",
};

/** 预置请求体。有示例的端点点开就能直接发，不用手敲一遍 JSON。 */
const BODIES: Record<string, unknown> = {
  "/api/v1/auth/register": { email: "new@example.com", password: "offermind123", nickname: "新用户" },
  "/api/v1/auth/login": { email: "admin@offermind.dev", password: "admin123456" },
  "/api/v1/training/question": { direction: "后端", difficulty: "中级", question_type: "八股", weak_points: "" },
  "/api/v1/training/question/stream": { direction: "后端", difficulty: "中级", question_type: "八股", weak_points: "" },
  "/api/v1/training/grade": { question: "谈谈 MySQL 最左前缀原则", answer: "联合索引从最左列开始匹配……", question_id: null },
  "/api/v1/training/grade/stream": { question: "谈谈 MySQL 最左前缀原则", answer: "……", question_id: null },
  "/api/v1/training/followup": { question: "谈谈 MySQL 最左前缀原则", answer: "……", score_summary: "总分 3.4" },
  "/api/v1/training/followup/stream": { question: "……", answer: "……", score_summary: "总分 3.4" },
  "/api/v1/resume/diagnose": { resume_text: "姓名：张三　技能：Python、Redis", jd_text: "后端开发实习生，要求熟悉 Python 与 PostgreSQL。" },
  "/api/v1/resume/diagnose/stream": { resume_text: "姓名：张三　技能：Python、Redis", jd_text: "后端开发实习生，要求熟悉 Python。" },
  "/api/v1/interview/question": { resume: '{"name":"张三","skills":["Python"]}', direction: "后端", difficulty: "中级", style: "项目深挖" },
  "/api/v1/interview/question/stream": { resume: '{"name":"张三"}', direction: "后端", difficulty: "中级", style: "项目深挖" },
  "/api/v1/interview/chat/stream": { resume: '{"name":"张三","skills":["Python"]}', direction: "后端", difficulty: "中级", style: "项目深挖", session_id: null, message: "", summarize: false },
  "/api/v1/interview/report": { config: "方向：后端；难度：中级", rounds: "面试官：……\n候选人：……" },
  "/api/v1/interview/report/stream": { config: "方向：后端", rounds: "面试官：……\n候选人：……" },
  "/api/v1/report/training": { question: "……", answer: "……", score_summary: "总分 3.4", followup: "" },
  "/api/v1/report/training/stream": { question: "……", answer: "……", score_summary: "总分 3.4", followup: "" },
  "/api/v1/report/profile": { knowledge_point: "MySQL 索引", mastery: 0.6, dimension_scores: { 正确性: 3.0, 完整性: 2.8, 表达: 3.5, 术语: 3.6 } },
  "/api/v1/history": { module: "practice", title: "后端·中级｜示例记录", snapshot: { note: "页面快照" }, session_id: null },
  "/api/v1/answers/{answer_id}": { is_wrong: true, is_favorite: false },
  "/api/v1/answers/{answer_id}/review": { quality: 4 },
  "/api/v1/admin/users/{user_id}": { nickname: "改个名", is_admin: false },
  "/api/v1/admin/questions": { direction: "后端", difficulty: "中级", question_type: "八股", content: "题干……", reference_answer: "参考答案……", key_points: "考察点" },
  "/api/v1/admin/questions/{question_id}": { direction: "后端", difficulty: "高级", question_type: "业务", content: "改后的题干……", reference_answer: "", key_points: "" },
  "/api/v1/admin/config": { values: { retrieval_mode: "hybrid", retrieval_top_k: "8" } },
};

const QUERIES: Record<string, [string, string][]> = {
  "/api/v1/answers": [
    ["only_wrong", "false"],
    ["only_favorite", "false"],
    ["limit", "100"],
  ],
  "/api/v1/answers/due": [["limit", "50"]],
  "/api/v1/history": [["module", ""]],
  "/api/v1/admin/users": [["keyword", ""]],
  "/api/v1/admin/questions": [
    ["keyword", ""],
    ["direction", ""],
    ["page", "1"],
    ["size", "20"],
  ],
};

const UPLOAD = new Set(["/api/v1/resume/parse", "/api/v1/resume/parse/stream"]);

type Status = { code: string; text: string; kind: "idle" | "ok" | "err" };

/** 把 JSON 渲染成带语义色的 <pre>。设计稿用的是字符串替换，这里保持同样的四类着色。 */
function syntax(o: unknown): string {
  const escaped = JSON.stringify(o, null, 2)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="s">"$1"</span>')
    .replace(/: (true|false|null)/g, ': <span class="b">$1</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="n">$1</span>');
}

export default function AdminApiPage() {
  const { token } = useAuth();
  const toast = useToast();
  usePageScope("admin-api");

  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [kw, setKw] = useState("");
  const [method, setMethod] = useState("");
  const [onlySse, setOnlySse] = useState(false);

  const [cur, setCur] = useState<Endpoint | null>(null);
  const [tab, setTab] = useState<"params" | "body" | "headers">("params");
  const [pathVars, setPathVars] = useState<Record<string, string>>({});
  const [queryVars, setQueryVars] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("");

  const [status, setStatus] = useState<Status>({ code: "—", text: "未发送", kind: "idle" });
  const [respPill, setRespPill] = useState("等待发送");
  const [out, setOut] = useState("// 选择端点后点「发送请求」");
  const [elapsed, setElapsed] = useState("—");
  const [sending, setSending] = useState(false);

  // 端点清单只拉一次
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        // openapi.json 挂在根路径，不在 /api/v1 下，所以不能走 request()
        const res = await fetch(`${API_BASE}/openapi.json`);
        if (!res.ok) throw new Error(`openapi.json 拉取失败 HTTP ${res.status}`);
        const spec = (await res.json()) as {
          paths: Record<string, Record<string, { tags?: string[]; summary?: string; description?: string }>>;
        };
        const outList: Endpoint[] = [];
        Object.entries(spec.paths).forEach(([path, methods]) => {
          Object.entries(methods).forEach(([m, op]) => {
            const M = m.toUpperCase();
            if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(M)) return;
            outList.push({
              p: path,
              m: M,
              tag: op.tags?.[0] ?? "其他",
              // summary 是后端每个路由函数 docstring 的首行
              d: op.summary || op.description || "",
              sse: path.endsWith("/stream"),
              up: path.includes("/parse") && M === "POST",
              admin: path.startsWith("/api/v1/admin"),
              auth: !path.startsWith("/api/v1/health") && !/\/auth\/(login|register)$/.test(path),
            });
          });
        });
        const order = Object.keys(TAGS);
        outList.sort((a, b) => {
          const ta = order.indexOf(a.tag);
          const tb = order.indexOf(b.tag);
          return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb) || a.p.localeCompare(b.p);
        });
        setEndpoints(outList);
      } catch (ex) {
        setLoadErr(ex instanceof Error ? ex.message : String(ex));
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return endpoints.filter((e) => {
      if (onlySse && !e.sse) return false;
      if (method) {
        if (method === "PATCH/PUT" ? !["PATCH", "PUT"].includes(e.m) : e.m !== method) return false;
      }
      if (k && !(e.p.toLowerCase().includes(k) || e.d.toLowerCase().includes(k))) return false;
      return true;
    });
  }, [endpoints, kw, method, onlySse]);

  const byTag = useMemo(() => {
    const m = new Map<string, Endpoint[]>();
    filtered.forEach((e) => {
      const list = m.get(e.tag) ?? [];
      list.push(e);
      m.set(e.tag, list);
    });
    return m;
  }, [filtered]);

  /** 选中端点：把路径参数与查询参数的初值准备好，请求体填上预置示例。 */
  const pick = useCallback((e: Endpoint) => {
    setCur(e);
    const pv: Record<string, string> = {};
    (e.p.match(/\{[^}]+\}/g) ?? []).forEach((v) => {
      const key = v.slice(1, -1);
      pv[key] = key === "key" ? "retrieval_mode" : "1";
    });
    setPathVars(pv);
    const qv: Record<string, string> = {};
    (QUERIES[e.p] ?? []).forEach(([k, v]) => {
      qv[k] = v;
    });
    setQueryVars(qv);
    const preset = BODIES[e.p];
    setBodyText(preset ? JSON.stringify(preset, null, 2) : ["GET", "DELETE"].includes(e.m) ? "" : "{}");
    setTab("params");
    setStatus({ code: "—", text: "未发送", kind: "idle" });
    setRespPill("等待发送");
    setOut("// 点「发送请求」查看响应");
    setElapsed("—");
  }, []);

  /** 组装最终请求路径：替换路径参数 + 拼查询串（空值不拼）。 */
  const buildPath = useCallback(() => {
    if (!cur) return "";
    let path = cur.p;
    Object.entries(pathVars).forEach(([k, v]) => {
      path = path.replace(new RegExp(`\\{${k}\\}`, "g"), encodeURIComponent(v || "1"));
    });
    const qs: string[] = [];
    Object.entries(queryVars).forEach(([k, v]) => {
      if (v !== "") qs.push(`${k}=${encodeURIComponent(v)}`);
    });
    return qs.length ? `${path}?${qs.join("&")}` : path;
  }, [cur, pathVars, queryVars]);

  async function send() {
    if (!cur || !token) return;
    if (UPLOAD.has(cur.p)) {
      setStatus({ code: "—", text: "需要真实文件，调试台跳过", kind: "idle" });
      setRespPill("跳过");
      setOut(
        syntax({
          detail: "这是 multipart 上传端点，调试台不发真实文件。请到「简历诊断」页上传 PDF 验证。",
        }),
      );
      return;
    }

    let body: unknown;
    const raw = bodyText.trim();
    if (raw && !["GET", "DELETE"].includes(cur.m)) {
      try {
        body = JSON.parse(raw);
      } catch (ex) {
        setStatus({
          code: "JSON 解析失败",
          text: ex instanceof Error ? ex.message : String(ex),
          kind: "err",
        });
        setRespPill("失败");
        return;
      }
    }

    // openapi 里的路径自带 /api/v1，而 lib/api 的 stream() 会再拼一次前缀，
    // 所以发请求前先剥掉，避免拼成 /api/v1/api/v1/...
    const path = buildPath();
    const apiPath = path.replace(/^\/api\/v1/, "");
    const t0 = performance.now();
    setSending(true);
    setRespPill("请求中…");
    setStatus({ code: "…", text: "请求中", kind: "idle" });

    // ---- 流式端点：收集前若干条事件就收尾，不阻塞在 [DONE] 上 ----
    if (cur.sse) {
      const events: StreamEvent[] = [];
      try {
        await Promise.race([
          (async () => {
            for await (const ev of stream(apiPath, body, token)) {
              events.push(ev);
              if (events.length >= 12) break;
            }
          })(),
          // 兜底：12 秒没攒够也收尾，避免调试台卡住
          new Promise((r) => setTimeout(r, 12000)),
        ]);
        const ms = Math.round(performance.now() - t0);
        setElapsed(`${ms} ms`);
        setStatus({ code: "SSE 流", text: `${ms} ms · text/event-stream`, kind: "ok" });
        setRespPill("成功");
        setOut(
          syntax({
            _content_type: "text/event-stream",
            _note: "流式端点：响应体是一串 data: 行，每行一个 step event，末尾 data: [DONE]",
            received: events.length,
            events: events.slice(0, 8),
          }),
        );
        toast("ok", "流式已连通", `${cur.m} ${cur.p} · 收到 ${events.length} 条事件 · ${ms} ms`);
      } catch (ex) {
        const ms = Math.round(performance.now() - t0);
        setElapsed(`${ms} ms`);
        setStatus({ code: "ERR", text: `${ms} ms`, kind: "err" });
        setRespPill("失败");
        setOut(syntax({ detail: ex instanceof Error ? ex.message : String(ex) }));
        toast("err", "请求失败", ex instanceof Error ? ex.message : String(ex));
      } finally {
        setSending(false);
      }
      return;
    }

    // ---- 普通端点 ----
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await fetch(`${API_BASE}${path}`, {
        method: cur.m,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const ms = Math.round(performance.now() - t0);
      setElapsed(`${ms} ms`);
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { _raw: text.slice(0, 2000) };
      }
      if (res.ok) {
        setStatus({ code: `HTTP ${res.status} OK`, text: `${ms} ms · application/json`, kind: "ok" });
        setRespPill("成功");
        toast("ok", "请求完成", `${cur.m} ${cur.p} · ${ms} ms`);
      } else {
        setStatus({ code: `HTTP ${res.status}`, text: `${ms} ms`, kind: "err" });
        setRespPill("失败");
        toast("err", `HTTP ${res.status}`, cur.p);
      }
      setOut(syntax(parsed));
    } catch (ex) {
      const ms = Math.round(performance.now() - t0);
      setElapsed(`${ms} ms`);
      const msg = ex instanceof ApiError ? ex.message : ex instanceof Error ? ex.message : String(ex);
      setStatus({ code: "ERR", text: `${ms} ms`, kind: "err" });
      setRespPill("失败");
      setOut(syntax({ detail: msg }));
      toast("err", "请求失败", msg);
    } finally {
      setSending(false);
    }
  }

  async function health() {
    if (!token) return;
    const t0 = performance.now();
    try {
      const get = async (p: string) => {
        const r = await fetch(`${API_BASE}/api/v1${p}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      };
      const [h, r] = await Promise.all([get("/health"), get("/health/ready")]);
      const ms = Math.round(performance.now() - t0);
      const target = endpoints.find((e) => e.p === "/api/v1/health/ready");
      if (target) pick(target);
      setStatus({ code: "HTTP 200 OK", text: `${ms} ms · application/json`, kind: "ok" });
      setRespPill("成功");
      setElapsed(`${ms} ms`);
      setOut(syntax({ ...(r.body as object), _probe_health: h.body }));
      toast("ok", "服务健康", "postgres / redis / qdrant 与本地模型状态见响应体");
    } catch (ex) {
      toast("err", "健康检查失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  const linkCount = endpoints.length;

  return (
    <div data-page="api">
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin · API Surface</div>
          <div className="title-row" style={{ marginTop: 7 }}>
            <h1 className="h1">接口总览</h1>
            <span className="pill accent">
              {linkCount ? `${linkCount} 端点 · 当前 ${filtered.length}` : loadErr ? "端点清单加载失败" : "加载中…"}
            </span>
            <span className="pill">统一前缀 /api/v1</span>
          </div>
          <p className="lead" style={{ marginTop: 8, fontSize: 14 }}>
            全部端点与后端 <code className="mono">app/api/v1/*</code> 一一对应。带 <b>SSE</b> 标记的走{" "}
            <code className="mono">text/event-stream</code>，每步推同 id 的 running / done 双事件。
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void health()} type="button">
            健康检查
          </button>
          <Link className="btn btn-ghost" href="/admin">
            返回概览
          </Link>
        </div>
      </div>

      <div className="split">
        {/* ============ 左：清单 ============ */}
        <section className="card" style={{ overflow: "hidden" }}>
          <div className="apibar">
            <div className="search">
              <input
                className="input"
                placeholder="搜索路径或说明"
                value={kw}
                onChange={(e) => setKw(e.target.value)}
              />
            </div>
            <Seg
              options={[
                { value: "", label: "全部" },
                { value: "GET", label: "GET" },
                { value: "POST", label: "POST" },
                { value: "PATCH/PUT", label: "写" },
                { value: "DELETE", label: "DELETE" },
              ]}
              value={method}
              onChange={setMethod}
            />
            <span className="spacer" style={{ marginLeft: "auto" }} />
            <label className="check">
              <input
                type="checkbox"
                checked={onlySse}
                onChange={(e) => setOnlySse(e.target.checked)}
              />
              <span>只看流式</span>
            </label>
          </div>

          <div style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
            {loadErr ? (
              <div className="empty" style={{ border: 0, background: "transparent", padding: 50 }}>
                <div className="t">拉不到 /openapi.json</div>
                <div className="d">{loadErr}。确认后端已在 :8000 运行。</div>
              </div>
            ) : byTag.size === 0 ? (
              <div className="empty" style={{ border: 0, background: "transparent", padding: 50 }}>
                <div className="glyph">⌗</div>
                <div className="t">没有匹配的端点</div>
                <div className="d">换个关键词，或清掉筛选条件。</div>
              </div>
            ) : (
              [...byTag.entries()].map(([tag, eps]) => (
                <div className="tagblock" key={tag}>
                  <div className="taghead">
                    <span className="t">{TAGS[tag] ?? tag}</span>
                    <span className="c">{eps.length}</span>
                    <span className="grow" />
                    <span className="cap mono">{`tags=["${tag}"]`}</span>
                  </div>
                  {eps.map((e) => (
                    <button
                      className={`eprow${cur?.p === e.p && cur.m === e.m ? " on" : ""}`}
                      key={`${e.m} ${e.p}`}
                      onClick={() => pick(e)}
                      type="button"
                    >
                      <span className={`m m-${e.m}`}>{e.m}</span>
                      <span>
                        <span className="p" style={{ display: "block" }}>
                          {e.p}
                        </span>
                        <span className="cap" style={{ display: "block", marginTop: 2 }}>
                          {e.d}
                        </span>
                      </span>
                      <span className="flags">
                        {e.sse && <span className="pill accent">SSE</span>}
                        {e.up && <span className="pill info">上传</span>}
                        {e.admin && <span className="pill danger">ADMIN</span>}
                        {!e.auth && <span className="pill">公开</span>}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </section>

        {/* ============ 右：调试台 ============ */}
        <div className="console">
          <section className="card">
            <div className="card-head">
              <div className="h3">请求调试台</div>
              <span className="pill mono">
                {!cur ? (
                  "—"
                ) : cur.admin ? (
                  <>
                    <span className="dot warn" />
                    需要管理员
                  </>
                ) : cur.auth ? (
                  <>
                    <span className="dot done" />
                    需要 Bearer
                  </>
                ) : (
                  <>
                    <span className="dot" />
                    公开端点
                  </>
                )}
              </span>
            </div>
            <div className="card-body">
              <div className="urlbar">
                <span className={`m m-${cur?.m ?? "GET"}`}>{cur?.m ?? "GET"}</span>
                <span className="u">{cur ? buildPath() : "选择左侧任意端点"}</span>
              </div>
              <p className="hint mt-2">
                {cur ? cur.d : "点一条端点，这里会出现它的请求构造与响应。"}
              </p>

              <div className="tabsmini mt-4">
                {(
                  [
                    ["params", "参数"],
                    ["body", "请求体"],
                    ["headers", "请求头"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    aria-selected={tab === v}
                    onClick={() => setTab(v)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="pane">
                {tab === "params" &&
                  (!cur ? (
                    <p className="hint">未选择端点。</p>
                  ) : !Object.keys(pathVars).length && !Object.keys(queryVars).length ? (
                    <p className="hint">此端点没有路径参数与查询参数。</p>
                  ) : (
                    <>
                      {Object.keys(pathVars).map((k) => (
                        <div className="kvrow" key={`p-${k}`}>
                          <span className="k">
                            <b>path</b> {`{${k}}`}
                          </span>
                          <input
                            className="input mono"
                            value={pathVars[k]}
                            onChange={(ev) =>
                              setPathVars((s) => ({ ...s, [k]: ev.target.value }))
                            }
                          />
                        </div>
                      ))}
                      {Object.keys(queryVars).map((k) => (
                        <div className="kvrow" key={`q-${k}`}>
                          <span className="k">
                            <b>query</b> {k}
                          </span>
                          <input
                            className="input mono"
                            placeholder="留空则不发送"
                            value={queryVars[k]}
                            onChange={(ev) =>
                              setQueryVars((s) => ({ ...s, [k]: ev.target.value }))
                            }
                          />
                        </div>
                      ))}
                    </>
                  ))}

                {tab === "body" &&
                  (!cur ? (
                    <p className="hint">未选择端点。</p>
                  ) : UPLOAD.has(cur.p) ? (
                    <div className="drop" style={{ padding: 18 }}>
                      <div className="drop-ico">⇪</div>
                      <div style={{ fontSize: 13, fontWeight: 540 }}>multipart/form-data</div>
                      <div className="hint mt-1">
                        字段名 <code className="mono">file</code> · 调试台不发真实文件，请在简历页上传
                      </div>
                    </div>
                  ) : (
                    <textarea
                      className="textarea mono"
                      style={{ minHeight: 200, fontSize: 11.5 }}
                      value={bodyText}
                      onChange={(e) => setBodyText(e.target.value)}
                    />
                  ))}

                {tab === "headers" && (
                  <>
                    <div className="kvrow">
                      <span className="k">Content-Type</span>
                      <input
                        className="input mono"
                        disabled
                        value={
                          cur && UPLOAD.has(cur.p)
                            ? "multipart/form-data; boundary=..."
                            : "application/json"
                        }
                      />
                    </div>
                    <div className="kvrow">
                      <span className="k">Authorization</span>
                      <input
                        className="input mono"
                        disabled
                        value={token ? `Bearer ${token.slice(0, 18)}…` : "（未登录）"}
                      />
                    </div>
                    <div className="kvrow">
                      <span className="k">Accept</span>
                      <input
                        className="input mono"
                        disabled
                        value={cur?.sse ? "text/event-stream" : "application/json"}
                      />
                    </div>
                    <p className="hint mt-2">
                      跨域由后端 CORSMiddleware 放行（正则匹配 localhost / 127.0.0.1 任意端口）。
                    </p>
                  </>
                )}
              </div>

              <div className="row mt-4" style={{ gap: 9 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => void send()}
                  disabled={!cur || sending}
                  type="button"
                >
                  {sending ? "请求中…" : "发送请求"}
                </button>
                <span className="grow" />
                <span className="cap mono">{elapsed}</span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">响应</div>
              <span className={`pill${respPill === "成功" ? " success" : respPill === "失败" ? " danger" : ""}`}>
                {respPill}
              </span>
            </div>
            <div className="card-body">
              <div className="statusline" style={{ marginBottom: 12 }}>
                <span className={`code ${status.kind === "ok" ? "ok" : status.kind === "err" ? "err" : ""}`}>
                  {status.code}
                </span>
                <span>{status.text}</span>
              </div>
              <pre className="out" dangerouslySetInnerHTML={{ __html: out }} />
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">鉴权与隔离约定</div>
            </div>
            <div className="card-body">
              <div className="stack-sm" style={{ fontSize: 12.5 }}>
                <div className="tokenbox">
                  Authorization: <b>Bearer &lt;jwt&gt;</b> · 由 POST /auth/login 签发
                </div>
                <div className="tokenbox">
                  数据隔离：所有查询强制 <b>user_id</b> 过滤
                </div>
                <div className="tokenbox">
                  跨用户访问 → <b>404</b>（不是 403，避免泄露记录是否存在）
                </div>
                <div className="tokenbox">
                  管理端点挂在 <b>get_current_admin</b> 之下，非管理员一律 <b>403</b>
                </div>
                <div className="tokenbox">
                  SSE 响应头：<b>X-Accel-Buffering: no</b>（关闭反向代理缓冲）
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
