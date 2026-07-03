# 快速上手

5 分钟目标：装上插件 → 启动 dev → 触发一次请求 → 在日志文件里看到它。跑通这四步，你就理解了这个插件的工作方式。

## 第 1 步：配置 vite.config.ts

在你的 `vite.config.ts` 里加两行——`agentDebugger()` 收日志，`agentProxy()` 代理 API 并修复本地 cookie：

```ts
import { defineConfig } from 'vite'
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentDebugger()],
  server: {
    proxy: {
      // 把你的后端地址填这里
      '/api': agentProxy('https://your-api.example.com'),
    },
  },
})
```

::: tip 没有后端代理？
如果你只是想看错误日志、不关心 cookie，可以省掉 `server.proxy` 那段，只留 `agentDebugger()`。proxy 是用来解决登录态问题的，不是必需。
:::

## 第 2 步：在应用入口加一行自动埋点

在你应用最早加载的地方（React 的 `main.tsx`、Vue 的 `main.ts`、原生 JS 的入口脚本），加一行：

```ts
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()
```

这一行会自动包装 `fetch` / `XMLHttpRequest` / 路由导航 / 全局错误 / 全控制台 / DOM 快照，0.10.0+ 还会默认记录脱敏交互轨迹。你不需要手动写任何拦截器。

::: details 需要精细控制？用手动埋点
```ts
import { installAgentErrorReporter, logApiCall, logConsoleEntry, snapshotDom } from 'vite-plugin-agent-eyes/client'

installAgentErrorReporter()  // 捕获 window error / unhandledrejection / 全控制台 / DOM 快照

// 在你的 fetch / ky / axios 拦截器里，请求结束后：
logApiCall({ method, path, url, ok, duration_ms, code, status, request: reqBody, response: resBody })

// 手动记录控制台
logConsoleEntry('warn', ['deprecated API called'])

// 手动抓 DOM 快照
snapshotDom()
```
:::

## 第 3 步：启动 dev server

```bash
pnpm dev
# 或 npm run dev
```

## 第 4 步：验证日志在写

打开浏览器访问你的页面，随便触发一个 API 请求（登录、刷新列表都行）。然后在项目根目录看：

```bash
# log 目录会按 dev server 端口分子目录，比如 5173
ls log/
# 输出类似：5173/  instances.json  README.md

# 看刚才那次请求有没有被记录
head log/5173/api-calls.log
```

你应该看到类似这样的内容（最新记录在文件**最上方**）：

```
[2026-07-03 10:30:12] [api][ok] GET /api/user 120ms code=0
[2026-07-03 10:30:10] [nav] /login → /dashboard
```

::: tip 没看到日志？
- 确认 `log/<port>/` 目录存在（端口对不对，看 `log/instances.json`）
- 确认客户端入口真的执行了 `autoInstrument()`（在它后面加一句 `console.log('agent-eyes ready')` 看控制台有没有）
- 确认请求确实经过了 Vite 代理（请求 URL 是 `/api/...` 而不是绝对地址）
:::

## 跑通后，下一步看什么

- 想知道每个日志文件干嘛的 → [日志总览](./logs)
- 登录成功却一直 401 → [招牌案例](./case-401)
- 想加提交前检查 → [Human Guard](./guard)
- 想看所有可配选项 → [API 参考](../api/agent-debugger)
