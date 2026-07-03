# agentGit()

### `agentGit(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `guard` | — | `AgentGuardOptions` 或 `false`；配置后在自定义 `precommit` 命令前执行 staged 风险检查 |
| `precommit` | `[]` | 提交前依次执行的命令，任一非零退出即阻断提交 |
| `webhook` | — | `{ url, format }`；`format` 为 `'feishu'` 或 `(info: CommitInfo) => payload` |
| `projectLabel` | 仓库名 | 通知里显示的项目名 |
| `enabled` | `true` | 总开关 |
| `force` | `false` | 覆盖已有的、非本插件管理的钩子 |
| `claimHooksPath` | `false` | 全局 `core.hooksPath` 遮蔽本仓库钩子时，自动设本地覆盖让其生效 |

> dev 启动时幂等安装 `pre-commit` / `post-commit` 到本仓库 hooks 目录（绝不写全局 hooks 目录）。`CommitInfo` 字段：`project / repo / author / branch / message / hash / timestamp`。
