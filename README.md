<div align="center">

<img src="https://vitejs.dev/logo.svg" alt="Vite" width="64" height="64" />

# vite-plugin-agent-eyes

**给 AI agent 的自愈遥测层，也给人一道提交前风险门禁。**

运行时日志让 agent 在不看代码的前提下，自己读日志、定位、修复、验证；登录态画像让 agent 快速知道当前浏览器是谁；提交前 guard 让人在 `git commit` 前先看到明显错误、敏感信息和屎山信号。

[![npm version](https://img.shields.io/npm/v/vite-plugin-agent-eyes.svg?color=cb3837&label=npm)](https://www.npmjs.com/package/vite-plugin-agent-eyes)
[![npm downloads](https://img.shields.io/npm/dm/vite-plugin-agent-eyes.svg?color=cb3837)](https://www.npmjs.com/package/vite-plugin-agent-eyes)
[![release](https://img.shields.io/github/v/release/webkubor/vite-plugin-agent-eyes?color=181717&label=release)](https://github.com/webkubor/vite-plugin-agent-eyes/releases)
[![vite](https://img.shields.io/badge/Vite-%E2%9A%A1%EF%B8%8F-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![typescript](https://img.shields.io/badge/TypeScript-ready-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![license](https://img.shields.io/npm/l/vite-plugin-agent-eyes?color=42b883)](./LICENSE)

</div>

> **框架无关**：纯 Vite 插件 + 浏览器原生 API（`fetch` / `XMLHttpRequest` / `history`）。React、Vue、Svelte、Solid、原生 JS 都能用，不依赖任何框架。

## 为什么

未来代码大多由 AI 写，但二次调试和 bug 校验常常无人读代码。agent 缺的是「运行时视野」：

- `fetch` 看不到 `Set-Cookie` / `Cookie` / 重定向 / CORS——**网络层盲区**。
- 控制台错误转瞬即逝，且混着扩展噪声——**没有可追溯、可分类的错误流**。
- 接口返回的真实字段常和类型定义不一致——**只能猜**。

本插件把这些落成 **结构化、可解析、每次启动清空、最新在最上** 的运行时日志；0.9.0 起记录脱敏登录态画像，0.10.0 起自动记录脱敏交互轨迹，方便 agent 还原 UI、控制浏览器和复现路径。

## 文档入口

- **人读**：继续看本 README，重点是安装方式、能力说明、API 和配置项。
- **agent 读**：[AGENT_GUIDE.md](./AGENT_GUIDE.md) 是可发布的 agent 操作手册；项目运行后还会生成 `log/README.md` 和 `log/<port>/README.md`，告诉 agent 当前端口该读哪些运行时日志。
- **让 agent 主动会用**：[AGENT_BOOTSTRAP.md](./AGENT_BOOTSTRAP.md) 给 Codex、Claude Code、Gemini CLI、Hermes agent 提供入口文件和可复制指令片段。
- **Codex/Claude skill**：[SKILL.md](./SKILL.md) 是给支持 skill 机制的 agent 注册和触发用的压缩入口。

## 类型提示与配置诊断

- 包内发布 `dist/*.d.ts`，`agentDebugger()`、`agentProxy()`、`autoInstrument()`、`recordLoginSuccess()`、`recordInteraction()` 等入口都有 TypeScript 类型和 hover 说明。
- `agentDebugger()` 会在 dev server 启动时提示常见配置错误，例如 `endpoint` 没有以 `/` 开头、`flushMs` / `maxBytes` 过小。
- `agentProxy()` 会在 Vite 配置加载时提示 target 非 `http(s)`、`flushMs` / `maxBytes` 过小；`extra.configure` 会保留并先执行。

## 安装

```bash
pnpm add -D vite-plugin-agent-eyes
# or
npm i -D vite-plugin-agent-eyes
```

## 用法

### 1. 服务端（`vite.config.ts`）

```ts
import { defineConfig } from 'vite'
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentDebugger()],
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'),  // log/<port>/proxy-<host>.log + 本地 cookie 修复
    },
  },
})
```

### 1.5 Git workflow：提交前命令 + 提交后 webhook（0.4.0+，可选）

让**任意 Vite 项目零配置**获得「提交前检查 + 提交后通知」——装上插件、跑一次 `vite dev`，git 钩子自动就位，无需各项目再配 husky / `.git/hooks`。

```ts
import { agentDebugger, agentGit } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentDebugger(),
    agentGit({
      precommit: ['pnpm typecheck', 'pnpm lint'],        // 任一非零退出即阻断提交
      webhook: {                                          // 单个 webhook
        url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx',
        format: 'feishu',                                 // 内置飞书；或 (info) => 自定义载荷
      },
      guard: { level: 'block' },                         // 0.8.0+：提交前检查 staged 风险
      // claimHooksPath: true,  // 若你用了全局 core.hooksPath（lefthook 等），开此项让本项目钩子生效
    }),
  ],
})
```

**多 webhook 推送**（0.7.0+）：支持同时推送到多个平台（如飞书 + 钉钉 + 企业微信）：

```ts
agentGit({
  precommit: ['pnpm typecheck', 'pnpm lint'],
  webhook: [
    {
      url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx',
      format: 'feishu',
    },
    {
      url: 'https://oapi.dingtalk.com/robot/send?access_token=yyyy',
      format: (info) => ({
        msgtype: 'text',
        text: { content: `📝 [${info.project}] ${info.author} 提交（${info.branch}）\n🕐 ${info.timestamp}\n${info.message}` }
      }),
    },
    {
      url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=zzzz',
      format: (info) => ({
        msgtype: 'text',
        text: { content: `📝 [${info.project}] ${info.author} 提交（${info.branch}）\n🕐 ${info.timestamp}\n${info.message}` }
      }),
    },
  ],
})
```

**推送信息增强**（0.7.0+）：默认推送信息包含：
- 项目名称
- 提交作者
- **分支名称**（新增）
- **提交时间**（新增，UTC 格式）
- 提交信息

- 钩子内容**自包含**，`git commit` 时独立运行，不依赖 dev server 在跑。
- 只接管带 `agent-eyes managed` 标记的钩子；遇到你已有的、非本插件写的钩子默认**不覆盖**（`force: true` 强制）。
- 自定义通知：`webhook.format` 传 `(info: CommitInfo) => payload`（纯函数，会序列化进钩子脚本），`info` 含 `project / repo / author / branch / message / hash / timestamp`。
- 仅 dev 期安装钩子（`apply: 'serve'`）；不传 `guard` / `precommit` / `webhook` 时为 no-op。
- 多 webhook 时逐个推送，单个失败不影响其他。

### 1.6 Human Guard：提交前风险门禁（0.8.0+，可选）

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

### 1.7 Size Watch：dev 期文件超长实时警告（0.12.0+，可选）

`agentGuard()` 在**提交时**才拦超长文件，`agentSizeWatch()` 则在**写代码当下**就提示——dev 启动扫一遍源文件，之后每次保存对改动文件增量检查，超阈值就在 Vite 控制台 `[agent-eyes:size]` 黄色 warn。**只 warn，不阻断、不影响 build**。专治 AI 把 CSS 越堆越长的屎山文件，早期就能看见。

```ts
import { agentSizeWatch } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentSizeWatch(), // 默认即可：通用 400 行、CSS/SCSS/Less 300 行
    // 或自定义：agentSizeWatch({ warn: 400, cssWarn: 300, exclude: /vendor/ })
  ],
})
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `enabled` | `true` | 关掉整个看门狗 |
| `warn` | `400` | 通用源码（ts/tsx/js/vue/svelte/astro…）行数警告阈值 |
| `cssWarn` | `300` | CSS/SCSS/Sass/Less 行数警告阈值（更严） |
| `include` | 常见源码 + 样式扩展名 | 纳入扫描的文件正则 |
| `exclude` | `node_modules`/`dist`/`build`/`.git`/`.astro`/`.next`/`.nuxt`/`coverage`/`log` | 排除路径正则（相对项目根匹配） |

二进制 / 超过 1 MB 的文件直接跳过。Astro 项目同理把 `agentSizeWatch()` 加进 `astro.config` 的 `vite.plugins`。

### 2. 客户端（你的应用入口文件）

**推荐：一行自动埋点**（0.2.0+）——自动包装 `fetch` / `XMLHttpRequest` / 路由导航 / 全局错误 / 全控制台 / DOM 快照；0.10.0+ 默认记录 click/input/change/submit/route 脱敏交互轨迹，无需逐个拦截器手动埋点：

```ts
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()
```

**或手动埋点**（需要精细控制时）：

```ts
import { installAgentErrorReporter, logApiCall, logConsoleEntry, snapshotDom } from 'vite-plugin-agent-eyes/client'

installAgentErrorReporter()  // 捕获 window error / unhandledrejection / 全控制台 / DOM 快照

// 在你的 fetch / ky / axios 拦截器里，请求结束后：
logApiCall({ method, path, url, ok, duration_ms, code, status, request: reqBody, response: resBody })

// 手动记录控制台
logConsoleEntry('warn', ['deprecated API called'])

// 手动抓 DOM 快照
snapshotDom()
```

**记录登录成功账户画像**（0.9.0+）：

```ts
import { recordLoginSuccess } from 'vite-plugin-agent-eyes/client'

recordLoginSuccess({
  userId: currentUser.id,
  email: currentUser.email,        // 写入前自动脱敏为 a***@example.com
  name: currentUser.name,
  roles: currentUser.roles,
  tenantId: currentUser.tenantId,
})
```

这只保存脱敏后的账户画像和登录成功信号，不保存 token、cookie、Authorization、refresh token。浏览器里会注入只读 `window.__AGENT_EYES_AUTH__`，dev server 会写入 `log/<port>/auth-state.json`。

**交互轨迹**（0.10.0+）：`autoInstrument()` 默认安装，也可手动调用：

```ts
import { installAgentInteractionTracer, recordInteraction } from 'vite-plugin-agent-eyes/client'

installAgentInteractionTracer()
recordInteraction('click', buttonElement)
```

`input` / `change` 只写 `<redacted>`，不会保存真实表单值；dev server 会写入 `log/<port>/interaction.log`，用于还原“先到哪个页面、点了哪个按钮、在哪个表单触发问题”。

## 日志与报告

运行时日志写进 `log/<port>/`（`*.log` 不入库），每次启动清空，**最新记录在文件最上方**，`head` 即看本次会话。顶层 `log/instances.json` 记录当前端口、分支、进程和启动时间。

| 文件 | 内容 | 何时看 |
|------|------|--------|
| **log/\<port\>/api-calls.log** | 全部 API（成功 + 失败）+ 路由跳转，带请求/响应体 | 查接口契约、定字段、调用顺序 |
| **log/\<port\>/errors.log** | API 失败 + 前端运行时错误，**聚合去重 + 频率计数**（0.2.0） | 只看「哪坏了」、哪个刷得最凶 |
| **log/\<port\>/console.log** | 全级别控制台输出（log/warn/error/info/debug） | React dev warning、库 deprecation、调试信息 |
| **log/\<port\>/interaction.log** | click/input/change/submit/route 脱敏交互轨迹 | 还原复现路径、定位“人或 agent 做了什么” |
| **log/\<port\>/proxy-\<host\>.log** | 代理层 `Cookie` / `Set-Cookie` 属性 / status | 网络/鉴权层（fetch 看不到） |
| **log/\<port\>/snapshots/** | 错误截图（PNG）+ DOM 快照（HTML） | 视觉+结构双重现场 |
| **log/\<port\>/auth-state.json** | 最近一次登录成功的脱敏账户画像 | 还原 UI、浏览器控制、确认当前账号 |
| **log/guard-report.json** | 提交前 guard 的最近一次 JSON 报告 | 看 commit 被阻断或预警的原因 |

`log/README.md` 是给 agent 的自描述入口（启动时自动生成）。`errors.log` 顶部是 `Top Errors`（按频率降序），省去 agent 自己数频率。

## 错误截图 + DOM 快照（0.3.0+）

开启后，每次前端错误或 API 失败自动通过 CDP 截取当前页面，存入 `log/<port>/snapshots/err-{timestamp}.png`。同时自动 dump DOM 结构为 `log/<port>/snapshots/dom-{timestamp}.html`（无需 CDP）。

```ts
// vite.config.ts
export default defineConfig({
  plugins: [
    agentDebugger({ screenshots: true }),  // 开启截图（DOM 快照始终启用）
  ],
})
```

**前置条件**：Chrome 需要带 remote debugging 启动（仅截图需要，DOM 快照不需要）：

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# 或在现有 Chrome 里打开一个新窗口
open -a "Google Chrome" --args --remote-debugging-port=9222
```

插件**自动检测** CDP 端口：先读 Chrome 进程参数，再扫描 9222-9232，找到即用。未找到时静默跳过，不影响现有日志。

## 招牌案例：登录成功却一直 401

```
log/<port>/api-calls.log:          POST .../auth/login  code=0          ← 登录成功
log/<port>/api-calls.log:          GET  .../auth/session code=40101     ← 紧跟却未登录
log/<port>/proxy-api.example.com.log: GET .../auth/session → 200 | Cookie(req): 无   ← 浏览器没带 cookie
```

`agentProxy` 默认在本地 `http://localhost` 把上游 `Set-Cookie` **去 `Domain`（变 host-only）、剥 `Secure`、`SameSite=None → Lax`**——解决「后端 cookie 是父域 + Secure + SameSite=None，浏览器在 http 上拒收 → 登录成功却下个请求不带 cookie → 401」这一经典 dev 坑。

测试/生产 https 同域不受影响。要关掉：`agentProxy(target, { rewriteCookiesForLocalhost: false })`。

## API

### `agentDebugger(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `logDir` | `'log'` | 日志目录（相对项目根） |
| `endpoint` | `'/dev/log'` | 接收前端上报的端点 |
| `flushMs` | `200` | 落盘节流间隔（ms），高频上报只批写 |
| `maxBytes` | `524288` | 单日志文件大小上限（字节），超过截断旧记录 |
| `screenshots` | `false` | 错误时自动截图（通过 CDP） |

### `agentProxy(target, options?): ProxyOptions`

| 选项 | 默认 | 说明 |
|------|------|------|
| `rewriteCookiesForLocalhost` | `true` | 本地 http 上把上游 cookie 改成可存 |
| `logDir` | `'log'` | 日志目录 |
| `flushMs` | `200` | 落盘节流间隔（ms） |
| `maxBytes` | `524288` | 单文件大小上限（字节） |
| `extra` | — | 透传给 vite `ProxyOptions` 的额外字段 |

> 多个代理各自按 target host 分文件（`proxy-api.example.com.log`、`proxy-admin.example.com.log`），互不覆盖。

### `agentGit(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `guard` | — | `AgentGuardOptions` 或 `false`；配置后在自定义 `precommit` 命令前执行 staged 风险检查 |
| `precommit` | `[]` | 提交前依次执行的命令，任一非零退出即阻断提交 |
| `webhook` | — | `{ url, format }`；`format` 为 `'feishu'` 或 `(info: CommitInfo) => payload` |
| `projectLabel` | 仓库名 | 通知里显示的项目名 |
| `enabled` | `true` | 总开关 |
| `force` | `false` | 覆盖已有的、非本插件管理的钩子 |
| `claimHooksPath` | `false` | 全局 `core.hooksPath` 遮蔽本仓库钩子时，自动设本地覆盖让其生效 |

> dev 启动时幂等安装 `pre-commit` / `post-commit` 到本仓库 hooks 目录（绝不写全局 hooks 目录）。`CommitInfo` 字段：`project / repo / author / branch / message / hash / timestamp`。

### `agentGuard(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `level` | `'block'` | `warn` 只报告；`block` 阻断红线；`strict` 当前等同 `block`，预留更严格门禁 |
| `checks` | 全部内置检查 | 数组形式选择检查项，或对象形式细调严重度/阈值 |
| `reportFile` | `'log/guard-report.json'` | 最近一次 guard JSON 报告路径 |

### `agentSizeWatch(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `enabled` | `true` | 是否启用 dev 期看门狗 |
| `warn` | `400` | 通用源码行数警告阈值 |
| `cssWarn` | `300` | CSS/SCSS/Sass/Less 行数警告阈值（更严） |
| `include` | 常见源码 + 样式扩展名 | 纳入扫描的文件正则 |
| `exclude` | 见上文 | 排除路径正则 |

> 仅 `apply: 'serve'`，启动全量扫描 + 热更新增量检查，超阈值在控制台 `[agent-eyes:size]` warn；只警告不阻断，不影响 build。

### 客户端（`vite-plugin-agent-eyes/client`）

| 函数 | 说明 |
|------|------|
| `autoInstrument(opts?)` | **一键自动埋点**：fetch + XHR + 导航 + 错误 + 全控制台 + DOM 快照 + 脱敏交互轨迹，各子项可独立开关，返回卸载函数。幂等（防 StrictMode/HMR 重复包装） |
| `installAgentErrorReporter()` | 挂全局错误捕获 + 全控制台拦截 + DOM 快照，返回卸载函数 |
| `installAgentInteractionTracer(opts?)` | 自动捕获 click/input/change/submit/route，写入 `interaction.log`，返回卸载函数 |
| `recordInteraction(kind, target?, opts?)` | 手动记录一次交互；input/change 只写 `<redacted>` |
| `logApiCall(entry)` | 在 HTTP 拦截器记录一次 API 调用（默认脱敏敏感字段，`entry.raw=true` 放行） |
| `logConsoleEntry(level, args)` | 记录一条控制台输出（log/warn/error/info/debug） |
| `recordLoginSuccess(profile, opts?)` | 记录一次登录成功画像，脱敏后写 BOM 和 `auth-state.json` |
| `installAgentAuthRecorder({ getProfile })` | 从业务提供的 `getProfile` 读取当前用户画像并记录一次，返回卸载函数 |
| `snapshotDom()` | 抓取当前页面 DOM 结构（document.body.innerHTML），供 agent 解析 |
| `logNav(from, to)` | 记录路由导航轨迹 |
| `logError(line)` | 记录任意自定义错误行 |

`autoInstrument` 选项：`logBody`(默认 true) / `raw`(默认 false) / `nav`(默认 true) / `errors`(默认 true) / `interactions`(默认 true) / `endpoint`。

`recordLoginSuccess` 允许字段：`userId` / `accountId` / `email` / `name` / `username` / `roles` / `tenantId` / `projectId` / `workspaceId` / `extra`。敏感 key 会被丢弃，`email` 会脱敏。

## 更新日志

- **[CHANGELOG.md](./CHANGELOG.md)** — 完整版本历史
- **[GitHub Releases](https://github.com/webkubor/vite-plugin-agent-eyes/releases)** — 每个版本的可读发布说明

## 已知局限 & Roadmap

- **🟡 敏感脱敏仍需扩展**：`csrfToken` 等 camelCase 变体已覆盖（0.2.0），但 `ssn` / `credit_card` / `cvv` 等 PII 未纳入黑名单——按业务需要自行扩展 `redact` 或用 `raw` 控制。
- **🟡 长日志仍可能截断半行**：`maxBytes` 截断当前按字符，下个版本改为按行 + 字节精确衡量。
- **🟡 dev server 退出时未 flush**：节流窗口内最后一批 buffer（console/截图）可能不落盘，下个版本挂 server `close` hook。
- **🟡 日志关联仍靠 cid 字符串匹配**：当前通过 correlation ID 串联同一次错误的 console/DOM/screenshot，但文件名和日志行里的 cid 需要 agent 自己 grep 匹配。下个版本可加索引文件 `log/correlations.json`。
- **🟡 DOM 快照只抓 body.innerHTML**：不含 computed styles / pseudo elements，视觉相关问题仍依赖 CDP 截图。下个版本可考虑抓关键元素的盒模型数据。

> 欢迎在 [Issues](https://github.com/webkubor/vite-plugin-agent-eyes/issues) 反馈，或直接 PR。

## License

[MIT](./LICENSE)
