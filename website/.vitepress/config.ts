import { defineConfig } from 'vitepress'

// GitHub Pages 部署在 https://webkubor.github.io/vite-plugin-agent-eyes/
// 必须设 base 为仓库子路径，否则静态资源 404
export default defineConfig({
  lang: 'zh-CN',
  title: 'vite-plugin-agent-eyes',
  description: '给 AI agent 的自愈遥测层，也给人一道提交前风险门禁。',
  base: '/vite-plugin-agent-eyes/',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['meta', { name: 'theme-color', content: '#646cff' }],
    ['link', { rel: 'icon', href: 'https://vitejs.dev/logo.svg', type: 'image/svg+xml' }],
  ],

  themeConfig: {
    siteTitle: 'agent-eyes',

    nav: [
      { text: '指南', link: '/guide/why', activeMatch: '/guide/' },
      { text: 'API', link: '/api/agent-debugger', activeMatch: '/api/' },
      {
        text: '资源',
        items: [
          { text: 'npm 包', link: 'https://www.npmjs.com/package/vite-plugin-agent-eyes' },
          { text: 'GitHub', link: 'https://github.com/webkubor/vite-plugin-agent-eyes' },
          { text: '更新日志', link: 'https://github.com/webkubor/vite-plugin-agent-eyes/releases' },
          { text: 'Agent 手册', link: 'https://github.com/webkubor/vite-plugin-agent-eyes/blob/master/AGENT_GUIDE.md' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始',
          collapsed: false,
          items: [
            { text: '为什么', link: '/guide/why' },
            { text: '安装', link: '/guide/install' },
            { text: '快速上手', link: '/guide/quickstart' },
          ],
        },
        {
          text: '核心能力',
          collapsed: false,
          items: [
            { text: '运行时日志', link: '/guide/logs' },
            { text: '错误截图 + DOM 快照', link: '/guide/snapshots' },
            { text: '登录态画像', link: '/guide/auth-profile' },
            { text: '交互轨迹', link: '/guide/interactions' },
          ],
        },
        {
          text: '提交前门禁',
          collapsed: false,
          items: [
            { text: 'Git 工作流', link: '/guide/git-workflow' },
            { text: 'Human Guard', link: '/guide/guard' },
            { text: 'Size Watch', link: '/guide/size-watch' },
          ],
        },
        {
          text: '更多',
          collapsed: true,
          items: [
            { text: '招牌案例：登录成功却 401', link: '/guide/case-401' },
            { text: '框架无关性', link: '/guide/framework-agnostic' },
            { text: '已知局限 & Roadmap', link: '/guide/roadmap' },
          ],
        },
      ],
      '/api/': [
        {
          text: '服务端 API',
          items: [
            { text: 'agentDebugger()', link: '/api/agent-debugger' },
            { text: 'agentProxy()', link: '/api/agent-proxy' },
            { text: 'agentGit()', link: '/api/agent-git' },
            { text: 'agentGuard()', link: '/api/agent-guard' },
            { text: 'agentSizeWatch()', link: '/api/agent-size-watch' },
          ],
        },
        {
          text: '客户端 API',
          items: [
            { text: 'autoInstrument()', link: '/api/auto-instrument' },
            { text: '其他客户端函数', link: '/api/client-functions' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/webkubor/vite-plugin-agent-eyes' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/vite-plugin-agent-eyes' },
    ],

    outline: {
      label: '本页目录',
      level: [2, 3],
    },

    docFooter: {
      prev: '上一页',
      next: '下一页',
    },

    lastUpdatedText: '最后更新',

    pageNav: true,
    sidebarMenuLabel: '目录',

    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索',
            buttonAriaLabel: '搜索',
          },
          modal: {
            noResultsText: '无匹配结果',
            startScreen: { recentSearchesText: '最近搜索', noRecentSearchesText: '无最近搜索' },
          },
        },
      },
    },

    footer: {
      message: '基于 <a href="https://opensource.org/licenses/MIT">MIT 协议</a>发布',
      copyright: 'Copyright © 2026 webkubor',
    },
  },
})
