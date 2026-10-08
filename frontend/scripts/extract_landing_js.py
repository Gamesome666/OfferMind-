"""把设计稿落地页的内联 <script> 提取成可挂载/可卸载的模块。

策略：**逻辑一字不改**，只做包装：
1. 整段脚本包进 `initLanding()`，在 React 的 useEffect 里调用；
2. 初始化期间临时包装 `addEventListener`，把 AbortSignal 注入到**所有**监听器上，
   卸载时 `abort()` 一次性摘除。

为什么用包装而不是逐个改写调用点：脚本里既有单行监听器也有多行回调
（`addEventListener("x", (e) => {` … `});`），逐个正则改容易漏；
包装能覆盖全部，且不改动原逻辑一个字。

为什么不在 React 里重写画布动画：那是 ~280 行 Canvas 物理/绘制代码，用 React
惯用法重写只会引入行为漂移，而它本身不碰 React 状态 —— 包一层就够了。

用法：python extract_landing_js.py
"""
import pathlib
import re

SRC = pathlib.Path("../public/design/index.html")
DST = pathlib.Path("../app/(landing)/landing.js")

html = SRC.read_text(encoding="utf-8")
m = re.search(r"<script>(.*?)</script>", html, re.S)
if not m:
    raise SystemExit("没找到 <script> 块")

body = m.group(1).strip()
indented = "\n".join(("  " + ln) if ln.strip() else ln for ln in body.split("\n"))

DST.parent.mkdir(parents=True, exist_ok=True)
DST.write_text(
    "/* 落地页的交互脚本。提取自设计稿 index.html 的内联 <script>。\n"
    "\n"
    "   逻辑与设计稿逐字一致，未做任何改写。仅有的两处包装：\n"
    "   1. 整体包进 `initLanding()`，由 React 在 useEffect 里调用；\n"
    "   2. 初始化期间临时包一层 addEventListener，把 AbortSignal 注入所有监听器，\n"
    "      卸载时 abort() 一次性摘除（脚本里有单行也有多行回调，逐个注入容易漏）。\n"
    "\n"
    "   注意：其中「检索星图」那段是 Canvas 动画，用 React 惯用法重写只会引入行为漂移，\n"
    "   它本身不读写 React 状态，所以按原样保留。\n"
    "*/\n"
    "\n"
    "export function initLanding() {\n"
    "  const ac = new AbortController();\n"
    "  const { signal } = ac;\n"
    "\n"
    "  const origAdd = EventTarget.prototype.addEventListener;\n"
    "  EventTarget.prototype.addEventListener = function (type, fn, opts) {\n"
    "    if (opts && typeof opts === \"object\") {\n"
    "      origAdd.call(this, type, fn, { ...opts, signal });\n"
    "    } else {\n"
    "      origAdd.call(this, type, fn, { capture: !!opts, signal });\n"
    "    }\n"
    "  };\n"
    "\n"
    "  try {\n"
    + "\n".join(("    " + ln) if ln.strip() else ln for ln in indented.split("\n"))
    + "\n"
    "  } finally {\n"
    "    EventTarget.prototype.addEventListener = origAdd;\n"
    "  }\n"
    "\n"
    "  return () => ac.abort();\n"
    "}\n",
    encoding="utf-8",
)

print(f"已写出 {DST}")
print(f"  原始脚本 {len(body.splitlines())} 行，监听器注册 {body.count('addEventListener(')} 处（全部由包装覆盖）")
