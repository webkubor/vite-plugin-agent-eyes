/**
 * vite-plugin-agent-eyes / 客户端上报。
 * 把 API 调用与前端运行时错误 POST 到 dev 端点（默认 /dev/log），由服务端插件落盘成 agent 可读遥测。
 * 仅 dev 生效；接入方在自己的 HTTP 层（fetch/ky/axios 拦截器）和入口调用即可。
 */

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
}

/** 在 HTTP 拦截器里调用，记录一次 API 调用（成功或失败都记）。 */
export function logApiCall(entry: ApiLogEntry, endpoint: string = DEFAULT_ENDPOINT) {
  if (!isDev()) return
  post(endpoint, { kind: 'api', ...entry })
}

/** 路由变化时调用，记录导航轨迹（帮 agent 还原"在哪个页面发生的"）。 */
export function logNav(from: string, to: string, endpoint: string = DEFAULT_ENDPOINT) {
  if (!isDev()) return
  post(endpoint, { kind: 'nav', from, to })
}

/** 任意自定义错误行。 */
export function logError(line: string, endpoint: string = DEFAULT_ENDPOINT) {
  if (!isDev()) return
  post(endpoint, { kind: 'error', line })
}

/**
 * 一次性挂上全局错误捕获：window error / unhandledrejection / console.error。
 * 在应用入口（main.tsx）调用一次。返回卸载函数。
 */
export function installAgentErrorReporter(endpoint: string = DEFAULT_ENDPOINT): () => void {
  if (!isDev() || typeof window === 'undefined') return () => {}

  const onError = (e: ErrorEvent) =>
    logError(`[frontend][uncaught] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`, endpoint)
  const onRejection = (e: PromiseRejectionEvent) =>
    logError(`[frontend][rejection] ${String((e.reason as Error)?.stack ?? e.reason)}`, endpoint)

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    logError(`[frontend][console] ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}`, endpoint)
    originalConsoleError.apply(console, args)
  }

  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    console.error = originalConsoleError
  }
}
