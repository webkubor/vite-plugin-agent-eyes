/**
 * agentProjectGuide 项目体检测试（§agentProjectGuide）
 * 路由：无
 * API：验证项目类型、层级目录、@ alias 与建议报告。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ViteDevServer } from 'vite'
import { describe, expect, it } from 'vitest'
import { agentProjectGuide, inspectProject } from '../src/project-guide'

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
})
