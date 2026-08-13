/**
 * agentGuard 类型与默认常量（§agentGuard）
 * 路由：无
 * API：无；仅提供 guard 公共类型和默认阈值。
 */

/** guard 运行等级。warn 只报告，block 阻断红线；strict 当前等同 block，预留给更严格阻断。 */
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

/** CSS 自定义属性（设计 token）存在性检查配置。 */
export interface GuardCssVarsOptions {
  /**
   * 额外的声明来源：相对仓库根的文件路径，用于把仓库外的声明并入全集。
   * 设计 token 常由 npm 包提供、不被 git 跟踪，必须在这里点明，否则会被判成未声明。
   * 例：`['node_modules/@acme/design-tokens/tokens.css']`
   */
  declareFrom?: string[]
  /** 忽略的变量名前缀（框架运行时注入的，不是设计 token）。默认见 DEFAULT_CSS_VAR_IGNORE_PREFIXES。 */
  ignorePrefixes?: string[]
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
  /** 检测新增行里 var(--x) 引用了从未声明的自定义属性（含 Tailwind arbitrary value）。 */
  cssVars?: GuardCheckSwitch | GuardCssVarsOptions
}

/** agentGuard 用户配置。 */
export interface AgentGuardOptions {
  /** guard 等级，默认 block。 */
  level?: AgentGuardLevel
  /** 内置检查项。 */
  checks?: AgentGuardChecks | Array<keyof AgentGuardChecks>
  /** 报告输出路径，默认 log/guard-report.json。 */
  reportFile?: string
  /** secret 检查白名单：命中这些字面量的行不计为泄漏（agentGit 会自动注入自己配置的 webhook URL）。 */
  allowSecrets?: string[]
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

/** 标准化后的 CSS 自定义属性检查配置。 */
export interface NormalizedCssVarsCheck extends NormalizedGuardCheck {
  /** 仓库外的额外声明来源（相对仓库根）。 */
  declareFrom: string[]
  /** 忽略的变量名前缀。 */
  ignorePrefixes: string[]
}

/** 标准化后的 guard 配置。 */
export interface NormalizedGuardConfig {
  /** guard 等级。 */
  level: AgentGuardLevel
  /** JSON 报告输出路径。 */
  reportFile: string
  /** secret 检查白名单字面量。 */
  allowSecrets: string[]
  /** 标准化后的内置检查项。 */
  checks: {
    secrets: NormalizedGuardCheck
    largeFiles: NormalizedLargeFilesCheck
    fileLength: NormalizedFileLengthCheck
    todo: NormalizedGuardCheck
    noAny: NormalizedGuardCheck
    noConsoleLog: NormalizedGuardCheck
    cssVars: NormalizedCssVarsCheck
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

/** dev 期 size watch：CSS/SCSS 默认警告阈值（更严，AI 写 CSS 易堆超长文件）。 */
export const DEFAULT_CSS_LENGTH_WARN = 300

/** 生成物文件：lockfile 与压缩产物不计入 fileLength（非手写代码，行数无意义）。 */
export const GENERATED_FILE_PATTERN =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|composer\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock|Podfile\.lock|go\.sum)$|\.min\.(?:js|css)$/

/**
 * cssVars 默认忽略的变量前缀：这些由 UI 框架在运行时注入到元素上，
 * 静态扫描永远找不到声明，纳入检查只会产生固定误报。
 */
export const DEFAULT_CSS_VAR_IGNORE_PREFIXES = ['--radix-', '--tw-', '--vaul-', '--sonner-', '--swiper-']

/** CSS 自定义属性声明：`--x:`（含 :root、@theme、内联 style 属性名）。 */
export const CSS_VAR_DECL_PATTERN = /(--[a-zA-Z0-9_-]+)\s*:/g

/** CSS 自定义属性引用：`var(--x`（同时覆盖 Tailwind 的 `z-[var(--x)]` 写法）。 */
export const CSS_VAR_USE_PATTERN = /var\(\s*(--[a-zA-Z0-9_-]+)/g

/**
 * JS/TS 里以字符串键声明自定义属性：`style={{ '--x': v }}`。
 * 这是合法的动态声明方式，必须计入全集，否则会把它们误报成未声明。
 */
export const JS_VAR_DECL_PATTERN = /['"](--[a-zA-Z0-9_-]+)['"]/g

/**
 * 参与 cssVars 检查与声明采集的文件类型。含 ts/tsx/vue/svelte 是因为
 * var() 引用同样出现在 Tailwind arbitrary value 和内联 style 里——
 * 只扫 .css 会整类漏检（这是本检查最初要解决的问题）。
 */
export const CSS_VAR_FILE_PATTERN = /\.(?:css|scss|sass|less|styl|ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro)$/

/** secret/token/webhook 文本检测规则。 */
export const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  /\b(?:token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*['"][^'"]{12,}['"]/i,
  /\bsk[-_](?:live|test|proj)[-_][a-z0-9_-]{12,}/i,
  /https:\/\/(?:open\.feishu\.cn|oapi\.dingtalk\.com|qyapi\.weixin\.qq\.com)\/[^\s'"]+/i,
]
