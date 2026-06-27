/**
 * 登录态脱敏与客户端记录测试（§agent auth）
 * 路由：无
 * API：验证本地 dev 登录画像清洗，不保存 token/cookie。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLoginAuthState,
  installBrowserAuthState,
  sanitizeAuthProfile,
  type AgentAuthProfileInput,
} from '../src/auth-state'
import { installAgentAuthRecorder, recordLoginSuccess } from '../src/client'

declare global {
  interface Window {
    __AGENT_EYES_AUTH__?: unknown
  }
}

afterEach(() => {
  vi.useRealTimers()
  if (typeof window !== 'undefined') delete window.__AGENT_EYES_AUTH__
})

function withBrowserWindow(): Window {
  const fakeWindow = {} as Window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  })
  return fakeWindow
}

describe('sanitizeAuthProfile', () => {
  it('masks emails and keeps only safe account fields', () => {
    const profile = sanitizeAuthProfile({
      userId: 'u_123',
      email: 'alice@example.com',
      name: 'Alice',
      roles: ['admin', 42, 'editor'],
      tenantId: 'tenant_1',
      token: 'secret-token',
      authorization: 'Bearer secret',
      cookie: 'sid=secret',
      unknown: 'drop me',
    })

    expect(profile).toEqual({
      userId: 'u_123',
      email: 'a***@example.com',
      name: 'Alice',
      roles: ['admin', 'editor'],
      tenantId: 'tenant_1',
    })
    expect(JSON.stringify(profile)).not.toContain('secret')
    expect(JSON.stringify(profile)).not.toContain('alice@example.com')
  })

  it('filters sensitive extra fields and keeps safe primitive extras', () => {
    const profile = sanitizeAuthProfile({
      userId: 'u_123',
      extra: {
        plan: 'pro',
        seats: 12,
        enabled: true,
        nested: { unsafe: true },
        refreshToken: 'secret-refresh',
        session_id: 'secret-session',
      },
    })

    expect(profile.extra).toEqual({ plan: 'pro', seats: 12, enabled: true })
    expect(JSON.stringify(profile)).not.toContain('secret-refresh')
    expect(JSON.stringify(profile)).not.toContain('secret-session')
  })
})

describe('createLoginAuthState', () => {
  it('creates a logged-in state with sanitized profile and page path', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-28T10:00:00.000Z'))

    const state = createLoginAuthState(
      { userId: 'u_123', email: 'alice@example.com' },
      { pagePath: '/dashboard' },
    )

    expect(state).toEqual({
      loggedIn: true,
      updatedAt: '2026-06-28T10:00:00.000Z',
      page_path: '/dashboard',
      profile: {
        userId: 'u_123',
        email: 'a***@example.com',
      },
    })
  })
})

describe('installBrowserAuthState', () => {
  it('injects sanitized state into the browser object model', () => {
    const browserWindow = withBrowserWindow()
    const state = createLoginAuthState({ userId: 'u_123', email: 'alice@example.com' })

    installBrowserAuthState(state)

    expect(browserWindow.__AGENT_EYES_AUTH__).toEqual(state)
    expect(JSON.stringify(browserWindow.__AGENT_EYES_AUTH__)).not.toContain('alice@example.com')
  })

  it('does nothing outside a browser global', () => {
    const originalWindow = globalThis.window
    Reflect.deleteProperty(globalThis, 'window')
    const state = createLoginAuthState({ userId: 'u_123' })

    expect(() => installBrowserAuthState(state)).not.toThrow()

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  })
})

describe('AgentAuthProfileInput', () => {
  it('accepts the public profile shape used by applications', () => {
    const input: AgentAuthProfileInput = {
      userId: 'u_123',
      email: 'alice@example.com',
      roles: ['admin'],
      tenantId: 'tenant_1',
    }

    expect(sanitizeAuthProfile(input).email).toBe('a***@example.com')
  })
})

describe('client auth recorder API', () => {
  it('records login success into BOM and posts sanitized auth state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-28T10:00:00.000Z'))
    const browserWindow = withBrowserWindow()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { pathname: '/dashboard', href: 'http://localhost:5173/dashboard' },
    })
    const fetchMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    })

    const state = recordLoginSuccess({
      userId: 'u_123',
      email: 'alice@example.com',
      token: 'secret-token',
    })

    expect(state.profile.email).toBe('a***@example.com')
    expect(browserWindow.__AGENT_EYES_AUTH__).toEqual(state)
    expect(fetchMock).toHaveBeenCalledWith('/dev/log', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body).toEqual({ kind: 'auth', event: 'login_success', state })
    expect(JSON.stringify(body)).not.toContain('alice@example.com')
    expect(JSON.stringify(body)).not.toContain('secret-token')
  })

  it('installAgentAuthRecorder records getProfile once and returns an uninstall function', async () => {
    withBrowserWindow()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { pathname: '/settings', href: 'http://localhost:5173/settings' },
    })
    const fetchMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    })

    const uninstall = installAgentAuthRecorder({
      getProfile: () => ({ userId: 'u_456', email: 'bob@example.com' }),
    })

    expect(typeof uninstall).toBe('function')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    uninstall()

    expect(window.__AGENT_EYES_AUTH__).toBeUndefined()
  })
})
