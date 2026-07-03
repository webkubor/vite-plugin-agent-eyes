# autoInstrument()

**客户端函数，推荐的一行自动埋点用法。** 在你的应用入口文件调用一次，自动包装 `fetch` / `XMLHttpRequest` / 路由导航 / 全局错误 / 全控制台 / DOM 快照 / 脱敏交互轨迹，把所有运行时信号上报给 `agentDebugger()` 落盘。

## 最小示例

```ts
// 你的应用入口（如 main.ts / main.tsx / main.js）
import { autoInstrument } from 'vite-plugin-agent-eyes/client'  // 必需
autoInstrument()  // 必需：一行挂上全部自动埋点
// autoInstrument({ interactions: false })  // 可选：关掉某个信号
```

前提是服务端已挂 `agentDebugger()`，否则上报无接收方。日志落在 `log/<port>/`。

## 何时用

99% 的场景用这一行就够了。它覆盖了运行时调试需要的全部信号源，开箱即用、各子项可独立开关。

只有需要**精细控制**时才退回手动函数——例如只想埋某一个 API、想完全关掉某一类信号、或要在自定义拦截器里记录。手动函数见 [./client-functions](./client-functions)。

## 示例

```ts
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()
```

## 选项

`autoInstrument(opts?)` 支持以下选项：

| 选项 | 默认 | 说明 |
|------|------|------|
| `logBody` | `true` | 是否记录请求/响应体 |
| `raw` | `false` | 是否放行敏感字段（默认脱敏） |
| `nav` | `true` | 是否记录路由导航 |
| `errors` | `true` | 是否捕获全局错误 |
| `interactions` | `true` | 是否记录脱敏交互轨迹 |
| `endpoint` | — | 接收前端上报的端点 |

## 注意

- **幂等设计**：重复调用不会重复包装。React StrictMode 双执行、Vite HMR 热更新都不会造成重复拦截或日志翻倍。
- **返回卸载函数**：`const unload = autoInstrument()` 会返回一个函数，调用即还原所有 hook。在单测里可用于测试隔离，避免上一个用例的拦截器污染下一个。

## 下一步

- [../guide/quickstart](../guide/quickstart) — 从零接入：装插件 + 一行埋点 + 看到第一条日志
- [./client-functions](./client-functions) — 需要精细控制时的手动埋点函数清单
- [./agent-debugger](./agent-debugger) — 配套的服务端日志收集器
