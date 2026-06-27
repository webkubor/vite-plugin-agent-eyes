/**
 * agentDebugger 登录态 middleware 测试（§agent auth）
 * 路由：无
 * API：POST /dev/log kind=auth 写入 log/<port>/auth-state.json。
 */

import { PassThrough } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ViteDevServer } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'
import { agentDebugger } from '../src/index'

type Middleware = (req: PassThrough & { method?: string }, res: { statusCode?: number; end: () => void }) => void

const tempDirs: string[] = []

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-auth-mw-'))
  tempDirs.push(root)
  return root
}

function configureDebugger(root: string): Middleware {
  let middleware: Middleware | null = null
  const plugin = agentDebugger({ logDir: path.join(root, 'log') })
  if (typeof plugin.configureServer !== 'function') throw new Error('configureServer is not a function')
  plugin.configureServer({
    config: {
      root,
      server: { port: 5179 },
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
        return { port: 5179 }
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

describe('agentDebugger auth state middleware', () => {
  it('writes sanitized auth-state.json under the current port log directory', async () => {
    const root = makeRoot()
    const middleware = configureDebugger(root)

    const statusCode = await postJson(middleware, {
      kind: 'auth',
      event: 'login_success',
      state: {
        loggedIn: true,
        updatedAt: '2026-06-28T10:00:00.000Z',
        page_path: '/dashboard',
        profile: {
          userId: 'u_123',
          email: 'alice@example.com',
          token: 'secret-token',
          roles: ['admin'],
          extra: {
            plan: 'pro',
            sessionId: 'secret-session',
          },
        },
      },
    })

    const authFile = path.join(root, 'log', '5179', 'auth-state.json')
    const report = JSON.parse(fs.readFileSync(authFile, 'utf8'))

    expect(statusCode).toBe(204)
    expect(report).toEqual({
      loggedIn: true,
      updatedAt: '2026-06-28T10:00:00.000Z',
      page_path: '/dashboard',
      profile: {
        userId: 'u_123',
        email: 'a***@example.com',
        roles: ['admin'],
        extra: { plan: 'pro' },
      },
    })
    expect(JSON.stringify(report)).not.toContain('alice@example.com')
    expect(JSON.stringify(report)).not.toContain('secret-token')
    expect(JSON.stringify(report)).not.toContain('secret-session')
  })
})
