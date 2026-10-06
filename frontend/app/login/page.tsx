"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { user, ready, signIn, signUp } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace("/");
  }, [ready, user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await signIn(email, password);
      } else {
        await signUp(email, password, nickname);
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <aside className="auth-aside">
        <div>
          <h2>把每一次面试，练到有据可依。</h2>
          <p>
            出题、评分、追问由 Agent 完成，每一步的工具调用、知识检索与模型推理都实时可见。
            不是给你一个分数，而是让你看清分数是怎么来的。
          </p>
        </div>

        <div className="auth-traces">
          <div>
            <b>检索</b> question_bank · top-k 5 · 命中 5
          </div>
          <div>
            <b>模型</b> deepseek-chat · 结构化输出
          </div>
          <div>
            <b>评分</b> 正确性 4/5 · 完整性 3/5 · 表达 4/5
          </div>
          <div>
            <b>追问</b> 针对「红黑树触发条件」继续深挖
          </div>
        </div>

        <p style={{ fontSize: 12, color: "var(--rail-ink-dim)" }}>
          OfferMind · 可观测 Agentic RAG 驱动
        </p>
      </aside>

      <main className="auth-form">
        <div className="seg" style={{ marginBottom: 22 }}>
          <button
            type="button"
            className={mode === "login" ? "on" : ""}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            登录
          </button>
          <button
            type="button"
            className={mode === "register" ? "on" : ""}
            onClick={() => {
              setMode("register");
              setError("");
            }}
          >
            注册
          </button>
        </div>

        <h1 style={{ fontSize: 20, marginBottom: 6 }}>
          {mode === "login" ? "欢迎回来" : "创建账号"}
        </h1>
        <p className="muted" style={{ marginBottom: 22 }}>
          {mode === "login" ? "继续你的训练进度。" : "注册后即可开始定向刷题与模拟面试。"}
        </p>

        <form onSubmit={submit}>
          {mode === "register" && (
            <div className="field">
              <label htmlFor="nickname">昵称</label>
              <input
                id="nickname"
                className="input"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="怎么称呼你"
                autoComplete="nickname"
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              className="input"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "至少 6 位" : "输入密码"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {error && (
            <div className="alert alert-bad" style={{ marginBottom: 14 }}>
              {error}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
          </button>
        </form>
      </main>
    </div>
  );
}
