"use client";

/**
 * 简历诊断。对应设计稿 resume.html。
 *
 * 两步链路：上传 PDF → 解析成结构化简历（走 multipart SSE），
 * 再把简历文本与 JD 一起送进诊断（三个节点串行：解析简历 → 解析 JD → 对比诊断）。
 * 「填入演示数据」直接用纯文本跳过 PDF —— 后端的 diagnose 本来就吃文本。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import TracePanel, { type LiveState } from "@/components/TracePanel";
import { useToast } from "@/components/ToastProvider";
import { useAgentRun } from "@/lib/agentRun";
import {
  streamDiagnose,
  streamResumeParse,
  type DiagnoseOutput,
  type JDOutput,
  type ResumeOutput,
  type StreamEvent,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHistory } from "@/lib/history";
import { usePageScope } from "@/lib/pageScope";
import { useSnapshot } from "@/lib/pageState";

import "./resume.css";

const DEMO_RESUME = `马乾恩 | 计算机科学与技术 | 2023.09 - 2027.06
技能：Python、FastAPI、LangGraph、PostgreSQL、Redis、Docker、React、Qdrant
项目经历
  OfferMind 求职训练平台（2026.03 - 2026.10）
    可观测 Agentic RAG 驱动的 AI 面试训练系统。独立完成后端 47 个 REST 接口、
    8 张 LangGraph 编排图与 SSE 流式可观测链路，向量库使用 Qdrant + BGE-M3。
  课程实验：简易 RPC 框架
    基于 Netty 实现服务注册发现与负载均衡。
个人总结
  后端方向，熟悉 Python 服务端与 LLM 应用工程化，有从 0 到 1 落地完整系统的经验。
工作/实习经历：暂无`;

const DEMO_JD = `后端开发实习生（AI 应用方向）
岗位职责
  1. 参与 LLM 应用后端服务的设计与开发；
  2. 负责 RAG 检索链路的效果调优与评测；
  3. 编写接口文档与单元测试。
任职要求
  1. 熟悉 Python，掌握 FastAPI 或同类 Web 框架；
  2. 熟悉 MySQL / PostgreSQL 与 Redis；
  3. 了解 Linux 常用命令与基本运维。
加分项
  1. 有 LangChain / LangGraph 使用经验；
  2. 了解向量数据库与检索增强生成；
  3. 有 Docker / K8s 部署经验；
  4. 有模型部署或微调经验。`;

type RunState = "idle" | "running" | "done";

/** 技能是否命中：双向包含，避免「Redis」匹配不到「Redis 集群」这类写法差异 */
function skillHit(skill: string, resumeSkills: string[]): boolean {
  const s = skill.toLowerCase();
  return resumeSkills.some((k) => {
    const kk = k.toLowerCase();
    return kk.includes(s) || s.includes(kk);
  });
}

export default function ResumePage() {
  const { token } = useAuth();
  const toast = useToast();
  const { record } = useHistory();
  usePageScope("resume");

  const { traces, running, error, run } = useAgentRun("resume");
  const fileInput = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [jdText, setJdText] = useState("");
  const [dragging, setDragging] = useState(false);

  const [structured, setStructured] = useState<ResumeOutput | null>(null);
  const [jdProfile, setJdProfile] = useState<JDOutput | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnoseOutput | null>(null);

  const [traceTitle, setTraceTitle] = useState("等待执行");
  const [live, setLive] = useState<LiveState>("idle");
  const [step, setStep] = useState<RunState>("idle");

  // 历史恢复用的快照。字段名与下方 record() 写出去的五个 key 一一对应
  const snapshot = useMemo(
    () => ({ resumeText, jdText, structured, jdProfile, diagnosis }),
    [resumeText, jdText, structured, jdProfile, diagnosis],
  );

  useSnapshot<typeof snapshot>("resume", snapshot, (stored) => {
    setResumeText(stored.resumeText);
    setJdText(stored.jdText);
    setStructured(stored.structured);
    setJdProfile(stored.jdProfile);
    setDiagnosis(stored.diagnosis);
    // 恢复出来的现场已经是「看结果」那一步了，不该退回上传态
    setStep(stored.diagnosis ? "done" : "idle");
  });

  const ready = Boolean(resumeText || fileName);

  // 换 PDF 就作废之前解析出的文本，避免拿旧简历配新 JD
  const pickFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      toast("err", "格式不支持", "只接受 PDF。扫描件会因无法提取文本返回 400。");
      return;
    }
    setFileName(f.name);
    setResumeText("");
    setStructured(null);
  }, [toast]);

  async function handleRun() {
    if (!token || running) return;
    const file = fileInput.current?.files?.[0];
    if (!file && !resumeText) {
      toast("err", "缺少简历", "先上传一份 PDF，或点「填入演示数据」。");
      return;
    }
    if (jdText.trim().length < 20) {
      toast("err", "JD 太短", "至少粘贴 20 个字的岗位描述，否则解析不出技能要求。");
      return;
    }

    setStep("running");
    setDiagnosis(null);
    setLive("running");

    try {
      let text = resumeText;
      let parsed: ResumeOutput | null = structured;

      // 第一步：有 PDF 就先解析（multipart + SSE）
      if (file) {
        setTraceTitle("resume/parse/stream");
        await run<ResumeOutput & { resume_text?: string }>(
          streamResumeParse(token, file),
          (out) => {
            parsed = out;
            text = out.resume_text || text;
          },
        );
        setStructured(parsed);
        setResumeText(text);
      }

      // 第二步：简历文本 + JD → 解析简历 / 解析 JD / 对比诊断
      setTraceTitle("resume/diagnose/stream");
      let result:
        | { structured_resume: ResumeOutput; jd_profile: JDOutput; diagnosis: DiagnoseOutput }
        | null = null;
      await run<typeof result>(
        streamDiagnose(token, { resume_text: text, jd_text: jdText }),
        (out) => {
          result = out;
        },
        { reset: false },
      );
      if (!result) throw new Error("没有收到诊断结果");

      const r = result as {
        structured_resume: ResumeOutput;
        jd_profile: JDOutput;
        diagnosis: DiagnoseOutput;
      };
      setStructured(r.structured_resume);
      setJdProfile(r.jd_profile);
      setDiagnosis(r.diagnosis);
      setStep("done");
      setLive("done");

      void record("resume", `简历诊断｜${r.jd_profile.position || "岗位"}`, {
        resumeText: text,
        jdText,
        structured: r.structured_resume,
        jdProfile: r.jd_profile,
        diagnosis: r.diagnosis,
      });
      toast("ok", "诊断完成", `匹配度 ${r.diagnosis.match_score} / 100，已写入历史`);
    } catch (ex) {
      setStep("idle");
      setLive("error");
      toast("err", "诊断失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  function fillDemo() {
    setResumeText(DEMO_RESUME);
    setFileName("演示简历（纯文本）");
    setStructured(null);
    setJdText(DEMO_JD);
    toast("info", "已填入演示数据", "简历与 JD 都已就绪，点「开始诊断」");
  }

  function clearFile() {
    if (fileInput.current) fileInput.current.value = "";
    setFileName("");
    setResumeText("");
    setStructured(null);
  }

  const stepCls = (n: number) => {
    if (step === "done") return "step done";
    if (step === "running") return `step${n === 3 ? " on" : " done"}`;
    return "step on";
  };

  const score = diagnosis?.match_score ?? 0;
  const tone =
    score >= 80
      ? "var(--success)"
      : score >= 65
        ? "var(--accent-ink)"
        : score >= 50
          ? "var(--warn)"
          : "var(--danger)";
  const resumeSkills = structured?.skills ?? [];
  const hitCount = jdProfile
    ? jdProfile.required_skills.filter((s) => skillHit(s, resumeSkills)).length
    : 0;

  function skillRow(list: string[]) {
    return list.map((s) => {
      const ok = skillHit(s, resumeSkills);
      return (
        <div className={`skill ${ok ? "have" : "miss"}`} key={s}>
          <span className="tick">{ok ? "✓" : "✕"}</span>
          <span>{s}</span>
          {!ok && (
            <span className="pill danger" style={{ marginLeft: "auto" }}>
              缺失
            </span>
          )}
        </div>
      );
    });
  }

  return (
    <div data-page="resume">
      <div className="page-head">
        <div>
          <div className="eyebrow">Resume · 简历解析与 JD 匹配</div>
          <div className="title-row" style={{ marginTop: 7 }}>
            <h1 className="h1">简历诊断</h1>
            <span className="pill">PDF → 结构化 → 匹配度</span>
          </div>
          <p className="lead" style={{ marginTop: 8, fontSize: 14 }}>
            上传 PDF 简历并贴上目标岗位 JD。链路上依次跑「解析简历 → 解析 JD →
            对比诊断」三个节点，每一步都在右侧执行面板实时点亮。
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-bad" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="grid g-main-side">
        {/* ===== 左：输入 + 结果 ===== */}
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <div className="h3">输入材料</div>
              <span className="cap">三步串行 · 逐步可见</span>
            </div>
            <div className="card-body">
              <div className="steps">
                <div className={stepCls(1)}>
                  <span className="n">1</span>
                  <div>
                    <div className="h3">上传简历 PDF</div>
                    <p className="hint mt-1">
                      扫描件无法提取文本，会返回 400「无法从 PDF 提取文本」。
                    </p>
                    <div
                      className={`drop mt-3${dragging ? " over" : ""}`}
                      id="drop"
                      onClick={() => fileInput.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setDragging(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) pickFile(f);
                      }}
                    >
                      <div className="drop-ico">⇪</div>
                      <div style={{ fontSize: 13, fontWeight: 540 }}>
                        拖入 PDF，或点击选择文件
                      </div>
                      <div className="hint mt-1">仅解析文本层，单文件建议 &lt; 5 MB</div>
                      <input
                        type="file"
                        id="file"
                        accept="application/pdf"
                        ref={fileInput}
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) pickFile(f);
                        }}
                      />
                    </div>
                    {fileName && (
                      <div className="filechip">
                        <span className="ic">PDF</span>
                        <div className="grow">
                          <div className="nm">{fileName}</div>
                          <div className="sz">
                            {resumeText ? `${resumeText.length} 字 · 已解析` : "待解析"}
                          </div>
                        </div>
                        <button className="x" onClick={clearFile} title="移除" type="button">
                          ✕
                        </button>
                      </div>
                    )}
                    <details className="ref" style={{ marginTop: 12 }}>
                      <summary>没有 PDF？直接用演示简历文本</summary>
                      <div className="bd mono" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                        {DEMO_RESUME}
                      </div>
                    </details>
                  </div>
                </div>

                <div className={stepCls(2)}>
                  <span className="n">2</span>
                  <div>
                    <div className="h3">粘贴目标岗位 JD</div>
                    <textarea
                      className="textarea mt-2"
                      id="jd"
                      style={{ minHeight: 130 }}
                      value={jdText}
                      onChange={(e) => setJdText(e.target.value)}
                      disabled={running}
                    />
                    <div className="row-between mt-2">
                      <span className="hint">
                        JD 会被解析成「职责 / 必备技能 / 加分技能」三段结构。
                      </span>
                      <span className="cap mono">{jdText.length} 字</span>
                    </div>
                  </div>
                </div>

                <div className={stepCls(3)}>
                  <span className="n">3</span>
                  <div>
                    <div className="h3">开始诊断</div>
                    <p className="hint mt-1">
                      三个节点串行执行，中途失败会立即中断并推错误事件。
                    </p>
                    <div className="row mt-3" style={{ gap: 10 }}>
                      <button
                        className="btn btn-primary btn-lg"
                        id="btn-run"
                        onClick={handleRun}
                        disabled={running || !ready}
                        type="button"
                      >
                        {running ? "诊断中…" : "开始诊断"}
                      </button>
                      <button
                        className="btn btn-lg"
                        id="btn-demo"
                        onClick={fillDemo}
                        disabled={running}
                        type="button"
                      >
                        填入演示数据
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 结果 */}
          {diagnosis && structured && jdProfile && (
            <section className="card" id="rcard">
              <div className="card-head">
                <div className="h3">诊断结果</div>
                <span className="pill">{jdProfile.position}</span>
              </div>
              <div className="card-body">
                <div className="match">
                  <div className="gauge">
                    <svg viewBox="0 0 168 168" width="168" height="168">
                      <circle
                        cx="84"
                        cy="84"
                        r="70"
                        fill="none"
                        stroke="var(--surface-3)"
                        strokeWidth="12"
                      />
                      <circle
                        cx="84"
                        cy="84"
                        r="70"
                        fill="none"
                        stroke={tone}
                        strokeWidth="12"
                        strokeLinecap="round"
                        strokeDasharray={`${((score / 100) * 440).toFixed(1)} 440`}
                        transform="rotate(-90 84 84)"
                      />
                    </svg>
                    <div className="txt">
                      <div className="n" style={{ color: tone }}>
                        {score}
                      </div>
                      <div className="d">/ 100</div>
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow">匹配度评估</div>
                    <p className="verdict" id="match-note" style={{ marginTop: 8 }}>
                      共 {jdProfile.required_skills.length} 项必备技能，命中 <b>{hitCount}</b> 项；
                      缺口集中在 <b>{diagnosis.missing_skills[0] || "—"}</b>。
                      {score >= 65 ? "基础匹配，补上短板即可投递。" : "建议先补齐必备技能再投。"}
                    </p>
                    <div className="stackline">
                      {jdProfile.required_skills
                        .filter((s) => skillHit(s, resumeSkills))
                        .map((s) => (
                          <span className="pill success" key={s}>
                            ✓ {s}
                          </span>
                        ))}
                    </div>
                  </div>
                </div>

                <hr className="hair" />

                <div className="grid g-2">
                  <div className="note good">
                    <div className="t">
                      <span className="dot done" />
                      亮点
                    </div>
                    <ul>
                      {diagnosis.strengths.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="note bad">
                    <div className="t">
                      <span className="dot warn" />
                      短板
                    </div>
                    <ul>
                      {diagnosis.weaknesses.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="grid g-2 mt-4">
                  <div className="card" style={{ boxShadow: "none" }}>
                    <div className="card-head">
                      <div className="h3">必备技能对照</div>
                    </div>
                    <div className="card-body">
                      <div className="skillgrid">{skillRow(jdProfile.required_skills)}</div>
                    </div>
                  </div>
                  <div className="card" style={{ boxShadow: "none" }}>
                    <div className="card-head">
                      <div className="h3">加分技能对照</div>
                    </div>
                    <div className="card-body">
                      <div className="skillgrid">{skillRow(jdProfile.preferred_skills)}</div>
                    </div>
                  </div>
                </div>

                <div className="card mt-4" style={{ boxShadow: "none" }}>
                  <div className="card-head">
                    <div className="h3">优化建议</div>
                    <span className="pill accent">按优先级排序</span>
                  </div>
                  <div className="card-body">
                    <ol className="sug">
                      {diagnosis.suggestions.map((x, i) => (
                        <li key={i}>
                          <span>{x}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 结构化简历 */}
          {structured && (
            <section className="card" id="scard">
              <div className="card-head">
                <div className="h3">结构化简历</div>
                <span className="small">解析后的字段</span>
              </div>
              <div className="card-body">
                <div className="grid g-2">
                  <div>
                    <div className="eyebrow">基本信息</div>
                    <div className="h2 mt-2">{structured.name}</div>
                    <div className="small mt-1">{structured.education}</div>
                    <div className="eyebrow mt-4">技能</div>
                    <div className="stackline">
                      {structured.skills.map((s) => (
                        <span className="pill" key={s}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow">项目经历</div>
                    <div className="mt-2">
                      {structured.projects.map((p, i) => (
                        <div className="proj" key={i}>
                          <div className="nm">{p.name}</div>
                          <div className="ds">{p.description}</div>
                          <div className="stackline">
                            {String(p.tech_stack || "")
                              .split(/[/、,，]/)
                              .map((t) => t.trim())
                              .filter(Boolean)
                              .map((t) => (
                                <span className="pill accent" key={t}>
                                  {t}
                                </span>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="eyebrow mt-5">个人总结</div>
                <p className="lead mt-2" style={{ fontSize: 13.5 }}>
                  {structured.summary}
                </p>
                <div className="eyebrow mt-4">工作 / 实习经历</div>
                <p className="small mt-2">{structured.work_experience}</p>
              </div>
            </section>
          )}
        </div>

        {/* ===== 右：可观测 ===== */}
        <div className="side">
          <TracePanel events={traces} title={traceTitle} live={live} />

          <section className="card">
            <div className="card-head">
              <div className="h3">岗位画像</div>
              <span className="pill" id="p-pos">{jdProfile?.position ?? "—"}</span>
            </div>
            <div className="card-body tight" id="p-body">
              {jdProfile && diagnosis ? (
                <div style={{ padding: "14px 16px" }}>
                  <div className="eyebrow">岗位职责</div>
                  <ul className="stack-sm mt-2" style={{ fontSize: 12.5 }}>
                    {jdProfile.responsibilities.map((x, i) => (
                      <li key={i}>— {x}</li>
                    ))}
                  </ul>
                  <div className="eyebrow mt-4">必备技能</div>
                  <div className="stackline">
                    {jdProfile.required_skills.map((s) => (
                      <span className="pill info" key={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="eyebrow mt-4">加分技能</div>
                  <div className="stackline">
                    {jdProfile.preferred_skills.map((s) => (
                      <span className="pill" key={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="eyebrow mt-4">缺失技能</div>
                  <div className="stackline">
                    {diagnosis.missing_skills.map((s) => (
                      <span className="pill danger" key={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="empty" style={{ border: 0, background: "transparent", padding: "26px 16px" }}>
                  <div className="glyph">≡</div>
                  <div className="t">尚未解析</div>
                  <div className="d">贴入 JD 后这里会出现岗位职责与技能要求。</div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
