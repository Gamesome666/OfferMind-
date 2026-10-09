"""把设计稿 HTML 里的内联 <style> 提取出来，给每个选择器加 [data-page="X"] 前缀。

静态版每页是独立文档，样式天然隔离；Next 客户端路由下 CSS 常驻内存，
多页同名选择器（`.side` / `.card` / `.wrap`）会互相覆盖，所以必须作用域化。

处理四类情况：
- 普通规则（含单行规则）  → 每个逗号分隔的选择器各加前缀
- @media { ... }          → 递归处理内部规则
- @keyframes { ... }      → 整块原样保留（关键帧名与 0%/to 不能加前缀）
- body / html 规则        → 丢弃（tokens.css 已提供）

用法：python scope_css.py <源 html> <页面名> <输出 css>
"""
import re
import sys
import pathlib

PAGE = sys.argv[2]
SCOPE = f'[data-page="{PAGE}"]'

KEYFRAME_STEP = re.compile(r"^(from|to|\d+%)(\s*,\s*(from|to|\d+%))*$")


def prefix_selectors(sels: str) -> str:
    """给逗号分隔的选择器列表逐项加前缀；全局选择器返回空串表示整条规则丢弃。"""
    out = []
    for raw in sels.split(","):
        s = raw.strip()
        if not s:
            continue
        if KEYFRAME_STEP.match(s):
            out.append(s)
            continue
        if re.match(r"^(body|html)\b", s):
            # body 规则直接丢；若列表里混着 body 和别的选择器，只留别的
            continue
        out.append(f"{SCOPE} {s}")
    return ", ".join(out)


def transform(css: str) -> str:
    lines = css.split("\n")
    out: list[str] = []
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # —— @keyframes：连同内部一起原样输出 ——
        if stripped.startswith("@keyframes"):
            out.append(line)
            depth = line.count("{") - line.count("}")
            i += 1
            while i < len(lines) and depth > 0:
                depth += lines[i].count("{") - lines[i].count("}")
                out.append(lines[i])
                i += 1
            continue

        # —— @media：保留声明行，内部递归 ——
        if stripped.startswith("@media"):
            depth = line.count("{") - line.count("}")
            if depth == 0:
                # 单行写法：`@media (…) { .a { … } .b { … } }` —— 括号在行内已配平。
                # 直接拆出中间那段递归处理，不能再去后面找闭合行（会多吐一个 }）。
                # 段内可能塞了**多条**规则，而 transform 是按行解析的，
                # 所以先在每个 `}` 后补换行，把它们摊成独立行，否则只有第一条会被加前缀。
                head, _, tail = line.partition("{")
                inner_src, _, _close = tail.rpartition("}")
                inner_src = inner_src.replace("}", "}\n")
                out.append(head + "{" + transform(inner_src) + "}")
                i += 1
                continue

            out.append(line)
            i += 1
            inner: list[str] = []
            while i < len(lines) and depth > 0:
                depth += lines[i].count("{") - lines[i].count("}")
                if depth > 0:
                    inner.append(lines[i])
                i += 1
            out.append(transform("\n".join(inner)))
            out.append("}")
            continue

        # —— 普通规则 ——
        if "{" in line and not stripped.startswith("@"):
            sels, _, rest = line.partition("{")
            rest = "{" + rest
            pref = prefix_selectors(sels)
            if pref:
                out.append(f"{pref} {rest}")
            i += 1
            # 关键：depth 从**本行剩余部分**算起。
            # 单行规则（`body { … }`、`.x { color: red }`）在这里 depth 就是 0，
            # 不会继续往下吞——之前硬编码成 1 导致把后续规则整段原样吃掉了。
            depth = rest.count("{") - rest.count("}")
            while depth > 0 and i < len(lines):
                depth += lines[i].count("{") - lines[i].count("}")
                out.append(lines[i])
                i += 1
            continue

        out.append(line)
        i += 1

    return "\n".join(out)


def main() -> None:
    src_path = pathlib.Path(sys.argv[1])
    dst_path = pathlib.Path(sys.argv[3])

    html = src_path.read_text(encoding="utf-8")
    m = re.search(r"<style>(.*?)</style>", html, re.S)
    if not m:
        print(f"{src_path} 没有内联 <style> 块")
        return

    body = transform(m.group(1))
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    dst_path.write_text(
        f'/* {PAGE} 页私有样式。提取自设计稿的内联 <style>，选择器统一加 {SCOPE} 前缀。\n'
        f"   body/html 全局规则已剔除（tokens.css 提供）。 */\n\n" + body.strip() + "\n",
        encoding="utf-8",
    )
    n = body.count(SCOPE)
    print(f"{src_path.name} → {dst_path}：{len(body.splitlines())} 行，{n} 个选择器已加前缀")


if __name__ == "__main__":
    main()
