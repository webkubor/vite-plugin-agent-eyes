# 安装

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
