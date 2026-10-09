"use client";

/**
 * 刷题训练。对应设计稿 practice.html。
 *
 * 三条 SSE 链路：出题（含查重回退）、四维评分、追问。
 * 评分结果会落进 answers 表 —— 它同时是错题本与 LoRA 微调数据集的来源，
 * 所以 `question_id` 必须回传（见下方 grade 的注释）。
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import Rubric from "@/components/Rubric";
import Seg from "@/components/Seg";
import TracePanel, { type LiveState } from "@/components/TracePanel";
import { useToast } from "@/components/ToastProvider";
import { useAgentRun } from "@/lib/agentRun";
import {
  adminGetConfig,
  streamFollowup,
  streamGrade,
  streamQuestion,
  type ConfigItem,
  type FollowupOutput,
  type GradeOutput,
  type QuestionOutput,
  type StreamEvent,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHistory } from "@/lib/history";
import { usePageScope } from "@/lib/pageScope";

import "./practice.css";

const DIRECTIONS = ["后端", "前端", "算法", "数据库", "操作系统", "计算机网络"];
const DIFFICULTIES = ["初级", "中级", "高级"];
const TYPES = ["八股", "算法", "业务"];

type Question = QuestionOutput & { question_id: number };
type Record_ = { answer_id: number; is_wrong: boolean };

function verdictOf(v: number): string {
  if (v >= 4.5) return "答得很完整，可以直接进下一题。";
  if (v >= 3.5) return "核心思路对，细节有缺口。";
  if (v >= 2.5) return "方向对但讲不透，属于典型的「会做不会说」。";
  return "本题存在概念性缺口，建议先复习再重做。";
}

function splitList(t: string): string[] {
  return String(t || "")
    .split(/[；;。\n]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
}

export default function PracticePage() {
  usePageScope("practice");
  const { token } = useAuth();
  const toast = useToast();
  const { record: recordHistory } = useHistory();
  const { traces, running, error, setError, run } = useAgentRun("practice");

  const [direction, setDirection] = useState(DIRECTIONS[0]);
  const [difficulty, setDifficulty] = useState(DIFFICULTIES[1]);
  const [type, setType] = useState(TYPES[0]);
  const [weak, setWeak] = useState("");

  const [question, setQuestion] = useState<Question | null>(null);
  const [dupInfo, setDupInfo] = useState<{ hit: boolean; score: number | null }>({
    hit: false,
    score: null,
  });
  const [attempts, setAttempts] = useState(0);

  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<GradeOutput | null>(null);
  const [saved, setSaved] = useState<Record_ | null>(null);
  const [followups, setFollowups] = useState<FollowupOutput[]>([]);

  const [config, setConfig] = useState<ConfigItem[]>([]);
  const [traceTitle, setTraceTitle] = useState("等待执行");
  const [live, setLive] = useState<LiveState>("idle");

  // 本轮上下文面板：读运行时配置（管理员在后台改完，这里就是新值）
  useEffect(() => {
    if (!token) return;
    adminGetConfig(token)
      .then(setConfig)
      .catch(() => setConfig([])); // 非管理员会 403，降级成空表
  }, [token]);

  const cfg = useCallback(
    (k: string) => config.find((c) => c.key === k)?.value ?? "—",
    [config],
  );

 /** 只把带 id 的步骤事件推进轨迹面板（结果/已记录没有 id，会共用同一行） */
  function handleEvent(ev: StreamEvent) {
    if (!ev.id) return;
    if (ev.id.startsWith("generate:")) {
      setAttempts(Number(ev.id.split(":")[1]) || 1);
    }
    if (ev.id.startsWith("dedup:") && ev.status === "done") {
      const p = ev.payload as { 判定?: string; 最高相似度?: number };
      const hit = String(p.判定 ?? "").includes("重复");
      setDupInfo({ hit, score: typeof p.最高相似度 === "number" ? p.最高相似度 : null });
    }
  }

  const questionText = question
    ? question.samples
      ? `${question.content}\n\n${question.samples}`
      : question.content
    : "";

  async function handleGenerate() {
    if (!token || running) return;
    setQuestion(null);
    setGrade(null);
    setSaved(null);
    setFollowups([]);
    setAnswer("");
    setDupInfo({ hit: false, score: null });
    setAttempts(0);
    setTraceTitle("training/question/stream");
    setLive("running");

    await run<Question>(
      streamQuestion(token, {
        direction,
        difficulty,
        question_type: type,
        weak_points: weak.trim(),
      }),
      (output) => setQuestion(output as Question),
      { onEvent: handleEvent },
    );
    setLive((l) => (l === "running" ? "done" : l));
  }

  async function handleGrade() {
    if (!token || !question || !answer.trim() || running) return;
    setFollowups([]);
    setTraceTitle("training/grade/stream");
    setLive("running");

    await run<GradeOutput>(
      // question_id 必须回传：后端据此把作答挂到题上。缺失则不落库 ——
      // 宁可不记录，也不要挂到错的题上。
      streamGrade(token, {
        question: questionText,
        answer,
        question_id: question.question_id,
      }),
      (result) => setGrade(result),
      {
        onEvent: (ev) => {
          if (ev.type !== "已记录") return;
          const p = ev.payload as Record_;
          setSaved(p);
          // 记一条历史，侧栏可点开恢复这次的题目 / 作答 / 评分
          void recordHistory(
            "practice",
            `${direction}·${difficulty}｜${questionText.slice(0, 28)}`,
            { question, answer, grade, direction, difficulty, type },
          );
        },
      },
    );
    setLive((l) => (l === "running" ? "done" : l));
  }

  async function handleFollowup() {
    if (!token || !question || !grade || running) return;
    setTraceTitle("training/followup/stream");
    setLive("running");

    // 追问要带上四维摘要，模型才知道该往哪个薄弱点追
    const dims = ["correctness", "completeness", "clarity", "terminology"] as const;
    const text =
      dims.map((k) => `${k} ${grade[k].score}/5`).join("，") + `，总分 ${grade.total_score}`;

    await run<FollowupOutput>(
      streamFollowup(token, { question: questionText, answer, score_summary: text }),
      (out) => setFollowups((prev) => [...prev, out]),
      { reset: false },
    );
    setLive((l) => (l === "running" ? "done" : l));
  }

  function handleReset() {
    if (running) return;
    setQuestion(null);
    setGrade(null);
    setSaved(null);
    setFollowups([]);
    setAnswer("");
    setDupInfo({ hit: false, score: null });
    setAttempts(0);
    setTraceTitle("等待执行");
    setLive("idle");
    setError("");
    toast("info", "已重置", "本轮状态清空，可重新出题");
  }

  const stage = followups.length ? 4 : grade ? 3 : question ? 2 : 1;
  const stageCls = (n: number) => `st${n < stage ? " done" : n === stage ? " on" : ""}`;

  return (
    <div data-page="practice">
      <div className="page-head">
        <div>
          <div className="eyebrow">Practice · AI 定向刷题评测</div>
          <div className="title-row" style={{ marginTop: 7 }}>
            <h1 className="h1">刷题训练</h1>
            <span className="pill">{cfg("llm_model")}</span>
            <span className="pill">
              <span className="dot done" />
              SSE 已连接
            </span>
          </div>
        </div>
        <div className="actions">
          <button className="btn" id="btn-reset" onClick={handleReset} type="button">
            重置本轮
          </button>
          <button
            className="btn btn-primary"
            id="btn-gen"
            onClick={handleGenerate}
            disabled={running}
            type="button"
          >
            {running ? "执行中…" : "生成题目"}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-bad" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* ===== 阶段指示 ===== */}
      <div className="stage">
        <div className={stageCls(1)} id="st1">
          <span className="n">{stage > 1 ? "✓" : 1}</span>配置出题
        </div>
        <span className="ln" />
        <div className={stageCls(2)} id="st2">
          <span className="n">{stage > 2 ? "✓" : 2}</span>作答
        </div>
        <span className="ln" />
        <div className={stageCls(3)} id="st3">
          <span className="n">{stage > 3 ? "✓" : 3}</span>四维评分
        </div>
        <span className="ln" />
        <div className={stageCls(4)} id="st4">
          <span className="n">{4}</span>追问与报告
        </div>
      </div>

      <div className="grid g-main-side">
        {/* ================= 左：内容流 ================= */}
        <div className="stack">
          {/* 出题配置 */}
          <section className="card">
            <div className="card-head">
              <div className="h3">出题参数</div>
              <span className="pill">
                <span className="dot done" />
                流式执行
              </span>
            </div>
            <div className="card-body">
              <div className="cfgbar">
                <div className="field">
                  <label className="label">技术方向</label>
                  <Seg
                    options={DIRECTIONS}
                    value={direction}
                    onChange={setDirection}
                    disabled={running}
                  />
                </div>
                <div className="field">
                  <label className="label">难度</label>
                  <Seg
                    options={DIFFICULTIES}
                    value={difficulty}
                    onChange={setDifficulty}
                    disabled={running}
                  />
                </div>
                <div className="field">
                  <label className="label">题型</label>
                  <Seg options={TYPES} value={type} onChange={setType} disabled={running} />
                </div>
                <div className="field">
                  <label className="label">
                    薄弱点补充 <span className="cap">可选</span>
                  </label>
                  <input
                    className="input"
                    id="weak"
                    placeholder="如：索引下推、缓存雪崩"
                    value={weak}
                    onChange={(e) => setWeak(e.target.value)}
                    disabled={running}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  id="btn-gen2"
                  onClick={handleGenerate}
                  disabled={running}
                  type="button"
                >
                  出题
                </button>
              </div>
              <p className="hint mt-3">
                生成后题目会同时写入题库：PostgreSQL 存主记录，Qdrant 存可检索片段；
                查重相似度超过 <code className="mono">{cfg("question_dup_threshold")}</code>{" "}
                会自动重新生成，最多 {cfg("max_attempts") || 3} 次。
              </p>
            </div>
          </section>

          {/* 题目 */}
          {question && (
            <section className="card" id="qcard">
              <div className="card-head">
                <div className="h3">题目</div>
                <div className="row">
                  <span className="pill accent mono" id="qid">
                    question_id {question.question_id}
                  </span>
                  <span className="pill" id="qtag">
                    {direction} · {difficulty} · {type}
                  </span>
                </div>
              </div>
              <div className="card-body">
                <div className="qhead">
                  <span className={`pill ${dupInfo.hit ? "warn" : "success"}`} id="q-dup">
                    {dupInfo.hit
                      ? `查重命中 · 已重新生成（最高相似度 ${dupInfo.score ?? "—"}）`
                      : "查重通过"}
                  </span>
                  <span className="pill" id="q-attempt">
                    第 {attempts || 1} 次生成
                  </span>
                </div>
                <p className="qtext" id="qtext">
                  {question.content}
                </p>
                {question.samples && (
                  <div className="samples" id="qsamples">
                    <span className="lb">样例与约束</span>
                    <span id="qsamples-t">{question.samples}</span>
                  </div>
                )}
                <div className="kps" id="qkps">
                  {String(question.key_points || "")
                    .split(/[/、，,；;\n]/)
                    .map((k) => k.trim())
                    .filter(Boolean)
                    .map((k) => (
                      <span className="pill info" key={k}>
                        {k}
                      </span>
                    ))}
                </div>
              </div>
            </section>
          )}

          {/* 作答 */}
          {question && (
            <section className="card" id="acard">
              <div className="card-head">
                <div className="h3">你的作答</div>
                <span className="cap">四维 rubric 逐维给理由</span>
              </div>
              <div className="card-body">
                <div className="answer-area">
                  <textarea
                    className="textarea"
                    id="answer"
                    placeholder="按「结论 → 展开 → 边界 → 复杂度」的结构作答，评分器会逐维给理由。"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    disabled={running}
                  />
                  <span className="count" id="cnt">
                    {answer.length} 字
                  </span>
                </div>
                <div className="row-between mt-3">
                  <span className="hint">
                    评分结果会落进 <code>answers</code> 表 ——
                    它同时是错题本与 LoRA 微调数据集的来源。
                  </span>
                  <button
                    className="btn btn-accent"
                    id="btn-grade"
                    onClick={handleGrade}
                    disabled={running || answer.trim().length < 10 || !!saved}
                    type="button"
                  >
                    提交评分
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 评分结果 */}
          {grade && (
            <section className="card" id="rcard">
              <div className="card-head">
                <div className="h3">四维评分</div>
                {saved && (
                  <span className="pill success" id="rec-pill">
                    <span className={`dot ${saved.is_wrong ? "warn" : "done"}`} />
                    已记录 · answer_id {saved.answer_id}
                  </span>
                )}
              </div>
              <div className="card-body">
                <div className="scorehead">
                  <div
                    className="bigscore"
                    id="bigscore"
                    style={{ "--p": Math.round((grade.total_score / 5) * 100) } as React.CSSProperties}
                  >
                    <div className="in">
                      <div className="n" id="total">
                        {grade.total_score.toFixed(2)}
                      </div>
                      <div className="d">/ 5.00</div>
                    </div>
                  </div>
                  <div>
                    <div className="verdict" id="verdict">
                      <b>{verdictOf(grade.total_score)}</b> —— {grade.correctness.reason}
                    </div>
                    <div className="kps" style={{ border: 0, paddingTop: 10, marginTop: 10 }}>
                      <span className="pill">正确性 .40</span>
                      <span className="pill">完整性 .30</span>
                      <span className="pill">表达 .15</span>
                      <span className="pill">术语 .15</span>
                    </div>
                  </div>
                </div>

                <hr className="hair" />
                <Rubric score={grade} />

                <div className="two mt-4">
                  <div className="note good">
                    <div className="t">
                      <span className="dot done" />
                      优点
                    </div>
                    <ul>
                      {splitList(grade.strengths).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="note bad">
                    <div className="t">
                      <span className="dot warn" />
                      改进建议
                    </div>
                    <ul>
                      {splitList(grade.suggestions).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <details className="ref">
                  <summary>参考答案</summary>
                  <div className="bd">{grade.reference_answer}</div>
                </details>

                <div className="row mt-4" style={{ gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-accent"
                    id="btn-fu"
                    onClick={handleFollowup}
                    disabled={running}
                    type="button"
                  >
                    生成追问
                  </button>
                  <Link className="btn" href="/report">
                    生成训练报告
                  </Link>
                  <Link className="btn btn-ghost" href="/wrongbook">
                    加入错题本复习 →
                  </Link>
                </div>
              </div>
            </section>
          )}

          {/* 追问 */}
          {followups.length > 0 && (
            <section className="card" id="fcard">
              <div className="card-head">
                <div className="h3">追问链</div>
                <span className="cap">基于本次作答与四维评分追问</span>
              </div>
              <div className="card-body tight" id="fu-list">
                {followups.map((f, i) => (
                  <div className="fu" key={i} style={{ padding: "12px 16px" }}>
                    <div className="row" style={{ marginBottom: 7 }}>
                      <span className="pill accent">追问 {i + 1}</span>
                      <span className="pill">考察点：{f.key_points}</span>
                    </div>
                    <div className="qh">{f.question}</div>
                    <details className="ref" style={{ marginTop: 9 }}>
                      <summary>参考答案</summary>
                      <div className="bd">{f.reference_answer}</div>
                    </details>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ================= 右：可观测 ================= */}
        <div className="side">
          <TracePanel events={traces} title={traceTitle} live={live} />

          <section className="card">
            <div className="card-head">
              <div className="h3">本轮上下文</div>
            </div>
            <div className="card-body">
              <dl className="stack-sm" style={{ fontSize: 12.5 }} id="ctx">
                <div className="row-between">
                  <dt className="dim">方向 / 难度 / 题型</dt>
                  <dd className="mono">
                    {direction} / {difficulty} / {type}
                  </dd>
                </div>
                <div className="row-between">
                  <dt className="dim">主生成模型</dt>
                  <dd className="mono">{cfg("llm_model")}</dd>
                </div>
                <div className="row-between">
                  <dt className="dim">温度</dt>
                  <dd className="mono">{cfg("llm_temperature")}</dd>
                </div>
                <div className="row-between">
                  <dt className="dim">检索模式</dt>
                  <dd className="mono">{cfg("retrieval_mode")}</dd>
                </div>
                <div className="row-between">
                  <dt className="dim">召回条数 top_k</dt>
                  <dd className="mono">{cfg("retrieval_top_k")}</dd>
                </div>
                <div className="row-between">
                  <dt className="dim">精排</dt>
                  <dd className="mono">{cfg("retrieval_use_rerank") === "1" ? "on" : "off"}</dd>
                </div>
                <div className="row-between">
                  <dt className="dim">网关路由</dt>
                  <dd className="mono">{cfg("llm_gateway_primary") || "直连"}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">落库去向</div>
            </div>
            <div className="card-body">
              <div className="stack-sm" style={{ fontSize: 12.5 }}>
                <div className="row-between">
                  <span className="dim">answers 表</span>
                  <span className="mono" id="db-a">
                    {saved ? `#${saved.answer_id}` : "—"}
                  </span>
                </div>
                <div className="row-between">
                  <span className="dim">错题本 SM-2</span>
                  <span className="mono" id="db-s">
                    {saved ? (saved.is_wrong ? "已入队 · 1 天后" : "未入队") : "—"}
                  </span>
                </div>
                <div className="row-between">
                  <span className="dim">历史快照</span>
                  <span className="mono" id="db-h">
                    {saved ? "已写入" : "—"}
                  </span>
                </div>
                <div className="row-between">
                  <span className="dim">微调样本</span>
                  <span className="mono" id="db-f">
                    {saved ? "待导出（alpaca）" : "—"}
                  </span>
                </div>
              </div>
              <p className="hint mt-3">
                同一份评分数据支撑三条下游链路，这是系统的数据飞轮。
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
