<div align="center">

<img src="https://vitejs.dev/logo.svg" alt="Vite" width="64" height="64" />

# vite-plugin-agent-eyes

**给 AI agent 的自愈遥测层。**

不是给人看的 dev 日志——是让 agent 在不看代码的前提下，自己读日志、定位、修复、验证的闭环燃料。

[![npm version](https://img.shields.io/npm/v/vite-plugin-agent-eyes.svg?color=cb3837&label=npm)](https://www.npmjs.com/package/vite-plugin-agent-eyes)
[![npm downloads](https://img.shields.io/npm/dm/vite-plugin-agent-eyes.svg?color=cb3837)](https://www.npmjs.com/package/vite-plugin-agent-eyes)
[![release](https://img.shields.io/github/v/release/webkubor/vite-plugin-agent-eyes?color=181717&label=release)](https://github.com/webkubor/vite-plugin-agent-eyes/releases)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vite-plugin-agent-eyes?color=646cff)](https://bundlephobia.com/package/vite-plugin-agent-eyes)
[![vite](https://img.shields.io/badge/Vite-%E2%9A%A1%EF%B8%8F-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![typescript](https://img.shields.io/badge/TypeScript-ready-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![license](https://img.shields.io/npm/l/vite-plugin-agent-eyes?color=42b883)](./LICENSE)

</div>

> **框架无关**：纯 Vite 插件 + 浏览器原生 API（`fetch` / `XMLHttpRequest` / `history`）。React、Vue、Svelte、Solid、原生 JS 都能用，不依赖任何框架。

## 为什么

未来代码大多由 AI 写，但二次调试和 bug 校验常常无人读代码。agent 缺的是「运行时视野」：

- `fetch` 看不到 `Set-Cookie` / `Cookie` / 重定向 / CORS——**网络层盲区**。
- 控制台错误转瞬即逝，且混着扩展噪声——**没有可追溯、可分类的错误流**。
- 接口返回的真实字段常和类型定义不一致——**只能猜**。

本插件把这些落成 **3 类结构化、可解析、每次启动清空、最新在最上** 的日志，agent `head` 一下就知道刚发生了什么。

## 安装

```bash
pnpm add -D vite-plugin-agent-eyes
# or
npm i -D vite-plugin-agent-eyes
```

## 用法

### 1. 服务端（`vite.config.ts`）

```ts
import { defineConfig } from 'vite'
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentDebugger()],
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'),  // log/proxy-<host>.log + 本地 cookie 修复
    },
  },
})
```

### 2. 客户端（你的应用入口文件）

**推荐：一行自动埋点**（0.2.0+）——自动包装 `fetch` / `XMLHttpRequest` / 路由导航 / 全局错误，无需逐个拦截器手动埋点：

```ts
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()
```

**或手动埋点**（需要精细控制时）：

```ts
import { installAgentErrorReporter, logApiCall } from 'vite-plugin-agent-eyes/client'

installAgentErrorReporter()  // 捕获 window error / unhandledrejection / console.error

// 在你的 fetch / ky / axios 拦截器里，请求结束后：
logApiCall({ method, path, url, ok, duration_ms, code, status, request: reqBody, response: resBody })
```

## 三类日志

写进 `log/`（`*.log` 不入库），每次启动清空，**最新记录在文件最上方**，`head` 即看本次会话。

| 文件 | 内容 | 何时看 |
|------|------|--------|
| **api-calls.log** | 全部 API（成功 + 失败）+ 路由跳转，带请求/响应体 | 查接口契约、定字段、调用顺序 |
| **errors.log** | API 失败 + 前端运行时错误，**聚合去重 + 频率计数**（0.2.0） | 只看「哪坏了」、哪个刷得最凶 |
| **proxy-\<host\>.log** | 代理层 `Cookie` / `Set-Cookie` 属性 / status | 网络/鉴权层（fetch 看不到） |

`log/README.md` 是给 agent 的自描述入口（启动时自动生成）。`errors.log` 顶部是 `Top Errors`（按频率降序），省去 agent 自己数频率。

## 招牌案例：登录成功却一直 401

```
api-calls.log:         POST .../auth/login  code=0          ← 登录成功
api-calls.log:         GET  .../auth/session code=40101     ← 紧跟却未登录
proxy-api.example.com.log: GET .../auth/session → 200 | Cookie(req): 无   ← 浏览器没带 cookie
```

`agentProxy` 默认在本地 `http://localhost` 把上游 `Set-Cookie` **去 `Domain`（变 host-only）、剥 `Secure`、`SameSite=None → Lax`**——解决「后端 cookie 是父域 + Secure + SameSite=None，浏览器在 http 上拒收 → 登录成功却下个请求不带 cookie → 401」这一经典 dev 坑。

测试/生产 https 同域不受影响。要关掉：`agentProxy(target, { rewriteCookiesForLocalhost: false })`。

## API

### `agentDebugger(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `logDir` | `'log'` | 日志目录（相对项目根） |
| `endpoint` | `'/dev/log'` | 接收前端上报的端点 |
| `flushMs` | `200` | 落盘节流间隔（ms），高频上报只批写 |
| `maxBytes` | `524288` | 单日志文件大小上限（字节），超过截断旧记录 |

### `agentProxy(target, options?): ProxyOptions`

| 选项 | 默认 | 说明 |
|------|------|------|
| `rewriteCookiesForLocalhost` | `true` | 本地 http 上把上游 cookie 改成可存 |
| `logDir` | `'log'` | 日志目录 |
| `flushMs` | `200` | 落盘节流间隔（ms） |
| `maxBytes` | `524288` | 单文件大小上限（字节） |
| `extra` | — | 透传给 vite `ProxyOptions` 的额外字段 |

> 多个代理各自按 target host 分文件（`proxy-api.example.com.log`、`proxy-admin.example.com.log`），互不覆盖。

### 客户端（`vite-plugin-agent-eyes/client`）

| 函数 | 说明 |
|------|------|
| `autoInstrument(opts?)` | **一键自动埋点**：fetch + XHR + 导航 + 错误，各子项可独立开关，返回卸载函数。幂等（防 StrictMode/HMR 重复包装） |
| `installAgentErrorReporter()` | 挂全局错误捕获，返回卸载函数 |
| `logApiCall(entry)` | 在 HTTP 拦截器记录一次 API 调用（默认脱敏敏感字段，`entry.raw=true` 放行） |
| `logNav(from, to)` | 记录路由导航轨迹 |
| `logError(line)` | 记录任意自定义错误行 |

`autoInstrument` 选项：`logBody`(默认 true) / `raw`(默认 false) / `nav`(默认 true) / `errors`(默认 true) / `endpoint`。

## 更新日志

- **[CHANGELOG.md](./CHANGELOG.md)** — 完整版本历史
- **[GitHub Releases](https://github.com/webkubor/vite-plugin-agent-eyes/releases)** — 每个版本的可读发布说明

## 已知局限 & Roadmap

- **🟡 敏感脱敏仍需扩展**：`csrfToken` 等 camelCase 变体已覆盖（0.2.0），但 `ssn` / `credit_card` / `cvv` 等 PII 未纳入黑名单——按业务需要自行扩展 `redact` 或用 `raw` 控制。
- **🟡 长日志仍可能截断半行**：`maxBytes` 截断当前按字符，下个版本改为按行 + 字节精确衡量。
- **🟡 dev server 退出时未 flush**：节流窗口内最后一批 buffer 可能不落盘，下个版本挂 server `close` hook。
- **🟡 console.error 全量上报**：React dev warning 等噪声也进 errors.log，下个版本加采样/过滤。

> 欢迎在 [Issues](https://github.com/webkubor/vite-plugin-agent-eyes/issues) 反馈，或直接 PR。

## License

[MIT](./LICENSE)
