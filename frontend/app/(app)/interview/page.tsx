"use client";

/**
 * 模拟面试。对应设计稿 interview.html。
 *
 * 一问一答：HR 说一句 → 候选人回一句 → HR 接着追问，想结束时点「总结面试」。
 * HR 的回复按 token 流式逐字出现（后端推 `token` 事件，见 app/agent/interview_chat.py）。
 *
 * `session_id` 为空表示开新面试（后端建会话），之后每轮带上同一个 id。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Radar from "@/components/Radar";
import TracePanel, { type LiveState } from "@/components/TracePanel";
import { useToast } from "@/components/ToastProvider";
import { useAgentRun } from "@/lib/agentRun";
import {
  getSession,
  listSessions,
  streamInterviewChat,
  type InterviewReportOutput,
  type SessionBrief,
  type StreamEvent,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { hhmm, relDay } from "@/lib/format";
import { usePageScope } from "@/lib/pageScope";
import { useSnapshot } from "@/lib/pageState";

import "./interview.css";

const DIRECTIONS = ["后端", "前端", "算法", "数据库"];
const DIFFICULTIES = ["初级", "中级", "高级"];
const STYLES = ["项目深挖", "压力面", "八股连问", "系统设计"];
const RESUME_PLACEHOLDER = '{"name":"马乾恩","skills":["Python","FastAPI","LangGraph","Qdrant"]}';

type Msg = { role: "hr" | "user"; content: string };
type ChatResult = { report?: InterviewReportOutput; reply?: string; session_id: number };

export default function InterviewPage() {
  const { token } = useAuth();
  const toast = useToast();
  usePageScope("interview");

  const { traces, running, error, run } = useAgentRun("interview");
  const chatEnd = useRef<HTMLDivElement>(null);

  const [direction, setDirection] = useState(DIRECTIONS[0]);
  const [difficulty, setDifficulty] = useState(DIFFICULTIES[1]);
  const [style, setStyle] = useState(STYLES[0]);
  const [resumeJson, setResumeJson] = useState(RESUME_PLACEHOLDER);

  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState("");
  const [report, setReport] = useState<InterviewReportOutput | null>(null);
  const [sessions, setSessions] = useState<SessionBrief[]>([]);
  const [draft, setDraft] = useState("");

  const [traceTitle, setTraceTitle] = useState("等待执行");
  const [live, setLive] = useState<LiveState>("idle");

  // 历史恢复用的快照。面试的历史记录是**后端**在「总结面试」时写的
  // （见 app/agent/service.py 的 summarize 分支），所以这里的字段名必须与它对齐：
  // sessionId / direction / difficulty / style / resumeJson / messages / report
  const snapshot = useMemo(
    () => ({ sessionId, direction, difficulty, style, resumeJson, messages, report }),
    [sessionId, direction, difficulty, style, resumeJson, messages, report],
  );

  useSnapshot<typeof snapshot>("interview", snapshot, (stored) => {
    setSessionId(stored.sessionId);
    setDirection(stored.direction);
    setDifficulty(stored.difficulty);
    setStyle(stored.style);
    setResumeJson(stored.resumeJson);
    setMessages(stored.messages);
    setReport(stored.report && stored.report.total_score ? stored.report : null);
    setDraft("");
    setStreaming("");
  });

  const turn = messages.filter((m) => m.role === "hr").length;
  const finished = report !== null;

  const loadSessions = useCallback(async () => {
    if (!token) return;
    try {
      setSessions(await listSessions(token));
    } catch {
      /* 列表加载失败不影响对话 */
    }
  }, [token]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming]);

  /**
   * 对话的统一入口：开场 / 发言 / 总结都走它。
   *
   * `sessionIdOverride` 只有「开始新面试」会传 null —— 那里刚 setSessionId(null)，
   * 而 setState 是异步的，直接读 sessionId 拿到的还是上一场的 id，新面试会写进旧会话。
   */
  async function chat(
    body: { message?: string; summarize?: boolean },
    title: string,
    sessionIdOverride?: number | null,
  ) {
    if (!token) return;
    const sid = sessionIdOverride === undefined ? sessionId : sessionIdOverride;
    setStreaming("");
    setTraceTitle(title);
    setLive("running");

    let sawHrMessage = false;
    await run<ChatResult>(
      streamInterviewChat(token, {
        resume: resumeJson,
        direction,
        difficulty,
        style,
        session_id: sid,
        message: body.message ?? "",
        summarize: body.summarize ?? false,
      }),
      (out) => {
        if (out?.report) {
          setReport(out.report);
          void loadSessions();
        } else if (out?.reply && !sawHrMessage) {
          // 兜底：这一轮如果只收到「结果」而没收到 hr_message，回复会凭空消失
          setMessages((prev) => [...prev, { role: "hr", content: out.reply as string }]);
        }
      },
      {
        onEvent: (ev: StreamEvent) => {
          if (ev.type === "session") {
            const newId = (ev.payload as { session_id?: number }).session_id;
            if (newId) setSessionId(newId);
          } else if (ev.type === "token") {
            const t = (ev.payload as { text?: string }).text ?? "";
            setStreaming((prev) => prev + t);
          } else if (ev.type === "hr_message") {
            sawHrMessage = true;
            const content = (ev.payload as { content?: string }).content ?? "";
            setMessages((prev) => [...prev, { role: "hr", content }]);
            setStreaming("");
          }
        },
      },
    );
    setLive((l) => (l === "running" ? "done" : l));
    setStreaming("");
  }

  async function handleStart() {
    if (!token || running) return;
    if (!resumeJson.trim()) {
      toast("err", "缺少简历依据", "面试官要基于简历深挖提问，请填结构化简历 JSON。");
      return;
    }
    setSessionId(null);
    setMessages([]);
    setReport(null);
    setDraft("");
    await chat({}, "interview/chat/stream · 开场", null);
    void loadSessions();
  }

  async function handleSend() {
    const text = draft.trim();
    if (!token || !text || running || !sessionId) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setDraft("");
    await chat({ message: text }, `interview/chat/stream · turn ${turn + 1}`);
    void loadSessions();
  }

  async function handleSummarize() {
    if (!token || running || !sessionId || turn === 0) return;
    await chat({ summarize: true }, "interview/chat/stream · summarize");
  }

  async function openSession(id: number) {
    if (!token) return;
    try {
      const s = await getSession(token, id);
      setSessionId(id);
      setMessages(s.messages);
      setReport(s.report && s.report.total_score ? (s.report as InterviewReportOutput) : null);
      setDraft("");
      setStreaming("");
      toast("info", "已载入会话", `恢复 ${s.messages.length} 条消息，无需重跑模型`);
    } catch (ex) {
      toast("err", "会话不存在", ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function handleLoad() {
    const active = sessions.find((s) => s.status === "active") ?? sessions[0];
    if (!active) return toast("info", "没有会话", "还没有面试记录。");
    await openSession(active.id);
  }

  const canSend = Boolean(sessionId) && !running && !finished;

  return (
    <div data-page="interview">
      <div className="page-head">
        <div>
          <div className="eyebrow">Interview · 一问一答压力面</div>
          <div className="title-row" style={{ marginTop: 7 }}>
            <h1 className="h1">模拟面试</h1>
            <span className="pill" id="sess-pill">
              {sessionId ? `会话 #${sessionId} · ${finished ? "已总结" : "进行中"}` : "未开始"}
            </span>
            {streaming && (
              <span className="pill accent" id="stream-pill">
                <span className="dot running" />
                HR 正在回复
              </span>
            )}
          </div>
        </div>
        <div className="actions">
          <button className="btn" id="btn-load" onClick={handleLoad} type="button">
            载入历史会话
          </button>
          <button
            className="btn btn-accent"
            id="btn-sum"
            onClick={handleSummarize}
            disabled={running || turn === 0 || finished}
            type="button"
          >
            总结面试
          </button>
          <button
            className="btn btn-primary"
            id="btn-start"
            onClick={handleStart}
            disabled={running}
            type="button"
          >
            开始新面试
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-bad" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="grid g-main-side">
        {/* ===== 左：对话 ===== */}
        <div className="stack">
          <section className="card" style={{ padding: 16 }}>
            <div
              className="cfgbar"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,minmax(0,1fr)) minmax(0,1.6fr)",
                gap: 14,
                alignItems: "end",
              }}
            >
              <div className="field">
                <label className="label">方向</label>
                <select
                  className="select"
                  id="dir"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  disabled={running}
                >
                  {DIRECTIONS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">难度</label>
                <select
                  className="select"
                  id="diff"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  disabled={running}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">面试风格</label>
                <select
                  className="select"
                  id="style"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  disabled={running}
                >
                  {STYLES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">
                  简历依据 <span className="cap">结构化简历 JSON</span>
                </label>
                <input
                  className="input mono"
                  id="resume"
                  value={resumeJson}
                  onChange={(e) => setResumeJson(e.target.value)}
                  disabled={running}
                />
              </div>
            </div>
          </section>

          <div className="chatwrap">
            <div className="chathead">
              <div className="who">HR</div>
              <div className="grow">
                <div className="nm">AI 面试官</div>
                <div className="st" id="chat-st">
                  {sessionId
                    ? `${direction} · ${difficulty} · ${style}`
                    : "等待开场 · 未建立会话"}
                </div>
              </div>
              <span className="pill mono" id="turn-pill">
                第 {turn} 轮
              </span>
            </div>

            <div className="chatscroll" id="chat">
              {messages.length === 0 && !streaming && (
                <div className="empty" style={{ border: 0, background: "transparent" }}>
                  <div className="t">还没有对话</div>
                  <div className="d">
                    填好简历依据后点「开始新面试」，HR 会先做自我介绍再抛出第一个问题。
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div className={`bubble ${m.role === "hr" ? "hr" : "me"}`} key={i}>
                  <span className="who">{m.role === "hr" ? "HR" : "我"}</span>
                  <div className="body">{m.content}</div>
                </div>
              ))}
              {(streaming || (running && !finished && messages.length > 0)) && (
                <div className="bubble hr">
                  <span className="who">HR</span>
                  <div className="body">
                    {streaming || "正在思考"}
                    <span className="caret" />
                  </div>
                </div>
              )}
              <div ref={chatEnd} />
            </div>

            <div className="composer">
              <div className="box">
                <textarea
                  className="textarea"
                  id="msg"
                  placeholder="像在真实面试里一样回答。HR 会根据你的上一句继续追问。"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  disabled={!canSend}
                />
                <button
                  className="btn btn-accent btn-lg"
                  id="btn-send"
                  onClick={handleSend}
                  disabled={!canSend || !draft.trim()}
                  type="button"
                >
                  发送
                </button>
              </div>
              <div className="hintline">
                <span className="hint">
                  按{" "}
                  <kbd
                    className="mono"
                    style={{ border: "1px solid var(--border-strong)", borderRadius: 3, padding: "0 4px" }}
                  >
                    Ctrl
                  </kbd>{" "}
                  +{" "}
                  <kbd
                    className="mono"
                    style={{ border: "1px solid var(--border-strong)", borderRadius: 3, padding: "0 4px" }}
                  >
                    Enter
                  </kbd>{" "}
                  快速发送
                </span>
                <span className="cap" id="tok">
                  回复按 token 逐字出现
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ===== 右：可观测 + 会话 ===== */}
        <div className="side">
          <TracePanel events={traces} title={traceTitle} live={live} />

          <section className="card">
            <div className="card-head">
              <div className="h3">历史会话</div>
              <span className="small">随时可回到任意一场</span>
            </div>
            <div className="card-body tight" id="sessions">
              {sessions.length === 0 ? (
                <div className="empty" style={{ border: 0, background: "transparent" }}>
                  <div className="d">还没有面试记录。</div>
                </div>
              ) : (
                sessions.map((s) => (
                  <button
                    className={`sess${s.id === sessionId ? " on" : ""}`}
                    key={s.id}
                    onClick={() => void openSession(s.id)}
                    type="button"
                  >
                    <span className={`sc${s.total_score == null ? " dim" : ""}`}>
                      {s.total_score ?? "—"}
                    </span>
                    <span>
                      <span className="nm">
                        {s.config.direction ?? "—"} · {s.config.difficulty ?? "—"} ·{" "}
                        {s.config.style ?? "—"}
                      </span>
                      <span className="cap" style={{ display: "block", marginTop: 2 }}>
                        {s.rounds} 轮 · {relDay(s.updated_at)} {hhmm(s.updated_at)}
                      </span>
                    </span>
                    <span className={`pill ${s.status === "finished" ? "success" : "accent"}`}>
                      {s.status === "finished" ? "已总结" : "进行中"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          {report && (
            <section className="card" id="repcard">
              <div className="card-head">
                <div className="h3">面试报告</div>
                <span className="pill success">已总结</span>
              </div>
              <div className="card-body">
                <div className="rep-score">
                  <div>
                    <div className="n" id="rep-total">
                      {report.total_score}
                    </div>
                    <div className="cap mono">/ 100 总分</div>
                  </div>
                  <p className="lead" style={{ fontSize: 13 }}>
                    {report.overall_comment}
                  </p>
                </div>
                <hr className="hair" />
                <div className="eyebrow">能力雷达</div>
                <div className="mt-2" style={{ display: "grid", placeItems: "center" }}>
                  <Radar values={report.radar} size={236} />
                </div>
                <div className="eyebrow mt-4">逐轮评价</div>
                <ul className="roundfb mt-2">
                  {report.round_feedback.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <div className="eyebrow mt-4">改进建议</div>
                <ul className="roundfb mt-2">
                  {report.improvements.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
