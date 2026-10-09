"use client";

/** 工作台。对应设计稿 dashboard.html。 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import Radar from "@/components/Radar";
import { useToast } from "@/components/ToastProvider";
import {
  answerStats,
  getProfile,
  listDueAnswers,
  listHistory,
  type AnswerItem,
  type AnswerStats,
  type HistoryItem,
  type ProfileItem,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHistory, MODULE_META } from "@/lib/history";
import { greeting, hhmm, relDay, todayLabel } from "@/lib/format";
import { usePageScope } from "@/lib/pageScope";

import "./dashboard.css";

const MOD_LABEL: Record<string, string> = {
  practice: "刷题",
  resume: "简历",
  interview: "面试",
  report: "报告",
};

function toneOf(m: number): string {
  if (m >= 70) return "success";
  if (m >= 55) return "accent";
  if (m >= 45) return "warn";
  return "danger";
}

export default function DashboardPage() {
  usePageScope("dashboard");
  const { token, user } = useAuth();
  const toast = useToast();
  const { restore } = useHistory();

  const [stats, setStats] = useState<AnswerStats | null>(null);
  const [due, setDue] = useState<AnswerItem[]>([]);
  const [hist, setHist] = useState<HistoryItem[]>([]);
  const [profile, setProfile] = useState<ProfileItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      // 四个 GET 并发，互不依赖
      const [s, d, h, p] = await Promise.all([
        answerStats(token),
        listDueAnswers(token),
        listHistory(token),
        getProfile(token),
      ]);
      setStats(s);
      setDue(d);
      setHist(h.slice(0, 6));
      setProfile(p);
    } catch (ex) {
      toast("err", "加载失败", ex instanceof Error ? ex.message : String(ex));
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const radarValues: Record<string, number> = {};
  profile.forEach((p) => {
    radarValues[p.knowledge_point] = Math.round(p.mastery * 100);
  });

  const weak = [...profile].sort((a, b) => a.mastery - b.mastery).slice(0, 4);

  return (
    <div data-page="dashboard">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workbench · {todayLabel()}</div>
          <div className="title-row" style={{ marginTop: 7 }}>
            <h1 className="h1">
              {greeting()}，{user?.nickname || user?.email || ""}
            </h1>
            <span className="pill warn">
              {stats ? `${stats.due} 题待复习` : "—"}
            </span>
          </div>
          <p className="lead" style={{ marginTop: 8, fontSize: 14 }}>
            今天有 <b>{stats?.due ?? "—"}</b> 道错题到了复习窗口。系统按 SM-2 给你排的期，
            连续答对 2 次才会移出错题本。
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/report">
            查看能力报告
          </Link>
          <Link className="btn btn-primary" href="/practice">
            开始刷题训练
          </Link>
        </div>
      </div>

      {/* ===== KPI ===== */}
      <div className="grid g-4">
        <div className="stat accent">
          <div className="k">待复习</div>
          <div className="v">{stats?.due ?? "—"}</div>
          <div className="sub">SM-2 排期已到期</div>
        </div>
        <div className="stat">
          <div className="k">累计作答</div>
          <div className="v">{stats?.total ?? "—"}</div>
          <div className="sub">含历史全部作答</div>
        </div>
        <div className="stat">
          <div className="k">错题</div>
          <div className="v">{stats?.wrong ?? "—"}</div>
          <div className="sub">连续答对 2 次毕业</div>
        </div>
        <div className="stat">
          <div className="k">收藏</div>
          <div className="v">{stats?.favorite ?? "—"}</div>
          <div className="sub">手动标记的题目</div>
        </div>
      </div>

      {/* ===== 主体 ===== */}
      <div className="grid g-main-side mt-5">
        {/* 左列 */}
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <div className="h3">
                今天该复习 <span className="pill accent">{due.length}</span>
              </div>
              <Link className="btn btn-sm" href="/wrongbook">
                打开错题本
              </Link>
            </div>
            <div className="card-body tight">
              {due.length === 0 ? (
                <div className="empty" style={{ border: 0, background: "transparent" }}>
                  <div className="glyph">✓</div>
                  <div className="t">今天没有到期的错题</div>
                  <div className="d">
                    SM-2 排期把下一次复习放在了未来。想加练就去刷题训练出新题。
                  </div>
                </div>
              ) : (
                due.map((a) => {
                  const overdue = a.review_due_at
                    ? new Date(a.review_due_at).getTime() < Date.now()
                    : false;
                  return (
                    <div className={`due-item ${overdue ? "overdue" : "today"}`} key={a.id}>
                      <span className="flag" />
                      <div>
                        <div className="q clamp-2">{a.question_content}</div>
                        <div className="meta">
                          <span className="pill">
                            {a.question_direction || "—"} · {a.question_difficulty || "—"}
                          </span>
                          <span
                            className={`pill ${
                              a.total_score >= 4 ? "success" : a.total_score >= 3 ? "warn" : "danger"
                            }`}
                          >
                            上次 {a.total_score.toFixed(1)}
                          </span>
                          <span className="cap">
                            已复习 {a.review_count} 次 · 间隔 {a.review_interval_days} 天
                          </span>
                        </div>
                      </div>
                      <Link className="btn btn-sm btn-accent" href={`/wrongbook?focus=${a.id}`}>
                        去复习
                      </Link>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">最近交互</div>
              <Link className="btn btn-sm btn-ghost" href="/wrongbook">
                全部历史
              </Link>
            </div>
            <div className="card-body tight">
              {hist.length === 0 ? (
                <div className="empty" style={{ border: 0, background: "transparent" }}>
                  <div className="d">还没有历史记录，去刷题或面试一次就会出现在这里。</div>
                </div>
              ) : (
                hist.map((h) => (
                  <button
                    className="hist-item"
                    key={h.id}
                    onClick={() => restore(h)}
                    style={{
                      width: "100%",
                      background: "none",
                      border: 0,
                      borderBottom: "1px solid var(--border)",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                    type="button"
                  >
                    <span className="mod">
                      {MOD_LABEL[h.module] ?? MODULE_META[h.module]?.label ?? h.module}
                    </span>
                    <span className="t">{h.title}</span>
                    <time className="num">
                      {relDay(h.updated_at)} {hhmm(h.updated_at)}
                    </time>
                  </button>
                ))
              )}
            </div>
            <div className="card-foot">
              <span className="small">
                点任意一条可把当时的页面现场整块灌回去，不需要重跑模型
              </span>
            </div>
          </section>
        </div>

        {/* 右列 */}
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <div className="h3">能力雷达</div>
              <span className="pill">{profile.length} 个知识点</span>
            </div>
            <div
              className="card-body"
              style={{ display: "grid", placeItems: "center", padding: "18px 12px" }}
            >
              {profile.length >= 3 ? (
                <div style={{ width: "100%", display: "grid", placeItems: "center" }}>
                  <Radar values={radarValues} size={288} />
                </div>
              ) : (
                <div className="empty" style={{ border: 0, background: "transparent" }}>
                  <div className="d">
                    还没有足够的能力画像（少于 3 个知识点画不出雷达）。训练后在能力报告页记入画像。
                  </div>
                </div>
              )}
            </div>
            <div className="card-foot">
              <span className="small">掌握度由每次作答的四维加权总分聚合而来</span>
              <Link className="btn btn-sm" href="/report">
                明细
              </Link>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">最该补的短板</div>
            </div>
            <div className="card-body">
              {weak.length === 0 ? (
                <div className="empty" style={{ border: 0, background: "transparent" }}>
                  <div className="d">暂无画像记录。</div>
                </div>
              ) : (
                weak.map((p) => {
                  const m = Math.round(p.mastery * 100);
                  return (
                    <div className="kp" key={p.knowledge_point}>
                      <div>
                        <div className="nm">
                          <span>{p.knowledge_point}</span>
                          <b>{m}%</b>
                        </div>
                        <div className="bar">
                          <i className={toneOf(m)} style={{ width: `${m}%` }} />
                        </div>
                      </div>
                      <Link className="btn btn-sm btn-ghost" href="/practice" style={{ justifySelf: "end" }}>
                        练
                      </Link>
                    </div>
                  );
                })
              )}
            </div>
            <div className="card-foot">
              <span className="small">掌握度 &lt; 0.6 的知识点按升序排列</span>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">快捷入口</div>
            </div>
            <div className="card-body">
              <div className="quick">
                <Link href="/practice">
                  <span className="ic">▸</span>
                  <span className="nm">出题训练</span>
                  <span className="ds">按方向 / 难度 / 题型生成</span>
                </Link>
                <Link href="/interview">
                  <span className="ic">◉</span>
                  <span className="nm">模拟面试</span>
                  <span className="ds">HR 一问一答，token 流式</span>
                </Link>
                <Link href="/resume">
                  <span className="ic">≡</span>
                  <span className="nm">简历诊断</span>
                  <span className="ds">PDF + JD 匹配度分析</span>
                </Link>
                <Link href="/bigscreen">
                  <span className="ic">▣</span>
                  <span className="nm">数据大屏</span>
                  <span className="ds">答辩演示用作战室</span>
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>

      {loading && (
        <p className="small muted mt-4" style={{ textAlign: "center" }}>
          正在加载工作台数据…
        </p>
      )}
    </div>
  );
}
