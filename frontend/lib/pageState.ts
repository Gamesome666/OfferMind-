"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 跨路由的页面状态保持。
 *
 * 问题：Next.js App Router 在切换路由时会卸载离开的页面组件，页面的 useState 随之丢失 ——
 * 用户从「刷题训练」跳到「模拟面试」再跳回来，刚出的题、刚写的答案就没了。
 *
 * 解法：把每个页面的关键状态存在一个模块级 Map 里（模块在 SPA 生命周期内一直存活，
 * 路由切换不会重建它），usePageState 就是「读写这个 Map 的 useState」。同时镜像一份到
 * sessionStorage，这样连刷新都不丢；只存当前标签页，关掉标签页即清空，符合「本次会话内保留」
 * 的语义。
 *
 * 顺带成了历史记录恢复的通道：点历史条目时 setPageState(页面 key, 快照)，
 * 页面无论已挂载还是稍后挂载，都会读到这份新状态。
 */

const PREFIX = "offermind:page:";
const memory = new Map<string, unknown>();
const subscribers = new Map<string, Set<() => void>>();

function readState<T>(key: string): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (raw === null) return undefined;
    const value = JSON.parse(raw) as T;
    memory.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

/** 直接写页面状态（不经过组件），供历史恢复、跨页面联动使用。 */
export function setPageState<T>(key: string, value: T): void {
  memory.set(key, value);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* 快照可能含不可序列化内容，或超出配额；内存那份仍然有效 */
    }
  }
  subscribers.get(key)?.forEach((notify) => notify());
}

/** 读页面状态（不经过组件）。 */
export function getPageState<T>(key: string): T | undefined {
  return readState<T>(key);
}

/** 清空某页面的状态（重新开始）。 */
export function clearPageState(key: string): void {
  memory.delete(key);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(PREFIX + key);
    } catch {
      /* 忽略 */
    }
  }
  subscribers.get(key)?.forEach((notify) => notify());
}

/**
 * 与 useState 同形态，但状态挂在模块级 Map 上，切路由不丢。
 * 用法：const [answer, setAnswer] = usePageState("practice:answer", "")。
 */
export function usePageState<T>(key: string, initial: T) {
  const [state, setLocalState] = useState<T>(() => {
    const stored = readState<T>(key);
    return stored === undefined ? initial : stored;
  });

  // 订阅外部写入（历史恢复会直接 setPageState 同一个 key）
  useEffect(() => {
    let set = subscribers.get(key);
    if (!set) {
      set = new Set();
      subscribers.set(key, set);
    }
    const notify = () => {
      const next = readState<T>(key);
      setLocalState(next === undefined ? initial : next);
    };
    set.add(notify);
    return () => {
      set!.delete(notify);
    };
    // initial 仅作兜底，故意不放进依赖，避免每次渲染重新订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (value: T | ((prev: T) => T)) => {
      const current = readState<T>(key);
      const base = current === undefined ? initial : current;
      const next = typeof value === "function" ? (value as (prev: T) => T)(base) : value;
      setPageState(key, next);
      setLocalState(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  return [state, update] as const;
}
