"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import HistoryRail from "@/components/HistoryRail";
import { useAuth } from "@/lib/auth";
import { HistoryProvider } from "@/lib/history";

const NAV = [
  { href: "/", label: "首页", ico: "◇" },
  { href: "/practice", label: "刷题训练", ico: "▸" },
  { href: "/wrongbook", label: "错题本", ico: "★" },
  { href: "/resume", label: "简历诊断", ico: "≡" },
  { href: "/interview", label: "模拟面试", ico: "◉" },
  { href: "/report", label: "能力报告", ico: "◈" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) {
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
        正在加载…
      </div>
    );
  }

  return (
    <HistoryProvider>
      <div className="shell">
        <nav className="rail">
          <div className="rail-brand">
            <span className="mark">OfferMind</span>
            <span className="tag">v0.1</span>
          </div>

          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rail-link${pathname === item.href ? " active" : ""}`}
            >
              <span className="ico">{item.ico}</span>
              {item.label}
            </Link>
          ))}

          {user.is_admin && (
            <Link
              href="/admin"
              className={`rail-link${pathname === "/admin" ? " active" : ""}`}
            >
              <span className="ico">⚙</span>
              管理后台
            </Link>
          )}

          <HistoryRail />

          <div className="rail-foot">
            <div className="rail-user" title={user.email}>
              {user.nickname || user.email}
            </div>
            <button className="rail-out" onClick={signOut} type="button">
              退出登录
            </button>
          </div>
        </nav>

        <main className="main">{children}</main>
      </div>
    </HistoryProvider>
  );
}
