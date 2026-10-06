"use client";

import { useState } from "react";

import type { HistoryItem } from "@/lib/api";
import { MODULE_META, useHistory } from "@/lib/history";

/** 把时间分成「今天 / 昨天 / 更早」三组，和 Claude Code 的历史类似。 */
function bucketOf(iso: string): "今天" | "昨天" | "更早" {
  const time = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = time.getTime();
  if (t >= startOfToday) return "今天";
  if (t >= startOfToday - 86400000) return "昨天";
  return "更早";
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ORDER: Array<"今天" | "昨天" | "更早"> = ["今天", "昨天", "更早"];

export default function HistoryRail() {
  const { items, loading, restore, remove, refresh } = useHistory();
  const [open, setOpen] = useState(true);

  const grouped = new Map<string, HistoryItem[]>();
  for (const item of items) {
    const key = bucketOf(item.updated_at);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }

  return (
    <div className="hist">
      <div className="hist-head">
        <button className="hist-toggle" onClick={() => setOpen((v) => !v)} type="button">
          <span className="hist-caret">{open ? "▾" : "▸"}</span>
          历史记录
        </button>
        <button
          className="hist-refresh"
          onClick={() => void refresh()}
          type="button"
          title="刷新"
          aria-label="刷新历史记录"
        >
          ↻
        </button>
      </div>

      {open && (
        <div className="hist-list">
          {items.length === 0 && (
            <div className="hist-empty">{loading ? "加载中…" : "还没有历史记录"}</div>
          )}
          {ORDER.map((bucket) => {
            const list = grouped.get(bucket);
            if (!list || list.length === 0) return null;
            return (
              <div key={bucket}>
                <div className="hist-bucket">{bucket}</div>
                {list.map((item) => (
                  <div key={item.id} className="hist-item">
                    <button
                      className="hist-link"
                      onClick={() => restore(item)}
                      type="button"
                      title={`${MODULE_META[item.module].label}：${item.title}`}
                    >
                      <span className="hist-ico">{MODULE_META[item.module].ico}</span>
                      <span className="hist-title">{item.title || "（无标题）"}</span>
                      <span className="hist-time">{timeLabel(item.updated_at)}</span>
                    </button>
                    <button
                      className="hist-del"
                      onClick={() => void remove(item.id)}
                      type="button"
                      title="删除这条历史"
                      aria-label="删除这条历史"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
