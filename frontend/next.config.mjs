/** @type {import('next').NextConfig} */
const nextConfig = {
  // 不在这里用 rewrites 代理 /api：Next 的 rewrite 会把整个 SSE 响应缓冲到请求结束后才交给
  // 浏览器，Agent 执行面板就拿不到逐步的「进行中」事件。前端改为直连后端，地址见
  // lib/api.ts 与 .env.local 的 NEXT_PUBLIC_API_BASE（跨域由后端 CORSMiddleware 放行）。
};

export default nextConfig;
