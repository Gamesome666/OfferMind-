"use client";

/**
 * Agent 执行轨迹面板。对应设计稿的 `Om.tracePanel` + `Om.bindTrace`。
 *
 * 设计稿是命令式的：`bindTrace` 内部维护 `Map<id, rowEl>`，事件到了就改已存在那行的
 * class / innerHTML / 耗时。React 下这份状态已经在 `lib/agentRun.ts` 里做完了
 * （它按 `${seq}:${id}` 就地替换 running→done），所以这里退化成纯渲染：
 * **数组顺序就是行号，同一个步骤始终只占一行。**
 */

import type { Trace } from "@/lib/api";

export type LiveState = "idle" | "running" | "done" | "error";

/** 空闲态的点也用 `done` 样式（与设计稿一致），只有 running/error 才换色。 */
const DOT: Record<LiveState, string> = {
  idle: "done",
  running: "running",
  done: "done",
  error: "error",
};

function rowClass(ev: Trace): string {
  if (ev.status === "running") return "is-running";
  if (ev.type === "错误") return "is-error";
  return "is-done";
}

function durationText(ev: Trace): string {
  if (ev.duration_ms === null || ev.duration_ms === undefined) {
    return ev.status === "running" ? "运行中…" : "—";
  }
  return `${ev.duration_ms} ms`;
}

export default function TracePanel({
  events,
  title = "等待执行",
  live = "idle",
  emptyHint = "执行 Agent 后，这里会逐步出现每个节点的「进行中 → 已完成 + 耗时」。",
}: {
  events: Trace[];
  title?: string;
  live?: LiveState;
  emptyHint?: string;
}) {
  return (
    <section className="card">
      <div className="trace-head">
        <span className="eyebrow">Agent Trace</span>
        <span className="num small" style={{ color: "var(--ink-muted)" }}>
          {title}
        </span>
        <span className="live">
          <span className={`dot ${DOT[live]}`} />
          <span>{live.toUpperCase()}</span>
        </span>
      </div>

      <div className="trace-body">
        {events.length === 0 ? (
          <div className="trace-empty">{emptyHint}</div>
        ) : (
          events.map((ev, index) => {
            const hot = (ev.duration_ms ?? 0) > 3000;
            return (
              <div className={`trace-row ${rowClass(ev)}`} key={ev.id ?? `row-${index}`}>
                <div className="seq num">{String(index + 1).padStart(2, "0")}</div>
                <div className={`kind ${ev.type}`}>{ev.type}</div>
                <div className="what">
                  <strong>{ev.id}</strong>{"  "}
                  {Object.entries(ev.payload ?? {}).map(([k, v], i) => (
                    <span key={k}>
                      {i > 0 ? "  " : ""}
                      <span className="k">{k}</span>=
                      <span className="v">
                        {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}
                      </span>
                    </span>
                  ))}
                </div>
                <div className={`ms${hot ? " hot" : ""}`}>{durationText(ev)}</div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
