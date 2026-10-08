/** 时间格式化：与设计稿的 `Om.relDay` / `Om.hhmm` 保持一致。 */

/**
 * 相对日期：今天 / 昨天 / N 天前 / M 月 D 日。
 *
 * 注意：设计稿的原实现把「今天」硬编码成了 `2026-10-07T23:59:59`（写稿那天的日期），
 * 这里改成真实的当天。基准取当天 23:59:59 是为了让「今天」覆盖整个自然日，
 * 而不是按 24 小时滚动。
 */
export function relDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const now = new Date();
  const endOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
  );
  const diff = Math.floor((endOfToday.getTime() - d.getTime()) / 86400000);

  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff <= 7) return `${diff} 天前`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** HH:MM */
export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** YYYY-MM-DD */
export function ymd(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** MM-DD（错题本里显示下次复习日期用） */
export function md(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 距今天还有几天（负数表示已过期） */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86400000);
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 页头那句「Workbench · 2026-10-07 周三」 */
export function todayLabel(): string {
  const d = new Date();
  return `${ymd(d.toISOString())} ${WEEKDAYS[d.getDay()]}`;
}

/** 4 点–11 点算早上，其余按实际时段打招呼 */
export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}
