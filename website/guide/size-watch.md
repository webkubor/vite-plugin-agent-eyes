# Size Watch

## 什么时候用这个

当 AI 写代码**把文件越堆越长**时（尤其是 CSS）——你想在文件膨胀的**当下**就收到提醒，而不是等到提交时才被拦。

关键区别：

- **`agentGuard()` 是提交时拦**——文件已经写到 800 行、`git commit` 时才阻断，发现得太晚。
- **`agentSizeWatch()` 是写代码当下就 warn**——dev 启动扫一遍源文件，之后每次保存对改动文件增量检查，超阈值就在 Vite 控制台 `[agent-eyes:size]` 黄色 warn。**更早发现，更早拆分。**

适合：

- AI 帮你改样式，习惯往一个 `global.css` / `theme.scss` 里不断追加，文件悄悄从 200 行涨到 600 行你都没察觉。
- 多个 AI 会话各自往同一个工具文件 / 常量文件里堆代码，没人主动重构。
- 想在 dev 期就建立"文件不该无限变长"的意识，而不是等 code review 或 CI。

**什么时候不需要**：完全手写、能自觉控制文件规模的小项目；或者你已经有 ESLint 之类的行数规则覆盖了同样诉求。注意 size-watch **只 warn 不阻断、不影响 build**，它是提醒工具，不是门禁。

## 最小可用示例

```ts
// vite.config.ts —— 默认即可，零参数开箱即用
import { agentSizeWatch } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentSizeWatch(),  // 默认：通用 400 行、CSS/SCSS/Less 300 行
  ],
})
```

想调阈值或排除某些目录时再传参：

```ts
agentSizeWatch({ warn: 400, cssWarn: 300, exclude: /vendor/ })
```

> Astro 项目同理：把 `agentSizeWatch()` 加进 `astro.config` 的 `vite.plugins` 即可。

## 完整配置说明

| 选项 | 默认 | 说明 |
|------|------|------|
| `enabled` | `true` | 关掉整个看门狗 |
| `warn` | `400` | 通用源码（ts/tsx/js/vue/svelte/astro…）行数警告阈值 |
| `cssWarn` | `300` | CSS/SCSS/Sass/Less 行数警告阈值（更严） |
| `include` | 常见源码 + 样式扩展名 | 纳入扫描的文件正则 |
| `exclude` | `node_modules`/`dist`/`build`/`.git`/`.astro`/`.next`/`.nuxt`/`coverage`/`log` | 排除路径正则（相对项目根匹配） |

二进制 / 超过 1 MB 的文件直接跳过。

## 配了之后会发生什么

- **dev server 启动时**：全量扫一遍纳入范围的源文件，超阈值的立刻 warn。
- **之后每次保存**：对改动的文件做增量检查，超阈值就在 Vite 控制台打印一行 **黄色 `[agent-eyes:size]`** warn。
- **只 warn，不阻断、不影响 build**：dev 看到的警告不会让 `git commit` 失败，也不会让 `vite build` 失败。要"阻断提交"是 `agentGuard()` 的事（见下一步）。

**怎么验证你配对了**：

1. 加上 `agentSizeWatch()` 启动 `vite dev`。
2. 找一个还没超阈值的 `.css` 或 `.ts` 文件，往里粘贴内容让它超过 300 行（CSS）或 400 行（通用），保存。
3. Vite 控制台应立刻出现一条 `[agent-eyes:size]` 开头的黄色 warn，点名是哪个文件、当前多少行、阈值多少。
4. 确认 `vite build` 不受影响——这个插件只是提醒，不进构建产物。

## 真实场景：AI 把 CSS 越堆越长

你让 AI 帮你逐步加样式，它每次都在同一个 `src/styles/global.css` 里追加——改首页加 50 行，改列表页加 80 行，改弹窗又加 120 行。文件悄悄从 200 行涨到 600 行，你全程没注意，因为它每次改动看起来都"合理"。

如果配了 `agentSizeWatch()`（CSS 阈值默认 300 行）：

- 文件涨到 301 行的那次保存，控制台就 warn 了——`[agent-eyes:size] src/styles/global.css 301 lines (cssWarn=300)`。
- 你第一时间就知道该把它拆成 `global.css` + `home.css` + `list.css`，而不是等到它膨胀到 600 行、提交时被 guard 拦、再回头痛苦地拆。

## 下一步

- [Human Guard](./guard.md) —— size-watch 是"写时提醒"，guard 是"提交时阻断"，两者互补。
- [Git 工作流](./git-workflow.md) —— 如何把 size-watch（dev 期）和 guard/git（提交期）组合成完整的质量分层。
- [API: agentSizeWatch](../api/agent-size-watch.md) —— `enabled` / `warn` / `cssWarn` / `include` / `exclude` 全部选项参考。
