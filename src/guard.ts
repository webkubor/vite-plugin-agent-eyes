/**
 * 提交前风险门禁（§agentGuard）
 * 路由：无
 * API：无；当前模块提供配置标准化、staged 文件采集、文本检查与 hook 脚本生成。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** guard 运行等级。warn 只报告，block 阻断红线，strict 预留给更严格阻断。 */
export type AgentGuardLevel = 'warn' | 'block' | 'strict'

/** 单个检查项最终严重度。 */
export type GuardSeverity = 'warn' | 'block'

/** 布尔或严重度形式的检查配置。 */
export type GuardCheckSwitch = boolean | GuardSeverity

/** 文件长度检查阈值。 */
export interface GuardFileLengthOptions {
  /** 警告阈值，默认 400 行。 */
  warn?: number
  /** 阻断阈值，默认 800 行；warn 模式下会降级为 warn。 */
  block?: number
}

/** 大文件检查阈值。 */
export interface GuardLargeFilesOptions {
  /** 阻断阈值，默认 1 MB；warn 模式下会降级为 warn。 */
  blockBytes?: number
}

/** 内置检查项配置。 */
export interface AgentGuardChecks {
  /** 检测疑似 token、secret、private key、webhook。 */
  secrets?: GuardCheckSwitch
  /** 检测 staged 文件字节数。 */
  largeFiles?: GuardCheckSwitch | GuardLargeFilesOptions
  /** 检测 staged 文件总行数。 */
  fileLength?: GuardCheckSwitch | GuardFileLengthOptions
  /** 检测新增 TODO/FIXME/HACK。 */
  todo?: GuardCheckSwitch
  /** 检测新增 TypeScript any。 */
  noAny?: GuardCheckSwitch
  /** 检测新增 console.log。 */
  noConsoleLog?: GuardCheckSwitch
}

/** agentGuard 用户配置。 */
export interface AgentGuardOptions {
  /** guard 等级，默认 block。 */
  level?: AgentGuardLevel
  /** 内置检查项。 */
  checks?: AgentGuardChecks | Array<keyof AgentGuardChecks>
  /** 报告输出路径，默认 log/guard-report.json。 */
  reportFile?: string
}

/** 标准化后的普通检查配置。 */
export interface NormalizedGuardCheck {
  /** 是否启用该检查。 */
  enabled: boolean
  /** 该检查命中时的最终严重度。 */
  severity: GuardSeverity
}

/** 标准化后的大文件检查配置。 */
export interface NormalizedLargeFilesCheck extends NormalizedGuardCheck {
  /** 阻断阈值字节数。 */
  blockBytes: number
}

/** 标准化后的文件长度检查配置。 */
export interface NormalizedFileLengthCheck extends NormalizedGuardCheck {
  /** 警告阈值行数。 */
  warn: number
  /** 阻断阈值行数。 */
  block: number
}

/** 标准化后的 guard 配置。 */
export interface NormalizedGuardConfig {
  /** guard 等级。 */
  level: AgentGuardLevel
  /** JSON 报告输出路径。 */
  reportFile: string
  /** 标准化后的内置检查项。 */
  checks: {
    secrets: NormalizedGuardCheck
    largeFiles: NormalizedLargeFilesCheck
    fileLength: NormalizedFileLengthCheck
    todo: NormalizedGuardCheck
    noAny: NormalizedGuardCheck
    noConsoleLog: NormalizedGuardCheck
  }
}

/** staged diff 中的新增行。 */
export interface AddedLine {
  /** 新增行在文件中的行号。 */
  line: number
  /** 新增行文本。 */
  text: string
}

/** staged 文件快照。 */
export interface StagedFile {
  /** 文件路径。 */
  path: string
  /** staged 文件完整文本内容。 */
  content: string
  /** staged diff 中的新增行。 */
  addedLines: AddedLine[]
  /** staged 文件大小。 */
  bytes: number
  /** 是否为二进制或无法按文本读取的 staged 内容。 */
  binary?: boolean
}

/** guard 报告项。 */
export interface GuardReportItem {
  /** 命中的检查项。 */
  check: keyof NormalizedGuardConfig['checks'] | 'guard'
  /** 报告严重度。 */
  severity: GuardSeverity
  /** 命中文件路径。 */
  file?: string
  /** 命中行号。 */
  line?: number
  /** 面向人类和 agent 的简短说明。 */
  message: string
}

/** guard 运行结果。 */
export interface GuardResult {
  /** guard 等级。 */
  level: AgentGuardLevel
  /** 是否通过。 */
  passed: boolean
  /** 按严重度汇总的命中数量。 */
  summary: { block: number; warn: number }
  /** 详细报告项。 */
  items: GuardReportItem[]
}

const DEFAULT_REPORT_FILE = 'log/guard-report.json'
const DEFAULT_LARGE_FILE_BLOCK_BYTES = 1024 * 1024
const DEFAULT_FILE_LENGTH_WARN = 400
const DEFAULT_FILE_LENGTH_BLOCK = 800

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  /\b(?:token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*['"][^'"]{12,}['"]/i,
  /\bsk_(?:live|test|proj)_[a-z0-9_-]{12,}/i,
  /https:\/\/(?:open\.feishu\.cn|oapi\.dingtalk\.com|qyapi\.weixin\.qq\.com)\/[^\s'"]+/i,
]

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

function isTypeScriptFile(path: string): boolean {
  return /\.(?:ts|tsx)$/.test(path)
}

function isConsoleLogFile(path: string): boolean {
  return /\.(?:ts|tsx|js|jsx|vue|svelte)$/.test(path)
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

function parseAddedLines(diff: string): AddedLine[] {
  const addedLines: AddedLine[] = []
  let nextLine: number | undefined

  for (const rawLine of diff.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine)
    if (hunk) {
      nextLine = Number(hunk[1])
      continue
    }
    if (nextLine === undefined) continue
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      addedLines.push({ line: nextLine, text: rawLine.slice(1) })
      nextLine += 1
    } else if (!rawLine.startsWith('-') || rawLine.startsWith('---')) {
      nextLine += rawLine.startsWith(' ') ? 1 : 0
    }
  }

  return addedLines
}

function stagedPathNames(cwd: string): string[] {
  const output = gitText(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  return output.split(/\r?\n/).filter(Boolean)
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

function reportWriteErrorItem(error: unknown): GuardReportItem {
  const message = error instanceof Error ? error.message : String(error)
  return { check: 'guard', severity: 'block', message: `guard report write failed: ${message}` }
}

function finalizeGuardResult(cwd: string, reportFile: string, result: GuardResult): GuardResult {
  try {
    writeGuardReport(cwd, reportFile, result)
    return result
  } catch (error) {
    return resultFromItems(result.level, [...result.items, reportWriteErrorItem(error)])
  }
}

/** 运行 agent guard，写入 JSON 报告，并返回结构化结果。 */
export function runGuard(options: AgentGuardOptions = {}, cwd = process.cwd()): GuardResult {
  const config = normalizeGuardConfig(options)
  try {
    const items = collectStagedFiles(cwd).flatMap((file) => runTextChecks(file, config))
    const result = resultFromItems(config.level, items)
    return finalizeGuardResult(cwd, config.reportFile, result)
  } catch (error) {
    const result = resultFromItems(config.level, [guardErrorItem(error)])
    return finalizeGuardResult(cwd, config.reportFile, result)
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

const HOOK_RUNTIME_SOURCE = String.raw`
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPORT_FILE = 'log/guard-report.json';
const DEFAULT_LARGE_FILE_BLOCK_BYTES = 1024 * 1024;
const DEFAULT_FILE_LENGTH_WARN = 400;
const DEFAULT_FILE_LENGTH_BLOCK = 800;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  /\b(?:token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*['"][^'"]{12,}['"]/i,
  /\bsk_(?:live|test|proj)_[a-z0-9_-]{12,}/i,
  /https:\/\/(?:open\.feishu\.cn|oapi\.dingtalk\.com|qyapi\.weixin\.qq\.com)\/[^\s'"]+/i,
];
const GIT_DIFF_ARGS = ['diff', '--cached', '--unified=0', '--no-ext-diff'];

function severityFor(level, requested, fallback) {
  if (level === 'warn') return 'warn';
  if (requested === 'warn' || requested === 'block') return requested;
  return fallback;
}

function enabledFor(checks, key) {
  if (!checks) return true;
  if (Array.isArray(checks)) return checks.includes(key);
  return checks[key] !== false;
}

function switchValue(checks, key) {
  if (!checks || Array.isArray(checks)) return undefined;
  const value = checks[key];
  return value && typeof value === 'object' ? undefined : value;
}

function largeFilesOptions(checks) {
  if (!checks || Array.isArray(checks)) return {};
  return checks.largeFiles && typeof checks.largeFiles === 'object' ? checks.largeFiles : {};
}

function fileLengthOptions(checks) {
  if (!checks || Array.isArray(checks)) return {};
  return checks.fileLength && typeof checks.fileLength === 'object' ? checks.fileLength : {};
}

function normalizedSwitch(level, checks, key, fallback) {
  return { enabled: enabledFor(checks, key), severity: severityFor(level, switchValue(checks, key), fallback) };
}

function normalizeGuardConfig(options = {}) {
  const level = options.level ?? 'block';
  const checks = options.checks;
  const largeFiles = largeFilesOptions(checks);
  const fileLength = fileLengthOptions(checks);
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
  };
}

function gitText(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitBuffer(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseAddedLines(diff) {
  const addedLines = [];
  let nextLine;
  for (const rawLine of diff.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (nextLine === undefined) continue;
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      addedLines.push({ line: nextLine, text: rawLine.slice(1) });
      nextLine += 1;
    } else if (!rawLine.startsWith('-') || rawLine.startsWith('---')) {
      nextLine += rawLine.startsWith(' ') ? 1 : 0;
    }
  }
  return addedLines;
}

function collectStagedFiles(cwd) {
  const names = gitText(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split(/\r?\n/).filter(Boolean);
  return names.map((filePath) => stagedFileFromPath(cwd, filePath));
}

function stagedFileFromPath(cwd, filePath) {
  try {
    const buffer = gitBuffer(cwd, ['show', ':' + filePath]);
    const binary = buffer.includes(0);
    const diff = binary ? '' : gitText(cwd, [...GIT_DIFF_ARGS, '--', filePath]);
    return { path: filePath, content: binary ? '' : buffer.toString('utf8'), addedLines: binary ? [] : parseAddedLines(diff), bytes: buffer.byteLength, binary };
  } catch {
    return { path: filePath, content: '', addedLines: [], bytes: 0, binary: true };
  }
}

function isTypeScriptFile(filePath) {
  return /\.(?:ts|tsx)$/.test(filePath);
}

function isConsoleLogFile(filePath) {
  return /\.(?:ts|tsx|js|jsx|vue|svelte)$/.test(filePath);
}

function lineCount(content) {
  if (!content) return 0;
  const withoutFinalNewline = content.replace(/\r?\n$/, '');
  return withoutFinalNewline ? withoutFinalNewline.split(/\r?\n/).length : 0;
}

function secretLineKeys(addedLines) {
  const keys = new Set();
  for (const added of addedLines) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(added.text))) keys.add(added.line);
  }
  return keys;
}

function addedLineItem(check, severity, file, added, message) {
  return { check, severity, file: file.path, line: added.line, message };
}

function stripCommentAndStringText(text) {
  const quotePattern = new RegExp('([\\x22\\x27\\x60])(?:\\\\.|(?!\\1).)*\\1', 'g');
  return text.replace(quotePattern, '').replace(/\/\*.*?\*\//g, '').split('//')[0] ?? '';
}

function hasTypeAny(text) {
  const code = stripCommentAndStringText(text);
  return /:\s*any\b/.test(code) || /\bas\s+any\b/.test(code) || /<\s*any\s*>/.test(code) || /<[^>\n]*\bany\b[^>\n]*>/.test(code);
}

function runTextChecks(file, config) {
  const items = [];
  if (config.checks.largeFiles.enabled && file.bytes > config.checks.largeFiles.blockBytes) {
    items.push({ check: 'largeFiles', severity: config.checks.largeFiles.severity, file: file.path, message: String(file.bytes) + ' bytes exceeds ' + String(config.checks.largeFiles.blockBytes) + ' bytes' });
  }
  const lines = lineCount(file.content);
  if (config.checks.fileLength.enabled && lines >= config.checks.fileLength.block) {
    items.push({ check: 'fileLength', severity: config.level === 'warn' ? 'warn' : 'block', file: file.path, message: String(lines) + ' lines exceeds block threshold ' + String(config.checks.fileLength.block) });
  } else if (config.checks.fileLength.enabled && lines >= config.checks.fileLength.warn) {
    items.push({ check: 'fileLength', severity: config.checks.fileLength.severity, file: file.path, message: String(lines) + ' lines exceeds warn threshold ' + String(config.checks.fileLength.warn) });
  }
  const secretLines = config.checks.secrets.enabled ? secretLineKeys(file.addedLines) : new Set();
  if (config.checks.secrets.enabled) {
    for (const added of file.addedLines) {
      if (secretLines.has(added.line)) items.push(addedLineItem('secrets', config.checks.secrets.severity, file, added, '疑似 hardcoded secret/token/webhook'));
    }
  }
  if (config.checks.todo.enabled) {
    for (const added of file.addedLines) {
      if (!secretLines.has(added.line) && /\b(?:TODO|FIXME|HACK)\b/.test(added.text)) items.push(addedLineItem('todo', config.checks.todo.severity, file, added, '新增 TODO/FIXME/HACK'));
    }
  }
  if (config.checks.noAny.enabled && isTypeScriptFile(file.path)) {
    for (const added of file.addedLines) {
      if (!secretLines.has(added.line) && hasTypeAny(added.text)) items.push(addedLineItem('noAny', config.checks.noAny.severity, file, added, '新增 TypeScript any'));
    }
  }
  if (config.checks.noConsoleLog.enabled && isConsoleLogFile(file.path)) {
    for (const added of file.addedLines) {
      if (!secretLines.has(added.line) && /\bconsole\.log\s*\(/.test(added.text)) items.push(addedLineItem('noConsoleLog', config.checks.noConsoleLog.severity, file, added, '新增 console.log'));
    }
  }
  return items;
}

function summarizeItems(items) {
  return {
    block: items.filter((item) => item.severity === 'block').length,
    warn: items.filter((item) => item.severity === 'warn').length,
  };
}

function resultFromItems(level, items) {
  const summary = summarizeItems(items);
  return { level, passed: summary.block === 0, summary, items };
}

function reportPath(cwd, reportFile) {
  return path.isAbsolute(reportFile) ? reportFile : path.join(cwd, reportFile);
}

function writeGuardReport(cwd, reportFile, result) {
  const file = reportPath(cwd, reportFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
}

function guardErrorItem(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { check: 'guard', severity: 'block', message: 'git staged file collection failed: ' + message };
}

function reportWriteErrorItem(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { check: 'guard', severity: 'block', message: 'guard report write failed: ' + message };
}

function finalizeGuardResult(cwd, reportFile, result) {
  try {
    writeGuardReport(cwd, reportFile, result);
    return result;
  } catch (error) {
    return resultFromItems(result.level, [...result.items, reportWriteErrorItem(error)]);
  }
}

function runGuard(options = {}, cwd = process.cwd()) {
  const config = normalizeGuardConfig(options);
  try {
    const items = collectStagedFiles(cwd).flatMap((file) => runTextChecks(file, config));
    const result = resultFromItems(config.level, items);
    return finalizeGuardResult(cwd, config.reportFile, result);
  } catch (error) {
    const result = resultFromItems(config.level, [guardErrorItem(error)]);
    return finalizeGuardResult(cwd, config.reportFile, result);
  }
}

function itemLocation(item) {
  if (!item.file) return '';
  return item.line === undefined ? item.file + ': ' : item.file + ':' + String(item.line) + ': ';
}

function renderGuardReport(result) {
  const status = result.passed ? 'PASS' : 'BLOCK';
  const lines = ['[agent-eyes:guard] ' + status + ' block=' + String(result.summary.block) + ' warn=' + String(result.summary.warn)];
  for (const item of result.items) {
    lines.push('- ' + item.severity + ' ' + item.check + ': ' + itemLocation(item) + item.message);
  }
  return lines.join('\n');
}
`

/** 创建可直接写入 Git hook 的自包含 Node ESM guard 脚本。 */
export function createGuardHookScript(options: AgentGuardOptions = {}): string {
  const optionsJson = JSON.stringify(options)
  return [
    '#!/usr/bin/env node',
    HOOK_RUNTIME_SOURCE.trim(),
    `const result = runGuard(${optionsJson}, process.cwd());`,
    'console.log(renderGuardReport(result));',
    'process.exit(result.passed ? 0 : 1);',
    '',
  ].join('\n')
}
