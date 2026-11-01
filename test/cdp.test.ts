/**
 * CDP 截图目标选择、脱敏记录和临时标记测试。
 * 路由：模拟 HTTP(S) 页面；API：模拟 Chrome DevTools HTTP/WebSocket。
 */
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  targets: [] as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>,
  methods: [] as Array<{ method: string; params?: { expression?: string } }>,
  failScreenshot: false,
}))

vi.mock('node:http', async () => {
  const { EventEmitter } = await import('node:events')
  return { default: { get(url: string, _options: unknown, callback: (response: EventEmitter & { statusCode: number; resume(): void }) => void) {
    const request = new EventEmitter() as EventEmitter & { destroy(error?: Error): void }
    request.destroy = (error) => { if (error) request.emit('error', error) }
    queueMicrotask(() => {
      const response = new EventEmitter() as EventEmitter & { statusCode: number; resume(): void }
      response.statusCode = 200
      response.resume = () => {}
      callback(response)
      const body = url.endsWith('/json/version') ? { Browser: 'Chrome/131.0 CDP' } : mock.targets
      response.emit('data', Buffer.from(JSON.stringify(body)))
      response.emit('end')
    })
    return request
  } } }
})

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeSocket extends EventEmitter {
    constructor(_url: string) { super(); queueMicrotask(() => this.emit('open')) }
    send(payload: string, callback: (error?: Error) => void) {
      const data = JSON.parse(payload) as { id: number; method: string; params?: { expression?: string } }
      mock.methods.push({ method: data.method, params: data.params })
      queueMicrotask(() => {
        if (data.method === 'Page.captureScreenshot' && mock.failScreenshot)
          this.emit('message', JSON.stringify({ id: data.id, error: { message: 'capture failed' } }))
        else this.emit('message', JSON.stringify({ id: data.id, result: data.method === 'Page.captureScreenshot'
          ? { data: Buffer.from('fake png').toString('base64') } : {} }))
      })
      callback()
    }
    close() { queueMicrotask(() => this.emit('close')) }
  }
  return { default: FakeSocket }
})

import { captureScreenshot, inspectBrowserCapability, selectScreenshotPage } from '../src/cdp'

const target = (url: string) => ({ type: 'page', url, webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1' })
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-eyes-cdp-'))
  mock.targets = []
  mock.methods = []
  mock.failScreenshot = false
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('CDP screenshots', () => {
  it('matches origin and pathname across tabs without using query or hash', async () => {
    mock.targets = [target('https://example.test/other'), target('https://example.test/checkout?token=secret#anchor')]
    expect(selectScreenshotPage(mock.targets, 'https://example.test/checkout?token=another#x')).toEqual(mock.targets[1])
    const result = await captureScreenshot(dir, { pageUrl: 'https://example.test/checkout?token=another#x', annotation: false })
    expect(result).toContain('err-checkout-')
    expect(mock.methods.map((item) => item.method)).toEqual(['Page.captureScreenshot'])
    const sidecar = JSON.parse(await readFile(result!.replace(/\.png$/, '.json'), 'utf8'))
    const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'))
    expect(sidecar).toMatchObject({ origin: 'https://example.test', pathname: '/checkout', file: path.basename(result!), engine: 'Chromium', browser: 'Chrome/131.0 CDP' })
    expect(index).toEqual([sidecar])
    expect(JSON.stringify({ sidecar, index })).not.toMatch(/secret|another|token|anchor/)
  })

  it('does not screenshot when the page is missing or ambiguous', async () => {
    mock.targets = [target('https://example.test/one'), target('https://example.test/two')]
    expect(await captureScreenshot(dir, { pageUrl: 'https://example.test/missing' })).toBeNull()
    expect(await captureScreenshot(dir)).toBeNull()
    expect(mock.methods).toEqual([])
    expect(await readdir(dir)).toEqual([])
  })

  it('requires a matching page websocket for capability', async () => {
    mock.targets = [target('https://example.test/good')]
    expect(await inspectBrowserCapability('https://example.test/missing')).toMatchObject({ available: false, matchingPage: false })
    expect(await inspectBrowserCapability('https://example.test/good?secret=yes')).toMatchObject({ available: true, matchingPage: true, engine: 'Chromium' })
    mock.targets = [{ type: 'page', url: 'https://example.test/good' }]
    expect(await inspectBrowserCapability('https://example.test/good')).toMatchObject({ available: false })
  })

  it('records sanitized metadata and always removes annotation after a failed capture', async () => {
    mock.targets = [target('https://user:private-password@private.test/checkout?token=secret')]
    mock.failScreenshot = true
    expect(selectScreenshotPage(mock.targets, 'https://user:private-password@private.test/checkout?token=other')).toEqual(mock.targets[0])
    expect(await captureScreenshot(dir, { pageUrl: 'https://user:private-password@private.test/checkout?token=other', project: 'shop?secret', reason: 'error?token=secret' })).toBeNull()
    expect(mock.methods.map((item) => item.method)).toEqual(['Runtime.evaluate', 'Page.captureScreenshot', 'Runtime.evaluate'])
    expect(mock.methods[0].params?.expression).toContain('textContent')
    expect(mock.methods[2].params?.expression).toContain('?.remove()')
    expect(mock.methods[0].params?.expression).not.toContain('token=')
    mock.failScreenshot = false
    // Use another route so its cooldown is independent.
    mock.targets = [target('https://user:private-password@private.test/other?token=secret')]
    const result = await captureScreenshot(dir, { pageUrl: 'https://user:private-password@private.test/other', project: 'shop?secret', reason: 'error?token=secret' })
    const metadata = await readFile(result!.replace(/\.png$/, '.json'), 'utf8')
    expect(metadata).not.toMatch(/private-password|token|secret|\?/) 
    expect(JSON.parse(metadata)).toMatchObject({ project: 'unknown', origin: 'https://private.test', reason: 'unspecified' })
  })
})
