"use client";

/**
 * 四维评分条。对应设计稿的 `Om.rubric`。
 *
 * 注意：设计稿的实现**不渲染 `reason`**，尽管 `score_json` 里带着它 —— 评分理由由页面
 * 另行展示（比如错题本、刷题页的评分卡片）。这里保持一致。
 */

export type RubricScore = {
  correctness?: { score: number; reason?: string };
  completeness?: { score: number; reason?: string };
  clarity?: { score: number; reason?: string };
  terminology?: { score: number; reason?: string };
};

const DIMS: Array<[label: string, key: keyof RubricScore, weight: number]> = [
  ["正确性", "correctness", 0.4],
  ["完整性", "completeness", 0.3],
  ["表达与结构", "clarity", 0.15],
  ["术语准确性", "terminology", 0.15],
];

function tone(score: number): string {
  if (score >= 4) return "success";
  if (score >= 3) return "accent";
  if (score >= 2) return "warn";
  return "danger";
}

export default function Rubric({ score }: { score: RubricScore }) {
  return (
    <div className="rubric">
      {DIMS.map(([label, key, weight]) => {
        const d = score[key] ?? { score: 0 };
        return (
          <div className="rubric-row" key={key}>
            <div className="name">
              {label}
              <em>权重 {weight.toFixed(2)}</em>
            </div>
            <div className="bar">
              <i className={tone(d.score)} style={{ width: `${(d.score / 5) * 100}%` }} />
            </div>
            <div className="val">
              {d.score}
              <span> / 5</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
