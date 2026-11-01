# agentBanner()

**dev 启动控制台横幅。** 打开控制台就能确认插件已启用，并看到当前环境、上报端点、代理清单、路径别名、版本戳记、技术栈和工程完备度。只读展示，不改任何项目文件。

`agentEyes()` 默认已经包含它；需要单独使用或自定义展示时再直接配置。

## 最小示例

```ts
import { defineConfig } from 'vite'
import { agentBanner } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentBanner()],
})
```

## 展示内容

| 行 | 来源 | 说明 |
|---|---|---|
| 环境 | `config.mode` + `.env.<mode>` | 当前模式与对应环境文件是否存在 |
| 环境文件 | 项目根 `.env*` | 标准环境（development / test / production）配了几个、缺哪个 |
| 端口 | 实际监听端口 | middleware 模式下显示 `middleware` |
| 上报 | `telemetry.endpoint` / `logDir` | 前端埋点上报到哪、落到哪个目录 |
| API | `server.proxy` | 代理路径 → 目标；账号密码自动脱敏为 `***` |
| 别名 | `resolve.alias` + tsconfig paths | 如 `@ → src`；没配时提示可复制的 `resolve.alias` 建议 |
| 版本 | `package.json` + `define.__APP_VERSION__` | 项目版本，以及版本戳记是否注入 |
| 技术栈 | `package.json` 依赖 | React / Vue / Svelte / TypeScript / Tailwind / Pinia 等，自动读取 |
| 工程 | `inspectEngineering()` | 状态管理是否安装并初始化、axios/ky 是否有统一请求封装 |

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 是否打印；`false` 关闭 |
| `endpoint` | `'/dev/log'` | 上报端点展示值 |
| `logDir` | `'log'` | 日志目录展示值 |
| `maxStack` | `6` | 技术栈最多展示几项 |
| `sourceDir` | 自动识别 `src` / `app` | 工程体检的源码目录 |

## 关闭横幅

```ts
agentEyes({
  banner: false,
})
```

`logLevel: 'silent'` 时横幅也不会打印；`NO_COLOR=1` 时自动输出无颜色文本。

## 单独渲染

需要自己写启动摘要时，可以复用纯函数：

```ts
import { collectBannerInfo, renderBanner } from 'vite-plugin-agent-eyes'

const info = collectBannerInfo(process.cwd(), { mode: 'development' })
console.log(renderBanner(info).join('\n'))
```
