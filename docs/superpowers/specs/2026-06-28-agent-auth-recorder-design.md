# Agent Auth Recorder Design

日期：2026-06-28
项目：vite-plugin-agent-eyes

## 背景

`vite-plugin-agent-eyes` 已能记录运行时 API、错误、控制台、代理层 Cookie 线索和提交前 guard 报告。下一步需要让 agent 在本地开发环境里快速知道“当前浏览器是否已登录、登录的是谁”，方便还原 UI 状态和浏览器控制。

## 目标

- 提供显式客户端 API 记录登录成功后的账户画像。
- 只保存脱敏账户画像和登录成功信号，不保存 token、cookie、Authorization、refresh token。
- 在浏览器 BOM 上注入只读的 `window.__AGENT_EYES_AUTH__`，供 agent 浏览器控制时读取。
- 将最近一次登录画像写入当前端口日志目录 `log/<port>/auth-state.json`。
- 将插件运行产物一次性加入 `.gitignore`，避免接入项目产生脏工作区。

## 非目标

- 不自动恢复 cookie/token。
- 不绕过真实登录流程。
- 不保存完整邮箱、密码、验证码、session、localStorage 全量快照。
- 不做跨浏览器、跨设备登录同步。

## API

客户端新增：

```ts
recordLoginSuccess({
  userId,
  email,
  name,
  roles,
  tenantId,
})
```

可选安装器：

```ts
installAgentAuthRecorder({
  getProfile: () => currentUser,
})
```

`recordLoginSuccess()` 会：

1. 清洗并脱敏 profile。
2. 设置 `window.__AGENT_EYES_AUTH__`。
3. POST `{ kind: 'auth', event: 'login_success', state }` 到 `/dev/log`。

`installAgentAuthRecorder()` 第一版只执行一次 `getProfile()` 并记录有效 profile，返回卸载函数。它不 patch fetch，不读取 token，不猜业务接口。

## 数据格式

```json
{
  "loggedIn": true,
  "updatedAt": "2026-06-28T00:00:00.000Z",
  "page_path": "/dashboard",
  "profile": {
    "userId": "u_123",
    "email": "a***@example.com",
    "name": "Alice",
    "roles": ["admin"],
    "tenantId": "tenant_1"
  }
}
```

允许字段：

- `userId`
- `accountId`
- `email`（写入前脱敏）
- `name`
- `username`
- `roles`
- `tenantId`
- `projectId`
- `workspaceId`
- `extra`（仅保留安全 primitive，且过滤敏感 key）

敏感 key 包含 `token`、`secret`、`password`、`authorization`、`cookie`、`session`、`refresh` 等，命中即丢弃。

## 服务器写入

`agentDebugger` 收到 `kind: 'auth'` 后写入当前端口的 `auth-state.json`。写入失败不影响 `/dev/log` 响应。服务端会再次执行同样的脱敏清洗，防止客户端误传敏感字段。

## Git 忽略

更新 `.gitignore`：

```gitignore
log/
.agent-eyes/
.tmp/
*.local.json
```

已有项不重复添加。

## 测试

- 纯函数测试：邮箱脱敏、敏感字段丢弃、roles/extra 规范化。
- 客户端 API 测试：`recordLoginSuccess()` 返回脱敏 state，并设置 BOM 全局对象。
- 服务端 middleware 测试：`kind: auth` 写入 `log/<port>/auth-state.json`，不写入原始 token/email。
- `.gitignore` 测试：确保新增产物目录被忽略。

## 版本

发布为 `0.9.0`。README、CHANGELOG、SKILL 同步更新。
