# agentSizeWatch()

### `agentSizeWatch(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `enabled` | `true` | 是否启用 dev 期看门狗 |
| `warn` | `400` | 通用源码行数警告阈值 |
| `cssWarn` | `300` | CSS/SCSS/Sass/Less 行数警告阈值（更严） |
| `include` | 常见源码 + 样式扩展名 | 纳入扫描的文件正则 |
| `exclude` | 见上文 | 排除路径正则 |

> 仅 `apply: 'serve'`，启动全量扫描 + 热更新增量检查，超阈值在控制台 `[agent-eyes:size]` warn；只警告不阻断，不影响 build。
