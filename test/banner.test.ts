/**
 * agentBanner 启动横幅测试（§agentBanner）
 * 路由：无
 * API：验证环境 / 代理 / 别名 / 版本 / 技术栈采集与等宽渲染。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ViteDevServer } from 'vite'
import { describe, expect, it } from 'vitest'
import { agentBanner, collectBannerInfo, renderBanner, textWidth } from '../src/banner'

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-banner-'))
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return root
}

describe('collectBannerInfo', () => {
  it('reports env, masked proxy targets, aliases, version and stack from project files', () => {
    const root = fixture({
      'package.json': JSON.stringify({
        version: '2.3.4',
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { typescript: '^5.9.0', tailwindcss: '^4.1.0' },
      }),
      'pnpm-lock.yaml': '',
      '.env.development': 'VITE_API=/api',
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }),
      'src/main.ts': '',
    })
    const info = collectBannerInfo(
      root,
      {
        mode: 'development',
        proxy: { '/api': `https://${['user', 's3cret'].join(':')}@api.example.com/v1` },
        define: { __APP_VERSION__: '"2.3.4"' },
        resolve: { alias: [{ find: '@', replacement: path.join(root, 'src') }] },
      },
      { port: 5173 },
    )
    expect(info.mode).toBe('development')
    expect(info.envFile).toBe('.env.development')
    expect(info.proxies).toEqual([{ path: '/api', target: 'https://***@api.example.com/v1' }])
    expect(info.aliases).toEqual([{ find: '@', replacement: 'src' }])
    expect(info.versionInjected).toBe(true)
    expect(info.packageVersion).toBe('2.3.4')
    expect(info.stack).toEqual(['React 19.0.0', 'TypeScript 5.9.0', 'Tailwind CSS 4.1.0'])
    expect(info.packageManager).toBe('pnpm')
    expect(info.tsPaths).toBe(true)
    expect(JSON.stringify(info)).not.toContain('s3cret')
  })

  it('suggests an alias shortcut when none is configured', () => {
    const root = fixture({ 'package.json': JSON.stringify({ name: 'demo' }) })
    const info = collectBannerInfo(root, { mode: 'development', proxy: {}, define: {} })
    const lines = renderBanner(info).join('\n')
    expect(info.aliases).toEqual([])
    expect(lines).toContain('未配置 · 建议 resolve.alias')
    expect(lines).toContain('未注入版本戳记')
    expect(lines).toContain('未配置代理')
  })
})

describe('renderBanner', () => {
  it('keeps every line the same display width with CJK labels', () => {
    const root = fixture({ 'package.json': JSON.stringify({ version: '1.0.0', dependencies: { vue: '^3.5.0' } }) })
    const info = collectBannerInfo(root, {
      mode: 'development',
      proxy: { '/api': 'http://localhost:3000', '/auth': 'http://localhost:3001' },
      define: {},
    }, { port: 5173 })
    const lines = renderBanner(info)
    const widths = lines.map((line) => textWidth(line))
    expect(new Set(widths).size).toBe(1)
    expect(lines[0].startsWith('╭')).toBe(true)
    expect(lines.at(-1)?.startsWith('╰')).toBe(true)
    expect(lines.join('\n')).toContain('已启用')
    expect(lines.join('\n')).toContain('development')
    expect(lines.join('\n')).toContain('/api → http://localhost:3000')
    expect(lines.join('\n')).toContain('Vue 3.5.0')
  })

  it('does not emit ANSI escapes when color is disabled', () => {
    const root = fixture({ 'package.json': JSON.stringify({ name: 'demo' }) })
    const lines = renderBanner(collectBannerInfo(root, { mode: 'development', proxy: {}, define: {} }))
    expect(lines.join('\n')).not.toContain('\x1b[')
  })
})

describe('agentBanner plugin', () => {
  function fakeServer(root: string, logLevel: string): { server: ViteDevServer; infos: string[]; http: EventEmitter } {
    const infos: string[] = []
    const http = new EventEmitter() as EventEmitter & { address: () => { port: number } }
    http.address = () => ({ port: 5173 })
    const server = {
      config: {
        root,
        mode: 'development',
        proxy: {},
        define: {},
        resolve: { alias: [] },
        logLevel,
        server: {},
        logger: { info: (message: string) => infos.push(message) },
      },
      httpServer: http,
    } as unknown as ViteDevServer
    return { server, infos, http }
  }

  it('prints once after the server starts listening', () => {
    const root = fixture({ 'package.json': JSON.stringify({ name: 'demo' }) })
    const { server, infos, http } = fakeServer(root, 'info')
    const plugin = agentBanner({ endpoint: '/dev/log' })
    if (typeof plugin.configureServer !== 'function') throw new Error('missing hook')
    ;(plugin.configureServer as (this: unknown, server: ViteDevServer) => void).call({}, server)
    expect(infos).toEqual([])
    http.emit('listening')
    http.emit('listening')
    expect(infos).toHaveLength(1)
    expect(infos[0]).toContain('已启用')
    expect(infos[0]).toContain('5173')
  })

  it('stays quiet when disabled or logLevel is silent', () => {
    const root = fixture({ 'package.json': JSON.stringify({ name: 'demo' }) })
    const silent = fakeServer(root, 'silent')
    const silentPlugin = agentBanner()
    ;(silentPlugin.configureServer as (this: unknown, server: ViteDevServer) => void).call({}, silent.server)
    silent.http.emit('listening')
    expect(silent.infos).toEqual([])

    const disabled = fakeServer(root, 'info')
    const disabledPlugin = agentBanner({ enabled: false })
    ;(disabledPlugin.configureServer as (this: unknown, server: ViteDevServer) => void).call({}, disabled.server)
    disabled.http.emit('listening')
    expect(disabled.infos).toEqual([])
  })
})
