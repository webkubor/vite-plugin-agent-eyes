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
 *  2. errors.log    —— API 失败 + 前端运行时错误。只看"哪坏了"。
 *  3. proxy.log     —— 代理层 header 真相（Cookie / Set-Cookie / status），fetch 看不到的网络层。
 */

export interface AgentDebuggerOptions {
  /** 日志目录（相对项目根），默认 'log' */
  logDir?: string
  /** 接收前端上报的端点，默认 '/dev/log' */
  endpoint?: string
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

/** 最新在最上：保留首部 header，新块插到 header 之后。便于 agent `head` 即看最新。 */
function writeNewest(file: string, block: string) {
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const at = content.indexOf(HEADER_SEP)
  if (at === -1) {
    fs.writeFileSync(file, `${block}\n${content}`)
    return
  }
  const header = content.slice(0, at + HEADER_SEP.length)
  fs.writeFileSync(file, `${header}${block}\n${content.slice(at + HEADER_SEP.length)}`)
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
  const status = p.status ? ` http=${p.status}` : ''
  const code = p.code !== undefined ? ` code=${p.code}` : ''
  const rid = p.request_id ? ` requestId=${p.request_id}` : ''
  const page = p.page_path ? ` page=${p.page_path}` : ''
  const err = p.error ? ` error="${p.error}"` : ''
  return `[api][${p.ok ? 'ok' : 'failed'}] ${p.method.toUpperCase()} ${p.path} ${p.duration_ms}ms${status}${code}${rid}${page}${err}`
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

const MANIFEST = `# Agent 自愈遥测（log/）

> 这些日志是**给 AI agent 读的运行时视野**，不是给人的 dev 日志。
> 由 vite-plugin-agent-eyes 产生，仅本地 dev，**每次启动清空**（只反映本次会话），\`*.log\` 不入库。

## 排查顺序（读日志 → 定位 → 改 → 重启 dev → 再读验证）

1. **errors.log** —— 先看"哪坏了"：API 失败 + 前端运行时错误。
2. **api-calls.log** —— 若是接口问题：看真实请求/响应体（别凭类型猜字段）、调用顺序。
3. **proxy.log** —— 若是网络/鉴权层：请求带的 Cookie、响应的 Set-Cookie 属性、status。fetch 看不到这层。

最新记录在文件**最上方**（header 之后），\`head\` 即看本次会话最近发生了什么。

## 典型：登录成功却一直 401（cookie 存不住）
api-calls.log 见 \`POST .../login code=0\` 紧跟 \`GET .../session 401\`
→ proxy.log 看那条 session 的 \`Cookie(req)\`：若为 \`无\`，说明浏览器没存住登录 cookie。
常见根因：上游 Set-Cookie 带父域 Domain + Secure + SameSite=None，http://localhost 域不匹配且 Secure 被丢弃。
修复：agentProxy 已在 dev 对 Set-Cookie 去 Domain / 剥 Secure / SameSite=None→Lax。
`

export function agentDebugger(options: AgentDebuggerOptions = {}): Plugin {
  const logDir = path.resolve(process.cwd(), options.logDir ?? 'log')
  const endpoint = options.endpoint ?? '/dev/log'
  const apiLog = path.join(logDir, 'api-calls.log')
  const errLog = path.join(logDir, 'errors.log')

  return {
    name: 'vite-plugin-agent-eyes',
    apply: 'serve',
    configureServer(server) {
      fs.mkdirSync(logDir, { recursive: true })
      const header = `# Dev Log — started ${ts()}\n\n`
      fs.writeFileSync(apiLog, header)
      fs.writeFileSync(errLog, header)
      fs.writeFileSync(path.join(logDir, 'README.md'), MANIFEST)

      server.middlewares.use(endpoint, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (c: Buffer) => (body += c.toString()))
        req.on('end', () => {
          const stamp = ts()
          const p = parse(body)
          if (p?.kind === 'api') {
            const detail = `[${stamp}] ${apiDetail(p)}`
            writeNewest(apiLog, detail)
            if (!p.ok) writeNewest(errLog, detail)
          } else if (p?.kind === 'nav') {
            writeNewest(apiLog, `[${stamp}] [nav] ${p.from || '(direct)'} → ${p.to}`)
          } else if (p?.kind === 'error') {
            writeNewest(errLog, `[${stamp}] ${p.line}`)
          } else {
            writeNewest(errLog, `[${stamp}] ${body}`)
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
  /** 透传给 vite ProxyOptions 的额外字段 */
  extra?: Partial<ProxyOptions>
}

/**
 * 包装一个 /api 代理：写 proxy.log（header 真相）+ 本地 cookie 改写。
 * 用法：server.proxy = { '/api': agentProxy('https://api.example.com') }
 */
export function agentProxy(target: string, opts: AgentProxyOptions = {}): ProxyOptions {
  const rewrite = opts.rewriteCookiesForLocalhost ?? true
  const logDir = path.resolve(process.cwd(), opts.logDir ?? 'log')
  const proxyLog = path.join(logDir, 'proxy.log')

  return {
    target,
    changeOrigin: true,
    secure: true,
    ...opts.extra,
    configure: (proxy) => {
      fs.mkdirSync(logDir, { recursive: true })
      fs.writeFileSync(proxyLog, `# Proxy Log — started ${new Date().toISOString()}\n\n`)
      const log = (msg: string) => {
        try {
          writeNewest(proxyLog, `[${ts()}] ${msg}`)
        } catch {
          /* ignore */
        }
      }
      proxy.on('proxyRes', (proxyRes, req) => {
        const reqCookie = req.headers?.cookie
        const reqNames = reqCookie
          ? reqCookie.split(';').map((s) => s.split('=')[0].trim()).join(',')
          : '无'
        const setCookie = proxyRes.headers['set-cookie']
        const sc = setCookie
          ? setCookie.map((c) => c.replace(/^([^=]+)=[^;]*/, '$1=<redacted>')).join(' || ')
          : '无'
        log(`${req.method} ${req.url} → ${proxyRes.statusCode} | Cookie(req): ${reqNames} | Set-Cookie: ${sc}`)

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
