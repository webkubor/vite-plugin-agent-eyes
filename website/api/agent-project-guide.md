# agentProjectGuide()

**本地开发项目结构体检。** dev 启动时扫描 Vite 前端项目的基础结构，写出 `log/project-guide.json`，并在控制台提示缺失层级。

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
| alias | 检查 Vite config 和 tsconfig/jsconfig 里的 `@/*` |

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
  "suggestions": []
}
```

## 在 agentEyes 中关闭

```ts
agentEyes({
  projectGuide: false,
})
```
