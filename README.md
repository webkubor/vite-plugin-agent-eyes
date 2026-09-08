<div align="center">

<img src="https://cdn.jsdelivr.net/gh/webkubor/picx-images-hosting@master/blog/projects/vite-plugin-agent-eyes-banner/cs-token4ai-1784197717786638000.png" alt="Agent Eyes banner" width="100%" />

<br />
<br />

<img src="https://cdn.jsdelivr.net/gh/webkubor/picx-images-hosting@master/blog/projects/vite-plugin-agent-eyes/cs-token4ai-1784193576898095000.png" alt="Agent Eyes logo" width="88" height="88" />

# vite-plugin-agent-eyes

**给 AI agent 的自愈遥测层，也给人一道提交前风险门禁。**

运行时日志让 agent 在不看代码的前提下，自己读日志、定位、修复、验证；登录态画像让 agent 快速知道当前浏览器是谁；提交前 guard 让人在 `git commit` 前先看到明显错误、敏感信息和屎山信号。

[![npm version](https://img.shields.io/npm/v/vite-plugin-agent-eyes.svg?color=cb3837&label=npm)](https://www.npmjs.com/package/vite-plugin-agent-eyes)
[![npm downloads](https://img.shields.io/npm/dm/vite-plugin-agent-eyes.svg?color=cb3837)](https://www.npmjs.com/package/vite-plugin-agent-eyes)
[![release](https://img.shields.io/github/v/release/webkubor/vite-plugin-agent-eyes?color=181717&label=release)](https://github.com/webkubor/vite-plugin-agent-eyes/releases)
[![vite](https://img.shields.io/badge/Vite-%E2%9A%A1%EF%B8%8F-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![typescript](https://img.shields.io/badge/TypeScript-ready-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![license](https://img.shields.io/npm/l/vite-plugin-agent-eyes?color=42b883)](./LICENSE)

**📖 [完整文档](https://webkubor.github.io/vite-plugin-agent-eyes/)** · [API 参考](https://webkubor.github.io/vite-plugin-agent-eyes/api/agent-eyes) · [AGENT_GUIDE](./AGENT_GUIDE.md)

</div>

> **框架无关**：纯 Vite 插件 + 浏览器原生 API（`fetch` / `XMLHttpRequest` / `history`）。React、Vue、Svelte、Solid、原生 JS 都能用，不依赖任何框架。

## 为什么

未来代码大多由 AI 写，但二次调试和 bug 校验常常无人读代码。agent 缺的是「运行时视野」：

- `fetch` 看不到 `Set-Cookie` / `Cookie` / 重定向 / CORS——**网络层盲区**。
- 控制台错误转瞬即逝，且混着扩展噪声——**没有可追溯、可分类的错误流**。
- 接口返回的真实字段常和类型定义不一致——**只能猜**。

本插件把这些落成 **结构化、可解析、每次启动清空、最新在最上** 的运行时日志，并记录脱敏的登录态画像与交互轨迹，方便 agent 还原 UI、控制浏览器和复现路径。

## 安装

```bash
pnpm add -D vite-plugin-agent-eyes
```

`peerDependencies` 支持 `vite >=4 <9`，CI 按 4 / 5 / 6 / 7 / 8 主版本矩阵验证。

## 快速上手

```ts
import { defineConfig } from 'vite'
import { agentEyes, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    ...agentEyes(), // 运行时日志 + 自动客户端埋点 + 项目体检 + size watch + 提交 guard
  ],
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'), // 代理日志 + 本地 cookie 修复
    },
  },
})
```

`agentEyes()` 只在 `vite dev` 生效，会自动向 dev HTML 注入埋点，**普通项目不用改 `main.tsx`**。
逐项关闭传 `{ client: false, sizeWatch: false, git: false }`。

需要精细控制时，客户端也可手动调用 `autoInstrument()` 或更底层的
`logApiCall` / `recordLoginSuccess` 等——见 [客户端 API](https://webkubor.github.io/vite-plugin-agent-eyes/api/client-functions)。

## 能力一览

| 能力 | 一句话 | 文档 |
|---|---|---|
| **运行时日志** | API / 错误 / 控制台 / 交互轨迹落成结构化日志，agent 直接读 | [日志总览](https://webkubor.github.io/vite-plugin-agent-eyes/guide/logs) |
| **代理层日志** | `Cookie` / `Set-Cookie` / status —— fetch 看不到的那层 | [agentProxy](https://webkubor.github.io/vite-plugin-agent-eyes/api/agent-proxy) |
| **错误截图 + DOM 快照** | 出错自动截图（CDP 自动探测端口）+ dump DOM | [快照](https://webkubor.github.io/vite-plugin-agent-eyes/guide/snapshots) |
| **登录态画像** | 脱敏账户画像，agent 一眼知道当前浏览器是谁 | [登录态](https://webkubor.github.io/vite-plugin-agent-eyes/guide/auth-profile) |
| **提交前 guard** | secrets / 大文件 / 超长文件 / `any` / `console.log` / `cssVars` | [Guard](https://webkubor.github.io/vite-plugin-agent-eyes/guide/guard) |
| **Git workflow** | 零配置装 pre-commit / post-commit，支持多平台 webhook | [Git workflow](https://webkubor.github.io/vite-plugin-agent-eyes/guide/git-workflow) |
| **Size Watch** | dev 期文件超长实时 warn，专治 AI 堆屎山 | [Size Watch](https://webkubor.github.io/vite-plugin-agent-eyes/guide/size-watch) |
| **Agent 自发现** | dev 启动把日志读法写进已有的 `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`，agent 冷启动即可见 | [Agent Bootstrap](https://github.com/webkubor/vite-plugin-agent-eyes/blob/main/AGENT_BOOTSTRAP.md) |

## 招牌案例：登录成功却一直 401

```
log/<port>/api-calls.log:          POST .../auth/login  code=0          ← 登录成功
log/<port>/api-calls.log:          GET  .../auth/session code=40101     ← 紧跟却未登录
log/<port>/proxy-api.example.com.log: GET .../auth/session → 200 | Cookie(req): 无   ← 浏览器没带 cookie
```

`agentProxy` 默认在本地 `http://localhost` 把上游 `Set-Cookie` **去 `Domain`（变 host-only）、剥 `Secure`、`SameSite=None → Lax`**——解决「后端 cookie 是父域 + Secure + SameSite=None，浏览器在 http 上拒收 → 登录成功却下个请求不带 cookie → 401」这一经典 dev 坑。

测试/生产 https 同域不受影响。要关掉：`agentProxy(target, { rewriteCookiesForLocalhost: false })`。

## cssVars：为什么它是唯一 block 级的样式检查

`var(--不存在)` 不会报错、不会崩溃——CSS 规范下它让**整条声明失效**并退回初始值：`z-index` 变 `auto`（浮层层级塌陷、被遮罩压住点不动）、圆角与间距归零。**`tsc`、ESLint、`vite build` 全部照过**，只有真人在页面上点到那个组件才会暴露，所以按红线处理。

它同时覆盖 `.css` 与 `.ts/.tsx/.vue/.svelte`——Tailwind 的 arbitrary value（`z-[var(--z-overlay)]`）和内联 `style` 同样是引用，只扫 CSS 会整类漏掉。

两条防误报设计：只检查**新增行**，存量项目接入不会被历史债淹没；声明全集为空时整项跳过。

> ⚠️ 设计 token 由 npm 包提供时必须点明来源，否则它声明的变量会被判成未声明：
> `cssVars: { declareFrom: ['node_modules/@acme/design-tokens/tokens.css'] }`

## 日志与报告

运行时日志写进 `log/<port>/`，每次启动清空，**最新记录在文件最上方**，`head` 即看本次会话。

| 文件 | 内容 | 何时看 |
|------|------|--------|
| **api-calls.log** | 全部 API（成功 + 失败）+ 路由跳转，带请求/响应体 | 查接口契约、定字段、调用顺序 |
| **errors.log** | API 失败 + 前端运行时错误，聚合去重 + 频率计数 | 只看「哪坏了」、哪个刷得最凶 |
| **console.log** | 全级别控制台输出 | React dev warning、库 deprecation |
| **interaction.log** | click/input/change/submit/route 脱敏交互轨迹 | 还原复现路径 |
| **proxy-\<host\>.log** | 代理层 `Cookie` / `Set-Cookie` 属性 / status | 网络、鉴权层 |
| **snapshots/** | 错误截图（PNG）+ DOM 快照（HTML） | 视觉 + 结构双重现场 |
| **auth-state.json** | 最近一次登录成功的脱敏账户画像 | 确认当前账号 |
| `log/guard-report.json` | 提交前 guard 的最近一次报告 | 看 commit 为何被拦 |
| `log/project-guide.json` | 项目结构体检与 alias 建议 | 开局判断项目层级 |

`log/README.md` 是给 agent 的自描述入口（启动时自动生成）；`errors.log` 顶部是按频率降序的 `Top Errors`，省去 agent 自己数频率。

## 配套：同一条前端质量链路

`cssVars` 拦的是**变量不存在**，但变量存在之后还有两层能坏。
[**contrast-guard**](https://github.com/webkubor/contrast-guard)（零依赖，12.6KB）接着往下守：

| 时机 | 工具 | 拦什么 | 漏掉会怎样 |
|---|---|---|---|
| 写代码当下 | **agent-eyes** `agentSizeWatch` | 文件越堆越长 | CSS 屎山，改一处牵一片 |
| `git commit` 前 | **agent-eyes** `agentGuard` 的 `cssVars` | `var(--从未声明)` | 整条声明失效，`z-index` 退回 `auto` |
| CI | contrast-guard `check` | 变量存在，但对比度不达标 | 文字看不清；**它会反推出该改成 `L=58%`** |
| 页面跑起来 | contrast-guard `measure` | 值都对，但用得太碎 | 一屏 9 种字号、灰阶只拉开 2 层，每处单看都"对"，合起来就是丑 |
| 出问题时 | **agent-eyes** 运行时日志 / 截图 | 运行时错误、登录态、API 失败 | agent 只能靠猜代码 |

递进关系：**变量不存在** → **变量存在但值不合格** → **值都合格但用得失控**。
三种都不报错、都能过构建，只是坏的方式不同。

## 文档

- **📖 [在线文档站](https://webkubor.github.io/vite-plugin-agent-eyes/)** — 指南 + 完整 API 参考（源码在 [`website/`](./website)）
- **agent 读**：[AGENT_GUIDE.md](./AGENT_GUIDE.md)；项目运行后还会生成 `log/README.md` 告诉 agent 该读哪些日志
- **让 agent 主动会用**：[AGENT_BOOTSTRAP.md](./AGENT_BOOTSTRAP.md) — Codex / Claude Code / Gemini CLI / Hermes 的入口与指令片段
- **Codex/Claude skill**：[SKILL.md](./SKILL.md)
- **更新日志**：[CHANGELOG.md](./CHANGELOG.md) · [Releases](https://github.com/webkubor/vite-plugin-agent-eyes/releases)

所有导出都带 `dist/*.d.ts` 类型和 hover 说明；`agentDebugger()` / `agentProxy()` 会在启动时提示常见配置错误。

## 已知局限 & Roadmap

- **🟡 敏感脱敏仍需扩展**：`ssn` / `credit_card` / `cvv` 等 PII 未纳入黑名单——按需扩展 `redact` 或用 `raw` 控制。
- **🟡 长日志仍可能截断半行**：`maxBytes` 截断按字符，下版改为按行 + 字节精确衡量。
- **🟡 dev server 退出时未 flush**：节流窗口内最后一批 buffer 可能不落盘，下版挂 server `close` hook。
- **🟡 日志关联靠 cid 字符串匹配**：cid 需 agent 自己 grep，下版可加索引文件 `log/correlations.json`。
- **🟡 DOM 快照只抓 body.innerHTML**：不含 computed styles / pseudo elements。当前可用 [`contrast-guard measure <url>`](https://github.com/webkubor/contrast-guard) 顶上——它遍历所有可见元素的 computed style 出统计。

> 欢迎在 [Issues](https://github.com/webkubor/vite-plugin-agent-eyes/issues) 反馈，或直接 PR。

## License

[MIT](./LICENSE)
