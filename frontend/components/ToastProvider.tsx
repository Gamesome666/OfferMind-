"use client";

/**
 * 轻提示。对应设计稿的 `Om.toast`。
 *
 * 设计稿是模块级单例（往 body 里 append 一个 `.toasts` 容器），React 下改成 Context + Provider。
 *
 * 注意：设计稿的实现**只渲染 `msg`，`title` 参数被丢掉了**（`Om.toast(kind, title, msg)`
 * 里 title 没进模板）。这里保持同样行为以免视觉漂移 —— 如果希望把 title 显示出来，
 * 改 `toast()` 里渲染的那一段即可。
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "ok" | "err" | "info";

type Toast = { id: number; kind: ToastKind; msg: string };

type ToastCtx = {
  toast: (kind: ToastKind, title: string, msg: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

const KICKER: Record<ToastKind, string> = { ok: "OK", err: "ERROR", info: "INFO" };
const LIFETIME_MS = 3400;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((kind: ToastKind, _title: string, msg: string) => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, kind, msg }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, LIFETIME_MS);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {items.length > 0 && (
        <div className="toasts">
          {items.map((t) => (
            <div className={`toast ${t.kind}`} key={t.id}>
              <div className="grow">
                <div className="tk">{KICKER[t.kind]}</div>
                <div>{t.msg}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内部使用");
  return ctx.toast;
}
