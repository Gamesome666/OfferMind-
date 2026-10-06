"use client";

import type { Trace } from "@/lib/api";

const KIND_CLASS: Record<string, string> = {
  检索: "t-retrieve",
  模型: "t-model",
  工具: "t-tool",
  错误: "t-error",
  结果: "t-result",
};

/** 把 trace 载荷渲染成「键 值 · 键 值」的紧凑一行。 */
function formatPayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload ?? {});
  if (entries.length === 0) return "—";
  return entries
    .map(([key, value]) => {
      const text =
        value !== null && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
      return `${key} ${text}`;
    })
    .join("  ·  ");
}

export default function AgentPanel({ traces, running }: { traces: Trace[]; running: boolean }) {
  return (
    <section className="agent-panel" aria-live="polite">
      <header className="agent-head">
        <h3>
          <span className={`pulse${running ? " live" : ""}`} />
          Agent 执行
        </h3>
        <span className="agent-count">{traces.length} 步</span>
      </header>

      <div className="agent-log">
        {traces.length === 0 && !running && (
          <div className="agent-empty">
            执行后，这里会实时列出每一次知识检索、模型调用与工具执行。
          </div>
        )}

        {traces.length === 0 && running && (
          <div className="agent-empty">正在启动 Agent…</div>
        )}

        {traces.map((trace, index) => {
          const running = trace.status === "running";
          return (
            <div
              key={trace.id ?? index}
              className={`trace ${KIND_CLASS[trace.type] ?? ""}${running ? " trace-live" : ""}`}
            >
              <span className="trace-kind">{trace.type}</span>
              <div className="trace-main">
                <div className="trace-title">
                  {formatPayload(trace.payload)}
                  {running && <span className="trace-dots" aria-label="进行中" />}
                </div>
              </div>
              <span className="trace-ms">
                {running
                  ? "进行中"
                  : typeof trace.duration_ms === "number"
                    ? `${trace.duration_ms} ms`
                    : ""}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
