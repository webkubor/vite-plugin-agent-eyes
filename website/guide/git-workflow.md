# Git 工作流

让**任意 Vite 项目零配置**获得「提交前检查 + 提交后通知」——装上插件、跑一次 `vite dev`，git 钩子自动就位，无需各项目再配 husky / `.git/hooks`。

```ts
import { agentDebugger, agentGit } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentDebugger(),
    agentGit({
      precommit: ['pnpm typecheck', 'pnpm lint'],        // 任一非零退出即阻断提交
      webhook: {                                          // 单个 webhook
        url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx',
        format: 'feishu',                                 // 内置飞书；或 (info) => 自定义载荷
      },
      guard: { level: 'block' },                         // 0.8.0+：提交前检查 staged 风险
      // claimHooksPath: true,  // 若你用了全局 core.hooksPath（lefthook 等），开此项让本项目钩子生效
    }),
  ],
})
```

**多 webhook 推送**（0.7.0+）：支持同时推送到多个平台（如飞书 + 钉钉 + 企业微信）：

```ts
agentGit({
  precommit: ['pnpm typecheck', 'pnpm lint'],
  webhook: [
    {
      url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxx',
      format: 'feishu',
    },
    {
      url: 'https://oapi.dingtalk.com/robot/send?access_token=yyyy',
      format: (info) => ({
        msgtype: 'text',
        text: { content: `📝 [${info.project}] ${info.author} 提交（${info.branch}）\n🕐 ${info.timestamp}\n${info.message}` }
      }),
    },
    {
      url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=zzzz',
      format: (info) => ({
        msgtype: 'text',
        text: { content: `📝 [${info.project}] ${info.author} 提交（${info.branch}）\n🕐 ${info.timestamp}\n${info.message}` }
      }),
    },
  ],
})
```

**推送信息增强**（0.7.0+）：默认推送信息包含：
- 项目名称
- 提交作者
- **分支名称**（新增）
- **提交时间**（新增，UTC 格式）
- 提交信息

- 钩子内容**自包含**，`git commit` 时独立运行，不依赖 dev server 在跑。
- 只接管带 `agent-eyes managed` 标记的钩子；遇到你已有的、非本插件写的钩子默认**不覆盖**（`force: true` 强制）。
- 自定义通知：`webhook.format` 传 `(info: CommitInfo) => payload`（纯函数，会序列化进钩子脚本），`info` 含 `project / repo / author / branch / message / hash / timestamp`。
- 仅 dev 期安装钩子（`apply: 'serve'`）；不传 `guard` / `precommit` / `webhook` 时为 no-op。
- 多 webhook 时逐个推送，单个失败不影响其他。
