# 已知局限 & Roadmap

- **🟡 敏感脱敏仍需扩展**：`csrfToken` 等 camelCase 变体已覆盖（0.2.0），但 `ssn` / `credit_card` / `cvv` 等 PII 未纳入黑名单——按业务需要自行扩展 `redact` 或用 `raw` 控制。
- **🟡 长日志仍可能截断半行**：`maxBytes` 截断当前按字符，下个版本改为按行 + 字节精确衡量。
- **🟡 dev server 退出时未 flush**：节流窗口内最后一批 buffer（console/截图）可能不落盘，下个版本挂 server `close` hook。
- **🟡 日志关联仍靠 cid 字符串匹配**：当前通过 correlation ID 串联同一次错误的 console/DOM/screenshot，但文件名和日志行里的 cid 需要 agent 自己 grep 匹配。下个版本可加索引文件 `log/correlations.json`。
- **🟡 DOM 快照只抓 body.innerHTML**：不含 computed styles / pseudo elements，视觉相关问题仍依赖 CDP 截图。下个版本可考虑抓关键元素的盒模型数据。

> 欢迎在 [Issues](https://github.com/webkubor/vite-plugin-agent-eyes/issues) 反馈，或直接 PR。
