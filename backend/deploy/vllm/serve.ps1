# 用 vLLM 起一个 OpenAI 兼容服务，供 OfferMind 当本地模型端点用。
#
# 用法：
#   .\deploy\vllm\serve.ps1                 # 默认 FP16 起 Qwen2.5-7B
#   .\deploy\vllm\serve.ps1 -Quant awq      # AWQ 4bit 量化（显存约 1/3）
#   $env:MODEL="finetune\output\qwen2.5-1.5b-grader-merged"; .\deploy\vllm\serve.ps1 -Quant awq
#
# 起好之后把管理后台的「模型端点 Base URL」改成 http://127.0.0.1:8001/v1 即可切到本地模型。

param(
    [ValidateSet("fp16", "awq", "gptq")]
    [string]$Quant = "fp16",
    [int]$Port = 8001
)

$Model = if ($env:MODEL) { $env:MODEL } else { "Qwen/Qwen2.5-7B-Instruct" }

$quantArgs = switch ($Quant) {
    "fp16" { @("--dtype", "bfloat16") }
    "awq"  { @("--quantization", "awq", "--dtype", "float16") }
    "gptq" { @("--quantization", "gptq", "--dtype", "float16") }
}

Write-Host "启动 vLLM：model=$Model  quant=$Quant  port=$Port"

# --enable-prefix-caching：评分/面试的 prompt 前缀高度重复（system + 评分量表），
# 开前缀缓存能显著降低首 token 延迟；这正是压测里要对比的一项。
& vllm serve $Model `
    --served-model-name (Split-Path $Model -Leaf) `
    --host 0.0.0.0 `
    --port $Port `
    @quantArgs `
    --max-model-len 8192 `
    --gpu-memory-utilization 0.90 `
    --enable-prefix-caching `
    --disable-log-requests
