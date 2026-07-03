# 登录态画像

## 什么时候用这个

当 agent（或你自己）需要知道**当前浏览器登录的是谁**——而你又不想把真实的 token / cookie 暴露出去时。

典型场景：

- **agent 控制浏览器复现 bug / 确认权限**：agent 要判断"这个按钮现在该不该可见""这个接口当前账号能调吗"，得先知道当前登录账号的身份和角色。
- **多租户 / 多角色系统**：agent 需要知道当前是哪个租户（tenantId）、什么角色（roles），才能用对应的权限去测试，而不是拿一份假数据瞎试。
- **切换账号验证**：你切了账号后，想让 agent 自动适配新账号的权限和画像，而不是手动告诉它。

**什么时候不需要**：纯静态页面、没有登录态；或者你完全不在意 agent 知不知道当前是谁。

> **安全前提**：这里只记录**脱敏画像**（谁是、什么角色、哪个租户），**绝不**记录 token、cookie、Authorization、refresh token。下面"配了之后"会详细说。

## 最小可用示例

在你的应用里，**登录成功之后**调一次 `recordLoginSuccess`，把当前用户画像喂进去：

```ts
// 应用入口或登录逻辑处
import { recordLoginSuccess } from 'vite-plugin-agent-eyes/client'

// 登录成功、拿到 currentUser 之后：
recordLoginSuccess({
  userId: currentUser.id,
  email: currentUser.email,   // 写入前自动脱敏，例如 a***@example.com
  name: currentUser.name,
  roles: currentUser.roles,
  tenantId: currentUser.tenantId,
})
```

> 如果你已经用 `autoInstrument()` 做了自动埋点，这里只需补这一个手动调用——画像不是"事件"，需要你明确告诉它"登录成功了，账号是这些字段"。

## 完整字段说明

`recordLoginSuccess` 允许的字段：`userId` / `accountId` / `email` / `name` / `username` / `roles` / `tenantId` / `projectId` / `workspaceId` / `extra`。敏感 key 会被丢弃，`email` 会脱敏。

## 配了之后会发生什么

调用 `recordLoginSuccess` 之后，两处会同步落地：

1. **浏览器侧**：注入一个**只读**的 `window.__AGENT_EYES_AUTH__`，里面是脱敏后的画像。你的代码或 agent 可以读它来判断"当前是谁"。
2. **dev server 侧**：写一份 `log/<port>/auth-state.json`，内容同样是脱敏画像 + 最近一次登录成功信号。

**关键：脱敏，只存画像，不存凭证。** 具体来说：

- ✅ 会存：`userId` / `name` / `username` / `roles` / `tenantId` / `projectId` / `workspaceId` / 脱敏后的 `email`（如 `a***@example.com`）/ 你显式给的 `extra`。
- ❌ 绝不存：token、cookie、Authorization、refresh token；传入的敏感 key 会被丢弃。

**怎么验证你配对了**：

1. 在登录成功后调用 `recordLoginSuccess({...})`。
2. 打开浏览器控制台，输入 `window.__AGENT_EYES_AUTH__`，应能看到刚写入的脱敏画像（注意 email 已被打码）。
3. 打开 `log/<port>/auth-state.json`，内容应与上面一致。
4. 确认里面**没有**任何 token / cookie / Authorization 字段——这是脱敏是否生效的硬标准。

## 真实场景：多租户系统里让 agent 自动适配

一个多租户 SaaS 系统，admin 和 member 权限完全不同，租户 A 和租户 B 的数据互不可见。你让 agent 帮你跑一轮回归测试：

1. 你用 admin 账号登录 tenant A。
2. 登录成功后调 `recordLoginSuccess({ userId, roles: ['admin'], tenantId: 'tenant-a', ... })`。
3. agent 读 `log/<port>/auth-state.json`，知道"当前是 tenant A 的 admin"，于是只测 admin 有权的功能，不会去点"删除租户"这种它没权限的按钮，也不会拿 tenant B 的假数据。
4. 你切到 member 账号再登录，画像自动更新，agent 改用 member 权限继续测。

整个过程 agent 不需要你口头告诉它"现在是哪个账号、什么角色"——它自己读画像就知道。

## 下一步

- [交互轨迹](./interactions.md) —— 还原"用户/agent 先到哪页、点了哪个按钮"，和登录态画像配合还原完整复现路径。
- [日志与报告](./logs.md) —— `auth-state.json` 和其它运行时日志（api-calls / interaction / errors）的完整对照表。
- [API: 客户端函数](../api/client-functions.md) —— `recordLoginSuccess` / `installAgentAuthRecorder` 的参数细节。
