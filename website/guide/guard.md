# Human Guard

`agentGuard()` 面向人在控制台提交前的最后一道防线：只检查 staged files，提前拦住明显错误、敏感信息、超大文件和屎山信号，并写出 agent 可读报告。

```ts
import { agentGuard } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentGuard({
      level: 'block',
      checks: {
        secrets: true,
        largeFiles: true,
        fileLength: { warn: 400, block: 800 },
        todo: 'warn',
        noAny: 'warn',
        noConsoleLog: 'warn',
      },
    }),
  ],
})
```

如果已经在用 `agentGit()`，直接把 guard 配进 `agentGit({ guard })`，不要同时再挂 `agentGuard()`，避免两个插件争用 `pre-commit`：

```ts
agentGit({
  guard: {
    level: 'block',
    checks: ['secrets', 'largeFiles', 'fileLength', 'todo', 'noAny', 'noConsoleLog'],
  },
  precommit: ['pnpm typecheck', 'pnpm lint'],
  webhook: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx', format: 'feishu' },
})
```

等级语义：

| level | 提交行为 | 适用场景 |
|------|----------|----------|
| `warn` | 所有检查只报告，不阻断 | 老项目接入、先观察噪声 |
| `block` | secrets / largeFiles 等红线阻断，质量信号警告 | 默认推荐 |
| `strict` | 当前等同 `block`，预留给后续更激进的团队门禁 | 新项目、核心仓库、发布前 |

默认检查项：

| 检查项 | 默认等级 | 说明 |
|--------|----------|------|
| `secrets` | block | staged diff 中疑似 token、secret、private key、webhook URL |
| `largeFiles` | block | staged 文件超过 1 MB |
| `fileLength` | warn | staged 文件当前行数超过 400 行警告、800 行阻断 |
| `todo` | warn | 新增 TODO / FIXME / HACK |
| `noAny` | warn | TypeScript 新增显式 `any` |
| `noConsoleLog` | warn | 前端源码新增 `console.log` |

每次提交会在控制台打印报告，并写入 `log/guard-report.json`。这个文件给 agent 后续排查用；运行时日志仍在 `log/<port>/`。
