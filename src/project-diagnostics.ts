/** 配置体检：同步、只读扫描源码、Vite 配置与 package scripts，不输出环境变量值。 */
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, type ResolvedConfig } from 'vite'

/** 可定位的诊断建议；message 不包含源码行、环境变量值或 URL。 */
export interface DiagnosticIssue {
  code: string
  file: string
  line?: number
  message: string
}

/** 独立体检入参；插件接入时应传 server.config，以运行时解析结果为准。 */
export interface ConfigurationInspectionOptions {
  sourceDir?: string
  mode?: string
  envDir?: string
  envPrefix?: string | string[]
  resolvedConfig?: Partial<Pick<ResolvedConfig, 'mode' | 'envDir' | 'envPrefix' | 'env' | 'define' | 'configFile'>>
  /** 最大源码/配置文件数，默认 500。 */
  maxFiles?: number
  /** 单个源码/配置文件最大字节数，默认 256 KiB。 */
  maxFileSize?: number
}

/** 不含敏感值的体检结果和扫描完整性元数据。 */
export interface ConfigurationInspection {
  issues: DiagnosticIssue[]
  mode: string
  envDir: string
  envPrefix: string[]
  scannedFiles: number
  truncated: boolean
}

type Token = { value: string; start: number; literal?: boolean }
const EXTENSION = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i
const EXCLUDED = /^(?:node_modules|\.git|dist|build|log|logs|test|tests|__tests__|__mocks__)$/
const TEST_FILE = /(?:\.(?:test|spec)\.[^.]+|\.d\.[cm]?ts)$/i
const BUILT_INS = new Set(['MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL'])
const CONFIGS = ['ts', 'js', 'mts', 'mjs', 'cts', 'cjs'].map((ext) => `vite.config.${ext}`)

// 字符串保留为单个 token，注释被丢弃；从而不把文档/字符串里的代码当实际引用。
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const pattern = /<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g
  for (const match of text.matchAll(pattern)) {
    const value = match[0]
    if (value.startsWith('//') || value.startsWith('/*') || value.startsWith('<!--')) continue
    const literal = /^["'`]/.test(value)
    tokens.push({ value: literal ? value.slice(1, -1) : value, start: match.index!, literal })
  }
  return tokens
}

function hasSymlink(file: string, root: string): boolean {
  let current = path.resolve(file)
  const boundary = path.resolve(root)
  if (current !== boundary && !current.startsWith(`${boundary}${path.sep}`)) return true
  while (current !== boundary) {
    try { if (fs.lstatSync(current).isSymbolicLink()) return true } catch { return false }
    current = path.dirname(current)
  }
  return false
}

/** 对静态 env 引用作启发式检查，不执行项目配置或源码。 */
export function inspectConfiguration(root: string, options: ConfigurationInspectionOptions = {}): ConfigurationInspection {
  root = path.resolve(root)
  const runtime = options.resolvedConfig
  const mode = runtime?.mode ?? options.mode ?? 'development'
  const envDisabled = runtime?.envDir === false
  const envDir = path.resolve(root, typeof runtime?.envDir === 'string' ? runtime.envDir : options.envDir ?? '.')
  const prefix = runtime?.envPrefix ?? options.envPrefix ?? 'VITE_'
  const result: ConfigurationInspection = {
    issues: [], mode, envDir: path.relative(root, envDir) || '.',
    envPrefix: typeof prefix === 'string' ? [prefix] : prefix,
    scannedFiles: 0, truncated: false,
  }
  const add = (code: string, file: string, message: string, line?: number) => {
    result.issues.push({ code, file: path.relative(root, file).split(path.sep).join('/'), ...(line ? { line } : {}), message })
  }
  const incomplete = (file: string) => {
    result.truncated = true
    add('SCAN_INCOMPLETE', file, '扫描受文件数量、大小或读取条件限制，结果不完整。')
  }
  let allEnv: Record<string, string> = {}
  // loadEnv 会设置这三个特殊进程键；体检结束后还原，保持同步只读约定。
  const specialKeys = ['VITE_USER_NODE_ENV', 'BROWSER', 'BROWSER_ARGS']
  const original = specialKeys.map((key) => process.env[key])
  try {
    const envFiles = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`].map((name) => path.join(envDir, name))
    if (!envDisabled) {
      if ((envDir.startsWith(`${path.resolve(root)}${path.sep}`) && hasSymlink(envDir, root)) || fs.lstatSync(envDir).isSymbolicLink() || envFiles.some((file) => hasSymlink(file, envDir))) incomplete(envDir)
      else allEnv = loadEnv(mode, envDir, '')
    }
  } catch {
    add('ENV_LOAD_FAILED', envDir, '当前模式的环境文件无法加载，请检查 mode 与 envDir。')
  } finally {
    specialKeys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key]
      else process.env[key] = original[index]
    })
  }
  const visible = runtime?.env ?? Object.fromEntries(Object.entries(allEnv).filter(([key]) => result.envPrefix.some((p) => key.startsWith(p))))
  const defines = runtime?.define ?? {}
  const defined = (base: string, key: string): boolean => {
    if (Object.hasOwn(defines, `${base}.${key}`) || Object.hasOwn(defines, `${base}['${key}']`) || Object.hasOwn(defines, `${base}["${key}"]`)) return true
    const object = defines[base]
    if (object && typeof object === 'object') return Object.hasOwn(object, key)
    if (typeof object === 'string') {
      try { const parsed = JSON.parse(object); return parsed != null && Object.hasOwn(parsed, key) } catch { /* 非 JSON define 无法静态推断。 */ }
    }
    return false
  }
  const config = runtime && Object.hasOwn(runtime, 'configFile') ? runtime.configFile : CONFIGS.find((name) => fs.existsSync(path.join(root, name)))
  const configPath = config ? path.resolve(root, config) : undefined
  const files = new Map<string, boolean>()
  const maxFiles = Math.max(0, options.maxFiles ?? 500)
  const maxSize = Math.max(0, options.maxFileSize ?? 256 * 1024)
  let stopped = false
  let entriesSeen = 0
  const visit = (file: string, isConfig = false) => {
    if (stopped || hasSymlink(file, root)) return
    if (++entriesSeen > 10000) { incomplete(file); stopped = true; return }
    try {
      const stat = fs.lstatSync(file)
      if (stat.isDirectory()) {
        if (EXCLUDED.test(path.basename(file))) return
        for (const entry of fs.readdirSync(file).sort()) {
          visit(path.join(file, entry), isConfig)
          if (stopped) break
        }
      } else if (stat.isFile() && EXTENSION.test(file) && !TEST_FILE.test(file)) {
        if (files.has(file)) { files.set(file, files.get(file)! || isConfig); return }
        if (files.size >= maxFiles) { incomplete(file); stopped = true; return }
        if (stat.size > maxSize) { incomplete(file); return }
        files.set(file, isConfig)
      }
    } catch { incomplete(file) }
  }
  if (configPath) visit(configPath, true)
  for (const dir of options.sourceDir ? [options.sourceDir] : ['src', 'app']) {
    const file = path.resolve(root, dir)
    if (fs.existsSync(file)) visit(file)
  }
  for (const [file, isConfig] of files) {
    let text: string
    try { text = fs.readFileSync(file, 'utf8') } catch { incomplete(file); continue }
    result.scannedFiles++
    const tokens = tokenize(text)
    const values = tokens.map((token) => token.value)
    const usesLoadEnv = tokens.some((t, i) => !t.literal && t.value === 'loadEnv' && values[i + 1] === '(')
    const scopes: string[] = []
    let line = 1
    let cursor = 0
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      while (cursor < token.start) if (text[cursor++] === '\n') line++
      if (token.literal) {
        const binding = values[i - 1] === ':' || values[i - 1] === '=' ? values[i - 2] : ''
        const request = values[i - 1] === '(' && values[i - 2] === 'fetch' && !tokens[i - 2]?.literal
        const apiBinding = /^(?:API_URL|API_BASE_URL|BASE_URL|apiUrl|apiBaseUrl|baseURL|baseUrl)$/.test(binding ?? '')
        if (/^https?:\/\//i.test(token.value) && (request || apiBinding || (isConfig && binding === 'target' && scopes.includes('proxy')))) {
          add('HARDCODED_ENDPOINT', file, '疑似硬编码请求地址；建议按部署环境集中配置，并确认此处是否确需固定地址。', line)
        }
        continue
      }
      if (token.value === '{') scopes.push(values[i - 1] === ':' ? values[i - 2] : '')
      if (token.value === '}') scopes.pop()
      let base: string | undefined
      let end = i
      if (values.slice(i, i + 5).join('') === 'import.meta.env' && tokens.slice(i, i + 5).every((t) => !t.literal)) { base = 'import.meta.env'; end = i + 5 }
      if (values.slice(i, i + 3).join('') === 'process.env' && tokens.slice(i, i + 3).every((t) => !t.literal)) { base = 'process.env'; end = i + 3 }
      if (!base) continue
      const key = values[end] === '.' && !tokens[end + 1]?.literal && /^[A-Za-z_$][\w$]*$/.test(values[end + 1] ?? '')
        ? values[end + 1] : values[end] === '[' && tokens[end + 1]?.literal && values[end + 2] === ']' ? values[end + 1] : undefined
      if (!key || defined(base, key)) continue
      if (base === 'import.meta.env') {
        if (BUILT_INS.has(key)) continue
        if (!result.envPrefix.some((p) => key.startsWith(p))) add('ENV_PREFIX', file, `环境变量 ${key} 不符合当前 envPrefix，客户端无法直接读取。`, line)
        else if (!Object.hasOwn(visible, key)) add('ENV_MISSING', file, `当前模式未提供环境变量 ${key}，请检查 mode、envDir 与启动环境。`, line)
      } else if (!isConfig && key !== 'NODE_ENV') {
        add('CLIENT_PROCESS_ENV', file, `客户端 process.env.${key} 不会由 Vite 自动注入；请使用 import.meta.env 或显式 define。`, line)
      } else if (process.env[key] === undefined && Object.hasOwn(allEnv, key) && !usesLoadEnv) {
        add('CONFIG_ENV_NOT_LOADED', file, `配置读取了 ${key}，但该键仅来自环境文件；请在配置中调用 loadEnv。`, line)
      }
    }
  }
  inspectScripts(root, mode, envDisabled ? undefined : envDir, maxSize, add, incomplete)
  return result
}

function inspectScripts(root: string, activeMode: string, envDir: string | undefined, maxSize: number,
  add: (code: string, file: string, message: string, line?: number) => void, incomplete: (file: string) => void): void {
  const used = new Set([activeMode])
  const pkgPath = path.join(root, 'package.json')
  try {
    if (!hasSymlink(pkgPath, root) && fs.existsSync(pkgPath)) {
      if (fs.statSync(pkgPath).size > maxSize) incomplete(pkgPath)
      else {
        const scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts ?? {}
        for (const script of Object.values(scripts)) {
          if (typeof script !== 'string') continue
          const parts = script.match(/(?:[^\s"';&|]+|"[^"]*"|'[^']*')+|[;&|]+/g)?.map((part) => part.replace(/["']/g, '')) ?? []
          let start = true
          for (let i = 0; i < parts.length; i++) {
            if (/^[;&|]+$/.test(parts[i])) { start = true; continue }
            if (start && /^[\w_]+=/.test(parts[i])) continue
            if (!start || parts[i] !== 'vite') { start = false; continue }
            start = false
            let mode = parts[i + 1] === 'build' ? 'production' : 'development'
            for (let j = i + 1; j < parts.length && !/^[;&|]+$/.test(parts[j]); j++) {
              if (parts[j] !== '--mode' && !parts[j].startsWith('--mode=')) continue
              const value = parts[j] === '--mode' ? parts[++j] : parts[j].slice(7)
              if (!value || value.startsWith('-') || /^[;&|]+$/.test(value)) add('SCRIPT_MODE_MISSING', pkgPath, 'Vite script 的 --mode 缺少模式参数。')
              else if (value === 'local' || !/^[\w.-]+$/.test(value)) add('SCRIPT_MODE_INVALID', pkgPath, 'Vite script 的 --mode 参数无效；local 是保留名称。')
              else mode = value
            }
            used.add(mode)
          }
        }
      }
    }
  } catch { incomplete(pkgPath) }
  if (!envDir) return
  try {
    if (hasSymlink(envDir, root) || !fs.existsSync(envDir)) return
    for (const file of fs.readdirSync(envDir).sort()) {
      const match = /^\.env\.(.+?)(?:\.local)?$/.exec(file)
      if (!match || file.endsWith('.local') || file.endsWith('.example') || match[1] === 'local' || match[1] === 'example' || hasSymlink(path.join(envDir, file), root)) continue
      if (!used.has(match[1])) add('ENV_ORPHAN_MODE', path.join(envDir, file), '该环境文件的模式未被当前模式或任何直接 Vite script 使用，请确认启动命令。')
    }
  } catch { incomplete(envDir) }
}
