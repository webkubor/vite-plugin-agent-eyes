# agentProxy()

**服务端函数，Vite `server.proxy` 的包装器。可选**——只在你的 dev 环境用 Vite proxy 转发后端 API，且关心 cookie / 鉴权问题时才需要。它在转发请求的同时，把代理层的 `Cookie` / `Set-Cookie` / status 落盘，并默认修复本地 http 下的 cookie 存取问题。

## 最小示例

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'  // agentDebugger 必需

export default defineConfig({
  plugins: [agentDebugger()],  // 必需：agentProxy 的日志靠它落盘
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'),  // 必需：target + 本地 cookie 修复
    },
  },
})
```

挂上后，代理层日志写入 `log/<port>/proxy-<host>.log`，能看到 `fetch` 看不见的 `Set-Cookie` 属性和真实的 cookie 携带情况。

## 何时用

当你的 dev 环境用 Vite proxy 转发后端 API，且遇到了 **cookie / 鉴权问题**——最典型的是「登录接口明明返回成功，下个请求却 401」。根因常是后端下发的 cookie 带了父域 `Domain` + `Secure` + `SameSite=None`，浏览器在 `http://localhost` 上直接拒收，于是后续请求不带 cookie。

`agentProxy` 默认在本地把这些属性改成可存（去 `Domain`、剥 `Secure`、`SameSite=None → Lax`），让 dev 环境也能正常带 cookie。测试/生产 https 同域不受影响。完整排查路径见 [../guide/case-401](../guide/case-401)。

## 签名

### `agentProxy(target, options?): ProxyOptions`

| 选项 | 默认 | 说明 |
|------|------|------|
| `rewriteCookiesForLocalhost` | `true` | 本地 http 上把上游 cookie 改成可存 |
| `logDir` | `'log'` | 日志目录 |
| `flushMs` | `200` | 落盘节流间隔（ms） |
| `maxBytes` | `524288` | 单文件大小上限（字节） |
| `extra` | — | 透传给 vite `ProxyOptions` 的额外字段 |

## 注意

- **默认就修 cookie**：`rewriteCookiesForLocalhost: true` 开箱自动修复本地 cookie 存取，无需额外配置。确认不需要时才显式传 `false` 关掉。
- **多代理按 host 分文件**：配多个代理时，各自按 target host 分文件（`proxy-api.example.com.log`、`proxy-admin.example.com.log`），互不覆盖。

## 下一步

- [../guide/case-401](../guide/case-401) — 「登录成功却 401」招牌案例的完整排查路径
- [./agent-debugger](./agent-debugger) — 必需的服务端日志收集器
- [../guide/logs](../guide/logs) — 各日志文件内容、何时看、怎么读
