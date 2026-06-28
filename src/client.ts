/**
 * vite-plugin-agent-eyes / 客户端上报。
 * 把 API 调用与前端运行时错误 POST 到 dev 端点（默认 /dev/log），由服务端插件落盘成 agent 可读遥测。
 * 仅 dev 生效。两种接入方式：
 *  - 手动埋点：logApiCall / logNav / logError + installAgentErrorReporter
 *  - 一键自动：autoInstrument()（自动包装 fetch/XHR/导航/全局错误/控制台/DOM 快照）
 */

import {
  createLoginAuthState,
  installBrowserAuthState,
  type AgentAuthProfileInput,
  type AgentAuthState,
} from './auth-state'
import { installAgentInteractionTracer } from './interaction-client'

export type { AgentAuthProfileInput, AgentAuthState } from './auth-state'
export {
  installAgentInteractionTracer,
  recordInteraction,
  type AgentInteractionOptions,
  type InteractionEntry,
  type InteractionKind,
  type InteractionTargetLike,
} from './interaction-client'

const DEFAULT_ENDPOINT = '/dev/log'

function isDev() {
  return typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
}

function post(endpoint: string, payload: unknown) {
  if (typeof fetch === 'undefined') return
  try {
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* 上报失败绝不影响业务 */
  }
}

/* ---- 敏感字段脱敏 ---- */
const SENSITIVE_KEYS =
  /(?:^|[._-])(pass(?:word|wd)?|pwd|secret|token|access_?token|refresh_?token|api_?key|apikey|authorization|cookie|set-?cookie)(?:$|[._-])/i

function redact(v: unknown, raw: boolean, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (raw || v == null || typeof v !== 'object' || depth > 8) return v
  if (seen.has(v as object)) return '[Circular]'
  seen.add(v as object)
  if (Array.isArray(v)) return v.map((x) => redact(x, false, seen, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v)) out[k] = SENSITIVE_KEYS.test(k) ? '***' : redact(val, false, seen, depth + 1)
  return out
}

/* ---- 关联 ID（把同一次错误的 console/screenshot/DOM 串起来） ---- */
let _correlationId: string | null = null
let _correlationExpiry = 0
const CORRELATION_TTL = 5000

function newCorrelationId(): string {
  _correlationId = Math.random().toString(36).slice(2, 10)
  _correlationExpiry = Date.now() + CORRELATION_TTL
  return _correlationId
}

function currentCorrelationId(): string | null {
  if (!_correlationId || Date.now() > _correlationExpiry) return null
  return _correlationId
}

/* ---- 控制台节流（防高频输出撑爆日志） ---- */
const CONSOLE_BUFFER: { level: string; msg: string; count: number }[] = []
const CONSOLE_FLUSH_MS = 500
const CONSOLE_MAX_ENTRIES = 500
let _consoleTimer: ReturnType<typeof setTimeout> | null = null
let _consoleTotal = 0
let _lastConsoleSig = ''

function flushConsole(endpoint: string) {
  _consoleTimer = null
  if (CONSOLE_BUFFER.length === 0) return
  const batch = CONSOLE_BUFFER.splice(0)
  post(endpoint, { kind: 'console_batch', entries: batch })
}

function logConsole(level: string, msg: string, endpoint: string) {
  if (_consoleTotal >= CONSOLE_MAX_ENTRIES) return

  // 连续相同签名去重（同 level + 同 msg → 折叠计数）
  const sig = `${level}:${msg}`
  if (sig === _lastConsoleSig && CONSOLE_BUFFER.length > 0) {
    CONSOLE_BUFFER[CONSOLE_BUFFER.length - 1].count++
    return
  }
  _lastConsoleSig = sig

  CONSOLE_BUFFER.push({ level, msg, count: 1 })
  _consoleTotal++

  if (_consoleTimer == null) {
    _consoleTimer = setTimeout(() => flushConsole(endpoint), CONSOLE_FLUSH_MS)
  }
}

/* ---- DOM 快照节流 ---- */
let _lastDomSnapshot = 0
const DOM_COOLDOWN = 2000

function canSnapshotDom(): boolean {
  const now = Date.now()
  if (now - _lastDomSnapshot < DOM_COOLDOWN) return false
  _lastDomSnapshot = now
  return true
}

/* ---- 错误上报节流（防渲染死循环 / SW 重试刷爆日志，源头去重） ---- */
const ERROR_THROTTLE_MS = 5000
const _errRecent = new Map<string, number>()
// 去 HMR 版本戳（?t=\d+），避免同一错误因热更新戳不同绕过去重
function errorKey(line: string): string {
  return line.replace(/\?t=\d+/g, '').slice(0, 300)
}
function errorThrottled(line: string): boolean {
  const key = errorKey(line)
  const now = Date.now()
  const last = _errRecent.get(key)
  if (last && now - last < ERROR_THROTTLE_MS) return true
  _errRecent.set(key, now)
  if (_errRecent.size > 200) {
    for (const [k, ts] of _errRecent) if (now - ts >= ERROR_THROTTLE_MS) _errRecent.delete(k)
  }
  return false
}

export interface ApiLogEntry {
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
  /** 跳过敏感字段脱敏（默认会脱敏），仅在确认无敏感数据时开启 */
  raw?: boolean
}

/** 在 HTTP 拦截器里调用，记录一次 API 调用（成功或失败都记）。 */
export function logApiCall(entry: ApiLogEntry, endpoint: string = DEFAULT_ENDPOINT) {
  if (!isDev()) return
  const raw = entry.raw
  post(endpoint, {
    kind: 'api',
    method: entry.method,
    path: entry.path,
    url: entry.url,
    ok: entry.ok,
    duration_ms: entry.duration_ms,
    code: entry.code,
    status: entry.status,
    request_id: entry.request_id,
    error: entry.error,
    page_path: entry.page_path,
    request: redact(entry.request, !!raw),
    response: redact(entry.response, !!raw),
  })
}

/** 路由变化时调用，记录导航轨迹（帮 agent 还原"在哪个页面发生的"）。 */
export function logNav(from: string, to: string, endpoint: string = DEFAULT_ENDPOINT) {
  if (!isDev()) return
  post(endpoint, { kind: 'nav', from, to })
}

/** 任意自定义错误行。同一错误 5s 内只上报一次（去 HMR 时间戳），防渲染死循环 / SW 重试刷爆。 */
export function logError(line: string, endpoint: string = DEFAULT_ENDPOINT) {
  if (!isDev()) return
  if (errorThrottled(line)) return
  const cid = currentCorrelationId()
  post(endpoint, { kind: 'error', line, cid })
}

/** 记录控制台输出（全级别），内部节流。 */
export function logConsoleEntry(level: string, args: unknown[], endpoint: string = DEFAULT_ENDPOINT) {
  if (!isDev()) return
  const msg = args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? a.message
      if (typeof a === 'object') {
        try { return JSON.stringify(a) } catch { return String(a) }
      }
      return String(a)
    })
    .join(' ')
  const cid = currentCorrelationId()
  logConsole(level, cid ? `[${cid}] ${msg}` : msg, endpoint)
}

/** DOM 快照：抓取关键节点结构，供 agent 看"页面上渲染了什么"。带冷却控制。 */
export function snapshotDom(endpoint: string = DEFAULT_ENDPOINT) {
  if (!isDev() || typeof document === 'undefined') return
  if (!canSnapshotDom()) return
  try {
    const body = document.body
    if (!body) return
    const html = body.innerHTML
    const trimmed = html.length > 50000 ? html.slice(0, 50000) + '\n...[truncated]' : html
    const cid = currentCorrelationId()
    post(endpoint, { kind: 'dom', url: location.href, html: trimmed, cid })
  } catch {}
}

const CONSOLE_LEVELS = ['log', 'warn', 'error', 'info', 'debug'] as const

let errReporterInstalled = false
/**
 * 一次性挂上全局错误捕获：`window error` / `unhandledrejection` / 全控制台 / DOM 快照。
 *
 * 在应用入口调用一次即可；返回卸载函数。仅 `import.meta.env.DEV === true` 时生效。
 */
export function installAgentErrorReporter(endpoint: string = DEFAULT_ENDPOINT): () => void {
  if (!isDev() || typeof window === 'undefined' || errReporterInstalled) return () => {}
  errReporterInstalled = true

  const onError = (e: ErrorEvent) => {
    newCorrelationId()
    logError(`[frontend][uncaught] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`, endpoint)
    snapshotDom(endpoint)
  }
  const onRejection = (e: PromiseRejectionEvent) => {
    newCorrelationId()
    logError(`[frontend][rejection] ${String((e.reason as Error)?.stack ?? e.reason)}`, endpoint)
    snapshotDom(endpoint)
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  const undoConsole = patchConsole(endpoint)

  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    undoConsole()
    errReporterInstalled = false
  }
}

/** 拦截全级别控制台输出，保留原始行为。返回卸载函数。 */
function patchConsole(endpoint: string): () => void {
  const originals: Record<string, (...args: unknown[]) => void> = {}
  const undos: (() => void)[] = []
  const con = console as unknown as Record<string, (...args: unknown[]) => void>

  for (const level of CONSOLE_LEVELS) {
    const original = con[level]
    originals[level] = original
    con[level] = (...args: unknown[]) => {
      logConsoleEntry(level, args, endpoint)
      original(...args)
    }
    undos.push(() => {
      con[level] = originals[level]
    })
  }

  return () => undos.forEach((u) => u())
}

/* ---- 自动埋点 ---- */
export interface AutoInstrumentOptions {
  endpoint?: string
  /** 记录请求/响应体（默认 true） */
  logBody?: boolean
  /** 跳过敏感字段脱敏（默认 false，即默认脱敏） */
  raw?: boolean
  /** 自动捕获路由导航（默认 true） */
  nav?: boolean
  /** 自动捕获全局错误 + 控制台 + DOM 快照（默认 true） */
  errors?: boolean
  /** 自动捕获 click/input/change/submit/route 交互轨迹（默认 true） */
  interactions?: boolean
}

/** 登录态记录选项。 */
export interface AgentAuthRecordOptions {
  endpoint?: string
  pagePath?: string
}

/** 自动记录登录态的安装选项。 */
export interface AgentAuthRecorderOptions extends AgentAuthRecordOptions {
  getProfile: () => AgentAuthProfileInput | null | undefined | Promise<AgentAuthProfileInput | null | undefined>
}

function currentPagePath(): string | undefined {
  if (typeof location === 'undefined') return undefined
  return location.pathname || undefined
}

/** 记录一次登录成功画像，写入 BOM 并上报给 agentDebugger。不会保存 token/cookie。 */
export function recordLoginSuccess(profile: AgentAuthProfileInput, options: AgentAuthRecordOptions = {}): AgentAuthState {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const state = createLoginAuthState(profile, { pagePath: options.pagePath ?? currentPagePath() })
  if (isDev()) {
    installBrowserAuthState(state)
    post(endpoint, { kind: 'auth', event: 'login_success', state })
  }
  return state
}

/** 安装一次性登录态记录器，从业务提供的 getProfile 读取当前用户画像。 */
export function installAgentAuthRecorder(options: AgentAuthRecorderOptions): () => void {
  let active = true
  void Promise.resolve()
    .then(() => options.getProfile())
    .then((profile) => {
      if (!active || !profile) return
      recordLoginSuccess(profile, options)
    })
    .catch(() => {})

  return () => {
    active = false
    if (typeof window !== 'undefined') {
      Reflect.deleteProperty(window, '__AGENT_EYES_AUTH__')
    }
  }
}

function safePath(url: string): string {
  try {
    return new URL(url, typeof location !== 'undefined' ? location.origin : 'http://localhost').pathname
  } catch {
    return url
  }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function isReportUrl(url: string, endpoint: string): boolean {
  try {
    return (
      new URL(url, typeof location !== 'undefined' ? location.origin : 'http://localhost').pathname === endpoint
    )
  } catch {
    return url === endpoint
  }
}

function patchFetch(endpoint: string, logBody: boolean, raw: boolean): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return () => {}
  const original = window.fetch
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    // 上报请求直接走 original——避免「post → fetch → patchFetch 捕获 → logApiCall → post」递归 + 自我引用噪声
    if (isReportUrl(url, endpoint)) return original(input, init)
    // 兼容 fetch(new Request(url, { method, body }))：method/body 可能在 Request 而非 init 上
    const reqInit = init ?? (input instanceof Request ? { method: input.method } : undefined)
    const method = String(reqInit?.method ?? 'GET').toUpperCase()
    const started = performance.now()
    const page_path = location.pathname
    const path = safePath(url)
    let reqBody: unknown
    if (logBody && init?.body != null && typeof init.body === 'string') {
      reqBody = tryJson(init.body)
    }
    try {
      const res = await original(input, init)
      const duration_ms = Math.round(performance.now() - started)
      let resBody: unknown
      if (logBody) {
        // 大响应/非文本不读 body，避免 clone().text() 内存翻倍
        const ct = res.headers.get('content-type') ?? ''
        const cl = Number(res.headers.get('content-length') ?? 0)
        const readable = /json|text|javascript|xml|form/i.test(ct) && (!cl || cl < 64 * 1024)
        if (readable) {
          try {
            const clone = res.clone()
            const text = await clone.text()
            resBody = text ? tryJson(text) : ''
          } catch {
            /* 忽略读取失败 */
          }
        } else {
          resBody = cl ? `[${cl} bytes, ${ct || 'binary'}]` : '[non-text or large]'
        }
      }
      logApiCall({ method, path, url, ok: res.ok, duration_ms, status: res.status, request: reqBody, response: resBody, page_path, raw }, endpoint)
      return res
    } catch (e) {
      const duration_ms = Math.round(performance.now() - started)
      logApiCall({ method, path, url, ok: false, duration_ms, error: String(e), page_path, raw }, endpoint)
      throw e
    }
  }) as typeof window.fetch
  return () => {
    window.fetch = original
  }
}

function patchXHR(endpoint: string, logBody: boolean, raw: boolean): () => void {
  if (typeof window === 'undefined' || typeof XMLHttpRequest === 'undefined') return () => {}
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string, ...rest: unknown[]) {
    const self = this as unknown as {
      __ae?: { method: string; url: string; path: string; started: number; page_path: string }
      __aeHandler?: EventListener
    }
    // XHR 复用时清理上一轮残留 handler，防 loadend 监听器累积导致重复上报 + 计数注水
    if (self.__aeHandler) {
      this.removeEventListener('loadend', self.__aeHandler)
      self.__aeHandler = undefined
    }
    // 上报端点不记录
    self.__ae = isReportUrl(String(url), endpoint)
      ? undefined
      : {
          method: String(method ?? 'GET').toUpperCase(),
          url,
          path: safePath(url),
          started: performance.now(),
          page_path: location.pathname,
        }
    ;(originalOpen as unknown as (...a: unknown[]) => void).apply(this, [method, url, ...rest])
  }
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const self = this as unknown as { __ae?: { method: string; url: string; path: string; started: number; page_path: string }; __aeHandler?: EventListener }
    const meta = self.__ae
    const reqBody =
      logBody && body != null && typeof body === 'string' ? tryJson(body) : undefined
    if (meta) {
      if (self.__aeHandler) this.removeEventListener('loadend', self.__aeHandler)
      const handler = () => {
        const ok = this.status >= 200 && this.status < 400
        let resBody: unknown
        if (logBody) {
          try {
            if (this.responseType === '' || this.responseType === 'text') resBody = tryJson(this.responseText)
            else if (this.responseType === 'json') resBody = this.response
            else resBody = `[responseType=${this.responseType}]`
          } catch {
            /* 忽略 */
          }
        }
        logApiCall(
          {
            method: meta.method,
            path: meta.path,
            url: meta.url,
            ok,
            duration_ms: Math.round(performance.now() - meta.started),
            status: this.status,
            request: reqBody,
            response: resBody,
            page_path: meta.page_path,
            raw,
          },
          endpoint,
        )
      }
      self.__aeHandler = handler
      this.addEventListener('loadend', handler)
    }
    return originalSend.call(this, body)
  }

  return () => {
    XMLHttpRequest.prototype.open = originalOpen
    XMLHttpRequest.prototype.send = originalSend
  }
}

function patchNav(endpoint: string): () => void {
  if (typeof window === 'undefined' || !window.history) return () => {}
  let from = location.pathname
  const fire = () => {
    const to = location.pathname
    if (to !== from) {
      logNav(from, to, endpoint)
      from = to
    }
  }
  const origPush = history.pushState
  const origReplace = history.replaceState
  history.pushState = function (...args: unknown[]) {
    const r = (origPush as (...a: unknown[]) => void).apply(this, args)
    fire()
    return r
  }
  history.replaceState = function (...args: unknown[]) {
    const r = (origReplace as (...a: unknown[]) => void).apply(this, args)
    fire()
    return r
  }
  const onPop = () => fire()
  window.addEventListener('popstate', onPop)
  return () => {
    history.pushState = origPush
    history.replaceState = origReplace
    window.removeEventListener('popstate', onPop)
  }
}

let autoInstrumentUndo: (() => void) | null = null
/**
 * 一键自动埋点：fetch + XMLHttpRequest + 路由导航 + 全局错误 + 全控制台 + DOM 快照 + 脱敏交互轨迹。
 *
 * 在应用入口调用一次即可，返回卸载函数。默认 dev-only；重复调用会复用同一个安装结果，防 StrictMode/HMR 重复包装。
 */
export function autoInstrument(opts: AutoInstrumentOptions = {}): () => void {
  if (!isDev()) return () => {}
  // 幂等：重复调用（React StrictMode / HMR 快速刷新）返回已注册的卸载函数，避免多层包装
  if (autoInstrumentUndo) return autoInstrumentUndo
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT
  const logBody = opts.logBody ?? true
  const raw = opts.raw ?? false
  const undoFns = [patchFetch(endpoint, logBody, raw), patchXHR(endpoint, logBody, raw)]
  if (opts.nav !== false) undoFns.push(patchNav(endpoint))
  if (opts.errors !== false) undoFns.push(installAgentErrorReporter(endpoint))
  if (opts.interactions !== false) undoFns.push(installAgentInteractionTracer({ endpoint }))
  const undo = () => {
    undoFns.slice().reverse().forEach((u) => u())
    autoInstrumentUndo = null
  }
  autoInstrumentUndo = undo
  return undo
}
