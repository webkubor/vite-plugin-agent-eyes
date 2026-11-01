/**
 * 工程完备度体检（§engineering）—— 环境文件、状态管理、统一请求层。
 * 路由：无
 * API：只读扫描项目文件与依赖，返回「有没有 / 配没配」，不安装依赖、不改文件。
 *
 * 设计取向：给建议不给改造。缺 .env.test / .env.production 时提醒补齐；
 * Pinia 只在 Vue 项目里提示；请求层只在装了 axios/ky 却散落调用时提示统一封装。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 工程体检选项。 */
export interface EngineeringInspectionOptions {
  /** 源码目录，默认自动识别 `src` / `app`。 */
  sourceDir?: string
  /** 环境文件目录（相对项目根），默认根目录。 */
  envDir?: string
  /** 当前模式，用于标记当前使用的环境文件。 */
  mode?: string
}

/** 环境文件覆盖情况。 */
export interface EnvironmentCoverage {
  /** 已存在的环境文件（相对项目根）。 */
  files: string[]
  /** 标准模式是否各有文件。 */
  modes: Array<{ name: string; file: string; configured: boolean }>
  /** 缺失的标准模式。 */
  missing: string[]
}

/** 状态管理检测结果。 */
export interface StateInspection {
  package: 'pinia' | 'vuex' | 'zustand' | 'redux' | null
  installed: boolean
  configured: boolean
  /** 证据文件（相对项目根），如 `src/main.ts`。 */
  evidence: string | null
}

/** 请求层检测结果。 */
export interface RequestInspection {
  package: 'axios' | 'ky' | null
  installed: boolean
  /** 统一封装文件（相对项目根），没有则为 null。 */
  unifiedFile: string | null
  /** 统一封装里是否从 `import.meta.env` 取 baseURL。 */
  envBase: boolean
}

/** 工程体检结果。 */
export interface EngineeringInspection {
  environments: EnvironmentCoverage
  state: StateInspection
  request: RequestInspection
  /** 面向 agent / 人的改进建议（不阻断）。 */
  suggestions: string[]
}

const STANDARD_MODES = ['development', 'test', 'production']
const ENV_FILE = /^\.env(?:\.(?!example$)[\w-]+)?(?:\.local)?$/
const REQUEST_FILES = [
  'api/request', 'api/http', 'api/client', 'utils/request', 'utils/http',
  'services/request', 'services/http', 'lib/request', 'lib/http', 'request', 'http',
]
const REQUEST_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts']
const SOURCE_DIRS = ['src', 'app']

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function firstExisting(root: string, candidates: string[]): string | null {
  return candidates.find((rel) => fs.existsSync(path.join(root, rel))) ?? null
}

function sourceDirOf(root: string, configured?: string): string | null {
  if (configured) return fs.existsSync(path.join(root, configured)) ? configured : null
  return SOURCE_DIRS.find((dir) => fs.existsSync(path.join(root, dir))) ?? null
}

function inspectEnvironments(root: string, envDir: string, mode: string): EnvironmentCoverage {
  const dir = path.resolve(root, envDir)
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((name) => ENV_FILE.test(name)).sort()
  } catch {
    /* 无目录按空处理 */
  }
  const has = (file: string) => names.includes(file)
  const modes = STANDARD_MODES.map((name) => {
    const file = `.env.${name}`
    return { name, file, configured: has(file) }
  })
  const files = names.map((name) => path.relative(root, path.join(dir, name)))
  const missing = modes.filter((item) => !item.configured).map((item) => item.name)
  // 当前模式有专属文件时，不再把当前模式算作「缺失」。
  const currentFile = `.env.${mode}`
  const missingExcludingCurrent = has(currentFile) ? missing.filter((name) => name !== mode) : missing
  return { files, modes, missing: missingExcludingCurrent }
}

function detectState(root: string, sourceDir: string | null, pkg: Record<string, unknown> | null): StateInspection {
  const deps = {
    ...(pkg?.dependencies as Record<string, string> | undefined),
    ...(pkg?.devDependencies as Record<string, string> | undefined),
  }
  const candidate: Array<['pinia' | 'vuex' | 'zustand' | 'redux', RegExp, string[]]> = [
    ['pinia', /createPinia\s*\(|defineStore\s*\(/, ['stores', 'store']],
    ['vuex', /createStore\s*\(/, ['stores', 'store']],
    ['zustand', /create\s*\(|createStore\s*\(/, ['stores', 'store']],
    ['redux', /configureStore\s*\(|createStore\s*\(/, ['stores', 'store']],
  ]
  for (const [name, pattern, dirs] of candidate) {
    if (!(name in deps)) continue
    const entryFiles = sourceDir
      ? ['main.ts', 'main.tsx', 'main.js', 'main.jsx', 'app.ts', 'app.tsx', 'index.ts', 'index.tsx']
          .map((file) => `${sourceDir}/${file}`)
      : []
    const evidence = entryFiles.find((rel) => pattern.test(readText(path.join(root, rel))))
      ?? (sourceDir ? dirs.map((dir) => `${sourceDir}/${dir}`).find((rel) => fs.existsSync(path.join(root, rel))) ?? null : null)
    return { package: name, installed: true, configured: Boolean(evidence), evidence }
  }
  return { package: null, installed: false, configured: false, evidence: null }
}

function detectRequest(root: string, sourceDir: string | null, pkg: Record<string, unknown> | null): RequestInspection {
  const deps = {
    ...(pkg?.dependencies as Record<string, string> | undefined),
    ...(pkg?.devDependencies as Record<string, string> | undefined),
  }
  const name = 'axios' in deps ? 'axios' : 'ky' in deps ? 'ky' : null
  if (!name || !sourceDir) return { package: name, installed: Boolean(name), unifiedFile: null, envBase: false }
  const candidates = REQUEST_FILES.flatMap((base) => REQUEST_EXT.map((ext) => `${sourceDir}/${base}${ext}`))
  const unifiedFile = firstExisting(root, candidates)
  const envBase = unifiedFile
    ? /import\.meta\.env\.[A-Z_]+|baseURL\s*:\s*import\.meta\.env/.test(readText(path.join(root, unifiedFile)))
    : false
  return { package: name, installed: true, unifiedFile, envBase }
}

/** 只读体检：环境文件、状态管理、统一请求层。 */
export function inspectEngineering(root: string, options: EngineeringInspectionOptions = {}): EngineeringInspection {
  const pkg = readJson(path.join(root, 'package.json'))
  const sourceDir = sourceDirOf(root, options.sourceDir)
  const mode = options.mode ?? 'development'
  const environments = inspectEnvironments(root, options.envDir ?? '.', mode)
  const state = detectState(root, sourceDir, pkg)
  const request = detectRequest(root, sourceDir, pkg)
  const suggestions: string[] = []
  // 完全没有 .env 的项目可能压根不用环境变量，只提示「已配置但缺模式」的情况，避免噪声。
  if (environments.files.length && environments.missing.length) {
    suggestions.push(`环境文件缺 ${environments.missing.map((name) => `.env.${name}`).join(' / ')}；建议补齐本地测试与生产环境，避免上线才发现变量没配。`)
  }
  if (state.installed && !state.configured) {
    suggestions.push(`已安装 ${state.package} 但未发现初始化配置；建议在入口调用创建实例，并集中到 ${sourceDir ?? 'src'}/stores。`)
  }
  if (request.installed && !request.unifiedFile) {
    suggestions.push(`已安装 ${request.package} 但没有统一请求封装；建议集中到 ${sourceDir ?? 'src'}/api/request，统一 baseURL、超时与错误处理。`)
  }
  if (request.unifiedFile && !request.envBase) {
    suggestions.push(`${request.unifiedFile} 的 baseURL 未读取环境变量；建议按环境切换，避免地址写死。`)
  }
  return { environments, state, request, suggestions }
}
