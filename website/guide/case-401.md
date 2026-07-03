# 招牌案例：登录成功却一直 401

这是 dev 调试中最让人崩溃的场景之一，也是这个插件最能体现价值的地方。如果你曾被它折磨过，这页会告诉你根因和解法。

## 场景

你有一个标准的登录流程：

1. 用户输入账号密码，点登录
2. `POST /api/auth/login` 返回 **成功**（code=0，200 OK）
3. 紧接着前端请求 `GET /api/auth/session` 拿用户信息
4. **结果：401 未登录**

你开始排查：
- ✅ localStorage 里有 token
- ✅ 登录接口确实成功了
- ✅ Postman 直接调 session 接口能用
- ❌ 但浏览器里就是 401

## 为什么难查

因为问题的真相藏在 **fetch 看不到的地方**——cookie 的属性里。

后端登录接口通常会 `Set-Cookie`，而这个 cookie 在 dev 环境下经常是这样的：

```
Set-Cookie: session=xxx; Domain=.example.com; Secure; SameSite=None
```

三个属性在本地 `http://localhost` 下全部失效：

| 属性 | 后端设的 | 本地 http 的反应 |
|---|---|---|
| `Domain=.example.com` | 父域 cookie | localhost 不属于 example.com，**拒收** |
| `Secure` | 只走 https | 本地是 http，**拒收** |
| `SameSite=None` | 跨站必须配 Secure | Secure 没满足，**拒收** |

浏览器默默拒收了 cookie，下一个请求自然不带 cookie，于是 401。而**这一切在 fetch / 控制台 / Network 面板里都看不全**——你只能看到请求和响应，看不到 cookie 为什么没被存下来。

## 装上 agent-eyes 后

加上 `agentProxy` 后，proxy 日志会把 cookie 的来龙去脉全部记下来。在 `log/<port>/proxy-<host>.log` 里你能直接看到：

```
log/<port>/api-calls.log:          POST .../auth/login  code=0          ← 登录成功
log/<port>/api-calls.log:          GET  .../auth/session code=40101     ← 紧跟却未登录
log/<port>/proxy-api.example.com.log: GET .../auth/session → 200 | Cookie(req): 无   ← 浏览器没带 cookie
```

第三行是关键证据：**请求里根本没有 cookie**。结合第一条登录成功，你立刻知道问题出在"cookie 没被浏览器存下来"，而不是 session 接口本身。

## 根因 + 自动解决

`agentProxy` 默认在本地 `http://localhost` 把上游的 `Set-Cookie` 自动改写：

- **去 `Domain`**（变成 host-only cookie，localhost 能存）
- **剥 `Secure`**（http 下也能存）
- **`SameSite=None → Lax`**（不再要求 Secure 配对）

这样改写后，cookie 能正常存进浏览器，下一个请求自动带上，401 消失。

测试/生产 https 同域不受影响——这个改写只在本地 dev 生效。

## 配置示例

```ts
import { defineConfig } from 'vite'
import { agentDebugger, agentProxy } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [agentDebugger()],
  server: {
    proxy: {
      // 默认就开启 cookie 修复，不用额外配置
      '/api': agentProxy('https://your-api.example.com'),
    },
  },
})
```

::: warning 想关掉这个行为？
如果你的后端 cookie 本身就配对了 localhost，或者你想用别的 cookie 方案，可以关掉：

```ts
agentProxy('https://your-api.example.com', {
  rewriteCookiesForLocalhost: false,
})
```
:::

## 下一步

- 想看 proxy 日志的完整字段 → [API: agentProxy](../api/agent-proxy)
- 想看其他日志文件 → [日志总览](./logs)
- 想加提交前检查 → [Human Guard](./guard)
