/**
 * agentGuard 类型与默认常量（§agentGuard）
 * 路由：无
 * API：无；仅提供 guard 公共类型和默认阈值。
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
  /** 报告写入失败时的非阻断提示，不计入 summary。 */
  reportError?: string
}

/** 默认 JSON 报告输出路径。 */
export const DEFAULT_REPORT_FILE = 'log/guard-report.json'

/** 默认大文件阻断阈值。 */
export const DEFAULT_LARGE_FILE_BLOCK_BYTES = 1024 * 1024

/** 默认文件长度警告阈值。 */
export const DEFAULT_FILE_LENGTH_WARN = 400

/** 默认文件长度阻断阈值。 */
export const DEFAULT_FILE_LENGTH_BLOCK = 800

/** secret/token/webhook 文本检测规则。 */
export const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  /\b(?:token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*['"][^'"]{12,}['"]/i,
  /\bsk_(?:live|test|proj)_[a-z0-9_-]{12,}/i,
  /https:\/\/(?:open\.feishu\.cn|oapi\.dingtalk\.com|qyapi\.weixin\.qq\.com)\/[^\s'"]+/i,
]
