import type { Metadata } from "next";

import { ConfirmProvider } from "@/components/ConfirmProvider";
import { ToastProvider } from "@/components/ToastProvider";
import { AuthProvider } from "@/lib/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: "OfferMind · 可观测的 AI 面试训练平台",
  description: "可观测 Agentic RAG 驱动的 AI 求职面试训练平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {/* Provider 顺序：Auth 在最外（所有页面都要用），Toast/Confirm 是全局反馈层，
            放在 Auth 里面——它们不依赖登录态，但要在客户端组件树里。 */}
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
