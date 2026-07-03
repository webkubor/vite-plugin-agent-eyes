---
layout: home

hero:
  name: agent-eyes
  text: 让你和 AI agent 都看清浏览器里发生了什么
  tagline: 把 fetch 看不到的 cookie、转瞬即逝的错误、对不上的接口字段，全部落成结构化日志。还有本地 cookie 修复和提交前风险门禁。
  image:
    src: https://vitejs.dev/logo.svg
    alt: Vite
  actions:
    - theme: brand
      text: 开始使用
      link: /guide/why
    - theme: alt
      text: API 参考
      link: /api/agent-debugger
    - theme: alt
      text: GitHub
      link: https://github.com/webkubor/vite-plugin-agent-eyes

features:
  - icon: 📡
    title: 运行时遥测
    details: 结构化日志让 agent 在不看代码的前提下，自己读日志、定位、修复、验证。每次启动清空，最新在最上。
    link: /guide/logs
    linkText: 了解日志格式 →
  - icon: 🍪
    title: 本地 Cookie 修复
    details: 自动改写上游 Set-Cookie 的 Domain/Secure/SameSite，解决 dev 环境「登录成功却一直 401」的经典坑。
    link: /guide/case-401
    linkText: 看招牌案例 →
  - icon: 🔐
    title: 登录态画像
    details: 记录脱敏后的账户画像，agent 能快速知道当前浏览器是谁，无需翻 token/cookie。
    link: /guide/auth-profile
  - icon: 🧭
    title: 交互轨迹
    details: 自动记录 click/input/change/submit/route 脱敏轨迹，还原「先到哪个页面、点了哪个按钮」。
    link: /guide/interactions
  - icon: 🛡️
    title: 提交前门禁
    details: Human Guard 在 commit 前拦明显错误、敏感信息、超大文件和屎山信号；dev 期 Size Watch 实时警告超长文件。
    link: /guide/guard
    linkText: 配置门禁 →
  - icon: 📸
    title: 错误截图 + DOM 快照
    details: 前端错误或 API 失败自动截图（CDP）+ dump DOM 结构，视觉与结构双重现场。
    link: /guide/snapshots
  - icon: ⚡
    title: 框架无关
    details: 纯 Vite 插件 + 浏览器原生 API。React、Vue、Svelte、Solid、原生 JS 都能用。
  - icon: 🤖
    title: Agent 原生
    details: 一键自动埋点 autoInstrument()，覆盖 fetch/XHR/导航/错误/控制台/快照/交互，幂等防 HMR 重复包装。
    link: /api/auto-instrument
---
