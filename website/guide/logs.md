# 运行时日志

运行时日志写进 `log/<port>/`（`*.log` 不入库），每次启动清空，**最新记录在文件最上方**，`head` 即看本次会话。顶层 `log/instances.json` 记录当前端口、分支、进程和启动时间。

| 文件 | 内容 | 何时看 |
|------|------|--------|
| **log/\<port\>/api-calls.log** | 全部 API（成功 + 失败）+ 路由跳转，带请求/响应体 | 查接口契约、定字段、调用顺序 |
| **log/\<port\>/errors.log** | API 失败 + 前端运行时错误，**聚合去重 + 频率计数**（0.2.0） | 只看「哪坏了」、哪个刷得最凶 |
| **log/\<port\>/console.log** | 全级别控制台输出（log/warn/error/info/debug） | React dev warning、库 deprecation、调试信息 |
| **log/\<port\>/interaction.log** | click/input/change/submit/route 脱敏交互轨迹 | 还原复现路径、定位“人或 agent 做了什么” |
| **log/\<port\>/proxy-\<host\>.log** | 代理层 `Cookie` / `Set-Cookie` 属性 / status | 网络/鉴权层（fetch 看不到） |
| **log/\<port\>/snapshots/** | 错误截图（PNG）+ DOM 快照（HTML） | 视觉+结构双重现场 |
| **log/\<port\>/auth-state.json** | 最近一次登录成功的脱敏账户画像 | 还原 UI、浏览器控制、确认当前账号 |
| **log/guard-report.json** | 提交前 guard 的最近一次 JSON 报告 | 看 commit 被阻断或预警的原因 |

`log/README.md` 是给 agent 的自描述入口（启动时自动生成）。`errors.log` 顶部是 `Top Errors`（按频率降序），省去 agent 自己数频率。
