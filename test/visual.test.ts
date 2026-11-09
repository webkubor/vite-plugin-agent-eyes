import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/cdp', () => ({
  inspectBrowserCapability: vi.fn(async () => ({ available: true, matchingPage: true, engine: 'Chromium', reason: 'Matching CDP page available' })),
  captureScreenshot: vi.fn(async () => null),
}))
import { agentVisual } from '../src/visual'
import { captureScreenshot, inspectBrowserCapability } from '../src/cdp'
const servers: ViteDevServer[] = []
const roots: string[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); vi.clearAllMocks() })
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eyes-visual-')); roots.push(root)
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'assets/robots.txt'), 'User-agent: *\nAllow: /')
  const server = await createServer({ root, configFile: false, publicDir: 'assets', logLevel: 'silent', server: { port: 0, host: '127.0.0.1' }, plugins: [agentVisual()] })
  servers.push(server); await server.listen()
  const address = server.httpServer!.address() as { port: number }
  return { server, base: `http://127.0.0.1:${address.port}` }
}
describe('visual dev panel', () => {
  it('shows project route and crawler state; removes query from requested page', async () => {
    const { base } = await fixture()
    const response = await fetch(`${base}/__agent-eyes/status?page=${encodeURIComponent(`${base}/users?token=secret#hidden`)}`)
    const data = await response.json()
    expect(data.route).toBe('/users')
    expect(data.crawler.robots.file).toBe('assets/robots.txt')
    expect(inspectBrowserCapability).toHaveBeenCalledWith(`${base}/users`)
    expect(JSON.stringify(data)).not.toContain('secret')
    const html = await fetch(`${base}/__agent-eyes?page=${encodeURIComponent(`${base}/users`)}`).then((r) => r.text())
    expect(html).toContain('爬虫与 AI 可读性配置')
    expect(html).toContain('截取当前路由')
    // 2026-11-09 重写：状态先行 —— 首屏给徽章与中文原因，原始 JSON 收进可展开区。
    expect(html).toContain('浏览器与截图能力')
    expect(html).toContain('原始状态数据')
    expect(html).toContain('原始探测数据')
  })
  it('explains an unavailable browser in Chinese with a next step', async () => {
    vi.mocked(inspectBrowserCapability).mockResolvedValueOnce({
      available: false, matchingPage: false, engine: 'unknown', reason: 'CDP unavailable',
    })
    const { base } = await fixture()
    const html = await fetch(`${base}/__agent-eyes?page=${encodeURIComponent(`${base}/users`)}`).then((r) => r.text())
    // CDP 的 reason 是英文；面板必须给出中文说明与下一步，而不是把英文原样丢给使用者。
    expect(html).toContain('浏览器没有开放调试端口')
    expect(html).toContain('下一步')
  })
  it('rejects off-project capture and cross-origin requests', async () => {
    const { base } = await fixture()
    expect((await fetch(`${base}/__agent-eyes/capture?page=${encodeURIComponent('https://unrelated.test/')}`, { method: 'POST' })).status).toBe(400)
    expect((await fetch(`${base}/__agent-eyes/capture?page=${encodeURIComponent(`${base}/users`)}`, { method: 'POST', headers: { Origin: 'https://unrelated.test' } })).status).toBe(403)
    expect(captureScreenshot).not.toHaveBeenCalled()
    expect((await fetch(`${base}/__agent-eyes/capture?page=${encodeURIComponent(`${base}/users`)}`)).status).toBe(405)
  })
  it('injects a default page entry and supports explicit disable', async () => {
    const { server } = await fixture()
    expect(await server.transformIndexHtml('/users', '<html><body></body></html>')).toContain('◉ Agent Eyes')
    const plugin = agentVisual({ enabled: false })
    const transform = plugin.transformIndexHtml as () => unknown
    expect(transform()).toEqual([])
  })
})
