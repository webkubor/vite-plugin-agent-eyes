# vite-plugin-agent-eyes

> **给 AI agent 的自愈遥测层。** 不是给人看的 dev 日志——是让 agent 在不看代码的前提下，自己读日志、定位、修复、验证的闭环燃料。

## 为什么

未来代码大多由 AI 写，但二次调试和 bug 校验常常无人读代码。agent 缺的是「运行时视野」：

- fetch 看不到 `Set-Cookie` / `Cookie` / 重定向 / CORS——**网络层盲区**。
- 控制台错误转瞬即逝，且混着扩展噪声——**没有可追溯、可分类的错误流**。
- 接口返回的真实字段常和类型定义不一致——**只能猜**。

本插件把这些落成 **3 类结构化、可解析、每次启动清空、最新在最上** 的日志，agent `head` 一下就知道刚发生了什么。

## 安装

```bash
pnpm add -D vite-plugin-agent-eyes
```

## 用法

### 1. 服务端（vite.config.ts）

```ts
import { defineConfig } from 'vite'
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentDebugger()],            // 产生 log/api-calls.log、log/errors.log、log/README.md
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'),  // 产生 log/proxy.log + 本地 cookie 修复
    },
  },
})
```

### 2. 客户端（应用入口 main.tsx）

```ts
import { installAgentErrorReporter } from 'vite-plugin-agent-eyes/client'
installAgentErrorReporter()   // 捕获 window error / unhandledrejection / console.error
```

### 3. HTTP 层拦截器里记录 API 调用

```ts
import { logApiCall } from 'vite-plugin-agent-eyes/client'

// 在你的 fetch/ky/axios 包装里，请求结束后：
logApiCall({
  method, path, url, ok, duration_ms,
  code, status, request_id, error, request: reqBody, response: resBody,
})
```

## 三类日志（写进 `log/`，`*.log` 不入库）

| 文件 | 内容 | 何时看 |
|------|------|--------|
| **api-calls.log** | 全部 API（成功+失败）+ 路由，带请求/响应体 | 查接口契约、定字段、调用顺序 |
| **errors.log** | API 失败 + 前端运行时错误 | 只看"哪坏了" |
| **proxy.log** | 代理层 Cookie / Set-Cookie 属性 / status | 网络/鉴权层（fetch 看不到） |

`log/README.md` 是给 agent 的自描述入口（启动时自动生成）。

## 招牌案例：登录成功却一直 401

`agentProxy` 默认在本地 `http://localhost` 把上游 Set-Cookie **去 Domain（变 host-only）、剥 Secure、SameSite=None→Lax**——解决「后端 cookie 是父域 + Secure + SameSite=None，浏览器在 http 上拒收 → 登录成功却下个请求不带 cookie → 401」这一经典 dev 坑。测试/生产 https 同域不受影响。要关掉：`agentProxy(target, { rewriteCookiesForLocalhost: false })`。

## License

MIT
