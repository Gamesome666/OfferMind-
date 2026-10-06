import Link from "next/link";

const ENTRIES = [
  {
    href: "/practice",
    no: "01",
    title: "定向刷题",
    desc: "按方向、难度、题型出题，作答后四维评分并逐轮追问，附参考答案与考点。",
  },
  {
    href: "/wrongbook",
    no: "02",
    title: "错题本",
    desc: "答错的题按 SM-2 间隔重复排期，到点提醒复习；连续答对两次视为掌握。",
  },
  {
    href: "/resume",
    no: "03",
    title: "简历诊断",
    desc: "上传 PDF 简历与目标 JD，得到匹配度、亮点、短板与可逐条落地的优化建议。",
  },
  {
    href: "/interview",
    no: "04",
    title: "模拟面试",
    desc: "AI 针对你简历中的项目与技术栈深挖提问，每轮实时评分，结束出面试报告。",
  },
  {
    href: "/report",
    no: "05",
    title: "能力报告",
    desc: "汇总训练结果，给出能力雷达与薄弱知识点，让下一轮训练有的放矢。",
  },
];

export default function HomePage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>开始训练</h1>
          <p className="page-sub">四条训练闭环共用同一份能力画像与可观测的 Agent 运行时。</p>
        </div>
      </div>

      <div className="grid-3">
        {ENTRIES.map((item) => (
          <Link key={item.href} href={item.href} className="entry">
            <span className="no">{item.no}</span>
            <h3>{item.title}</h3>
            <p>{item.desc}</p>
          </Link>
        ))}
      </div>

      <div className="panel" style={{ marginTop: 22 }}>
        <div className="panel-head">
          <h3>关于训练质量</h3>
        </div>
        <div className="panel-body stack-sm">
          <p className="muted" style={{ lineHeight: 1.75 }}>
            出题与评分会先检索题库知识库，把参考答案与考点作为评判依据注入模型上下文，
            再产出结构化结论。评分固定采用四个维度——正确性、完整性、表达与结构、术语准确性，
            每维都附带评分理由，不给无依据的分数。
          </p>
          <p className="muted" style={{ lineHeight: 1.75 }}>
            训练与面试过程中，右侧执行面板会实时显示每一次检索、模型调用与工具执行，
            包括耗时与命中结果。你可以随时判断结论是否可信，而不是只能接受它。
          </p>
        </div>
      </div>
    </>
  );
}
