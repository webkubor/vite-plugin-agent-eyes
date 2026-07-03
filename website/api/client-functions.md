# 客户端函数

以下函数均可从 `vite-plugin-agent-eyes/client` 导入。

### `installAgentErrorReporter()`

挂全局错误捕获 + 全控制台拦截 + DOM 快照，返回卸载函数。

### `installAgentInteractionTracer(opts?)`

自动捕获 click/input/change/submit/route，写入 `interaction.log`，返回卸载函数。

### `recordInteraction(kind, target?, opts?)`

手动记录一次交互；input/change 只写 `<redacted>`。

### `logApiCall(entry)`

在 HTTP 拦截器记录一次 API 调用（默认脱敏敏感字段，`entry.raw=true` 放行）。

### `logConsoleEntry(level, args)`

记录一条控制台输出（log/warn/error/info/debug）。

### `recordLoginSuccess(profile, opts?)`

记录一次登录成功画像，脱敏后写 BOM 和 `auth-state.json`。

允许字段：`userId` / `accountId` / `email` / `name` / `username` / `roles` / `tenantId` / `projectId` / `workspaceId` / `extra`。敏感 key 会被丢弃，`email` 会脱敏。

### `installAgentAuthRecorder({ getProfile })`

从业务提供的 `getProfile` 读取当前用户画像并记录一次，返回卸载函数。

### `snapshotDom()`

抓取当前页面 DOM 结构（document.body.innerHTML），供 agent 解析。

### `logNav(from, to)`

记录路由导航轨迹。

### `logError(line)`

记录任意自定义错误行。
