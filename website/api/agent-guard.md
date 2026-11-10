# agentGuard()

### `agentGuard(options?): Plugin`

| 选项 | 默认 | 说明 |
|------|------|------|
| `level` | `'block'` | `warn` 只报告；`block` 阻断红线；`strict` 当前等同 `block`，预留更严格门禁 |
| `checks` | 全部内置检查 | 数组形式选择检查项，或对象形式细调严重度/阈值 |
| `reportFile` | `'log/guard-report.json'` | 最近一次 guard JSON 报告路径 |

### 内置检查项

| 检查项 | 默认等级 | 说明 |
|--------|----------|------|
| `secrets` | block | staged diff 中疑似 token、secret、private key、webhook URL |
| `largeFiles` | block | staged 文件超过 1 MB |
| `fileLength` | warn | 超过 400 行警告、800 行阻断（`{ warn, block }` 可调） |
| `todo` | warn | 新增 TODO / FIXME / HACK |
| `noAny` | warn | TypeScript 新增显式 `any` |
| `noConsoleLog` | warn | 前端源码新增 `console.log` |
| `cssVars` | **block** | 新增行里 `var(--x)` 引用了从未声明的自定义属性（0.14.0+） |

### `cssVars` 子选项

| 配置 | 默认 | 说明 |
|------|------|------|
| `declareFrom` | `[]` | 额外声明来源（相对仓库根）。设计 token 包在 `node_modules` 里、不被 git 跟踪，必须在此点明 |
| `ignorePrefixes` | `--radix-` `--tw-` `--vaul-` `--sonner-` `--swiper-` | 框架运行时注入的变量，静态扫描找不到声明，纳入只会固定误报 |

```ts
agentGuard({
  checks: {
    cssVars: { declareFrom: ['node_modules/@acme/design-tokens/tokens.css'] },
  },
})
```

它为什么是 block 级、以及两条防误报设计，见 [Guard 指南](../guide/guard)。

### 设计 token 提交检查（0.18.0+）

`designTokens` 默认启用、严重度为 `warn`，只检查 staged 新增行。检测 `.css/.scss/.less/.vue/.tsx/.jsx/.ts/.js/.astro/.svelte` 中的 3/4/6/8 位 hex、`rgb/rgba/hsl/hsla/oklch/oklab/lab/lch/color()` 数值字面量及 Tailwind `bg-[#fff]` 等任意值。提示：「硬编码颜色，应使用项目 tokens（见 DESIGN.md）」。

```ts
agentGit({
  guard: {
    checks: {
      designTokens: {
        level: 'block', // 默认 warn；guard.level: 'warn' 仍会降级
        tokenFiles: ['**/tokens.*', '**/*tokens*.css', '**/theme.*', '**/design-tokens/**', '**/styles/variables.*'],
        allowValues: ['#000', 'rgb(0 0 0)'],
      },
    },
  },
})
```

也可写 `designTokens: false` 关闭、`designTokens: 'block'` 阻断，或在 `checks: ['designTokens']` 中单独启用。`tokenFiles` 替换默认列表，路径相对仓库根，支持 `*`、`**`、`?`（`**/` 可匹配根目录）。`allowValues` 精确匹配单个颜色字面量，忽略大小写和首尾空格。

默认豁免上述 token 文件、自定义属性声明、行注释/块注释/HTML 注释、测试与 fixture 目录及 `.test/.spec/.fixture` 文件；SVG 资源不参与扫描。`transparent`、`currentColor`、`inherit` 和纯 `var()` 引用不报告。同一行普通声明仍会检查，每行最多报告一次。此检查是轻量文本检查，不解析完整 CSS/JS AST；跨行颜色函数、计算表达式与命名颜色不在当前检测范围。升级或改配置后重新启动 dev，以重写 Git hook。
