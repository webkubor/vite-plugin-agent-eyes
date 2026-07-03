# 交互轨迹

**交互轨迹**（0.10.0+）：`autoInstrument()` 默认安装，也可手动调用：

```ts
import { installAgentInteractionTracer, recordInteraction } from 'vite-plugin-agent-eyes/client'

installAgentInteractionTracer()
recordInteraction('click', buttonElement)
```

`input` / `change` 只写 `<redacted>`，不会保存真实表单值；dev server 会写入 `log/<port>/interaction.log`，用于还原“先到哪个页面、点了哪个按钮、在哪个表单触发问题”。
