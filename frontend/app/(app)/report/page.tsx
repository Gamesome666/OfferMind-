"use client";

/**
 * 能力报告。对应设计稿 report.html。
 *
 * 两块东西：
 * - **单次报告**：回答「这一次答得怎么样」。训练报告取材于 history 快照
 *   （刷题页评分时会写一条，里面存了题目/作答/评分），面试报告取材于会话对话。
 * - **能力画像**：回答「这一个月我长进了没有」。数据来自 GET /report/profile。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import Modal from "@/components/Modal";
import Radar from "@/components/Radar";
import Seg from "@/components/Seg";
import TracePanel, { type LiveState } from "@/components/TracePanel";
import { useToast } from "@/components/ToastProvider";
import { useAgentRun } from "@/lib/agentRun";
import {
  getProfile,
  getSession,
  listHistory,
  listSessions,
  streamInterviewReport,
  streamTrainingReport,
  updateProfile,
  type HistoryItem,
  type InterviewReportOutput,
  type ProfileItem,
  type SessionBrief,
  type TrainingReportOutput,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHistory } from "@/lib/history";
import { usePageScope } from "@/lib/pageScope";
import { useSnapshot } from "@/lib/pageState";

import "./report.css";

type Mode = "training" | "interview";
type Source = { id: number; title: string; meta: string; snapshot?: Record<string, unknown> };

function toneOf(m: number): string {
  if (m >= 70) return "success";
  if (m >= 55) return "accent";
  if (m >= 45) return "warn";
  return "danger";
}

function labelOf(m: number): string {
  if (m >= 70) return "已掌握";
  if (m >= 55) return "基本掌握";
  if (m >= 45) return "不稳固";
  return "待补强";
}

export default function ReportPage() {
  const { token } = useAuth();
  const toast = useToast();
  const { record } = useHistory();
  usePageScope("report");

  const { traces, running, error, run } = useAgentRun("report");

  const [mode, setMode] = useState<Mode>("training");
  const [sources, setSources] = useState<Source[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [loadingSrc, setLoadingSrc] = useState(true);

  const [trainingReport, setTrainingReport] = useState<TrainingReportOutput | null>(null);
  const [interviewReport, setInterviewReport] = useState<InterviewReportOutput | null>(null);
  const [profile, setProfile] = useState<ProfileItem[]>([]);

  const [traceTitle, setTraceTitle] = useState("等待执行");
  const [live, setLive] = useState<LiveState>("idle");

  // 手动更新画像弹层
  const [adding, setAdding] = useState(false);
  const [kpName, setKpName] = useState("");
  const [kpMastery, setKpMastery] = useState("0.6");
  const [saving, setSaving] = useState(false);

  const loadSources = useCallback(
    async (which: Mode) => {
      if (!token) return;
      setLoadingSrc(true);
      try {
        if (which === "training") {
          const hist = await listHistory(token);
          const list = hist
            .filter((h: HistoryItem) => h.module === "practice" || h.module === "report")
            .map((h) => ({
              id: h.id,
              title: h.title,
              meta: `${String(h.updated_at).slice(0, 16).replace("T", " ")} · history #${h.id}`,
              snapshot: h.snapshot,
            }));
          setSources(list);
          // 保留仍然有效的选中项：历史恢复会把 sourceId 一起灌进来，
          // 无条件重置成第一条的话，恢复出来的报告会挂到错误的来源上
          setPicked((prev) => (list.some((s) => s.id === prev) ? prev : (list[0]?.id ?? null)));
        } else {
          const sessions: SessionBrief[] = await listSessions(token);
          const list = sessions.map((s) => ({
            id: s.id,
            title: `${s.config.direction ?? "—"} · ${s.config.difficulty ?? "—"} · ${s.config.style ?? "—"}｜${s.rounds} 轮`,
            meta: `session #${s.id} · ${s.status === "finished" ? "已总结" : "进行中"}`,
          }));
          setSources(list);
          setPicked((prev) => (list.some((s) => s.id === prev) ? prev : (list[0]?.id ?? null)));
        }
      } catch (ex) {
        setSources([]);
        toast("err", "来源列表加载失败", ex instanceof Error ? ex.message : String(ex));
      } finally {
        setLoadingSrc(false);
      }
    },
    [token, toast],
  );

  const loadProfile = useCallback(async () => {
    if (!token) return;
    try {
      setProfile(await getProfile(token));
    } catch (ex) {
      toast("err", "画像加载失败", ex instanceof Error ? ex.message : String(ex));
    }
  }, [token, toast]);

  useEffect(() => {
    void loadSources(mode);
  }, [loadSources, mode]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function generate() {
    if (!token || running || picked == null) return;
    setLive("running");

    try {
      if (mode === "training") {
        const src = sources.find((s) => s.id === picked);
        const snap = (src?.snapshot ?? {}) as {
          question?: { content?: string; samples?: string };
          answer?: string;
          grade?: {
            correctness?: { score?: number };
            completeness?: { score?: number };
            clarity?: { score?: number };
            terminology?: { score?: number };
            total_score?: number;
          };
        };
        const q = snap.question ?? {};
        const text = q.samples ? `${q.content ?? ""}\n\n${q.samples}` : (q.content ?? "");
        if (!text) {
          throw new Error("这条历史里没有题目快照，换一条（只有含作答快照的记录才能生成报告）");
        }
        const g = snap.grade ?? {};
        const dims = ["correctness", "completeness", "clarity", "terminology"] as const;
        const summary =
          dims.map((k) => `${k} ${g[k]?.score ?? "—"}/5`).join("，") + `，总分 ${g.total_score ?? "—"}`;

        setTraceTitle("report/training/stream");
        let out: TrainingReportOutput | null = null;
        await run<TrainingReportOutput>(
          streamTrainingReport(token, {
            question: text,
            answer: snap.answer ?? "",
            score_summary: summary,
            followup: "",
          }),
          (r) => {
            out = r;
          },
        );
        if (!out) throw new Error("没有收到报告");
        const rep = out as TrainingReportOutput;
        setTrainingReport(rep);
        setInterviewReport(null);
        toast("ok", "报告已生成", "训练报告已就绪");
      } else {
        setTraceTitle("interview/report/stream");
        const s = await getSession(token, picked);
        const c = s.config ?? {};
        const configText = `方向：${c.direction ?? ""}；难度：${c.difficulty ?? ""}；风格：${c.style ?? ""}`;
        const roundsText = s.messages
          .map((m) => `${m.role === "hr" ? "面试官" : "候选人"}：${m.content}`)
          .join("\n\n");
        if (!roundsText) throw new Error("这场面试还没有对话内容");

        let out: InterviewReportOutput | null = null;
        await run<InterviewReportOutput>(
          streamInterviewReport(token, { config: configText, rounds: roundsText }),
          (r) => {
            out = r;
          },
        );
        if (!out) throw new Error("没有收到报告");
        const rep = out as InterviewReportOutput;
        setInterviewReport(rep);
        setTrainingReport(null);
        toast("ok", "报告已生成", `面试总分 ${rep.total_score} / 100`);
      }
      setLive("done");
    } catch (ex) {
      setLive("error");
      toast("err", "生成失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function saveHistory() {
    const rep = mode === "training" ? trainingReport : interviewReport;
    if (!rep) return toast("err", "还没有报告", "先生成一份报告再存。");
    if (!token) return;
    try {
      await record(
        "report",
        `${mode === "training" ? "训练报告" : "面试报告"}｜来源 #${picked}`,
        { report: rep, mode, sourceId: picked },
      );
      toast("ok", "已存入历史", "侧栏「报告」分组下可以找到并恢复现场");
    } catch (ex) {
      toast("err", "保存失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function submitProfile() {
    if (!token) return;
    const kp = kpName.trim();
    const mv = Number(kpMastery);
    if (!kp) return toast("err", "知识点必填", "knowledge_point 是 upsert 的唯一键。");
    if (!(mv >= 0 && mv <= 1)) return toast("err", "掌握度越界", "mastery 必须在 0 到 1 之间。");
    setSaving(true);
    try {
      await updateProfile(token, { knowledge_point: kp, mastery: mv });
      setAdding(false);
      setKpName("");
      await loadProfile();
      toast("ok", "画像已更新", `${kp} · mastery = ${mv.toFixed(2)}`);
    } catch (ex) {
      toast("err", "保存失败", ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSaving(false);
    }
  }

  // 历史恢复用的快照。字段名必须与 saveHistory() 里写出去的一致（整块覆盖）
  const snapshot = useMemo(
    () => ({
      mode,
      sourceId: picked,
      report: mode === "training" ? trainingReport : interviewReport,
    }),
    [mode, picked, trainingReport, interviewReport],
  );

  useSnapshot<typeof snapshot>("report", snapshot, (stored) => {
    setMode(stored.mode);
    setPicked(stored.sourceId);
    if (stored.mode === "training") {
      setTrainingReport(stored.report as TrainingReportOutput | null);
      setInterviewReport(null);
    } else {
      setInterviewReport(stored.report as InterviewReportOutput | null);
      setTrainingReport(null);
    }
  });

  const radarValues: Record<string, number> = {};
  profile.forEach((p) => {
    radarValues[p.knowledge_point] = Math.round(p.mastery * 100);
  });

  const rep = mode === "training" ? trainingReport : interviewReport;
  const isTraining = mode === "training" && trainingReport !== null;

  const radarOf = rep?.radar ?? {};
  const weakList = trainingReport?.weak_points ?? interviewReport?.round_feedback ?? [];
  const sugList = trainingReport?.suggestions ?? interviewReport?.improvements ?? [];
  const summaryText = trainingReport?.summary ?? interviewReport?.overall_comment ?? "";

  return (
    <div data-page="report">
      <div className="page-head">
        <div>
          <div className="eyebrow">Report · 训练报告与长期能力画像</div>
          <div className="title-row" style={{ marginTop: 7 }}>
            <h1 className="h1">能力报告</h1>
            <span className="pill">{mode === "training" ? "训练报告" : "面试报告"}</span>
          </div>
          <p className="lead" style={{ marginTop: 8, fontSize: 14 }}>
            单次报告回答「这一次答得怎么样」，能力画像回答「这一个月我长进了没有」。
            画像数据来自每一条作答记录的四维分数聚合。
          </p>
        </div>
        <div className="actions">
          <button
            className="btn"
            id="btn-profile"
            onClick={() => void loadProfile()}
            type="button"
          >
            重新聚合画像
          </button>
          <button
            className="btn btn-primary"
            id="btn-gen"
            onClick={generate}
            disabled={running || picked == null}
            type="button"
          >
            {running ? "生成中…" : "生成报告"}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-bad" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="grid g-main-side">
        {/* ===== 左 ===== */}
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <div className="h3">报告来源</div>
              <Seg
                options={[
                  { value: "training", label: "训练报告" },
                  { value: "interview", label: "面试报告" },
                ]}
                value={mode}
                onChange={(v) => {
                  setMode(v as Mode);
                  setTrainingReport(null);
                  setInterviewReport(null);
                }}
              />
            </div>
            <div className="card-body">
              <div className="srcpick" id="srcs">
                {loadingSrc ? (
                  <div className="empty" style={{ border: 0, background: "transparent" }}>
                    <div className="d">加载中…</div>
                  </div>
                ) : sources.length === 0 ? (
                  <div className="empty" style={{ border: 0, background: "transparent" }}>
                    <div className="d">
                      {mode === "training"
                        ? "还没有训练记录。去刷题训练答一次题就会出现在这里。"
                        : "还没有面试记录。去模拟面试聊一轮就会出现在这里。"}
                    </div>
                  </div>
                ) : (
                  sources.map((s) => (
                    <button
                      className={`src${s.id === picked ? " on" : ""}`}
                      key={s.id}
                      onClick={() => setPicked(s.id)}
                      type="button"
                    >
                      <div>
                        <div className="t">{s.title}</div>
                        <div className="m">{s.meta}</div>
                      </div>
                      <span className={`pill${s.id === picked ? " accent" : ""}`}>
                        {s.id === picked ? "选中" : "选择"}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className="row-between mt-3">
                <span className="hint" id="endpoint">
                  {mode === "training" ? "基于选中的一次训练生成" : "基于选中的一场面试生成"}
                </span>
                <button
                  className="btn btn-accent"
                  id="btn-gen2"
                  onClick={generate}
                  disabled={running || picked == null}
                  type="button"
                >
                  生成报告
                </button>
              </div>
            </div>
          </section>

          {/* 报告正文 */}
          {rep && (
            <section className="card" id="rcard">
              <div className="card-head">
                <div className="h3">{isTraining ? "训练报告" : "面试报告"}</div>
                <span className={`pill${isTraining ? "" : " success"}`}>
                  {isTraining ? `来源 history #${picked}` : `session #${picked}`}
                </span>
              </div>
              <div className="card-body">
                <div className="rep-hero">
                  <div style={{ display: "grid", placeItems: "center" }}>
                    <Radar values={radarOf} size={216} />
                  </div>
                  <div>
                    <div className="eyebrow">总体评价</div>
                    <p className="verdict mt-2">{summaryText}</p>
                    <div className="kv mt-4">
                      {isTraining ? (
                        <>
                          <div className="cell">
                            <div className="k">雷达维度</div>
                            <div className="v">{Object.keys(radarOf).length}</div>
                          </div>
                          <div className="cell">
                            <div className="k">薄弱点</div>
                            <div className="v">{weakList.length}</div>
                          </div>
                          <div className="cell">
                            <div className="k">建议数</div>
                            <div className="v">{sugList.length}</div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="cell">
                            <div className="k">总分</div>
                            <div className="v">{interviewReport?.total_score}</div>
                          </div>
                          <div className="cell">
                            <div className="k">逐轮评价</div>
                            <div className="v">{weakList.length}</div>
                          </div>
                          <div className="cell">
                            <div className="k">雷达维度</div>
                            <div className="v">{Object.keys(radarOf).length}</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <hr className="hair" />
                <div className="grid g-2">
                  <div>
                    <div className="eyebrow">{isTraining ? "薄弱点" : "逐轮评价"}</div>
                    <ul className="notes bad mt-3">
                      {weakList.map((x, i) => (
                        <li key={i}>
                          <span className="b">!</span>
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="eyebrow">改进建议</div>
                    <ul className="notes good mt-3">
                      {sugList.map((x, i) => (
                        <li key={i}>
                          <span className="b">✓</span>
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
              <div className="card-foot">
                <span className="small">
                  报告生成后会写一条 history（module=report），侧栏可一键恢复现场
                </span>
                <button className="btn btn-sm" id="btn-save" onClick={saveHistory} type="button">
                  存入历史
                </button>
              </div>
            </section>
          )}

          {/* 能力画像 */}
          <section className="card">
            <div className="card-head">
              <div className="h3">能力画像</div>
              <div className="row">
                <span className="pill" id="kp-n">
                  {profile.length} 个知识点
                </span>
              </div>
            </div>
            <div className="card-body tight" id="kp-list">
              {profile.length === 0 ? (
                <div className="empty" style={{ border: 0, background: "transparent" }}>
                  <div className="d">
                    还没有画像数据。训练后在报告页点「存入历史」或手动添加知识点。
                  </div>
                </div>
              ) : (
                [...profile]
                  .sort((a, b) => b.mastery - a.mastery)
                  .map((p) => {
                    const m = Math.round(p.mastery * 100);
                    const tone = toneOf(m);
                    return (
                      <div className="kp-row" key={p.knowledge_point}>
                        <div>
                          <div className="nm">
                            {p.knowledge_point}
                            <span className={`pill ${tone}`}>{labelOf(m)}</span>
                          </div>
                          <div className="bar">
                            <i className={tone} style={{ width: `${m}%` }} />
                          </div>
                        </div>
                        <div className="pct">{m}%</div>
                        <div className="dims">
                          {Object.entries(p.dimension_scores ?? {}).map(([k, v]) => (
                            <span title={k} key={k}>
                              {k.slice(0, 1)}
                              {Number(v).toFixed(1)}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
            <div className="card-foot">
              <span className="small">
                掌握度 = 该知识点下所有作答四维加权总分的归一化均值
              </span>
              <button
                className="btn btn-sm"
                id="btn-add"
                onClick={() => setAdding(true)}
                type="button"
              >
                手动更新画像
              </button>
            </div>
          </section>
        </div>

        {/* ===== 右 ===== */}
        <div className="side">
          <TracePanel events={traces} title={traceTitle} live={live} />

          <section className="card">
            <div className="card-head">
              <div className="h3">画像雷达</div>
              <span className="pill">长期</span>
            </div>
            <div
              className="card-body"
              style={{ display: "grid", placeItems: "center", padding: "16px 10px" }}
            >
              {profile.length >= 3 ? (
                <Radar values={radarValues} size={268} />
              ) : (
                <div className="empty" style={{ border: 0, background: "transparent" }}>
                  <div className="d">少于 3 个知识点画不出雷达。</div>
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">画像字段</div>
              <span className="small">长期累积</span>
            </div>
            <div className="card-body">
              <div className="stack-sm" style={{ fontSize: 12.5 }}>
                <div className="row-between">
                  <span className="dim">knowledge_point</span>
                  <span className="mono">String(128)</span>
                </div>
                <div className="row-between">
                  <span className="dim">mastery</span>
                  <span className="mono">Float 0–1</span>
                </div>
                <div className="row-between">
                  <span className="dim">dimension_scores</span>
                  <span className="mono">JSON 文本</span>
                </div>
                <div className="row-between">
                  <span className="dim">唯一键</span>
                  <span className="mono">(user_id, knowledge_point)</span>
                </div>
              </div>
              <p className="hint mt-3">upsert 语义：同一知识点重复更新会覆盖掌握度，不新增行。</p>
            </div>
          </section>
        </div>
      </div>

      {/* ==================== 手动更新画像 ==================== */}
      <Modal
        open={adding}
        title="手动更新能力画像"
        onClose={() => setAdding(false)}
        foot={
          <>
            <button className="btn" onClick={() => setAdding(false)} type="button">
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void submitProfile()}
              disabled={saving}
              type="button"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label">
            知识点 <span className="req">*</span>
          </label>
          <input
            className="input"
            placeholder="如：MySQL 索引"
            value={kpName}
            onChange={(e) => setKpName(e.target.value)}
          />
          <span className="hint">与已有知识点同名时会覆盖（upsert），不会新增一行。</span>
        </div>
        <div className="field mt-3">
          <label className="label">
            掌握度 mastery <span className="cap">0 – 1</span>
          </label>
          <input
            className="input mono"
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={kpMastery}
            onChange={(e) => setKpMastery(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
