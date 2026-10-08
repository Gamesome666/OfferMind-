"use client";

/**
 * 登录后外壳：`.shell` = 侧栏 + 内容区，对应设计稿 12 个应用页共用的那层结构。
 *
 * 设计稿每页都写一遍 `<div class="shell"><div id="rail-slot"></div><main class="main"><div class="page">…`，
 * 这里收进 layout —— `#rail-slot` 只是一个挂载点（本身没有样式），
 * 所以 React 里直接把 `<Rail/>` 当网格第一列渲染即可。
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import Rail from "@/components/Rail";
import { useAuth } from "@/lib/auth";
import { HistoryProvider } from "@/lib/history";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  // 客户端鉴权门。设计稿是 api-real.js 拦截 401 后跳转，这里提前到渲染前，
  // 未登录时连页面骨架都不闪。
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
        <Rail />
        <main className="main">
          <div className="page">{children}</div>
        </main>
      </div>
    </HistoryProvider>
  );
}
