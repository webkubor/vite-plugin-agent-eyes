/**
 * 提交前风险门禁（§agentGuard）
 * 路由：无
 * API：无；当前模块只提供配置标准化与 staged 文本检查核心。
 */

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
      secrets: { severity: severityFor(level, switchValue(checks, 'secrets'), 'block') },
      largeFiles: {
        severity: severityFor(level, switchValue(checks, 'largeFiles'), 'block'),
        blockBytes: largeFiles.blockBytes ?? DEFAULT_LARGE_FILE_BLOCK_BYTES,
      },
      fileLength: {
        severity: severityFor(level, switchValue(checks, 'fileLength'), 'warn'),
        warn: fileLength.warn ?? DEFAULT_FILE_LENGTH_WARN,
        block: fileLength.block ?? DEFAULT_FILE_LENGTH_BLOCK,
      },
      todo: { severity: severityFor(level, switchValue(checks, 'todo'), 'warn') },
      noAny: { severity: severityFor(level, switchValue(checks, 'noAny'), 'warn') },
      noConsoleLog: { severity: severityFor(level, switchValue(checks, 'noConsoleLog'), 'warn') },
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
  return content ? content.split(/\r?\n/).length : 0
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

/** 对 staged 文件内容和新增行执行轻量文本检查。 */
export function runTextChecks(file: StagedFile, config: NormalizedGuardConfig): GuardReportItem[] {
  const items: GuardReportItem[] = []

  if (file.bytes > config.checks.largeFiles.blockBytes) {
    items.push({
      check: 'largeFiles',
      severity: config.checks.largeFiles.severity,
      file: file.path,
      message: `${file.bytes} bytes exceeds ${config.checks.largeFiles.blockBytes} bytes`,
    })
  }

  const lines = lineCount(file.content)
  if (lines >= config.checks.fileLength.block) {
    items.push({
      check: 'fileLength',
      severity: config.level === 'warn' ? 'warn' : 'block',
      file: file.path,
      message: `${lines} lines exceeds block threshold ${config.checks.fileLength.block}`,
    })
  } else if (lines >= config.checks.fileLength.warn) {
    items.push({
      check: 'fileLength',
      severity: config.checks.fileLength.severity,
      file: file.path,
      message: `${lines} lines exceeds warn threshold ${config.checks.fileLength.warn}`,
    })
  }

  const secretLines = secretLineKeys(file.addedLines)
  for (const added of file.addedLines) {
    if (secretLines.has(added.line)) {
      items.push(addedLineItem('secrets', config.checks.secrets.severity, file, added, '疑似 hardcoded secret/token/webhook'))
    }
  }

  for (const added of file.addedLines) {
    if (!secretLines.has(added.line) && /\b(?:TODO|FIXME|HACK)\b/.test(added.text)) {
      items.push(addedLineItem('todo', config.checks.todo.severity, file, added, '新增 TODO/FIXME/HACK'))
    }
  }

  if (isTypeScriptFile(file.path)) {
    for (const added of file.addedLines) {
      if (!secretLines.has(added.line) && /\bany\b/.test(added.text)) {
        items.push(addedLineItem('noAny', config.checks.noAny.severity, file, added, '新增 TypeScript any'))
      }
    }
  }

  if (isConsoleLogFile(file.path)) {
    for (const added of file.addedLines) {
      if (!secretLines.has(added.line) && /\bconsole\.log\s*\(/.test(added.text)) {
        items.push(addedLineItem('noConsoleLog', config.checks.noConsoleLog.severity, file, added, '新增 console.log'))
      }
    }
  }

  return items
}
