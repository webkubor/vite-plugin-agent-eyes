# 交互轨迹

## 什么时候用这个

当 bug **难以复现**——你不知道用户（或 agent）点了什么、走到了哪个页面、在哪个表单触发的那个问题时。

典型场景：

- 用户反馈"我点了提交，结果页面白屏了"，但你不知道他点的是哪个"提交"，是哪个按钮触发的跳转，是先填了表单还是直接点的。
- agent 替你跑了一轮操作，你想确认它**真的**走了预期的路径（先到 A 页、点 B 按钮、填 C 表单），而不是点错地方导致测试无效。
- 难复现的 bug：偶尔触发、不知道前置步骤，需要把"先到哪页、点了哪个按钮、在哪个表单触发问题"一步步还原出来。

交互轨迹就是把这条**复现路径**落成可读日志，让你（或 agent）事后能精确回放"人/agent 到底做了什么"。

**什么时候不需要**：纯粹是接口数据错、逻辑算错，操作路径不是问题成因的，看 `api-calls.log` 或 `errors.log` 更直接。

## 最小可用示例

绝大多数情况你**什么都不用配**——`autoInstrument()` 默认就开启了交互轨迹：

```ts
// 应用入口文件（main.ts 等）
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()  // ← 交互轨迹默认开启，无需额外参数
```

如果你只想要交互轨迹、或需要更精细控制，也可以单独手动调用：

```ts
import { installAgentInteractionTracer, recordInteraction } from 'vite-plugin-agent-eyes/client'

installAgentInteractionTracer()              // 自动捕获 click/input/change/submit/route
recordInteraction('click', buttonElement)    // 手动补记一次交互
```

> `autoInstrument` 里交互轨迹由选项 `interactions`（默认 `true`）控制，不想用可设 `autoInstrument({ interactions: false })`。

## 配了之后会发生什么

- **自动捕获** `click` / `input` / `change` / `submit` / `route`（路由跳转）五类事件。
- **写入** `log/<port>/interaction.log`，用于还原"先到哪个页面、点了哪个按钮、在哪个表单触发问题"。
- **每次启动清空**，最新记录在文件最上方，`head` 即看本次会话。

**关键：脱敏，不存真实表单值。** `input` / `change` 只写 `<redacted>`，不会保存真实表单值——密码、邮箱、身份证等敏感输入都不会泄露。

**怎么验证你配对了**：

1. 在配好的页面里，随便点几个按钮、跳一次路由、在一个输入框里打几个字。
2. 打开 `log/<port>/interaction.log`，应能看到带时间戳的 click / route / input 记录。
3. 重点确认：你在输入框里敲的真实内容，日志里只显示 `<redacted>`，不出现明文。
4. 如果 agent 替你操作，操作完后看这份日志，确认它点的是你预期的按钮（而不是点错位置）。

## 真实场景：确认 agent 真的点了"提交"

你让 agent 在一个表单页跑一遍提交测试。agent 跑完报告"测试通过"，但你不放心——它到底有没有点到那个"提交"按钮？还是点歪了点到了旁边的"取消"？

翻 `log/<port>/interaction.log`，按时间顺序能看到完整路径：

```
route  / → /form
click  button.submit
input  input[name=title]   <redacted>
submit form#edit-form
route  /form → /success
```

这样你就能确认：agent 确实进了表单页、确实点了 `button.submit`、确实触发了 submit、并且跳到了成功页。如果日志里写的是 `click button.cancel`，你就知道它点错了，测试结果不作数。

## 下一步

- [登录态画像](./auth-profile.md) —— 配合交互轨迹，既知道"操作了什么"又知道"以谁的身份操作"。
- [日志与报告](./logs.md) —— `interaction.log` 和其它运行时日志（api-calls / errors / console）的完整对照表。
- [API: 客户端函数](../api/client-functions.md) —— `installAgentInteractionTracer` / `recordInteraction` 的参数细节。
