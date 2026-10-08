"use client";

/** 登录 / 注册。对应设计稿 login.html。 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ToastProvider";

import "./login.css";

const DEMO_EMAIL = "admin@offermind.dev";
const DEMO_PASSWORD = "admin123456";

type Mode = "login" | "register";

export default function LoginPage() {
  const { user, ready, signIn, signUp } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [pwHint, setPwHint] = useState(false);
  const [busy, setBusy] = useState(false);

  // 已登录就直接进工作台，避免停在登录页
  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setPwHint(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPwHint(false);

    const mail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setError("邮箱格式不正确");
      return;
    }
    if (password.length < 6 || password.length > 64) {
      setPwHint(true);
      setError("密码长度需在 6–64 位之间");
      return;
    }

    setBusy(true);
    try {
      if (mode === "register") {
        await signUp(mail, password, nickname.trim());
      } else {
        await signIn(mail, password);
      }
      toast("ok", "登录成功", "已签发 JWT，正在进入工作台");
      router.replace("/dashboard");
    } catch (ex) {
      // 后端的 detail 就是中文提示（如「邮箱或密码错误」）
      setError(ex instanceof Error ? ex.message : "登录失败");
      setBusy(false);
    }
  }

  return (
    // data-page 是页面私有样式的**作用域挂载点**：页面 CSS 全部写成
    // `[data-page="login"] .xxx`，所以它必须包在外面，不能和 `.auth` 是同一个元素。
    <div data-page="login">
      <div className="auth">
      {/* ---------------- 左：品牌面 ---------------- */}
      <section className="brandside">
        <Link className="bs-brand" href="/">
          <span className="m">OfferMind</span>
          <span className="t">v0.9</span>
        </Link>

        <div className="bs-mid">
          <div className="eyebrow">Observable Agentic RAG</div>
          <h1>
            你的每一次作答，
            <br />
            都被 Agent <em>逐步评价</em>。
          </h1>
          <p>
            不是给一个分数就结束。从查询向量化、混合召回、精排，到四维 rubric 的每一维理由与改进建议
            —— 这套系统把中间过程全部留在屏幕上。
          </p>

          <div className="mini">
            <div className="mini-h">
              <span className="eyebrow">Agent Trace</span>
              <span className="live">
                <span className="dot done" />
                idle
              </span>
            </div>
            <div className="mini-b">
              <div className="mini-r">
                <span className="k">检索</span>
                <span className="v">
                  embed:q <b>BGE-M3</b> dim=1024
                </span>
                <span className="ms">63 ms</span>
              </div>
              <div className="mini-r">
                <span className="k">检索</span>
                <span className="v">
                  recall:q mode=<b>hybrid</b> cand=20
                </span>
                <span className="ms">41 ms</span>
              </div>
              <div className="mini-r">
                <span className="k">检索</span>
                <span className="v">
                  rerank:q keep=<b>5</b>
                </span>
                <span className="ms">188 ms</span>
              </div>
              <div className="mini-r">
                <span className="k">模型</span>
                <span className="v">
                  grade total=<b>3.4</b>
                </span>
                <span className="ms">4180 ms</span>
              </div>
              <div className="mini-r">
                <span className="k">记忆</span>
                <span className="v">
                  profile.write <b>MySQL 索引</b>
                </span>
                <span className="ms">22 ms</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bs-foot">
          <div>
            <b>6</b>个训练模块
          </div>
          <div>
            <b>4</b>维评分 rubric
          </div>
          <div>
            <b>SM-2</b>间隔重复
          </div>
          <div>
            <b>全链路</b>流式可见
          </div>
        </div>
      </section>

      {/* ---------------- 右：表单 ---------------- */}
      <section className="formside">
        <div className="fbox">
          <div className="ftabs" role="tablist">
            <button
              role="tab"
              aria-selected={mode === "login"}
              onClick={() => switchMode("login")}
              type="button"
            >
              登录
            </button>
            <button
              role="tab"
              aria-selected={mode === "register"}
              onClick={() => switchMode("register")}
              type="button"
            >
              注册
            </button>
          </div>

          <div className={`ferr${error ? " on" : ""}`}>
            <span>⚠</span>
            <span>{error}</span>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            {mode === "register" && (
              <div className="field">
                <label className="label" htmlFor="nickname">
                  昵称
                </label>
                <input
                  className="input"
                  id="nickname"
                  autoComplete="nickname"
                  placeholder="用于侧栏与报告展示"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="email">
                邮箱 <span className="req">*</span>
              </label>
              <input
                className="input"
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="password">
                密码 <span className="req">*</span>
              </label>
              <input
                className="input"
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {pwHint && <span className="hint">密码长度需在 6–64 位之间。</span>}
            </div>

            {mode === "login" && (
              <div className="fmeta">
                <label className="check">
                  <input type="checkbox" defaultChecked /> <span>保持登录状态</span>
                </label>
                <a href="#" className="small" style={{ color: "var(--accent-ink)" }}>
                  忘记密码？
                </a>
              </div>
            )}

            <button
              className="btn btn-primary btn-block btn-lg fgap"
              type="submit"
              disabled={busy}
            >
              {busy ? (mode === "login" ? "正在登录…" : "正在创建…") : mode === "login" ? "登录" : "创建账号"}
            </button>
          </form>

          <div className="fdemo">
            <div className="k">演示账号</div>
            <div className="v">
              {DEMO_EMAIL} · {DEMO_PASSWORD}
            </div>
            <button
              type="button"
              onClick={() => {
                setEmail(DEMO_EMAIL);
                setPassword(DEMO_PASSWORD);
                setMode("login");
                setError("");
              }}
            >
              一键填入
            </button>
          </div>

          <p className="hint" style={{ marginTop: 22 }}>
            你的简历、作答与报告只对自己可见 —— 换一个账号登录，看不到任何属于他人的记录。
          </p>
        </div>
      </section>
      </div>
    </div>
  );
}
