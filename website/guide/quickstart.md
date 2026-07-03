# 快速上手

## 1. 服务端（`vite.config.ts`）

```ts
import { defineConfig } from 'vite'
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentDebugger()],
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'),  // log/<port>/proxy-<host>.log + 本地 cookie 修复
    },
  },
})
```

## 2. 客户端（你的应用入口文件）

**推荐：一行自动埋点**（0.2.0+）——自动包装 `fetch` / `XMLHttpRequest` / 路由导航 / 全局错误 / 全控制台 / DOM 快照；0.10.0+ 默认记录 click/input/change/submit/route 脱敏交互轨迹，无需逐个拦截器手动埋点：

```ts
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()
```

**或手动埋点**（需要精细控制时）：

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
