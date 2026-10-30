/**
 * agentProjectGuide 项目体检测试（§agentProjectGuide）
 * 路由：无
 * API：验证项目类型、层级目录、@ alias 与建议报告。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ViteDevServer } from 'vite'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { agentProjectGuide, aliasMatchesResolved, inspectProject } from '../src/project-guide'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-project-guide-'))
}

function write(root: string, rel: string, content = ''): void {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

function fakeServer(root: string, warnings: string[]): ViteDevServer {
  return {
    config: {
      root,
      logger: {
        warn(message: string) {
          warnings.push(message)
        },
      },
    },
  } as unknown as ViteDevServer
}

describe('inspectProject', () => {
  it('detects common frontend layers and @ alias', () => {
    const root = tempRoot()
    write(root, 'package.json', JSON.stringify({ dependencies: { vue: '^3.0.0' } }))
    write(root, 'vite.config.ts', "resolve: { alias: { '@': '/src' } }")
    write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }))
    write(root, 'src/api/user.ts')
    write(root, 'src/features/auth/index.ts')
    write(root, 'src/router/index.ts')
    write(root, 'src/config/env.ts')

    const report = inspectProject(root)

    expect(report.projectType).toBe('Vue')
    expect(report.detected.alias).toBe(true)
    expect(report.detected.apiLayer).toEqual(['src/api'])
    expect(report.detected.businessLayer).toEqual(['src/features'])
    expect(report.detected.routeLayer).toEqual(['src/router'])
    expect(report.detected.configLayer).toEqual(['src/config'])
    expect(report.suggestions).toEqual([])
  })

  it('includes instruction warnings in the report and allows disabling each diagnostic', () => {
    const root = tempRoot()
    write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '^8.0.0' } }))
    write(root, 'AGENTS.md', 'a\nb\nc')
    write(root, 'src/main.ts', 'console.log(import.meta.env.VITE_MISSING)')
    const report = inspectProject(root, { instructions: { warnLines: 3 } })
    expect(report.instructions?.documents[0]).toMatchObject({ file: 'AGENTS.md', oversized: true })
    expect(report.suggestions.join('\n')).toContain('AGENTS.md')
    expect(report.configuration?.issues.some((issue) => issue.code === 'ENV_MISSING')).toBe(true)
    const disabled = inspectProject(root, { instructions: false, configuration: false })
    expect(disabled.instructions).toBeUndefined()
    expect(disabled.configuration).toBeUndefined()
  })

  it('suggests missing layers and alias for sparse projects', () => {
    const root = tempRoot()
    write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '^5.0.0' } }))
    write(root, 'src/main.ts')

    const report = inspectProject(root)

    expect(report.projectType).toBe('Vite')
    expect(report.detected.alias).toBe(false)
    expect(report.suggestions.join('\n')).toContain('@')
    expect(report.suggestions.join('\n')).toContain('API/request/service')
    expect(report.suggestions.join('\n')).toContain('router/routes/pages/views')
  })

  it('prefers runtime resolvedAlias over text/tsconfig inference (runtime-truth)', () => {
    const root = tempRoot()
    // 文本推断会误判无 alias：vite.config 与 tsconfig 都没有 @ alias
    write(root, 'package.json', JSON.stringify({ dependencies: { vue: '^3.0.0' } }))
    write(root, 'vite.config.ts', 'export default { plugins: [] }')
    write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: {} }))
    write(root, 'src/main.ts')

    const byInference = inspectProject(root)
    expect(byInference.detected.alias).toBe(false)

    // 但 vite 运行时实际配置了 @ alias —— 应采信运行时真值
    const withRuntimeTrue = inspectProject(root, { resolvedAlias: true })
    expect(withRuntimeTrue.detected.alias).toBe(true)

    // 反向：文件里写了 @ alias，但运行时实际没配 —— 不应误报
    write(root, 'vite.config.ts', "resolve: { alias: { '@': '/src' } }")
    const byInferenceTrue = inspectProject(root)
    expect(byInferenceTrue.detected.alias).toBe(true)
    const withRuntimeFalse = inspectProject(root, { resolvedAlias: false })
    expect(withRuntimeFalse.detected.alias).toBe(false)
  })
})

describe('project guide refresh', () => {
  it('refreshes nested instruction warnings on save and detaches watchers on close', () => {
    vi.useFakeTimers()
    try {
      const root = tempRoot()
      const warnings: string[] = []
      const server = fakeServer(root, warnings)
      const watcher = new EventEmitter()
      const http = new EventEmitter()
      Object.assign(server, { watcher, httpServer: http })
      const plugin = agentProjectGuide({ instructions: { warnLines: 3 } })
      if (typeof plugin.configureServer !== 'function') throw new Error('missing hook')
      ;(plugin.configureServer as (this: unknown, server: ViteDevServer) => void).call({}, server)
      const file = path.join(root, 'src/AGENTS.md')
      write(root, 'src/AGENTS.md', 'a\nb\nc')
      watcher.emit('add', file)
      vi.advanceTimersByTime(110)
      const report = JSON.parse(fs.readFileSync(path.join(root, 'log/project-guide.json'), 'utf8'))
      expect(report.instructions.documents[0].oversized).toBe(true)
      expect(warnings.some((item) => item.includes('AGENTS.md'))).toBe(true)
      http.emit('close')
      expect(watcher.listenerCount('change')).toBe(0)
      // middlewareMode 没有 httpServer，依赖插件关闭钩子释放资源。
      const middleware = fakeServer(root, warnings)
      const middlewareWatcher = new EventEmitter()
      Object.assign(middleware, { watcher: middlewareWatcher, httpServer: null })
      const middlewarePlugin = agentProjectGuide()
      if (typeof middlewarePlugin.configureServer !== 'function' || typeof middlewarePlugin.closeBundle !== 'function') throw new Error('missing hooks')
      ;(middlewarePlugin.configureServer as (this: unknown, server: ViteDevServer) => void).call({}, middleware)
      expect(middlewareWatcher.listenerCount('change')).toBe(1)
      ;(middlewarePlugin.closeBundle as (this: unknown) => void).call({})
      expect(middlewareWatcher.listenerCount('change')).toBe(0)
    } finally { vi.useRealTimers() }
  })
})

describe('aliasMatchesResolved', () => {
  it('matches vite normalized string aliases', () => {
    // 对应 vite config `resolve.alias: { '@': '/src' }` 和 `'@/': '/src/'`（后者被剥尾斜杠成 '@'）
    expect(aliasMatchesResolved([{ find: '@', replacement: '/src' }], '@')).toBe(true)
    expect(aliasMatchesResolved([{ find: '@', replacement: '/src' }], 'aliases')).toBe(false)
    expect(aliasMatchesResolved([{ find: '~', replacement: '/src' }], '@')).toBe(false)
  })

  it('matches RegExp find and ignores non-alias entries', () => {
    expect(aliasMatchesResolved([{ find: /^@\//, replacement: '/src' }], '@')).toBe(true)
    expect(aliasMatchesResolved([{ find: /^~/, replacement: '/src' }], '@')).toBe(false)
    // 混入 vite 内置的 @vite/* alias 不应命中
    expect(aliasMatchesResolved([{ find: /^\/?@vite\/env/, replacement: '/x' }], '@')).toBe(false)
  })

  it('returns false for non-array input', () => {
    expect(aliasMatchesResolved(undefined, '@')).toBe(false)
    expect(aliasMatchesResolved(null, '@')).toBe(false)
    expect(aliasMatchesResolved({ find: '@', replacement: '/src' }, '@')).toBe(false)
  })
})

describe('agentProjectGuide', () => {
  it('writes project-guide.json and warns with a summary', () => {
    const root = tempRoot()
    const warnings: string[] = []
    write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '^5.0.0' } }))
    write(root, 'src/main.ts')

    const plugin = agentProjectGuide()
    if (typeof plugin.configureServer !== 'function') throw new Error('configureServer is not a function')
    ;(plugin.configureServer as (this: unknown, server: ViteDevServer) => void).call({}, fakeServer(root, warnings))

    const report = JSON.parse(fs.readFileSync(path.join(root, 'log', 'project-guide.json'), 'utf8'))
    expect(report.suggestions.length).toBeGreaterThan(0)
    expect(warnings.join('\n')).toContain('project-guide.json')
  })

  it('uses runtime resolve.alias from server config over text inference', () => {
    const root = tempRoot()
    const warnings: string[] = []
    write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '^5.0.0' } }))
    write(root, 'vite.config.ts', 'export default { plugins: [] }') // 文本推断无 alias
    write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: {} }))
    write(root, 'src/main.ts')

    const server = fakeServer(root, warnings)
    ;(server.config as { resolve?: unknown }).resolve = { alias: [{ find: '@', replacement: '/src' }] }

    const plugin = agentProjectGuide()
    if (typeof plugin.configureServer !== 'function') throw new Error('configureServer is not a function')
    ;(plugin.configureServer as (this: unknown, server: ViteDevServer) => void).call({}, server)

    const report = JSON.parse(fs.readFileSync(path.join(root, 'log', 'project-guide.json'), 'utf8'))
    expect(report.detected.alias).toBe(true)
  })
})
