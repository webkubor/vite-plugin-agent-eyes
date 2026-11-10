/**
 * agentGuard 核心执行逻辑（§agentGuard）
 * 路由：无
 * API：无；负责配置标准化、staged 文件采集、文本检查、报告写入与渲染。
 */

import { runDesignTokenChecks } from './guard-design-tokens'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  CSS_VAR_DECL_PATTERN,
  CSS_VAR_FILE_PATTERN,
  CSS_VAR_USE_PATTERN,
  DEFAULT_CSS_VAR_IGNORE_PREFIXES,
  DEFAULT_ENV_PARITY_ALLOW_DIFF_KEYWORDS,
  DEFAULT_ENV_PARITY_FILES,
  DEFAULT_FILE_LENGTH_BLOCK,
  DEFAULT_FILE_LENGTH_WARN,
  DEFAULT_LARGE_FILE_BLOCK_BYTES,
  DEFAULT_REPORT_FILE,
  ENV_FILE_PATTERN,
  GENERATED_FILE_PATTERN,
  JS_VAR_DECL_PATTERN,
  SECRET_PATTERNS,
  type AddedLine,
  type AgentGuardChecks,
  type AgentGuardOptions,
  type AgentGuardLevel,
  type GuardCheckSwitch,
  type GuardCssVarsOptions,
  type GuardEnvParityOptions,
  type GuardFileLengthOptions,
  type GuardLargeFilesOptions,
  type GuardReportItem,
  type GuardResult,
  type GuardSeverity,
  type NormalizedGuardCheck,
  type NormalizedGuardConfig,
  type StagedFile,
} from './guard-types'

const GIT_DIFF_ARGS = ['diff', '--cached', '--unified=0', '--no-ext-diff']

function gitText(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function gitBuffer(cwd: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
}

function severityFor(level: AgentGuardLevel, requested: GuardCheckSwitch | undefined, fallback: GuardSeverity): GuardSeverity {
  if (level === 'warn') return 'warn'
  if (requested === 'warn' || requested === 'block') return requested
  return fallback
}

function largeFilesOptions(checks: AgentGuardOptions['checks']): GuardLargeFilesOptions {
  if (!checks || Array.isArray(checks)) return {}
  return typeof checks.largeFiles === 'object' ? checks.largeFiles : {}
}

function fileLengthOptions(checks: AgentGuardOptions['checks']): GuardFileLengthOptions {
  if (!checks || Array.isArray(checks)) return {}
  return typeof checks.fileLength === 'object' ? checks.fileLength : {}
}

function cssVarsOptions(checks: AgentGuardOptions['checks']): GuardCssVarsOptions {
  if (!checks || Array.isArray(checks)) return {}
  return typeof checks.cssVars === 'object' ? checks.cssVars : {}
}

function envParityOptions(checks: AgentGuardOptions['checks']): GuardEnvParityOptions {
  if (!checks || Array.isArray(checks)) return {}
  return typeof checks.envParity === 'object' ? checks.envParity : {}
}

function switchValue<Key extends keyof AgentGuardChecks>(checks: AgentGuardOptions['checks'], key: Key): GuardCheckSwitch | undefined {
  if (!checks || Array.isArray(checks)) return undefined
  const value = checks[key]
  return typeof value === 'object' ? undefined : value
}

function enabledFor(checks: AgentGuardOptions['checks'], key: keyof AgentGuardChecks): boolean {
  if (!checks) return true
  if (Array.isArray(checks)) return checks.includes(key)
  return checks[key] !== false
}

function normalizedSwitch(
  level: AgentGuardLevel,
  checks: AgentGuardOptions['checks'],
  key: keyof AgentGuardChecks,
  fallback: GuardSeverity,
): NormalizedGuardCheck {
  return {
    enabled: enabledFor(checks, key),
    severity: severityFor(level, switchValue(checks, key), fallback),
  }
}

/** 标准化 guard 配置，集中处理默认值和 warn/block 降级。 */
export function normalizeGuardConfig(options: AgentGuardOptions = {}): NormalizedGuardConfig {
  const level = options.level ?? 'block'
  const checks = options.checks
  const largeFiles = largeFilesOptions(checks)
  const fileLength = fileLengthOptions(checks)
  const cssVars = cssVarsOptions(checks)
  const envParity = envParityOptions(checks)
  const designTokens = checks && !Array.isArray(checks) && typeof checks.designTokens === 'object' ? checks.designTokens : {}

  return {
    level,
    reportFile: options.reportFile ?? DEFAULT_REPORT_FILE,
    allowSecrets: options.allowSecrets ?? [],
    checks: {
      designTokens: {
        ...normalizedSwitch(level, checks, 'designTokens', 'warn'),
        severity: severityFor(level, designTokens.level ?? switchValue(checks, 'designTokens'), 'warn'),
        tokenFiles: designTokens.tokenFiles ?? ['**/tokens.*', '**/*tokens*.css', '**/theme.*', '**/design-tokens/**', '**/styles/variables.*'],
        allowValues: designTokens.allowValues ?? [],
      },
      secrets: normalizedSwitch(level, checks, 'secrets', 'block'),
      largeFiles: {
        enabled: enabledFor(checks, 'largeFiles'),
        severity: severityFor(level, switchValue(checks, 'largeFiles'), 'block'),
        blockBytes: largeFiles.blockBytes ?? DEFAULT_LARGE_FILE_BLOCK_BYTES,
      },
      fileLength: {
        enabled: enabledFor(checks, 'fileLength'),
        severity: severityFor(level, switchValue(checks, 'fileLength'), 'warn'),
        warn: fileLength.warn ?? DEFAULT_FILE_LENGTH_WARN,
        block: fileLength.block ?? DEFAULT_FILE_LENGTH_BLOCK,
      },
      todo: normalizedSwitch(level, checks, 'todo', 'warn'),
      noAny: normalizedSwitch(level, checks, 'noAny', 'warn'),
      noConsoleLog: normalizedSwitch(level, checks, 'noConsoleLog', 'warn'),
      cssVars: {
        enabled: enabledFor(checks, 'cssVars'),
        // 默认 block：var() 引空值会让**整条声明静默失效**（z-index 退回 auto、
        // 圆角/间距归零），而 tsc/eslint/构建全部照过，只有真人点到那个组件才暴露。
        // 又因为只查新增行，存量项目接入不会被历史债淹没，故按红线处理。
        severity: severityFor(level, switchValue(checks, 'cssVars'), 'block'),
        declareFrom: cssVars.declareFrom ?? [],
        ignorePrefixes: cssVars.ignorePrefixes ?? DEFAULT_CSS_VAR_IGNORE_PREFIXES,
      },
      envParity: {
        enabled: enabledFor(checks, 'envParity'),
        // 默认 block：环境变量开业务功能 = 测试环境验证的行为与生产不一致，
        // 「测试没问题、上线有问题」的 bug 直接漏到生产（2026-11 ModelGo 国际站
        // PUBLIC_MARKET 仅 test 配置、跨站兜底路径生产独有即为实例）。
        // 触发条件是本次提交动了 .env*，存量项目接入不会被历史分叉淹没。
        severity: severityFor(level, switchValue(checks, 'envParity'), 'block'),
        files: envParity.files ?? DEFAULT_ENV_PARITY_FILES,
        allowDiffKeywords: envParity.allowDiffKeywords ?? DEFAULT_ENV_PARITY_ALLOW_DIFF_KEYWORDS,
        ignoreVars: envParity.ignoreVars ?? [],
      },
    },
  }
}

function isTypeScriptFile(filePath: string): boolean {
  return /\.(?:ts|tsx)$/.test(filePath)
}

function isConsoleLogFile(filePath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|vue|svelte)$/.test(filePath)
}

/** 统计文本行数（忽略末尾换行），dev 期 size watch 与 commit guard 共用。 */
export function lineCount(content: string): number {
  if (!content) return 0
  const withoutFinalNewline = content.replace(/\r?\n$/, '')
  return withoutFinalNewline ? withoutFinalNewline.split(/\r?\n/).length : 0
}

function secretLineKeys(addedLines: AddedLine[], allowSecrets: string[]): Set<number> {
  const keys = new Set<number>()
  for (const added of addedLines) {
    if (allowSecrets.some((allowed) => added.text.includes(allowed))) continue
    if (SECRET_PATTERNS.some((pattern) => pattern.test(added.text))) {
      keys.add(added.line)
    }
  }
  return keys
}

function addedLineItem(
  check: keyof NormalizedGuardConfig['checks'],
  severity: GuardSeverity,
  file: StagedFile,
  added: AddedLine,
  message: string,
): GuardReportItem {
  return { check, severity, file: file.path, line: added.line, message }
}

function stripCommentAndStringText(text: string): string {
  return text
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')
    .replace(/\/\*.*?\*\//g, '')
    .split('//')[0] ?? ''
}

function hasTypeAny(text: string): boolean {
  const code = stripCommentAndStringText(text)
  return (
    /:\s*any\b/.test(code) ||
    /\bas\s+any\b/.test(code) ||
    /<\s*any\s*>/.test(code) ||
    /<[^>\n]*\bany\b[^>\n]*>/.test(code)
  )
}

function parseAddedLines(diff: string): AddedLine[] {
  const addedLines: AddedLine[] = []
  let nextLine: number | undefined
  for (const rawLine of diff.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine)
    if (hunk) {
      nextLine = Number(hunk[1])
    } else if (nextLine !== undefined && rawLine.startsWith('+')) {
      addedLines.push({ line: nextLine, text: rawLine.slice(1) })
      nextLine += 1
    } else if (nextLine !== undefined && (!rawLine.startsWith('-') || rawLine.startsWith('---'))) {
      nextLine += rawLine.startsWith(' ') ? 1 : 0
    }
  }
  return addedLines
}

function splitNul(buffer: Buffer): string[] {
  return buffer.toString('utf8').split('\0').filter(Boolean)
}

function stagedPathNames(cwd: string): string[] {
  return splitNul(gitBuffer(cwd, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']))
}

function stagedFileFromPath(cwd: string, filePath: string): StagedFile {
  try {
    const buffer = gitBuffer(cwd, ['show', `:${filePath}`])
    const binary = buffer.includes(0)
    const diff = binary ? '' : gitText(cwd, [...GIT_DIFF_ARGS, '--', filePath])
    return {
      path: filePath,
      content: binary ? '' : buffer.toString('utf8'),
      addedLines: binary ? [] : parseAddedLines(diff),
      bytes: buffer.byteLength,
      binary,
    }
  } catch {
    return { path: filePath, content: '', addedLines: [], bytes: 0, binary: true }
  }
}

/** 读取当前 Git index 中 ACMR staged 文件的文本快照和新增行。 */
export function collectStagedFiles(cwd: string): StagedFile[] {
  return stagedPathNames(cwd).map((filePath) => stagedFileFromPath(cwd, filePath))
}

function addDeclaredFromText(declared: Set<string>, text: string): void {
  for (const match of text.matchAll(CSS_VAR_DECL_PATTERN)) declared.add(match[1])
  for (const match of text.matchAll(JS_VAR_DECL_PATTERN)) declared.add(match[1])
}

function readFileSafe(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * 收集「已声明的 CSS 自定义属性」全集：仓库内跟踪的样式/脚本文件 + declareFrom 指定的外部来源。
 *
 * 用 `git ls-files` 而非目录遍历：天然跳过 node_modules、dist 与 .gitignore 内容，
 * 也不需要引入 glob 依赖（本包保持零运行时依赖）。设计 token 包不被 git 跟踪，
 * 必须由调用方通过 declareFrom 点明。
 */
export function collectDeclaredCssVars(cwd: string, declareFrom: string[] = []): Set<string> {
  const declared = new Set<string>()

  let tracked: string[] = []
  try {
    tracked = gitText(cwd, ['ls-files']).split('\n').filter(Boolean)
  } catch {
    tracked = []
  }

  for (const relative of tracked) {
    if (!CSS_VAR_FILE_PATTERN.test(relative)) continue
    const text = readFileSafe(path.resolve(cwd, relative))
    if (text) addDeclaredFromText(declared, text)
  }

  for (const relative of declareFrom) {
    const text = readFileSafe(path.resolve(cwd, relative))
    if (text) addDeclaredFromText(declared, text)
  }

  return declared
}

/**
 * 检查 staged 新增行里 var(--x) 是否引用了从未声明的自定义属性。
 *
 * 只看新增行 → 存量债不阻断；同一行同一变量只报一次 → 避免重复噪声。
 */
export function runCssVarChecks(
  file: StagedFile,
  config: NormalizedGuardConfig,
  declared: Set<string>,
): GuardReportItem[] {
  const check = config.checks.cssVars
  if (!check.enabled || !CSS_VAR_FILE_PATTERN.test(file.path)) return []

  const items: GuardReportItem[] = []
  for (const added of file.addedLines) {
    const seen = new Set<string>()
    for (const match of added.text.matchAll(CSS_VAR_USE_PATTERN)) {
      const name = match[1]
      if (seen.has(name) || declared.has(name)) continue
      if (check.ignorePrefixes.some((prefix) => name.startsWith(prefix))) continue
      seen.add(name)
      items.push(
        addedLineItem(
          'cssVars',
          check.severity,
          file,
          added,
          `var(${name}) 从未声明 —— 整条声明会静默失效（构建与 lint 都不报错），检查拼写或补上该 token`,
        ),
      )
    }
  }
  return items
}

/** env 文件里的单个变量定义。 */
interface EnvEntry {
  name: string
  value: string
  line: number
}

/**
 * 解析 .env 文本为变量表。支持 `KEY=VALUE` 与 `export KEY=VALUE`，
 * 跳过空行和 `#` 注释行；值去掉成对引号后原样保留（不去行内注释——
 * 两环境同变量若都带注释不会影响一致性判断）。
 */
export function parseEnvEntries(text: string): EnvEntry[] {
  const entries: EnvEntry[] = []
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim()
    if (!raw || raw.startsWith('#')) continue
    const declaration = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw)
    if (!declaration) continue
    let value = declaration[2].trim()
    const quoted = /^(['"])(.*)\1$/.exec(value)
    if (quoted) value = quoted[2]
    entries.push({ name: declaration[1], value, line: index + 1 })
  }
  return entries
}

function truncateValue(value: string): string {
  const shown = value.length > 60 ? `${value.slice(0, 60)}…` : value
  return shown || '(空)'
}

/** 值形似绝对地址（http(s) 或协议相对）。 */
const URL_LIKE_PATTERN = /^(?:https?:)?\/\//i

/** 值形似主机名/主机名:端口——至少一段点分，避免把单词值（如 `global`）误判成寻址。 */
const HOST_LIKE_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?$/i

/**
 * 判定一个变量是否允许两环境取值不同：变量名命中 allowDiffKeywords，
 * 或值本身就是地址形状（URL / 主机名）——寻址类命名千差万别
 * （*_CONSOLE、*_DOCS、*_GATEWAY…），靠名字清单永远列不全，值形状才是共性。
 */
function allowsValueDiff(name: string, value: string, keywords: string[]): boolean {
  const lowerName = name.toLowerCase()
  if (keywords.some((keyword) => lowerName.includes(keyword))) return true
  return URL_LIKE_PATTERN.test(value) || HOST_LIKE_PATTERN.test(value)
}

/**
 * 读取 env 比对文件的内容：staged 里有就用提交时的快照，否则回退工作区文件。
 * 一致性是文件对的全量性质，只看 diff 会漏掉「本次没动、但两侧早已分叉」的变量。
 */
function envFileContent(cwd: string, relative: string, staged: StagedFile[]): string | undefined {
  const snapshot = staged.find((file) => file.path === relative)
  if (snapshot && !snapshot.binary) return snapshot.content
  return readFileSafe(path.resolve(cwd, relative))
}

/**
 * 检查环境文件对之间的变量集合与取值分叉。
 *
 * 规则：变量集合必须一致（一侧独有 = 分叉）；同名变量取值不同时，只有
 * 变量名命中 allowDiffKeywords（环境寻址类命名）才放行，其余按 bug 拦截。
 * 任一文件缺失或为空时静默跳过——单环境项目（无 .env.test）不属于本检查的管辖。
 */
export function runEnvParityChecks(
  cwd: string,
  config: NormalizedGuardConfig,
  staged: StagedFile[],
): GuardReportItem[] {
  const check = config.checks.envParity
  const [primary, secondary] = check.files
  const primaryText = envFileContent(cwd, primary, staged)
  const secondaryText = envFileContent(cwd, secondary, staged)
  if (!primaryText?.trim() || !secondaryText?.trim()) return []

  const primaryEntries = parseEnvEntries(primaryText)
  const secondaryMap = new Map(parseEnvEntries(secondaryText).map((entry) => [entry.name, entry]))
  const primaryNames = new Set(primaryEntries.map((entry) => entry.name))
  const items: GuardReportItem[] = []

  for (const entry of primaryEntries) {
    if (check.ignoreVars.includes(entry.name)) continue
    const other = secondaryMap.get(entry.name)
    if (!other) {
      items.push({
        check: 'envParity',
        severity: check.severity,
        file: primary,
        line: entry.line,
        message: `变量 ${entry.name} 仅在 ${primary} 定义，${secondary} 缺失——环境间行为分叉，测试环境永远验不到该路径`,
      })
      continue
    }
    if (entry.value === other.value) continue
    if (allowsValueDiff(entry.name, entry.value, check.allowDiffKeywords)) continue
    items.push({
      check: 'envParity',
      severity: check.severity,
      file: primary,
      line: entry.line,
      message: `变量 ${entry.name} 两环境取值不同（${primary}='${truncateValue(entry.value)}' vs ${secondary}='${truncateValue(other.value)}'）——非寻址类变量必须一致，用 env 开业务功能属于红线`,
    })
  }

  for (const entry of secondaryMap.values()) {
    if (check.ignoreVars.includes(entry.name) || primaryNames.has(entry.name)) continue
    items.push({
      check: 'envParity',
      severity: check.severity,
      file: secondary,
      line: entry.line,
      message: `变量 ${entry.name} 仅在 ${secondary} 定义，${primary} 缺失——环境间行为分叉，生产会走进测试才有的分支（或反之）`,
    })
  }

  return items
}

function summarizeItems(items: GuardReportItem[]): GuardResult['summary'] {
  return {
    block: items.filter((item) => item.severity === 'block').length,
    warn: items.filter((item) => item.severity === 'warn').length,
  }
}

function resultFromItems(level: AgentGuardLevel, items: GuardReportItem[]): GuardResult {
  const summary = summarizeItems(items)
  return { level, passed: summary.block === 0, summary, items }
}

function reportPath(cwd: string, reportFile: string): string {
  return path.isAbsolute(reportFile) ? reportFile : path.join(cwd, reportFile)
}

function writeGuardReport(cwd: string, reportFile: string, result: GuardResult): void {
  const file = reportPath(cwd, reportFile)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`)
}

function guardErrorItem(error: unknown): GuardReportItem {
  const message = error instanceof Error ? error.message : String(error)
  return { check: 'guard', severity: 'block', message: `git staged file collection failed: ${message}` }
}

function reportWriteMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `guard report write failed: ${message}`
}

function finalizeGuardResult(cwd: string, reportFile: string, result: GuardResult): GuardResult {
  try {
    writeGuardReport(cwd, reportFile, result)
    return result
  } catch (error) {
    return { ...result, reportError: reportWriteMessage(error) }
  }
}

/** 运行 agent guard，写入 JSON 报告，并返回结构化结果。 */
export function runGuard(options: AgentGuardOptions = {}, cwd = process.cwd()): GuardResult {
  const config = normalizeGuardConfig(options)
  try {
    const staged = collectStagedFiles(cwd)
    const items = staged.flatMap((file) => runTextChecks(file, config))

    if (config.checks.cssVars.enabled && staged.some((file) => CSS_VAR_FILE_PATTERN.test(file.path))) {
      const declared = collectDeclaredCssVars(cwd, config.checks.cssVars.declareFrom)
      // 空全集 = 采集失败（非 git 环境等）或项目根本没有自定义属性。
      // 此时若照常检查，会把每一个 var() 都判成未声明 —— 宁可放行也不能制造全量误报。
      if (declared.size > 0) {
        items.push(...staged.flatMap((file) => runCssVarChecks(file, config, declared)))
      }
    }

    // 触发条件：本次提交动了 .env*（任一 mode 变体），才比对目标文件对的全量状态。
    if (config.checks.envParity.enabled && staged.some((file) => ENV_FILE_PATTERN.test(file.path))) {
      items.push(...runEnvParityChecks(cwd, config, staged))
    }

    return finalizeGuardResult(cwd, config.reportFile, resultFromItems(config.level, items))
  } catch (error) {
    return finalizeGuardResult(cwd, config.reportFile, resultFromItems(config.level, [guardErrorItem(error)]))
  }
}

function itemLocation(item: GuardReportItem): string {
  if (!item.file) return ''
  return item.line === undefined ? `${item.file}: ` : `${item.file}:${item.line}: `
}

/** 渲染面向终端用户和 agent 的 guard 文本报告。 */
export function renderGuardReport(result: GuardResult): string {
  const status = result.passed ? 'PASS' : 'BLOCK'
  const lines = [`[agent-eyes:guard] ${status} block=${result.summary.block} warn=${result.summary.warn}`]
  for (const item of result.items) {
    lines.push(`- ${item.severity} ${item.check}: ${itemLocation(item)}${item.message}`)
  }
  if (result.reportError) {
    lines.push(`- notice report: ${result.reportError}`)
  }
  return lines.join('\n')
}

/** 对 staged 文件内容和新增行执行轻量文本检查。 */
export function runTextChecks(file: StagedFile, config: NormalizedGuardConfig): GuardReportItem[] {
  const items: GuardReportItem[] = []

  if (config.checks.largeFiles.enabled && file.bytes > config.checks.largeFiles.blockBytes) {
    items.push({
      check: 'largeFiles',
      severity: config.checks.largeFiles.severity,
      file: file.path,
      message: `${file.bytes} bytes exceeds ${config.checks.largeFiles.blockBytes} bytes`,
    })
  }

  const lines = lineCount(file.content)
  const skipLength = GENERATED_FILE_PATTERN.test(file.path)
  if (config.checks.fileLength.enabled && !skipLength && lines >= config.checks.fileLength.block) {
    items.push({
      check: 'fileLength',
      severity: config.level === 'warn' ? 'warn' : 'block',
      file: file.path,
      message: `${lines} lines exceeds block threshold ${config.checks.fileLength.block}`,
    })
  } else if (config.checks.fileLength.enabled && !skipLength && lines >= config.checks.fileLength.warn) {
    items.push({
      check: 'fileLength',
      severity: config.checks.fileLength.severity,
      file: file.path,
      message: `${lines} lines exceeds warn threshold ${config.checks.fileLength.warn}`,
    })
  }

  const secretLines = config.checks.secrets.enabled ? secretLineKeys(file.addedLines, config.allowSecrets) : new Set<number>()
  if (config.checks.secrets.enabled) {
    for (const added of file.addedLines) {
      if (secretLines.has(added.line)) {
        items.push(addedLineItem('secrets', config.checks.secrets.severity, file, added, '疑似 hardcoded secret/token/webhook'))
      }
    }
  }

  if (config.checks.todo.enabled) {
    for (const added of file.addedLines) {
      if (!secretLines.has(added.line) && /\b(?:TODO|FIXME|HACK)\b/.test(added.text)) {
        items.push(addedLineItem('todo', config.checks.todo.severity, file, added, '新增 TODO/FIXME/HACK'))
      }
    }
  }

  if (config.checks.noAny.enabled && isTypeScriptFile(file.path)) {
    for (const added of file.addedLines) {
      if (!secretLines.has(added.line) && hasTypeAny(added.text)) {
        items.push(addedLineItem('noAny', config.checks.noAny.severity, file, added, '新增 TypeScript any'))
      }
    }
  }

  if (config.checks.noConsoleLog.enabled && isConsoleLogFile(file.path)) {
    for (const added of file.addedLines) {
      if (!secretLines.has(added.line) && /\bconsole\.log\s*\(/.test(added.text)) {
        items.push(addedLineItem('noConsoleLog', config.checks.noConsoleLog.severity, file, added, '新增 console.log'))
      }
    }
  }

  return [...items, ...runDesignTokenChecks(file, config.checks.designTokens)]
}
