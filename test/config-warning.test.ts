/**
 * 配置提示测试（§config diagnostics）
 * 路由：无
 * API：验证 agentDebugger / agentProxy 的常见误配置会给 dev server warn。
 */

import { describe, expect, it, vi } from 'vitest'
import type { ViteDevServer } from 'vite'
import { agentDebugger, agentProxy } from '../src/index'

function configureDebuggerWithWarn(options: Parameters<typeof agentDebugger>[0]): string[] {
  const warnings: string[] = []
  const plugin = agentDebugger(options)
  if (typeof plugin.configureServer !== 'function') throw new Error('configureServer is not a function')
  plugin.configureServer({
    config: {
      root: process.cwd(),
      server: { port: 5190 },
      logger: {
        info() {},
        warn(message: string) {
          warnings.push(message)
        },
      },
    },
    httpServer: {
      once(event: string, callback: () => void) {
        if (event === 'listening') callback()
      },
      address() {
        return { port: 5190 }
      },
    },
    middlewares: {
      use() {},
    },
  } as unknown as ViteDevServer)
  return warnings
}

describe('agentDebugger config diagnostics', () => {
  it('warns for endpoint and size options that commonly break telemetry', () => {
    const warnings = configureDebuggerWithWarn({
      endpoint: 'dev/log',
      flushMs: 0,
      maxBytes: 1024,
    })

    expect(warnings.join('\n')).toContain('endpoint')
    expect(warnings.join('\n')).toContain('flushMs')
    expect(warnings.join('\n')).toContain('maxBytes')
  })
})

describe('agentProxy config diagnostics', () => {
  it('warns for non-http targets and preserves extra.configure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const extraConfigure = vi.fn()
    const proxy = {
      on: vi.fn(),
    }
    const options = agentProxy('ws://example.com', {
      flushMs: -1,
      maxBytes: 1000,
      extra: {
        configure: extraConfigure,
      },
    })

    options.configure?.(proxy as never, {} as never)

    const warningText = warn.mock.calls.map((item) => String(item[0])).join('\n')
    expect(extraConfigure).toHaveBeenCalled()
    expect(warningText).toContain('target')
    expect(warningText).toContain('flushMs')
    expect(warningText).toContain('maxBytes')
    warn.mockRestore()
  })
})
