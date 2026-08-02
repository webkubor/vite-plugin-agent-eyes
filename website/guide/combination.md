# 插件怎么搭配

这个包里有一个推荐入口 `agentEyes()`，以及一组底层插件函数。普通项目优先用 `agentEyes()`，需要精细控制时再拆开组合。

## 默认入口

| 入口 | 类型 | 默认打开什么 |
|---|---|---|
| `agentEyes()` | 服务端 | 运行时日志 + 客户端自动埋点 + 项目结构体检 + dev 超长文件提醒 + 提交 guard |

`agentEyes()` 只在 `vite dev` 生效，并会自动向 HTML 注入 `autoInstrument()`，同时写出 `log/project-guide.json` 供 agent 规划 API/业务/路由/配置层级。没有特殊需求时，这就是唯一需要记住的入口。

```ts
import { defineConfig } from 'vite'
import { agentEyes } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [...agentEyes()],
})
```

## 底层能力一览

| 插件/函数 | 类型 | 职责 | 何时单独用 |
|---|---|---|---|
| `agentDebugger()` | 服务端 | 收前端上报的日志并落盘 | **核心，必需** |
| `agentProxy()` | 服务端 | 包装 Vite proxy，记录 cookie + 修复本地 cookie | 有后端代理时用 |
| `autoInstrument()` | 客户端 | 一行自动埋点所有运行时信号 | 关闭自动注入后手动控制 |
| `agentGit()` | 服务端 | 提交前命令 + 提交后 webhook 通知 | 需要 precommit 命令或 webhook |
| `agentGuard()` | 服务端 | 提交前风险门禁（密钥/大文件/屎山信号） | 不用 agentGit 时单独装 guard |
| `agentSizeWatch()` | 服务端 | dev 期文件超长实时警告 | 自定义阈值或单独使用 |

::: tip 服务端 vs 客户端
服务端插件（`agentEyes`/`agentDebugger`/`agentProxy`/`agentGit`/`agentGuard`/`agentSizeWatch`）配在 `vite.config.ts` 的 `plugins` 里。用了 `agentEyes()` 时客户端埋点会自动注入；只有关闭自动注入后，才需要在应用入口手动调用 `autoInstrument()`。
:::

## 三个推荐组合

### 组合 1：默认全开（推荐）

适合：多数本地开发项目，尤其是 AI agent 会参与调试和提交。

```ts
import { defineConfig } from 'vite'
import { agentEyes, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [...agentEyes()],
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'),
    },
  },
})
```

### 组合 2：只想看运行时日志

适合：先试试这东西有没有用、或者项目还没到要门禁的阶段。

```ts
// vite.config.ts
import { agentEyes } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [...agentEyes({ sizeWatch: false, git: false })],
})
```

跑起来你就有完整的 API/错误/控制台/交互日志了。

### 组合 3：完整观测 + 自定义提交命令

适合：日常开发 + AI agent 协作，想在 commit 前拦低级错误。

```ts
// vite.config.ts
import { agentEyes, agentProxy, agentGit } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    ...agentEyes({ git: false }),
    agentGit({
      guard: { level: 'block' },  // 提交前风险门禁（直接配进 agentGit，别再单独挂 agentGuard）
      precommit: ['pnpm typecheck', 'pnpm lint'],
      webhook: { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx', format: 'feishu' },
    }),
  ],
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'),
    },
  },
})
```

## 最容易踩的坑：别同时挂两个 guard

::: danger 重要
如果你已经在用 `agentGit()`，把 guard 配进 `agentGit({ guard })` 就行，**不要**再单独挂 `agentGuard()`。两个插件会争用同一个 `pre-commit` hook，行为不可预测。
:::

❌ 错误：

```ts
plugins: [
  agentGit({ /* ... */ }),
  agentGuard({ level: 'block' }),  // ← 别这样
]
```

✅ 正确（二选一）：

```ts
// 方式 A：guard 配进 agentGit
agentGit({ guard: { level: 'block' }, /* ... */ })

// 方式 B：单独用 agentGuard（不用 agentGit 时）
agentGuard({ level: 'block' })
```

## guard vs size-watch：什么时候用哪个

这俩都管"文件质量"，但时机不同，可以同时用：

| | `agentGuard` | `agentSizeWatch` |
|---|---|---|
| 何时触发 | `git commit` 时 | dev 期每次保存 |
| 检查范围 | staged 文件（含密钥/大文件/屎山信号） | 改动的源文件（只看行数） |
| 行为 | 可阻断提交 | 只 warn，不阻断 |
| 配合 | 提交前最后一道防线 | 写代码当下早期预警 |

典型搭配：size-watch 在你写代码时实时提醒"这个文件超长了"，guard 在你提交时再拦一次"这个文件确实太长了别提交"。一个早提醒，一个晚兜底。

## git hooks 会抢我已有的钩子吗

不会。`agentGit()` 只接管带 `agent-eyes managed` 标记的钩子，遇到你已有的、非本插件写的钩子默认**不覆盖**。如果你用了 lefthook 等全局 `core.hooksPath`，可以开 `claimHooksPath: true` 让本仓库钩子生效。

## 下一步

- 各插件完整参数 → [API 参考](../api/agent-debugger)
- 想跑通第一个 demo → [快速上手](./quickstart)
- 文件超长警告细节 → [Size Watch](./size-watch)
