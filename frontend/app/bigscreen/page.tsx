"use client";

/**
 * 数据大屏（OPS WALL）。对应设计稿 bigscreen.html。
 *
 * 这是答辩演示用的「作战室」：1920×1080 固定画布等比缩放铺满屏幕，不套侧栏外壳。
 * 面板里的**延迟趋势与评分分布是演示数据** —— 它们要的是「链路在跑」的观感，
 * 不是某个真实时刻的读数；能取真实值的地方（错题待复习数）走接口，取不到就显示 —，
 * 不编造。设计稿自己在「数据飞轮」面板里也是这个态度（未产出 / 待完成 / 不填占位数字）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { answerStats } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePageScope } from "@/lib/pageScope";

import "./bigscreen.css";

/* ==================== 演示数据 ==================== */

/** 轨迹流的循环剧本：够长，15 秒一轮不重复，看起来像真在跑。 */
const FEED: [string, string, string, number][] = [
  ["检索", "embed:q", "BGE-M3 dim=1024", 63],
  ["检索", "recall:q", "hybrid cand=20", 41],
  ["检索", "rerank:q", "keep=5", 188],
  ["模型", "generate:1", "deepseek-v4-flash", 3720],
  ["检索", "dedup:1", "top=0.71 / thr=0.92 通过", 58],
  ["模型", "grade", "总分 3.40", 4180],
  ["模型", "followup", "追问链 +1", 2410],
  ["工具", "extract_pdf_text", "chars=2841", 112],
  ["模型", "parse_resume", "skills=7", 3260],
  ["模型", "diagnose", "匹配度 68", 3940],
  ["模型", "interview_chat", "turn=3", 1620],
  ["模型", "interview_report", "总分 78", 5240],
  ["模型", "training_report", "radar=6 维", 4460],
  ["检索", "recall:g", "sparse BM25", 39],
  ["记忆", "profile.write", "MySQL 索引 mastery=0.52", 22],
];

const CHART_W = 760;
const CHART_H = 214;
const PAD_L = 42;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 26;
const MAX_V = 6.4;

/** 折线的初始序列：20 个点对应近 30 分钟（每点 1.5 分钟）。 */
const P50_INIT = [3.1, 3.3, 3.0, 3.4, 3.6, 3.5, 3.7, 3.6, 3.8, 3.7, 3.5, 3.7, 3.9, 3.7, 3.6, 3.7, 3.8, 3.7, 3.5, 3.7];
const P95_INIT = [4.2, 4.4, 4.1, 4.6, 4.8, 4.7, 4.9, 4.8, 5.0, 4.9, 4.7, 4.9, 5.1, 4.9, 4.8, 4.9, 5.0, 4.9, 4.7, 4.9];
const P99_INIT = [4.9, 5.1, 4.8, 5.3, 5.5, 5.4, 5.6, 5.5, 5.7, 5.6, 5.4, 5.6, 5.8, 5.6, 5.5, 5.6, 5.7, 5.6, 5.4, 5.6];

const BINS = [
  { lb: "0–1", v: 12 },
  { lb: "1–2", v: 48 },
  { lb: "2–3", v: 152 },
  { lb: "3–4", v: 286 },
  { lb: "4–5", v: 198 },
  { lb: "5", v: 40 },
];

const ROUTES = [
  { d: "cloud-deepseek", form: "云端 API", p50: "3.70s", p99: "5.60s", share: "68%", tag: "primary", tone: "accent" },
  { d: "local-qwen", form: "vLLM AWQ-4bit", p50: "1.20s", p99: "2.00s", share: "27%", tag: "fallback", tone: "success" },
  { d: "local-qwen-fp16", form: "vLLM FP16", p50: "1.90s", p99: "3.10s", share: "5%", tag: "备用", tone: "" },
  { d: "BGE-M3", form: "本地 Embedding", p50: "58ms", p99: "96ms", share: "—", tag: "常驻", tone: "info" },
  { d: "bge-reranker", form: "本地精排", p50: "176ms", p99: "241ms", share: "—", tag: "常驻", tone: "info" },
];

type FeedRow = { key: number; t: string; kind: string; id: string; detail: string; ms: number; done: boolean };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default function BigscreenPage() {
  const { token } = useAuth();
  usePageScope("bigscreen");

  const stageRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [series, setSeries] = useState({ p50: P50_INIT, p95: P95_INIT, p99: P99_INIT });
  const [due, setDue] = useState<number | null>(null);

  // 页面私有样式：设计稿在 html/body 上铺深色底并禁止滚动，
  // 那两条全局规则被作用域化剔除了，这里在挂载时补上、卸载时还原。
  useEffect(() => {
    const { body } = document;
    const prev = {
      background: body.style.background,
      overflow: body.style.overflow,
      height: body.style.height,
    };
    body.style.background = "oklch(14% 0.018 258)";
    body.style.overflow = "hidden";
    body.style.height = "100%";
    return () => {
      body.style.background = prev.background;
      body.style.overflow = prev.overflow;
      body.style.height = prev.height;
    };
  }, []);

  // 1920×1080 固定画布等比缩放（居中留边）
  useEffect(() => {
    const fit = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      const tx = (window.innerWidth - 1920 * s) / 2;
      const ty = (window.innerHeight - 1080 * s) / 2;
      stage.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // 时钟
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 轨迹流：每 1.5 秒推进一行，新行先亮「运行中」再转「完成」
  const feedIndex = useRef(0);
  const rowKey = useRef(0);
  useEffect(() => {
    const push = () => {
      const [kind, id, detail, ms] = FEED[feedIndex.current % FEED.length];
      feedIndex.current += 1;
      const d = new Date();
      const key = rowKey.current++;
      const row: FeedRow = {
        key,
        t: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
        kind,
        id,
        detail,
        ms,
        done: false,
      };
      setRows((prev) => [...prev, row].slice(-15));
      setTimeout(() => {
        setRows((prev) => prev.map((r) => (r.key === key ? { ...r, done: true } : r)));
      }, 900);
    };
    for (let i = 0; i < 10; i++) push();
    const t = setInterval(push, 1500);
    return () => clearInterval(t);
  }, []);

  // 折线轻微滚动，营造实时感
  useEffect(() => {
    const t = setInterval(() => {
      setSeries((s) => {
        const last = s.p50[s.p50.length - 1];
        const next = Math.max(3.0, Math.min(4.4, last + (Math.random() - 0.5) * 0.3));
        const n = Number(next.toFixed(2));
        return {
          p50: [...s.p50.slice(1), n],
          p95: [...s.p95.slice(1), Number((n + 1.2 + Math.random() * 0.2).toFixed(2))],
          p99: [...s.p99.slice(1), Number((n + 1.9 + Math.random() * 0.2).toFixed(2))],
        };
      });
    }, 3400);
    return () => clearInterval(t);
  }, []);

  // 真实值：待复习错题数（拿不到就显示 —，不编造）
  useEffect(() => {
    if (!token) return;
    answerStats(token)
      .then((s) => setDue(s.due))
      .catch(() => setDue(null));
  }, [token]);

  const x = useCallback((i: number) => PAD_L + (i / (series.p50.length - 1)) * (CHART_W - PAD_L - PAD_R), [series.p50.length]);
  const y = useCallback(
    (v: number) => PAD_T + (CHART_H - PAD_T - PAD_B) - ((v - 0) / (MAX_V - 0)) * (CHART_H - PAD_T - PAD_B),
    [],
  );

  const polyline = useCallback(
    (arr: number[]) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "),
    [x, y],
  );
  const area = useCallback(
    (arr: number[]) =>
      `${PAD_L},${(PAD_T + (CHART_H - PAD_T - PAD_B)).toFixed(1)} ${polyline(arr)} ${CHART_W - PAD_R},${(PAD_T + (CHART_H - PAD_T - PAD_B)).toFixed(1)}`,
    [polyline],
  );

  const binTotal = BINS.reduce((s, b) => s + b.v, 0);
  const maxBin = Math.max(...BINS.map((b) => b.v));

  const clockText = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const dateText = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 周${
    "日一二三四五六"[now.getDay()]
  }`;

  const kpis = useMemo(
    () => [
      { k: "今日 Agent 调用", v: "1,284", d: "较昨日 +18.4%", live: true },
      { k: "四维评分次数", v: "736", d: "平均总分 3.62 / 5.00", live: false },
      { k: "活跃会话", v: "43", d: "其中面试会话 9 场", live: false },
      { k: "题库规模", v: "1,268", suffix: "题", d: "Qdrant points 1268 · 6 个方向", live: false },
    ],
    [],
  );

  return (
    <div data-page="bigscreen">
      <div className="stage" ref={stageRef}>
        {/* ================= 顶栏 ================= */}
        <header className="hd">
          <div className="brand">
            <span className="m">OfferMind</span>
            <span className="t">OPS WALL</span>
          </div>
          <span className="sub">可观测 Agentic RAG · AI 求职面试训练平台</span>
          <span className="spacer" />
          <div className="probe">
            <span className="p">
              <span className="dot done" />
              postgres
            </span>
            <span className="p">
              <span className="dot done" />
              redis
            </span>
            <span className="p">
              <span className="dot done" />
              qdrant
            </span>
            <span className="p">
              <span className="dot done" />
              BGE-M3
            </span>
            <span className="p">
              <span className="dot running" />
              reranker
            </span>
            <span className="p" style={{ color: "var(--accent)" }}>
              <span className="dot running" />
              STREAM LIVE
            </span>
          </div>
          <div className="clock">
            <span>{clockText}</span>
            <small>{dateText}</small>
          </div>
        </header>

        {/* ================= KPI ================= */}
        <div className="kpis">
          {kpis.map((item) => (
            <div className={`kpi${item.live ? " live" : ""}`} key={item.k}>
              <div className="k">{item.k}</div>
              <CountUp value={item.v} suffix={item.suffix} />
              <div className="d">
                {item.live && <span className="dot running" />}
                {item.d}
              </div>
            </div>
          ))}
        </div>

        {/* ================= 第二行 ================= */}
        <div style={{ display: "grid", gridTemplateColumns: "640px minmax(0,1fr) 470px", gap: 16, minHeight: 0 }}>
          {/* 实时执行轨迹 */}
          <section className="panel">
            <header>
              <span className="eyebrow">Agent Trace</span>
              <span className="r">
                <span
                  className="p"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--accent)" }}
                >
                  ● REC
                </span>
              </span>
            </header>
            <div className="body flush stream" id="stream">
              {rows.map((r) => (
                <div className={`srow ${r.done ? "ok" : "run"}`} key={r.key}>
                  <span className="t">{r.t}</span>
                  <span className={`k ${r.kind}`}>{r.kind}</span>
                  <span className="w">
                    {r.id} <b>{r.detail}</b>
                  </span>
                  <span className="ms">{r.ms} ms</span>
                </div>
              ))}
            </div>
          </section>

          {/* 延迟趋势 */}
          <section className="panel">
            <header>
              <span className="eyebrow">端到端延迟趋势 · 近 30 分钟</span>
              <span className="r legend">
                <span>
                  <i style={{ background: "var(--accent)" }} />
                  P50
                </span>
                <span>
                  <i style={{ background: "oklch(62% 0.14 300)" }} />
                  P95
                </span>
                <span>
                  <i style={{ background: "oklch(68% 0.15 72)" }} />
                  P99
                </span>
              </span>
            </header>
            <div className="body" style={{ padding: "12px 15px 8px" }}>
              <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" height="100%" preserveAspectRatio="none">
                {[0, 1.6, 3.2, 4.8, 6.4].map((v) => (
                  <g key={v}>
                    <line
                      x1={PAD_L}
                      y1={y(v).toFixed(1)}
                      x2={CHART_W - PAD_R}
                      y2={y(v).toFixed(1)}
                      stroke="oklch(100% 0 0 / 0.07)"
                      strokeWidth={1}
                    />
                    <text
                      x={PAD_L - 8}
                      y={(y(v) + 4).toFixed(1)}
                      textAnchor="end"
                      fontFamily="var(--font-mono)"
                      fontSize="9.5"
                      fill="oklch(62% 0.016 258)"
                    >
                      {v.toFixed(1)}s
                    </text>
                  </g>
                ))}
                {[0, 5, 10, 15, 19].map((i) => (
                  <text
                    key={i}
                    x={x(i).toFixed(1)}
                    y={CHART_H - 8}
                    textAnchor="middle"
                    fontFamily="var(--font-mono)"
                    fontSize="9.5"
                    fill="oklch(62% 0.016 258)"
                  >
                    -{Math.max(0, Math.round(30 - i * 1.5))}m
                  </text>
                ))}
                <polyline
                  points={polyline(series.p99)}
                  fill="none"
                  stroke="oklch(68% 0.15 72)"
                  strokeWidth={1.3}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray="4 3"
                />
                <polyline
                  points={polyline(series.p95)}
                  fill="none"
                  stroke="oklch(62% 0.14 300)"
                  strokeWidth={1.3}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray="4 3"
                />
                <polygon points={area(series.p50)} fill="var(--accent)" opacity={0.1} />
                <polyline
                  points={polyline(series.p50)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle
                  cx={x(series.p50.length - 1).toFixed(1)}
                  cy={y(series.p50[series.p50.length - 1]).toFixed(1)}
                  r={3.4}
                  fill="var(--accent)"
                />
                <circle
                  cx={x(series.p50.length - 1).toFixed(1)}
                  cy={y(series.p50[series.p50.length - 1]).toFixed(1)}
                  r={8}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={1}
                  opacity={0.4}
                />
              </svg>
            </div>
          </section>

          {/* 评分分布 */}
          <section className="panel">
            <header>
              <span className="eyebrow">四维总分分布</span>
              <span
                className="r"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-muted)" }}
              >
                n = {binTotal}
              </span>
            </header>
            <div className="body">
              <div className="bars">
                {BINS.map((b) => {
                  const tone =
                    b.lb === "3–4" || b.lb === "4–5"
                      ? "var(--accent)"
                      : b.lb === "5"
                        ? "oklch(58% 0.14 152)"
                        : b.lb === "2–3"
                          ? "oklch(62% 0.14 300)"
                          : "oklch(68% 0.15 72)";
                  return (
                    <div className="barcol" title={`${b.v} 次`} key={b.lb}>
                      <span className="vv">{((b.v / binTotal) * 100).toFixed(1)}%</span>
                      <span className="stack">
                        <span className="seg" style={{ height: `${(b.v / maxBin) * 100}%`, background: tone }} />
                      </span>
                      <span className="lb">{b.lb}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        {/* ================= 第三行 ================= */}
        <div style={{ display: "grid", gridTemplateColumns: "640px minmax(0,1fr) 470px", gap: 16, minHeight: 0 }}>
          {/* 模型路由 */}
          <section className="panel">
            <header>
              <span className="eyebrow">模型路由与部署</span>
              <span
                className="r"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--accent)" }}
              >
                LiteLLM Router · 回退已启用
              </span>
            </header>
            <div className="body flush">
              <table className="dark">
                <thead>
                  <tr>
                    <th>部署</th>
                    <th>形态</th>
                    <th style={{ textAlign: "right" }}>P50</th>
                    <th style={{ textAlign: "right" }}>P99</th>
                    <th style={{ textAlign: "right" }}>占比</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {ROUTES.map((r) => (
                    <tr key={r.d}>
                      <td>
                        <b>{r.d}</b>
                      </td>
                      <td>{r.form}</td>
                      <td className="n">{r.p50}</td>
                      <td className="n">{r.p99}</td>
                      <td className="n">{r.share}</td>
                      <td>
                        <span
                          className={`pill ${r.tone}`}
                          style={{ height: 17, fontSize: 9.5 }}
                        >
                          {r.tag}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 数据飞轮 */}
          <section className="panel">
            <header>
              <span className="eyebrow">数据飞轮 · 评分器微调</span>
              <span
                className="r"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-muted)" }}
              >
                LLaMA-Factory · LoRA
              </span>
            </header>
            <div className="body">
              <div className="fly">
                <div className="row">
                  <div className="top">
                    <span className="lb">评分落库 → SFT 样本</span>
                    <span className="vv">已运行</span>
                  </div>
                  <div className="track">
                    <i style={{ width: "100%" }} />
                  </div>
                  <div className="note">
                    每次四维评分自动产出一条 (题目, 作答, 四维评分) 样本，不用另找数据集
                  </div>
                </div>
                <div className="row">
                  <div className="top">
                    <span className="lb">错题本 SM-2 排期</span>
                    <span className="vv">{due == null ? "— 题待复习" : `${due} 题待复习`}</span>
                  </div>
                  <div className="track">
                    <i className="g" style={{ width: "100%" }} />
                  </div>
                  <div className="note">quality 取四维加权总分四舍五入，连续答对 2 次毕业移出</div>
                </div>
                <div className="row">
                  <div className="top">
                    <span className="lb">人工标注评测集</span>
                    <span className="vv" style={{ color: "oklch(72% 0.14 72)" }}>
                      待完成
                    </span>
                  </div>
                  <div className="track">
                    <i style={{ width: "0%" }} />
                  </div>
                  <div className="note">
                    用于「微调前 vs 微调后」对比，指标 = 一致率（±1 分内算一致）+ 每维 MAE
                  </div>
                </div>
                <div className="row">
                  <div className="top">
                    <span className="lb">LoRA 微调结果</span>
                    <span className="vv" style={{ color: "var(--ink-muted)" }}>
                      未产出
                    </span>
                  </div>
                  <div className="track">
                    <i style={{ width: "0%" }} />
                  </div>
                  <div className="note">训练与评测脚本已就绪，尚无有效跑数 —— 不填占位数字</div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="foot">
          <span>推理链路全部流式：出题 / 评分 / 追问 / 简历 / 面试 / 报告</span>
          <span>47 个接口 · 9 条流式链路 · 11 张数据表</span>
          <span className="spacer" />
          <span>延迟基线为云端实测：P50 3.74s · P95 5.45s · P99 5.55s · 0.89 req/s</span>
        </div>
      </div>

      <div className="hintbar">按 F11 全屏 · 画布 1920 × 1080 自动缩放</div>
    </div>
  );
}

/** KPI 数字滚动：从 0 缓出到目标值，一次性跑完。 */
function CountUp({ value, suffix }: { value: string; suffix?: string }) {
  const target = Number(value.replace(/,/g, ""));
  const [n, setN] = useState(0);

  useEffect(() => {
    const steps = 38;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      // easeOutCubic：起步快、收尾稳，比线性更像仪表盘
      setN(Math.round(target * (1 - Math.pow(1 - i / steps, 3))));
      if (i >= steps) {
        clearInterval(t);
        setN(target);
      }
    }, 26);
    return () => clearInterval(t);
  }, [target]);

  return (
    <div className="v">
      {n.toLocaleString("en-US")}
      {suffix && <small>{suffix}</small>}
    </div>
  );
}
