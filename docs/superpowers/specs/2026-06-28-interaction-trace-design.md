# Interaction Trace Design

日期：2026-06-28
项目：vite-plugin-agent-eyes

## 背景

现有运行时日志能告诉 agent “哪里报错了”，但经常缺少“用户怎么走到这一步”。本地 UI 调试和浏览器控制最需要的是最近操作轨迹：路由、点击、输入、提交。

## 目标

- 新增轻量 interaction trace，记录最近用户操作。
- 默认随 `autoInstrument()` 启用，可单独 `installAgentInteractionTracer()`。
- 不记录输入值，只记录字段摘要和 `<redacted>`。
- 通过 `/dev/log` 写入 `log/<port>/interaction.log`。
- 日志可读，能帮助 agent 复现 UI 问题。

## 非目标

- 不生成 Playwright 脚本。
- 不记录密码、输入值、剪贴板内容。
- 不做性能 timeline。
- 不理解业务权限或 feature flag。

## 事件范围

- `route`：history push/replace/popstate。
- `click`：记录元素摘要。
- `input` / `change`：记录字段摘要，不记录 value。
- `submit`：记录 form 摘要。

## 元素摘要

优先级：

1. `data-testid`
2. `aria-label`
3. `name`
4. `id`
5. 文本内容，最多 80 字符
6. class 简化，最多 3 个 class

示例：

```text
button[data-testid=save] "保存"
input[name=email][type=email] <redacted>
form#login
```

## 数据流

1. 客户端 `installAgentInteractionTracer()` 监听事件。
2. 生成脱敏 `InteractionEntry`。
3. 客户端 POST `{ kind: 'interaction_batch', entries }` 到 `/dev/log`。
4. `agentDebugger` 写入 `log/<port>/interaction.log`，最新在上。
5. `log/<port>/README.md` 指引 agent 读取该文件。

## 安全边界

- input/change 永远不写入真实值。
- target 摘要裁剪长度，避免大段文本。
- 仅 dev 环境上报。
- 事件监听可通过 `autoInstrument({ interactions: false })` 关闭。

## 版本

发布为 `0.10.0`。
