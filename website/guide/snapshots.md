# 错误截图 + DOM 快照

## 什么时候用这个

当错误**看不见摸不着**——纯文字日志无法还原当时的视觉状态时。典型场景：用户说"页面白屏了""样式全乱了""某个弹窗死活不出来"，但你翻 `errors.log` 只看到一串报错文字，完全脑补不出当时的页面长什么样。

截图给你**视觉现场**（PNG），DOM 快照给你**结构现场**（HTML）。两者配合，你（或 agent）就能判断："是某个组件没渲染出来，还是渲染了但被 CSS 藏掉了，还是根本没进到那个路由。"

**什么时候不需要**：纯接口问题（看 `api-calls.log` 就够了）、纯逻辑 bug（看控制台日志就够了）。截图快照是为了还原"页面此刻长什么样"，对非视觉类问题价值有限。

## 快速区分：DOM 快照 vs 截图

这两件事是**独立**的，别搞混：

| | DOM 快照（HTML） | 截图（PNG） |
|------|------|------|
| 默认是否开启 | **是**，`autoInstrument()` / `installAgentErrorReporter()` 自带 | **否**，需在 `agentDebugger({ screenshots: true })` 显式开 |
| 需要 CDP / 特殊 Chrome | 不需要 | **需要** Chrome 带 `--remote-debugging-port` 启动 |
| 给你什么 | 出错那一刻 `document.body.innerHTML` 的 HTML，可解析结构 | 出错那一刻页面的位图，所见即所得 |
| 文件 | `dom-{timestamp}.html` | `err-{timestamp}.png` |

一句话：**DOM 快照零成本、默认就有、给结构；截图要额外配 + CDP、给视觉。** 能用 DOM 快照定位的就用它，看不出来的再上截图。

## 最小可用示例

### 1. DOM 快照（默认就开，无需任何额外配置）

```ts
// vite.config.ts —— 只挂 agentDebugger()，DOM 快照就已经随错误自动生成
import { agentDebugger } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentDebugger()],  // ← 仅此一行，DOM 快照即随错误触发
})
```

```ts
// 应用入口文件（main.ts 等）
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()  // ← 自动捕获错误 + 抓 DOM 快照
```

### 2. 开启截图（需在 1 的基础上加 `screenshots: true` + CDP Chrome）

```ts
// vite.config.ts
export default defineConfig({
  plugins: [
    agentDebugger({ screenshots: true }),  // ← 唯一新增：开启截图
  ],
})
```

## 完整配置说明

开启后，每次前端错误或 API 失败自动通过 CDP 截取当前页面，存入 `log/<port>/snapshots/err-{timestamp}.png`。同时自动 dump DOM 结构为 `log/<port>/snapshots/dom-{timestamp}.html`（无需 CDP）。

**前置条件**：Chrome 需要带 remote debugging 启动（仅截图需要，DOM 快照不需要）：

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# 或在现有 Chrome 里打开一个新窗口
open -a "Google Chrome" --args --remote-debugging-port=9222
```

插件**自动检测** CDP 端口：先读 Chrome 进程参数，再扫描 9222-9232，找到即用。未找到时静默跳过，不影响现有日志。

## 配了之后会发生什么

- **出错时**（前端 error / unhandledrejection / API 失败），自动生成快照文件到 `log/<port>/snapshots/`，文件名带时间戳：
  - `dom-{timestamp}.html` —— 始终生成
  - `err-{timestamp}.png` —— 仅当 `screenshots: true` 且 CDP 可用时生成
- **日志目录**：默认在项目根的 `log/` 下，按 dev server 端口分子目录，例如 `log/5173/snapshots/`。
- **每次启动清空**：同 `errors.log` 等运行时日志一样，dev server 重启会清空本端口目录，最新记录在最上方。
- **怎么验证你配对了**：
  1. 配好后跑一次会触发错误（例如手动 `throw` 一个错，或访问一个会 500 的接口）。
  2. 打开 `log/<port>/snapshots/`，应能看到带时间戳的 `dom-*.html` 文件；开了截图的还能看到 `err-*.png`。
  3. 用浏览器打开那个 `.html`，能还原出出错那一刻的 DOM 结构；`.png` 就是当时的页面截图。
  4. 如果开了 `screenshots: true` 却没生成 PNG——多半是 Chrome 没带 `--remote-debugging-port` 启动（见上面"前置条件"）。

> **提示**：DOM 快照只抓 `body.innerHTML`，不含 computed styles / 伪元素，纯视觉问题（颜色、间距、伪元素样式）仍依赖 CDP 截图。

## 下一步

- [日志与报告](./logs.md) —— 快照文件和其它运行时日志（api-calls / errors / console / interaction）的完整对照表。
- [API: agentDebugger](../api/agent-debugger.md) —— `screenshots` / `logDir` / `maxBytes` 等全部选项参考。
- [为什么需要 agent-eyes](./why.md) —— 运行时遥测解决 agent "网络层盲区"的总体思路。
