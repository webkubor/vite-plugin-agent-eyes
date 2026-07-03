# 安装

## 一行装上

::: code-group

```bash [pnpm]
pnpm add -D vite-plugin-agent-eyes
```

```bash [npm]
npm i -D vite-plugin-agent-eyes
```

:::

装完去 [快速上手](./quickstart) 跑通第一个 demo。

## 它是个 Vite 插件

只在 dev 期生效（`apply: 'serve'`），不影响 build 产物，不影响线上体积。React、Vue、Svelte、Solid、原生 JS 都能用——只要你的项目用 Vite，详见[框架无关性](./framework-agnostic)。

## 进阶：类型提示与配置诊断

装上后，TypeScript 用户会自动获得完整类型（hover 有说明、参数有提示）。除此之外，插件在 dev server 启动时会主动提示常见配置错误：

- `agentDebugger()` 会提示 `endpoint` 没有以 `/` 开头、`flushMs` / `maxBytes` 过小等
- `agentProxy()` 会提示 target 非 `http(s)`、`flushMs` / `maxBytes` 过小；`extra.configure` 会保留并先执行

也就是说，配置写错了不用等运行时崩溃，启动控制台就会告诉你。

## 下一步

- [快速上手](./quickstart) — 5 分钟跑通第一个 demo，看到日志
- [为什么需要](./why) — 还不清楚这东西解决什么问题
