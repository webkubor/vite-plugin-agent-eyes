import type { Plugin, ProxyOptions } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * vite-plugin-agent-eyes —— 给 AI agent 的自愈遥测层（不是给人看的 dev 日志）。
 *
 * 设计取向：稳定可解析 / 噪声预分类 / 专补 fetch 看不到的盲区 / 自描述入口 / 服务闭环。
 * 装上后，任意在该项目里干活的 agent 都能读到结构化运行时视野，跑「读日志→定位→改→验证」闭环。
 *
 * 三类实时流（写进 <logDir>/，每次启动清空，*.log 不应入库）：
 *  1. api-calls.log —— 全部 API（成功+失败）+ 路由跳转，带请求/响应体。查接口契约、定字段。
 *  2. errors.log    —— API 失败 + 前端运行时错误，聚合去重（相同签名折叠 + 计数）。只看"哪坏了"。
 *  3. proxy.log     —— 代理层 header 真相（Cookie / Set-Cookie / status），fetch 看不到的网络层。
 */

export interface AgentDebuggerOptions {
  /** 日志目录（相对项目根），默认 'log' */
  logDir?: string
  /** 接收前端上报的端点，默认 '/dev/log' */
  endpoint?: string
  /** 日志落盘节流间隔（ms），默认 200——高频上报只批写，不阻塞 dev server */
  flushMs?: number
  /** 单个日志文件大小上限（字节），默认 512KB——超过截断旧记录 */
  maxBytes?: number
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
type ErrorPayload = { kind: 'error'; line: string }
type DevLogPayload = ApiPayload | NavPayload | ErrorPayload

const HEADER_SEP = '\n\n'

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
  } catch {
    return null
  }
  return null
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

> 这些日志是**给 AI agent 读的运行时视野**，不是给人的 dev 日志。
> 由 vite-plugin-agent-eyes 产生，仅本地 dev，**每次启动清空**（只反映本次会话），\`*.log\` 不入库。

## 排查顺序（读日志 → 定位 → 改 → 重启 dev → 再读验证）

1. **errors.log** —— 先看"哪坏了"：顶部是 Top Errors（聚合去重 + 频率），下方是最近原始记录。
2. **api-calls.log** —— 若是接口问题：看真实请求/响应体（别凭类型猜字段）、调用顺序。
3. **proxy-<host>.log** —— 若是网络/鉴权层：请求带的 Cookie、响应的 Set-Cookie 属性、status。多个代理各自按 target host 分文件。fetch 看不到这层。

最新记录在文件**最上方**（header 之后），\`head\` 即看本次会话最近发生了什么。
errors.log 的 Top Errors 区直接告诉你"哪个错误刷得最凶"，省去自己数频率。

## 典型：登录成功却一直 401（cookie 存不住）
api-calls.log 见 \`POST .../login code=0\` 紧跟 \`GET .../session 401\`
→ proxy-<host>.log 看那条 session 的 Cookie(req)：若为「无」，说明浏览器没存住登录 cookie。
常见根因：上游 Set-Cookie 带父域 Domain + Secure + SameSite=None，http://localhost 域不匹配且 Secure 被丢弃。
修复：agentProxy 已在 dev 对 Set-Cookie 去 Domain / 剥 Secure / SameSite=None→Lax。
`

export function agentDebugger(options: AgentDebuggerOptions = {}): Plugin {
  const logDir = path.resolve(process.cwd(), options.logDir ?? 'log')
  const endpoint = options.endpoint ?? '/dev/log'
  const flushMs = options.flushMs ?? 200
  const maxBytes = options.maxBytes ?? 512 * 1024
  const apiLog = path.join(logDir, 'api-calls.log')
  const errLog = path.join(logDir, 'errors.log')

  return {
    name: 'vite-plugin-agent-eyes',
    apply: 'serve',
    configureServer(server) {
      fs.mkdirSync(logDir, { recursive: true })
      const header = `# Dev Log — started ${ts()}`
      const apiWriter = new LogWriter(apiLog, flushMs, maxBytes)
      const errAgg = new ErrorAggregator(errLog, header, flushMs, 200)
      apiWriter.init(header)
      errAgg.init()
      fs.writeFileSync(path.join(logDir, 'README.md'), MANIFEST)

      server.middlewares.use(endpoint, (req, res) => {
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
              apiWriter.push(`[${stamp}] ${detail}`)
              if (!p.ok) errAgg.add(detail, stamp)
            } else if (p?.kind === 'nav') {
              apiWriter.push(`[${stamp}] [nav] ${p.from || '(direct)'} → ${p.to}`)
            } else if (p?.kind === 'error') {
              errAgg.add(p.line, stamp)
            } else if (body) {
              // 解析失败的 body：压成单行再记，避免多行破坏日志结构
              errAgg.add(body.replace(/[\r\n]+/g, ' ⏎ ').slice(0, 500), stamp)
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
  /** 落盘节流间隔（ms），默认 200 */
  flushMs?: number
  /** 单文件大小上限（字节），默认 512KB */
  maxBytes?: number
  /** 透传给 vite ProxyOptions 的额外字段 */
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
 * 包装一个 /api 代理：写 proxy-<host>.log（header 真相）+ 本地 cookie 改写。
 * 用法：server.proxy = { '/api': agentProxy('https://api.example.com') }
 * 多个代理各自按 target host 分文件（proxy-api.example.com.log 等），互不覆盖。
 */
export function agentProxy(target: string, opts: AgentProxyOptions = {}): ProxyOptions {
  const rewrite = opts.rewriteCookiesForLocalhost ?? true
  const logDir = path.resolve(process.cwd(), opts.logDir ?? 'log')
  const flushMs = opts.flushMs ?? 200
  const maxBytes = opts.maxBytes ?? 512 * 1024
  const proxyLog = path.join(logDir, `proxy-${proxyTag(target)}.log`)
  const proxyWriter = new LogWriter(proxyLog, flushMs, maxBytes)

  return {
    target,
    changeOrigin: true,
    secure: true,
    ...opts.extra,
    configure: (proxy) => {
      fs.mkdirSync(logDir, { recursive: true })
      proxyWriter.init(`# Proxy Log — started ${new Date().toISOString()}`)
      proxy.on('proxyRes', (proxyRes, req) => {
        const reqCookie = req.headers?.cookie
        const reqNames = reqCookie
          ? reqCookie.split(';').map((s) => s.split('=')[0].trim()).join(',')
          : '无'
        const setCookie = proxyRes.headers['set-cookie']
        const sc = setCookie
          ? setCookie.map((c) => c.replace(/^([^=]+)=[^;]*/, '$1=<redacted>')).join(' || ')
          : '无'
        proxyWriter.push(`${req.method} ${req.url} → ${proxyRes.statusCode} | Cookie(req): ${reqNames} | Set-Cookie: ${sc}`)

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
