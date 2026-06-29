# Changelog

本项目所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/zh-CN/)。

## [0.12.0] - 2026-06-29

### Added
- 新增 `agentSizeWatch()` dev 插件：`apply: 'serve'`，dev 启动全量扫描源文件、热更新增量检查改动文件，行数超阈值在控制台 `[agent-eyes:size]` warn（只警告、不阻断、不影响 build）。补齐 `agentGuard` 仅在提交时拦超长文件的早期反馈缺口，尤其针对 AI 易堆超长的 CSS。
- CSS/SCSS/Sass/Less 使用更严的默认阈值（`cssWarn` 300 行），其它源码用通用阈值（`warn` 400 行，复用 `guard-types` 的 `DEFAULT_FILE_LENGTH_WARN`）；阈值、include/exclude、enabled 均可配置。
- 导出 `guard-core` 的 `lineCount()`，dev size watch 与 commit guard 共用行数统计逻辑，不重复造轮子。
- 新增 `agentSizeWatch` 测试：覆盖启动扫描、热更新增量、CSS 更严阈值、排除目录、禁用。
- `AgentGuardOptions.allowSecrets`：secret 检查白名单字面量，命中的行不计为泄漏。

### Fixed
- `agentGuard` 不再把 lockfile/压缩产物（`pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`、`*.lock`、`go.sum`、`.min.js/.css` 等）计入 `fileLength` 行数硬限制——生成物非手写代码，行数无意义。
- `agentGit` 自动把自己配置的 webhook URL 注入 guard `allowSecrets`，避免 secret 检查把 agentGit **自己要 post 的** 飞书/钉钉/企微 webhook 当成泄漏拦下来（自伤）。

## [0.10.4] - 2026-06-28

### Added
- `agentDebugger()` / `agentProxy()` 增加配置诊断：endpoint 未以 `/` 开头、`flushMs` / `maxBytes` 过小、proxy target 非 `http(s)` 时输出 `[agent-eyes]` warning。
- 新增配置诊断测试，覆盖 `agentDebugger` 与 `agentProxy` 的 warning 行为。

### Changed
- 补强导出函数 JSDoc，让 `agentDebugger()`、`agentProxy()`、`autoInstrument()`、`installAgentErrorReporter()`、`installAgentInteractionTracer()` 在 IDE hover 和 `.d.ts` 中有更明确说明。
- `agentProxy({ extra: { configure } })` 现在会保留用户传入的 `configure` 回调，不再被 agent-eyes 自身监听器覆盖。

## [0.10.3] - 2026-06-28

### Added
- 新增 `AGENT_BOOTSTRAP.md`，明确 Codex、Claude Code、Gemini CLI、Hermes agent 的可用性、推荐入口文件和可复制指令片段。
- `AGENT_GUIDE.md` 增加 supported agents 说明，强调日志是普通文件，多个 agent 都能使用，但自动发现需要各自启动入口。

### Changed
- README、SKILL、运行时 `log/<port>/README.md` 均补充 `AGENT_BOOTSTRAP.md` 入口，避免 agent 只看到人类文档而不会主动使用日志。

## [0.10.2] - 2026-06-28

### Added
- 新增 `AGENT_GUIDE.md`，作为独立于 README 的 agent 操作手册，说明 setup 检查、日志入口、排查顺序和安全边界。

### Changed
- README 增加“文档入口”，明确区分人读 README、agent 读 `AGENT_GUIDE.md` / `log/README.md`、skill 机制读 `SKILL.md`。
- `SKILL.md` 版本同步到 `0.10.2`，运行时生成的 `log/<port>/README.md` 也指向 agent 操作手册。

## [0.10.1] - 2026-06-28

### Fixed
- 删除 README 中依赖 Bundlephobia 实时解析的 bundle size badge，避免 `img.shields.io/bundlephobia/minzip` 超时导致页面显示坏图。

## [0.10.0] - 2026-06-28

### Added
- **脱敏交互轨迹**：新增 `interaction.log`，记录 click/input/change/submit/route 顺序，帮助 agent 和人还原复现路径。
- **客户端交互 API**：新增 `installAgentInteractionTracer()` 与 `recordInteraction()`；`autoInstrument()` 默认启用交互轨迹，可用 `interactions: false` 关闭。
- **interaction 测试覆盖**：新增交互摘要、客户端上报、middleware 落盘测试，确保表单输入只写 `<redacted>`。

### Changed
- `package.json` 版本升至 `0.10.0`，README/SKILL 更新交互轨迹、日志速查和客户端 API。

### Safety
- 交互轨迹只保存目标摘要和路由路径，不保存 input/change 的真实值。

## [0.9.0] - 2026-06-28

### Added
- **脱敏登录态画像**：新增 `recordLoginSuccess()`，本地 dev 登录成功后可记录 `userId/email/name/roles/tenantId` 等安全字段，写入 `log/<port>/auth-state.json`，并注入只读 `window.__AGENT_EYES_AUTH__`，方便 agent 还原已登录 UI 和浏览器控制。
- **一次性登录态记录器**：新增 `installAgentAuthRecorder({ getProfile })`，由业务代码提供当前用户画像，插件只做脱敏记录，不抓 token/cookie。
- **auth-state 测试覆盖**：新增脱敏、BOM 注入、middleware 写入测试，确保不会保存原始邮箱、token、cookie、session 等敏感内容。

### Changed
- **本地产物忽略**：`.gitignore` 新增 `log/`、`.agent-eyes/`、`*.local.json`，避免运行时日志、登录态报告和本地调试 JSON 进入 Git。
- `package.json` 版本升至 `0.9.0`，README/SKILL 更新登录态画像使用说明。

### Safety
- 登录态画像只保留 allowlist 字段；`token`、`secret`、`password`、`authorization`、`cookie`、`session`、`refresh` 等敏感 key 会被丢弃，邮箱写入前脱敏。

## [0.8.0] - 2026-06-27

### Added
- **`agentGuard()` 提交前风险门禁**：新增独立 Vite 插件，在 dev 启动时安装本仓库 `pre-commit`，只检查 staged files，帮助人在提交前提前发现 secrets、超大文件、超长文件、TODO/FIXME/HACK、TypeScript `any` 和 `console.log`。
- **`agentGit({ guard })` 集成**：`agentGit` 可复用同一套 guard，执行顺序固定为 guard → 用户自定义 `precommit` 命令 → 提交成功后的 webhook。
- **agent 可读 guard 报告**：每次 guard 运行会写入 `log/guard-report.json`，包含 `level`、`passed`、`summary` 和明细项；报告写入失败只提示，不影响检查结论。
- **guard 测试基座**：新增 Vitest、`typecheck`、`build:tmp`，覆盖 staged-only、hook 安装、diff 解析、配置开关、hook ownership 和 agentGit 集成边界。

### Changed
- `package.json` 版本升至 `0.8.0`，README/SKILL 更新为 guard 和 `log/<port>/` 当前口径。

### Safety
- `agentGuard()` 和 `agentGit({ guard })` 默认只接管带 `agent-eyes managed` 标记的 hook；遇到用户自有 `pre-commit` / `post-commit` 默认跳过，不写 sidecar 脚本。
- `core.hooksPath` 被全局工具遮蔽时默认告警并跳过；只有显式 `agentGit({ claimHooksPath: true })` 才写本仓库 local config。

## [0.7.0] - 2026-06-24

### Added
- **多 webhook 推送**：`agentGit.webhook` 支持数组，可同时推送飞书、钉钉、企业微信或自定义平台。
- **提交信息增强**：默认 webhook payload 增加分支名称和 UTC 提交时间。

## [0.6.0] - 2026-06-24

### Added
- **日志按 dev 端口隔离**：`agentDebugger` 日志改写到 `log/<port>/`（在 server listening 后取真实端口），并在顶层写 `log/instances.json` 台账（端口/分支/pid/启动时间）。解决「同目录、不同端口的多个 dev server / 多 agent 并行时互相清空、交叉写入日志」。`agentProxy` 也归到同端口目录（复用 listening 时下发的端口）。

### Changed
- **日志读取路径变化（破坏性）**：原 `log/errors.log` 等改为 `log/<port>/errors.log`。agent 从 dev 启动输出拿到自己端口后读 `log/<port>/`；顶层 `log/README.md` + `instances.json` 指引定位。

## [0.5.0] - 2026-06-24

### Added
- **客户端错误上报节流**：`logError` / `installAgentErrorReporter`（含 `autoInstrument({errors:true})`）现对同一错误 **5s 内只上报一次**，并去除 HMR 版本戳（`?t=\d+`）再去重，从源头防渲染死循环 / SW 重试刷爆日志（吸收实战教训，可放心替代各项目自维护的错误上报）

## [0.4.1] - 2026-06-24

### Changed
- CI 发布改用 token 认证（`NPM_TOKEN` secret），修复 OIDC 可信发布未配置导致的 `git tag` → CI 自动发布失败（E404）

## [0.4.0] - 2026-06-24

### Added
- **`agentGit()` 插件**：让任意 Vite 项目**零配置**获得「提交前检查 + 提交后 webhook 推送」——dev 启动时幂等安装 git 钩子，无需各项目再配 husky / `.git/hooks`
  - `precommit`：提交前依次执行命令，任一非零退出即阻断提交
  - `webhook`：提交成功后推送，内置 `'feishu'` 格式，亦支持 `(info) => payload` 自定义函数（序列化进钩子脚本）
  - 钩子内容自包含，`git commit` 时独立运行，不依赖 dev server
  - `force` / `claimHooksPath` 选项：保护已有钩子、兼容全局 `core.hooksPath`（lefthook 等）

### 安全取向
- 只接管带 `agent-eyes managed` 标记的钩子，默认不覆盖用户已有钩子
- 绝不写入全局 hooks 目录；检测到全局 `core.hooksPath` 遮蔽时告警（或经 `claimHooksPath` 显式接管）
- 仅在传了 `precommit` / `webhook` 时启用，否则 no-op

## [0.3.0] - 2026-06-22

### Added
- **全控制台日志**：自动拦截 `console.log` / `warn` / `error` / `info` / `debug`，写入 `log/console.log`，保留原始行为
- **DOM 快照**：错误时自动 dump `document.body.innerHTML` 为 HTML 文件，存入 `log/snapshots/dom-{timestamp}.html`，无需 CDP
- **CDP 错误截图**：通过 Chrome DevTools Protocol 自动截取当前页面 PNG，存入 `log/snapshots/err-{timestamp}.png`
- **CDP 端口自动检测**：优先读 Chrome 进程参数，再扫描 9222-9232，无需手动配置端口
- `logConsole()` / `snapshotDom()` 客户端 API

### Fixed
- **控制台节流**：连续相同消息去重折叠（×N），批量 flush（500ms），上限 500 条/session，防高频输出撑爆日志
- **DOM 快照冷却**：2 秒 cooldown，防循环报错瞬间产生几百个文件
- **关联 ID**：同一次错误的 console/DOM/screenshot 自动带 `cid` 标签，agent 可按 ID 串联诊断

### Changed
- `installAgentErrorReporter` 现在同时拦截全控制台 + 触发 DOM 快照
- 日志文件新增 `console.log`，MANIFEST/README 自动更新

## [0.2.0] - 2026-06-16

### Added
- **一键自动埋点 `autoInstrument()`**：自动包装 `fetch` / `XMLHttpRequest` / 路由导航 / 全局错误，无需逐个拦截器手动埋点；各子项可独立开关，返回卸载函数
- **敏感字段自动脱敏**：`logApiCall` 默认对 `password` / `token` / `secret` / `authorization` 等字段打码，`entry.raw = true` 显式放行
- **`errors.log` 聚合去重**：相同签名折叠 + 频率计数，文件头部输出 `Top Errors`（按频率降序），省去 agent 自己数频率
- **路由导航自动监听**：`autoInstrument` 自动监听 `history.pushState` / `replaceState` / `popstate`
- **多代理分文件**：多个 `agentProxy` 按 target host 各自写 `proxy-<host>.log`，互不覆盖
- `agentDebugger` / `agentProxy` 新增 `flushMs`、`maxBytes` 选项

### Changed
- 日志写入改为 **内存 buffer + 节流批写**（默认 200ms），替代原来每条全量 read+write，大幅降低高频上报的 IO 开销与 dev server 阻塞
- **框架无关**：文档与示例去 React 化，明确支持任意前端框架（React / Vue / Svelte / Solid / 原生 JS）

### Fixed（经对抗式 code review，修复 12 项致命+高危问题）
- **🔴 致命：自动埋点递归**——上报请求自身触发包装后的 fetch/XHR 导致死循环/栈溢出，现已排除上报端点
- **🔴 致命：`method` 非字符串时 `toUpperCase()` 抛错**导致 `/dev/log` 整体挂死，已加类型防御 + try/catch 兜底
- **🔴 致命：重复调用包装**（React StrictMode / HMR 快速刷新）导致多层包装与 `console.error` 永久损坏，`autoInstrument` / `installAgentErrorReporter` 现已幂等
- **🔴 致命：多个 `agentProxy` 共用 `proxy.log` 互相清空**，现按 target host 分文件
- **🟠 脱敏正则误杀**：删除孤立 `key` / `auth`（误杀 React key、Map key），改为边界分隔符子串匹配，覆盖 `csrfToken` / `sessionToken` / `user_password` 等变体
- **🟠 `signature()` 过度归一**：不再把所有数字替换为 N，避免 `http=401` / `403` 等本质不同的错误被折叠成同一签名
- **🟠 大响应体内存翻倍**：`clone().text()` 无上限，现按 `content-length` / `content-type` 限制（>64KB 或非文本不读 body）
- **🟠 `ErrorAggregator.counts` Map 无限增长**：长 session 内存泄漏，现加上限淘汰最低频签名
- **🟠 middleware 无 body 大小限制**：可被超大上报 OOM 挂死 dev server，现限 1MB
- **🟠 XHR 实例复用时 `loadend` 监听器累积**导致重复上报 + 计数注水，现已清理
- **🟠 XHR `responseType` 非 text 时读 body 失败**：现按 responseType 分流读取
- **🟠 `parse` 失败的 body 直接写入**破坏日志结构：现压成单行

## [0.1.0] - 2026-06-16

### Added
- 首个版本：`agentDebugger` + `agentProxy` 服务端插件
- 客户端上报：`installAgentErrorReporter` / `logApiCall` / `logNav` / `logError`
- 三类结构化日志：`api-calls.log` / `errors.log` / `proxy.log`
- 招牌功能：本地 http 上游 `Set-Cookie` 改写（去 `Domain` / 剥 `Secure` / `SameSite=None → Lax`），解决「登录成功却一直 401」

[Unreleased]: https://github.com/webkubor/vite-plugin-agent-eyes/compare/v0.10.4...HEAD
[0.10.4]: https://github.com/webkubor/vite-plugin-agent-eyes/compare/v0.10.3...v0.10.4
[0.10.3]: https://github.com/webkubor/vite-plugin-agent-eyes/compare/v0.10.2...v0.10.3
[0.10.2]: https://github.com/webkubor/vite-plugin-agent-eyes/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/webkubor/vite-plugin-agent-eyes/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/webkubor/vite-plugin-agent-eyes/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/webkubor/vite-plugin-agent-eyes/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.8.0
[0.7.0]: https://github.com/webkubor/vite-plugin-agent-eyes/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.6.0
[0.5.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.5.0
[0.4.1]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.4.1
[0.4.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.4.0
[0.3.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.3.0
[0.2.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.2.0
[0.1.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.1.0
