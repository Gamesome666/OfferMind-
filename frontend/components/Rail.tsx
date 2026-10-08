"use client";

/** 侧栏导航。对应设计稿的 `Om.rail` + `Om.mount`。 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { answerStats } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type NavItem = { href: string; label: string; ico: string; badge?: boolean };
type NavEntry = NavItem | { group: string };

const NAV: NavEntry[] = [
  { group: "训练" },
  { href: "/dashboard", label: "工作台", ico: "◇" },
  { href: "/practice", label: "刷题训练", ico: "▸" },
  { href: "/wrongbook", label: "错题本", ico: "★", badge: true },
  { href: "/interview", label: "模拟面试", ico: "◉" },
  { group: "分析" },
  { href: "/resume", label: "简历诊断", ico: "≡" },
  { href: "/report", label: "能力报告", ico: "◈" },
  { group: "管理" },
  { href: "/admin", label: "后台概览", ico: "⌘" },
  { href: "/admin/questions", label: "题库管理", ico: "▤" },
  { href: "/admin/config", label: "模型与检索", ico: "⚙" },
  { href: "/admin/api", label: "接口总览", ico: "⌗" },
  { group: "展示" },
  { href: "/bigscreen", label: "数据大屏", ico: "▣" },
];

/** 管理分组的链接数——用来判断「管理」组是否整体隐藏。 */
const ADMIN_HREFS = new Set([
  "/admin",
  "/admin/questions",
  "/admin/config",
  "/admin/api",
]);

function isGroup(e: NavEntry): e is { group: string } {
  return "group" in e;
}

/** 当前路径是否命中该导航项。子路由（/admin/questions）算命中自己那一项。 */
function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // /admin 是概览，不该在自己有子路由时也高亮 —— 其余按前缀匹配
  if (href === "/admin") return false;
  return pathname.startsWith(`${href}/`);
}

export default function Rail() {
  const { user, token, signOut } = useAuth();
  const pathname = usePathname();
  const [due, setDue] = useState(0);

  // 错题本角标：设计稿里这是从模拟数据同步读的，真实环境下要打接口。
  // 跟随 pathname 重新拉，这样在错题本复习完切回别的页面，角标是新的。
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    answerStats(token)
      .then((s) => {
        if (!cancelled) setDue(s.due);
      })
      .catch(() => {
        /* 角标拿不到不影响导航 */
      });
    return () => {
      cancelled = true;
    };
  }, [token, pathname]);

  let lastGroup = "";

  return (
    <nav className="rail">
      <Link className="rail-brand" href="/">
        <span className="mark">OfferMind</span>
        <span className="tag">v0.9</span>
      </Link>

      {NAV.map((entry, index) => {
        if (isGroup(entry)) {
          lastGroup = entry.group;
          // 管理分组只对管理员显示（CLAUDE.md 里定的约定）
          if (entry.group === "管理" && !user?.is_admin) return null;
          return (
            <div className="rail-group" key={`g-${index}`}>
              {entry.group}
            </div>
          );
        }
        if (lastGroup === "管理" && !user?.is_admin) return null;

        const active = isActive(pathname, entry.href);
        return (
          <Link
            key={entry.href}
            className={`rail-link${active ? " active" : ""}`}
            href={entry.href}
          >
            <span className="ico">{entry.ico}</span>
            <span className="grow truncate">{entry.label}</span>
            {entry.badge && due > 0 && <span className="badge-n num">{due}</span>}
          </Link>
        );
      })}

      <div className="rail-foot">
        <div className="rail-user" title={user?.email ?? ""}>
          {user?.nickname || user?.email || ""}
          <small>{user?.email ?? ""}</small>
        </div>
        <button className="rail-out" onClick={signOut} type="button">
          退出登录
        </button>
      </div>
    </nav>
  );
}
