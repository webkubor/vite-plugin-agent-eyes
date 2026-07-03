# 招牌案例：登录成功却 401

```
log/<port>/api-calls.log:          POST .../auth/login  code=0          ← 登录成功
log/<port>/api-calls.log:          GET  .../auth/session code=40101     ← 紧跟却未登录
log/<port>/proxy-api.example.com.log: GET .../auth/session → 200 | Cookie(req): 无   ← 浏览器没带 cookie
```

`agentProxy` 默认在本地 `http://localhost` 把上游 `Set-Cookie` **去 `Domain`（变 host-only）、剥 `Secure`、`SameSite=None → Lax`**——解决「后端 cookie 是父域 + Secure + SameSite=None，浏览器在 http 上拒收 → 登录成功却下个请求不带 cookie → 401」这一经典 dev 坑。

测试/生产 https 同域不受影响。要关掉：`agentProxy(target, { rewriteCookiesForLocalhost: false })`。
