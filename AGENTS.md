# AGENTS.md — AI 助手工作守则

## 这是什么

vite-plugin-agent-eyes —— 给 AI agent 的自愈遥测层：结构化运行时日志
（API 请求 / 错误 / 交互 / 代理 header）、本地 cookie 修复、登录态画像、
提交前风险 guard。一句话：**让 agent 自己读日志、定位、修复、验证**。

## 关键文件

- `AGENT_GUIDE.md`：**agent 使用本插件的指南 —— 改日志结构前先读它**，下游 agent 依赖这些字段。
- `AGENT_BOOTSTRAP.md`：首次接入的引导流程。
- `SKILL.md`：skill 形态的定义。
- `docs/`：详细文档；`scripts/`：构建脚本。

## 常用命令

```bash
pnpm build        # 构建
pnpm typecheck    # 类型检查
pnpm test         # 测试
pnpm compat       # 兼容性测试
```

## 约定

- **结构化日志的字段是对外契约**（AGENT_GUIDE.md 里声明的字段名/语义）：改字段必须同步指南并考虑向后兼容。
- 遥测只落本地，不引入上报端点 —— 这是「agent 自用」定位，不是监控 SaaS。
- 敏感信息（cookie 值 / header）在日志里默认脱敏，脱敏逻辑不许被绕过。
