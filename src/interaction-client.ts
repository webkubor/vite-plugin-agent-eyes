/**
 * 客户端交互轨迹采集（§interaction trace）
 * 路由：无
 * API：记录 click/input/change/submit/route，表单值只写 <redacted>。
 */

import {
  createInteractionEntry,
  type InteractionEntry,
  type InteractionEntryOptions,
  type InteractionKind,
  type InteractionTargetLike,
} from './interaction'

const DEFAULT_ENDPOINT = '/dev/log'

function isDev() {
  return typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
}

function post(endpoint: string, payload: unknown) {
  if (typeof fetch === 'undefined') return
  try {
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* 上报失败绝不影响业务 */
  }
}

function currentPagePath(): string | undefined {
  if (typeof location === 'undefined') return undefined
  return location.pathname || undefined
}

function targetLike(target: unknown): InteractionTargetLike | undefined {
  if (!target || typeof target !== 'object') return undefined
  if (typeof (target as { tagName?: unknown }).tagName !== 'string') return undefined
  return target as InteractionTargetLike
}

export interface AgentInteractionOptions extends InteractionEntryOptions {
  endpoint?: string
}

/** 记录一次用户交互轨迹。输入内容只写 `<redacted>`，不保存真实表单值。 */
export function recordInteraction(
  kind: InteractionKind,
  target?: EventTarget | InteractionTargetLike | null,
  options: AgentInteractionOptions = {},
): InteractionEntry {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const entry = createInteractionEntry(kind, targetLike(target), {
    pagePath: options.pagePath ?? currentPagePath(),
    from: options.from,
    to: options.to,
    now: options.now,
  })
  if (isDev()) post(endpoint, { kind: 'interaction_batch', entries: [entry] })
  return entry
}

/** 安装自动交互轨迹采集：click/input/change/submit + history/popstate。 */
let interactionTracerUndo: (() => void) | null = null
export function installAgentInteractionTracer(options: { endpoint?: string } = {}): () => void {
  if (!isDev() || typeof window === 'undefined' || typeof document === 'undefined' || !window.history) return () => {}
  if (interactionTracerUndo) return interactionTracerUndo

  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const onClick = (event: Event) => recordInteraction('click', event.target, { endpoint })
  const onInput = (event: Event) => recordInteraction('input', event.target, { endpoint })
  const onChange = (event: Event) => recordInteraction('change', event.target, { endpoint })
  const onSubmit = (event: Event) => recordInteraction('submit', event.target, { endpoint })

  document.addEventListener('click', onClick, true)
  document.addEventListener('input', onInput, true)
  document.addEventListener('change', onChange, true)
  document.addEventListener('submit', onSubmit, true)

  let from = currentPagePath()
  const reportRoute = () => {
    const to = currentPagePath()
    if (!to || !from || to === from) return
    recordInteraction('route', undefined, { endpoint, from, to, pagePath: to })
    from = to
  }
  const origPush = history.pushState
  const origReplace = history.replaceState
  history.pushState = function (...args: Parameters<History['pushState']>) {
    const result = origPush.apply(this, args)
    reportRoute()
    return result
  }
  history.replaceState = function (...args: Parameters<History['replaceState']>) {
    const result = origReplace.apply(this, args)
    reportRoute()
    return result
  }
  const onPop = () => reportRoute()
  window.addEventListener('popstate', onPop)

  const undo = () => {
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('input', onInput, true)
    document.removeEventListener('change', onChange, true)
    document.removeEventListener('submit', onSubmit, true)
    history.pushState = origPush
    history.replaceState = origReplace
    window.removeEventListener('popstate', onPop)
    interactionTracerUndo = null
  }
  interactionTracerUndo = undo
  return undo
}

export type { InteractionEntry, InteractionKind, InteractionTargetLike }
