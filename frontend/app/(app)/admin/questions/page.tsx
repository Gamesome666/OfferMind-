"use client";

/**
 * 题库管理。对应设计稿 admin-questions.html。
 *
 * 关键语义：题目的增删改是 **PG + Qdrant 双写** —— 后端在同一请求里完成
 * 「落库 → BGE-M3 向量化 → Qdrant upsert/delete」。前端拿不到逐段进度，
 * 双写进度条按请求生命周期推进：发出 → 等待 → 返回后三行全亮。
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useConfirm } from "@/components/ConfirmProvider";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import {
  adminCreateQuestion,
  adminDeleteQuestion,
  adminListQuestions,
  adminUpdateQuestion,
  type AdminQuestion,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePageScope } from "@/lib/pageScope";

import "./questions.css";

const DIRS = ["后端", "前端", "算法", "数据库", "操作系统", "计算机网络"];
const DIFFS = ["初级", "中级", "高级"];
const TYPES = ["八股", "算法", "业务"];

type FormState = {
  direction: string;
  difficulty: string;
  question_type: string;
  content: string;
  reference_answer: string;
  key_points: string;
};

const FORM_INIT: FormState = {
  direction: DIRS[0],
  difficulty: DIFFS[1],
  question_type: TYPES[0],
  content: "",
  reference_answer: "",
  key_points: "",
};

export default function AdminQuestionsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  usePageScope("admin-questions");

  const [rows, setRows] = useState<AdminQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [kw, setKw] = useState("");
  const [dirFilter, setDirFilter] = useState("");
  const [size, setSize] = useState(10);
  const [loading, setLoading] = useState(true);

  // 表单弹层：null = 关闭；{ mode: "new" } / { mode: "edit", q }
  const [form, setForm] = useState<{ mode: "new" | "edit"; q?: AdminQuestion; value: FormState } | null>(null);
  const [saving, setSaving] = useState(false);
  // 双写进度条：三行点亮的阶段
  const [sync, setSync] = useState<{ pg: boolean; emb: boolean; qd: boolean } | null>(null);

  const kwTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (p = page, keyword = kw, d = dirFilter, sz = size) => {
      if (!token) return;
      setLoading(true);
      try {
        const r = await adminListQuestions(token, {
          keyword,
          direction: d,
          page: p,
          size: sz,
        });
        setRows(r.items);
        setTotal(r.total);
        setPage(r.page);
      } catch (ex) {
        toast("err", "题库加载失败", ex instanceof Error ? ex.message : String(ex));
      } finally {
        setLoading(false);
      }
    },
    [token, page, kw, dirFilter, size, toast],
  );

  useEffect(() => {
    void load(1, "", "", 10);
    // 首次加载单独跑一次，避免把「尚未初始化的 state」当依赖抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSearch(v: string) {
    setKw(v);
    if (kwTimer.current) clearTimeout(kwTimer.current);
    kwTimer.current = setTimeout(() => void load(1, v, dirFilter, size), 250);
  }

  function openNew() {
    setForm({ mode: "new", value: FORM_INIT });
    setSync(null);
  }

  function openEdit(q: AdminQuestion) {
    setForm({
      mode: "edit",
      q,
      value: {
        direction: q.direction,
        difficulty: q.difficulty,
        question_type: q.question_type,
        content: q.content,
        reference_answer: q.reference_answer,
        key_points: q.key_points,
      },
    });
    setSync(null);
  }

  function patchForm(patch: Partial<FormState>) {
    setForm((f) => (f ? { ...f, value: { ...f.value, ...patch } } : f));
  }

  async function submitForm() {
    if (!token || !form) return;
    const p = form.value;
    if (!p.content || p.content.length < 8) {
      return toast("err", "题干太短", "至少 8 个字，否则向量化后没有区分度。");
    }
    setSaving(true);
    // 步骤一：PG 落库中 → 步骤二三等待
    setSync({ pg: false, emb: false, qd: false });
    try {
      const res =
        form.mode === "new"
          ? await adminCreateQuestion(token, p)
          : await adminUpdateQuestion(token, form.q!.id, p);
      setSync({ pg: true, emb: true, qd: true });
      // 三行绿灯闪一下再收，用户能看到「写完了」
      await new Promise((r) => setTimeout(r, 450));
      setForm(null);
      await load();
      toast(
        "ok",
        form.mode === "new" ? "题目已创建" : "题目已更新",
        `已同步到检索库（question_id ${res.id}），新值立刻可被检索到`,
      );
    } catch (ex) {
      setSync(null);
      toast("err", form.mode === "new" ? "创建失败" : "保存失败", ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSaving(false);
    }
  }

  async function delQ(q: AdminQuestion) {
    if (!token) return;
    const ok = await confirm({
      title: "删除题目",
      msg: `将删除题目 #${q.id}（${q.direction} · ${q.difficulty} · ${q.question_type}）。`,
      detail: (
        <div
          className="mono small"
          style={{
            border: "1px solid oklch(68% 0.15 72 / 0.32)",
            background: "var(--warn-soft)",
            color: "oklch(42% 0.11 72)",
            padding: "10px 12px",
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.6,
          }}
        >
          ⚠ 删除会同时清掉这道题的检索索引。若只删题库、不同步索引，后续检索仍会命中这道已删的题，
          并在评分时作为参照喂给模型。
        </div>
      ),
      ok: "删除并同步向量库",
      danger: true,
    });
    if (!ok) return;
    try {
      await adminDeleteQuestion(token, q.id);
      await load();
      toast("ok", "题目已删除", "题库与检索索引均已移除");
    } catch (ex) {
      toast("err", "删除失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  // 查看弹层：只读预览
  const [viewing, setViewing] = useState<AdminQuestion | null>(null);

  const pages = Math.max(1, Math.ceil(total / size));

  const formBody: ReactNode = form && (
    <>
      <div className="form-row" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
        <div className="field">
          <label className="label">
            技术方向 <span className="req">*</span>
          </label>
          <select
            className="select"
            value={form.value.direction}
            onChange={(e) => patchForm({ direction: e.target.value })}
          >
            {DIRS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">
            难度 <span className="req">*</span>
          </label>
          <select
            className="select"
            value={form.value.difficulty}
            onChange={(e) => patchForm({ difficulty: e.target.value })}
          >
            {DIFFS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">
            题型 <span className="req">*</span>
          </label>
          <select
            className="select"
            value={form.value.question_type}
            onChange={(e) => patchForm({ question_type: e.target.value })}
          >
            {TYPES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field mt-3">
        <label className="label">
          题干 <span className="req">*</span>
        </label>
        <textarea
          className="textarea"
          style={{ minHeight: 88 }}
          placeholder="完整题干；算法题把输入输出样例写进「参考答案」或考点里"
          value={form.value.content}
          onChange={(e) => patchForm({ content: e.target.value })}
        />
      </div>
      <div className="field mt-3">
        <label className="label">参考答案</label>
        <textarea
          className="textarea"
          placeholder="评分与追问都会以它为参照"
          value={form.value.reference_answer}
          onChange={(e) => patchForm({ reference_answer: e.target.value })}
        />
      </div>
      <div className="field mt-3">
        <label className="label">考察点</label>
        <input
          className="input"
          placeholder="用 / 分隔，如：最左前缀 / 覆盖索引 / 索引下推"
          value={form.value.key_points}
          onChange={(e) => patchForm({ key_points: e.target.value })}
        />
      </div>

      {sync && (
        <div className="syncbar mt-4">
          <SyncLine done={sync.pg} label="PG 落库" text={sync.pg ? "已写入" : "写入中…"} />
          <SyncLine done={sync.emb} label="BGE-M3 向量化" text={sync.emb ? "向量化完成 · dim=1024" : "等待中"} />
          <SyncLine
            done={sync.qd}
            label="Qdrant upsert"
            text={sync.qd ? "已 upsert · 同 point id 覆盖写" : "等待中"}
          />
        </div>
      )}

      {form.mode === "edit" && (
        <p className="hint mt-3">编辑会用同一个 point id 覆盖写回向量库，不会留下孤儿向量。</p>
      )}
    </>
  );

  return (
    <div data-page="admin-questions">
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin · 题库管理</div>
          <div className="title-row" style={{ marginTop: 7 }}>
            <h1 className="h1">题库管理</h1>
            <span className="pill">共 {total} 题</span>
          </div>
          <p className="lead" style={{ marginTop: 8, fontSize: 14 }}>
            题目是跨用户复用的公共资源。每次增删改都会同步向量库 ——{" "}
            <b>只改 PostgreSQL 不同步 Qdrant，检索会继续命中已删的旧题</b>。
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/admin">
            返回概览
          </Link>
          <button className="btn btn-primary" onClick={openNew} type="button">
            新建题目
          </button>
        </div>
      </div>

      <section className="card" style={{ overflow: "hidden" }}>
        <div className="toolbar">
          <div className="search">
            <input
              className="input"
              placeholder="按题干关键词搜索"
              value={kw}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          <select
            className="select"
            style={{ width: 150 }}
            value={dirFilter}
            onChange={(e) => {
              setDirFilter(e.target.value);
              void load(1, kw, e.target.value, size);
            }}
          >
            <option value="">全部方向</option>
            {DIRS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select
            className="select"
            style={{ width: 110 }}
            value={size}
            onChange={(e) => {
              const sz = Number(e.target.value);
              setSize(sz);
              void load(1, kw, dirFilter, sz);
            }}
          >
            <option value="5">每页 5 条</option>
            <option value="10">每页 10 条</option>
            <option value="20">每页 20 条</option>
          </select>
          <span className="spacer" style={{ marginLeft: "auto" }} />
          <span className="small">{kw || dirFilter ? "已应用筛选" : "按关键词与方向筛选"}</span>
        </div>

        <div className="table-wrap" style={{ maxHeight: "none" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 52 }}>ID</th>
                <th style={{ width: 196 }}>分类</th>
                <th>题干</th>
                <th style={{ width: 132 }}>检索状态</th>
                <th style={{ width: 150, textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="small" style={{ padding: 16, color: "var(--muted)" }}>
                    加载中…
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((q) => (
                  <tr key={q.id}>
                    <td className="mono" style={{ textAlign: "left" }}>
                      {q.id}
                    </td>
                    <td>
                      <div className="row wrap" style={{ gap: 5 }}>
                        <span className="pill info">{q.direction}</span>
                        <span className="pill">{q.difficulty}</span>
                        <span className="pill violet">{q.question_type}</span>
                      </div>
                    </td>
                    <td>
                      <div className="content-cell clamp-2" title={q.content}>
                        {q.content}
                      </div>
                    </td>
                    <td>
                      <span className="sync">
                        <span className={`dot ${q.embedding_ref ? "done" : "warn"}`} />
                        <span style={{ color: "var(--muted)" }}>{q.embedding_ref ? "已入库" : "待入库"}</span>
                      </span>
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => setViewing(q)} type="button">
                          查看
                        </button>
                        <button className="btn btn-sm" onClick={() => openEdit(q)} type="button">
                          编辑
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => void delQ(q)} type="button">
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty" style={{ border: 0, background: "transparent", padding: 36 }}>
                      <div className="glyph">▤</div>
                      <div className="t">没有匹配的题目</div>
                      <div className="d">换个关键词或方向试试，也可以直接新建一道。</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card-foot">
          <div className="pager">
            <button
              className="btn btn-sm"
              disabled={page <= 1}
              onClick={() => void load(page - 1, kw, dirFilter, size)}
              type="button"
            >
              ‹ 上一页
            </button>
            <span className="p">
              第 {page} / {pages} 页 · 本页 {rows.length} 条
            </span>
            <button
              className="btn btn-sm"
              disabled={page >= pages}
              onClick={() => void load(page + 1, kw, dirFilter, size)}
              type="button"
            >
              下一页 ›
            </button>
          </div>
          <span className="small">改题会同步更新向量库，否则检索仍会命中旧题</span>
        </div>
      </section>

      <section className="card mt-5">
        <div className="card-head">
          <div className="h3">同步语义</div>
          <span className="pill accent">PG + Qdrant 双写</span>
        </div>
        <div className="card-body">
          <div className="grid g-3">
            <div className="qprev">
              <div className="lb">新建</div>题目落库后立即向量化入库，新题马上能被检索到
            </div>
            <div className="qprev">
              <div className="lb">编辑</div>覆盖同一条向量记录，不会留下孤儿数据导致检索命中旧题
            </div>
            <div className="qprev">
              <div className="lb">删除</div>题库与向量库同步删除。只删一边会让检索继续命中已删的题
            </div>
          </div>
        </div>
      </section>

      {/* ==================== 新建 / 编辑 ==================== */}
      <Modal
        open={form !== null}
        wide
        title={form?.mode === "new" ? "新建题目" : `编辑题目 #${form?.q?.id ?? ""}`}
        onClose={() => {
          if (!saving) setForm(null);
        }}
        foot={
          <>
            <button className="btn" onClick={() => setForm(null)} disabled={saving} type="button">
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void submitForm()}
              disabled={saving}
              type="button"
            >
              {saving ? "处理中…" : form?.mode === "new" ? "创建并向量化" : "保存并重新向量化"}
            </button>
          </>
        }
      >
        {formBody}
      </Modal>

      {/* ==================== 查看 ==================== */}
      <Modal
        open={viewing !== null}
        wide
        title={`题目 #${viewing?.id ?? ""}`}
        onClose={() => setViewing(null)}
        foot={
          <button className="btn" onClick={() => setViewing(null)} type="button">
            关闭
          </button>
        }
      >
        {viewing && (
          <>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="pill info">{viewing.direction}</span>
              <span className="pill">{viewing.difficulty}</span>
              <span className="pill violet">{viewing.question_type}</span>
              <span className={`pill ${viewing.embedding_ref ? "success" : "warn"}`}>
                {viewing.embedding_ref ? "已入检索库" : "待入库"}
              </span>
            </div>
            <div className="qprev mt-4">
              <div className="lb">题干</div>
              {viewing.content}
            </div>
            <div className="qprev">
              <div className="lb">参考答案</div>
              {viewing.reference_answer || "—"}
            </div>
            <div className="qprev">
              <div className="lb">考察点</div>
              {viewing.key_points || "—"}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function SyncLine({ done, label, text }: { done: boolean; label: string; text: string }) {
  return (
    <div className="line">
      <span className="k">{label}</span>
      <span className={`dot ${done ? "done" : "running"}`} />
      <span>{text}</span>
    </div>
  );
}
