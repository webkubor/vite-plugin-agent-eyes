---
name: agent-eyes
description: "vite-plugin-agent-eyes 的 agent 使用手册。两块能力：① 自愈遥测——读结构化运行时日志（API/错误/控制台/交互/代理 header）+ 脱敏登录态 + 截图 + DOM 快照，不靠猜代码就诊断修复；② 提交治理——agentGit（去 husky，统一 pre-commit/post-commit + 飞书通知）、agentGuard（提交期硬拦 secret/超长文件/屎山）、agentSizeWatch（dev 期实时警告超长文件）。在 Vite/Astro 项目里配置 agentGit/agentGuard/agentSizeWatch 或排查 guard 拦截/误报时必读。"
version: 0.12.0
---

# Vite Agent Debugger

让在 Vite 项目里干活的 agent 拥有**运行时视野**，跑「读日志 → 定位 → 改 → 重启 dev → 再读验证」的自愈闭环。
配套 npm 包 `vite-plugin-agent-eyes`（源码在本目录 `src/`，可 `npm publish` 或 git 安装）。
如果只需要 agent 操作流程，优先读 `AGENT_GUIDE.md`；如果要让 Codex、Claude、Gemini、Hermes 主动发现并使用，读 `AGENT_BOOTSTRAP.md`；README 面向人类安装和评估。

## 何时用

- 用户报"页面坏了 / 登录不上 / 请求失败 / cookie 问题"，但你**不该靠猜代码**——先读遥测。
- 你自己改完要**验证**：重启 dev、触发操作、读日志确认行为对了。
- 需要还原已登录 UI 或浏览器控制时，先看 `log/<port>/auth-state.json` 确认当前账号画像，再看 `log/<port>/interaction.log` 还原最近交互路径。
- 用户提交被 guard 阻断或要求提前规避明显错误 / 屎山信号时，先读 `log/guard-report.json`。
- 给一个还没接入的 Vite 项目装上这套自愈能力。

## 接入（一次性，3 步）

```ts
// 1. vite.config.ts
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'
export default defineConfig({
  plugins: [agentDebugger({ screenshots: true })],  // screenshots 可选，开启 CDP 截图
  server: { proxy: { '/api': agentProxy('https://your-api.example.com') } },
})
```
```ts
// 2. 应用入口文件（main.ts / main.tsx / main.js / index.js 皆可——框架无关）
```

**推荐：一行自动埋点**，自动包装 fetch/XHR/路由导航/全局错误/全控制台/DOM 快照/脱敏交互轨迹：
```ts
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()
```

**或手动埋点**（需精细控制时）：
```ts
import { installAgentErrorReporter, logApiCall, logConsoleEntry, snapshotDom } from 'vite-plugin-agent-eyes/client'
installAgentErrorReporter()   // 捕获全局错误 + 全控制台 + DOM 快照
// 在 fetch/ky/axios 拦截器里，每次请求结束调用
logApiCall({ method, path, url, ok, duration_ms, code, status, request_id, error, request, response })
logConsoleEntry('warn', ['deprecated API called'])
```

**登录成功后记录脱敏账号画像**：
```ts
import { recordLoginSuccess } from 'vite-plugin-agent-eyes/client'
recordLoginSuccess({ userId, email, name, roles, tenantId })
```
只保存脱敏画像，不保存 token/cookie。浏览器里可读 `window.__AGENT_EYES_AUTH__`，文件在 `log/<port>/auth-state.json`。

交互轨迹默认由 `autoInstrument()` 安装，写入 `log/<port>/interaction.log`。`input` / `change` 只记录 `<redacted>`，不保存真实表单值。

未装包但想临时用：优先用 git / workspace 方式安装本包；不要只拷 `src/index.ts` / `src/client.ts`，它们依赖同目录下的 `cdp`、`git`、`guard-*` 等模块。

## 提交治理：agentGit / agentGuard / agentSizeWatch（配置速查）

三者职责（钩子由 `apply:'serve'` 插件在 **dev 启动**时装/重写——改了配置或升级版本要跑一次 `pnpm dev` 才生效；Astro 项目加进 `astro.config` 的 `vite.plugins`）：

| 插件 | 时机 | 作用 |
|------|------|------|
| `agentGit` | 提交前/后 | 替代 husky：跑 `precommit` 命令 + 可内嵌 `guard`；提交后飞书通知。自带 rebase/cherry 重放去重 |
| `agentGuard` | 提交时 | 硬拦 staged：secret/超大文件/超长行数/TODO/any/console.log。**已用 agentGit 就配进 `agentGit({ guard })`，别再单独挂**（争用 pre-commit） |
| `agentSizeWatch` | dev 写码当下 | 超长文件在控制台 `[agent-eyes:size]` warn，只警告不阻断。专治 AI 堆超长 CSS |

**典型配置（本项目三仓在用的形态）：**
```ts
agentGit({
  projectLabel: '国内官网',
  precommit: ['sh scripts/precommit.sh'],     // 任一非零退出即阻断
  webhook: [{ url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx', format: 'feishu' }],
  guard: { level: 'block', fileLength: { warn: 400, block: 800 } },  // 硬拦屎山
  claimHooksPath: true,   // 全局 core.hooksPath（lefthook 等）遮蔽本仓钩子时，设本地覆盖
  force: true,            // 接管已存在的非本插件 pre-commit
})
// dev 实时警告（可选，独立挂）：agentSizeWatch({ warn: 400, cssWarn: 300 })
```

**level**：`warn` 只报告 / `block`（推荐）红线阻断 / `strict` 暂等同 block。
**guard.checks**：`['secrets','largeFiles','fileLength','todo','noAny','noConsoleLog']`，可按需开关。

**两条 0.12.0 行为，配 guard 前必须知道（否则会以为是 bug）：**
- **lockfile/压缩产物不计 `fileLength`**：`pnpm-lock.yaml`/`package-lock.json`/`yarn.lock`/`*.lock`/`go.sum`/`.min.js|css` 自动跳过——生成物非手写代码。要再扩名单改 `GENERATED_FILE_PATTERN`（guard-core + guard-hook 两份拷贝同步）。
- **webhook 不会自伤**：`agentGit` 自动把自己配置的 webhook URL 注入 guard `allowSecrets`，secret 检查不再把它当泄漏。手动放行其它字面量用 `guard.allowSecrets: [...]`。

- guard 只检查 staged files；最近一次 JSON 报告在 `log/guard-report.json`。
- 完整选项表见 README `### agentGit / agentGuard / agentSizeWatch` API 段。

## 自愈闭环（核心，照此执行）

1. **先读 `log/README.md`** —— 项目自描述，确认当前端口日志在哪、各流看什么。
2. **读 `log/<port>/errors.log`** —— 定位"哪坏了"（最新在最上，`head` 即可）。
3. **按线索下钻**：
   - 复现路径不清 → `log/<port>/interaction.log` 看 click/input/change/submit/route 顺序。
   - 接口/字段问题 → `log/<port>/api-calls.log` 看**真实**请求/响应体（**绝不凭类型猜字段**）。
   - 控制台警告/调试信息 → `log/<port>/console.log` 看全级别输出（React dev warning、库 deprecation 等）。
   - 登录/cookie/CORS/302 等网络层 → `log/<port>/proxy-<host>.log` 看 `Cookie(req)` 与 `Set-Cookie`。
   - 已登录 UI 还原 → `log/<port>/auth-state.json` 看当前账号画像。
   - 视觉问题 → `log/<port>/snapshots/` 看错误截图（PNG）+ DOM 快照（HTML）。
   - 提交前门禁问题 → `log/guard-report.json` 看阻断 / 预警明细。
4. **噪声预判**：未登录时 `/auth/session` 的 401、浏览器扩展的 `runtime.lastError` 都是**预期噪声**，不是 bug，别去追。
5. **改代码 → 重启 dev**（vite 配置/插件改动 HMR 不重载，必须重启）**→ 重新触发 → 再读日志验证**。日志每次启动清空，看到的就是本次。

## 招牌诊断：登录成功却一直 401

```
log/<port>/api-calls.log:  POST .../auth/login  code=0        ← 登录成功
log/<port>/api-calls.log:  GET  .../auth/session code=40101    ← 紧跟却未登录
log/<port>/proxy-<host>.log: GET .../auth/session → 200 | Cookie(req): 无   ← 浏览器没带 cookie
```
根因：上游 Set-Cookie 是 `Domain=<父域> + Secure + SameSite=None`，本地 `http://localhost` 域不匹配 + Secure 被丢 → 拒收。
`agentProxy` 默认已在 dev 修复（去 Domain / 剥 Secure / SameSite=None→Lax）。关掉：`agentProxy(target, { rewriteCookiesForLocalhost: false })`。

## 日志速查

| 文件 | 看什么 |
|------|--------|
| `log/<port>/errors.log` | API 失败 + 前端运行时错误（聚合去重 + 频率） |
| `log/<port>/console.log` | 全级别控制台输出（log/warn/error/info/debug） |
| `log/<port>/interaction.log` | click/input/change/submit/route 脱敏交互轨迹 |
| `log/<port>/api-calls.log` | API 全量 + 路由，带请求/响应体 |
| `log/<port>/proxy-<host>.log` | 代理层 Cookie / Set-Cookie 属性 / status（多代理按 host 分文件） |
| `log/<port>/auth-state.json` | 最近一次登录成功的脱敏账户画像 |
| `log/<port>/snapshots/err-*.png` | 错误截图（需 CDP，自动检测端口） |
| `log/<port>/snapshots/dom-*.html` | DOM 快照（始终可用，无需 CDP） |
| `log/guard-report.json` | 最近一次提交前 guard JSON 报告 |
