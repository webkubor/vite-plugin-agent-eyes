# agentEyes()

**推荐的一站式本地开发入口。** 在 `vite.config.ts` 里挂一次，默认打开运行时日志、客户端自动埋点、项目结构体检、dev 超长文件提醒和提交 guard。

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
  telemetry: { screenshots: true },
  client: { interactions: true },
  projectGuide: { alias: '@' },
  sizeWatch: { warn: 400, cssWarn: 300 },
  guard: { level: 'block' },
  git: {
    precommit: ['pnpm typecheck'],
  },
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
  agentDebugger(),
  // 自动注入 autoInstrument()
  agentProjectGuide(),
  agentSizeWatch(),
  agentGit({ guard: { level: 'block' } }),
]
```

需要自定义 webhook、precommit 命令或已有 hook 策略时，可以关掉默认 `git` 后手动挂 `agentGit()`。
