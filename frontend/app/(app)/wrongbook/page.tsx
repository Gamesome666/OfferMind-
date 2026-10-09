"use client";

/**
 * 错题本。对应设计稿 wrongbook.html。
 *
 * 数据源是 answers 表。SM-2 排期由后端算（`app/repositories/answer.py`），
 * 这里的 `sm2()` 只是**弹层里的预测**，让用户在选 quality 时立刻看到下次复习时间；
 * 提交后以服务端返回值为准。
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import Modal from "@/components/Modal";
import Seg from "@/components/Seg";
import { useToast } from "@/components/ToastProvider";
import {
  answerStats,
  listAnswers,
  listDueAnswers,
  reviewAnswer,
  updateAnswerFlags,
  type AnswerItem,
  type AnswerStats,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { md, ymd } from "@/lib/format";
import { usePageScope } from "@/lib/pageScope";

import "./wrongbook.css";

type Tab = "due" | "wrong" | "fav" | "all";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "due", label: "待复习" },
  { value: "wrong", label: "错题" },
  { value: "fav", label: "收藏" },
  { value: "all", label: "全部" },
];

const EP: Record<Tab, string> = {
  due: "按到期时间倒序",
  wrong: "只看看答错过的题",
  fav: "只看手动收藏的题",
  all: "全部作答记录",
};

const QUALITY: Array<[number, string]> = [
  [0, "完全不会"],
  [1, "错得较多"],
  [2, "有印象"],
  [3, "答对了"],
  [4, "答得不错"],
  [5, "非常熟"],
];

function chipClass(v: number): string {
  return v >= 4 ? "s4" : v >= 3 ? "s3" : v >= 2 ? "s2" : "s1";
}

/**
 * 前端预测，与后端 `sm2_next()` 保持一致。只用于弹层预览 ——
 * 真正落库的是服务端算的结果，提交后以返回值为准。
 */
function sm2(rec: AnswerItem, quality: number) {
  let interval = rec.review_interval_days || 0;
  const ease = 2.5;
  let count = rec.review_count || 0;
  if (quality < 3) return { interval: 1, count: 0, ease: Math.max(1.3, ease), reset: true, graduated: false };
  count += 1;
  if (count === 1) interval = 1;
  else if (count === 2) interval = 6;
  else interval = Math.round((interval || 6) * ease);
  const next = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  return { interval, count, ease: next, reset: false, graduated: count >= 2 };
}

export default function WrongbookPage() {
  const { token } = useAuth();
  const toast = useToast();
  // 把样式作用域挂到 body（弹层 portal 到 body，必须这样才在作用域内）
  usePageScope("wrongbook");

  const [tab, setTab] = useState<Tab>("due");
  const [rows, setRows] = useState<AnswerItem[]>([]);
  const [stats, setStats] = useState<AnswerStats | null>(null);
  const [loading, setLoading] = useState(true);

  // 复习弹层
  const [reviewing, setReviewing] = useState<AnswerItem | null>(null);
  const [quality, setQuality] = useState(4);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    async (which: Tab) => {
      if (!token) return;
      try {
        const [list, s] = await Promise.all([
          which === "due"
            ? listDueAnswers(token)
            : listAnswers(token, {
                onlyWrong: which === "wrong",
                onlyFavorite: which === "fav",
              }),
          answerStats(token),
        ]);
        setRows(list);
        setStats(s);
      } catch (ex) {
        toast("err", "加载失败", ex instanceof Error ? ex.message : String(ex));
      } finally {
        setLoading(false);
      }
    },
    [token, toast],
  );

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  /** 单条记录变了之后，按归属规则就地更新列表（避免「统计说已毕业、列表还留着」）。 */
  function applyUpdated(updated: AnswerItem) {
    const belongs =
      tab === "fav"
        ? updated.is_favorite
        : tab === "wrong" || tab === "due"
          ? updated.is_wrong &&
            (tab === "wrong" ||
              (updated.review_due_at != null &&
                new Date(updated.review_due_at).getTime() <= Date.now()))
          : true;
    setRows((prev) => {
      const rest = prev.filter((r) => r.id !== updated.id);
      return belongs ? [...rest, updated] : rest;
    });
  }

  async function refreshStats() {
    if (!token) return;
    try {
      setStats(await answerStats(token));
    } catch {
      /* 统计刷新失败不影响主流程 */
    }
  }

  async function toggleWrong(item: AnswerItem) {
    if (!token) return;
    try {
      const updated = await updateAnswerFlags(token, item.id, { is_wrong: !item.is_wrong });
      applyUpdated(updated);
      void refreshStats();
      toast("ok", "标记已更新", updated.is_wrong ? "已加入错题本，按 SM-2 排队" : "已移出错题本");
    } catch (ex) {
      toast("err", "操作失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function toggleFav(item: AnswerItem) {
    if (!token) return;
    try {
      const updated = await updateAnswerFlags(token, item.id, { is_favorite: !item.is_favorite });
      applyUpdated(updated);
      void refreshStats();
      toast("ok", "收藏已更新", updated.is_favorite ? "已加入收藏夹" : "已取消收藏");
    } catch (ex) {
      toast("err", "操作失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function submitReview() {
    if (!token || !reviewing) return;
    setSubmitting(true);
    try {
      const updated = await reviewAnswer(token, reviewing.id, quality);
      setReviewing(null);
      applyUpdated(updated);
      await refreshStats();
      toast(
        "ok",
        "复习已记录",
        updated.is_wrong
          ? `下次复习：${updated.review_interval_days} 天后（${md(updated.review_due_at)}）`
          : `已毕业移出错题本 · quality ${quality}`,
      );
    } catch (ex) {
      toast("err", "复习提交失败", ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSubmitting(false);
    }
  }

  async function batchReview() {
    if (!token) return;
    try {
      const due = await listDueAnswers(token);
      if (!due.length) return toast("info", "没有到期题目", "SM-2 把下一次复习排在了未来。");
      setQuality(4);
      setReviewing(due[0]);
    } catch (ex) {
      toast("err", "加载失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  const prediction = reviewing ? sm2(reviewing, quality) : null;

  return (
    <div data-page="wrongbook">
      <div className="page-head">
        <div>
          <div className="eyebrow">Wrong Book · SM-2 间隔重复</div>
          <div className="title-row" style={{ marginTop: 7 }}>
            <h1 className="h1">错题本</h1>
            <span className="pill accent">
              <span className="dot running" />
              <b>{stats?.due ?? 0}</b> 题到期
            </span>
          </div>
          <p className="lead" style={{ marginTop: 8, fontSize: 14 }}>
            评分落库时按 SM-2 排下一次复习时间。
            <b>连续答对 2 次才移出错题本</b> ——
            答对一次就移出的话，刚排的复习计划永远不会触发。
          </p>
        </div>
        <div className="actions">
          <button className="btn" id="btn-batch" onClick={batchReview} type="button">
            开始本轮复习
          </button>
          <Link className="btn btn-ghost" href="/practice">
            去出新题
          </Link>
        </div>
      </div>

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
          <div className="sub">待巩固的知识点</div>
        </div>
        <div className="stat">
          <div className="k">收藏</div>
          <div className="v">{stats?.favorite ?? "—"}</div>
          <div className="sub">手动标记的题目</div>
        </div>
      </div>

      <section className="card mt-5">
        <div className="toolbar">
          <Seg
            options={TABS}
            value={tab}
            onChange={(v) => {
              setTab(v as Tab);
              setLoading(true);
            }}
          />
          <span className="spacer" style={{ marginLeft: "auto" }} />
          <span className="small">{EP[tab]}</span>
        </div>
        <div className="card-body tight" id="list">
          {loading ? (
            <div className="empty" style={{ border: 0, background: "transparent" }}>
              <div className="d">加载中…</div>
            </div>
          ) : rows.length === 0 ? (
            <div className="empty" style={{ border: 0, background: "transparent" }}>
              <div className="glyph">✓</div>
              <div className="t">这个筛选下没有记录</div>
              <div className="d">换个筛选看看，或者去刷题训练产生新的作答记录。</div>
            </div>
          ) : (
            rows.map((a) => {
              const dueAt = a.review_due_at ? new Date(a.review_due_at) : null;
              const overdue = dueAt != null && dueAt.getTime() <= Date.now();
              const days = dueAt
                ? Math.max(0, Math.round((dueAt.getTime() - Date.now()) / 86400000))
                : null;
              const prog = Math.min(100, (a.review_count / 2) * 100);
              return (
                <div className="row-item" data-id={a.id} key={a.id}>
                  <div className={`scorechip ${chipClass(a.total_score)}`}>
                    {a.total_score.toFixed(1)}
                  </div>
                  <div>
                    <div className="q clamp-2">{a.question_content || "（题目已删除）"}</div>
                    <div className="meta">
                      <span className="pill">
                        {a.question_direction || "—"} · {a.question_difficulty || "—"} ·{" "}
                        {a.question_type || "—"}
                      </span>
                      {a.is_wrong ? (
                        <span className="pill danger">错题</span>
                      ) : (
                        <span className="pill success">已掌握</span>
                      )}
                      {a.is_favorite && <span className="pill warn">★ 收藏</span>}
                      <span className="cap">created {ymd(a.created_at)}</span>
                    </div>
                  </div>
                  <div className="sched">
                    {dueAt ? (
                      <>
                        <div className={`due${overdue ? " over" : ""}`}>
                          <span className={`dot ${overdue ? "error" : "done"}`} />
                          {overdue ? "已到期" : `${days} 天后`} · {md(a.review_due_at)}
                        </div>
                        <div className="bar-mini">
                          <i style={{ width: `${prog}%` }} />
                        </div>
                        <div className="cap">
                          复习 {a.review_count}/2 次 · 当前间隔 {a.review_interval_days} 天
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="due">
                          <span className="dot done" />
                          已毕业 · 移出错题本
                        </div>
                        <div className="cap">
                          共复习 {a.review_count} 次 · 末次间隔 {a.review_interval_days} 天
                        </div>
                      </>
                    )}
                  </div>
                  <div className="acts">
                    {dueAt && (
                      <button
                        className="btn btn-sm btn-accent"
                        onClick={() => {
                          setQuality(4);
                          setReviewing(a);
                        }}
                        type="button"
                      >
                        复习
                      </button>
                    )}
                    <button
                      className="btn btn-sm"
                      onClick={() => void toggleWrong(a)}
                      title="切换错题标记"
                      type="button"
                    >
                      {a.is_wrong ? "标为掌握" : "标为错题"}
                    </button>
                    <button
                      className={`btn btn-sm ${a.is_favorite ? "btn-primary" : ""}`}
                      onClick={() => void toggleFav(a)}
                      title="切换收藏"
                      type="button"
                    >
                      ★
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="card mt-5">
        <div className="card-head">
          <div className="h3">SM-2 调度规则</div>
          <span className="pill">quality 取四维加权总分四舍五入</span>
        </div>
        <div className="card-body">
          <div
            className="two"
            style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 22 }}
          >
            <div className="formula">
              if quality &lt; 3&nbsp;&nbsp;→ interval = 1, count = 0&nbsp;&nbsp;
              <span className="dim">（答错，重新开始）</span>
              <br />
              count = 0&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ interval = 1 天
              <br />
              count = 1&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ interval = 6 天
              <br />
              count ≥ 2&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ interval = round(interval × ease)
              <br />
              ease′ = ease + (0.1 − (5−q) × (0.08 + (5−q) × 0.02))&nbsp;&nbsp;
              <span className="dim">最小 1.3</span>
            </div>
            <div className="stack-sm" style={{ fontSize: 12.5 }}>
              <div className="row-between">
                <span className="dim">毕业条件</span>
                <span className="mono">连续答对 2 次 → 移出错题本</span>
              </div>
              <div className="row-between">
                <span className="dim">quality 来源</span>
                <span className="mono">四维加权总分四舍五入（0–5）</span>
              </div>
              <div className="row-between">
                <span className="dim">未传 quality 时</span>
                <span className="mono">用上次评分取整</span>
              </div>
              <div className="row-between">
                <span className="dim">数据双用途</span>
                <span className="mono">错题排期 + LoRA SFT 样本</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== 复习弹层 ==================== */}
      <Modal
        open={reviewing !== null}
        title="复习一次"
        wide
        onClose={() => setReviewing(null)}
        foot={
          <>
            <button className="btn" onClick={() => setReviewing(null)} type="button">
              取消
            </button>
            <button
              className="btn btn-accent"
              onClick={() => void submitReview()}
              disabled={submitting}
              type="button"
            >
              {submitting ? "提交中…" : "提交复习"}
            </button>
          </>
        }
      >
        {reviewing && prediction && (
          <>
            <div className="eyebrow">题目</div>
            <p className="rv-q mt-2">{reviewing.question_content}</p>
            <div className="eyebrow mt-4">你上次的作答</div>
            <div className="rv-mine">{reviewing.answer_content}</div>
            <div className="eyebrow mt-4">
              这次答得怎么样？{" "}
              <span className="dim" style={{ textTransform: "none", letterSpacing: 0 }}>
                quality 0–5，直接对应四维加权总分
              </span>
            </div>
            <div className="qbtns">
              {QUALITY.map(([n, label]) => (
                <button
                  className="qbtn"
                  data-q={n}
                  key={n}
                  aria-pressed={quality === n}
                  onClick={() => setQuality(n)}
                  type="button"
                >
                  <span className="n">{n}</span>
                  <span className="l">{label}</span>
                </button>
              ))}
            </div>
            <div className="predict">
              <div>
                <div className="k">下次复习</div>
                <div className="v">{prediction.interval} 天</div>
              </div>
              <div>
                <div className="k">连续答对</div>
                <div className="v">{prediction.count} / 2</div>
              </div>
              <div>
                <div className="k">难度系数 ease</div>
                <div className="v">{prediction.ease.toFixed(2)}</div>
              </div>
            </div>
            <p className="hint mt-3">
              {prediction.reset
                ? "quality < 3：间隔重置为 1 天，连续答对次数清零。"
                : prediction.graduated
                  ? "连续答对已达 2 次 —— 本次复习后将移出错题本（毕业）。"
                  : "再连续答对一次即可移出错题本。"}
            </p>
          </>
        )}
      </Modal>
    </div>
  );
}
