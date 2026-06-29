import type { Plugin, ProxyOptions, ViteDevServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { captureScreenshot } from './cdp'
import { sanitizeAuthProfile, type AgentAuthProfileInput, type AgentAuthState } from './auth-state'
import { formatInteractionLine, type InteractionEntry } from './interaction'

// git workflow（提交前检查 + 提交后 webhook）—— 独立导出，与遥测职责解耦
export { agentGit } from './git'
export type { AgentGitOptions, AgentGitWebhook, CommitInfo } from './git'

// 构建期版本/tag 戳记（只读，不造 tag）
export { agentVersion } from './version'
export {
  agentGuard,
  createGuardHookScript,
  normalizeGuardConfig,
  renderGuardReport,
  runGuard,
} from './guard'
export type {
  AgentGuardChecks,
  AgentGuardLevel,
  AgentGuardOptions,
  GuardReportItem,
  GuardResult,
  GuardSeverity,
} from './guard'

/**
 * vite-plugin-agent-eyes —— 给 AI agent 的自愈遥测层，也提供提交前风险门禁。
 *
 * 设计取向：稳定可解析 / 噪声预分类 / 专补 fetch 看不到的盲区 / 自描述入口 / 服务闭环。
 * 装上后，任意在该项目里干活的 agent 都能读到结构化运行时视野，跑「读日志→定位→改→验证」闭环；
 * 人在提交前也可以通过 agentGuard 看到 staged 风险。
 *
 * 运行时实时流（写进 <logDir>/<port>/，每次启动清空，*.log 不应入库）：
 *  1. api-calls.log —— 全部 API（成功+失败）+ 路由跳转，带请求/响应体。查接口契约、定字段。
 *  2. errors.log    —— API 失败 + 前端运行时错误，聚合去重（相同签名折叠 + 计数）。只看"哪坏了"。
 *  3. proxy-<host>.log —— 代理层 header 真相（Cookie / Set-Cookie / status），fetch 看不到的网络层。
 *  4. interaction.log —— click/input/change/submit/route 脱敏交互轨迹，用来还原复现路径。
 * 提交前报告写进 log/guard-report.json。
 */

export interface AgentDebuggerOptions {
  /** 日志目录（相对项目根），默认 `'log'`；建议加入 `.gitignore`。 */
  logDir?: string
  /** 接收前端上报的端点，默认 `'/dev/log'`；必须和 `autoInstrument({ endpoint })` 保持一致。 */
  endpoint?: string
  /** 日志落盘节流间隔（ms），默认 200——高频上报只批写，不阻塞 dev server */
  flushMs?: number
  /** 单个日志文件大小上限（字节），默认 512KB——超过截断旧记录 */
  maxBytes?: number
  /** 错误时自动截图（通过 CDP），默认 false */
  screenshots?: boolean
}

type ApiPayload = {
  kind: 'api'
  method: string
  path: string
  url: string
  ok: boolean
  duration_ms: number
  code?: number
  status?: number
  request_id?: string
  error?: string
  page_path?: string
  request?: unknown
  response?: unknown
}
type NavPayload = { kind: 'nav'; from: string; to: string }
type ErrorPayload = { kind: 'error'; line: string; cid?: string }
type ConsolePayload = { kind: 'console'; level: string; msg: string }
type ConsoleBatchPayload = { kind: 'console_batch'; entries: { level: string; msg: string; count: number }[] }
type DomPayload = { kind: 'dom'; url: string; html: string; cid?: string }
type AuthPayload = { kind: 'auth'; event?: 'login_success'; state?: Partial<AgentAuthState> }
type InteractionPayload = { kind: 'interaction_batch'; entries: InteractionEntry[] }
type DevLogPayload =
  | ApiPayload
  | NavPayload
  | ErrorPayload
  | ConsolePayload
  | ConsoleBatchPayload
  | DomPayload
  | AuthPayload
  | InteractionPayload

const HEADER_SEP = '\n\n'
const MIN_FLUSH_MS = 1
const MIN_LOG_BYTES = 4096

function warnLine(server: ViteDevServer, message: string) {
  server.config.logger.warn(`\x1b[33m[agent-eyes]\x1b[0m ${message}`)
}

function warnConsole(message: string) {
  console.warn(`\x1b[33m[agent-eyes]\x1b[0m ${message}`)
}

function optionBoundWarnings(owner: string, flushMs: number, maxBytes: number): string[] {
  const warnings: string[] = []
  if (!Number.isFinite(flushMs) || flushMs < MIN_FLUSH_MS) {
    warnings.push(`${owner}.flushMs=${flushMs} 过小，可能导致日志刷盘异常；建议使用默认 200。`)
  }
  if (!Number.isFinite(maxBytes) || maxBytes < MIN_LOG_BYTES) {
    warnings.push(`${owner}.maxBytes=${maxBytes} 过小，可能导致日志几乎立刻截断；建议至少 ${MIN_LOG_BYTES}。`)
  }
  return warnings
}

function warnOptionBounds(server: ViteDevServer, owner: string, flushMs: number, maxBytes: number) {
  optionBoundWarnings(owner, flushMs, maxBytes).forEach((warning) => warnLine(server, warning))
}

function warnEndpoint(server: ViteDevServer, endpoint: string) {
  if (!endpoint.startsWith('/')) {
    warnLine(server, `agentDebugger.endpoint="${endpoint}" 不是以 "/" 开头，客户端上报可能打不到 dev middleware；建议使用 "/dev/log"。`)
  }
}

function proxyTargetWarnings(target: string): string[] {
  try {
    const protocol = new URL(target).protocol
    if (protocol !== 'http:' && protocol !== 'https:') {
      return [`agentProxy target="${target}" 不是 http(s)，proxy header/cookie 日志可能无效。`]
    }
  } catch {
    return [`agentProxy target="${target}" 不是合法 URL；示例：agentProxy("https://api.example.com")。`]
  }
  return []
}

function pad(n: number, size = 2) {
  return String(n).padStart(size, '0')
}
function ts(date = new Date()) {
  const off = -date.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)} ` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

function stable(value: unknown) {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
function limit(text: string, max = 4000) {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text
}
function block(label: string, value: unknown) {
  const text = stable(value)
  return text ? `  ${label}: ${limit(text).replace(/\n/g, '\n  ')}` : ''
}

function apiLine(p: ApiPayload) {
  const method = typeof p.method === 'string' ? p.method.toUpperCase() : String(p.method ?? 'UNKNOWN')
  const pth = typeof p.path === 'string' ? p.path : String(p.path ?? '')
  const status = p.status ? ` http=${p.status}` : ''
  const code = p.code !== undefined ? ` code=${p.code}` : ''
  const rid = p.request_id ? ` requestId=${p.request_id}` : ''
  const page = p.page_path ? ` page=${p.page_path}` : ''
  const err = p.error ? ` error="${String(p.error).replace(/"/g, "'")}"` : ''
  return `[api][${p.ok ? 'ok' : 'failed'}] ${method} ${pth} ${p.duration_ms ?? 0}ms${status}${code}${rid}${page}${err}`
}
function apiDetail(p: ApiPayload) {
  return [apiLine(p), block('提交', p.request), block('返回', p.response)].filter(Boolean).join('\n')
}

function parse(raw: string): DevLogPayload | null {
  try {
    const p = JSON.parse(raw) as Partial<DevLogPayload>
    if (p.kind === 'api' && (p as ApiPayload).method && (p as ApiPayload).path) return p as DevLogPayload
    if (p.kind === 'nav' && (p as NavPayload).to) return p as DevLogPayload
    if (p.kind === 'error' && (p as ErrorPayload).line) return p as DevLogPayload
    if (p.kind === 'console' && (p as ConsolePayload).msg) return p as DevLogPayload
    if (p.kind === 'console_batch' && (p as ConsoleBatchPayload).entries?.length) return p as DevLogPayload
    if (p.kind === 'dom' && (p as DomPayload).html) return p as DevLogPayload
    if (p.kind === 'auth' && (p as AuthPayload).state?.profile) return p as DevLogPayload
    if (p.kind === 'interaction_batch' && (p as InteractionPayload).entries?.length) return p as DevLogPayload
  } catch {
    return null
  }
  return null
}

function safePayloadString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined
}

function authStateFromPayload(p: AuthPayload): AgentAuthState | null {
  if (!p.state?.profile || typeof p.state.profile !== 'object') return null
  const state: AgentAuthState = {
    loggedIn: true,
    updatedAt: safePayloadString(p.state.updatedAt) ?? new Date().toISOString(),
    profile: sanitizeAuthProfile(p.state.profile as AgentAuthProfileInput),
  }
  const pagePath = safePayloadString(p.state.page_path)
  if (pagePath) state.page_path = pagePath
  return state
}

/**
 * 节流批量写入器：高频上报时先攒进内存 buffer，按 flushMs 间隔合并写盘，
 * 避免每条都全量 read+write 整文件（O(n²) 退化）。最新块仍物理排在 header 之后最上方。
 */
class LogWriter {
  private buffer: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private header = ''
  constructor(
    private readonly file: string,
    private readonly flushMs: number,
    private readonly maxBytes: number,
  ) {}

  init(header: string) {
    this.header = header
    this.buffer = []
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      fs.writeFileSync(this.file, `${header}${HEADER_SEP}`)
    } catch {
      /* ignore */
    }
  }

  push(block: string) {
    this.buffer.push(block)
    if (this.timer == null) {
      this.timer = setTimeout(() => this.flush(), this.flushMs)
    }
  }

  private flush() {
    this.timer = null
    if (this.buffer.length === 0) return
    const newBlocks = this.buffer.slice().reverse().join('\n') + '\n'
    this.buffer = []
    let oldBody = ''
    try {
      const content = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8') : ''
      const at = content.indexOf(HEADER_SEP)
      oldBody = at === -1 ? '' : content.slice(at + HEADER_SEP.length)
    } catch {
      /* ignore */
    }
    let body = newBlocks + oldBody
    if (body.length > this.maxBytes) body = body.slice(0, this.maxBytes)
    try {
      fs.writeFileSync(this.file, `${this.header}${HEADER_SEP}${body}`)
    } catch {
      /* ignore */
    }
  }
}

/** 错误签名：去时间戳、归一化源码行列号与已知量纲位置，让"同一错误刷屏"能折叠成一条。保留正文数字，避免把不同错误（如 http=401/403）误折叠。 */
function signature(line: string): string {
  return line
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/:[0-9]+:[0-9]+/g, ':L:C') // 源码行列号
    .replace(/(http=|status=|code=|ms)\s*\d+/gi, '$1N') // 已知量纲位置归一
    .replace(/\/[a-z_-]+s?\/\d+(?=\/|$)/gi, '/:id') // REST 资源 id
    .slice(0, 200)
}

/**
 * 聚合错误写入器：相同签名折叠并计数，文件头部给 Top Errors（按频率降序），
 * 下方保留最近原始记录。agent 一眼看出"哪个错误最频繁"。
 */
class ErrorAggregator {
  private counts = new Map<string, { sig: string; count: number; last: string; lastTs: string }>()
  private recent: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(
    private readonly file: string,
    private readonly header: string,
    private readonly flushMs: number,
    private readonly maxRecent: number,
    private readonly maxSignatures = 500,
  ) {}

  init() {
    this.counts.clear()
    this.recent = []
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      fs.writeFileSync(this.file, `${this.header}${HEADER_SEP}`)
    } catch {
      /* ignore */
    }
  }

  add(rawLine: string, stamp: string) {
    const line = `[${stamp}] ${rawLine}`
    const sig = signature(rawLine)
    const cur = this.counts.get(sig)
    if (cur) {
      cur.count++
      cur.last = line
      cur.lastTs = stamp
    } else {
      // 签名上限：超限淘汰频率最低的，防止动态错误（URL/路径）让 counts Map 无限增长
      if (this.counts.size >= this.maxSignatures) {
        let minKey: string | null = null
        let minVal = Infinity
        for (const [k, v] of this.counts) if (v.count < minVal) { minVal = v.count; minKey = k }
        if (minKey) this.counts.delete(minKey)
      }
      this.counts.set(sig, { sig, count: 1, last: line, lastTs: stamp })
    }
    this.recent.unshift(line)
    if (this.recent.length > this.maxRecent) this.recent.length = this.maxRecent
    if (this.timer == null) {
      this.timer = setTimeout(() => this.flush(), this.flushMs)
    }
  }

  private flush() {
    this.timer = null
    const top = [...this.counts.values()].sort((a, b) => b.count - a.count).slice(0, 20)
    const sections = [
      '# Top Errors（按频率降序，聚合去重）',
      ...(top.length
        ? top.map((e, i) => `${i + 1}. (×${e.count}) ${e.last}  ← last ${e.lastTs}`)
        : ['（暂无）']),
      '',
      '# Recent（原始记录，最新在上）',
      ...(this.recent.length ? this.recent : ['（暂无）']),
    ]
    try {
      fs.writeFileSync(this.file, `${this.header}${HEADER_SEP}${sections.join('\n')}\n`)
    } catch {
      /* ignore */
    }
  }
}

const MANIFEST = `# Agent 自愈遥测（log/）

> 这些日志是**给 AI agent 读的运行时视野**；提交前 guard 报告在 \`log/guard-report.json\`，给人和 agent 共用。
> 由 vite-plugin-agent-eyes 产生，仅本地 dev，**每次启动清空**（只反映本次会话），\`*.log\` 不入库。
> 若需要完整 agent 操作手册，读包内 \`AGENT_GUIDE.md\`；若要让 Codex/Claude/Gemini/Hermes 主动发现，读 \`AGENT_BOOTSTRAP.md\`；README 面向人类安装和 API 评估。

## 排查顺序（读日志 → 定位 → 改 → 重启 dev → 再读验证）

1. **errors.log** —— 先看"哪坏了"：顶部是 Top Errors（聚合去重 + 频率），下方是最近原始记录。
2. **console.log** —— 全级别控制台输出（log/warn/error/info/debug），React dev warning、库 deprecation 警告都在这里。
3. **interaction.log** —— click/input/change/submit/route 脱敏交互轨迹，用来还原复现路径（表单值只记 <redacted>）。
4. **api-calls.log** —— 若是接口问题：看真实请求/响应体（别凭类型猜字段）、调用顺序。
5. **proxy-<host>.log** —— 若是网络/鉴权层：请求带的 Cookie、响应的 Set-Cookie 属性、status。多个代理各自按 target host 分文件。fetch 看不到这层。
6. **auth-state.json** —— 若要还原已登录 UI：看最近一次登录成功的脱敏账号画像。
7. **snapshots/** —— 错误时自动截图（PNG）+ DOM 快照（HTML），视觉+结构双重现场。

最新记录在文件**最上方**（header 之后），\`head\` 即看本次会话最近发生了什么。
errors.log 的 Top Errors 区直接告诉你"哪个错误刷得最凶"，省去自己数频率。

## 典型：登录成功却一直 401（cookie 存不住）
api-calls.log 见 \`POST .../login code=0\` 紧跟 \`GET .../session 401\`
→ proxy-<host>.log 看那条 session 的 Cookie(req)：若为「无」，说明浏览器没存住登录 cookie。
常见根因：上游 Set-Cookie 带父域 Domain + Secure + SameSite=None，http://localhost 域不匹配且 Secure 被丢弃。
修复：agentProxy 已在 dev 对 Set-Cookie 去 Domain / 剥 Secure / SameSite=None→Lax。

## 错误截图 + DOM 快照（snapshots/）
开启 \`agentDebugger({ screenshots: true })\` 后，每次前端错误或 API 失败自动截取当前页面 PNG，存入 log/snapshots/err-{timestamp}.png。
DOM 快照（log/snapshots/dom-{timestamp}.html）始终启用——错误时自动 dump document.body 结构，agent 可解析。
需要 Chrome 带 \`--remote-debugging-port\` 启动（仅截图需要，DOM 快照不需要）。插件自动检测端口，未找到时静默跳过。
`

// 多 agent 并行：同目录、不同端口的多个 dev server 各写 log/<port>/，互不刷掉。
// agentDebugger 在 listening 后解析真实端口并下发给 agentProxy 复用。
let _resolvedLogPort: number | string | null = null
function gitBranch(cwd: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}
// 顶层 log/ 台账：记录哪些端口/分支/进程在写日志，agent 按自己 dev 端口去 log/<port>/ 读
function recordInstance(baseDir: string, port: number | string) {
  const file = path.join(baseDir, 'instances.json')
  let list: Array<Record<string, unknown>> = []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) list = parsed
  } catch {
    /* 文件不存在或损坏，重建 */
  }
  list = list.filter((x) => x && x.pid !== process.pid && x.port !== port)
  list.unshift({ port, dir: `log/${port}`, branch: gitBranch(baseDir), pid: process.pid, startedAt: ts() })
  try {
    fs.writeFileSync(file, JSON.stringify(list.slice(0, 20), null, 2))
  } catch {
    /* ignore */
  }
}

const ROOT_MANIFEST = `# Agent 遥测日志（按 dev 端口隔离）

多个 agent/dev server 可同目录、不同端口并行，**各自的日志在 \`log/<port>/\`**，互不覆盖。

- 你的 dev 端口看 \`cs dev\` / vite 启动输出（如 5175）。
- 你的日志在 \`log/<你的端口>/\`：\`errors.log\` / \`console.log\` / \`interaction.log\` / \`api-calls.log\` / \`proxy-*.log\` / \`auth-state.json\` / \`snapshots/\`。
- \`instances.json\` 列出当前在写日志的端口 / 分支 / pid，方便确认你该读哪个。

读法见 \`log/<port>/README.md\`。
`

/**
 * 安装 Vite dev 遥测插件，写入 agent 可读的 `log/<port>/` 运行时视野。
 *
 * 常见配置错误会在 dev server 启动时以 `[agent-eyes]` 前缀 warning，例如 endpoint 没有 `/`、日志阈值过小。
 *
 * @example
 * ```ts
 * import { defineConfig } from 'vite'
 * import { agentDebugger } from 'vite-plugin-agent-eyes'
 *
 * export default defineConfig({
 *   plugins: [agentDebugger({ screenshots: true })],
 * })
 * ```
 */
export function agentDebugger(options: AgentDebuggerOptions = {}): Plugin {
  const baseDir = path.resolve(process.cwd(), options.logDir ?? 'log')
  const endpoint = options.endpoint ?? '/dev/log'
  const flushMs = options.flushMs ?? 200
  const maxBytes = options.maxBytes ?? 512 * 1024
  const screenshots = options.screenshots ?? false

  // 端口确定后才初始化（log/<port>/）；HTTP 上报只会在 listening 之后到达，故 middleware 引用安全。
  let apiWriter: LogWriter | null = null
  let errAgg: ErrorAggregator | null = null
  let consoleWriter: LogWriter | null = null
  let interactionWriter: LogWriter | null = null
  let snapshotsDir = path.join(baseDir, 'snapshots')
  let authStateFile = path.join(baseDir, 'auth-state.json')

  function initForPort(port: number | string) {
    const logDir = path.join(baseDir, String(port))
    snapshotsDir = path.join(logDir, 'snapshots')
    authStateFile = path.join(logDir, 'auth-state.json')
    fs.mkdirSync(snapshotsDir, { recursive: true })
    const header = `# Dev Log (port ${port}) — started ${ts()}`
    apiWriter = new LogWriter(path.join(logDir, 'api-calls.log'), flushMs, maxBytes)
    errAgg = new ErrorAggregator(path.join(logDir, 'errors.log'), header, flushMs, 200)
    consoleWriter = new LogWriter(path.join(logDir, 'console.log'), flushMs, maxBytes)
    interactionWriter = new LogWriter(path.join(logDir, 'interaction.log'), flushMs, maxBytes)
    apiWriter.init(header)
    errAgg.init()
    consoleWriter.init(header)
    interactionWriter.init(header)
    fs.writeFileSync(path.join(logDir, 'README.md'), MANIFEST)
    fs.writeFileSync(path.join(baseDir, 'README.md'), ROOT_MANIFEST)
    _resolvedLogPort = port // 下发给 agentProxy
    recordInstance(baseDir, port)
  }

  return {
    name: 'vite-plugin-agent-eyes',
    apply: 'serve',
    configureServer(server) {
      warnEndpoint(server, endpoint)
      warnOptionBounds(server, 'agentDebugger', flushMs, maxBytes)
      fs.mkdirSync(baseDir, { recursive: true })
      const hs = server.httpServer
      if (hs) {
        hs.once('listening', () => {
          const addr = hs.address()
          const port =
            (addr && typeof addr === 'object' ? addr.port : null) ?? server.config.server?.port ?? 0
          initForPort(port)
        })
      } else {
        initForPort(server.config.server?.port ?? 'default')
      }

      server.middlewares.use(endpoint, (req, res) => {
        if (!apiWriter || !errAgg || !consoleWriter || !interactionWriter) {
          res.statusCode = 204
          res.end()
          return
        }
        const aw = apiWriter
        const ea = errAgg
        const cw = consoleWriter
        const iw = interactionWriter
        const snaps = snapshotsDir
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const MAX_BODY = 1 << 20 // 1MB——防超大上报把 dev server 撑爆
        let body = ''
        let len = 0
        let aborted = false
        req.on('data', (c: Buffer) => {
          if (aborted) return
          len += c.length
          if (len > MAX_BODY) {
            aborted = true
            res.statusCode = 413
            res.end()
            req.destroy()
            return
          }
          body += c.toString()
        })
        req.on('end', () => {
          if (aborted) return
          try {
            const stamp = ts()
            const p = parse(body)
            if (p?.kind === 'api') {
              const detail = apiDetail(p)
              aw.push(`[${stamp}] ${detail}`)
              if (!p.ok) {
                ea.add(detail, stamp)
                if (screenshots) captureScreenshot(snaps).catch(() => {})
              }
            } else if (p?.kind === 'nav') {
              aw.push(`[${stamp}] [nav] ${p.from || '(direct)'} → ${p.to}`)
            } else if (p?.kind === 'error') {
              const cidTag = p.cid ? ` [${p.cid}]` : ''
              ea.add(`${cidTag} ${p.line}`, stamp)
              if (screenshots) captureScreenshot(snaps).catch(() => {})
            } else if (p?.kind === 'console_batch') {
              for (const e of p.entries) {
                const tag = e.count > 1 ? ` (×${e.count})` : ''
                cw.push(`[${stamp}] [${e.level}] ${e.msg}${tag}`)
              }
            } else if (p?.kind === 'console') {
              cw.push(`[${stamp}] [${p.level}] ${p.msg}`)
            } else if (p?.kind === 'interaction_batch') {
              for (const entry of p.entries.slice(-100)) {
                iw.push(formatInteractionLine(entry))
              }
            } else if (p?.kind === 'dom') {
              const cidSuffix = p.cid ? `-${p.cid}` : ''
              const domFile = path.join(snaps, `dom-${Date.now()}${cidSuffix}.html`)
              try {
                const doctype = '<!DOCTYPE html>\n'
                const pageHtml = `${doctype}<html><head><meta charset="utf-8"><title>DOM Snapshot</title></head><body><!-- url: ${p.url} -->\n${p.html}\n</body></html>`
                fs.writeFileSync(domFile, pageHtml)
              } catch {}
            } else if (p?.kind === 'auth') {
              const state = authStateFromPayload(p)
              if (state) {
                try {
                  fs.writeFileSync(authStateFile, JSON.stringify(state, null, 2))
                } catch {}
              }
            } else if (body) {
              // 解析失败的 body：压成单行再记，避免多行破坏日志结构
              ea.add(body.replace(/[\r\n]+/g, ' ⏎ ').slice(0, 500), stamp)
              if (screenshots) captureScreenshot(snaps).catch(() => {})
            }
          } catch {
            /* 单条解析/写入失败不影响响应——避免 /dev/log 整体挂死 */
          }
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

export interface AgentProxyOptions {
  /** 本地 http://localhost 上把上游 cookie 改成可存（去 Domain / 剥 Secure / SameSite=None→Lax）。默认 true */
  rewriteCookiesForLocalhost?: boolean
  /** 日志目录，默认 'log' */
  logDir?: string
  /** 落盘节流间隔（ms），默认 200；过小会在 dev server 启动时 warning。 */
  flushMs?: number
  /** 单文件大小上限（字节），默认 512KB；过小会在 dev server 启动时 warning。 */
  maxBytes?: number
  /** 透传给 Vite `ProxyOptions` 的额外字段；`extra.configure` 会在 agent-eyes 监听器注册前执行。 */
  extra?: Partial<ProxyOptions>
}

function proxyTag(target: string): string {
  try {
    const host = new URL(target).host
    return host.replace(/[^a-z0-9.-]+/gi, '_').slice(0, 40) || 'default'
  } catch {
    return 'default'
  }
}

/**
 * 包装一个 Vite dev proxy：写 `proxy-<host>.log`（Cookie / Set-Cookie / status）并修复 localhost cookie。
 *
 * 目标地址不是 `http(s)`、日志阈值过小等常见配置错误会在 Vite 配置加载时 warning。
 *
 * @example
 * ```ts
 * server: {
 *   proxy: {
 *     '/api': agentProxy('https://api.example.com')
 *   }
 * }
 * ```
 */
export function agentProxy(target: string, opts: AgentProxyOptions = {}): ProxyOptions {
  const rewrite = opts.rewriteCookiesForLocalhost ?? true
  const baseDir = path.resolve(process.cwd(), opts.logDir ?? 'log')
  const flushMs = opts.flushMs ?? 200
  const maxBytes = opts.maxBytes ?? 512 * 1024
  const extraConfigure = opts.extra?.configure
  const configWarnings = [...proxyTargetWarnings(target), ...optionBoundWarnings('agentProxy', flushMs, maxBytes)]
  configWarnings.forEach(warnConsole)

  // 懒初始化：首个响应到达时端口已确定（agentDebugger 在 listening 时下发 _resolvedLogPort），
  // 把 proxy 日志也归到 log/<port>/，与该 dev server 的其它日志同处、并行互不刷。
  let proxyWriter: LogWriter | null = null
  function writer(): LogWriter {
    if (proxyWriter) return proxyWriter
    const dir = _resolvedLogPort != null ? path.join(baseDir, String(_resolvedLogPort)) : baseDir
    fs.mkdirSync(dir, { recursive: true })
    proxyWriter = new LogWriter(path.join(dir, `proxy-${proxyTag(target)}.log`), flushMs, maxBytes)
    proxyWriter.init(`# Proxy Log — started ${new Date().toISOString()}`)
    return proxyWriter
  }

  return {
    target,
    changeOrigin: true,
    secure: true,
    ...opts.extra,
    configure: (proxy, options) => {
      extraConfigure?.(proxy, options)
      proxy.on('proxyRes', (proxyRes, req) => {
        const pw = writer()
        const reqCookie = req.headers?.cookie
        const reqNames = reqCookie
          ? reqCookie.split(';').map((s) => s.split('=')[0].trim()).join(',')
          : '无'
        const setCookie = proxyRes.headers['set-cookie']
        const sc = setCookie
          ? setCookie.map((c) => c.replace(/^([^=]+)=[^;]*/, '$1=<redacted>')).join(' || ')
          : '无'
        pw.push(`${req.method} ${req.url} → ${proxyRes.statusCode} | Cookie(req): ${reqNames} | Set-Cookie: ${sc}`)

        if (rewrite && setCookie) {
          // 上游 cookie 常带父域 Domain + Secure + SameSite=None，http://localhost 存不住 → 登录成功却 401。
          proxyRes.headers['set-cookie'] = setCookie.map((c) =>
            c
              .replace(/;\s*Domain=[^;]+/gi, '')
              .replace(/;\s*Secure/gi, '')
              .replace(/;\s*SameSite=None/gi, '; SameSite=Lax'),
          )
        }
      })
    },
  }
}
