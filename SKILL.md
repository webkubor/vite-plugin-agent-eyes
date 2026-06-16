---
name: agent-eyes
description: "给 AI agent 的自愈遥测层 — 在 Vite 项目里读结构化运行时日志（API/错误/代理 header），自我诊断、修复、验证，无需人读代码"
version: 0.1.0
---

# Vite Agent Debugger

让在 Vite 项目里干活的 agent 拥有**运行时视野**，跑「读日志 → 定位 → 改 → 重启 dev → 再读验证」的自愈闭环。
配套 npm 包 `vite-plugin-agent-eyes`（源码在本目录 `src/`，可 `npm publish` 或 git 安装）。

## 何时用

- 用户报"页面坏了 / 登录不上 / 请求失败 / cookie 问题"，但你**不该靠猜代码**——先读遥测。
- 你自己改完要**验证**：重启 dev、触发操作、读日志确认行为对了。
- 给一个还没接入的 Vite 项目装上这套自愈能力。

## 接入（一次性，3 步）

```ts
// 1. vite.config.ts
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'
export default defineConfig({
  plugins: [agentDebugger()],
  server: { proxy: { '/api': agentProxy('https://your-api.example.com') } },
})
```
```ts
// 2. 应用入口 main.tsx
import { installAgentErrorReporter } from 'vite-plugin-agent-eyes/client'
installAgentErrorReporter()
```
```ts
// 3. HTTP 拦截器（fetch/ky/axios 包装）里，每次请求结束调用
import { logApiCall } from 'vite-plugin-agent-eyes/client'
logApiCall({ method, path, url, ok, duration_ms, code, status, request_id, error, request, response })
```

未装包但想临时用：把 `src/index.ts` / `src/client.ts` 拷进项目 `scripts/` 直接引。

## 自愈闭环（核心，照此执行）

1. **先读 `log/README.md`** —— 项目自描述，确认日志在哪、各流看什么。
2. **读 `log/errors.log`** —— 定位"哪坏了"（最新在最上，`head` 即可）。
3. **按线索下钻**：
   - 接口/字段问题 → `log/api-calls.log` 看**真实**请求/响应体（**绝不凭类型猜字段**）。
   - 登录/cookie/CORS/302 等网络层 → `log/proxy.log` 看 `Cookie(req)` 与 `Set-Cookie`。
4. **噪声预判**：未登录时 `/auth/session` 的 401、浏览器扩展的 `runtime.lastError` 都是**预期噪声**，不是 bug，别去追。
5. **改代码 → 重启 dev**（vite 配置/插件改动 HMR 不重载，必须重启）**→ 重新触发 → 再读日志验证**。日志每次启动清空，看到的就是本次。

## 招牌诊断：登录成功却一直 401

```
api-calls.log:  POST .../auth/login  code=0        ← 登录成功
api-calls.log:  GET  .../auth/session code=40101    ← 紧跟却未登录
proxy.log:      GET  .../auth/session → 200 | Cookie(req): 无   ← 浏览器没带 cookie
```
根因：上游 Set-Cookie 是 `Domain=<父域> + Secure + SameSite=None`，本地 `http://localhost` 域不匹配 + Secure 被丢 → 拒收。
`agentProxy` 默认已在 dev 修复（去 Domain / 剥 Secure / SameSite=None→Lax）。关掉：`agentProxy(target, { rewriteCookiesForLocalhost: false })`。

## 三类日志速查

| 文件 | 看什么 |
|------|--------|
| `log/api-calls.log` | API 全量 + 路由，带请求/响应体 |
| `log/errors.log` | API 失败 + 前端运行时错误 |
| `log/proxy.log` | 代理层 Cookie / Set-Cookie 属性 / status |
