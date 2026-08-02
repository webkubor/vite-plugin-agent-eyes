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

function hasAliasInTsConfig(root: string, configFile: string | null, alias: string): boolean {
  if (!configFile) return false
  const config = readJsonFile(root, configFile)
  const compilerOptions = config?.compilerOptions
  if (!compilerOptions || typeof compilerOptions !== 'object') return false
  const paths = (compilerOptions as { paths?: unknown }).paths
  return Boolean(paths && typeof paths === 'object' && Object.keys(paths).some((key) => key.startsWith(`${alias}/`)))
}

function hasAliasInViteConfig(root: string, configFile: string | null, alias: string): boolean {
  if (!configFile) return false
  try {
    const text = fs.readFileSync(path.join(root, configFile), 'utf8')
    return new RegExp(`alias\\s*:\\s*[^\\n]+['"\`]${alias}['"\`]`).test(text) || text.includes(`find: '${alias}'`) || text.includes(`find: "${alias}"`)
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

/** 生成项目结构体检报告。 */
export function inspectProject(root: string, options: AgentProjectGuideOptions = {}): AgentProjectGuideReport {
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
    alias: hasAliasInTsConfig(root, tsConfig, alias) || hasAliasInViteConfig(root, viteConfig, alias),
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
      const report = inspectProject(root, options)
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
