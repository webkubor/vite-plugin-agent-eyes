/**
 * 客户端交互轨迹测试（§interaction trace）
 * 路由：无
 * API：recordInteraction / installAgentInteractionTracer 只记录脱敏交互。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installAgentInteractionTracer, recordInteraction } from '../src/client'

type Listener = (event: { target?: EventTarget | null }) => void

const originals = {
  window: globalThis.window,
  document: globalThis.document,
  location: globalThis.location,
  history: globalThis.history,
  fetch: globalThis.fetch,
}

function setGlobal(name: 'window' | 'document' | 'location' | 'history' | 'fetch', value: unknown) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
  })
}

function restoreGlobal(name: keyof typeof originals) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: originals[name],
  })
}

function createBrowserEnv(pathname = '/login') {
  const documentListeners = new Map<string, Listener[]>()
  const windowListeners = new Map<string, Listener[]>()
  const fetchMock = vi.fn().mockResolvedValue(undefined)
  const location = {
    origin: 'http://localhost:5173',
    href: `http://localhost:5173${pathname}`,
    pathname,
  }
  const setPath = (url?: string | URL | null) => {
    if (!url) return
    const next = new URL(String(url), location.origin)
    location.pathname = next.pathname
    location.href = next.href
  }
  const history = {
    pushState(_state: unknown, _unused: string, url?: string | URL | null) {
      setPath(url)
    },
    replaceState(_state: unknown, _unused: string, url?: string | URL | null) {
      setPath(url)
    },
  }
  const document = {
    addEventListener(type: string, listener: Listener) {
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener])
    },
    removeEventListener(type: string, listener: Listener) {
      documentListeners.set(type, (documentListeners.get(type) ?? []).filter((item) => item !== listener))
    },
  }
  const window = {
    document,
    history,
    addEventListener(type: string, listener: Listener) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener])
    },
    removeEventListener(type: string, listener: Listener) {
      windowListeners.set(type, (windowListeners.get(type) ?? []).filter((item) => item !== listener))
    },
  }

  setGlobal('window', window)
  setGlobal('document', document)
  setGlobal('location', location)
  setGlobal('history', history)
  setGlobal('fetch', fetchMock)

  return {
    documentListeners,
    fetchMock,
    history,
    target(attrs: Record<string, string | null>) {
      return {
        tagName: attrs.tagName,
        textContent: attrs.textContent,
        id: attrs.id ?? '',
        className: attrs.className ?? '',
        getAttribute(name: string) {
          return attrs[name] ?? null
        },
      } as unknown as EventTarget
    },
  }
}

function fetchBody(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  return JSON.parse(fetchMock.mock.calls[index]?.[1]?.body as string)
}

afterEach(() => {
  restoreGlobal('window')
  restoreGlobal('document')
  restoreGlobal('location')
  restoreGlobal('history')
  restoreGlobal('fetch')
})

describe('recordInteraction', () => {
  it('posts a redacted interaction batch and returns the entry', () => {
    const env = createBrowserEnv('/login')
    const target = env.target({ tagName: 'input', name: 'password', type: 'password' })

    const entry = recordInteraction('input', target)

    expect(entry).toMatchObject({
      kind: 'input',
      page_path: '/login',
      target: 'input[name=password][type=password]',
      value: '<redacted>',
    })
    expect(env.fetchMock).toHaveBeenCalledWith('/dev/log', expect.objectContaining({ method: 'POST' }))
    expect(fetchBody(env.fetchMock)).toEqual({ kind: 'interaction_batch', entries: [entry] })
  })
})

describe('installAgentInteractionTracer', () => {
  it('captures click events and route changes, then uninstalls cleanly', () => {
    const env = createBrowserEnv('/login')
    const uninstall = installAgentInteractionTracer()
    const button = env.target({ tagName: 'button', textContent: '保存', 'data-testid': 'save' })

    env.documentListeners.get('click')?.forEach((listener) => listener({ target: button }))
    env.history.pushState({}, '', '/dashboard')

    expect(fetchBody(env.fetchMock, 0).entries[0]).toMatchObject({
      kind: 'click',
      page_path: '/login',
      target: 'button[data-testid=save] "保存"',
    })
    expect(fetchBody(env.fetchMock, 1).entries[0]).toMatchObject({
      kind: 'route',
      from: '/login',
      to: '/dashboard',
    })

    uninstall()
    env.documentListeners.get('click')?.forEach((listener) => listener({ target: button }))

    expect(env.fetchMock).toHaveBeenCalledTimes(2)
  })
})
