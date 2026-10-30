# agentProjectGuide()

**本地开发项目体检。** dev 启动及相关文件保存后扫描 Vite 前端项目的结构、配置、环境变量、scripts 和 agent 指令文档，写出 `log/project-guide.json`，并在控制台提示建议。只警告，不阻断构建；不会输出环境变量值或硬编码 URL 内容。

`agentEyes()` 默认已经包含它；只有想单独使用或自定义规则时，才需要直接配置。

## 检查内容

| 检查项 | 说明 |
|---|---|
| 项目类型 | 根据依赖识别 React / Vue / Svelte / Solid / Astro / Vite |
| 源码目录 | 默认识别 `src/` 或 `app/` |
| API 层 | `api` / `services` / `request` / `http` 等目录 |
| 业务层 | `features` / `modules` / `domain` / `stores` 等目录 |
| 路由层 | `router` / `routes` / `pages` / `views` 等目录 |
| 配置层 | `config` / `constants` / `env` 等目录 |
| alias | 检查 Vite 运行时已解析的 alias 与 tsconfig/jsconfig 的 `@/*` |
| 配置与环境 | 核对当前 `mode` / `envDir` / `envPrefix`、客户端 `import.meta.env`、`process.env` 和 `define`；提示缺失键、前缀不匹配及配置文件中尚未加载的 `.env` 键 |
| scripts 与硬编码 | 核对直接运行的 Vite scripts 的 `--mode` 和孤立 `.env.<mode>`；对 API 请求地址和代理目标中的固定 URL 发出启发式提醒 |
| agent 指令文档 | 扫描 `AGENT.md`、`AGENTS.md`、`CLAUDE.md`、`GEMINI.md`，默认达到 200 行或 16 KiB 预警 |

## 单独使用

```ts
import { defineConfig } from 'vite'
import { agentProjectGuide } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentProjectGuide({
      alias: '@',
    }),
  ],
})
```

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 是否启用 |
| `logDir` | `'log'` | 报告输出目录 |
| `sourceDir` | 自动识别 `src` / `app` | 指定源码目录 |
| `alias` | `'@'` | 推荐检查的快捷 alias |
| `warn` | `true` | 是否在 dev 控制台输出建议摘要 |
| `configuration` | `{}` | 配置体检选项：`sourceDir`、`mode`、`envDir`、`envPrefix`、`maxFiles`、`maxFileSize`；设为 `false` 关闭；启动时使用 Vite 最终配置优先于静态选项 |
| `instructions` | `{ warnLines: 200, warnBytes: 16384 }` | 指令文档体积阈值；设为 `false` 关闭 |

## 报告示例

```json
{
  "projectType": "Vue",
  "sourceDir": "src",
  "detected": {
    "frameworks": ["Vue"],
    "packageManager": "pnpm",
    "viteConfig": "vite.config.ts",
    "tsConfig": "tsconfig.json",
    "alias": true,
    "apiLayer": ["src/api"],
    "businessLayer": ["src/features"],
    "routeLayer": ["src/router"],
    "configLayer": ["src/config"]
  },
  "configuration": {
    "mode": "development",
    "envDir": ".",
    "envPrefix": ["VITE_"],
    "scannedFiles": 12,
    "truncated": false,
    "issues": [{ "code": "ENV_MISSING", "file": "src/api.ts", "line": 8, "message": "当前模式未提供环境变量 VITE_API_URL，请检查 mode、envDir 与启动环境。" }]
  },
  "instructions": {
    "documents": [{ "file": "AGENTS.md", "lines": 45, "bytes": 650, "oversized": false }],
    "warnings": []
  },
  "suggestions": ["src/api.ts:8 [ENV_MISSING] 当前模式未提供环境变量 VITE_API_URL，请检查 mode、envDir 与启动环境。"]
}
```

环境诊断以 Vite 当前解析快照为准；修改 `.env*` 后会提示重启 dev server，重启后按新配置生成报告。诊断结果是静态启发式建议，不执行项目脚本。超过扫描文件数或单文件大小时，`truncated: true` 与 `SCAN_INCOMPLETE` 明示未覆盖范围。环境文件仅按 Vite 的加载规则读取；报告不包含环境变量值和硬编码 URL。单独使用可调用 `inspectConfiguration(root, options)` / `inspectInstructions(root, options)`。

## 在 agentEyes 中关闭

```ts
agentEyes({
  projectGuide: false,
})
```
