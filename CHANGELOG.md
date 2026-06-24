# Changelog

本项目所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/zh-CN/)。

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

[Unreleased]: https://github.com/webkubor/vite-plugin-agent-eyes/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.4.1
[0.4.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.4.0
[0.3.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.3.0
[0.2.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.2.0
[0.1.0]: https://github.com/webkubor/vite-plugin-agent-eyes/releases/tag/v0.1.0
