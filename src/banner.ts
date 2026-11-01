/**
 * agentBanner —— dev 启动时在控制台打印「插件已启用」摘要（§agentBanner）
 * 路由：无
 * API：无；展示环境、上报端点、代理清单、版本戳记、技术栈和包管理器。
 *
 * 目标：打开控制台就能确认插件生效，不用翻配置文件。只读展示，不改任何项目状态。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { inspectEngineering, type EngineeringInspection } from './engineering'

/** 启动横幅配置。 */
export interface AgentBannerOptions {
  /** 是否打印，默认 true；传 false 关闭。 */
  enabled?: boolean
  /** 前端上报端点，用于展示，默认 `/dev/log`。 */
  endpoint?: string
  /** 日志目录，用于展示，默认 `log`。 */
  logDir?: string
  /** 技术栈最多展示几项，默认 6。 */
  maxStack?: number
  /** 源码目录，用于工程体检，默认自动识别 `src` / `app`。 */
  sourceDir?: string
}

/** 横幅展示所需的运行时事实。 */
export interface BannerInfo {
  pluginVersion: string
  mode: string
  port: number | string | null
  endpoint: string
  logDir: string
  proxies: Array<{ path: string; target: string }>
  envFile: string | null
  packageVersion: string | null
  versionInjected: boolean
  stack: string[]
  packageManager: string | null
  node: string
  /** 已解析的路径别名（find → replacement，replacement 已转成相对项目根）。 */
  aliases: Array<{ find: string; replacement: string }>
  /** tsconfig/jsconfig 是否配置了 compilerOptions.paths。 */
  tsPaths: boolean
  /** 工程完备度：环境文件、状态管理、统一请求层。 */
  engineering: EngineeringInspection
}

const LOCKFILES: Array<[string, string]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
]

/** 依赖名 → 技术栈标签；顺序即展示优先级。 */
const STACK_RULES: Array<[string, string]> = [
  ['react-dom', 'React'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['solid-js', 'Solid'],
  ['astro', 'Astro'],
  ['nuxt', 'Nuxt'],
  ['next', 'Next.js'],
  ['typescript', 'TypeScript'],
  ['tailwindcss', 'Tailwind CSS'],
  ['pinia', 'Pinia'],
  ['zustand', 'Zustand'],
  ['@reduxjs/toolkit', 'Redux'],
  ['redux', 'Redux'],
  ['antd', 'Ant Design'],
  ['element-plus', 'Element Plus'],
  ['@mui/material', 'MUI'],
  ['vitest', 'Vitest'],
  ['playwright', 'Playwright'],
]

const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]|[\u{1f300}-\u{1faff}]|[\u{20000}-\u{3fffd}]/u

/** 终端显示宽度：CJK 与 emoji 占两格。 */
export function textWidth(text: string): number {
  let width = 0
  for (const char of text) width += WIDE_CHAR.test(char) ? 2 : 1
  return width
}

function padEndWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - textWidth(text)))
}

/** 按终端显示宽度截断，避免一行把横幅撑得过宽。 */
function truncateWidth(text: string, max: number): string {
  if (textWidth(text) <= max) return text
  let result = ''
  for (const char of text) {
    if (textWidth(result + char) > max - 1) break
    result += char
  }
  return `${result}…`
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 插件自身版本：dev 下读 src/../package.json，构建后读 dist/../package.json。 */
function pluginVersion(): string {
  try {
    const file = fileURLToPath(new URL('../package.json', import.meta.url))
    return String(readJson(file)?.version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
}

/** 脱敏代理 target：去掉 URL 里的账号密码，保留主机路径。 */
function maskTarget(target: string): string {
  try {
    const url = new URL(target)
    if (url.username || url.password) {
      url.username = '***'
      url.password = ''
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return target
  }
}

function declaredVersion(root: string, name: string): string | null {
  try {
    const require = createRequire(path.join(root, 'package.json'))
    const pkgFile = require.resolve(`${name}/package.json`)
    return String((readJson(pkgFile)?.version as string | undefined) ?? '') || null
  } catch {
    return null
  }
}

function detectStack(root: string, pkg: Record<string, unknown> | null, maxStack: number): string[] {
  if (!pkg) return []
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  }
  const seen = new Set<string>()
  const stack: string[] = []
  for (const [name, label] of STACK_RULES) {
    if (!(name in deps) || seen.has(label)) continue
    seen.add(label)
    const version = declaredVersion(root, name) ?? String(deps[name]).replace(/^[~^]/, '')
    stack.push(version ? `${label} ${version}` : label)
    if (stack.length >= maxStack) break
  }
  return stack
}

function detectPackageManager(root: string): string | null {
  return LOCKFILES.find(([file]) => fs.existsSync(path.join(root, file)))?.[1] ?? null
}

/** 横幅只读的配置子集；proxy 从 `server.proxy` 或顶层传入都接受。 */
export interface BannerConfig {
  mode?: string
  define?: Record<string, unknown>
  envDir?: string | false
  logLevel?: string
  server?: { port?: number; proxy?: Record<string, unknown> }
  resolve?: { alias?: Array<{ find: string | RegExp; replacement: string }> }
  /** 兼容直接传入代理表（测试 / 独立调用）。 */
  proxy?: Record<string, unknown>
}

/** 把绝对 replacement 转成相对项目根的短路径；跨 realpath（macOS /var）时也能对齐。 */
function displayReplacement(root: string, replacement: string): string {
  const bases = [root]
  try {
    bases.push(fs.realpathSync(root))
  } catch {
    /* 目录不存在时只用 root */
  }
  const targets = [replacement]
  try {
    targets.push(fs.realpathSync(replacement))
  } catch {
    /* replacement 可能尚未创建 */
  }
  for (const base of bases) {
    for (const target of targets) {
      const rel = path.relative(base, target)
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel
    }
  }
  return replacement
}

/** 读取 tsconfig/jsconfig 是否声明了 paths 映射。 */
function hasTsPaths(root: string): boolean {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const raw = readJson(path.join(root, name))
    const compilerOptions = raw?.compilerOptions as { paths?: Record<string, unknown> } | undefined
    if (compilerOptions?.paths && Object.keys(compilerOptions.paths).length) return true
  }
  return false
}

/** 收集横幅信息；纯读取，不修改项目。 */
export function collectBannerInfo(
  root: string,
  config: BannerConfig,
  options: AgentBannerOptions & { port?: number | string | null } = {},
): BannerInfo {
  const pkg = readJson(path.join(root, 'package.json'))
  const mode = config.mode ?? 'development'
  const logDir = options.logDir ?? 'log'
  const proxyEntries = Object.entries(config.server?.proxy ?? config.proxy ?? {})
    .map(([route, value]) => {
      const target = typeof value === 'string' ? value : (value as { target?: string } | undefined)?.target
      return target ? { path: route, target: maskTarget(String(target)) } : null
    })
    .filter((item): item is { path: string; target: string } => item !== null)
  const envDir = typeof config.envDir === 'string' ? path.resolve(root, config.envDir) : root
  const envFile = `.env.${mode}`
  return {
    pluginVersion: pluginVersion(),
    mode,
    port: options.port ?? config.server?.port ?? null,
    endpoint: options.endpoint ?? '/dev/log',
    logDir,
    proxies: proxyEntries,
    envFile: fs.existsSync(path.join(envDir, envFile)) ? envFile : null,
    packageVersion: typeof pkg?.version === 'string' ? pkg.version : null,
    versionInjected: Boolean(config.define && '__APP_VERSION__' in config.define),
    stack: detectStack(root, pkg, options.maxStack ?? 6),
    packageManager: detectPackageManager(root),
    node: process.version,
    aliases: (config.resolve?.alias ?? [])
      .filter(({ find }) => {
        if (find instanceof RegExp) return !/@vite/.test(find.source)
        const value = String(find)
        return !value.startsWith('\0') && !value.startsWith('virtual:')
      })
      .map(({ find, replacement }) => ({
        find: String(find),
        replacement: displayReplacement(root, String(replacement)),
      }))
      .slice(0, 3),
    tsPaths: hasTsPaths(root),
    engineering: inspectEngineering(root, {
      mode,
      sourceDir: options.sourceDir,
      envDir: typeof config.envDir === 'string' ? config.envDir : undefined,
    }),
  }
}

type Row = { label: string; value: string }

function buildRows(info: BannerInfo): Row[] {
  const logTarget = info.port === null ? `${info.logDir}/` : `${info.logDir}/${info.port}/`
  const envModes = info.engineering.environments.modes
  const envConfigured = envModes.filter((item) => item.configured).length
  const envMissing = info.engineering.environments.missing
  const envText = info.engineering.environments.files.length
    ? `${envConfigured}/${envModes.length} 标准环境${envMissing.length ? ` · 缺 ${envMissing.join(' / ')}` : ' · 已齐全'}`
    : '未发现 .env 文件'
  const state = info.engineering.state
  const request = info.engineering.request
  const stateLabels = { pinia: 'Pinia', vuex: 'Vuex', zustand: 'Zustand', redux: 'Redux' } as const
  const stateText = state.package
    ? `${stateLabels[state.package]} ${state.configured ? '已配置' : '未初始化'}`
    : '未使用状态库'
  const requestText = request.package
    ? `${request.package} ${request.unifiedFile ? `统一封装 ${request.unifiedFile}` : '未统一封装'}${request.unifiedFile && !request.envBase ? ' · baseURL 未读环境变量' : ''}`
    : '未使用 axios / ky'
  const rows: Row[] = [
    { label: '环境', value: `${info.mode}${info.envFile ? ` · ${info.envFile}` : ''}` },
    { label: '环境文件', value: truncateWidth(envText, 72) },
    { label: '端口', value: info.port === null ? 'middleware' : String(info.port) },
    { label: '上报', value: `${info.endpoint} → ${logTarget}` },
  ]
  if (info.proxies.length) {
    rows.push({ label: 'API', value: `${info.proxies[0].path} → ${info.proxies[0].target}` })
    for (const proxy of info.proxies.slice(1, 4)) rows.push({ label: '', value: `${proxy.path} → ${proxy.target}` })
    if (info.proxies.length > 4) rows.push({ label: '', value: `… 另有 ${info.proxies.length - 4} 条代理` })
  } else {
    rows.push({ label: 'API', value: '未配置代理（直连后端时无需）' })
  }
  const aliasText = info.aliases.length
    ? info.aliases.map(({ find, replacement }) => `${find} → ${replacement}`).join(' · ')
    : info.tsPaths
      ? 'tsconfig paths 已配置'
      : '未配置 · 建议 resolve.alias: { "@": "/src" }'
  rows.push({ label: '别名', value: truncateWidth(aliasText, 72) })
  rows.push({
    label: '版本',
    value: `${info.packageVersion ?? '未知'} · ${info.versionInjected ? '__APP_VERSION__ 已注入' : '未注入版本戳记'}`,
  })
  rows.push({ label: '技术栈', value: info.stack.length ? info.stack.join(' · ') : '未识别' })
  rows.push({ label: '工程', value: truncateWidth(`${stateText} · ${requestText}`, 72) })
  return rows
}

/**
 * 渲染横幅为等宽文本行；`color: false` 时输出纯文本（便于测试与重定向）。
 * 边框按终端显示宽度对齐，中文不会把右边框挤歪。
 */
export function renderBanner(info: BannerInfo, options: { color?: boolean } = {}): string[] {
  const color = options.color ?? false
  const paint = (code: string, text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
  const rows = buildRows(info)
  const title = `✔ vite-plugin-agent-eyes 已启用 · v${info.pluginVersion}`
  const labelWidth = rows.reduce((max, row) => Math.max(max, textWidth(row.label)), 0)
  const contentWidth = rows.reduce((max, row) => {
    const plain = row.label ? `${padEndWidth(row.label, labelWidth)} ${row.value}` : padEndWidth(row.value, labelWidth)
    return Math.max(max, textWidth(plain))
  }, textWidth(title))
  const border = '─'.repeat(contentWidth + 2)
  const lines: string[] = [
    paint('36', `╭${border}╮`),
    `│ ${paint('32', '✔')} ${paint('1;36', title.slice(2))}${' '.repeat(contentWidth - textWidth(title))} │`,
  ]
  for (const row of rows) {
    const label = padEndWidth(row.label, labelWidth)
    const plain = `${label} ${row.value}`
    const padding = ' '.repeat(Math.max(0, contentWidth - textWidth(plain)))
    lines.push(`│ ${paint('2', label)} ${row.value}${padding} │`)
  }
  lines.push(paint('36', `╰${border}╯`))
  return lines
}

function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true
  return Boolean(process.stdout.isTTY)
}

/** dev 启动横幅：控制台一眼确认插件已启用、环境、API、版本和技术栈。 */
export function agentBanner(options: AgentBannerOptions = {}): Plugin {
  let printed = false
  return {
    name: 'vite-plugin-agent-eyes-banner',
    apply: 'serve',
    configureServer(server) {
      if (options.enabled === false) return
      const print = (port: number | string | null) => {
        if (printed || server.config.logLevel === 'silent') return
        printed = true
        const info = collectBannerInfo(server.config.root, {
          mode: server.config.mode,
          define: server.config.define as Record<string, unknown>,
          envDir: server.config.envDir,
          resolve: server.config.resolve,
          server: { port: server.config.server.port, proxy: server.config.server.proxy as Record<string, unknown> },
        }, { ...options, port })
        server.config.logger.info(renderBanner(info, { color: colorEnabled() }).join('\n'))
      }
      const httpServer = server.httpServer
      if (httpServer) {
        httpServer.once('listening', () => {
          const address = httpServer.address()
          const port = address && typeof address === 'object' ? address.port : server.config.server.port ?? null
          print(port)
        })
      } else {
        print(null)
      }
    },
  }
}
