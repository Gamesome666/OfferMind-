"use client";

/** 能力雷达图：以「维度 → 0-100 分」绘制多边形。 */
export default function Radar({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data ?? {});
  const count = entries.length;

  if (count < 3) {
    return <div className="empty">维度少于 3 个，无法绘制雷达图。</div>;
  }

  const size = 300;
  const center = size / 2;
  const radius = 86;
  const rings = [0.25, 0.5, 0.75, 1];

  const angleAt = (index: number) => (Math.PI * 2 * index) / count - Math.PI / 2;
  const at = (index: number, ratio: number) =>
    [
      center + Math.cos(angleAt(index)) * radius * ratio,
      center + Math.sin(angleAt(index)) * radius * ratio,
    ] as const;

  const clamp = (value: number) => Math.max(0, Math.min(100, value)) / 100;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      style={{ maxWidth: 330, display: "block" }}
      role="img"
      aria-label="能力雷达图"
    >
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={entries.map((_, i) => at(i, ring).join(",")).join(" ")}
          fill="none"
          stroke="var(--line)"
          strokeWidth="1"
        />
      ))}

      {entries.map((_, i) => {
        const [x, y] = at(i, 1);
        return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />;
      })}

      <polygon
        points={entries.map(([, value], i) => at(i, clamp(value)).join(",")).join(" ")}
        fill="var(--primary-soft)"
        stroke="var(--primary)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      {entries.map(([, value], i) => {
        const [x, y] = at(i, clamp(value));
        return <circle key={i} cx={x} cy={y} r="3" fill="var(--primary)" />;
      })}

      {entries.map(([label, value], i) => {
        const [x, y] = at(i, 1.27);
        return (
          <text
            key={label}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontSize: 11, fill: "var(--ink-2)", fontFamily: "var(--sans)" }}
          >
            {label} {Math.round(value)}
          </text>
        );
      })}
    </svg>
  );
}
