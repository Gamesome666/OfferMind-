"use client";

/**
 * 后台概览。对应设计稿 admin.html。
 *
 * 用户管理的三个操作都回合制走确认弹层，不再用设计稿那种事件委托：
 * 每一行渲染自己的按钮，点击后先 confirm()，再调 API、再整表刷新。
 * 「不能取消/删除自己」后端会拦（400），这里只做按钮禁用的体验优化。
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useConfirm } from "@/components/ConfirmProvider";
import Modal from "@/components/Modal";
import { useToast } from "@/components/ToastProvider";
import {
  adminListUsers,
  adminStats,
  adminUpdateUser,
  adminDeleteUser,
  type AdminUser,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePageScope } from "@/lib/pageScope";

import "./index.css";

export default function AdminPage() {
  const { token, user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  usePageScope("admin");

  const [stats, setStats] = useState<Awaited<ReturnType<typeof adminStats>> | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [kw, setKw] = useState("");
  const [loading, setLoading] = useState(true);

  const kwTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (keyword: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const [st, us] = await Promise.all([
          adminStats(token),
          adminListUsers(token, keyword),
        ]);
        setStats(st);
        setUsers(us);
      } catch (ex) {
        // 非管理员会拿到 403，后端的中文 detail 直接带出来
        toast("err", "后台数据加载失败", ex instanceof Error ? ex.message : String(ex));
      } finally {
        setLoading(false);
      }
    },
    [token, toast],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  function onSearch(v: string) {
    setKw(v);
    if (kwTimer.current) clearTimeout(kwTimer.current);
    kwTimer.current = setTimeout(() => void load(v.trim()), 250);
  }

  async function toggleRole(u: AdminUser) {
    if (!token) return;
    const next = !u.is_admin;
    const name = u.nickname || u.email;
    const ok = await confirm({
      title: next ? "设为管理员" : "取消管理员权限",
      msg: next
        ? `将 ${name}（${u.email}）提升为管理员，可访问全部后台功能。`
        : `将撤销 ${name} 的管理员权限，其会话将失去后台访问权限。`,
      ok: next ? "确认提升" : "确认撤销",
      danger: !next,
    });
    if (!ok) return;
    try {
      await adminUpdateUser(token, u.id, { is_admin: next });
      await load(kw);
      toast("ok", "角色已更新", `${name} → ${next ? "管理员" : "普通用户"}`);
    } catch (ex) {
      toast("err", "操作失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function resetPwd(u: AdminUser) {
    if (!token) return;
    // 用状态机弹层：Modal 是声明式组件，密码输入框需要页面上的一份 state
    setPwdFor(u);
    setPwdValue("offermind2026");
  }

  const [pwdFor, setPwdFor] = useState<AdminUser | null>(null);
  const [pwdValue, setPwdValue] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);

  async function submitPwd() {
    if (!token || !pwdFor) return;
    if (pwdValue.length < 6) return toast("err", "密码太短", "长度需在 6–64 位之间。");
    setPwdSaving(true);
    try {
      await adminUpdateUser(token, pwdFor.id, { password: pwdValue });
      toast("ok", "密码已重置", `${pwdFor.email} 需用新密码登录`);
      setPwdFor(null);
    } catch (ex) {
      toast("err", "重置失败", ex instanceof Error ? ex.message : String(ex));
    } finally {
      setPwdSaving(false);
    }
  }

  async function delUser(u: AdminUser) {
    if (!token) return;
    const name = u.nickname || u.email;
    const ok = await confirm({
      title: "删除用户",
      msg: `将永久删除 ${name}（${u.email}）。`,
      detail: (
        <div
          className="mono small"
          style={{
            border: "1px solid var(--danger-soft)",
            background: "var(--danger-soft)",
            color: "var(--danger)",
            padding: "10px 12px",
            borderRadius: 6,
            fontSize: 12.5,
          }}
        >
          该操作不可撤销。作答记录会被保留（LoRA 微调数据集依赖它），但用户将无法再登录。
        </div>
      ),
      ok: "永久删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await adminDeleteUser(token, u.id);
      await load(kw);
      toast("ok", "用户已删除", `${u.email} 已从用户表移除`);
    } catch (ex) {
      toast("err", "操作失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  // ---- 方向分布 ----
  const dist = useMemo(() => {
    const dirs = Object.entries(stats?.directions ?? {}).sort((a, b) => b[1] - a[1]);
    const total = dirs.reduce((n, [, v]) => n + v, 0) || 1;
    return { dirs, total };
  }, [stats]);

  const isAdmin = user?.is_admin === true;

  return (
    <div data-page="admin">
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin · 用户与系统概览</div>
          <div className="title-row" style={{ marginTop: 7 }}>
            <h1 className="h1">后台概览</h1>
            <span className="pill accent">管理员</span>
            <span className="pill danger">非管理员一律 403</span>
          </div>
          <p className="lead" style={{ marginTop: 8, fontSize: 14 }}>
            用户管理不能取消或删除自己 —— 后端在 <code>update_user</code> /{" "}
            <code>delete_user</code> 里直接拦截，不依赖前端禁用按钮。
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/admin/questions">
            题库管理
          </Link>
          <Link className="btn" href="/admin/config">
            模型与检索
          </Link>
          <Link className="btn btn-primary" href="/admin/api">
            接口总览
          </Link>
        </div>
      </div>

      <div className="grid g-4">
        <div className="stat">
          <div className="k">注册用户</div>
          <div className="v">{stats ? `${stats.users} 人` : "—"}</div>
          <div className="sub">全部已注册账号</div>
        </div>
        <div className="stat">
          <div className="k">题库题目</div>
          <div className="v">{stats ? `${stats.questions} 题` : "—"}</div>
          <div className="sub">跨用户复用的公共题</div>
        </div>
        <div className="stat">
          <div className="k">管理员</div>
          <div className="v">{stats ? `${stats.admins} 人` : "—"}</div>
          <div className="sub">可访问后台</div>
        </div>
        <div className="stat accent">
          <div className="k">本周新增</div>
          <div className="v">{stats ? `${stats.new_users_7d} 人` : "—"}</div>
          <div className="sub">近 7 天注册</div>
        </div>
      </div>

      <div className="grid g-main-side mt-5">
        {/* ===== 用户管理 ===== */}
        <section className="card tblcard" style={{ overflow: "hidden" }}>
          <div className="toolbar">
            <div className="h3">用户管理</div>
            <div className="search" style={{ marginLeft: "auto" }}>
              <input
                className="input"
                id="kw"
                placeholder="按邮箱或昵称搜索"
                value={kw}
                onChange={(e) => onSearch(e.target.value)}
              />
            </div>
            <span className="small" id="ep">
              {kw ? `匹配「${kw}」` : "按邮箱或昵称搜索"}
            </span>
          </div>
          <div className="table-wrap" style={{ maxHeight: "none" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>ID</th>
                  <th>用户</th>
                  <th style={{ width: 112 }}>注册时间</th>
                  <th style={{ width: 96 }}>角色</th>
                  <th style={{ width: 230, textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="small" style={{ padding: 16, color: "var(--muted)" }}>
                      加载中…
                    </td>
                  </tr>
                ) : users.length ? (
                  users.map((u) => {
                    const self = user?.id === u.id;
                    const name = u.nickname || u.email;
                    return (
                      <tr key={u.id}>
                        <td className="mono" style={{ textAlign: "left" }}>
                          {u.id}
                        </td>
                        <td>
                          <div className="u">
                            <span className="avatar">{name.slice(0, 1)}</span>
                            <span>
                              <span className="nm">
                                {name} {self && <span className="self-tag">（我）</span>}
                              </span>
                              <span className="em" style={{ display: "block" }}>
                                {u.email}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          {String(u.created_at).slice(0, 10)}
                        </td>
                        <td>
                          {u.is_admin ? (
                            <span className="pill accent">管理员</span>
                          ) : (
                            <span className="pill">普通用户</span>
                          )}
                        </td>
                        <td>
                          <div className="rowacts">
                            <button
                              className="btn btn-sm"
                              disabled={self}
                              title={self ? "不能取消自己的管理员权限" : undefined}
                              onClick={() => void toggleRole(u)}
                              type="button"
                            >
                              {u.is_admin ? "取消管理员" : "设为管理员"}
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() => void resetPwd(u)}
                              type="button"
                            >
                              重置密码
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              disabled={self}
                              title={self ? "不能删除自己" : undefined}
                              onClick={() => void delUser(u)}
                              type="button"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="empty">
                      没有匹配的用户
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="card-foot">
            <span className="small">共 {users.length} 条记录</span>
            <span className="small">重置后密码立即生效，旧密码不可再用</span>
          </div>
        </section>

        {/* ===== 右列 ===== */}
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <div className="h3">题库方向分布</div>
              <span className="pill">
                {dist.dirs.length} 个方向 · {dist.total} 题
              </span>
            </div>
            <div className="card-body">
              <div className="dist">
                {dist.dirs.length ? (
                  dist.dirs.map(([d, n]) => {
                    const p = Math.round((n / dist.total) * 100);
                    return (
                      <div className="d" key={d}>
                        <span>{d}</span>
                        <span className="bar">
                          <i style={{ width: `${p}%` }} />
                        </span>
                        <span className="p">{n}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty" style={{ border: 0, background: "transparent" }}>
                    <div className="d">题库为空。</div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">管理入口</div>
            </div>
            <div className="card-body">
              <div className="quick-links">
                <Link href="/admin/questions">
                  <span className="ic">▤</span>
                  <span className="grow">
                    <span>题库管理</span>
                    <span className="d" style={{ display: "block" }}>
                      分页 / 检索 / 增删改，同步 Qdrant
                    </span>
                  </span>
                  <span>→</span>
                </Link>
                <Link href="/admin/config">
                  <span className="ic">⚙</span>
                  <span className="grow">
                    <span>模型与检索配置</span>
                    <span className="d" style={{ display: "block" }}>
                      端点 / 模型 / 检索模式 / 网关路由
                    </span>
                  </span>
                  <span>→</span>
                </Link>
                <Link href="/admin/api">
                  <span className="ic">⌗</span>
                  <span className="grow">
                    <span>接口总览与调试</span>
                    <span className="d" style={{ display: "block" }}>
                      48 个端点分组清单
                    </span>
                  </span>
                  <span>→</span>
                </Link>
                <Link href="/bigscreen">
                  <span className="ic">▣</span>
                  <span className="grow">
                    <span>数据大屏</span>
                    <span className="d" style={{ display: "block" }}>
                      演示与监控用作战室
                    </span>
                  </span>
                  <span>→</span>
                </Link>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">高危操作护栏</div>
            </div>
            <div className="card-body">
              <ul className="stack-sm" style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
                <li>— 不能取消自己的管理员权限（400）</li>
                <li>— 不能删除自己的账号（400）</li>
                <li>— 删用户不级联删作答记录，保留数据飞轮样本</li>
                <li>— 删题目必须同步删向量库，否则检索命中旧题</li>
              </ul>
            </div>
          </section>
        </div>
      </div>

      {/* ==================== 重置密码弹层 ==================== */}
      <Modal
        open={pwdFor !== null}
        title={pwdFor ? `重置 ${pwdFor.nickname || pwdFor.email} 的密码` : "重置密码"}
        onClose={() => setPwdFor(null)}
        foot={
          <>
            <button className="btn" onClick={() => setPwdFor(null)} type="button">
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void submitPwd()}
              disabled={pwdSaving}
              type="button"
            >
              {pwdSaving ? "重置中…" : "重置"}
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label">
            新密码 <span className="req">*</span>
          </label>
          <input
            className="input mono"
            type="text"
            value={pwdValue}
            onChange={(e) => setPwdValue(e.target.value)}
          />
          <span className="hint">后端会用 bcrypt 重新哈希；返回体不回显密码。</span>
        </div>
      </Modal>
    </div>
  );
}
