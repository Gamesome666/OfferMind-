"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
import { usePageState } from "@/lib/pageState";

const PAGE_KEY = "wrongbook";

type Tab = "due" | "wrong" | "favorite";

/** 复习质量选项：0-5，直接用四维加权总分的量纲，SM-2 不用另做映射。 */
const QUALITY_OPTIONS = [
  { value: 0, label: "完全忘了" },
  { value: 2, label: "想起一点" },
  { value: 3, label: "勉强答对" },
  { value: 4, label: "答得不错" },
  { value: 5, label: "脱口而出" },
];

type WrongBookState = {
  tab: Tab;
  items: AnswerItem[];
  stats: AnswerStats | null;
  expandedId: number | null;
  loading: boolean;
};

const INITIAL: WrongBookState = {
  tab: "due",
  items: [],
  stats: null,
  expandedId: null,
  loading: false,
};

/**
 * 一条记录是否属于当前 tab。
 *
 * 抽出来是为了「更新后就地判断归属」，而不是各分支各写一套过滤 —— 否则会出现
 * 「统计说已毕业、列表里还留着」这种自相矛盾的状态（这个坑踩过一次）。
 */
function belongsToTab(item: AnswerItem, tab: Tab): boolean {
  if (tab === "favorite") return item.is_favorite;
  if (tab === "wrong") return item.is_wrong;
  // 待复习：既是错题、又已到期
  if (!item.is_wrong || !item.review_due_at) return false;
  return new Date(item.review_due_at).getTime() <= Date.now();
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function WrongBookPage() {
  const { token } = useAuth();
  const [state, setState] = usePageState<WrongBookState>(PAGE_KEY, INITIAL);
  // 错误提示用普通 state：跨路由保留一条报错没有意义
  const [error, setError] = useState("");

  const { tab, items, stats, expandedId, loading } = state;

  const load = useCallback(
    async (which: Tab = tab) => {
      if (!token) return;
      setState((prev) => ({ ...prev, loading: true }));
      try {
        const [list, counts] = await Promise.all([
          which === "due"
            ? listDueAnswers(token)
            : listAnswers(token, {
                onlyWrong: which === "wrong",
                onlyFavorite: which === "favorite",
              }),
          answerStats(token),
        ]);
        setState((prev) => ({ ...prev, items: list, stats: counts, loading: false }));
      } catch (err) {
        setState((prev) => ({ ...prev, loading: false }));
        setError(err instanceof Error ? err.message : "加载错题本失败");
      }
    },
    [token, tab, setState, setError],
  );

  useEffect(() => {
    if (token) void load(tab);
    // 切 tab 与首次进入都重新拉；load 依赖 tab，所以这里只依赖 tab + token
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab]);

  /** 单个记录变了之后，按归属规则就地更新列表（不再手写每种 tab 的过滤）。 */
  function applyUpdated(updated: AnswerItem) {
    setState((prev) => {
      const rest = prev.items.filter((row) => row.id !== updated.id);
      return {
        ...prev,
        items: belongsToTab(updated, prev.tab) ? [...rest, updated] : rest,
        expandedId: prev.expandedId === updated.id ? null : prev.expandedId,
      };
    });
  }

  async function handleReview(item: AnswerItem, quality: number) {
    if (!token) return;
    try {
      const updated = await reviewAnswer(token, item.id, quality);
      applyUpdated(updated);
      // 统计以服务端为准，避免本地推算与实际不一致
      void refreshStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "复习记录失败");
    }
  }

  async function refreshStats() {
    if (!token) return;
    try {
      const fresh = await answerStats(token);
      setState((prev) => ({ ...prev, stats: fresh }));
    } catch {
      /* 统计刷新失败不影响主流程 */
    }
  }

  async function toggleFavorite(item: AnswerItem) {
    if (!token) return;
    try {
      const updated = await updateAnswerFlags(token, item.id, { is_favorite: !item.is_favorite });
      applyUpdated(updated);
      void refreshStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function markMastered(item: AnswerItem) {
    if (!token) return;
    try {
      const updated = await updateAnswerFlags(token, item.id, { is_wrong: false });
      applyUpdated(updated);
      void refreshStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>错题本</h1>
          <p className="page-sub">
            答错的题按 SM-2 间隔重复排期，到点提醒复习；连续答对两次即视为掌握。
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-bad" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {stats && (
        <div className="grid-3" style={{ marginBottom: 20 }}>
          <div className="stat">
            <div className="k">待复习</div>
            <div className="v">
              {stats.due}
              <span className="u">题</span>
            </div>
          </div>
          <div className="stat">
            <div className="k">错题</div>
            <div className="v">
              {stats.wrong}
              <span className="u">题</span>
            </div>
          </div>
          <div className="stat">
            <div className="k">收藏</div>
            <div className="v">
              {stats.favorite}
              <span className="u">题</span>
            </div>
          </div>
          <div className="stat">
            <div className="k">累计作答</div>
            <div className="v">
              {stats.total}
              <span className="u">次</span>
            </div>
          </div>
        </div>
      )}

      <div className="tabs">
        {(
          [
            ["due", `待复习${stats ? ` (${stats.due})` : ""}`],
            ["wrong", `全部错题${stats ? ` (${stats.wrong})` : ""}`],
            ["favorite", `收藏${stats ? ` (${stats.favorite})` : ""}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`tab${tab === key ? " on" : ""}`}
            onClick={() => setState((prev) => ({ ...prev, tab: key, expandedId: null }))}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="empty">加载中…</div>}

      {!loading && items.length === 0 && (
        <section className="panel">
          <div className="panel-body empty">
            {tab === "due" ? (
              <>
                <p style={{ marginBottom: 12 }}>今天没有到期的复习，休息一下。</p>
                <Link href="/practice" className="btn btn-primary">
                  去刷题
                </Link>
              </>
            ) : tab === "wrong" ? (
              <>
                <p style={{ marginBottom: 12 }}>还没有错题。答得不好的题会自动进这里。</p>
                <Link href="/practice" className="btn btn-primary">
                  去刷题
                </Link>
              </>
            ) : (
              <p>还没有收藏的题。在题目上点「收藏」就会出现在这里。</p>
            )}
          </div>
        </section>
      )}

      <div className="stack">
        {items.map((item) => (
            <section className="panel" key={item.id}>
              <div className="panel-head">
                <h3 style={{ fontSize: 13.5, fontWeight: 400, color: "var(--ink-3)" }}>
                  作答于 {fmtDate(item.created_at)}
                </h3>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`chip ${item.total_score < 3 ? "chip-bad" : "chip-ok"}`}>
                    {item.total_score.toFixed(2)} / 5
                  </span>
                  {item.review_count > 0 && (
                    <span className="chip">已复习 {item.review_count} 次</span>
                  )}
                </div>
              </div>
              <div className="panel-body stack-sm">
                <div className="q-body" style={{ fontSize: 14 }}>
                  {item.question_content.length > 220 && expandedId !== item.id
                    ? `${item.question_content.slice(0, 220)}…`
                    : item.question_content}
                </div>

                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="muted">
                    作答：
                    {expandedId === item.id
                      ? item.answer_content
                      : `${item.answer_content.slice(0, 80)}${item.answer_content.length > 80 ? "…" : ""}`}
                  </span>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        expandedId: prev.expandedId === item.id ? null : item.id,
                      }))
                    }
                    type="button"
                  >
                    {expandedId === item.id ? "收起" : "展开评分明细"}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void toggleFavorite(item)}
                    type="button"
                  >
                    {item.is_favorite ? "★ 取消收藏" : "☆ 收藏"}
                  </button>
                  {item.is_wrong && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void markMastered(item)}
                      type="button"
                    >
                      标记已掌握
                    </button>
                  )}
                  <span className="muted" style={{ marginLeft: "auto" }}>
                    下次复习 {fmtDate(item.review_due_at)}（间隔 {item.review_interval_days} 天）
                  </span>
                </div>

                {expandedId === item.id && (
                  <div className="stack-sm" style={{ marginTop: 6 }}>
                    {(
                      [
                        ["correctness", "正确性"],
                        ["completeness", "完整性"],
                        ["clarity", "表达结构"],
                        ["terminology", "术语准确"],
                      ] as const
                    ).map(([key, label]) => {
                      const dim = item.score_json[key];
                      if (!dim) return null;
                      return (
                        <div key={key}>
                          <div className="score-row">
                            <span className="score-name">{label}</span>
                            <div className="score-bar">
                              <div
                                className="score-fill"
                                style={{ width: `${(dim.score / 5) * 100}%` }}
                              />
                            </div>
                            <span className="score-val">{dim.score}/5</span>
                          </div>
                          <p className="muted" style={{ marginTop: 4, paddingLeft: 102 }}>
                            {dim.reason}
                          </p>
                        </div>
                      );
                    })}
                    {item.score_json.suggestions && (
                      <div className="answer-box suggest" style={{ whiteSpace: "normal" }}>
                        <strong>改进建议</strong>
                        {"\n"}
                        {item.score_json.suggestions}
                      </div>
                    )}

                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      <span className="muted">这次回忆得怎么样？</span>
                      {QUALITY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          className="btn btn-ghost btn-sm"
                          onClick={() => void handleReview(item, opt.value)}
                          type="button"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
        ))}
      </div>
    </>
  );
}
