#!/usr/bin/env bash
# 用 vLLM 起一个 OpenAI 兼容服务，供 OfferMind 当本地模型端点用。
#
# 用法：
#   bash deploy/vllm/serve.sh                          # 默认 FP16 起 Qwen2.5-7B
#   bash deploy/vllm/serve.sh awq                      # 用 AWQ 4bit 量化（显存约 1/3）
#   bash deploy/vllm/serve.sh gptq
#   MODEL=/path/to/merged bash deploy/vllm/serve.sh awq   # 起微调后的模型
#
# 起好之后，把管理后台的「模型端点 Base URL」改成 http://127.0.0.1:8001/v1
# 即可切到本地模型 —— 配置是运行时热生效的，不用改代码、不用重启。
set -euo pipefail

QUANT="${1:-fp16}"
PORT="${PORT:-8001}"
MODEL="${MODEL:-Qwen/Qwen2.5-7B-Instruct}"

case "$QUANT" in
  fp16)
    # 基线：质量最好，7B 大约要 16GB 显存（权重 + KV cache）
    QUANT_ARGS=(--dtype bfloat16)
    ;;
  awq)
    # 4bit 权重量化：显存降到约 6GB，质量损失通常在 1% 以内
    QUANT_ARGS=(--quantization awq --dtype float16)
    ;;
  gptq)
    QUANT_ARGS=(--quantization gptq --dtype float16)
    ;;
  *)
    echo "未知量化方式：$QUANT（可选 fp16 / awq / gptq）" >&2
    exit 1
    ;;
esac

echo "启动 vLLM：model=$MODEL  quant=$QUANT  port=$PORT"

exec vllm serve "$MODEL" \
  --served-model-name "$(basename "$MODEL")" \
  --host 0.0.0.0 \
  --port "$PORT" \
  "${QUANT_ARGS[@]}" \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90 \
  --enable-prefix-caching \
  --disable-log-requests
# --enable-prefix-caching：评分/面试的 prompt 前缀高度重复（system + 评分量表），
# 开前缀缓存能显著降低首 token 延迟；这正是压测里要对比的一项。
