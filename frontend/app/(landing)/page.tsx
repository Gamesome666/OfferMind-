"use client";

/**
 * 落地页。对应设计稿 index.html。
 *
 * 这是唯一一个「不自建状态」的页面：它是产品介绍页，交互全在 Canvas 与滚动动画里，
 * 不请求后端。所以做法是把设计稿的结构转成 JSX，交互脚本由 `landing.js` 的
 * `initLanding()` 在 useEffect 里挂载（详见那个文件的说明）。
 */

import Link from "next/link";
import { useEffect } from "react";

import { initLanding } from "./landing";
import { usePageScope } from "@/lib/pageScope";

import "./landing.css";

/** CSS 自定义属性要写成索引签名，TS 才认 */
function cssVars(vars: Record<string, string>): React.CSSProperties {
  return vars as React.CSSProperties;
}

export default function LandingPage() {
  usePageScope("landing");
  useEffect(() => {
    // 返回的清理函数会 abort 掉本次注册的所有监听器，并让离屏的 RAF 停掉
    return initLanding();
  }, []);

  return (
    <div data-page="landing">
      {/* ==================== 顶栏 ==================== */}
      <header className="top on-dark" id="top">
        <div className="top-in">
          <Link className="brand" href="/">
            <span className="m">OfferMind</span>
            <span className="t">v0.9</span>
          </Link>
          <nav>
            <Link href="/dashboard">工作台</Link>
            <Link href="/practice">刷题训练</Link>
            <Link href="/interview">模拟面试</Link>
            <Link href="/resume">简历诊断</Link>
            <Link href="/report">能力报告</Link>
            <Link href="/bigscreen">数据大屏</Link>
          </nav>
          <span className="spacer" />
          <span className="pill-dark" id="navstat">
            <span className="dot done" />
            服务运行中
          </span>
          <Link className="btn btn-primary" href="/login">
            进入系统
          </Link>
        </div>
      </header>

      {/* ==================== 首屏 ==================== */}
      <section className="hero" id="hero">
        <canvas
          id="sky"
          aria-label="检索星图：光标即查询向量，靠近的知识片段被召回并排序"
        />

        <div className="hero-in">
          <div className="hero-copy">
            <div className="eyebrow">可观测 Agentic RAG · AI 求职面试训练平台</div>
            <h1>
              <span className="l">
                <span>每一次检索</span>
              </span>
              <span className="l">
                <span>
                  都<em>看得见</em>
                </span>
              </span>
            </h1>
            <p className="sub">
              移动光标 —— 它就是你这一次的查询向量。被点亮的片段是从题库里召回的知识点，
              右侧按相似度排出保留的前 5 条。你在屏幕上看到的，正是评分时喂给模型的参照。
            </p>
            <div className="cta">
              <Link className="btn btn-primary btn-lg" href="/practice">
                开始一次刷题训练
              </Link>
              <Link className="btn btn-lg btn-on-dark" href="/bigscreen">
                看数据大屏
              </Link>
            </div>
          </div>

          {/* 实时读出：数字全部由光标与节点的真实距离算出 */}
          <aside className="hud">
            <div className="hud-h">
              <span className="eyebrow">Retrieval</span>
              <span className="live" id="hudstate">
                <span className="dot running" />
                live
              </span>
            </div>
            <div className="hud-stats">
              <div>
                <div className="k">召回候选</div>
                <div className="v" id="hud-recall">
                  0
                </div>
              </div>
              <div>
                <div className="k">精排保留</div>
                <div className="v">
                  5<small>条</small>
                </div>
              </div>
              <div>
                <div className="k">最高相似度</div>
                <div className="v" id="hud-top">
                  —
                </div>
              </div>
            </div>
            <div className="hud-list" id="hud-list" />
            <div className="hud-f">点击画布 = 重新发起一次检索</div>
          </aside>
        </div>

        <div className="cue">
          <span>向下滚动</span>
          <span className="rail" />
        </div>
      </section>

      {/* ==================== 正文 ==================== */}
      <div className="wrap">
        {/* 对照 */}
        <section className="sec">
          <div className="sec-head rv">
            <div className="eyebrow">Why Observable</div>
            <h2>同样是 3.7 秒，差别在于用户知不知道发生了什么</h2>
            <p>
              把模型调用摊开，直接改变两件事：卡住时用户知道卡在哪一步，答得不好时用户知道是哪一维、为什么。这两件事决定了用户是继续练，还是关掉页面。
            </p>
          </div>

          <div className="vs">
            <div className="vs-card dim rv" style={cssVars({ "--d": "80ms" })}>
              <div className="vs-h">
                <span className="dot" />
                默认形态 <span className="tagn pill">只给结果</span>
              </div>
              <div className="vs-b">
                <div className="spin" />
                <div className="dimline">
                  <i />
                </div>
                <div className="cap2">正在生成…</div>
              </div>
            </div>

            <div className="vs-card rv" style={cssVars({ "--d": "160ms" })}>
              <div className="vs-h">
                <span className="dot done" />
                OfferMind <span className="tagn pill accent">给过程</span>
              </div>
              <div className="vs-b">
                <div className="steps-mini" id="trace" />
              </div>
            </div>
          </div>
        </section>

        {/* 数据飞轮 */}
        <section className="sec">
          <div className="sec-head rv">
            <div className="eyebrow">Data Flywheel</div>
            <h2>每一次作答，都在让评分器变好一点</h2>
            <p>
              这套系统不需要另找数据集 —— 它自己就在生产训练样本。点开任意一环看它做什么。
            </p>
          </div>

          <div className="wheel-wrap rv">
            <div className="ring" id="ring">
              <svg viewBox="0 0 380 380" aria-hidden="true">
                <circle className="arc" cx="190" cy="190" r="132" />
                <circle
                  className="arc-hi"
                  id="ringHi"
                  cx="190"
                  cy="190"
                  r="132"
                  strokeDasharray="0 830"
                  strokeDashoffset="0"
                />
              </svg>
              <div className="ring-core">
                <div className="n" id="ringNum">
                  01
                </div>
                <div className="cap" id="ringCap">
                  入口
                </div>
              </div>
            </div>
            <div className="wdetail">
              <h3 id="w-title">—</h3>
              <p id="w-body">—</p>
              <div className="fact" id="w-fact">
                —
              </div>
            </div>
          </div>
        </section>

        {/* 四维评分 */}
        <section className="sec">
          <div className="sec-head rv">
            <div className="eyebrow">Explainable Scoring</div>
            <h2>不给裸分数，每一维都要说出理由</h2>
            <p>
              四维 rubric 加权求和，每一维单独打分并给出评分理由。用户拿到的不只是「3.4
              分」，而是「哪一维拖了后腿、下次怎么改」。
            </p>
          </div>

          <div className="score-card rv">
            <div className="total">
              <div className="gauge">
                <svg viewBox="0 0 148 148" width="148" height="148">
                  <circle className="ring-bg" cx="74" cy="74" r="64" />
                  <circle
                    className="ring-fg"
                    id="gaugeArc"
                    cx="74"
                    cy="74"
                    r="64"
                    strokeDasharray="402"
                    strokeDashoffset="402"
                  />
                </svg>
                <div className="in">
                  <div className="n" id="gaugeNum">
                    0.00
                  </div>
                  <div className="d">/ 5.00</div>
                </div>
              </div>
              <div className="say">
                方向对但讲不透
                <br />
                属于典型的「会做不会说」
              </div>
            </div>

            <div className="dim-rows">
              <div className="dim-row">
                <div className="nm">
                  正确性<em>权重 0.40</em>
                </div>
                <div className="bd">
                  <div className="bar">
                    <i className="warn" data-w="60" />
                  </div>
                  <div className="why">
                    说对了「最左前缀」这一条，但没讲清范围查询会中断后续列的匹配。
                  </div>
                </div>
                <div className="sc">
                  3<span> / 5</span>
                </div>
              </div>
              <div className="dim-row">
                <div className="nm">
                  完整性<em>权重 0.30</em>
                </div>
                <div className="bd">
                  <div className="bar">
                    <i className="warn" data-w="60" />
                  </div>
                  <div className="why">漏了覆盖索引与索引下推两个常见追问点。</div>
                </div>
                <div className="sc">
                  3<span> / 5</span>
                </div>
              </div>
              <div className="dim-row">
                <div className="nm">
                  表达与结构<em>权重 0.15</em>
                </div>
                <div className="bd">
                  <div className="bar">
                    <i className="accent" data-w="80" />
                  </div>
                  <div className="why">结构清楚，先结论后解释。</div>
                </div>
                <div className="sc">
                  4<span> / 5</span>
                </div>
              </div>
              <div className="dim-row">
                <div className="nm">
                  术语准确性<em>权重 0.15</em>
                </div>
                <div className="bd">
                  <div className="bar">
                    <i className="accent" data-w="80" />
                  </div>
                  <div className="why">术语使用准确，没有混淆聚簇索引与二级索引。</div>
                </div>
                <div className="sc">
                  4<span> / 5</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <footer className="foot">
          <div className="foot-links">
            <Link href="/dashboard">
              <span className="ic">◇</span>工作台
            </Link>
            <Link href="/practice">
              <span className="ic">▸</span>刷题训练
            </Link>
            <Link href="/wrongbook">
              <span className="ic">★</span>错题本
            </Link>
            <Link href="/interview">
              <span className="ic">◉</span>模拟面试
            </Link>
            <Link href="/resume">
              <span className="ic">≡</span>简历诊断
            </Link>
            <Link href="/report">
              <span className="ic">◈</span>能力报告
            </Link>
            <Link href="/admin">
              <span className="ic">⌘</span>后台概览
            </Link>
            <Link href="/admin/questions">
              <span className="ic">▤</span>题库管理
            </Link>
            <Link href="/admin/config">
              <span className="ic">⚙</span>模型与检索
            </Link>
            <Link href="/admin/api">
              <span className="ic">⌗</span>接口控制台
            </Link>
            <Link href="/bigscreen">
              <span className="ic">▣</span>数据大屏
            </Link>
          </div>
          <div className="foot-base">
            <span>OfferMind · 可观测 Agentic RAG 驱动的 AI 求职面试训练平台</span>
            <span className="spacer" />
            <span>云端推理实测：P50 3.74s · P95 5.45s · P99 5.55s · 0.89 req/s</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
