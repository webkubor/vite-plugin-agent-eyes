/**
 * 把「怎么用这些日志」写进 agent 指令文件（CLAUDE.md / AGENTS.md / GEMINI.md）。
 *
 * 为什么要自动写：日志一直都在，但 agent 不会主动 `ls log/` —— 它读的是项目指令文件。
 * AGENT_BOOTSTRAP.md 原来要求人手动粘贴那段规则，于是现实中没人贴、能力等于没建
 * （2026-09-08 实测：四个装了本插件的仓，指令文件里提到 agent-eyes 的是 0 个，
 * 期间 agent 反复靠读类型定义和注释猜接口字段并猜错）。
 */

import fs from 'node:fs'
import path from 'node:path'

const BEGIN = '<!-- agent-eyes:begin -->'
const END = '<!-- agent-eyes:end -->'

/** 只写已存在的指令文件，不在别人仓库里凭空造文件。 */
const DOC_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'] as const

/** 指令文件会进每个会话的上下文，所以这段必须短 —— 只给入口和顺序，细节留给 log/README.md。 */
function renderBlock(logDirLabel: string): string {
  return `${BEGIN}
## 运行时视野（vite-plugin-agent-eyes 自动维护，勿手改此块）

本项目 dev 期把**真实**请求/响应、报错、控制台、交互轨迹写到 \`${logDirLabel}/\`。
**排查前端/接口/登录/样式问题前先读它，不要从源码或类型定义反推。**

\`\`\`bash
ls ${logDirLabel}/                        # 有哪些端口在跑
cat ${logDirLabel}/<port>/api-calls.log   # 真实请求体 + 响应体
cat ${logDirLabel}/<port>/errors.log      # 报错（聚合去重，最新在最上）
\`\`\`

| 想知道 | 读哪个 |
|---|---|
| 接口返回什么字段、值是什么 | \`<port>/api-calls.log\` ← **字段真源，类型定义和注释都不是** |
| 哪里报错了 | \`<port>/errors.log\` |
| 用户点了什么才出错 | \`<port>/interaction.log\` |
| 登录/cookie/CORS/302 | \`<port>/proxy-<host>.log\` |
| 当前登录的是谁 | \`<port>/auth-state.json\`（脱敏画像，无 token） |
| 页面长什么样 | \`<port>/snapshots/\`（PNG + DOM 快照） |
| 提交被门禁拦了 | \`${logDirLabel}/guard-report.json\` |

注意：大响应体在日志里会被截断，整份 JSON 解析会失败，按单个 item 的花括号配平解析。
日志每次 dev 启动清空，看到的就是本次。改完 vite 配置要重启 dev 再验。
完整说明见 \`${logDirLabel}/README.md\` 与 \`node_modules/vite-plugin-agent-eyes/AGENT_GUIDE.md\`。
${END}`
}

function upsert(content: string, block: string): string {
  const i = content.indexOf(BEGIN)
  const j = content.indexOf(END)
  if (i !== -1 && j > i) {
    return content.slice(0, i) + block + content.slice(j + END.length)
  }
  const base = content.replace(/\s*$/, '')
  return base ? `${base}\n\n${block}\n` : `${block}\n`
}

/**
 * 幂等同步：内容没变就不写，避免每次 dev 启动都给 CLAUDE.md 制造 git diff。
 * @returns 实际被更新的文件名
 */
export function syncAgentInstructions(root: string, logDirLabel = 'log'): string[] {
  const block = renderBlock(logDirLabel)
  const updated: string[] = []
  for (const name of DOC_FILES) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue
    let current: string
    try {
      current = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const next = upsert(current, block)
    if (next === current) continue
    try {
      fs.writeFileSync(file, next)
      updated.push(name)
    } catch {
      // 只读文件不阻断 dev
    }
  }
  return updated
}

export const AGENT_DOC_MARKERS = { BEGIN, END }
