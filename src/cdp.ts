import http from 'node:http'
import { execSync } from 'node:child_process'
import WebSocket from 'ws'

let lastAttempt = 0
const COOLDOWN = 2000
let cachedPort: number | null = null

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

/** 从 Chrome 进程命令行参数提取 --remote-debugging-port */
function detectPortFromProcess(): number | null {
  try {
    const out = execSync('ps x -o args= 2>/dev/null | grep -i "[C]hrome" | head -1', { encoding: 'utf8', timeout: 1000 })
    const m = out.match(/--remote-debugging-port=(\d+)/)
    return m ? parseInt(m[1], 10) : null
  } catch {
    return null
  }
}

/** 扫描常用端口范围，找到第一个响应 CDP 的 */
async function scanPorts(start = 9222, end = 9232): Promise<number | null> {
  for (let port = start; port <= end; port++) {
    try {
      const body = await httpGet(`http://127.0.0.1:${port}/json/version`, 300)
      if (JSON.parse(body)?.Browser) return port
    } catch {}
  }
  return null
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

  const fromProcess = detectPortFromProcess()
  if (fromProcess) {
    try {
      await httpGet(`http://127.0.0.1:${fromProcess}/json/version`, 300)
      cachedPort = fromProcess
      return fromProcess
    } catch {}
  }

  const fromScan = await scanPorts()
  if (fromScan) cachedPort = fromScan
  return fromScan
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
