"use client";

import AgentPanel from "@/components/AgentPanel";
import { useAgentRun } from "@/lib/agentRun";
import {
  streamDiagnose,
  streamResumeParse,
  type DiagnoseOutput,
  type JDOutput,
  type ResumeOutput,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHistory } from "@/lib/history";
import { usePageState } from "@/lib/pageState";

const PAGE_KEY = "resume";

/** 页面全部状态存成一个对象，切页面 / 刷新 / 从历史恢复都不丢。 */
type ResumeState = {
  resumeText: string;
  structured: ResumeOutput | null;
  fileName: string;
  jdText: string;
  jdProfile: JDOutput | null;
  diagnosis: DiagnoseOutput | null;
};

const INITIAL: ResumeState = {
  resumeText: "",
  structured: null,
  fileName: "",
  jdText: "",
  jdProfile: null,
  diagnosis: null,
};

export default function ResumePage() {
  const { token } = useAuth();
  const { record } = useHistory();
  const [state, setState] = usePageState<ResumeState>(PAGE_KEY, INITIAL);
  const { traces, running, error, run } = useAgentRun(PAGE_KEY);

  const { resumeText, structured, fileName, jdText, diagnosis } = state;

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !token) return;

    setState((prev) => ({ ...prev, diagnosis: null, structured: null, fileName: file.name }));

    await run(
      streamResumeParse(token, file),
      (output: ResumeOutput & { resume_text: string }) =>
        setState((prev) => ({ ...prev, resumeText: output.resume_text, structured: output })),
    );
  }

  async function handleDiagnose() {
    if (!token || !resumeText.trim() || !jdText.trim()) return;
    await run(
      streamDiagnose(token, { resume_text: resumeText, jd_text: jdText }),
      (output: {
        structured_resume: ResumeOutput;
        jd_profile: JDOutput;
        diagnosis: DiagnoseOutput;
      }) => {
        const next = {
          resumeText,
          structured: output.structured_resume,
          fileName,
          jdText,
          jdProfile: output.jd_profile,
          diagnosis: output.diagnosis,
        };
        setState(next);
        // 记一条历史：侧栏可点开恢复这次诊断
        void record("resume", `${fileName || "简历"} · ${output.jd_profile.position || "岗位"}`, next);
      },
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>简历诊断</h1>
          <p className="page-sub">上传简历并给出目标岗位，得到匹配度与逐条可落地的优化建议。</p>
        </div>
      </div>

      {error && (
        <div className="alert alert-bad" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="split">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h3>第一步 · 上传简历</h3>
              {structured && <span className="chip chip-ok">已解析</span>}
            </div>
            <div className="panel-body">
              <div className="field">
                <label htmlFor="resume-file">PDF 简历</label>
                <input
                  id="resume-file"
                  className="input"
                  type="file"
                  accept="application/pdf"
                  onChange={handleUpload}
                  disabled={running}
                />
              </div>
              {fileName && (
                <p className="muted">
                  文件：<span className="mono">{fileName}</span>
                </p>
              )}
              {structured && (
                <div className="stack-sm" style={{ marginTop: 14 }}>
                  <div className="row" style={{ gap: 6 }}>
                    {structured.skills.slice(0, 8).map((skill) => (
                      <span key={skill} className="chip">
                        {skill}
                      </span>
                    ))}
                  </div>
                  {structured.projects.length > 0 && (
                    <p className="muted">
                      识别到 {structured.projects.length} 段项目经历：
                      {structured.projects.map((p) => p.name).join("、")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>第二步 · 目标岗位 JD</h3>
            </div>
            <div className="panel-body">
              <div className="field" style={{ marginBottom: 14 }}>
                <textarea
                  className="textarea"
                  rows={7}
                  value={jdText}
                  onChange={(e) => setState((prev) => ({ ...prev, jdText: e.target.value }))}
                  placeholder="粘贴目标岗位的 JD 原文，包含岗位职责与任职要求。"
                  disabled={running}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={handleDiagnose}
                disabled={running || !resumeText.trim() || !jdText.trim()}
                type="button"
              >
                {running ? "分析中…" : "开始诊断"}
              </button>
            </div>
          </section>

          {diagnosis && (
            <section className="panel">
              <div className="panel-head">
                <h3>诊断结果</h3>
              </div>
              <div className="panel-body">
                <div className="score-total">
                  <span className="n">{diagnosis.match_score}</span>
                  <span className="d">/ 100 岗位匹配度</span>
                </div>
                <div className="score-bar" style={{ marginBottom: 18 }}>
                  <div className="score-fill" style={{ width: `${diagnosis.match_score}%` }} />
                </div>

                <div className="stack" style={{ gap: 12 }}>
                  {diagnosis.strengths.length > 0 && (
                    <div>
                      <h4 style={{ fontSize: 13, marginBottom: 6, color: "var(--ok)" }}>亮点</h4>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {diagnosis.strengths.map((item, i) => (
                          <li key={i} style={{ marginBottom: 3 }}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {diagnosis.weaknesses.length > 0 && (
                    <div>
                      <h4 style={{ fontSize: 13, marginBottom: 6, color: "var(--warn)" }}>短板</h4>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {diagnosis.weaknesses.map((item, i) => (
                          <li key={i} style={{ marginBottom: 3 }}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {diagnosis.missing_skills.length > 0 && (
                    <div>
                      <h4 style={{ fontSize: 13, marginBottom: 8, color: "var(--bad)" }}>
                        缺失技能
                      </h4>
                      <div className="row" style={{ gap: 6 }}>
                        {diagnosis.missing_skills.map((skill) => (
                          <span key={skill} className="chip chip-bad">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {diagnosis && diagnosis.suggestions.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h3>优化建议</h3>
                <span className="chip chip-primary">{diagnosis.suggestions.length} 条</span>
              </div>
              <div className="panel-body stack-sm">
                {diagnosis.suggestions.map((item, i) => (
                  <div key={i} className="answer-box suggest" style={{ whiteSpace: "normal" }}>
                    {item}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div style={{ position: "sticky", top: 28 }}>
          <AgentPanel traces={traces} running={running} />
        </div>
      </div>
    </>
  );
}
