"use client";

/**
 * 确认对话框。对应设计稿的 `Om.confirm` —— 它必须返回 Promise，所以是命令式的，
 * 由 Provider 持有状态并把 resolve 挂起来。
 *
 * 用法：
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "删除题目", msg: "…", danger: true }))) return;
 *
 * `detail` 在设计稿里是 HTML 字符串，这里收成 ReactNode。
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

import Modal from "@/components/Modal";

type ConfirmSpec = {
  title?: string;
  msg?: string;
  detail?: ReactNode;
  ok?: string;
  danger?: boolean;
};

type Pending = ConfirmSpec & { resolve: (v: boolean) => void };

const Ctx = createContext<((spec: ConfirmSpec) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback((spec: ConfirmSpec) => {
    return new Promise<boolean>((resolve) => {
      const next = { ...spec, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const cur = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    cur?.resolve(value);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        open={pending !== null}
        title={pending?.title || "确认操作"}
        onClose={() => settle(false)}
        foot={
          <>
            <button className="btn" onClick={() => settle(false)} type="button">
              取消
            </button>
            <button
              className={`btn ${pending?.danger ? "btn-danger" : "btn-primary"}`}
              onClick={() => settle(true)}
              type="button"
            >
              {pending?.ok || "确认"}
            </button>
          </>
        }
      >
        <p className="lead">{pending?.msg || ""}</p>
        {pending?.detail ? <div className="mt-4">{pending.detail}</div> : null}
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm 必须在 ConfirmProvider 内部使用");
  return ctx;
}
