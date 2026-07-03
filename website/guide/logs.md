# 日志总览

日志是这个插件的核心产物——所有的运行时观测、agent 自愈、bug 定位，都建立在这些文件上。这页告诉你有哪些日志、分别什么时候看、怎么验证它们在正常工作。

## 先看哪个

如果你不知道从哪开始，按这个顺序：

1. **`errors.log`** — 最常用。只记 API 失败和前端错误，聚合去重 + 频率计数，顶部是 `Top Errors`。想知道"哪坏了"看这个。
2. **`api-calls.log`** — 最全。所有 API（成功+失败）+ 路由跳转，带请求/响应体。想知道"刚才那个接口返回了什么"看这个。
3. **`proxy-<host>.log`** — 网络/鉴权层。fetch 看不到的 `Cookie` / `Set-Cookie` 属性在这里。登录态问题必看。

其他日志按需翻。

## 完整清单

运行时日志写进 `log/<port>/`（`*.log` 不入库），每次启动清空，**最新记录在文件最上方**，`head` 即看本次会话。顶层 `log/instances.json` 记录当前端口、分支、进程和启动时间。

| 文件 | 内容 | 何时看 |
|------|------|--------|
| **log/\<port\>/errors.log** | API 失败 + 前端运行时错误，**聚合去重 + 频率计数**（0.2.0） | 只看「哪坏了」、哪个刷得最凶 |
| **log/\<port\>/api-calls.log** | 全部 API（成功 + 失败）+ 路由跳转，带请求/响应体 | 查接口契约、定字段、调用顺序 |
| **log/\<port\>/proxy-\<host\>.log** | 代理层 `Cookie` / `Set-Cookie` 属性 / status | 网络/鉴权层（fetch 看不到） |
| **log/\<port\>/console.log** | 全级别控制台输出（log/warn/error/info/debug） | React dev warning、库 deprecation、调试信息 |
| **log/\<port\>/interaction.log** | click/input/change/submit/route 脱敏交互轨迹 | 还原复现路径、定位"人或 agent 做了什么" |
| **log/\<port\>/snapshots/** | 错误截图（PNG）+ DOM 快照（HTML） | 视觉+结构双重现场 |
| **log/\<port\>/auth-state.json** | 最近一次登录成功的脱敏账户画像 | 还原 UI、浏览器控制、确认当前账号 |
| **log/guard-report.json** | 提交前 guard 的最近一次 JSON 报告 | 看 commit 被阻断或预警的原因 |

## 怎么验证日志在写

跑起来后，最简单的验证方式：

```bash
# 当前在跑的 dev server 用哪个端口
cat log/instances.json
# 输出类似：[{"port":5173,"dir":"log/5173","branch":"main","pid":12345,...}]

# 看本次会话的 API 调用（最新在最上面）
head log/5173/api-calls.log

# 看本次会话的错误
head log/5173/errors.log
```

`log/README.md` 是给 agent 的自描述入口（启动时自动生成），agent 不知道该读哪个文件时，让它先读这个。

## 下一步

- 截图和 DOM 快照怎么开 → [错误截图 + DOM 快照](./snapshots)
- 想记录登录账户 → [登录态画像](./auth-profile)
- 想看 API 细节 → [API 参考](../api/agent-debugger)
