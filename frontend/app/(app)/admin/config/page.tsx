"use client";

/**
 * 模型与检索配置。对应设计稿 admin-config.html。
 *
 * 改动写进 draft，不立即发请求；「保存配置」一次性 PUT。改完即时生效
 * （后端使缓存失效，节点每次执行读一次）—— 无需重启。
 * 密文项（API Key）不回显：空输入 = 不修改。
 */

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { useConfirm } from "@/components/ConfirmProvider";
import { useToast } from "@/components/ToastProvider";
import {
  adminGetConfig,
  adminLlmOptions,
  adminResetConfig,
  adminUpdateConfig,
  type ConfigItem,
  type LlmOptions,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePageScope } from "@/lib/pageScope";

import "./config.css";

const GROUPS = [
  { id: "llm", ic: "◈", t: "模型接入", d: "端点 / 密钥 / 模型名 / 温度", keys: ["llm_base_url", "llm_api_key", "llm_model", "llm_temperature"] },
  { id: "rag", ic: "⌗", t: "检索策略", d: "召回条数 / 检索模式 / 精排 / 查重阈值", keys: ["retrieval_top_k", "retrieval_mode", "retrieval_use_rerank", "question_dup_threshold"] },
  { id: "gw", ic: "⇄", t: "网关路由", d: "多部署 + 失败回退", keys: ["llm_gateway_enabled", "llm_gateway_deployments", "llm_gateway_primary", "llm_gateway_fallbacks"] },
];

// 基准表：数字来自 backend/benchmark/*.json 与 finetune/eval/*.json，
// 没跑过就显示「待测」，不编造。云端一行是 scripts/bench_llm.py 的实测值。
const BENCH = { cloud: { p50: "3.74", p95: "5.45", p99: "5.55" } };

function truncate(s: string | undefined): string {
  return s && s.length > 34 ? s.slice(0, 34) + "…" : s || "（空）";
}

type GatewayNode = { name: string; model: string; api_base?: string };

export default function AdminConfigPage() {
  const { token } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  usePageScope("admin-config");

  const [cfg, setCfg] = useState<ConfigItem[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<LlmOptions | null>(null);
  const [pullOut, setPullOut] = useState("");
  const [saving, setSaving] = useState(false);

  const cfgOf = useCallback((k: string) => cfg.find((c) => c.key === k), [cfg]);

  useEffect(() => {
    if (!token) return;
    adminGetConfig(token)
      .then(setCfg)
      .catch((ex) => toast("err", "配置加载失败", ex instanceof Error ? ex.message : String(ex)));
  }, [token, toast]);

  function setDraftVal(k: string, v: string) {
    setDraft((d) => {
      const next = { ...d };
      if (v === (cfgOf(k)?.value ?? "")) delete next[k];
      else next[k] = v;
      return next;
    });
  }

  async function save() {
    if (!token) return;
    const keys = Object.keys(draft);
    if (!keys.length) return toast("info", "没有改动", "改一项配置再保存。");

    const specs = new Map(cfg.map((c) => [c.key, c]));
    const values: Record<string, string> = {};
    let skipped = 0;
    keys.forEach((k) => {
      const spec = specs.get(k);
      if (!spec) return;
      // 密钥留空 = 不修改。后端也按这个语义处理，这里提前过滤掉避免把空串写进库
      if (spec.kind === "secret" && !draft[k]) {
        skipped += 1;
        return;
      }
      values[k] = draft[k];
    });
    if (!Object.keys(values).length) {
      return toast("info", "没有需要保存的改动", skipped ? `${skipped} 项密钥留空，表示沿用已保存的值` : "");
    }

    setSaving(true);
    try {
      setCfg(await adminUpdateConfig(token, values));
      setDraft({});
      toast(
        "ok",
        "配置已生效",
        `${Object.keys(values).length} 项已更新${skipped ? ` · ${skipped} 项密钥留空未修改` : ""} · 缓存已失效，下一次 Agent 执行即读到新值`,
      );
    } catch (ex) {
      toast("err", "保存失败", ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    if (!token) return;
    try {
      setCfg(await adminGetConfig(token));
      setDraft({});
      setPullOut("");
      toast("info", "已丢弃改动", "表单回到数据库中的当前生效值");
    } catch (ex) {
      toast("err", "重新加载失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function resetItem(it: ConfigItem) {
    if (!token) return;
    const ok = await confirm({
      title: "恢复默认值",
      msg: `删除 ${it.label} 在数据库中的覆盖记录，回到 .env 的默认值。`,
      detail: <div className="mono small" style={{ padding: "10px 12px", background: "var(--surface-2)", borderRadius: 6 }}>{truncate(it.default)}</div>,
      ok: "恢复默认",
    });
    if (!ok) return;
    try {
      // DELETE /admin/config/{key} 返回刷新后的整份配置
      setCfg(await adminResetConfig(token, it.key));
      setDraft((d) => {
        const next = { ...d };
        delete next[it.key];
        return next;
      });
      toast("ok", "已恢复默认", `${it.label} 现在走 .env 默认值`);
    } catch (ex) {
      toast("err", "恢复失败", ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function pullModels() {
    if (!token) return;
    setPullOut("拉取中…");
    let opts: LlmOptions;
    try {
      opts = await adminLlmOptions(token);
    } catch (ex) {
      opts = { presets: [], source: "fallback", models: [], error: ex instanceof Error ? ex.message : String(ex) };
    }
    setOptions(opts);
    // 拉取用的是数据库里当前生效的端点，可能还没保存草稿，所以这里说明一下
    const usingDraft =
      draft["llm_base_url"] != null && draft["llm_base_url"] !== cfgOf("llm_base_url")?.value;
    setPullOut(
      opts.source === "live"
        ? `已从端点拉到 ${opts.models.length} 个模型 · ${opts.models.join(" / ")}`
        : `端点拉取失败，已降级为静态候选：${opts.error || "未知原因"}` +
          (usingDraft ? `（注意：拉取用的是已保存的端点。改过 Base URL 请先保存再拉。）` : ""),
    );
    toast(
      opts.source === "live" ? "ok" : "info",
      opts.source === "live" ? "模型列表已刷新" : "已降级到静态候选",
      opts.source === "live" ? "来源：当前 Base URL" : opts.error || "",
    );
  }

  // ---- 网关拓扑 ----
  const gwEnabled = (draft["llm_gateway_enabled"] ?? cfgOf("llm_gateway_enabled")?.value ?? "0") === "1";
  const gatewayNodes = useMemo((): ReactNode => {
    if (!gwEnabled) {
      const nm = cfgOf("llm_model")?.value;
      const bu = cfgOf("llm_base_url")?.value;
      return (
        <div className="node">
          <span className="dot done" />
          <div>
            <div className="nm">{nm}</div>
            <div className="md">直连 {bu} · 不走网关</div>
          </div>
          <span className="pill">primary</span>
        </div>
      );
    }
    const raw = draft["llm_gateway_deployments"] ?? cfgOf("llm_gateway_deployments")?.value;
    let deps: GatewayNode[] | null = null;
    try {
      deps = raw ? (JSON.parse(raw) as GatewayNode[]) : null;
    } catch {
      deps = null;
    }
    if (!deps || !Array.isArray(deps) || !deps.length) {
      return (
        <div
          className="warnbox-lite"
          style={{
            display: "flex",
            gap: 10,
            padding: "11px 13px",
            borderRadius: 6,
            background: "var(--warn-soft)",
            border: "1px solid oklch(68% 0.15 72 / .32)",
            fontSize: 12.5,
          }}
        >
          <span>⚠</span>
          <span>部署列表不是合法 JSON 数组 —— 网关会静默回落直连，服务不受影响。</span>
        </div>
      );
    }
    const primary = draft["llm_gateway_primary"] ?? cfgOf("llm_gateway_primary")?.value;
    const head = deps.find((d) => d.name === primary) || deps[0];
    const order = [head, ...deps.filter((d) => d !== head)];
    return order.map((d, i) =>
      i === 0 ? (
        <div className="node primary" key={d.name}>
          <span className="dot running" />
          <div>
            <div className="nm">{d.name}</div>
            <div className="md">{d.model}</div>
            <div className="md">{d.api_base || ""}</div>
          </div>
          <span className="pill accent">primary</span>
        </div>
      ) : (
        <Fragment key={d.name}>
          <div className="link">
            <span className="fblabel">失败回退 ↓</span>
          </div>
          <div className="node">
            <span className="dot done" />
            <div>
              <div className="nm">{d.name}</div>
              <div className="md">{d.model}</div>
              <div className="md">{d.api_base || ""}</div>
            </div>
            <span className="pill">fallback</span>
          </div>
        </Fragment>
      ),
    );
  }, [gwEnabled, draft, cfgOf]);

  const ovrCount = cfg.filter((c) => c.overridden).length;

  return (
    <div data-page="admin-config">
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin · 运行时配置</div>
          <div className="title-row" style={{ marginTop: 7 }}>
            <h1 className="h1">模型与检索配置</h1>
            <span className="pill accent">
              <span className="dot done" />
              改完即时生效 · 无需重启
            </span>
          </div>
          <p className="lead" style={{ marginTop: 8, fontSize: 14 }}>
            这里改动的是<b>运行时生效值</b>，不必重启服务。所有可调项集中登记在一处，
            新增一项只改那一处，页面上的表单会自动出现。
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void reload()} type="button">
            丢弃改动
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving} type="button">
            {saving ? "保存中…" : "保存配置"}
          </button>
        </div>
      </div>

      <div className="grid g-main-side">
        {/* ===== 左：配置表单 ===== */}
        <div className="stack">
          <section className="card" style={{ overflow: "hidden" }}>
            <div className="card-head">
              <div className="h3">配置项</div>
              <span className="small">改完即时生效</span>
            </div>
            <div>
              {GROUPS.map((g) => {
                const items = g.keys.map((k) => cfgOf(k)).filter(Boolean) as ConfigItem[];
                if (!items.length) return null;
                return (
                  <Fragment key={g.id}>
                    <div className="grouphead">
                      <span className="ic">{g.ic}</span>
                      <span className="grow">
                        <span className="t">{g.t}</span>
                        <span className="d" style={{ display: "block" }}>
                          {g.d}
                        </span>
                      </span>
                      <span className="pill">{items.length} 项</span>
                    </div>
                    {items.map((it) => {
                      const dirty = draft[it.key] != null && draft[it.key] !== it.value;
                      const cur = draft[it.key] != null ? draft[it.key] : it.value;
                      return (
                        <div className={`cfgrow${dirty ? " changed" : ""}`} key={it.key}>
                          <div>
                            <div className="lb">
                              {it.label}
                              {it.overridden ? (
                                <span className="pill accent">已覆盖 .env</span>
                              ) : (
                                <span className="pill">默认值</span>
                              )}
                            </div>
                            <div className="key">{it.key}</div>
                            <div className="ds">{it.description}</div>
                            {it.key === "llm_base_url" && (
                              <div className="mt-3" style={{ display: "grid", gap: 6, maxWidth: 420 }}>
                                {(options?.presets ?? []).map((p) => (
                                  <button
                                    className="preset"
                                    key={p.key}
                                    type="button"
                                    onClick={() => {
                                      setDraftVal("llm_base_url", p.base_url);
                                      toast("info", "已填入端点", p.base_url);
                                    }}
                                  >
                                    <span className="t">{p.label}</span>
                                    <span className="u">{p.base_url}</span>
                                    <span className="nt">{p.note || ""}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="ctl">
                            <Control
                              it={it}
                              value={cur}
                              modelExtra={options?.models ?? null}
                              onText={(v) => setDraftVal(it.key, v)}
                              onSelect={(v) => setDraftVal(it.key, v)}
                              onToggle={() =>
                                setDraftVal(it.key, cur === "1" || cur === "true" ? "0" : "1")
                              }
                            />
                            <div className="meta">
                              {it.kind !== "secret" && <span>默认：<code className="mono">{truncate(it.default)}</code></span>}
                              {it.overridden && (
                                <button className="btn btn-sm btn-ghost" onClick={() => void resetItem(it)} type="button">
                                  恢复默认
                                </button>
                              )}
                              {it.key === "llm_model" && (
                                <button className="btn btn-sm" onClick={() => void pullModels()} type="button">
                                  拉取模型列表
                                </button>
                              )}
                            </div>
                            {it.key === "llm_model" && pullOut && <span className="hint">{pullOut}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
            <div className="card-foot">
              <span className="small">
                {cfg.length} 个配置项 · {ovrCount} 项被覆盖（写库）· 其余走 .env 默认值
              </span>
              <span className="small">下一次 Agent 执行即读到新值</span>
            </div>
          </section>
        </div>

        {/* ===== 右：网关 + 基准 ===== */}
        <div className="side">
          <section className="card">
            <div className="card-head">
              <div className="h3">LiteLLM 网关路由</div>
              <span className={`pill${gwEnabled ? " accent" : ""}`}>
                {gwEnabled ? <span className="dot done" /> : <span className="dot" />}
                {gwEnabled ? "已启用" : "直连模式"}
              </span>
            </div>
            <div className="card-body">
              <div className="topo">{gatewayNodes}</div>
              <p className="hint mt-3">
                网关是<b>进程内 Router</b>（默认关）。部署列表解析不出来时静默回落直连 ——
                配置写坏不会拖垮服务。
              </p>
            </div>
            <div className="card-foot">
              <span className="small">密钥不回显 · 空值表示不修改</span>
              <span className="pill">多部署 + 回退</span>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">实测延迟基线</div>
              <span className="pill">云端已实测</span>
            </div>
            <div className="card-body tight">
              <div className="bench">
                <div className="r h">
                  <span>部署形态</span>
                  <span>P50</span>
                  <span>P95</span>
                  <span>P99</span>
                </div>
                <div className="r best">
                  <span>云端 API（已实测）</span>
                  <span>{BENCH.cloud.p50}s</span>
                  <span>{BENCH.cloud.p95}s</span>
                  <span>{BENCH.cloud.p99}s</span>
                </div>
                {["vLLM 本地 fp16", "vLLM 本地 AWQ-4bit", "vLLM 本地 GPTQ"].map((label) => (
                  <div className="r" key={label}>
                    <span>{label}</span>
                    <span style={{ color: "var(--faint)" }}>待测</span>
                    <span style={{ color: "var(--faint)" }}>待测</span>
                    <span style={{ color: "var(--faint)" }}>待测</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card-foot">
              <span className="small">固定 prompt 长度保证可比，区分首 token 与总延迟</span>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div className="h3">评分器微调对比</div>
              <span className="pill">待跑</span>
            </div>
            <div className="card-body">
              <div className="stack-sm" style={{ fontSize: 12.5 }}>
                <div className="row-between">
                  <span className="dim">一致率（微调前 → 微调后）</span>
                  <span className="mono" style={{ color: "var(--faint)" }}>待跑</span>
                </div>
                <div className="row-between">
                  <span className="dim">每维 MAE（微调前 → 微调后）</span>
                  <span className="mono" style={{ color: "var(--faint)" }}>待跑</span>
                </div>
                <div className="row-between">
                  <span className="dim">基座 / 方法</span>
                  <span className="mono">Qwen2.5-1.5B + LoRA</span>
                </div>
                <div className="row-between">
                  <span className="dim">训练数据来源</span>
                  <span className="mono">answers 表（评分自动累积）</span>
                </div>
                <div className="row-between">
                  <span className="dim">导出 / 评测脚本</span>
                  <span className="mono">export_sft_dataset.py · eval_grader.py</span>
                </div>
              </div>
              <p className="hint mt-3">
                对比口径：与人工标注的一致率（±1 分内算一致）+ 每维 MAE。评测固定读运行时的模型配置，
                避免拿到过期配置去测另一个模型。
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** 配置项右侧的控件。按 kind 分派，与后端 settings_service 的枚举一一对应。 */
function Control({
  it,
  value,
  modelExtra,
  onText,
  onSelect,
  onToggle,
}: {
  it: ConfigItem;
  value: string;
  modelExtra: string[] | null;
  onText: (v: string) => void;
  onSelect: (v: string) => void;
  onToggle: () => void;
}) {
  if (it.kind === "bool") {
    const on = value === "1" || value === "true";
    return (
      <div className="row" style={{ gap: 10 }}>
        <button
          className="switch"
          role="switch"
          aria-checked={on}
          type="button"
          onClick={onToggle}
        />
        <span className="small mono">{on ? "已启用" : "已关闭"}</span>
      </div>
    );
  }

  if (it.kind === "select") {
    // 端点上可能已经有当前值但不在候选列表里（比如手工填过），补进去免得下拉显示成别的
    let opts = it.options;
    if (modelExtra?.length) {
      opts = modelExtra.includes(value) ? modelExtra : [value, ...modelExtra];
    } else if (value && !opts.includes(value)) {
      opts = [value, ...opts];
    }
    return (
      <select className="select" value={value} onChange={(e) => onSelect(e.target.value)}>
        {opts.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  }

  if (it.kind === "secret") {
    return (
      <>
        <input
          className="input mono"
          type="password"
          placeholder={it.has_value ? "已保存，留空表示不修改" : "尚未配置"}
          autoComplete="new-password"
          onChange={(e) => onText(e.target.value)}
        />
        <span className="hint">页面不回显密钥明文。清空请用「恢复默认」删掉这条覆盖记录。</span>
      </>
    );
  }

  if (it.kind === "number") {
    return (
      <input
        className="input mono"
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onText(e.target.value)}
      />
    );
  }

  if (it.kind === "textarea") {
    return (
      <textarea
        className="textarea mono"
        style={{ minHeight: 110, fontSize: 11.5 }}
        value={value}
        onChange={(e) => onText(e.target.value)}
      />
    );
  }

  return <input className="input mono" value={value} onChange={(e) => onText(e.target.value)} />;
}
