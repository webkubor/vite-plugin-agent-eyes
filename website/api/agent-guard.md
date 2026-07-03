# agentGuard()

### `agentGuard(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `level` | `'block'` | `warn` 只报告；`block` 阻断红线；`strict` 当前等同 `block`，预留更严格门禁 |
| `checks` | 全部内置检查 | 数组形式选择检查项，或对象形式细调严重度/阈值 |
| `reportFile` | `'log/guard-report.json'` | 最近一次 guard JSON 报告路径 |
