/**
 * agentDebugger 交互轨迹 middleware 测试（§interaction trace）
 * 路由：无
 * API：POST /dev/log kind=interaction_batch 写入 log/<port>/interaction.log。
 */

import { PassThrough } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ViteDevServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentDebugger } from '../src/index'

type Middleware = (req: PassThrough & { method?: string }, res: { statusCode?: number; end: () => void }) => void

const tempDirs: string[] = []

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-interaction-mw-'))
  tempDirs.push(root)
  return root
}

function configureDebugger(root: string): Middleware {
  let middleware: Middleware | null = null
  const plugin = agentDebugger({ logDir: path.join(root, 'log'), flushMs: 1 })
  if (typeof plugin.configureServer !== 'function') throw new Error('configureServer is not a function')
  plugin.configureServer({
    config: {
      root,
      server: { port: 5180 },
      logger: {
        info() {},
        warn() {},
      },
    },
    httpServer: {
      once(event: string, callback: () => void) {
        if (event === 'listening') callback()
      },
      address() {
        return { port: 5180 }
      },
    },
    middlewares: {
      use(route: string, handler: Middleware) {
        if (route === '/dev/log') middleware = handler
      },
    },
  } as unknown as ViteDevServer)
  if (!middleware) throw new Error('middleware was not registered')
  return middleware
}

function postJson(middleware: Middleware, body: unknown): Promise<number | undefined> {
  return new Promise((resolve) => {
    const req = new PassThrough() as PassThrough & { method?: string }
    req.method = 'POST'
    const res = {
      statusCode: undefined as number | undefined,
      end: () => resolve(res.statusCode),
    }
    middleware(req, res)
    req.end(JSON.stringify(body))
  })
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.length = 0
})

describe('agentDebugger interaction middleware', () => {
  it('writes interaction.log under the current port log directory', async () => {
    const root = makeRoot()
    const middleware = configureDebugger(root)

    const statusCode = await postJson(middleware, {
      kind: 'interaction_batch',
      entries: [
        {
          kind: 'click',
          at: '2026-06-28T12:00:00.000Z',
          page_path: '/dashboard',
          target: 'button[data-testid=save] "保存"',
        },
        {
          kind: 'input',
          at: '2026-06-28T12:00:01.000Z',
          target: 'input[name=password]',
          value: '<redacted>',
        },
      ],
    })

    const interactionFile = path.join(root, 'log', '5180', 'interaction.log')
    await vi.waitFor(() => {
      expect(fs.readFileSync(interactionFile, 'utf8')).toContain('[click] /dashboard button[data-testid=save] "保存"')
    })
    const content = fs.readFileSync(interactionFile, 'utf8')

    expect(statusCode).toBe(204)
    expect(content).toContain('[input] input[name=password] <redacted>')
  })
})
