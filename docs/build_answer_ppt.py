# -*- coding: utf-8 -*-
"""
按「课程设计开题答辩PPT模板.pptx」的 7 页版式，填入 OfferMind 开题答辩内容。

用法：
    python docs/build_answer_ppt.py
产出：
    班级-小组号-OfferMind-开题答辩.pptx（仓库根目录）

设计约束：
- 完全沿用模板的形状位置、字号、配色（主色 17324D / 次级 6D7F90 / Microsoft YaHei）
- 只替换占位文本，不新增/删除形状，保证版式与模板一致
- 表格单元格文字按字数自动缩放字号，避免溢出
"""
import copy
import io
import os
import sys

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Emu, Pt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, "课程设计开题答辩PPT模板.pptx")
OUTPUT = os.path.join(ROOT, "班级-小组号-OfferMind-开题答辩.pptx")

DARK = RGBColor(0x17, 0x32, 0x4D)   # 主色
GRAY = RGBColor(0x6D, 0x7F, 0x90)   # 次级色
FONT = "Microsoft YaHei"

# ---------------------------------------------------------------- 文本替换表

# slide_index -> {shape_index: [新文本, ...]}（按段落顺序，逐段落替换）
TEXT_REPLACEMENTS = {
    0: {
        0: ["OfferMind —— 可观测 Agentic RAG 驱动的 AI 求职面试训练平台"],
        5: ["面向计算机方向求职者，用「AI 定向刷题评测 + 简历诊断 + 模拟面试」三段闭环，"
            "把每次作答变成可解释、可追踪、可复习的训练数据。"],
        7: ["【待填：班级】  第 【X】 组"],
        9: ["马乾恩（组长） / 蒋志敏 / 李贤星"],
        10: ["汇报共 4 分钟 + 20–30 秒短演示，提问另计 3 分钟。",
             "当前已实现：13 个前端页面 · 9 张 LangGraph 状态图 · 9 个 SSE 流式端点 · 五条业务链路真数据跑通。"],
    },
    1: {
        5: ["牛客网题库（nowcoder.com）：计算机学生按公司/岗位刷专项题 —— 题是静态的，做完只有对错，不给针对我的评价。",
            "力扣（leetcode.cn）：算法专项 —— 没有标准答案的自评能力，八股完全覆盖不到。",
            "直接问 ChatGPT / DeepSeek：临时问概念 —— 黑盒、通用答案、评分不可解释。"],
        7: ["我们组同学刷完牛客「MySQL 索引」专项后问 DeepSeek「我这块能拿几分」，模型回「3 分 + 建议多练」。",
            "四个缺口：① 黑盒，看不到检索了什么；② 无参照，给的是通用知识而非「这个方向+这个难度」的答案；"
            "③ 评分不可解释，不知扣在正确性/完整性/表达/术语；④ 无追踪，对话结束就没了。"],
        9: ["改哪一步：把「一次性问答」改成「有参照 + 有量表 + 有记忆」的闭环。",
            "· 加参照：出题/评分前先检索题库库（BGE-M3 + rerank），用检索到的参考答案约束生成",
            "· 加量表：四维 rubric（正确性 0.40 / 完整性 0.30 / 表达 0.15 / 术语 0.15，各 0–5），每维必须给 reason",
            "· 加记忆：错题进 SM-2 复习排期，每次作答更新能力画像",
            "· 加透明：每一步（模型调用/向量检索/工具）以 SSE 实时推给执行面板"],
        11: ["① 题库仅 12 条（后端 6 / 前端 3 / 算法 3），扩充计划见第 3 页；",
             "② 面经企业库未实现（PRD 三个知识库目前只落地题库库）；",
             "③ 主生成走云端，有延迟与费用，vLLM 本地脚本已就绪但待 GPU 环境；",
             "④ 简历仅解析不留档；⑤ 画像由前端主动上报，非后端自动更新；"
             "⑥ Langfuse 依赖已声明但代码零引用，轨迹刷新即丢；⑦ 当前零单元测试。",
             "首版边界：一个用户、一个方向、一个知识库、一套四维量表 —— 先把「刷题→评分→错题→复习」这一条链做到可信。"],
    },
    2: {
        5: ["来源：自建种子题库 backend/app/rag/seed_data.py（仓库内可查看，非抓取，避免版权问题）",
            "当前规模：12 条 —— 后端 6 / 前端 3 / 算法 3；难度 入门 4 / 中级 6 / 高级 2；题型 八股 7 / 算法 3 / 业务 2",
            "每题 6 字段：direction / difficulty / question_type / content / reference_answer / key_points",
            "入库：python -m app.rag.ingest → PostgreSQL + Qdrant(question_bank, 1024 维, COSINE)，一题一个 point，不做 chunk 切分"],
        8: ["标注规则：四维 rubric（正确性 0.40 / 完整性 0.30 / 表达 0.15 / 术语 0.15，各 0–5）",
            "总分 = 四维加权求和，四舍五入到 1 分；每维必须附 reason，禁止裸分数",
            "gold.jsonl 已有 2 条完整人工标注（model_score 四维 + reason，human_scores 真值）",
            "质量与划分：12 条低于建议的 20–50 条 → 计划扩到 50 条；评测集 40 训 / 10 条独立测试隔离",
            "⚠ 当前导出脚本未按 answer_id 排除测试集（训练/评测泄漏），已定位改造点，列入 P0"],
    },
    3: {
        4: ["【在此放从输入到输出的流程图】",
            "前端 Next.js 15 + React 19（13 页）→ FastAPI(JWT+bcrypt) → LangGraph 9 图 12 节点",
            "→ BGE-M3 向量检索 Qdrant + bge-reranker-v2-m3 精排（dense/sparse/hybrid-RRF 三模式）",
            "→ LiteLLM 进程内 Router → 云端 deepseek-v4-flash 或本地 vLLM:8001",
            "→ PostgreSQL 事务数据 + Qdrant 文本片段（chunk_id 关联）",
            "每节点推 SSE step event：{id, type, status, payload, duration_ms} —— 全程可观测",
            "每一步标出实际使用的工具或模型。",
            "用文字标明“现成组件”和“本组新增”。"],
        6: ["Embedding：BAAI/bge-m3（本地，1024 维）",
            "Rerank：BAAI/bge-reranker-v2-m3（本地）",
            "主生成：deepseek-v4-flash（云端，OpenAI 兼容）",
            "编排：LangGraph 9 张 StateGraph / 12 节点",
            "检索：稠密 / BM25(jieba) / hybrid(RRF 融合) 三模式，后台热切换"],
        8: ["本地：BGE-M3 + reranker 懒加载预热（约 25s，不阻塞启动）；Docker Compose 起 PostgreSQL/Qdrant/Redis",
            "云端：主生成按 token 计费；一次「出题→作答→评分→追问」约 4 次调用",
            "GPU：无 GPU 环境。vLLM 脚本已就绪（fp16/awq/gptq，端口 8001，Qwen2.5-7B）",
            "显存估计：7B fp16 约 16GB / AWQ·GPTQ 约 6GB（经验值，非实测）",
            "热切换：后台改 Base URL 即生效，不用改代码不用重启"],
        10: ["评分器 LoRA 微调 + 量化档位对比（覆盖课程「微调」与「部署」两个主题）",
            "主变量 = 评分器模型（云端 deepseek-v4-flash vs LoRA 微调后的 Qwen2.5-1.5B）；",
            "次变量 = 部署档位（云端 vs vLLM fp16/awq/gptq）",
            "数据：系统自身 answers 表 → export_sft_dataset.py 导出 alpaca 格式；prompt 与线上逐字一致",
            "配置：LoRA r=16 α=32 / lr 1e-4 / 3 epoch / bf16 / 等效 batch 16 / cutoff_len 4096",
            "评测：一致率（±1 分）+ exact + 每维 MAE；eval_grader.py 默认读运行时配置而非 .env"],
    },
    4: {
        4: ["【放入真实运行截图或演示入口】",
            "演示脚本（20–30 秒）：",
            "1. 打开 http://localhost:3000/practice → 点「出题」（后端/中级）",
            "2. 右侧执行面板实时出现 3 行步骤并各带耗时：检索 → 生成 → 去重",
            "3. 管理端改 top_k / 检索模式 → 再出一次题，步骤数字跟着变",
            "让观众看见输入、实际输出和关键过程。",
            "⚠ 答辩前须补拍界面截图：docs/images/ 下 22 张全是 Mermaid 架构图，无界面截图",
            "兜底：投屏 backend/uvicorn.log 的真实 200 记录"],
        6: ["输入：方向=后端 / 难度=中级 / 题型=八股",
            "输出：一道带参考答案与考点的题，同时返回向量检索命中的题库条目与相似度"],
        8: ["① 结构化输出报 'NoneType' object has no attribute 'model_dump'：",
            "DeepSeek function calling 的 arguments 不保证合法 JSON（模型写了未转义引号即整段作废），",
            "实测约三成概率 → 改用 response_format=json_object + Pydantic 校验",
            "② 全部检索报 Cannot copy out of meta tensor，重启才好：",
            "预热线程与首个请求并发构造同一 HF 模型得到半初始化实例，坏实例缓存后永久生效",
            "→ 类内双重检查锁 + 模块级单例锁，刻意不用 lru_cache（它不锁构造，白占 2GB）",
            "③ 执行面板请求期间不动、结束后事件一次性全出：",
            "Next.js rewrites 是服务端代理，会先读完整个响应再转发 → 改为前端直连 + CORS",
            "④ 待复习队列永远是空的：毕业规则改成「答对一次」而队列按 is_wrong 过滤",
            "→ 改为连续答对 2 次才毕业（SM-2 在 quality<3 时清零，review_count 天然等于连续答对次数）"],
        9: ["复现线索：conda 环境 langchain_latest (Python 3.11) + Docker Compose(PostgreSQL/Qdrant/Redis/MinIO)；",
            "代码版本 git 94f43bf；日志 backend/uvicorn.log、backend/benchmark/cloud-test.json",
            "目前状态：已完成 —— 题库入库→检索(3 模式)→出题去重→四维评分→追问→简历诊断→模拟面试→报告→错题本 SM-2，",
            "13 个前端页面、9 张 LangGraph 图、9 个 SSE 端点，五条业务链路真数据跑通；",
            "只是计划 —— vLLM 未在 GPU 跑过、LoRA 未训练、题库 12→50 条、评测集 2→50 条、面经库、Langfuse、单元测试"],
    },
    5: {
        6: ["① 一致性：|模型分 − 人工分| ≤ 1 记为一致，一致率 = 一致数 / 有效样本数；"
            "② 偏差：每维 MAE = mean(|预测 − 人工|)；③ 延迟：首 token 与总延迟分开统计；"
            "④ 失败处理：非法 JSON / 超时样本计入失败率，不丢弃（丢弃会让指标虚高）。",
            "独立样例：真值由本组人工标注（两人分别打分，差异 >1 分第三人仲裁），在模型产出之前完成；"
            "40 条训练 + 10 条独立测试，测试集全程不参与训练与调参；召回评测另用 20 条真实查询。",
            "验收条件：10 条独立测试上总分一致率 ≥ 0.75 且总分 MAE ≤ 1.0 且 JSON 解析失败率 = 0，否则不宣称有效。"],
        7: ["可选指标：任务正确率、操作步骤、完成时间、单次成本。只选与痛点相关的。"],
    },
    6: {
        6: ["① 无 GPU，vLLM 起不来 → 保留云端实测行，量化对比降级为「只报云端 + 标注非本组实测」；"
            "② 题库/标注工作量大 → 优先保 10 条独立测试质量，训练 40 条可延后，出题 Agent 反哺题库；",
            "③ 标注一致性差 → 仲裁人机制 + 标注前统一 rubric 示例，一致率写进验收；"
            "④ 微调数据挤在中档 → 先补数据再加 epoch，不靠调超参硬凑；",
            "⑤ 现场断网/限流 → 后台切本地 vLLM（热生效），兜底投 uvicorn.log，再兜底播录屏；"
            "⑥ 面经库无授权语料 → 列为 P1，首版用题库库单库完成闭环。"],
    },
}

# ---------------------------------------------------------------- 表格内容

TABLE_REPLACEMENTS = {
    2: {
        0: [
            ["原始输入或资料", "字段、标签或预期输出"],
            ["方向：后端　难度：中级　题型：八股\n"
             "题干：MySQL 索引为什么使用 B+ 树而不是 B 树或红黑树？\n"
             "出处：自建种子题库 seed_data.py 第 3 条",
             "参考答案：1) B+ 树非叶子节点只存键不存数据，单节点能容纳更多键，树更矮，磁盘 IO 次数更少；"
             "2) 叶子节点用双向链表串联，支持高效范围查询和排序，而 B 树范围查询需中序遍历；"
             "3) 相比红黑树（二叉），B+ 树是多叉树，高度更低，更适合磁盘这种 IO 密集型场景。\n"
             "考点（key_points）：B+树 vs B树（数据存放、范围查询）、磁盘IO、树高"],
        ]
    },
    5: {
        0: [
            ["要改善什么", "与谁比较", "怎么测、测多少", "目标或当前实测"],
            ["改进点 1\n评分是否贴近人工判断",
             "未微调的\ndeepseek-v4-flash",
             "相同输入：同批 (题目,作答)\n指标：一致率(±1分)+每维MAE\n样本：50条人工标注\n(40训 / 10条独立测试)",
             "当前实测：无一例\n(gold仅2条占位、LoRA未训练)\n→ 不引用未实测数字\n目标：一致率≥0.75，MAE≤1.0"],
            ["改进点 2\n召回质量",
             "纯稠密向量检索\n(当前默认)",
             "相同查询：同批 20 条查询\n指标：Recall@5\n样本：20条×3模式\n(dense/sparse/hybrid-RRF)",
             "当前：三种模式均已实现\n后台可热切换\n待实测：Recall@5 数字\n目标：hybrid > dense"],
            ["改进点 3\n延迟与吞吐",
             "云端 deepseek-v4-flash\n实测值",
             "相同负载：固定prompt 200字符\n并发4 / 总50请求\n指标：首token P50、总延迟分位\nQPS、错误率",
             "当前实测(n=8)：\n首token P50 2752.8ms\n总延迟P50 3741.6ms\nQPS 0.89 / 错误率 0%\n目标：本地首token≤1500ms"],
        ]
    },
    6: {
        0: [
            ["成员", "已经完成", "下一步交付物", "完成日期"],
            ["马乾恩\n（组长）",
             "后端 Agent 编排与 RAG 链路\nLangGraph 9 图 12 节点\nBGE-M3/rerank 本地接入\nQdrant 三模式检索\nSSE 埋点(9 端点)",
             "① 完成 LoRA 微调全流程\n   (导出→训练→评测)，出前后对比表\n② P0：导出脚本加 answer_id\n   黑名单，消除训练/评测泄漏",
             "2026-11-05"],
            ["蒋志敏",
             "模型部署与网关\n进程内 LiteLLM Router\n+ LiteLLMChat 薄适配器\nvLLM 三档量化脚本\n压测脚本与实测报告",
             "① GPU 环境起 vLLM fp16/awq/gptq\n   补齐三档实测数字\n② 压测请求数 8 → 50\n   (当前 P99 置信度不足)",
             "2026-11-08"],
            ["李贤星",
             "前端 13 页 + 数据模型 + 文档\nNext.js 15 移植 13 个页面\n执行面板/雷达/错题本组件\n11 张表的数据模型\n12 条种子题数据",
             "① P0：补拍界面截图\n   (docs/images 现全是架构图)\n② 题库 12→50 条\n   标注评测集 2→50 条\n③ 接面经库与画像自动更新",
             "2026-11-12"],
            ["（全组）",
             "端到端联调\n五条业务链路真数据跑通\n(刷题/错题本/简历/面试/报告)\nnext build 通过\nuvicorn.log 有真实 200 记录",
             "① 管理端四页与大屏浏览器实测\n② 录 30 秒演示录屏(断网兜底)\n③ P0：补 6 个纯函数单元测试",
             "2026-11-10"],
        ]
    },
}


def set_runs(shape, lines):
    """把 shape 的文本按段落逐行替换，保留首段的字体设置。"""
    tf = shape.text_frame
    paras = tf.paragraphs
    template_para = paras[0]
    # 收集一个"样板 run"的字体属性
    sample_run = None
    for p in paras:
        for r in p.runs:
            sample_run = r
            break
        if sample_run is not None:
            break
    size = sample_run.font.size if sample_run is not None else Pt(18)
    bold = sample_run.font.bold if sample_run is not None else False
    color = None
    if sample_run is not None:
        try:
            color = sample_run.font.color.rgb
        except Exception:
            color = None

    # 清空所有段落
    for p in list(paras)[1:]:
        p._p.getparent().remove(p._p)
    p0 = tf.paragraphs[0]
    for r in list(p0.runs):
        r._r.getparent().remove(r._r)

    # 依据字号自动缩放（内容多则字号小）
    total_chars = sum(len(line) for line in lines)
    scale = 1.0
    if total_chars > 260:
        scale = 0.62
    elif total_chars > 190:
        scale = 0.72
    elif total_chars > 130:
        scale = 0.82
    elif total_chars > 80:
        scale = 0.92

    new_size = Pt(max(10.0, round(size.pt * scale, 1))) if size else Pt(16)

    for i, line in enumerate(lines):
        para = p0 if i == 0 else tf.add_paragraph()
        run = para.add_run()
        run.text = line
        run.font.name = FONT
        run.font.size = new_size
        run.font.bold = bold
        if color is not None:
            run.font.color.rgb = color
        # 中文字体也要指定东亚字体，否则 PowerPoint 可能回退字体
        rPr = run._r.get_or_add_rPr()
        for tag in ("a:latin", "a:ea", "a:cs"):
            el = rPr.find("{http://schemas.openxmlformats.org/drawingml/2006/main}" + tag.split(":")[1])
            if el is None:
                from pptx.oxml.ns import qn
                el = rPr.makeelement(qn(tag), {})
                rPr.append(el)
            el.set("typeface", FONT)



def ensure_rows(table, n):
    """把表格行数扩到 n（复制最后一行的样式）。

    注意：深拷贝会连同最后一行的**文字内容**一起复制，
    所以复制后必须清空单元格文字，否则会出现重复行。
    """
    import copy as _copy
    while len(table.rows) < n:
        tr = table.rows[len(table.rows) - 1]._tr
        new_tr = _copy.deepcopy(tr)
        tr.addnext(new_tr)
        # 清空新复制出来的行里的文字
        for tc in new_tr.findall(".//{http://schemas.openxmlformats.org/drawingml/2006/main}tc"):
            for p in tc.findall(".//{http://schemas.openxmlformats.org/drawingml/2006/main}p"):
                for r in p.findall(".//{http://schemas.openxmlformats.org/drawingml/2006/main}r"):
                    for t in r.findall(".//{http://schemas.openxmlformats.org/drawingml/2006/main}t"):
                        t.text = ""


def ensure_rows_exact(table, n):
    """把表格行数调整到恰好 n（多删少补）。"""
    import copy as _copy
    while len(table.rows) > n:
        tr = table.rows[len(table.rows) - 1]._tr
        tr.getparent().remove(tr)
    ensure_rows(table, n)

def fill_table(table, rows, total_height_in=None):
    """按二维列表填充表格，保留模板的表头样式。

    字号按「该格内容实际需要的行数」与「该行可容纳的行数」之比缩放，
    保证任何文字量下都不会溢出单元格。

    ⚠ 行必须按 XML 顺序（tbl.tr_lst）取，不能用 table.rows[ri]——
    深拷贝新行后 python-pptx 的 rows[] 索引与 XML 顺序不一致，
    用 rows[] 会把内容写错行。
    """
    from pptx.oxml.ns import qn

    # 表格总高（英寸）——决定每行能放多少行文字
    if total_height_in is None:
        total_height_in = sum(tr.height for tr in table.rows) / 914400.0
    n_rows = len(rows)
    header_ratio = 0.22          # 表头行占比
    body_height = total_height_in * (1 - header_ratio)
    body_rows = max(1, n_rows - 1)
    row_height_in = body_height / body_rows
    line_h = 0.30                # 以 16pt 估算的单行文字高度（英寸）

    # ---- 先按 XML 顺序取行，并设置行高 ----
    tr_list = list(table._tbl.tr_lst)
    assert len(tr_list) == n_rows, f"行数不匹配：XML {len(tr_list)} vs 数据 {n_rows}"

    for ri, tr in enumerate(tr_list):
        h = total_height_in * header_ratio if ri == 0 else row_height_in
        tr.set("h", str(int(h * 914400)))

    # ---- 逐格填充 ----
    for ri, row_data in enumerate(rows):
        tr = tr_list[ri]
        tcs = tr.findall(qn("a:tc"))
        is_header = (ri == 0)
        for ci, cell_text in enumerate(row_data):
            if ci >= len(tcs):
                continue
            tc = tcs[ci]
            txBody = tc.find(qn("a:txBody"))
            if txBody is None:
                continue
            # 取第一个 a:p 作为样板，其余删掉
            ps = txBody.findall(qn("a:p"))
            if not ps:
                continue
            sample_p = ps[0]
            sample_run = None
            for rr in sample_p.findall(qn("a:r")):
                sample_run = rr
                break
            base_size = 15.0
            for rr in sample_p.findall(qn("a:r")):
                rPr = rr.find(qn("a:rPr"))
                if rPr is not None and rPr.get("sz"):
                    base_size = int(rPr.get("sz")) / 100.0
                    break
            for extra in ps[1:]:
                txBody.remove(extra)
            # 清掉样板段落里的 run
            for rr in sample_p.findall(qn("a:r")):
                sample_p.remove(rr)
            for br in sample_p.findall(qn("a:br")):
                sample_p.remove(br)
            for fld in sample_p.findall(qn("a:fld")):
                sample_p.remove(fld)
            # 存一份「干净段落」模板：后续新段落从它复制，
            # 否则 deepcopy 会把已写入的第一行内容也复制进去，导致每行重复。
            clean_p = copy.deepcopy(sample_p)

            lines = cell_text.split("\n")
            # 该列宽度（英寸）→ 每行能放多少个汉字
            grid = table._tbl.find(qn("a:tblGrid"))
            gcs = grid.findall(qn("a:gridCol"))
            col_width_in = (int(gcs[ci].get("w")) / 914400.0) if ci < len(gcs) else 2.0

            def chars_per_line(sz, _w=col_width_in):
                return max(6, int(_w * 72 / sz))

            def needed_rows(sz, _lines=lines):
                cpl = chars_per_line(sz)
                return sum(max(1, -(-len(l) // cpl)) for l in _lines)

            avail_lines = max(1, int(row_height_in / line_h))
            sz = base_size
            if not is_header:
                for _ in range(30):
                    if sz <= 8.0 or needed_rows(sz) <= avail_lines:
                        break
                    sz -= 0.5
            else:
                sz = base_size
            sz = max(8.0, round(sz, 1))

            # 写入每一行文字
            for i, line in enumerate(lines):
                if i == 0:
                    p_el = sample_p
                else:
                    p_el = copy.deepcopy(clean_p)
                    txBody.append(p_el)
                r_el = p_el.makeelement(qn("a:r"), {})
                t_el = p_el.makeelement(qn("a:t"), {})
                t_el.text = line
                r_el.append(t_el)
                rPr = r_el.makeelement(qn("a:rPr"), {})
                rPr.set("lang", "zh-CN")
                rPr.set("sz", str(int(sz * 100)))
                rPr.set("b", "1" if is_header else "0")
                for tag in ("a:solidFill",):
                    fill = rPr.makeelement(qn(tag), {})
                    clr = fill.makeelement(qn("a:srgbClr"), {})
                    clr.set("val", str(DARK if is_header else GRAY))
                    fill.append(clr)
                    rPr.append(fill)
                for tag in ("a:latin", "a:ea", "a:cs"):
                    el = rPr.makeelement(qn(tag), {})
                    el.set("typeface", FONT)
                    rPr.append(el)
                r_el.insert(0, rPr)
                p_el.append(r_el)


def main():
    prs = Presentation(TEMPLATE)

    for slide_idx, shape_map in TEXT_REPLACEMENTS.items():
        slide = prs.slides[slide_idx]
        shapes = list(slide.shapes)
        for shape_idx, lines in shape_map.items():
            set_runs(shapes[shape_idx], lines)

    for slide_idx, table_map in TABLE_REPLACEMENTS.items():
        slide = prs.slides[slide_idx]
        tables = [sh.table for sh in slide.shapes if sh.has_table]
        for table_idx, rows in table_map.items():
            tbl = tables[table_idx]
            # 表格可用的总高（英寸）：取模板给的高度上限，不让它压到下方正文
            cur_h = sum(r.height for r in tbl.rows) / 914400.0
            if slide_idx == 2:
                total_h = 1.71          # 第 3 页：模板 2 行 × 0.85
            elif slide_idx == 5:
                total_h = 2.76          # 第 6 页：模板 3 行 × 0.92
            elif slide_idx == 6:
                total_h = 2.98          # 第 7 页：4 人 → 5 行，需要更高（下方正文框相应下移）
            else:
                total_h = cur_h
            ensure_rows_exact(tbl, len(rows))
            fill_table(tbl, rows, total_height_in=total_h)

    # 第 6 页：正文框与底部小字行间距调整，避免文字压到页脚
    s6 = prs.slides[5]
    for sh in s6.shapes:
        if sh.has_text_frame and "判断依据或验收条件" in sh.text_frame.text:
            sh.top = Emu(int(5.72 * 914400))
            sh.height = Emu(int(1.05 * 914400))
        elif sh.has_text_frame and "可选指标" in sh.text_frame.text:
            sh.top = Emu(int(6.86 * 914400))

    # 第 7 页：表格加高后需要上移，并把下方「主要风险」框下移，避免重叠
    s7 = prs.slides[6]
    shapes7 = list(s7.shapes)
    for sh in shapes7:
        if sh.has_table:
            sh.top = Emu(int(1.86 * 914400))
        elif sh.has_text_frame and "主要风险" in sh.text_frame.text:
            sh.top = Emu(int(5.18 * 914400))
        elif sh.has_text_frame and "最可能卡住" in sh.text_frame.text:
            sh.top = Emu(int(5.52 * 914400))

    prs.save(OUTPUT)
    print(f"已生成：{OUTPUT}")
    print(f"页数：{len(prs.slides)}")


if __name__ == "__main__":
    main()
