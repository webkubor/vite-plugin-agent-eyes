# 错误截图 + DOM 快照

开启后，每次前端错误或 API 失败自动通过 CDP 截取当前页面，存入 `log/<port>/snapshots/err-{timestamp}.png`。同时自动 dump DOM 结构为 `log/<port>/snapshots/dom-{timestamp}.html`（无需 CDP）。

```ts
// vite.config.ts
export default defineConfig({
  plugins: [
    agentDebugger({ screenshots: true }),  // 开启截图（DOM 快照始终启用）
  ],
})
```

**前置条件**：Chrome 需要带 remote debugging 启动（仅截图需要，DOM 快照不需要）：

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# 或在现有 Chrome 里打开一个新窗口
open -a "Google Chrome" --args --remote-debugging-port=9222
```

插件**自动检测** CDP 端口：先读 Chrome 进程参数，再扫描 9222-9232，找到即用。未找到时静默跳过，不影响现有日志。
