# 登录态画像

**记录登录成功账户画像**（0.9.0+）：

```ts
import { recordLoginSuccess } from 'vite-plugin-agent-eyes/client'

recordLoginSuccess({
  userId: currentUser.id,
  email: currentUser.email,        // 写入前自动脱敏为 a***@example.com
  name: currentUser.name,
  roles: currentUser.roles,
  tenantId: currentUser.tenantId,
})
```

这只保存脱敏后的账户画像和登录成功信号，不保存 token、cookie、Authorization、refresh token。浏览器里会注入只读 `window.__AGENT_EYES_AUTH__`，dev server 会写入 `log/<port>/auth-state.json`。
