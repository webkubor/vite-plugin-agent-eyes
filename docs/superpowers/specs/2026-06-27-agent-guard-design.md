# agentGuard 提交前风险门禁设计

日期：2026-06-27
项目：vite-plugin-agent-eyes

## 背景

`vite-plugin-agent-eyes` 当前主要解决事后排查：运行时 API、错误、控制台、代理层 cookie、DOM 和截图日志帮助 agent 定位问题。

下一步需要补上事前防线：人在控制台提交代码时，提前发现明显错误、敏感信息、超大文件和屎山信号。目标不是替代 CI，而是在 `git commit` 的最近一步给人和 agent 一个可执行、可追溯的质量门禁。

## 目标

- 新增 `agentGuard()`，负责提交前风险检查、严重度判定和报告输出。
- 让 `agentGit()` 可以复用 guard，把 hook/webhook 与质量门禁解耦。
- 支持两个基础等级：
  - `warn`：只报告，不阻断提交。
  - `block`：红线阻断，屎山指标只警告。
- 预留 `strict`：更激进的团队质量门禁，复杂度和屎山指标也可阻断。
- 第一版只检查 staged files，避免全仓扫描拖慢提交。

## 非目标

- 第一版不做全仓循环依赖分析。
- 第一版不做重复代码检测。
- 第一版不做 AST 级复杂度分析。
- 第一版不接管 CI，也不替代项目自有 lint/typecheck/test。
- 第一版不自动修复代码，只给报告和阻断结果。

## 推荐 API

```ts
import { agentGit, agentGuard } from 'vite-plugin-agent-eyes'

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
    agentGit({
      guard: {
        level: 'block',
        checks: ['secrets', 'largeFiles', 'fileLength', 'todo', 'noAny', 'noConsoleLog'],
      },
      precommit: ['pnpm typecheck', 'pnpm lint'],
      webhook: [],
    }),
  ],
})
```

`agentGuard()` 是独立插件，后续可以单独使用。`agentGit({ guard })` 是便捷组合，安装 hook 时把 guard 脚本写入 `pre-commit`。

## 等级语义

| level | 提交行为 | 适用场景 |
| --- | --- | --- |
| `warn` | 所有检查只报告，不阻断 | 老项目接入、先观察噪声 |
| `block` | 红线阻断，屎山指标警告 | 默认推荐，日常提交 |
| `strict` | 红线和质量指标都可阻断 | 新项目、核心仓库、发布前 |

默认值建议为 `block`。

## 第一版检查项

| 检查项 | 默认等级 | 说明 |
| --- | --- | --- |
| `secrets` | block | 检测 staged diff 里的 token、secret、private key、webhook URL 等高风险文本 |
| `largeFiles` | block | 检测新增或修改的超大文件，默认 block 阈值 1 MB |
| `fileLength` | warn | 检测 staged 文件当前行数，默认 warn 400 行，block 800 行 |
| `todo` | warn | 检测新增 TODO/FIXME/HACK |
| `noAny` | warn | 检测新增 TypeScript `any` |
| `noConsoleLog` | warn | 检测前端源码新增 `console.log` |
| `customCommands` | block | `agentGit.precommit` 中用户配置的命令，非零退出即阻断 |

所有检查只基于 staged files 和 staged diff，避免把未暂存或无关文件混入判断。

## 组件设计

### `src/guard.ts`

新增 guard 核心模块，导出：

- `agentGuard(options): Plugin`
- `runGuard(options, cwd): GuardResult`
- `createGuardHookScript(options): string`
- `normalizeGuardConfig(options): GuardConfig`

`runGuard` 保持纯逻辑入口，方便以后写单元测试。Vite 插件只负责在 dev 启动时安装 hook。

### `src/git.ts`

保留 hook/webhook 职责，新增 `guard?: AgentGuardOptions | false`。

`agentGit()` 安装 `pre-commit` 时按顺序执行：

1. guard 脚本。
2. 用户配置的 `precommit` 命令。

如果两者都没有配置，则不写 `pre-commit`。

### Hook 脚本

生成自包含 Node ESM 脚本，放在 `.git/hooks/agent-eyes-guard.mjs`。

`pre-commit` 只调用：

```sh
node ".git/hooks/agent-eyes-guard.mjs" || exit 1
```

脚本不依赖 dev server 运行。

## 数据流

1. 用户运行 `vite dev`。
2. `agentGuard()` 或 `agentGit({ guard })` 安装/更新 git hook。
3. 用户执行 `git commit`。
4. hook 读取 staged files：
   - `git diff --cached --name-only --diff-filter=ACMR`
   - `git diff --cached --unified=0`
   - `git show :path` 读取 staged 版本内容
5. guard 执行检查，生成 `GuardResult`。
6. 控制台打印人类可读报告。
7. 写入 `log/guard-report.json`，供 agent 读取。
8. 如果存在 block 级问题，hook exit 1；否则 exit 0。

## 报告格式

控制台报告示例：

```text
[agent-eyes:guard] 发现 2 个阻断项，3 个警告

BLOCK secrets
  src/api/client.ts:12  疑似 hardcoded token

BLOCK largeFiles
  public/demo.mov  4.2 MB exceeds 1 MB

WARN fileLength
  src/pages/Dashboard.tsx  612 lines, warn threshold 400
```

JSON 报告示例：

```json
{
  "level": "block",
  "passed": false,
  "summary": { "block": 2, "warn": 3 },
  "items": [
    {
      "check": "secrets",
      "severity": "block",
      "file": "src/api/client.ts",
      "line": 12,
      "message": "疑似 hardcoded token"
    }
  ]
}
```

## 错误处理

- Git 命令失败：输出明确错误并阻断提交，避免静默放行。
- 非 git 仓库：Vite dev 阶段告警，不安装 hook。
- 找不到 Node：hook 输出 `node is required for agent-eyes guard` 并阻断。
- 报告写入失败：不影响检查结果，但控制台提示报告未落盘。
- 检查器自身异常：按 block 处理，并显示具体检查项和错误信息。

## 测试计划

- `pnpm exec tsc --noEmit`
- `pnpm exec tsup src/index.ts src/client.ts --format esm --dts --clean --out-dir /tmp/vite-plugin-agent-eyes-build`
- 手工创建临时 git 仓库验证：
  - `warn` 模式下有风险仍能提交。
  - `block` 模式下 secret/large file 阻断提交。
  - staged-only：未暂存风险不影响提交。
  - `agentGit({ guard, precommit })` 顺序为 guard 先、precommit 后。
  - 已存在非 managed hook 时默认不覆盖。

## 后续版本

- 循环依赖检查。
- 重复代码检测。
- AST 级复杂度和函数长度检查。
- 与 `log/<port>/` 运行时日志建立关联，把提交风险和后续错误串起来。
- 支持项目级预设，例如 `preset: 'legacy' | 'default' | 'strict'`。
