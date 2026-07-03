# agentDebugger()

### `agentDebugger(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `logDir` | `'log'` | 日志目录（相对项目根） |
| `endpoint` | `'/dev/log'` | 接收前端上报的端点 |
| `flushMs` | `200` | 落盘节流间隔（ms），高频上报只批写 |
| `maxBytes` | `524288` | 单日志文件大小上限（字节），超过截断旧记录 |
| `screenshots` | `false` | 错误时自动截图（通过 CDP） |
