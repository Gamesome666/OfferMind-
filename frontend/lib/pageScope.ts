"use client";

/**
 * 页面样式作用域。
 *
 * 背景：设计稿的页面私有 CSS 全部写成 `[data-page="X"] .xxx`（见 scripts/scope_css.py）。
 * 静态版每页是独立文档，样式天然隔离；Next 客户端路由下 CSS 常驻内存，
 * 多页同名选择器（`.side` / `.card` / `.row-item`）会互相覆盖，所以必须作用域化。
 *
 * 为什么把属性挂在 `<body>` 而不是页面根 div 上：
 * **弹层走 `createPortal` 挂到 `document.body`**，位置在页面根 div 之外。
 * 如果属性只在那个 div 上，弹层里的 `.qbtn` / `.predict` 这类页面私有类就匹配不到，
 * 表现为「弹层内容没有样式、堆成竖排」。挂到 body 上则 portal 也在作用域内。
 *
 * 同时只有一个页面处于激活状态，所以 body 上始终只有一个 data-page 值。
 */

import { useEffect } from "react";

export function usePageScope(key: string): void {
  useEffect(() => {
    document.body.dataset.page = key;
    return () => {
      // 卸载时清掉，避免上一个页面的样式在新页面上继续命中
      if (document.body.dataset.page === key) delete document.body.dataset.page;
    };
  }, [key]);
}
