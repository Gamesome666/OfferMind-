"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import * as api from "./api";
import { useAuth } from "./auth";
import { setPageState } from "./pageState";

/** 模块元信息：路由、侧栏图标、页面状态 key。 */
export const MODULE_META: Record<
  api.HistoryModule,
  { href: string; label: string; ico: string; pageKey: string }
> = {
  practice: { href: "/practice", label: "刷题训练", ico: "▸", pageKey: "practice" },
  resume: { href: "/resume", label: "简历诊断", ico: "≡", pageKey: "resume" },
  interview: { href: "/interview", label: "模拟面试", ico: "◉", pageKey: "interview" },
  report: { href: "/report", label: "能力报告", ico: "◈", pageKey: "report" },
};

type HistoryCtx = {
  items: api.HistoryItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** 记录一次交互（拿到结果后调用），并刷新侧栏。 */
  record: (
    module: api.HistoryModule,
    title: string,
    snapshot: Record<string, unknown>,
    sessionId?: number | null,
  ) => Promise<void>;
  remove: (id: number) => Promise<void>;
  /** 点历史条目：把快照灌回对应页面的状态，然后跳过去。 */
  restore: (item: api.HistoryItem) => void;
};

const Ctx = createContext<HistoryCtx | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<api.HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setItems(await api.listHistory(token));
    } catch {
      /* 侧栏历史加载失败不该打断主流程 */
    } finally {
      setLoading(false);
    }
  }, [token]);

  // 登录后拉一次；退出登录清空
  useEffect(() => {
    if (token && user) void refresh();
    else setItems([]);
  }, [token, user, refresh]);

  const record = useCallback<HistoryCtx["record"]>(
    async (module, title, snapshot, sessionId = null) => {
      if (!token) return;
      try {
        await api.createHistory(token, { module, title, snapshot, session_id: sessionId });
        await refresh();
      } catch {
        /* 记录历史失败不影响用户已经拿到的结果 */
      }
    },
    [token, refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      if (!token) return;
      await api.deleteHistory(token, id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [token],
  );

  const restore = useCallback(
    (item: api.HistoryItem) => {
      const meta = MODULE_META[item.module];
      // 先把快照写进页面状态，再跳转 —— 页面挂载时直接读到这份状态
      setPageState(meta.pageKey, item.snapshot);
      router.push(meta.href);
    },
    [router],
  );

  return (
    <Ctx.Provider value={{ items, loading, refresh, record, remove, restore }}>{children}</Ctx.Provider>
  );
}

export function useHistory() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHistory 必须在 HistoryProvider 内部使用");
  return ctx;
}
