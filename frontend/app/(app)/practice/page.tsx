"use client";

import AgentPanel from "@/components/AgentPanel";
import { useAgentRun } from "@/lib/agentRun";
import {
  streamFollowup,
  streamGrade,
  streamQuestion,
  type FollowupOutput,
  type GradeOutput,
  type QuestionOutput,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHistory } from "@/lib/history";
import { usePageState } from "@/lib/pageState";

const DIRECTIONS = ["后端", "前端", "算法"];
const DIFFICULTIES = ["入门", "中级", "高级"];
const TYPES = ["八股", "算法", "业务"];

const DIMENSIONS = [
  { key: "correctness", label: "正确性" },
  { key: "completeness", label: "完整性" },
  { key: "clarity", label: "表达结构" },
  { key: "terminology", label: "术语准确" },
] as const;

const PAGE_KEY = "practice";

/** 页面全部状态存成一个对象，整体存进 pageState —— 历史恢复时整块灌回来即可。 */
type PracticeState = {
  direction: string;
  difficulty: string;
  type: string;
  question: QuestionOutput | null;
  answer: string;
  showAnswer: boolean;
  grade: GradeOutput | null;
  followup: FollowupOutput | null;
};

const INITIAL: PracticeState = {
  direction: DIRECTIONS[0],
  difficulty: DIFFICULTIES[1],
  type: TYPES[0],
  question: null,
  answer: "",
  showAnswer: false,
  grade: null,
  followup: null,
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

export default function PracticePage() {
  const { token } = useAuth();
  const { record } = useHistory();
  const [state, setState] = usePageState<PracticeState>(PAGE_KEY, INITIAL);
  const { traces, running, error, run } = useAgentRun(PAGE_KEY);

  const questionText = state.question
    ? state.question.samples
      ? `${state.question.content}\n\n${state.question.samples}`
      : state.question.content
    : "";

  async function handleGenerate() {
    if (!token) return;
    setState((prev) => ({
      ...prev,
      question: null,
      grade: null,
      followup: null,
      answer: "",
      showAnswer: false,
    }));
    await run(
      streamQuestion(token, {
        direction: state.direction,
        difficulty: state.difficulty,
        question_type: state.type,
        weak_points: "",
      }),
      (output: QuestionOutput) => setState((prev) => ({ ...prev, question: output })),
    );
  }

  async function handleGrade() {
    if (!token || !state.question || !state.answer.trim()) return;
    setState((prev) => ({ ...prev, followup: null }));
    await run(streamGrade(token, { question: questionText, answer: state.answer }), (result: GradeOutput) => {
      setState((prev) => ({ ...prev, grade: result }));
      // 留存最近一次训练，供「能力报告」页生成报告使用
      const summary = DIMENSIONS.map((dim) => `${dim.label} ${result[dim.key].score}/5`).join("，");
      window.localStorage.setItem(
        "offermind_last_training",
        JSON.stringify({
          question: questionText,
          answer: state.answer,
          score_summary: `${summary}，总分 ${result.total_score}`,
          at: Date.now(),
        }),
      );
      // 记一条历史：侧栏可点开恢复这次的题目 / 作答 / 评分
      void record("practice", `${state.direction}·${state.difficulty}｜${questionText.slice(0, 28)}`, {
        direction: state.direction,
        difficulty: state.difficulty,
        type: state.type,
        question: state.question,
        answer: state.answer,
        showAnswer: false,
        grade: result,
        followup: null,
      });
    });
  }

  async function handleFollowup() {
    if (!token || !state.question || !state.grade) return;
    const summary = DIMENSIONS.map(
      (dim) => `${dim.label} ${state.grade![dim.key].score}/5`,
    ).join("，");
    await run(
      streamFollowup(token, {
        question: questionText,
        answer: state.answer,
        score_summary: `${summary}，总分 ${state.grade.total_score}`,
      }),
      (output: FollowupOutput) => setState((prev) => ({ ...prev, followup: output })),
    );
  }

  const { direction, difficulty, type, question, answer, showAnswer, grade, followup } = state;
  const busy = running;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>刷题训练</h1>
          <p className="page-sub">选定方向与难度出题，作答后获得四维评分与逐轮追问。</p>
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
              <h3>出题条件</h3>
            </div>
            <div className="panel-body">
              <div className="field">
                <label>技术方向</label>
                <Seg
                  value={direction}
                  options={DIRECTIONS}
                  onChange={(v) => setState((prev) => ({ ...prev, direction: v }))}
                  disabled={busy}
                />
              </div>
              <div className="field">
                <label>难度</label>
                <Seg
                  value={difficulty}
                  options={DIFFICULTIES}
                  onChange={(v) => setState((prev) => ({ ...prev, difficulty: v }))}
                  disabled={busy}
                />
              </div>
              <div className="field" style={{ marginBottom: 16 }}>
                <label>题型</label>
                <Seg
                  value={type}
                  options={TYPES}
                  onChange={(v) => setState((prev) => ({ ...prev, type: v }))}
                  disabled={busy}
                />
              </div>
              <button className="btn btn-primary" onClick={handleGenerate} disabled={busy} type="button">
                {busy ? "执行中…" : "出题"}
              </button>
            </div>
          </section>

          {question && (
            <section className="panel">
              <div className="panel-head">
                <h3>题目</h3>
                <div className="row" style={{ gap: 6 }}>
                  <span className="chip chip-primary">{direction}</span>
                  <span className="chip">{difficulty}</span>
                  <span className="chip">{type}</span>
                </div>
              </div>
              <div className="panel-body stack">
                <div className="q-body">{question.content}</div>
                {question.samples && <div className="q-samples">{question.samples}</div>}
                {question.key_points && (
                  <div className="muted">
                    <strong style={{ color: "var(--ink-2)" }}>考察点：</strong>
                    {question.key_points}
                  </div>
                )}
                {question.reference_answer && (
                  <div>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => setState((prev) => ({ ...prev, showAnswer: !prev.showAnswer }))}
                    >
                      {showAnswer ? "隐藏参考答案" : "查看参考答案"}
                    </button>
                    {showAnswer && (
                      <div className="answer-box" style={{ marginTop: 10 }}>
                        {question.reference_answer}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {question && (
            <section className="panel">
              <div className="panel-head">
                <h3>你的作答</h3>
              </div>
              <div className="panel-body">
                <div className="field">
                  <textarea
                    className="textarea code"
                    rows={7}
                    value={answer}
                    onChange={(e) => setState((prev) => ({ ...prev, answer: e.target.value }))}
                    placeholder="写下你的回答。算法题可直接写代码并说明思路。"
                    disabled={busy}
                  />
                </div>
                <div className="btn-row">
                  <button
                    className="btn btn-primary"
                    onClick={handleGrade}
                    disabled={busy || !answer.trim()}
                    type="button"
                  >
                    提交评分
                  </button>
                  {grade && (
                    <button
                      className="btn btn-ghost"
                      onClick={handleFollowup}
                      disabled={busy}
                      type="button"
                    >
                      继续追问
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {grade && (
            <section className="panel">
              <div className="panel-head">
                <h3>评分结果</h3>
                <span className="chip chip-primary">四维加权</span>
              </div>
              <div className="panel-body">
                <div className="score-total">
                  <span className="n">{grade.total_score.toFixed(2)}</span>
                  <span className="d">/ 5.00 加权总分</span>
                </div>

                <div className="score-grid">
                  {DIMENSIONS.map((dim) => {
                    const item = grade[dim.key];
                    return (
                      <div key={dim.key}>
                        <div className="score-row">
                          <span className="score-name">{dim.label}</span>
                          <div className="score-bar">
                            <div
                              className="score-fill"
                              style={{ width: `${(item.score / 5) * 100}%` }}
                            />
                          </div>
                          <span className="score-val">{item.score}/5</span>
                        </div>
                        <p className="muted" style={{ marginTop: 4, paddingLeft: 102 }}>
                          {item.reason}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="stack-sm" style={{ marginTop: 18 }}>
                  {grade.strengths && (
                    <div className="answer-box">
                      <strong>做得好的地方</strong>
                      {"\n"}
                      {grade.strengths}
                    </div>
                  )}
                  {grade.suggestions && (
                    <div className="answer-box suggest">
                      <strong>可以改进的地方</strong>
                      {"\n"}
                      {grade.suggestions}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {grade?.reference_answer && (
            <section className="panel">
              <div className="panel-head">
                <h3>评分依据</h3>
                <span className="chip chip-ok">评分时检索到的题库参考</span>
              </div>
              <div className="panel-body">
                <div className="answer-box">{grade.reference_answer}</div>
              </div>
            </section>
          )}

          {followup && (
            <section className="panel">
              <div className="panel-head">
                <h3>追问</h3>
                <span className="chip chip-agent">针对上一次作答</span>
              </div>
              <div className="panel-body stack">
                <div className="q-body">{followup.question}</div>
                {followup.key_points && (
                  <div className="muted">
                    <strong style={{ color: "var(--ink-2)" }}>考察点：</strong>
                    {followup.key_points}
                  </div>
                )}
                <div className="answer-box">{followup.reference_answer}</div>
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
