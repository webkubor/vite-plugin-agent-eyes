/**
 * agentSizeWatch dev 看门狗测试（§agentSizeWatch）
 * 路由：无
 * API：验证启动全量扫描 + 热更新增量检查，CSS 用更严阈值，超阈值才 warn。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ViteDevServer } from 'vite'
import { describe, expect, it } from 'vitest'
import { agentSizeWatch } from '../src/index'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-size-'))
}

function write(root: string, rel: string, lines: number): string {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n'))
  return abs
}

function fakeServer(root: string, warnings: string[]): ViteDevServer {
  return {
    config: { root, logger: { warn: (m: string) => warnings.push(m) } },
  } as unknown as ViteDevServer
}

function runStartup(options: Parameters<typeof agentSizeWatch>[0], root: string): string {
  const warnings: string[] = []
  const plugin = agentSizeWatch(options)
  ;(plugin.configureServer as (s: ViteDevServer) => void)(fakeServer(root, warnings))
  return warnings.join('\n')
}

describe('agentSizeWatch', () => {
  it('startup scan warns long source and CSS files, ignores short ones and node_modules', () => {
    const root = tempRoot()
    write(root, 'src/big.ts', 420) // > 通用 400
    write(root, 'src/ok.ts', 100) // 通用阈值下，不报
    write(root, 'src/big.css', 320) // > CSS 300
    write(root, 'src/ok.css', 250) // CSS 阈值下，不报
    write(root, 'node_modules/dep/huge.ts', 999) // 排除目录，不报

    const text = runStartup({}, root)

    expect(text).toContain('src/big.ts')
    expect(text).toContain('src/big.css')
    expect(text).not.toContain('src/ok.ts')
    expect(text).not.toContain('src/ok.css')
    expect(text).not.toContain('huge.ts')
  })

  it('handleHotUpdate warns only the changed file when it exceeds threshold', () => {
    const root = tempRoot()
    const abs = write(root, 'src/grew.css', 305)
    const warnings: string[] = []
    const plugin = agentSizeWatch({})
    type HotCtx = { file: string; server: ViteDevServer }
    const hot = plugin.handleHotUpdate as (ctx: HotCtx) => void
    hot({ file: abs, server: fakeServer(root, warnings) })
    expect(warnings.join('\n')).toContain('src/grew.css')
  })

  it('disabled produces no warnings', () => {
    const root = tempRoot()
    write(root, 'src/big.ts', 999)
    expect(runStartup({ enabled: false }, root)).toBe('')
  })
})
