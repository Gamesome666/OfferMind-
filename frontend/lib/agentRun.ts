"use client";

import { useCallback, useRef, useState } from "react";

import type { StreamEvent, Trace } from "@/lib/api";
import { getPageState, setPageState } from "@/lib/pageState";

/**
 * Agent 流式执行的公共状态机。
 *
 * 后端为每个步骤推两条同 id 的事件：「进行中」和「已完成」。这里按 id 原地替换，
 * 所以面板上同一个步骤始终只占一行，从「进行中」变成「已完成 + 耗时」。
 *
 * id 会带上本次运行的序号：同一个页面上多次执行会调用同一个节点（比如模拟面试的
 * 第 1/2/3 轮都会跑 interview_question），不加序号的话后一轮会把前一轮的轨迹覆盖掉。
 *
 * 传入 storageKey 时，轨迹也会存进 pageState —— 切到别的页面再切回来，执行面板
 * 不会空掉（否则内容还在、右侧轨迹却没了，看起来像 bug）。
 */
export function useAgentRun(storageKey?: string) {
  const traceKey = storageKey ? `${storageKey}:traces` : undefined;
  const [traces, setTracesState] = useState<Trace[]>(() =>
    traceKey ? (getPageState<Trace[]>(traceKey) ?? []) : [],
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const runSeq = useRef(0);

  const setTraces = useCallback(
    (updater: Trace[] | ((prev: Trace[]) => Trace[])) => {
      setTracesState((prev) => {
        const next = typeof updater === "function" ? (updater as (p: Trace[]) => Trace[])(prev) : updater;
        if (traceKey) setPageState(traceKey, next);
        return next;
      });
    },
    [traceKey],
  );

  /** 消费一条 SSE 流：逐步刷新面板，收到「结果」时回调 onResult。 */
  async function run<T>(
    events: AsyncGenerator<StreamEvent>,
    onResult: (output: T) => void,
    options: { reset?: boolean; onEvent?: (event: StreamEvent) => void } = {},
  ): Promise<void> {
    const { reset = true, onEvent } = options;
    const seq = ++runSeq.current;
    setError("");
    setRunning(true);
    if (reset) setTraces([]);

    try {
      for await (const event of events) {
        if (event.type === "错误") {
          const message = (event.payload as { message?: string })?.message;
          setError(message || "Agent 执行失败");
          onEvent?.(event);
          break;
        }
        if (event.type === "结果") {
          onResult(event.payload as T);
          onEvent?.(event);
          continue;
        }
        // 对话类事件（token / session / hr_message）不进执行面板，交给页面自己处理
        if (CHAT_EVENTS.has(event.type)) {
          onEvent?.(event);
          continue;
        }
        onEvent?.(event);
        const key = event.id ? `${seq}:${event.id}` : undefined;
        const item: Trace = { ...event, id: key };
        setTraces((prev) => {
          if (!key) return [...prev, item];
          const index = prev.findIndex((trace) => trace.id === key);
          if (index === -1) return [...prev, item];
          const next = prev.slice();
          next[index] = item;
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败，请检查后端服务是否已启动");
    } finally {
      setRunning(false);
    }
  }

  return { traces, running, error, setError, run };
}

/** 这些事件是对话内容，不进执行面板（token 是逐字分片，混进轨迹会刷屏）。 */
const CHAT_EVENTS = new Set(["token", "session", "hr_message"]);
