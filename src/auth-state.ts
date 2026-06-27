/**
 * 本地登录态画像清洗（§agent auth）
 * 路由：无
 * API：为客户端记录和 dev middleware 写入提供共享脱敏逻辑。
 */

/** 登录画像允许的基础值。 */
export type AgentAuthPrimitive = string | number | boolean | null

/** 应用传入的登录画像，真实凭证字段会被丢弃。 */
export interface AgentAuthProfileInput {
  userId?: unknown
  accountId?: unknown
  email?: unknown
  name?: unknown
  username?: unknown
  roles?: unknown
  tenantId?: unknown
  projectId?: unknown
  workspaceId?: unknown
  extra?: unknown
  [key: string]: unknown
}

/** 脱敏后可写入本地日志的登录画像。 */
export interface AgentAuthProfile {
  userId?: string
  accountId?: string
  email?: string
  name?: string
  username?: string
  roles?: string[]
  tenantId?: string
  projectId?: string
  workspaceId?: string
  extra?: Record<string, AgentAuthPrimitive>
}

/** agent 可读的最近一次登录状态。 */
export interface AgentAuthState {
  loggedIn: true
  updatedAt: string
  page_path?: string
  profile: AgentAuthProfile
}

/** 创建登录状态时的上下文。 */
export interface AgentAuthStateOptions {
  pagePath?: string
  now?: Date
}

const SENSITIVE_KEY =
  /(?:token|secret|password|passwd|pwd|authorization|cookie|session|refresh|credential|jwt|bearer)/i

function safeString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, 200) : undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function maskEmail(value: unknown): string | undefined {
  const raw = safeString(value)
  if (!raw) return undefined
  const at = raw.indexOf('@')
  if (at <= 0 || at === raw.length - 1) return raw.slice(0, 80)
  const local = raw.slice(0, at)
  const domain = raw.slice(at + 1)
  return `${local.slice(0, 1)}***@${domain.slice(0, 120)}`
}

function safeRoles(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const roles = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 20)
  return roles.length > 0 ? roles : undefined
}

function safeExtra(value: unknown): Record<string, AgentAuthPrimitive> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .flatMap(([key, item]): Array<[string, AgentAuthPrimitive]> => {
      if (typeof item === 'string') return [[key, item.slice(0, 200)]]
      if (typeof item === 'number' || typeof item === 'boolean' || item === null) return [[key, item]]
      return []
    })
    .slice(0, 30)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function assignString(target: AgentAuthProfile, key: keyof AgentAuthProfile, value: unknown): void {
  const safe = safeString(value)
  if (safe) {
    ;(target as Record<string, unknown>)[key] = safe
  }
}

/** 清洗登录画像：只保留安全字段，邮箱脱敏，敏感 key 丢弃。 */
export function sanitizeAuthProfile(input: AgentAuthProfileInput): AgentAuthProfile {
  const profile: AgentAuthProfile = {}
  assignString(profile, 'userId', input.userId)
  assignString(profile, 'accountId', input.accountId)
  assignString(profile, 'name', input.name)
  assignString(profile, 'username', input.username)
  assignString(profile, 'tenantId', input.tenantId)
  assignString(profile, 'projectId', input.projectId)
  assignString(profile, 'workspaceId', input.workspaceId)

  const email = maskEmail(input.email)
  if (email) profile.email = email

  const roles = safeRoles(input.roles)
  if (roles) profile.roles = roles

  const extra = safeExtra(input.extra)
  if (extra) profile.extra = extra

  return profile
}

/** 创建本地 agent 登录状态对象。 */
export function createLoginAuthState(input: AgentAuthProfileInput, options: AgentAuthStateOptions = {}): AgentAuthState {
  const state: AgentAuthState = {
    loggedIn: true,
    updatedAt: (options.now ?? new Date()).toISOString(),
    profile: sanitizeAuthProfile(input),
  }
  if (options.pagePath) state.page_path = options.pagePath
  return state
}

/** 将登录状态挂到浏览器 BOM 上，供 agent 控制浏览器时读取。 */
export function installBrowserAuthState(state: AgentAuthState): void {
  if (typeof window === 'undefined') return
  Object.defineProperty(window, '__AGENT_EYES_AUTH__', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: state,
  })
}
