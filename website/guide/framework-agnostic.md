# 框架无关性

vite-plugin-agent-eyes 是一个**纯 Vite 插件**，配合**浏览器原生 API**（`fetch` / `XMLHttpRequest` / `history`）工作，不依赖 React、Vue、Svelte、Solid 等任何前端框架。`agentEyes()` 会在本地 dev 自动注入客户端埋点；底层 `autoInstrument()` 直接劫持浏览器原生的网络与导航接口，不挂载到任何框架的组件树里。因此只要你的项目用 Vite 构建，无论用哪种框架——甚至原生 JS——都能直接接入。

下面是一个在**非 React 项目**（原生 JS / Vue / Svelte 均同理）里的最小配置，和服务端用法完全一致：

```ts
import { defineConfig } from 'vite'
import { agentEyes, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [...agentEyes()],
  server: {
    proxy: {
      '/api': agentProxy('https://your-api.example.com'),
    },
  },
})
```

普通项目不需要再手动修改客户端入口；只有关闭 `agentEyes({ client: false })` 后，才需要在 Vue 的 `main.ts`、Svelte 的 `main.ts` 或原生 JS 的页面入口里手动调用 `autoInstrument()`。

需要注意：本插件不提供任何框架专属能力（例如 React DevTools 集成、Vue 组件树快照等）。它只关心浏览器网络层、控制台、错误和 DOM 结构，这些在任何框架下都一样。
