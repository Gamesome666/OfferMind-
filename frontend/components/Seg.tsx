"use client";

/**
 * 分段选择器。对应设计稿的 `Om.seg`（那个是事件委托绑定器，标记由页面写死）。
 *
 * 选中态靠 `aria-pressed`，样式在 tokens.css 的 `.seg button[aria-pressed="true"]`。
 */

export type SegOption = string | { value: string; label: string };

function normalize(o: SegOption): { value: string; label: string } {
  return typeof o === "string" ? { value: o, label: o } : o;
}

export default function Seg({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: ReadonlyArray<SegOption>;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg">
      {options.map((raw) => {
        const o = normalize(raw);
        return (
          <button
            key={o.value}
            type="button"
            data-v={o.value}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            disabled={disabled}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
