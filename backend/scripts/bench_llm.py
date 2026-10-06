"""LLM 端点压测：产延迟分位数与吞吐上限。

「部署」章节要的核心数字全在这里：P50/P95/P99 延迟、QPS 上限、错误率。
对比对象通常是：云端 API vs 本地 vLLM vs 不同量化精度（FP16 / AWQ / GPTQ）。

用法：
    # 默认打线上配置的端点，10 并发 × 共 30 个请求
    python scripts/bench_llm.py --concurrency 10 --total 30

    # 对比本地 vLLM（微调后）
    python scripts/bench_llm.py --base-url http://127.0.0.1:8001/v1 \
        --api-key EMPTY --model Qwen2.5-7B-Instruct --label local-qwen

    # 对比两种量化：跑两次换 --label 即可，结果分别落盘

设计说明：
- **固定 prompt 长度**：不同 prompt 的延迟不可比。用 --prompt-chars 统一输入规模。
- **区分 TTFT 与总延迟**：流式下首 token 时间决定「体感快慢」，总时长决定吞吐，
  两者要分开报。这里用流式请求分别测。
- **既报并发也报串行**：串行延迟反映单请求质量，并发下的 P99 反映排队与限流，
  只看一个数会得出错误结论。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.agent.llm import new_session_id  # noqa: E402


def percentile(values: list[float], p: float) -> float:
    """线性插值分位数（不依赖 numpy）。"""
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    index = (len(ordered) - 1) * p
    low = int(index)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def build_prompt(target_chars: int) -> str:
    """构造固定长度的中文 prompt，保证跨端点可比。"""
    base = "请评价下面这段技术描述的专业程度，并指出可以改进的地方。"
    filler = "在分布式系统中，服务之间的调用需要处理超时、重试与幂等性问题。"
    text = base
    while len(text) < target_chars:
        text += filler
    return text[:target_chars]


async def one_request(
    client: httpx.AsyncClient, url: str, headers: dict, model: str,
    prompt: str, max_tokens: int, stream: bool,
) -> dict:
    """打一次请求，返回 {ttft_ms, total_ms, ok, error}。"""
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "stream": stream,
    }
    started = time.perf_counter()
    ttft = None
    try:
        if not stream:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            return {
                "ttft_ms": None,
                "total_ms": (time.perf_counter() - started) * 1000,
                "ok": True,
                "error": None,
            }

        async with client.stream("POST", url, json=body, headers=headers) as resp:
            if resp.status_code >= 400:
                detail = (await resp.aread()).decode()[:160]
                return {"ttft_ms": None, "total_ms": None, "ok": False, "error": f"{resp.status_code} {detail}"}
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                if ttft is None:
                    ttft = (time.perf_counter() - started) * 1000
        return {
            "ttft_ms": ttft,
            "total_ms": (time.perf_counter() - started) * 1000,
            "ok": True,
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ttft_ms": None,
            "total_ms": None,
            "ok": False,
            "error": f"{type(exc).__name__}: {str(exc)[:140]}",
        }


async def benchmark(
    base_url: str, api_key: str, model: str, concurrency: int,
    total: int, prompt_chars: int, max_tokens: int, stream: bool, timeout: float,
) -> dict:
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}" if api_key else "",
        "Content-Type": "application/json",
        # 网关端点要求客户端标识与会话头（见 app/agent/llm.py 的模块说明）
        "User-Agent": "OfferMind/0.1",
        "x-opencode-session": new_session_id(),
    }
    headers = {k: v for k, v in headers.items() if v}

    prompt = build_prompt(prompt_chars)
    semaphore = asyncio.Semaphore(concurrency)
    results: list[dict] = []

    async with httpx.AsyncClient(timeout=timeout) as client:
        async def guarded():
            async with semaphore:
                results.append(
                    await one_request(client, url, headers, model, prompt, max_tokens, stream)
                )

        started = time.perf_counter()
        await asyncio.gather(*(guarded() for _ in range(total)))
        wall = time.perf_counter() - started

    ok = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]
    latencies = [r["total_ms"] for r in ok if r["total_ms"]]
    ttfts = [r["ttft_ms"] for r in ok if r["ttft_ms"]]

    return {
        "requests": total,
        "concurrency": concurrency,
        "succeeded": len(ok),
        "failed": len(failed),
        "error_rate": round(len(failed) / total, 4) if total else 0,
        "wall_s": round(wall, 2),
        "qps": round(len(ok) / wall, 2) if wall else 0,
        "latency_ms": {
            "p50": round(percentile(latencies, 0.50), 1),
            "p95": round(percentile(latencies, 0.95), 1),
            "p99": round(percentile(latencies, 0.99), 1),
            "mean": round(statistics.fmean(latencies), 1) if latencies else 0,
        },
        "ttft_ms": {
            "p50": round(percentile(ttfts, 0.50), 1),
            "p95": round(percentile(ttfts, 0.95), 1),
        } if ttfts else None,
        "errors": [r["error"] for r in failed[:5]],
    }


def print_report(label: str, model: str, stats: dict) -> None:
    print(f"\n=== [{label}] {model} ===")
    print(f"  请求 {stats['requests']}  并发 {stats['concurrency']}  "
          f"成功 {stats['succeeded']}  失败 {stats['failed']}  错误率 {stats['error_rate']:.1%}")
    print(f"  墙钟 {stats['wall_s']}s   吞吐 {stats['qps']} req/s")
    lat = stats["latency_ms"]
    print(f"  总延迟  P50 {lat['p50']}ms   P95 {lat['p95']}ms   P99 {lat['p99']}ms   均值 {lat['mean']}ms")
    if stats["ttft_ms"]:
        t = stats["ttft_ms"]
        print(f"  首 token P50 {t['p50']}ms   P95 {t['p95']}ms")
    if stats["errors"]:
        print("  错误样例:")
        for err in stats["errors"]:
            print("    -", err)


async def main() -> None:
    parser = argparse.ArgumentParser(description="LLM 端点压测")
    parser.add_argument("--base-url", default=None, help="默认用数据库里配置的线上端点")
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--model", default=None)
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--total", type=int, default=30)
    parser.add_argument("--prompt-chars", type=int, default=200, help="固定 prompt 长度，保证可比")
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--no-stream", action="store_true", help="关闭流式（则无首 token 指标）")
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--label", default="cloud", help="本次压测的标签，用于落盘对比")
    parser.add_argument("--out-dir", default="benchmark")
    args = parser.parse_args()

    # 默认打线上正在用的端点：读库而不是 .env（管理员可能改过）
    base_url, api_key, model = args.base_url, args.api_key, args.model
    if not (base_url and model):
        from app.core.database import async_session, engine
        from app.services import settings_service

        async with async_session() as db:
            runtime = await settings_service.runtime_config(db)
        await engine.dispose()
        base_url = base_url or runtime["llm_base_url"]
        api_key = api_key or runtime["llm_api_key"]
        model = model or runtime["llm_model"]

    print(f"端点 {base_url}")
    print(f"模型 {model}  prompt {args.prompt_chars} 字  max_tokens {args.max_tokens}")

    stats = await benchmark(
        base_url, api_key, model, args.concurrency, args.total,
        args.prompt_chars, args.max_tokens, not args.no_stream, args.timeout,
    )
    print_report(args.label, model, stats)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{args.label}.json"
    out_file.write_text(
        json.dumps({"label": args.label, "model": model, "base_url": base_url,
                    "config": {"concurrency": args.concurrency, "total": args.total,
                               "prompt_chars": args.prompt_chars, "max_tokens": args.max_tokens},
                    "stats": stats}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n结果已写出 → {out_file}")


if __name__ == "__main__":
    asyncio.run(main())
