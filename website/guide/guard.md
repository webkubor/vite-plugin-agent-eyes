# Human Guard

## 什么时候用这个

当 AI agent 或人**在 `git commit` 前**想拦住低级错误时——密钥泄露、超大文件、屎山代码信号（超长文件、新增 `any`、新埋 `console.log`、遗留 TODO）。这是提交前的**最后一道防线**，只检查 **staged files**，不扫整个仓库。

适合：

- AI 写完代码直接 `git commit`，你想在它把密钥、token、webhook URL 提交进仓库之前拦下来。
- 团队/个人想给 `git commit` 加一道低成本门禁，挡住明显风险，但不想配一整套 CI / husky / lefthook。
- 想留一份**机器可读**的报告（`log/guard-report.json`），让 agent 事后排查"为什么这次提交被拦了"。

**什么时候不需要**：个人实验项目、不在乎代码质量信号；或者你已经有更重的 CI 流水线做了同样的事（避免重复噪音）。

> ⚠️ **重要：别和 `agentGit()` 重复挂。** 如果已用 `agentGit()`，把 guard 配进 `agentGit({ guard })`，**不要**同时再挂 `agentGuard()`，否则两个插件争用同一个 `pre-commit` 钩子。详见下文。

## 最小可用示例

### 1. 独立使用（没有用 agentGit 时）

```ts
// vite.config.ts —— 最小可用：用默认等级 + 默认检查项
import { agentGuard } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentGuard(),  // ← 默认 level: 'block'，默认全部检查项，开箱即用
  ],
})
```

想细调等级和检查项时再用完整配置（见下方）。

### 2. 已经在用 agentGit 时（推荐这种，二选一）

```ts
import { agentGit } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentGit({
      guard: { level: 'block' },   // ← 把 guard 配进 agentGit，不要另挂 agentGuard()
      precommit: ['pnpm typecheck', 'pnpm lint'],
      // webhook: { ... },
    }),
  ],
})
```

## 完整配置说明

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

## 配了之后会发生什么

每次 `git commit` 时：

1. **控制台打印一份报告**：列出本轮 staged files 触发了哪些检查项，是警告还是阻断。
2. **写入** `log/guard-report.json`：同一份报告的机器可读 JSON 版，给 agent 事后排查用。
3. **被 `block` 的提交会非零退出**——`git commit` 中止，提交不会成功；`warn` 级别只报告、不阻断。

**怎么验证你配对了**：

1. 故意 stage 一个会触发红线的改动，比如在一个文件里写一行假的 token（如 `const API_KEY = 'sk-...'`），`git add` 后 `git commit`。
2. 控制台应看到 secrets 检查命中、提交被阻断、`git commit` 非零退出。
3. 打开 `log/guard-report.json`，应能看到这次检查的完整 JSON 报告。
4. 想观察但不阻断，可先把 `level` 设成 `'warn'`，跑几天确认噪声水平后再升到 `'block'`。

> 💡 **与运行时日志区分**：guard 报告（`log/guard-report.json`，在 `log/` 顶层）和运行时日志（`log/<port>/`，按端口分）是两套独立文件，别搞混。

## 下一步

- [Size Watch](./size-watch.md) —— guard 是"提交时拦超长文件"，size-watch 是"写代码当下就 warn"，更早一步。
- [Git 工作流](./git-workflow.md) —— `agentGit()` 的 precommit / webhook / guard 如何组合（插件搭配的最佳实践）。
- [API: agentGuard](../api/agent-guard.md) —— `level` / `checks` / `reportFile` 全部选项参考。
