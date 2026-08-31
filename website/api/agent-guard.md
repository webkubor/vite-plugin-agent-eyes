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
