"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import * as api from "@/lib/api";
import { useAuth } from "@/lib/auth";

const DIRECTIONS = ["后端", "前端", "算法"];
const DIFFICULTIES = ["入门", "中级", "高级"];
const TYPES = ["八股", "算法", "业务"];

type Tab = "users" | "questions" | "config";

const EMPTY_QUESTION = {
  direction: DIRECTIONS[0],
  difficulty: DIFFICULTIES[1],
  question_type: TYPES[0],
  content: "",
  reference_answer: "",
  key_points: "",
};

function Seg({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="seg">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? "on" : ""}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/* ---------------- 用户管理 ---------------- */

function UsersTab({ token }: { token: string }) {
  const [users, setUsers] = useState<api.AdminUser[]>([]);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setUsers(await api.adminListUsers(token, keyword));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载用户失败");
    }
  }, [token, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleAdmin(user: api.AdminUser) {
    try {
      await api.adminUpdateUser(token, user.id, { is_admin: !user.is_admin });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function resetPassword(user: api.AdminUser) {
    const pwd = window.prompt(`给 ${user.email} 设置新密码（至少 6 位）：`);
    if (!pwd) return;
    if (pwd.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    try {
      await api.adminUpdateUser(token, user.id, { password: pwd });
      window.alert("密码已重置");
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置密码失败");
    }
  }

  async function remove(user: api.AdminUser) {
    if (!window.confirm(`确定删除用户 ${user.email}？该操作不可撤销。`)) return;
    try {
      await api.adminDeleteUser(token, user.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <>
      {error && <div className="alert alert-bad" style={{ marginBottom: 14 }}>{error}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="按邮箱 / 昵称搜索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <button className="btn btn-ghost btn-sm" onClick={() => void load()} type="button">
          刷新
        </button>
      </div>

      <section className="panel">
        <div className="panel-body">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>邮箱</th>
                <th>昵称</th>
                <th>角色</th>
                <th>注册时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="mono">{user.id}</td>
                  <td>{user.email}</td>
                  <td>{user.nickname || "—"}</td>
                  <td>
                    <span className={`badge${user.is_admin ? " on" : ""}`}>
                      {user.is_admin ? "管理员" : "普通用户"}
                    </span>
                  </td>
                  <td className="muted">{new Date(user.created_at).toLocaleString("zh-CN")}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => void toggleAdmin(user)} type="button">
                        {user.is_admin ? "取消管理员" : "设为管理员"}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => void resetPassword(user)} type="button">
                        重置密码
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => void remove(user)} type="button">
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    没有匹配的用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ---------------- 题库管理 ---------------- */

function QuestionsTab({ token }: { token: string }) {
  const [data, setData] = useState<{ total: number; items: api.AdminQuestion[] }>({
    total: 0,
    items: [],
  });
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [direction, setDirection] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<api.AdminQuestion | null>(null);
  const [draft, setDraft] = useState(EMPTY_QUESTION);
  const [saving, setSaving] = useState(false);
  const size = 20;

  const load = useCallback(async () => {
    try {
      const res = await api.adminListQuestions(token, { keyword, direction, page, size });
      setData({ total: res.total, items: res.items });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载题库失败");
    }
  }, [token, keyword, direction, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY_QUESTION);
  }

  function openEdit(question: api.AdminQuestion) {
    setEditing(question);
    setDraft({
      direction: question.direction,
      difficulty: question.difficulty,
      question_type: question.question_type,
      content: question.content,
      reference_answer: question.reference_answer,
      key_points: question.key_points,
    });
  }

  async function save() {
    if (!draft.content.trim()) {
      setError("题干不能为空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) await api.adminUpdateQuestion(token, editing.id, draft);
      else await api.adminCreateQuestion(token, draft);
      setEditing(null);
      setDraft(EMPTY_QUESTION);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(question: api.AdminQuestion) {
    if (!window.confirm("确定删除这道题？PG 与向量库会同步删除。")) return;
    try {
      await api.adminDeleteQuestion(token, question.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / size));

  return (
    <>
      {error && <div className="alert alert-bad" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="row" style={{ marginBottom: 12, justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="搜索题干 / 考点"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
          <Seg
            value={direction}
            options={["", ...DIRECTIONS]}
            onChange={(v) => {
              setDirection(v);
              setPage(1);
            }}
          />
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreate} type="button">
          新建题目
        </button>
      </div>

      {(editing || draft.content !== "") && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <h3>{editing ? `编辑题目 #${editing.id}` : "新建题目"}</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(null); setDraft(EMPTY_QUESTION); }} type="button">
              取消
            </button>
          </div>
          <div className="panel-body stack-sm">
            <div className="row">
              <Seg value={draft.direction} options={DIRECTIONS} onChange={(v) => setDraft((p) => ({ ...p, direction: v }))} />
              <Seg value={draft.difficulty} options={DIFFICULTIES} onChange={(v) => setDraft((p) => ({ ...p, difficulty: v }))} />
              <Seg value={draft.question_type} options={TYPES} onChange={(v) => setDraft((p) => ({ ...p, question_type: v }))} />
            </div>
            <div className="field">
              <label>题干</label>
              <textarea className="textarea" rows={4} value={draft.content} onChange={(e) => setDraft((p) => ({ ...p, content: e.target.value }))} />
            </div>
            <div className="field">
              <label>参考答案</label>
              <textarea className="textarea" rows={4} value={draft.reference_answer} onChange={(e) => setDraft((p) => ({ ...p, reference_answer: e.target.value }))} />
            </div>
            <div className="field">
              <label>考察点</label>
              <textarea className="textarea" rows={2} value={draft.key_points} onChange={(e) => setDraft((p) => ({ ...p, key_points: e.target.value }))} />
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={save} disabled={saving} type="button">
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-body">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>题干</th>
                <th>分类</th>
                <th>向量</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((question) => (
                <tr key={question.id}>
                  <td className="mono">{question.id}</td>
                  <td>
                    <div className="cell-clip">{question.content}</div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <span className="badge">{question.direction}</span>
                      <span className="badge">{question.difficulty}</span>
                      <span className="badge">{question.question_type}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge${question.embedding_ref ? " on" : ""}`}>
                      {question.embedding_ref ? "已入库" : "未入库"}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(question)} type="button">
                        编辑
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => void remove(question)} type="button">
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    题库为空
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="pager">
            <span>共 {data.total} 题</span>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} type="button">
              上一页
            </button>
            <span className="mono">
              {page} / {totalPages}
            </span>
            <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} type="button">
              下一页
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------------- 模型配置 ---------------- */

function ConfigTab({ token }: { token: string }) {
  const [items, setItems] = useState<api.ConfigItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [llm, setLlm] = useState<api.LlmOptions | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.adminGetConfig(token);
      setItems(res);
      setDrafts(Object.fromEntries(res.map((item) => [item.key, item.value])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载配置失败");
    }
  }, [token]);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      setLlm(await api.adminLlmOptions(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "拉取模型列表失败");
    } finally {
      setLoadingModels(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    void loadModels();
  }, [load, loadModels]);

  /** 下拉候选：优先用端点实时拉到的，拉不到就用后端给的静态兜底。 */
  const modelChoices = useMemo(() => {
    const item = items.find((i) => i.key === "llm_model");
    const current = drafts.llm_model ?? "";
    const base = llm?.models?.length ? llm.models : (item?.options ?? []);
    // 当前值可能是通过 API 直接设的、不在候选里，补进去免得下拉显示成别的
    return Array.from(new Set([...base, current].filter(Boolean)));
  }, [items, llm, drafts.llm_model]);

  async function save() {
    // 只提交真正改过的项：密钥框留空表示「不修改」，提交空串会把已存的密钥覆盖掉
    const values: Record<string, string> = {};
    for (const item of items) {
      const draft = drafts[item.key] ?? item.value;
      if (draft !== item.value) values[item.key] = draft;
    }
    if (Object.keys(values).length === 0) return;

    setSaving(true);
    setError("");
    try {
      const updated = await api.adminUpdateConfig(token, values);
      setItems(updated);
      setDrafts(Object.fromEntries(updated.map((item) => [item.key, item.value])));
      setSaved(`已保存（${new Date().toLocaleTimeString("zh-CN")}），下次 Agent 执行即生效`);
      setTimeout(() => setSaved(""), 4000);
      // 端点或密钥换了，模型候选列表也跟着变，顺手重拉一次
      if ("llm_base_url" in values || "llm_api_key" in values) void loadModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function reset(key: string) {
    try {
      const updated = await api.adminResetConfig(token, key);
      setItems(updated);
      setDrafts((prev) => ({
        ...prev,
        [key]: updated.find((item) => item.key === key)?.value ?? "",
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复默认失败");
    }
  }

  const dirty = items.some((item) => (drafts[item.key] ?? item.value) !== item.value);

  return (
    <>
      {error && <div className="alert alert-bad" style={{ marginBottom: 14 }}>{error}</div>}
      {saved && <div className="alert alert-ok" style={{ marginBottom: 14 }}>{saved}</div>}
      {llm?.source === "fallback" && (
        <div className="alert" style={{ marginBottom: 14 }}>
          没能从当前端点拉到模型列表，下拉框里是内置候选。原因：{llm.error}
          <br />
          填好正确的 Base URL 和 API Key 再点「拉取模型列表」即可。
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>模型与检索配置</h3>
          <span className="chip">{dirty ? "有未保存修改" : "已同步"}</span>
        </div>
        <div className="panel-body">
          {llm && llm.presets.length > 0 && (
            <div className="cfg-row">
              <div>
                <div className="cfg-key">快速切换服务商</div>
                <div className="cfg-desc">
                  点一下把 Base URL 填成对应端点，再点「保存配置」生效。换服务商记得同时换 API Key。
                </div>
              </div>
              <div className="cfg-ctrl" style={{ gap: 6 }}>
                {llm.presets.map((preset) => (
                  <button
                    key={preset.key}
                    className="btn btn-ghost btn-sm"
                    type="button"
                    title={preset.note}
                    onClick={() =>
                      setDrafts((prev) => ({ ...prev, llm_base_url: preset.base_url }))
                    }
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.map((item) => (
            <div key={item.key} className="cfg-row">
              <div>
                <div className="cfg-key">
                  {item.label}
                  {item.overridden && <span className="badge" style={{ marginLeft: 8 }}>已覆盖</span>}
                </div>
                <div className="cfg-desc">{item.description}</div>
                {item.kind === "secret" ? (
                  <div className="cfg-desc mono">
                    {item.has_value ? "已配置密钥（不回显）" : "尚未配置密钥"}
                  </div>
                ) : (
                  <div className="cfg-desc mono">默认：{item.default}</div>
                )}
              </div>
              <div className="cfg-ctrl">
                {item.kind === "select" ? (
                  <select
                    className="input"
                    style={{ maxWidth: 260 }}
                    value={drafts[item.key] ?? item.value}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))}
                  >
                    {item.key === "llm_model"
                      ? modelChoices.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))
                      : item.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                  </select>
                ) : item.kind === "bool" ? (
                  <Seg
                    value={drafts[item.key] ?? item.value}
                    options={["1", "0"]}
                    onChange={(v) => setDrafts((prev) => ({ ...prev, [item.key]: v }))}
                  />
                ) : item.kind === "secret" ? (
                  <input
                    className="input"
                    style={{ maxWidth: 260 }}
                    type="password"
                    autoComplete="off"
                    placeholder={item.has_value ? "已配置，留空则不修改" : "请填写 API Key"}
                    value={drafts[item.key] ?? ""}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))}
                  />
                ) : (
                  <input
                    className="input"
                    style={{ maxWidth: 260 }}
                    value={drafts[item.key] ?? item.value}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))}
                  />
                )}
                {item.key === "llm_model" && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void loadModels()}
                    disabled={loadingModels}
                    type="button"
                  >
                    {loadingModels ? "拉取中…" : "拉取模型列表"}
                  </button>
                )}
                {item.overridden && (
                  <button className="btn btn-ghost btn-sm" onClick={() => void reset(item.key)} type="button">
                    恢复默认
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving || !dirty} type="button">
              {saving ? "保存中…" : "保存配置"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------------- 页面 ---------------- */

export default function AdminPage() {
  const { token, user, ready } = useAuth();
  const [tab, setTab] = useState<Tab>("users");
  const [stats, setStats] = useState<{ users: number; questions: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .adminStats(token)
      .then(setStats)
      .catch(() => setStats(null));
  }, [token]);

  if (!ready) return <div className="empty" style={{ paddingTop: 120 }}>正在加载…</div>;

  if (!user?.is_admin) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>管理后台</h1>
          </div>
        </div>
        <section className="panel">
          <div className="panel-body empty">
            你不是管理员，无法访问此页面。请联系管理员把你的账号设为管理员。
          </div>
        </section>
      </>
    );
  }

  if (!token) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>管理后台</h1>
          <p className="page-sub">用户管理、题库增删改查、模型与检索配置。</p>
        </div>
      </div>

      {stats && (
        <div className="grid-3" style={{ marginBottom: 20 }}>
          <div className="stat">
            <div className="k">注册用户</div>
            <div className="v">
              {stats.users}
              <span className="u">人</span>
            </div>
          </div>
          <div className="stat">
            <div className="k">题库题目</div>
            <div className="v">
              {stats.questions}
              <span className="u">题</span>
            </div>
          </div>
        </div>
      )}

      <div className="tabs">
        <button className={`tab${tab === "users" ? " on" : ""}`} onClick={() => setTab("users")} type="button">
          用户管理
        </button>
        <button className={`tab${tab === "questions" ? " on" : ""}`} onClick={() => setTab("questions")} type="button">
          题库管理
        </button>
        <button className={`tab${tab === "config" ? " on" : ""}`} onClick={() => setTab("config")} type="button">
          模型配置
        </button>
      </div>

      {tab === "users" && <UsersTab token={token} />}
      {tab === "questions" && <QuestionsTab token={token} />}
      {tab === "config" && <ConfigTab token={token} />}
    </>
  );
}
