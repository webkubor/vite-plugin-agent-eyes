# Size Watch

`agentGuard()` 在**提交时**才拦超长文件，`agentSizeWatch()` 则在**写代码当下**就提示——dev 启动扫一遍源文件，之后每次保存对改动文件增量检查，超阈值就在 Vite 控制台 `[agent-eyes:size]` 黄色 warn。**只 warn，不阻断、不影响 build**。专治 AI 把 CSS 越堆越长的屎山文件，早期就能看见。

```ts
import { agentSizeWatch } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentSizeWatch(), // 默认即可：通用 400 行、CSS/SCSS/Less 300 行
    // 或自定义：agentSizeWatch({ warn: 400, cssWarn: 300, exclude: /vendor/ })
  ],
})
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `enabled` | `true` | 关掉整个看门狗 |
| `warn` | `400` | 通用源码（ts/tsx/js/vue/svelte/astro…）行数警告阈值 |
| `cssWarn` | `300` | CSS/SCSS/Sass/Less 行数警告阈值（更严） |
| `include` | 常见源码 + 样式扩展名 | 纳入扫描的文件正则 |
| `exclude` | `node_modules`/`dist`/`build`/`.git`/`.astro`/`.next`/`.nuxt`/`coverage`/`log` | 排除路径正则（相对项目根匹配） |

二进制 / 超过 1 MB 的文件直接跳过。Astro 项目同理把 `agentSizeWatch()` 加进 `astro.config` 的 `vite.plugins`。
