# agentDebugger()

**服务端 Vite 插件，整个插件的必需核心入口。** 它在 dev server 上挂一个接收端点，把前端 `autoInstrument()` / 手动埋点上报的运行时信号（API、错误、控制台、交互、登录态）结构化落盘到 `log/<port>/`，供 agent 不读代码就能定位问题。

## 最小示例

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { agentDebugger } from 'vite-plugin-agent-eyes'  // 必需

export default defineConfig({
  plugins: [agentDebugger()],  // 必需：一行挂上日志收集器
  // agentDebugger({ screenshots: true })  // 可选：开启错误截图，需配合 CDP Chrome
})
```

挂上这一行后，前端再调用 `autoInstrument()`，运行时日志就会出现在 `log/<port>/`（每次启动清空，最新在最上）。

## 何时用

任何想用 `vite-plugin-agent-eyes` 的项目都要挂这个插件。它是日志收集器：客户端的 `autoInstrument()`（自动埋点）和 `logApiCall` / `logConsoleEntry` / `recordLoginSuccess` 等（手动埋点）所有上报，都通过它写入磁盘。不挂它，客户端函数的上报会发到不存在的端点，什么日志都不会产生。

它还负责启动期的配置诊断：`endpoint` 没以 `/` 开头、`flushMs` / `maxBytes` 过小都会在 dev server 启动时提示。

## 签名

### `agentDebugger(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `logDir` | `'log'` | 日志目录（相对项目根） |
| `endpoint` | `'/dev/log'` | 接收前端上报的端点 |
| `flushMs` | `200` | 落盘节流间隔（ms），高频上报只批写 |
| `maxBytes` | `524288` | 单日志文件大小上限（字节），超过截断旧记录 |
| `screenshots` | `false` | 错误时自动截图（通过 CDP） |

## 注意

- **截图需配合 CDP Chrome**：`screenshots: true` 后，错误会通过 Chrome DevTools Protocol 截图存入 `log/<port>/snapshots/`。需要用 `--remote-debugging-port=9222` 启动 Chrome，插件会自动检测 9222–9232 端口；找不到则静默跳过，不影响其余日志。DOM 快照不需要 CDP，始终启用。详见 [../guide/snapshots](../guide/snapshots)。
- **落盘有节流**：`flushMs` 默认 200ms，高频上报会批写，避免每个请求都打一次磁盘。

## 下一步

- [../guide/quickstart](../guide/quickstart) — 从零接入：装插件 + 一行埋点 + 看到第一条日志
- [../guide/logs](../guide/logs) — 各日志文件内容、何时看、怎么读
- [./auto-instrument](./auto-instrument) — 配套的客户端自动埋点函数
