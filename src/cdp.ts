/**
 * CDP 截图与浏览器能力探测。
 * 路由：任意本地开发页面；API：Chrome DevTools /json/version、/json 与页面 WebSocket。
 */
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import WebSocket from 'ws'

const execFileAsync = promisify(execFile)
const COOLDOWN = 2000
const MISS_COOLDOWN = 60_000
const MAX_HTTP_BYTES = 1024 * 1024
const MAX_CONCURRENT = 2
const attempts = new Map<string, number>()
const inFlight = new Set<string>()
const indexWrites = new Map<string, Promise<void>>()
let cachedPort: number | null = null
let noPortUntil = 0

/** 截图所需的目标页面与安全展示字段。 */
export interface ScreenshotOptions {
  pageUrl?: string
  project?: string
  reason?: string
  annotation?: boolean
}

interface PageTarget { type: string; url: string; webSocketDebuggerUrl?: string }
interface BrowserInfo { Browser?: string }
interface ScreenshotRecord {
  project: string
  pathname: string
  origin: string
  time: string
  file: string
  engine: 'Chromium' | 'unknown'
  browser: string
  reason: string
}

function httpGet(url: string, timeout = 500): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`CDP HTTP ${res.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_HTTP_BYTES) {
          req.destroy(new Error('CDP response too large'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('CDP HTTP timeout')))
  })
}

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch { return null }
}

/** 根据 origin 与 pathname 精确选择页面；未指定 URL 时仅选择唯一 HTTP(S) 页面。 */
export function selectScreenshotPage(targets: PageTarget[], pageUrl?: string): PageTarget | null {
  const requested = pageUrl === undefined ? null : safeUrl(pageUrl)
  if (pageUrl !== undefined && !requested) return null
  const candidates = targets.filter((target) => target.type === 'page' && safeUrl(target.url))
  const matches = requested
    ? candidates.filter((target) => {
      const url = safeUrl(target.url)!
      return url.origin === requested.origin && url.pathname === requested.pathname
    })
    : candidates
  // 多个完全相同的 tab 同样不应盲选。
  return matches.length === 1 ? matches[0] : null
}

function cdpSession(wsUrl: string): Promise<{ command(method: string, params?: Record<string, unknown>): Promise<unknown>; close(): void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 1000 })
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
    let nextId = 0
    let settled = false
    const fail = (error: Error) => {
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
      pending.clear()
      if (!settled) { settled = true; reject(error) }
    }
    ws.on('error', fail)
    ws.on('close', () => fail(new Error('CDP connection closed')))
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { id?: number; result?: unknown; error?: { message?: string } }
        const item = pending.get(msg.id ?? -1)
        if (!item) return
        pending.delete(msg.id!)
        clearTimeout(item.timer)
        msg.error ? item.reject(new Error(msg.error.message || 'CDP error')) : item.resolve(msg.result)
      } catch { /* Ignore unrelated CDP events. */ }
    })
    ws.on('open', () => {
      settled = true
      resolve({
        command(method, params) {
          return new Promise((done, failed) => {
            const id = ++nextId
            const timer = setTimeout(() => {
              pending.delete(id)
              failed(new Error('CDP command timeout'))
            }, 3000)
            pending.set(id, { resolve: done, reject: failed, timer })
            ws.send(JSON.stringify({ id, method, params }), (error) => {
              if (error) {
                clearTimeout(timer)
                pending.delete(id)
                failed(error)
              }
            })
          })
        },
        close() { ws.close() },
      })
    })
  })
}

/** 从 Chrome 进程命令行参数提取调试端口。 */
async function detectPortFromProcess(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['x', '-o', 'args='], { encoding: 'utf8', timeout: 1000 })
    const match = stdout.split('\n').filter((line) => /chrome|chromium/i.test(line))
      .map((line) => line.match(/--remote-debugging-port=(\d+)/)).find(Boolean)
    return match ? parseInt(match[1], 10) : null
  } catch { return null }
}

async function scanPorts(): Promise<number | null> {
  const results = await Promise.all(Array.from({ length: 11 }, async (_, index) => {
    const port = 9222 + index
    try {
      const version = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json/version`, 300)) as BrowserInfo
      return version.Browser ? port : null
    } catch { return null }
  }))
  return results.find((port) => port !== null) ?? null
}

async function findPort(): Promise<number | null> {
  if (cachedPort) {
    try { await httpGet(`http://127.0.0.1:${cachedPort}/json/version`, 300); return cachedPort }
    catch { cachedPort = null }
  }
  if (Date.now() < noPortUntil) return null
  const fromProcess = await detectPortFromProcess()
  if (fromProcess) {
    try {
      await httpGet(`http://127.0.0.1:${fromProcess}/json/version`, 300)
      cachedPort = fromProcess
      return fromProcess
    } catch { /* Try standard ports. */ }
  }
  const port = await scanPorts()
  if (port) { cachedPort = port; noPortUntil = 0; return port }
  noPortUntil = Date.now() + MISS_COOLDOWN
  return null
}

async function locate(pageUrl?: string): Promise<{ target: PageTarget; browser: string } | null> {
  if (pageUrl !== undefined && !safeUrl(pageUrl)) return null
  const port = await findPort()
  if (!port) return null
  const base = `http://127.0.0.1:${port}`
  const [version, targets] = await Promise.all([
    httpGet(`${base}/json/version`).then((body) => JSON.parse(body) as BrowserInfo),
    httpGet(`${base}/json`).then((body) => JSON.parse(body) as PageTarget[]),
  ])
  if (!Array.isArray(targets)) return null
  const target = selectScreenshotPage(targets, pageUrl)
  return target?.webSocketDebuggerUrl && /^wss?:\/\//.test(target.webSocketDebuggerUrl)
    ? { target, browser: /^\w+(?:\s+\w+)?\/[\w. -]{1,60}$/.test(version.Browser || '') ? version.Browser! : 'unknown' } : null
}

/** 探测 CDP 中确实存在可连接的匹配页面，不能由用户代理字符串推断。 */
export async function inspectBrowserCapability(pageUrl?: string): Promise<{
  available: boolean; engine: 'Chromium' | 'unknown'; browser?: string; reason: string; matchingPage: boolean
}> {
  try {
    const found = await locate(pageUrl)
    if (!found) return { available: false, engine: 'unknown', reason: 'No unique matching CDP page with websocket', matchingPage: false }
    const session = await cdpSession(found.target.webSocketDebuggerUrl!)
    session.close()
    return { available: true, engine: /chrom(e|ium)/i.test(found.browser) ? 'Chromium' : 'unknown', browser: found.browser, reason: 'Matching CDP page available', matchingPage: true }
  } catch {
    return { available: false, engine: 'unknown', reason: 'CDP unavailable', matchingPage: false }
  }
}

function safeLabel(value: string | undefined, fallback: string, length = 80): string {
  const text = (value || fallback).slice(0, length)
  return /[?#@:/\\]|(?:token|secret|password|key)/i.test(text)
    ? fallback : text.replace(/[^\p{L}\p{N} _.-]/gu, '-')
}

function safeReason(reason?: string): string {
  const known = ['manual', 'error', 'api-error', 'console-error', 'network-error', 'uncaught-error']
  return reason && known.includes(reason) ? reason : 'unspecified'
}

function routeSlug(pathname: string): string {
  return pathname.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'root'
}

async function saveScreenshot(dir: string, png: Buffer, record: ScreenshotRecord): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, record.file)
  const indexFile = path.join(dir, 'index.json')
  await writeFile(file, png)
  await writeFile(file.replace(/\.png$/, '.json'), JSON.stringify(record, null, 2))
  const previousWrite = indexWrites.get(indexFile) ?? Promise.resolve()
  const currentWrite = previousWrite.catch(() => {}).then(async () => {
    let previous: ScreenshotRecord[] = []
    try {
      const parsed: unknown = JSON.parse(await readFile(indexFile, 'utf8'))
      if (Array.isArray(parsed)) previous = parsed as ScreenshotRecord[]
    } catch { /* New or invalid index starts fresh. */ }
    await writeFile(indexFile, JSON.stringify([record, ...previous].slice(0, 100), null, 2))
  })
  indexWrites.set(indexFile, currentWrite)
  try { await currentWrite }
  finally { if (indexWrites.get(indexFile) === currentWrite) indexWrites.delete(indexFile) }
  return file
}

/** 仅截取指定 URL 的页面；不传 URL 时只允许唯一 HTTP(S) 页面。 */
export async function captureScreenshot(dir: string, options: ScreenshotOptions = {}): Promise<string | null> {
  const requested = options.pageUrl === undefined ? null : safeUrl(options.pageUrl)
  if (options.pageUrl !== undefined && !requested) return null
  const key = requested ? `${requested.origin}${requested.pathname}` : '<unique-page>'
  const now = Date.now()
  if (inFlight.has(key) || inFlight.size >= MAX_CONCURRENT || now - (attempts.get(key) ?? -Infinity) < COOLDOWN) return null
  inFlight.add(key)
  attempts.set(key, now)
  let session: Awaited<ReturnType<typeof cdpSession>> | undefined
  try {
    const found = await locate(options.pageUrl)
    if (!found) return null
    const url = safeUrl(found.target.url)!
    const time = new Date(now).toISOString()
    const project = safeLabel(options.project, 'unknown')
    const label = `${project} · ${url.pathname} · ${time}`
    const marker = `agent-eyes-${now}-${Math.random().toString(36).slice(2)}`
    session = await cdpSession(found.target.webSocketDebuggerUrl!)
    let annotated = false
    try {
      if (options.annotation !== false) {
        const expression = `(() => { const el = document.createElement('div'); el.id = ${JSON.stringify(marker)}; el.textContent = ${JSON.stringify(label)}; el.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;padding:4px 8px;background:#111;color:#fff;font:12px sans-serif;pointer-events:none'; document.documentElement.appendChild(el); })()`
        await session.command('Runtime.evaluate', { expression, returnByValue: true })
        annotated = true
      }
      const result = await session.command('Page.captureScreenshot', { format: 'png' }) as { data?: string }
      if (!result?.data) return null
      const file = `err-${routeSlug(url.pathname)}-${now}-${Math.random().toString(36).slice(2, 8)}.png`
      return await saveScreenshot(dir, Buffer.from(result.data, 'base64'), {
        project, pathname: url.pathname, origin: url.origin, time, file,
        engine: /chrom(e|ium)/i.test(found.browser) ? 'Chromium' : 'unknown',
        browser: found.browser, reason: safeReason(options.reason),
      })
    } finally {
      if (annotated) {
        try { await session.command('Runtime.evaluate', { expression: `document.getElementById(${JSON.stringify(marker)})?.remove()` }) }
        catch { /* Page may have closed after capture. */ }
      }
    }
  } catch { return null }
  finally { session?.close(); inFlight.delete(key) }
}
