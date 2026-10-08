"use client";

/**
 * 模态框。对应设计稿的 `Om.modal`。
 *
 * 设计稿是命令式 API（创建 DOM → 返回 `{el, close}`），React 下改成声明式：
 * 页面自己用 `open` 状态控制，内容作为 children 传进来。
 * `useConfirm()` 是命令式的（它要返回 Promise），单独由 Provider 承担。
 */

import { useCallback, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function Modal({
  open,
  title,
  wide = false,
  onClose,
  children,
  foot,
}: {
  open: boolean;
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode;
}) {
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;
  // SSR 期间没有 document；open 初始为 false，正常不会走到这里
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="mask"
      onClick={(e) => {
        // 只有点在遮罩本身（不是冒泡自内容）才关闭，与设计稿一致
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="h2">{title}</div>
          <button className="x" type="button" onClick={close} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {foot ? <div className="modal-foot">{foot}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
