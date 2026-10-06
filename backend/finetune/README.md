# 评分器 LoRA 微调

课程主题是「大模型**部署与微调**」，而项目原本既没有微调、也没有真正的模型部署
（主生成模型全走云端 API）。这个目录补的就是「微调」那一半。

## 为什么选评分器做微调对象

不是随便挑的，评分器有三个别处没有的条件：

| 条件 | 说明 |
|---|---|
| **有 ground truth** | 四维 rubric 是明确的量表，人工能标，指标可量化（一致率 + MAE） |
| **数据自己长出来** | 系统每次评分都往 `answers` 表写 `(题目, 参考答案, 作答, 四维评分)`，就是一条 SFT 样本 |
| **输出可校验** | 结构化 JSON，格式对不对 Pydantic 一说就知道，不是「感觉还行」 |

换句话说，这是整个项目里**唯一能拿出「微调前 vs 微调后」对比表**的地方。

## 数据飞轮

```
用户刷题 → 评分落库(answers 表) → 导出脚本 → SFT 数据集 → LoRA 微调
   ↑                                                            │
   └──────────── 本地小模型替换云端评分 ← vLLM 起服务 ←──────────┘
```

关键点：**不用另找数据集**。用户每做一次评分，数据集就长一条。

## 完整流程

### 1. 攒数据

正常用刷题功能即可，评分结果会自动落库。看当前攒了多少：

```bash
cd backend
python scripts/export_sft_dataset.py --stats-only
```

### 2. 导出 SFT 数据集

```bash
python scripts/export_sft_dataset.py --drop-degenerate
```

- 输出 `finetune/data/grader_sft.jsonl`（LLaMA-Factory alpaca 格式）
- 脚本会自动跳过字段不全的样本，并打印总分分布——**分布全挤在中档说明数据没有区分度**，微调学不出东西
- prompt 与线上逐字一致（直接复用 `app.agent.prompts.GRADE_TEMPLATE`），避免训推不一致

### 3. 做评测集（关键一步，别跳过）

```bash
# 抽 50 条生成待标注模板
python scripts/eval_grader.py --make-template 50
```

然后**人工**填 `finetune/data/gold.jsonl` 里每条的 `human_scores` 和 `human_total`。

> 这 50-200 条人工标注是整个微调环节里唯一无法自动化的一步，也是答辩时最有说服力的
> 东西——它证明你的指标不是自己跟自己比。建议标 100 条以上。

### 4. 测「微调前」基线

```bash
python scripts/eval_grader.py --gold finetune/data/gold.jsonl --label before
```

默认测的是**数据库里配置的线上模型**（不是 `.env`，因为管理员可能改过）。

### 5. 训练

```bash
pip install llamafactory
llamafactory-cli train finetune/train_lora.yaml
```

### 6. 起本地服务

```bash
# 合并 LoRA 权重并导出
llamafactory-cli export finetune/train_lora.yaml \
  --export_dir finetune/output/qwen2.5-1.5b-grader-merged

# 用 vLLM 起 OpenAI 兼容服务（第 2 项的内容）
vllm serve finetune/output/qwen2.5-1.5b-grader-merged --port 8001
```

### 7. 测「微调后」

```bash
python scripts/eval_grader.py --gold finetune/data/gold.jsonl --label after \
  --model finetune/output/qwen2.5-1.5b-grader-merged \
  --base-url http://127.0.0.1:8001/v1 --api-key EMPTY
```

### 8. 出对比表

```bash
python scripts/eval_grader.py --compare finetune/eval/before.json finetune/eval/after.json
```

输出形如：

```
=== 对比：before (deepseek-flash)  →  after (qwen2.5-1.5b-grader) ===
  维度              一致率              MAE     判定
  正确性     0.0% → 75.0%    3.500 → 0.800   ↑ 改善
  ...
  5/5 个维度 MAE 下降
```

## 指标口径

| 指标 | 定义 | 为什么这么定 |
|---|---|---|
| **一致率** | 与人工评分相差 ≤1 分算一致 | 评分是主观量表，要求精确相等过于苛刻 |
| **完全相同** | 差 0 分 | 衡量严格一致的程度 |
| **MAE** | 平均绝对误差 | 看整体偏移方向与幅度 |

评测默认**不走向量检索**——线上评分会先检索题库参照，那是另一个变量。把它掺进来，
微调前后的差异就分不清是模型带来的还是检索带来的。需要看端到端表现时再加检索。

## 目录结构

```
finetune/
├── dataset_info.json         LLaMA-Factory 数据集注册
├── train_lora.yaml           LoRA 训练配置
├── data/
│   ├── grader_sft.jsonl      导出的训练集（脚本生成）
│   └── gold.jsonl            人工标注的评测集
└── eval/
    ├── before.json           微调前评测结果
    └── after.json            微调后评测结果
```

## 落在线上

微调后的模型要真正接入，把管理后台的**模型端点 Base URL** 改成 vLLM 的地址即可
（`http://127.0.0.1:8001/v1`）——配置是运行时热生效的，不用改代码、不用重启。
