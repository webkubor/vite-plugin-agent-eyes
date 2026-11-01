# 爬虫探测与路由截图

`agentEyes()` 默认在 dev 网页右下角显示 **Agent Eyes** 入口。点击后在新窗口打开本地面板：当前项目、mode、路由、浏览器截图能力、爬虫配置和截图索引。无需另开开关。

## 爬虫配置

| 项目 | 探测内容 |
|---|---|
| robots.txt | User-agent 分组、通配组是否禁止全站、Sitemap 声明 |
| sitemap.xml / sitemap_index.xml / sitemap-index.xml | 是否识别 urlset / sitemapindex 根节点及 loc 数量；不是完整 XML 校验 |
| llms.txt | 是否存在；这是社区约定，不保证 AI 收录 |
| HTML | robots / googlebot noindex、canonical 链接、title |

使用 Vite 最终 `publicDir`，支持自定义目录和 `false`。根目录文件只标为源码候选，未承诺会被部署。超出 256 KiB、符号链接或读取失败标为 unknown，并给出限制说明。**本地配置探测不能证明线上可访问、搜索引擎收录或 AI 推荐。**

这些结果也显示在启动横幅，并写入 `log/project-guide.json` 的 `engineering.crawler`。

## 当前路由截图

面板会先探测 CDP，只有能连接到对应页面的 WebSocket 时才开放截图按钮。不会仅根据 User-Agent 声称可截图，也不会选 Chrome 第一个标签页。

- 按页面 origin + pathname 唯一匹配；多个相同地址标签页时跳过，避免误截。
- 不导航浏览器，不调用其他项目页面。
- 截图临时显示项目名、路由与时间，完成后移除标记。
- PNG 及同名 JSON 保存到 `log/<port>/snapshots/`，`index.json` 保留最近 100 条元数据；索引条数不等于磁盘清理策略。
- JSON 包含 project、pathname、origin、time、file、engine、browser、reason，不记录地址中的 query/hash/账号密码。PNG 包含页面当前可见内容。

要使用截图，Chrome/Chromium 需启用 CDP，例如以 `--remote-debugging-port=9222` 启动专用开发浏览器。未开启时其余日志照常工作，面板如实显示不可用。当前实现自动检测本机 Chrome 进程及 9222–9232 常用端口。

## Agent 接口

```text
GET  /__agent-eyes/status?page=<encoded origin+pathname>
POST /__agent-eyes/capture?page=<encoded origin+pathname>
GET  /__agent-eyes/image/<PNG filename>
```

只接受本项目主机地址。capture 返回 PNG 文件名，失败时返回原因。使用页面右下角入口可自动传当前路由。Vue/React 的 history 路由按 pathname 匹配；hash 路由当前仅标记 pathname，不区分 fragment 子路由。

## 配置关闭

```ts
agentEyes({
  visual: false, // 关闭面板与网页入口
})

agentEyes({
  telemetry: { screenshots: false }, // 关闭错误截图及默认面板截图
})
```

也可独立使用 `agentVisual(options)`；它只包含面板与截图接口，不自动安装日志采集器。
