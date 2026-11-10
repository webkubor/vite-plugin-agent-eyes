# Agent Eyes 诊断页重做 —— worktree 说明

任务：`t_20261104040917eb48c8`（CS 执行队列，owner 2026-11-04 建单）
PR：<https://github.com/webkubor/vite-plugin-agent-eyes/pull/14>
分支：`feat/diagnostics-panel-redesign`（commit `1fad7cb` + `e021ddb`）

## 这个 worktree 是什么

诊断页 UI 重做的**隔离工作区**。建单明确要求「只在独立分支实施，不碰
ModelGo release/v1.0.10 代码、依赖或 lockfile，不在 owner 正在用的项目直接
试装插件」，所以不开在 ModelGo 里。

插件的 `pnpm-lock.yaml` 被 `.gitignore` 忽略（仓库惯例），所以本 worktree
需要从主仓复制一份才能装依赖：

```bash
cp ../../pnpm-lock.yaml .
pnpm install --no-frozen-lockfile
```

## 验收方式（视觉验收要真实浏览器，不能只看测试过）

```bash
# 1. 隔离 fixture（不装进任何真实项目、不占 5173）
mkdir -p /tmp/eyes-fixture/public && cd /tmp/eyes-fixture
#    index.html + public/{robots.txt,sitemap.xml,llms.txt}
#    vite.config.js 里直接引本 worktree 的 src/visual.ts

# 2. 起 dev server
npx vite --port 5199 --host 127.0.0.1

# 3. 起带调试端口的独立 Chrome（不动日常那个浏览器）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=/tmp/eyes-chrome-profile \
  --no-first-run "http://127.0.0.1:5199/login"

# 4. 从页面右下角「◉ Agent Eyes」入口打开面板
#    ⚠️ 必须走入口：CDP 页签匹配要求 origin+pathname 完全相等。
#       用 localhost 打开面板而 Chrome 里是 127.0.0.1，会匹配不上、
#       面板报「没找到与当前路由匹配的调试页」。
```

窄屏验收用 CDP 改视口（ego-browser 没有 viewport API）：

```js
await page.cdp("Emulation.setDeviceMetricsOverride",
  { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
```

## PR 合并后

本 worktree 可以删：`git worktree remove .claude/worktrees/diagnostics-panel-redesign`。
合并时**不要**把 `pnpm-lock.yaml` 带进提交（它在 `.gitignore` 里）。
