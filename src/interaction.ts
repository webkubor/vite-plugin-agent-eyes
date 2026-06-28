/**
 * 用户交互轨迹脱敏工具（§interaction trace）
 * 路由：无
 * API：为客户端事件监听和 dev middleware 提供共享格式。
 */

/** 可记录的交互类型。 */
export type InteractionKind = 'route' | 'click' | 'input' | 'change' | 'submit'

/** agent 可读的单条交互轨迹。 */
export interface InteractionEntry {
  kind: InteractionKind
  at: string
  page_path?: string
  target?: string
  value?: '<redacted>'
  from?: string
  to?: string
}

/** DOM 元素摘要所需的最小接口，便于测试和跨环境使用。 */
export interface InteractionTargetLike {
  tagName?: string
  id?: string
  className?: unknown
  textContent?: string | null
  getAttribute?: (name: string) => string | null
}

/** 创建交互条目的上下文。 */
export interface InteractionEntryOptions {
  pagePath?: string
  from?: string
  to?: string
  now?: Date
}

const TEXT_LIMIT = 80
const ATTR_LIMIT = 80

function cleanText(value: unknown, max = ATTR_LIMIT): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

function attr(target: InteractionTargetLike, name: string): string | undefined {
  try {
    return cleanText(target.getAttribute?.(name))
  } catch {
    return undefined
  }
}

function classTokens(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)
}

function bracket(name: string, value: string | undefined): string {
  return value ? `[${name}=${value}]` : ''
}

/** 生成元素摘要，不包含 input 值。 */
export function summarizeInteractionTarget(target: InteractionTargetLike | null | undefined): string | undefined {
  if (!target) return undefined
  const tag = cleanText(target.tagName, 20)?.toLowerCase() || 'element'
  const testId = attr(target, 'data-testid')
  const aria = attr(target, 'aria-label')
  const name = attr(target, 'name')
  const type = attr(target, 'type')
  const id = cleanText(target.id, ATTR_LIMIT)
  const text = cleanText(target.textContent, TEXT_LIMIT)

  let summary = tag
  if (testId) summary += bracket('data-testid', testId)
  else if (aria) summary += bracket('aria-label', aria)
  else if (name) summary += bracket('name', name)
  else if (id) summary += `#${id}`
  else {
    const classes = classTokens(target.className)
    if (classes.length > 0) summary += `.${classes.join('.')}`
  }

  if (type && (tag === 'input' || tag === 'button')) summary += bracket('type', type)
  if (text && tag !== 'input' && tag !== 'textarea' && tag !== 'select') summary += ` "${text}"`
  return summary
}

/** 创建脱敏交互条目。 */
export function createInteractionEntry(
  kind: InteractionKind,
  target?: InteractionTargetLike,
  options: InteractionEntryOptions = {},
): InteractionEntry {
  const entry: InteractionEntry = {
    kind,
    at: (options.now ?? new Date()).toISOString(),
  }
  if (options.pagePath) entry.page_path = options.pagePath
  const summary = summarizeInteractionTarget(target)
  if (summary) entry.target = summary
  if (kind === 'input' || kind === 'change') entry.value = '<redacted>'
  if (options.from) entry.from = options.from
  if (options.to) entry.to = options.to
  return entry
}

/** 将交互条目格式化成 interaction.log 的单行文本。 */
export function formatInteractionLine(entry: InteractionEntry): string {
  const route = entry.kind === 'route' && entry.from && entry.to ? `${entry.from} -> ${entry.to}` : ''
  const page = entry.page_path ? `${entry.page_path} ` : ''
  const target = entry.target ? `${entry.target}` : ''
  const value = entry.value ? ` ${entry.value}` : ''
  const detail = route || `${page}${target}${value}`.trim()
  return `[${entry.at}] [${entry.kind}]${detail ? ` ${detail}` : ''}`
}
