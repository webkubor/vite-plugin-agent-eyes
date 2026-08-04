/**
 * agentProjectGuide —— Vite 前端项目结构体检（§agentProjectGuide）
 * 路由：无
 * API：无；dev 启动时扫描项目类型、层级目录、路由/API/配置与 @ alias，输出建议报告。
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const CONFIG_FILES = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']
const TS_CONFIG_FILES = ['tsconfig.json', 'jsconfig.json']
const SOURCE_DIRS = ['src', 'app']
const API_DIRS = ['api', 'apis', 'services', 'service', 'request', 'requests', 'http']
const BUSINESS_DIRS = ['features', 'modules', 'domain', 'domains', 'biz', 'business', 'stores', 'store']
const ROUTE_DIRS = ['router', 'routers', 'routes', 'pages', 'views']
const CONFIG_DIRS = ['config', 'configs', 'constants', 'env']

/** agentProjectGuide 配置。 */
export interface AgentProjectGuideOptions {
  /** 是否启用，默认 true。 */
  enabled?: boolean
  /** 日志目录，默认 `log`。 */
  logDir?: string
  /** 推荐检查的源码目录，默认自动识别 `src` / `app`。 */
  sourceDir?: string
  /** 推荐的路径 alias，默认 `@`。 */
  alias?: string
  /** 是否在控制台输出建议摘要，默认 true。 */
  warn?: boolean
}

/** 项目结构体检报告。 */
export interface AgentProjectGuideReport {
  projectType: string
  sourceDir: string | null
  detected: {
    frameworks: string[]
    packageManager: string | null
    viteConfig: string | null
    tsConfig: string | null
    alias: boolean
    apiLayer: string[]
    businessLayer: string[]
    routeLayer: string[]
    configLayer: string[]
  }
  suggestions: string[]
}

function exists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel))
}

function firstExisting(root: string, names: string[]): string | null {
  return names.find((name) => exists(root, name)) ?? null
}

function readJsonFile(root: string, rel: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** tsconfig 属 JSONC（允许注释/尾逗号），严格 JSON.parse 会整文件判空 —— 剥掉再解析。 */
function readJsoncFile(root: string, rel: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(path.join(root, rel), 'utf8')
    const noComments = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1')
    const noTrailingCommas = noComments.replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(noTrailingCommas) as Record<string, unknown>
  } catch {
    return null
  }
}

function packageManager(root: string): string | null {
  if (exists(root, 'pnpm-lock.yaml')) return 'pnpm'
  if (exists(root, 'package-lock.json')) return 'npm'
  if (exists(root, 'yarn.lock')) return 'yarn'
  if (exists(root, 'bun.lockb') || exists(root, 'bun.lock')) return 'bun'
  return null
}

function dependencies(pkg: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ['dependencies', 'devDependencies']) {
    const value = pkg?.[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(out, value)
  }
  return out
}

function frameworksFromDeps(deps: Record<string, string>): string[] {
  const pairs: Array<[string, string[]]> = [
    ['React', ['react', '@vitejs/plugin-react']],
    ['Vue', ['vue', '@vitejs/plugin-vue']],
    ['Svelte', ['svelte', '@sveltejs/vite-plugin-svelte']],
    ['Solid', ['solid-js', 'vite-plugin-solid']],
    ['Astro', ['astro']],
  ]
  return pairs.filter(([, keys]) => keys.some((key) => deps[key])).map(([name]) => name)
}

function findLayerDirs(root: string, sourceDir: string, names: string[]): string[] {
  return names
    .map((name) => path.posix.join(sourceDir, name))
    .filter((rel) => exists(root, rel))
}

/**
 * tsconfig 里找 alias paths。工程常见形态是根 tsconfig 只做 project references
 * （`files: []` + `references: [...]`，paths 藏在 tsconfig.app.json）——必须跟着
 * references / extends 链查下去，只读根文件会稳定误报「未配 alias」。
 */
function hasAliasInTsConfig(root: string, configFile: string | null, alias: string, visited = new Set<string>()): boolean {
  if (!configFile) return false
  const normalized = path.normalize(configFile)
  if (visited.has(normalized) || visited.size > 20) return false
  visited.add(normalized)
  const config = readJsoncFile(root, normalized)
  if (!config) return false
  const compilerOptions = config.compilerOptions
  if (compilerOptions && typeof compilerOptions === 'object') {
    const paths = (compilerOptions as { paths?: unknown }).paths
    if (paths && typeof paths === 'object' && Object.keys(paths).some((key) => key.startsWith(`${alias}/`))) return true
  }
  const followups: string[] = []
  const references = config.references
  if (Array.isArray(references)) {
    for (const ref of references) {
      const refPath = (ref as { path?: unknown })?.path
      if (typeof refPath === 'string') followups.push(refPath)
    }
  }
  // extends 只跟相对路径（包名形式的共享配置不在项目内，读不到也没必要）
  if (typeof config.extends === 'string' && config.extends.startsWith('.')) followups.push(config.extends)
  const baseDir = path.dirname(normalized)
  return followups.some((rel) => {
    let target = path.normalize(path.join(baseDir, rel))
    const abs = path.join(root, target)
    // references.path / extends 允许指向目录（隐含其下 tsconfig.json）或省略 .json 后缀
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) target = path.join(target, 'tsconfig.json')
    else if (!target.endsWith('.json')) target = `${target}.json`
    return hasAliasInTsConfig(root, target, alias, visited)
  })
}

/**
 * vite 配置文本兜底扫描（inspectProject 脱离 vite 单独调用时用）。
 * alias 多行对象写法（`alias: {\n  '@': ... }`）是主流，匹配必须跨行。
 */
function hasAliasInViteConfig(root: string, configFile: string | null, alias: string): boolean {
  if (!configFile) return false
  try {
    const text = fs.readFileSync(path.join(root, configFile), 'utf8')
    return (
      new RegExp(`alias\\s*:\\s*\\{[\\s\\S]{0,400}?['"\`]${alias}['"\`]\\s*:`).test(text) ||
      new RegExp(`alias\\s*:\\s*[^\\n]+['"\`]${alias}['"\`]`).test(text) ||
      text.includes(`find: '${alias}'`) ||
      text.includes(`find: "${alias}"`)
    )
  } catch {
    return false
  }
}

function suggestionList(report: Omit<AgentProjectGuideReport, 'suggestions'>, alias: string): string[] {
  const suggestions: string[] = []
  if (!report.sourceDir) suggestions.push('未检测到 src/ 或 app/ 源码目录；建议明确前端源码根目录。')
  if (!report.detected.alias) suggestions.push(`未检测到 ${alias} 路径 alias；建议在 Vite resolve.alias 与 tsconfig/jsconfig paths 中配置 ${alias}/*。`)
  if (report.detected.apiLayer.length === 0) suggestions.push('未检测到 API/request/service 层；建议集中放置接口调用，避免业务组件里散写 fetch。')
  if (report.detected.businessLayer.length === 0) suggestions.push('未检测到 features/modules/domain/stores 等业务层；建议按业务域组织复杂状态和用例。')
  if (report.detected.routeLayer.length === 0) suggestions.push('未检测到 router/routes/pages/views 层；建议明确路由入口，方便 agent 复现页面路径。')
  if (report.detected.configLayer.length === 0) suggestions.push('未检测到 config/constants/env 层；建议集中管理环境变量、常量和开关。')
  return suggestions
}

/** inspectProject 的内部扩展入参：插件运行时可注入 vite 已解析的 alias 结果。 */
export interface InspectProjectInternalOptions extends AgentProjectGuideOptions {
  /**
   * vite config 解析后的运行时判定（config.resolve.alias 已规范化）。
   * 传了就以它为准（true/false 都采信），不再做文本/tsconfig 推断 —— runtime-truth。
   */
  resolvedAlias?: boolean
}

/**
 * 按 vite `matches(pattern, importee)` 语义判定 resolved alias 是否命中 alias 前缀。
 * vite 的 normalizeSingleAlias 已把 `'@/': '/src/'` 剥尾斜杠成 `find: '@'`，故 string find 只有前缀形式。
 */
export function aliasMatchesResolved(resolved: unknown, alias: string): boolean {
  if (!Array.isArray(resolved)) return false
  const probes = [alias, `${alias}/__agent_eyes_probe__`]
  return resolved.some((entry) => {
    const find = (entry as { find?: unknown })?.find
    if (find instanceof RegExp) return probes.some((p) => find.test(p))
    if (typeof find !== 'string') return false
    return probes.some((importee) => {
      if (importee.length < find.length) return false
      if (importee === find) return true
      return importee.startsWith(`${find}/`)
    })
  })
}

/** 生成项目结构体检报告。 */
export function inspectProject(root: string, options: InspectProjectInternalOptions = {}): AgentProjectGuideReport {
  const alias = options.alias ?? '@'
  const pkg = readJsonFile(root, 'package.json')
  const deps = dependencies(pkg)
  const sourceDir = options.sourceDir ?? SOURCE_DIRS.find((dir) => exists(root, dir)) ?? null
  const viteConfig = firstExisting(root, CONFIG_FILES)
  const tsConfig = firstExisting(root, TS_CONFIG_FILES)
  const detected = {
    frameworks: frameworksFromDeps(deps),
    packageManager: packageManager(root),
    viteConfig,
    tsConfig,
    alias:
      options.resolvedAlias ??
      (hasAliasInTsConfig(root, tsConfig, alias) || hasAliasInViteConfig(root, viteConfig, alias)),
    apiLayer: sourceDir ? findLayerDirs(root, sourceDir, API_DIRS) : [],
    businessLayer: sourceDir ? findLayerDirs(root, sourceDir, BUSINESS_DIRS) : [],
    routeLayer: sourceDir ? findLayerDirs(root, sourceDir, ROUTE_DIRS) : [],
    configLayer: sourceDir ? findLayerDirs(root, sourceDir, CONFIG_DIRS) : [],
  }
  const base = { projectType: detected.frameworks[0] ?? 'Vite', sourceDir, detected }
  return { ...base, suggestions: suggestionList(base, alias) }
}

function loggerPrefix(): string {
  return '\x1b[33m[agent-eyes:guide]\x1b[0m'
}

/** dev 启动时输出项目结构体检报告和建议。 */
export function agentProjectGuide(options: AgentProjectGuideOptions = {}): Plugin {
  return {
    name: 'vite-plugin-agent-eyes-project-guide',
    apply: 'serve',
    configureServer(server) {
      if (options.enabled === false) return
      const root = server.config.root || process.cwd()
      // runtime-truth：configureServer 时 config 已 resolve，config.resolve.alias 是 vite 规范化后的
      // 真实 alias —— 优先采信，而不是靠 tsconfig/vite 配置文本推断。
      const resolvedAlias = aliasMatchesResolved(server.config.resolve?.alias, options.alias ?? '@')
      const report = inspectProject(root, { ...options, resolvedAlias })
      const logDir = path.resolve(root, options.logDir ?? 'log')
      fs.mkdirSync(logDir, { recursive: true })
      fs.writeFileSync(path.join(logDir, 'project-guide.json'), JSON.stringify(report, null, 2))
      if ((options.warn ?? true) && report.suggestions.length) {
        server.config.logger.warn(`${loggerPrefix()} 项目结构建议 ${report.suggestions.length} 条，详见 ${path.relative(root, path.join(logDir, 'project-guide.json'))}`)
        report.suggestions.slice(0, 5).forEach((item) => server.config.logger.warn(`${loggerPrefix()} ${item}`))
      }
    },
  }
}
