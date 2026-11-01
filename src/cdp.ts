import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import WebSocket from 'ws'

const execFileAsync = promisify(execFile)

let lastAttempt = 0
const COOLDOWN = 2000
/** 找不到 CDP 时静默一段时间，避免每次报错都重新扫端口（默认开启截图后这是常态）。 */
const MISS_COOLDOWN = 60_000
let cachedPort: number | null = null
let noPortUntil = 0

function httpGet(url: string, timeout = 500): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => (data += c))
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function cdpCommand(wsUrl: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 3000 })
    let id = 1
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('cdp timeout'))
    }, 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: id++, method, params }))
    })
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw))
        if (msg.id) {
          clearTimeout(timer)
          ws.close()
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
        }
      } catch {}
    })
    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/** 从 Chrome 进程命令行参数提取 --remote-debugging-port（异步，不阻塞 dev server）。 */
async function detectPortFromProcess(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['x', '-o', 'args='], { encoding: 'utf8', timeout: 1000 })
    const chromeLine = stdout.split('\n').find((line) => /chrome/i.test(line))
    const m = chromeLine?.match(/--remote-debugging-port=(\d+)/)
    return m ? parseInt(m[1], 10) : null
  } catch {
    return null
  }
}

/** 并行探测常用端口，找到第一个响应 CDP 的。 */
async function scanPorts(start = 9222, end = 9232): Promise<number | null> {
  const ports = Array.from({ length: end - start + 1 }, (_, index) => start + index)
  const results = await Promise.all(
    ports.map(async (port) => {
      try {
        const body = await httpGet(`http://127.0.0.1:${port}/json/version`, 300)
        return JSON.parse(body)?.Browser ? port : null
      } catch {
        return null
      }
    }),
  )
  return results.find((port) => port !== null) ?? null
}

/** 找到 Chrome CDP 端口，优先级：缓存 → 进程参数 → 端口扫描 */
async function findPort(): Promise<number | null> {
  if (cachedPort) {
    try {
      await httpGet(`http://127.0.0.1:${cachedPort}/json/version`, 300)
      return cachedPort
    } catch {
      cachedPort = null
    }
  }

  // 刚确认过没有可用 CDP：静默一段时间，别让每条报错都触发进程查询和端口扫描。
  if (Date.now() < noPortUntil) return null

  const fromProcess = await detectPortFromProcess()
  if (fromProcess) {
    try {
      await httpGet(`http://127.0.0.1:${fromProcess}/json/version`, 300)
      cachedPort = fromProcess
      return fromProcess
    } catch {}
  }

  const fromScan = await scanPorts()
  if (fromScan) {
    cachedPort = fromScan
    noPortUntil = 0
    return fromScan
  }
  noPortUntil = Date.now() + MISS_COOLDOWN
  return null
}

export async function captureScreenshot(dir: string): Promise<string | null> {
  const now = Date.now()
  if (now - lastAttempt < COOLDOWN) return null
  lastAttempt = now

  const port = await findPort()
  if (!port) return null

  try {
    const list = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json`))
    const target = list.find((t: { type: string }) => t.type === 'page')
    if (!target?.webSocketDebuggerUrl) return null

    const result = (await cdpCommand(target.webSocketDebuggerUrl, 'Page.captureScreenshot', {
      format: 'png',
      quality: 80,
    })) as { data?: string }
    if (!result?.data) return null

    const fs = await import('node:fs')
    const path = await import('node:path')
    const file = path.join(dir, `err-${now}.png`)
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
    return file
  } catch {
    return null
  }
}
