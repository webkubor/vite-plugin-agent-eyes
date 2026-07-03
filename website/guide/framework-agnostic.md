# 框架无关性

vite-plugin-agent-eyes 是一个**纯 Vite 插件**，配合**浏览器原生 API**（`fetch` / `XMLHttpRequest` / `history`）工作，不依赖 React、Vue、Svelte、Solid 等任何前端框架。服务端侧只是普通的 Vite 插件与 dev server 中间件；客户端侧的 `autoInstrument()` 直接劫持浏览器原生的网络与导航接口，不挂载到任何框架的组件树里。因此只要你的项目用 Vite 构建，无论用哪种框架——甚至原生 JS——都能直接接入。

下面是一个在**非 React 项目**（原生 JS / Vue / Svelte 均同理）里的最小配置，和服务端用法完全一致：

```ts
import { defineConfig } from 'vite'
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentDebugger()],
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'),
    },
  },
})
```

客户端入口（Vue 用 `main.ts`，Svelte 用 `main.ts`，原生 JS 用页面最早加载的脚本）只需一行：

```ts
import { autoInstrument } from 'vite-plugin-agent-eyes/client'
autoInstrument()
```

需要注意：本插件不提供任何框架专属能力（例如 React DevTools 集成、Vue 组件树快照等）。它只关心浏览器网络层、控制台、错误和 DOM 结构，这些在任何框架下都一样。
