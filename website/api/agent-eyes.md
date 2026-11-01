# agentEyes()

**推荐的一站式本地开发入口。** 在 `vite.config.ts` 里挂一次，默认打开运行时日志、客户端自动埋点、错误截图、项目体检、dev 超长文件提醒、版本戳记、启动横幅和提交 guard —— 全部默认开启，按需传 `false` 关闭。

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

`agentEyes()` 只在 `vite dev` 生效。它会自动向 dev HTML 注入：

```ts
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()
```

所以普通项目不需要再手动改 `main.tsx` / `main.ts`。

## 选项

```ts
agentEyes({
  telemetry: { endpoint: '/dev/log' },
  client: { interactions: true },
  projectGuide: { alias: '@' },
  sizeWatch: { warn: 400, cssWarn: 300 },
  guard: { level: 'block' },
  git: {
    precommit: ['pnpm typecheck'],
  },
  banner: true,   // 默认开启，可传 false 关闭
  version: true,  // 默认开启，可传 false 关闭
})
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `telemetry` | `{}` | 传给 `agentDebugger()`；`false` 关闭运行时日志服务端 |
| `client` | `{}` | 自动注入 `autoInstrument()`；`false` 关闭 |
| `projectGuide` | `{}` | 传给 `agentProjectGuide()`；`false` 关闭项目类型/层级/alias 体检 |
| `sizeWatch` | `{}` | 传给 `agentSizeWatch()`；`false` 关闭 dev 超长文件提醒 |
| `guard` | `{ level: 'block' }` | 默认提交 guard；`false` 关闭 |
| `git` | `{ guard }` | 传给 `agentGit()`；`false` 关闭默认 git hook |
| `agentDocs` | `true` | 把日志读法写进已有 agent 指令文件；`false` 关闭 |
| `version` | `true` | 版本 / tag / commit 戳记（`__APP_VERSION__` 等 + dev `/__version`）；`false` 关闭 |
| `banner` | `true` | dev 启动控制台横幅：环境、环境文件、上报端点、代理、别名、版本、技术栈、工程完备度；`false` 关闭 |

### 启动横幅示例

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ ✔ vite-plugin-agent-eyes 已启用 · v0.15.1                                │
│ 环境     development · .env.development                                  │
│ 环境文件 2/3 标准环境 · 缺 test                                          │
│ 端口     5202                                                            │
│ 上报     /dev/log → log/5202/                                            │
│ API      /api → https://api.example.com/v1                               │
│ 别名     @ → src                                                         │
│ 版本     1.4.2 · __APP_VERSION__ 已注入                                  │
│ 技术栈   Vue 3.5.0 · TypeScript 5.9.0 · Tailwind CSS 4.1.0 · Pinia 3.0.0 │
│ 工程     Pinia 已配置 · axios 统一封装 src/api/request.ts                │
╰──────────────────────────────────────────────────────────────────────────╯
```

技术栈自动读取项目依赖；环境文件、Pinia 与请求层状态来自 `inspectEngineering()`，缺什么会同时写进 `log/project-guide.json` 的建议。

## 只保留日志

```ts
agentEyes({
  sizeWatch: false,
  git: false,
})
```

## 手动客户端入口

如果你的项目不是标准 HTML 入口，或者你想完全控制埋点时机：

```ts
agentEyes({
  client: false,
})
```

然后在应用入口手动调用：

```ts
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()
```

## 和底层插件的关系

`agentEyes()` 等价于按默认值组合：

```ts
plugins: [
  agentDebugger(),          // 运行时日志 + 错误截图（默认开启）
  // 自动注入 autoInstrument()
  agentProjectGuide(),      // 结构 / 环境 / scripts / 指令文档 / 工程完备度
  agentSizeWatch(),
  agentGit({ guard: { level: 'block' } }),
  agentVersion(),           // 版本戳记 + /__version
  agentBanner(),            // 启动横幅
]
```

需要自定义 webhook、precommit 命令或已有 hook 策略时，可以关掉默认 `git` 后手动挂 `agentGit()`。
