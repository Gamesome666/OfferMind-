"use client";

import { useEffect, useRef } from "react";

import AgentPanel from "@/components/AgentPanel";
import Radar from "@/components/Radar";
import { useAgentRun } from "@/lib/agentRun";
import {
  streamInterviewChat,
  streamResumeParse,
  type ChatMessage,
  type InterviewReportOutput,
  type ResumeOutput,
  type StreamEvent,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHistory } from "@/lib/history";
import { clearPageState, usePageState } from "@/lib/pageState";

const DIRECTIONS = ["后端", "前端", "算法"];
const DIFFICULTIES = ["入门", "中级", "高级"];
const STYLES = ["项目深挖", "技术栈深挖", "压力面试"];

const PAGE_KEY = "interview";

/** 一个页面的全部状态，整体存进 pageState，切页面 / 刷新都不丢。 */
type InterviewState = {
  resumeJson: string;
  fileName: string;
  direction: string;
  difficulty: string;
  style: string;
  sessionId: number | null;
  messages: ChatMessage[];
  report: InterviewReportOutput | null;
};

const INITIAL: InterviewState = {
  resumeJson: "",
  fileName: "",
  direction: DIRECTIONS[0],
  difficulty: DIFFICULTIES[1],
  style: STYLES[0],
  sessionId: null,
  messages: [],
  report: null,
};

function Seg({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? "on" : ""}
          onClick={() => onChange(option)}
          disabled={disabled}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export default function InterviewPage() {
  const { token } = useAuth();
  const { refresh } = useHistory();
  const [state, setState] = usePageState<InterviewState>(PAGE_KEY, INITIAL);
  const [draft, setDraft] = usePageState<string>("interview:draft", "");
  const [streaming, setStreaming] = usePageState<string>("interview:streaming", "");

  const { traces, running, error, run } = useAgentRun();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 新消息或流式内容变化时，把对话滚到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.messages.length, streaming]);

  const started = state.messages.length > 0;

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !token) return;
    setState((prev) => ({ ...prev, fileName: file.name }));
    await run(
      streamResumeParse(token, file),
      (output: ResumeOutput & { resume_text: string }) =>
        setState((prev) => ({ ...prev, resumeJson: JSON.stringify(output) })),
    );
  }

  /** 面试对话的统一入口：新会话、发言、总结都走它。 */
  async function chat(
    body: {
      message?: string;
      summarize?: boolean;
    },
  ) {
    if (!token) return;
    // HR 的回复由 token 事件逐字拼出来，先清空上一段的残留
    setStreaming("");
    await run<{ report?: InterviewReportOutput; session_id: number }>(
      streamInterviewChat(token, {
        resume: state.resumeJson,
        direction: state.direction,
        difficulty: state.difficulty,
        style: state.style,
        session_id: state.sessionId,
        message: body.message ?? "",
        summarize: body.summarize ?? false,
      }),
      (output) => {
        const report = output.report;
        if (report) {
          setState((prev) => ({ ...prev, report }));
          // 历史记录由后端在总结时写入，这里只刷新侧栏把它显示出来
          void refresh();
        }
      },
      {
        onEvent: (event: StreamEvent) => {
          if (event.type === "session") {
            const sid = (event.payload as { session_id?: number }).session_id;
            if (sid) setState((prev) => ({ ...prev, sessionId: sid }));
          } else if (event.type === "token") {
            const text = (event.payload as { text?: string }).text ?? "";
            setStreaming((prev) => prev + text);
          } else if (event.type === "hr_message") {
            const content = (event.payload as { content?: string }).content ?? "";
            setState((prev) => ({ ...prev, messages: [...prev.messages, { role: "hr", content }] }));
            setStreaming("");
          }
        },
      },
    );
  }

  async function handleStart() {
    if (!token || !state.resumeJson) return;
    // 新面试：清空上一场
    setState((prev) => ({ ...prev, sessionId: null, messages: [], report: null }));
    setStreaming("");
    await chat({});
  }

  async function handleSend() {
    const text = draft.trim();
    if (!token || !text || running) return;
    setState((prev) => ({ ...prev, messages: [...prev.messages, { role: "user", content: text }] }));
    setDraft("");
    await chat({ message: text });
  }

  async function handleSummarize() {
    if (!token || !state.sessionId || running) return;
    await chat({ summarize: true });
  }

  function handleReset() {
    clearPageState(PAGE_KEY);
    clearPageState("interview:draft");
    clearPageState("interview:streaming");
    setState(INITIAL);
    setStreaming("");
    setDraft("");
  }

  const showReport = state.report !== null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>模拟面试</h1>
          <p className="page-sub">
            像聊天一样和 AI 面试官一问一答，想结束时点「总结面试」出评价与改进建议。
          </p>
        </div>
        {started && (
          <div className="row">
            <button className="btn btn-ghost" onClick={handleReset} type="button">
              重新开始
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSummarize}
              disabled={running || state.messages.length === 0}
              type="button"
            >
              总结面试
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-bad" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="split">
        <div className="stack">
          {!started && (
            <section className="panel">
              <div className="panel-head">
                <h3>面试准备</h3>
                {state.resumeJson && <span className="chip chip-ok">简历已就绪</span>}
              </div>
              <div className="panel-body">
                <div className="field">
                  <label htmlFor="interview-resume">简历（PDF）</label>
                  <input
                    id="interview-resume"
                    className="input"
                    type="file"
                    accept="application/pdf"
                    onChange={handleUpload}
                    disabled={running}
                  />
                </div>
                {state.fileName && (
                  <p className="muted" style={{ marginBottom: 12 }}>
                    文件：<span className="mono">{state.fileName}</span>
                  </p>
                )}

                <div className="field">
                  <label>方向</label>
                  <Seg
                    value={state.direction}
                    options={DIRECTIONS}
                    onChange={(v) => setState((prev) => ({ ...prev, direction: v }))}
                    disabled={running}
                  />
                </div>
                <div className="field">
                  <label>难度</label>
                  <Seg
                    value={state.difficulty}
                    options={DIFFICULTIES}
                    onChange={(v) => setState((prev) => ({ ...prev, difficulty: v }))}
                    disabled={running}
                  />
                </div>
                <div className="field" style={{ marginBottom: 16 }}>
                  <label>追问风格</label>
                  <Seg
                    value={state.style}
                    options={STYLES}
                    onChange={(v) => setState((prev) => ({ ...prev, style: v }))}
                    disabled={running}
                  />
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleStart}
                  disabled={running || !state.resumeJson}
                  type="button"
                >
                  开始面试
                </button>
              </div>
            </section>
          )}

          {started && (
            <section className="panel">
              <div className="panel-head">
                <h3>面试对话</h3>
                <span className="chip chip-agent">{state.style}</span>
              </div>

              <div className="chat">
                {state.messages.map((message, index) => (
                  <div key={index} className={`bubble-row${message.role === "user" ? " me" : ""}`}>
                    <div className={`bubble-avatar ${message.role === "user" ? "me" : "hr"}`}>
                      {message.role === "user" ? "我" : "HR"}
                    </div>
                    <div className={`bubble ${message.role === "user" ? "me" : "hr"}`}>
                      {message.content}
                    </div>
                  </div>
                ))}

                {(streaming || (running && !showReport)) && (
                  <div className="bubble-row">
                    <div className="bubble-avatar hr">HR</div>
                    <div className="bubble hr">
                      <span className={streaming ? "" : "bubble-typing"}>
                        {streaming || "正在思考"}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="chat-compose">
                <textarea
                  className="textarea"
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleSend();
                  }}
                  placeholder="像真实面试一样作答…（Ctrl/⌘ + Enter 发送）"
                  disabled={running}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleSend}
                  disabled={running || !draft.trim()}
                  type="button"
                >
                  发送
                </button>
              </div>
            </section>
          )}

          {showReport && state.report && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <h3>面试总结</h3>
                  <span className="chip chip-primary">总分 {state.report.total_score} / 100</span>
                </div>
                <div className="panel-body">
                  <p style={{ lineHeight: 1.8 }}>{state.report.overall_comment}</p>
                </div>
              </section>

              <div className="split" style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}>
                <section className="panel">
                  <div className="panel-head">
                    <h3>逐轮评价</h3>
                  </div>
                  <div className="panel-body stack-sm">
                    {state.report.round_feedback.map((item, i) => (
                      <div key={i} className="answer-box" style={{ whiteSpace: "normal" }}>
                        <span className="mono muted">第 {i + 1} 轮</span>
                        {"\n"}
                        {item}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-head">
                    <h3>能力雷达</h3>
                  </div>
                  <div className="panel-body" style={{ display: "flex", justifyContent: "center" }}>
                    <Radar data={state.report.radar} />
                  </div>
                </section>
              </div>

              <section className="panel">
                <div className="panel-head">
                  <h3>改进建议</h3>
                </div>
                <div className="panel-body stack-sm">
                  {state.report.improvements.map((item, i) => (
                    <div key={i} className="answer-box suggest" style={{ whiteSpace: "normal" }}>
                      {item}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <div style={{ position: "sticky", top: 28 }}>
          <AgentPanel traces={traces} running={running} />
        </div>
      </div>
    </>
  );
}
