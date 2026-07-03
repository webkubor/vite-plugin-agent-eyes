# autoInstrument()

**一键自动埋点**：fetch + XHR + 导航 + 错误 + 全控制台 + DOM 快照 + 脱敏交互轨迹，各子项可独立开关，返回卸载函数。幂等（防 StrictMode/HMR 重复包装）。

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
