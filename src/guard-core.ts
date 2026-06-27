/**
 * agentGuard 核心执行逻辑（§agentGuard）
 * 路由：无
 * API：无；负责配置标准化、staged 文件采集、文本检查、报告写入与渲染。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_FILE_LENGTH_BLOCK,
  DEFAULT_FILE_LENGTH_WARN,
  DEFAULT_LARGE_FILE_BLOCK_BYTES,
  DEFAULT_REPORT_FILE,
  SECRET_PATTERNS,
  type AddedLine,
  type AgentGuardChecks,
  type AgentGuardOptions,
  type AgentGuardLevel,
  type GuardCheckSwitch,
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

  return {
    level,
    reportFile: options.reportFile ?? DEFAULT_REPORT_FILE,
    checks: {
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
    },
  }
}

function isTypeScriptFile(filePath: string): boolean {
  return /\.(?:ts|tsx)$/.test(filePath)
}

function isConsoleLogFile(filePath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|vue|svelte)$/.test(filePath)
}

function lineCount(content: string): number {
  if (!content) return 0
  const withoutFinalNewline = content.replace(/\r?\n$/, '')
  return withoutFinalNewline ? withoutFinalNewline.split(/\r?\n/).length : 0
}

function secretLineKeys(addedLines: AddedLine[]): Set<number> {
  const keys = new Set<number>()
  for (const added of addedLines) {
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

function isNewFileHeader(rawLine: string): boolean {
  return rawLine.startsWith('+++ b/') || rawLine === '+++ /dev/null'
}

function parseAddedLines(diff: string): AddedLine[] {
  const addedLines: AddedLine[] = []
  let nextLine: number | undefined
  for (const rawLine of diff.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine)
    if (hunk) {
      nextLine = Number(hunk[1])
    } else if (nextLine !== undefined && rawLine.startsWith('+') && !isNewFileHeader(rawLine)) {
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
    const items = collectStagedFiles(cwd).flatMap((file) => runTextChecks(file, config))
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
  if (config.checks.fileLength.enabled && lines >= config.checks.fileLength.block) {
    items.push({
      check: 'fileLength',
      severity: config.level === 'warn' ? 'warn' : 'block',
      file: file.path,
      message: `${lines} lines exceeds block threshold ${config.checks.fileLength.block}`,
    })
  } else if (config.checks.fileLength.enabled && lines >= config.checks.fileLength.warn) {
    items.push({
      check: 'fileLength',
      severity: config.checks.fileLength.severity,
      file: file.path,
      message: `${lines} lines exceeds warn threshold ${config.checks.fileLength.warn}`,
    })
  }

  const secretLines = config.checks.secrets.enabled ? secretLineKeys(file.addedLines) : new Set<number>()
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

  return items
}
