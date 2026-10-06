"use client";

import Link from "next/link";
import { useEffect } from "react";

import AgentPanel from "@/components/AgentPanel";
import Radar from "@/components/Radar";
import { useAgentRun } from "@/lib/agentRun";
import { streamTrainingReport, updateProfile, type TrainingReportOutput } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHistory } from "@/lib/history";
import { usePageState } from "@/lib/pageState";

type LastTraining = {
  question: string;
  answer: string;
  score_summary: string;
  at: number;
};

const PAGE_KEY = "report";

type ReportState = {
  last: LastTraining | null;
  report: TrainingReportOutput | null;
  profileSaved: boolean;
};

const INITIAL: ReportState = { last: null, report: null, profileSaved: false };

export default function ReportPage() {
  const { token } = useAuth();
  const { record } = useHistory();
  const [state, setState] = usePageState<ReportState>(PAGE_KEY, INITIAL);

  const { traces, running, error, setError, run } = useAgentRun(PAGE_KEY);

  const { last, report, profileSaved } = state;

  // 首次进入且没有历史快照时，回落到刷题页留下的本地记录
  useEffect(() => {
    if (state.last) return;
    try {
      const raw = window.localStorage.getItem("offermind_last_training");
      if (raw) setState((prev) => ({ ...prev, last: JSON.parse(raw) as LastTraining }));
    } catch {
      /* 本地记录损坏时忽略 */
    }
    // 只在挂载时兜一次底
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    if (!token || !last) return;
    setState((prev) => ({ ...prev, profileSaved: false }));
    await run(
      streamTrainingReport(token, {
        question: last.question,
        answer: last.answer,
        score_summary: last.score_summary,
      }),
      (output: TrainingReportOutput) => {
        setState((prev) => ({ ...prev, report: output }));
        void record("report", `训练报告｜${last.question.slice(0, 24)}`, {
          last,
          report: output,
          profileSaved: false,
        });
      },
    );
  }

  async function handleSaveProfile() {
    if (!token || !report) return;
    setError("");
    try {
      for (const point of report.weak_points) {
        await updateProfile(token, { knowledge_point: point, mastery: 0.3 });
      }
      setState((prev) => ({ ...prev, profileSaved: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "写入能力画像失败");
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>能力报告</h1>
          <p className="page-sub">汇总一次训练的表现，给出能力雷达与薄弱知识点。</p>
        </div>
      </div>

      {error && (
        <div className="alert alert-bad" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!last && (
        <section className="panel">
          <div className="panel-body empty">
            <p style={{ marginBottom: 12 }}>还没有训练记录。</p>
            <Link href="/practice" className="btn btn-primary">
              去刷题训练
            </Link>
          </div>
        </section>
      )}

      {last && (
        <div className="split">
          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <h3>最近一次训练</h3>
                <span className="chip">
                  {new Date(last.at).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="panel-body stack-sm">
                <div className="q-samples" style={{ maxHeight: 160, overflowY: "auto" }}>
                  {last.question}
                </div>
                <p className="muted">
                  <strong style={{ color: "var(--ink-2)" }}>评分：</strong>
                  {last.score_summary}
                </p>
                <div>
                  <button
                    className="btn btn-primary"
                    onClick={handleGenerate}
                    disabled={running}
                    type="button"
                  >
                    {running ? "生成中…" : report ? "重新生成报告" : "生成训练报告"}
                  </button>
                </div>
              </div>
            </section>

            {report && (
              <>
                <section className="panel">
                  <div className="panel-head">
                    <h3>总体评价</h3>
                  </div>
                  <div className="panel-body">
                    <p style={{ lineHeight: 1.8 }}>{report.summary}</p>
                  </div>
                </section>

                <div className="split" style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}>
                  <section className="panel">
                    <div className="panel-head">
                      <h3>薄弱知识点</h3>
                      <span className="chip chip-bad">{report.weak_points.length} 项</span>
                    </div>
                    <div className="panel-body stack-sm">
                      {report.weak_points.length === 0 && (
                        <p className="muted">本次训练没有明显薄弱点。</p>
                      )}
                      {report.weak_points.map((point, i) => (
                        <div key={i} className="answer-box" style={{ borderLeftColor: "var(--bad)" }}>
                          {point}
                        </div>
                      ))}

                      {report.weak_points.length > 0 && (
                        <div className="btn-row" style={{ marginTop: 4 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={handleSaveProfile}
                            disabled={profileSaved}
                            type="button"
                          >
                            {profileSaved ? "已记入能力画像" : "记入能力画像"}
                          </button>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="panel">
                    <div className="panel-head">
                      <h3>能力雷达</h3>
                    </div>
                    <div className="panel-body" style={{ display: "flex", justifyContent: "center" }}>
                      <Radar data={report.radar} />
                    </div>
                  </section>
                </div>

                <section className="panel">
                  <div className="panel-head">
                    <h3>改进建议</h3>
                  </div>
                  <div className="panel-body stack-sm">
                    {report.suggestions.map((item, i) => (
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
      )}
    </>
  );
}
