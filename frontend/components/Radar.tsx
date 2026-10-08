"use client";

/**
 * 能力雷达图。对应设计稿的 `Om.radar`。
 *
 * `values` 的键顺序就是轴顺序，所以调用方用对象字面量时要注意顺序（4–6 个轴）。
 * 少于 3 个轴画不出多边形，直接不渲染。
 */

export default function Radar({
  values,
  size = 260,
  rings = 4,
  max = 100,
  label = true,
}: {
  values: Record<string, number>;
  size?: number;
  rings?: number;
  max?: number;
  label?: boolean;
}) {
  const keys = Object.keys(values);
  const n = keys.length;
  if (n < 3) return null;

  const c = size / 2;
  const r = c - (label ? 42 : 10);

  const pt = (i: number, v: number): [number, number] => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rr = (v / max) * r;
    return [c + Math.cos(a) * rr, c + Math.sin(a) * rr];
  };

  const poly = keys
    .map((k, i) => pt(i, values[k]).map((v) => v.toFixed(1)).join(","))
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      style={{ maxWidth: size }}
      role="img"
      aria-label="能力雷达图"
    >
      {Array.from({ length: rings }, (_, ri) => {
        const rr = ((ri + 1) / rings) * r;
        const p = Array.from({ length: n }, (_, i) => {
          const a = (Math.PI * 2 * i) / n - Math.PI / 2;
          return `${(c + Math.cos(a) * rr).toFixed(1)},${(c + Math.sin(a) * rr).toFixed(1)}`;
        }).join(" ");
        return <polygon key={`ring-${ri}`} points={p} fill="none" stroke="var(--border)" strokeWidth="1" />;
      })}

      {keys.map((k, i) => {
        const [x, y] = pt(i, max);
        return (
          <line
            key={`spoke-${k}`}
            x1={c}
            y1={c}
            x2={x.toFixed(1)}
            y2={y.toFixed(1)}
            stroke="var(--border)"
            strokeWidth="1"
          />
        );
      })}

      <polygon
        points={poly}
        fill="oklch(63% 0.135 195 / 0.19)"
        stroke="var(--accent-ink)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {keys.map((k, i) => {
        const [x, y] = pt(i, values[k]);
        return <circle key={`dot-${k}`} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.6" fill="var(--accent-ink)" />;
      })}

      {label &&
        keys.map((k, i) => {
          const a = (Math.PI * 2 * i) / n - Math.PI / 2;
          const x = c + Math.cos(a) * (r + 22);
          const y = c + Math.sin(a) * (r + 22);
          const anchor =
            Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
          return (
            <text
              key={`label-${k}`}
              x={x.toFixed(1)}
              y={(y + 4).toFixed(1)}
              textAnchor={anchor}
              fontFamily="var(--font-sans)"
              fontSize="11"
              fill="var(--muted)"
            >
              {k}
              <tspan
                fontFamily="var(--font-mono)"
                fontSize="10.5"
                fill="var(--fg-2)"
                dx="4"
              >
                {Math.round(values[k])}
              </tspan>
            </text>
          );
        })}
    </svg>
  );
}
