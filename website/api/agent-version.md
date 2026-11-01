# agentVersion()

**构建期版本戳记（只读）。** 把 `package.json` 版本、最新 git tag、短 commit 和构建时间注入全局常量，并在 dev 暴露 `/__version`，方便 agent 和运维直接核对当前跑的是哪一版。

`agentEyes()` 默认已经包含它；只在需要单独控制时直接使用。

## 最小示例

```ts
import { defineConfig } from 'vite'
import { agentVersion } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentVersion()],
})
```

## 注入的全局常量

| 常量 | 内容 |
|---|---|
| `__APP_VERSION__` | `package.json` 的 `version` |
| `__BUILD_TAG__` | `git describe --tags --abbrev=0` |
| `__BUILD_COMMIT__` | `git rev-parse --short HEAD` |
| `__BUILD_TIME__` | 构建时间（ISO） |

在 `*.d.ts` 里声明即可获得类型：

```ts
declare const __APP_VERSION__: string
declare const __BUILD_TAG__: string
declare const __BUILD_COMMIT__: string
declare const __BUILD_TIME__: string
```

## dev 接口

```bash
curl http://localhost:5173/__version
# {"version":"1.4.2","tag":"v1.4.0","commit":"fa0bf32","buildTime":"2026-11-01T..."}
```

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `root` | Vite root | 读取 `package.json` 的根目录；默认跟随 Vite 解析结果，子目录启动不会读错 |
| `override` | `false` | 项目已自行定义同名常量时是否覆盖；默认保留项目自己的定义 |

## 关闭

```ts
agentEyes({
  version: false,
})
```
