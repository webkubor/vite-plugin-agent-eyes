# agentGuard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a staged-file pre-commit guard that helps humans catch obvious errors and codebase-risk signals before committing, while keeping agent-readable reports for follow-up debugging.

**Architecture:** Add a new `src/guard.ts` module that owns guard config, staged-file inspection, report rendering, hook script generation, and a standalone Vite plugin. Update `src/git.ts` so `agentGit({ guard })` reuses the same hook script before custom precommit commands, while preserving webhook behavior and existing hook safety rules.

**Tech Stack:** TypeScript strict mode, Vite plugin API, Node `fs/path/child_process`, generated ESM hook scripts, git staged-file commands, tsup build.

---

## Scope Notes

The design spec showed `agentGuard()` and `agentGit({ guard })` together in one example. Implementation should treat them as two ways to install the same guard:

- Use `agentGuard({...})` when a project only wants the guard.
- Use `agentGit({ guard: {...}, precommit, webhook })` when a project also wants git command checks or webhook notifications.

Do not recommend using both in one Vite config because both can write `pre-commit`.

## File Structure

- Create `src/guard.ts`
  - Guard option types.
  - Config normalization.
  - Staged file collection.
  - Built-in checks.
  - Human-readable report rendering.
  - JSON report writing.
  - Generated hook script creation.
  - Standalone `agentGuard()` Vite plugin.
- Modify `src/git.ts`
  - Import guard types and script generation.
  - Add `guard?: AgentGuardOptions | false` to `AgentGitOptions`.
  - Compose guard execution before custom precommit commands.
- Modify `src/index.ts`
  - Export `agentGuard` and guard types.
- Create `test/guard.test.ts`
  - Unit tests for config, check severity, report behavior, and staged-only scanning helpers.
- Create `test/guard-hook.test.ts`
  - Integration-style tests using temporary git repositories.
- Modify `package.json`
  - Add `test`, `typecheck`, and `build:tmp` scripts.
  - Add `vitest` dev dependency.
- Modify `README.md`
  - Add the human guard section.
  - Correct the client manual import from `logConsole` to `logConsoleEntry` or export an alias in code.
- Modify `CHANGELOG.md`
  - Add `0.8.0` or `Unreleased` entry for `agentGuard`.
- Modify `SKILL.md`
  - Update stale version and `log/<port>/` paths.

## Task 1: Add Test Harness

**Files:**
- Modify: `package.json`
- Create: `test/guard.test.ts`
- Create: `test/guard-hook.test.ts`

- [ ] **Step 1: Update package scripts and dev dependency**

Edit `package.json` so `scripts` and `devDependencies` include:

```json
{
  "scripts": {
    "build": "tsup src/index.ts src/client.ts --format esm --dts --clean",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build:tmp": "tsup src/index.ts src/client.ts --format esm --dts --clean --out-dir /tmp/vite-plugin-agent-eyes-build",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.18.1",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.0.0",
    "vitest": "^3.2.0"
  }
}
```

Keep all existing package metadata unchanged.

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm install
```

Expected:

```text
Done
```

`pnpm-lock.yaml` is currently ignored by `.gitignore`; do not stage it unless the project owner decides lockfiles should be tracked.

- [ ] **Step 3: Create initial failing guard unit test**

Create `test/guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeGuardConfig, runTextChecks } from '../src/guard'

describe('normalizeGuardConfig', () => {
  it('defaults to block level with default checks enabled', () => {
    const config = normalizeGuardConfig()

    expect(config.level).toBe('block')
    expect(config.checks.secrets).toEqual({ severity: 'block' })
    expect(config.checks.largeFiles).toEqual({ severity: 'block', blockBytes: 1024 * 1024 })
    expect(config.checks.fileLength).toEqual({ severity: 'warn', warn: 400, block: 800 })
    expect(config.checks.todo).toEqual({ severity: 'warn' })
    expect(config.checks.noAny).toEqual({ severity: 'warn' })
    expect(config.checks.noConsoleLog).toEqual({ severity: 'warn' })
  })

  it('downgrades every built-in check to warn in warn mode', () => {
    const config = normalizeGuardConfig({ level: 'warn' })

    expect(config.checks.secrets.severity).toBe('warn')
    expect(config.checks.largeFiles.severity).toBe('warn')
  })
})

describe('runTextChecks', () => {
  it('finds secret-like additions, TODO additions, any types, and console.log', () => {
    const config = normalizeGuardConfig({ level: 'block' })
    const items = runTextChecks(
      {
        path: 'src/example.ts',
        content: [
          'const token = "sk_live_1234567890abcdef"',
          'const value: any = {}',
          'console.log(value)',
          '// TODO remove this',
        ].join('\n'),
        addedLines: [
          { line: 1, text: 'const token = "sk_live_1234567890abcdef"' },
          { line: 2, text: 'const value: any = {}' },
          { line: 3, text: 'console.log(value)' },
          { line: 4, text: '// TODO remove this' },
        ],
        bytes: 120,
      },
      config,
    )

    expect(items.map((item) => item.check)).toEqual(['secrets', 'todo', 'noAny', 'noConsoleLog'])
    expect(items.find((item) => item.check === 'secrets')?.severity).toBe('block')
    expect(items.find((item) => item.check === 'todo')?.severity).toBe('warn')
  })
})
```

- [ ] **Step 4: Create initial failing hook integration test**

Create `test/guard-hook.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGuardHookScript } from '../src/guard'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-eyes-guard-'))
  git(dir, ['init'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test User'])
  return dir
}

describe('generated guard hook script', () => {
  it('blocks staged secrets in block mode', () => {
    const dir = makeRepo()
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'src.ts'), 'const token = "sk_live_1234567890abcdef"\n')
    git(dir, ['add', 'src.ts'])

    const scriptFile = path.join(dir, '.git', 'hooks', 'agent-eyes-guard.mjs')
    fs.writeFileSync(scriptFile, createGuardHookScript({ level: 'block' }))

    let failed = false
    try {
      execFileSync(process.execPath, [scriptFile], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      failed = true
    }

    expect(failed).toBe(true)
    expect(fs.existsSync(path.join(dir, 'log', 'guard-report.json'))).toBe(true)
  })

  it('allows staged warnings in warn mode', () => {
    const dir = makeRepo()
    fs.writeFileSync(path.join(dir, 'src.ts'), 'console.log("debug")\n')
    git(dir, ['add', 'src.ts'])

    const scriptFile = path.join(dir, '.git', 'hooks', 'agent-eyes-guard.mjs')
    fs.mkdirSync(path.dirname(scriptFile), { recursive: true })
    fs.writeFileSync(scriptFile, createGuardHookScript({ level: 'warn' }))

    const output = execFileSync(process.execPath, [scriptFile], { cwd: dir, encoding: 'utf8' })

    expect(output).toContain('[agent-eyes:guard]')
    expect(fs.existsSync(path.join(dir, 'log', 'guard-report.json'))).toBe(true)
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

Run:

```bash
pnpm test
```

Expected:

```text
FAIL test/guard.test.ts
Cannot find module '../src/guard'
```

- [ ] **Step 6: Commit test harness**

```bash
git add package.json test/guard.test.ts test/guard-hook.test.ts
git diff --cached --check
git commit -m "test: 增加 agentGuard 测试骨架"
```

## Task 2: Implement Guard Core

**Files:**
- Create: `src/guard.ts`
- Test: `test/guard.test.ts`
- Test: `test/guard-hook.test.ts`

- [ ] **Step 1: Create guard types and normalization**

Create `src/guard.ts` with this initial content:

```ts
/**
 * 提交前风险门禁（§agentGuard）
 * 路由：无
 * API：无；通过 Vite dev 安装 git pre-commit hook
 */

import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

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
  /** 阻断阈值，默认 800 行；warn 模式下会降级成 warn。 */
  block?: number
}

/** 大文件检查阈值。 */
export interface GuardLargeFilesOptions {
  /** 阻断阈值，默认 1 MB；warn 模式下会降级成 warn。 */
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

interface NormalizedSwitch {
  severity: GuardSeverity
}

interface NormalizedLargeFiles extends NormalizedSwitch {
  blockBytes: number
}

interface NormalizedFileLength extends NormalizedSwitch {
  warn: number
  block: number
}

/** 标准化后的 guard 配置。 */
export interface NormalizedGuardConfig {
  level: AgentGuardLevel
  reportFile: string
  checks: {
    secrets: NormalizedSwitch
    largeFiles: NormalizedLargeFiles
    fileLength: NormalizedFileLength
    todo: NormalizedSwitch
    noAny: NormalizedSwitch
    noConsoleLog: NormalizedSwitch
  }
}

/** staged diff 中的新增行。 */
export interface AddedLine {
  line: number
  text: string
}

/** staged 文件快照。 */
export interface StagedFile {
  path: string
  content: string
  addedLines: AddedLine[]
  bytes: number
}

/** guard 报告项。 */
export interface GuardReportItem {
  check: keyof NormalizedGuardConfig['checks'] | 'guard'
  severity: GuardSeverity
  file?: string
  line?: number
  message: string
}

/** guard 运行结果。 */
export interface GuardResult {
  level: AgentGuardLevel
  passed: boolean
  summary: { block: number; warn: number }
  items: GuardReportItem[]
}

const DEFAULT_REPORT_FILE = 'log/guard-report.json'
const ONE_MB = 1024 * 1024

function severityFor(level: AgentGuardLevel, requested: GuardCheckSwitch | undefined, fallback: GuardSeverity): GuardSeverity {
  if (level === 'warn') return 'warn'
  if (requested === 'warn' || requested === 'block') return requested
  return fallback
}

function hasCheck(checks: AgentGuardChecks | Array<keyof AgentGuardChecks> | undefined, key: keyof AgentGuardChecks): boolean {
  if (!checks) return true
  if (Array.isArray(checks)) return checks.includes(key)
  return checks[key] !== false
}

/** 标准化 guard 配置，集中处理默认值和 warn/block 降级。 */
export function normalizeGuardConfig(options: AgentGuardOptions = {}): NormalizedGuardConfig {
  const level = options.level ?? 'block'
  const checks = options.checks
  const largeFiles = !Array.isArray(checks) && typeof checks?.largeFiles === 'object' ? checks.largeFiles : {}
  const fileLength = !Array.isArray(checks) && typeof checks?.fileLength === 'object' ? checks.fileLength : {}

  return {
    level,
    reportFile: options.reportFile ?? DEFAULT_REPORT_FILE,
    checks: {
      secrets: { severity: severityFor(level, !Array.isArray(checks) ? checks?.secrets : undefined, 'block') },
      largeFiles: {
        severity: severityFor(level, !Array.isArray(checks) ? checks?.largeFiles as GuardCheckSwitch | undefined : undefined, 'block'),
        blockBytes: largeFiles.blockBytes ?? ONE_MB,
      },
      fileLength: {
        severity: severityFor(level, !Array.isArray(checks) ? checks?.fileLength as GuardCheckSwitch | undefined : undefined, 'warn'),
        warn: fileLength.warn ?? 400,
        block: fileLength.block ?? 800,
      },
      todo: { severity: severityFor(level, !Array.isArray(checks) ? checks?.todo : undefined, 'warn') },
      noAny: { severity: severityFor(level, !Array.isArray(checks) ? checks?.noAny : undefined, 'warn') },
      noConsoleLog: { severity: severityFor(level, !Array.isArray(checks) ? checks?.noConsoleLog : undefined, 'warn') },
    },
  }
}
```

- [ ] **Step 2: Add text checks**

Append these functions to `src/guard.ts`:

```ts
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  /\b(?:token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*['"][^'"]{12,}['"]/i,
  /\bsk_(?:live|test|proj)_[a-z0-9_-]{12,}/i,
  /https:\/\/(?:open\.feishu\.cn|oapi\.dingtalk\.com|qyapi\.weixin\.qq\.com)\/[^\s'"]+/i,
]

function push(items: GuardReportItem[], item: GuardReportItem) {
  items.push(item)
}

/** 对 staged 文件内容和新增行执行轻量文本检查。 */
export function runTextChecks(file: StagedFile, config: NormalizedGuardConfig): GuardReportItem[] {
  const items: GuardReportItem[] = []

  if (file.bytes > config.checks.largeFiles.blockBytes) {
    push(items, {
      check: 'largeFiles',
      severity: config.checks.largeFiles.severity,
      file: file.path,
      message: `${file.bytes} bytes exceeds ${config.checks.largeFiles.blockBytes} bytes`,
    })
  }

  const lineCount = file.content ? file.content.split(/\r?\n/).length : 0
  if (lineCount >= config.checks.fileLength.block) {
    push(items, {
      check: 'fileLength',
      severity: config.level === 'warn' ? 'warn' : 'block',
      file: file.path,
      message: `${lineCount} lines exceeds block threshold ${config.checks.fileLength.block}`,
    })
  } else if (lineCount >= config.checks.fileLength.warn) {
    push(items, {
      check: 'fileLength',
      severity: config.checks.fileLength.severity,
      file: file.path,
      message: `${lineCount} lines exceeds warn threshold ${config.checks.fileLength.warn}`,
    })
  }

  for (const added of file.addedLines) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(added.text))) {
      push(items, {
        check: 'secrets',
        severity: config.checks.secrets.severity,
        file: file.path,
        line: added.line,
        message: '疑似 hardcoded secret/token/webhook',
      })
      continue
    }
    if (/\b(?:TODO|FIXME|HACK)\b/.test(added.text)) {
      push(items, {
        check: 'todo',
        severity: config.checks.todo.severity,
        file: file.path,
        line: added.line,
        message: '新增 TODO/FIXME/HACK',
      })
    }
    if (/\bany\b/.test(added.text) && /\.(?:ts|tsx)$/.test(file.path)) {
      push(items, {
        check: 'noAny',
        severity: config.checks.noAny.severity,
        file: file.path,
        line: added.line,
        message: '新增 TypeScript any',
      })
    }
    if (/\bconsole\.log\s*\(/.test(added.text) && /\.(?:ts|tsx|js|jsx|vue|svelte)$/.test(file.path)) {
      push(items, {
        check: 'noConsoleLog',
        severity: config.checks.noConsoleLog.severity,
        file: file.path,
        line: added.line,
        message: '新增 console.log',
      })
    }
  }

  return items
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm test test/guard.test.ts
```

Expected:

```text
PASS test/guard.test.ts
```

- [ ] **Step 4: Commit guard core**

```bash
git add src/guard.ts test/guard.test.ts package.json
git diff --cached --check
git commit -m "feat: 增加 agentGuard 核心检查"
```

## Task 3: Implement Staged File Collection and Hook Script

**Files:**
- Modify: `src/guard.ts`
- Test: `test/guard-hook.test.ts`

- [ ] **Step 1: Add git command helpers and staged parsing**

Append these functions to `src/guard.ts`:

```ts
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function readStagedFile(cwd: string, file: string): string {
  return execFileSync('git', ['show', `:${file}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function stagedNames(cwd: string): string[] {
  const out = git(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  return out ? out.split('\n').filter(Boolean) : []
}

function parseAddedLines(diff: string): Map<string, AddedLine[]> {
  const result = new Map<string, AddedLine[]>()
  let currentFile = ''
  let newLine = 0

  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/)
    if (fileMatch) {
      currentFile = fileMatch[1]
      if (!result.has(currentFile)) result.set(currentFile, [])
      continue
    }
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunkMatch) {
      newLine = Number(hunkMatch[1])
      continue
    }
    if (!currentFile || line.startsWith('+++')) continue
    if (line.startsWith('+')) {
      result.get(currentFile)?.push({ line: newLine, text: line.slice(1) })
      newLine++
    } else if (!line.startsWith('-')) {
      newLine++
    }
  }

  return result
}

/** 读取 staged files 和 staged diff，忽略二进制读取失败文件。 */
export function collectStagedFiles(cwd: string): StagedFile[] {
  const names = stagedNames(cwd)
  const diff = git(cwd, ['diff', '--cached', '--unified=0', '--no-ext-diff'])
  const addedByFile = parseAddedLines(diff)

  return names.flatMap((name) => {
    try {
      const content = readStagedFile(cwd, name)
      return [{
        path: name,
        content,
        addedLines: addedByFile.get(name) ?? [],
        bytes: Buffer.byteLength(content),
      }]
    } catch {
      return []
    }
  })
}
```

- [ ] **Step 2: Add result creation and report rendering**

Append these functions to `src/guard.ts`:

```ts
function createResult(level: AgentGuardLevel, items: GuardReportItem[]): GuardResult {
  const summary = items.reduce(
    (acc, item) => ({ ...acc, [item.severity]: acc[item.severity] + 1 }),
    { block: 0, warn: 0 },
  )
  return { level, passed: summary.block === 0, summary, items }
}

/** 渲染给人看的控制台报告。 */
export function renderGuardReport(result: GuardResult): string {
  const header = `[agent-eyes:guard] ${result.passed ? '通过' : '发现问题'}：${result.summary.block} 个阻断项，${result.summary.warn} 个警告`
  if (result.items.length === 0) return `${header}\n`

  const lines = [header, '']
  for (const item of result.items) {
    lines.push(`${item.severity.toUpperCase()} ${item.check}`)
    const loc = item.file ? `${item.file}${item.line ? `:${item.line}` : ''}` : '(repo)'
    lines.push(`  ${loc}  ${item.message}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function writeReport(cwd: string, config: NormalizedGuardConfig, result: GuardResult) {
  const file = path.resolve(cwd, config.reportFile)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(result, null, 2))
}

/** 执行 guard 检查并写入 JSON 报告。 */
export function runGuard(options: AgentGuardOptions = {}, cwd: string = process.cwd()): GuardResult {
  const config = normalizeGuardConfig(options)
  try {
    const files = collectStagedFiles(cwd)
    const items = files.flatMap((file) => runTextChecks(file, config))
    const result = createResult(config.level, items)
    writeReport(cwd, config, result)
    return result
  } catch (error) {
    const result = createResult(config.level, [{
      check: 'guard',
      severity: 'block',
      message: `guard failed: ${error instanceof Error ? error.message : String(error)}`,
    }])
    try {
      writeReport(cwd, config, result)
    } catch {
      /* report write failure must not hide the original guard error */
    }
    return result
  }
}
```

- [ ] **Step 3: Add hook script generation**

Append this function to `src/guard.ts`:

```ts
/** 生成自包含 guard hook 脚本，git commit 时不依赖 dev server。 */
export function createGuardHookScript(options: AgentGuardOptions = {}): string {
  const bakedOptions = JSON.stringify(options)
  return `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const options = ${bakedOptions}
const ONE_MB = 1024 * 1024
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  /\\b(?:token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\\b\\s*[:=]\\s*['"][^'"]{12,}['"]/i,
  /\\bsk_(?:live|test|proj)_[a-z0-9_-]{12,}/i,
  /https:\\/\\/(?:open\\.feishu\\.cn|oapi\\.dingtalk\\.com|qyapi\\.weixin\\.qq\\.com)\\/[^\\s'"]+/i,
]

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function severityFor(level, requested, fallback) {
  if (level === 'warn') return 'warn'
  if (requested === 'warn' || requested === 'block') return requested
  return fallback
}
function normalize(input = {}) {
  const level = input.level || 'block'
  const checks = input.checks || {}
  const largeFiles = !Array.isArray(checks) && typeof checks.largeFiles === 'object' ? checks.largeFiles : {}
  const fileLength = !Array.isArray(checks) && typeof checks.fileLength === 'object' ? checks.fileLength : {}
  return {
    level,
    reportFile: input.reportFile || 'log/guard-report.json',
    checks: {
      secrets: { severity: severityFor(level, checks.secrets, 'block') },
      largeFiles: { severity: severityFor(level, checks.largeFiles, 'block'), blockBytes: largeFiles.blockBytes || ONE_MB },
      fileLength: { severity: severityFor(level, checks.fileLength, 'warn'), warn: fileLength.warn || 400, block: fileLength.block || 800 },
      todo: { severity: severityFor(level, checks.todo, 'warn') },
      noAny: { severity: severityFor(level, checks.noAny, 'warn') },
      noConsoleLog: { severity: severityFor(level, checks.noConsoleLog, 'warn') },
    },
  }
}
function parseAddedLines(diff) {
  const result = new Map()
  let currentFile = ''
  let newLine = 0
  for (const line of diff.split('\\n')) {
    const fileMatch = line.match(/^\\+\\+\\+ b\\/(.+)$/)
    if (fileMatch) {
      currentFile = fileMatch[1]
      if (!result.has(currentFile)) result.set(currentFile, [])
      continue
    }
    const hunkMatch = line.match(/^@@ -\\d+(?:,\\d)? \\+(\\d+)(?:,\\d)? @@/)
    if (hunkMatch) {
      newLine = Number(hunkMatch[1])
      continue
    }
    if (!currentFile || line.startsWith('+++')) continue
    if (line.startsWith('+')) {
      result.get(currentFile)?.push({ line: newLine, text: line.slice(1) })
      newLine++
    } else if (!line.startsWith('-')) {
      newLine++
    }
  }
  return result
}
function collect() {
  const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split('\\n').filter(Boolean)
  const diff = git(['diff', '--cached', '--unified=0', '--no-ext-diff'])
  const added = parseAddedLines(diff)
  return names.flatMap((name) => {
    try {
      const content = execFileSync('git', ['show', ':' + name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return [{ path: name, content, addedLines: added.get(name) || [], bytes: Buffer.byteLength(content) }]
    } catch {
      return []
    }
  })
}
function checksFor(file, config) {
  const items = []
  if (file.bytes > config.checks.largeFiles.blockBytes) {
    items.push({ check: 'largeFiles', severity: config.checks.largeFiles.severity, file: file.path, message: file.bytes + ' bytes exceeds ' + config.checks.largeFiles.blockBytes + ' bytes' })
  }
  const lineCount = file.content ? file.content.split(/\\r?\\n/).length : 0
  if (lineCount >= config.checks.fileLength.block) {
    items.push({ check: 'fileLength', severity: config.level === 'warn' ? 'warn' : 'block', file: file.path, message: lineCount + ' lines exceeds block threshold ' + config.checks.fileLength.block })
  } else if (lineCount >= config.checks.fileLength.warn) {
    items.push({ check: 'fileLength', severity: config.checks.fileLength.severity, file: file.path, message: lineCount + ' lines exceeds warn threshold ' + config.checks.fileLength.warn })
  }
  for (const added of file.addedLines) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(added.text))) {
      items.push({ check: 'secrets', severity: config.checks.secrets.severity, file: file.path, line: added.line, message: '疑似 hardcoded secret/token/webhook' })
      continue
    }
    if (/\\b(?:TODO|FIXME|HACK)\\b/.test(added.text)) items.push({ check: 'todo', severity: config.checks.todo.severity, file: file.path, line: added.line, message: '新增 TODO/FIXME/HACK' })
    if (/\\bany\\b/.test(added.text) && /\\.(?:ts|tsx)$/.test(file.path)) items.push({ check: 'noAny', severity: config.checks.noAny.severity, file: file.path, line: added.line, message: '新增 TypeScript any' })
    if (/\\bconsole\\.log\\s*\\(/.test(added.text) && /\\.(?:ts|tsx|js|jsx|vue|svelte)$/.test(file.path)) items.push({ check: 'noConsoleLog', severity: config.checks.noConsoleLog.severity, file: file.path, line: added.line, message: '新增 console.log' })
  }
  return items
}
function result(config, items) {
  const summary = items.reduce((acc, item) => {
    acc[item.severity]++
    return acc
  }, { block: 0, warn: 0 })
  return { level: config.level, passed: summary.block === 0, summary, items }
}
function render(res) {
  const header = '[agent-eyes:guard] ' + (res.passed ? '通过' : '发现问题') + '：' + res.summary.block + ' 个阻断项，' + res.summary.warn + ' 个警告'
  if (res.items.length === 0) return header + '\\n'
  const lines = [header, '']
  for (const item of res.items) {
    lines.push(item.severity.toUpperCase() + ' ' + item.check)
    const loc = item.file ? item.file + (item.line ? ':' + item.line : '') : '(repo)'
    lines.push('  ' + loc + '  ' + item.message)
    lines.push('')
  }
  return lines.join('\\n') + '\\n'
}
function writeReport(config, res) {
  const file = path.resolve(process.cwd(), config.reportFile)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(res, null, 2))
}

const config = normalize(options)
let res
try {
  res = result(config, collect().flatMap((file) => checksFor(file, config)))
} catch (error) {
  res = result(config, [{ check: 'guard', severity: 'block', message: 'guard failed: ' + (error instanceof Error ? error.message : String(error)) }])
}
try {
  writeReport(config, res)
} catch (error) {
  console.warn('[agent-eyes:guard] report write failed: ' + (error instanceof Error ? error.message : String(error)))
}
process.stdout.write(render(res))
process.exit(res.passed ? 0 : 1)
`
}
```

- [ ] **Step 4: Run hook tests**

Run:

```bash
pnpm test test/guard-hook.test.ts
```

Expected:

```text
PASS test/guard-hook.test.ts
```

- [ ] **Step 5: Commit hook script support**

```bash
git add src/guard.ts test/guard-hook.test.ts
git diff --cached --check
git commit -m "feat: 增加 agentGuard hook 脚本"
```

## Task 4: Add Vite Plugin Installation

**Files:**
- Modify: `src/guard.ts`
- Test: `test/guard.test.ts`

- [ ] **Step 1: Add hook installation helpers to guard**

Append these functions to `src/guard.ts`:

```ts
const MARK_BEGIN = '# >>> agent-eyes managed (勿手改此块) >>>'
const MARK_END = '# <<< agent-eyes managed <<<'

function sh(cmd: string, cwd: string): string {
  try {
    return execFileSync(cmd, { cwd, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function resolveHooks(root: string): { hooksDir: string; shadowed: boolean; effectiveDir: string } | null {
  if (sh('git rev-parse --is-inside-work-tree', root) !== 'true') return null
  const common = sh('git rev-parse --git-common-dir', root) || sh('git rev-parse --git-dir', root)
  if (!common) return null
  const gitHooks = path.resolve(root, common, 'hooks')
  const localPath = sh('git config --local --get core.hooksPath', root)
  const effectivePath = sh('git config --get core.hooksPath', root)
  const hooksDir = localPath ? path.resolve(root, localPath) : gitHooks
  const effectiveDir = effectivePath ? path.resolve(root, effectivePath) : gitHooks
  return { hooksDir, shadowed: effectiveDir !== hooksDir, effectiveDir }
}

function isManageable(file: string): boolean {
  if (!fs.existsSync(file)) return true
  try {
    return fs.readFileSync(file, 'utf8').includes(MARK_BEGIN)
  } catch {
    return false
  }
}

function writeIfChanged(file: string, content: string): boolean {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false
  fs.writeFileSync(file, content)
  return true
}

function guardPreCommitScript(scriptFile: string): string {
  return `#!/usr/bin/env sh
${MARK_BEGIN}
node "${scriptFile}" || exit 1
${MARK_END}
`
}

/** standalone agentGuard Vite 插件：只安装 guard pre-commit。 */
export function agentGuard(options: AgentGuardOptions = {}): Plugin {
  return {
    name: 'vite-plugin-agent-eyes-guard',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root || process.cwd()
      const log = (msg: string) => server.config.logger.info(`\x1b[36m[agent-eyes:guard]\x1b[0m ${msg}`)
      const warn = (msg: string) => server.config.logger.warn(`\x1b[33m[agent-eyes:guard]\x1b[0m ${msg}`)
      const hooks = resolveHooks(root)
      if (!hooks) {
        warn('未检测到 git 仓库，跳过 guard hook 安装')
        return
      }
      if (hooks.shadowed) {
        warn(`检测到 core.hooksPath（${hooks.effectiveDir}）正在生效，guard hook 不会被 git 调用；请改用 agentGit({ guard, claimHooksPath: true }) 或手动配置本仓库 hooksPath`)
        return
      }
      fs.mkdirSync(hooks.hooksDir, { recursive: true })
      const guardFile = path.join(hooks.hooksDir, 'agent-eyes-guard.mjs')
      const preCommitFile = path.join(hooks.hooksDir, 'pre-commit')
      if (!isManageable(preCommitFile)) {
        warn('已存在非本插件管理的 pre-commit，跳过 guard hook 安装')
        return
      }
      const wroteGuard = writeIfChanged(guardFile, createGuardHookScript(options))
      const wroteHook = writeIfChanged(preCommitFile, guardPreCommitScript(guardFile))
      if (wroteHook) fs.chmodSync(preCommitFile, 0o755)
      if (wroteGuard || wroteHook) log(`已安装/更新 guard hook → ${hooks.hooksDir}`)
    },
  }
}
```

- [ ] **Step 2: Add plugin export test**

Append to `test/guard.test.ts`:

```ts
describe('agentGuard', () => {
  it('creates a serve-only Vite plugin', async () => {
    const { agentGuard } = await import('../src/guard')
    const plugin = agentGuard({ level: 'warn' })

    expect(plugin.name).toBe('vite-plugin-agent-eyes-guard')
    expect(plugin.apply).toBe('serve')
    expect(typeof plugin.configureServer).toBe('function')
  })
})
```

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm test test/guard.test.ts
```

Expected:

```text
PASS test/guard.test.ts
```

- [ ] **Step 4: Commit standalone plugin**

```bash
git add src/guard.ts test/guard.test.ts
git diff --cached --check
git commit -m "feat: 增加 agentGuard Vite 插件"
```

## Task 5: Integrate Guard Into agentGit

**Files:**
- Modify: `src/git.ts`
- Modify: `src/index.ts`
- Test: `test/guard.test.ts`

- [ ] **Step 1: Export guard from index**

Add to `src/index.ts` near the existing `agentGit` export:

```ts
export { agentGuard, createGuardHookScript, normalizeGuardConfig, renderGuardReport, runGuard } from './guard'
export type {
  AgentGuardChecks,
  AgentGuardLevel,
  AgentGuardOptions,
  GuardReportItem,
  GuardResult,
  GuardSeverity,
} from './guard'
```

- [ ] **Step 2: Add guard option to git types**

In `src/git.ts`, add imports:

```ts
import { createGuardHookScript } from './guard'
import type { AgentGuardOptions } from './guard'
```

Add to `AgentGitOptions`:

```ts
  /** 提交前风险门禁；false 表示关闭。 */
  guard?: AgentGuardOptions | false
```

- [ ] **Step 3: Compose pre-commit script**

Replace `preCommitScript(commands: string[]): string` with:

```ts
function preCommitScript(commands: string[], guardFile?: string): string {
  const guardLine = guardFile ? `node "${guardFile}" || exit 1` : ''
  const commandLines = commands.map((c) => `${c} || exit 1`).join('\n')
  const body = [guardLine, commandLines].filter(Boolean).join('\n')
  return `#!/usr/bin/env sh
${MARK_BEGIN}
# 提交前检查——guard 红线或任一命令非零退出即阻断提交（git commit --no-verify 可临时跳过）
${body}
${MARK_END}
`
}
```

In `agentGit`, change:

```ts
const { webhook, projectLabel, force = false } = options
```

to:

```ts
const { webhook, projectLabel, force = false, guard } = options
const hasGuard = guard !== undefined && guard !== false
```

Change the early return:

```ts
if (precommit.length === 0 && !webhook) return
```

to:

```ts
if (precommit.length === 0 && !webhook && !hasGuard) return
```

Replace the pre-commit install block with:

```ts
      if (precommit.length > 0 || hasGuard) {
        const file = path.join(hooksDir, 'pre-commit')
        const guardFile = hasGuard ? path.join(hooksDir, 'agent-eyes-guard.mjs') : undefined
        if (!force && !isManageable(file)) {
          warn(`已存在非本插件管理的 pre-commit，跳过（如需接管请设 force:true 或手动合并）`)
        } else {
          let wroteGuard = false
          if (hasGuard && guardFile) {
            wroteGuard = writeIfChanged(guardFile, createGuardHookScript(guard === true ? {} : guard))
          }
          if (writeIfChanged(file, preCommitScript(precommit, guardFile))) {
            fs.chmodSync(file, 0o755)
            installed.push('pre-commit')
          } else if (wroteGuard) {
            installed.push('pre-commit(guard)')
          }
        }
      }
```

If TypeScript rejects `guard === true`, remove that branch because `guard` is not typed as `true`; use:

```ts
wroteGuard = writeIfChanged(guardFile, createGuardHookScript(guard || {}))
```

- [ ] **Step 4: Add export/integration test**

Append to `test/guard.test.ts`:

```ts
describe('public exports', () => {
  it('exports agentGuard from the package entry', async () => {
    const entry = await import('../src/index')

    expect(typeof entry.agentGuard).toBe('function')
    expect(typeof entry.createGuardHookScript).toBe('function')
  })
})
```

- [ ] **Step 5: Run typecheck and tests**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected:

```text
PASS
```

- [ ] **Step 6: Commit integration**

```bash
git add src/index.ts src/git.ts src/guard.ts test/guard.test.ts
git diff --cached --check
git commit -m "feat: 集成 agentGuard 到 agentGit"
```

## Task 6: Documentation and Version Notes

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `SKILL.md`

- [ ] **Step 1: Update README guard usage**

Add this section after the `agentGit` usage section:

```md
### 1.6 Human Guard：提交前风险门禁（0.8.0+，可选）

`agentGuard()` 用来帮人提前规避明显错误和屎山信号。它只检查 staged files，不扫全仓，避免提交变慢。

只需要 guard 时：

```ts
import { agentGuard } from 'vite-plugin-agent-eyes'

export default defineConfig({
  plugins: [
    agentGuard({
      level: 'block',
      checks: {
        secrets: true,
        largeFiles: true,
        fileLength: { warn: 400, block: 800 },
        todo: 'warn',
        noAny: 'warn',
        noConsoleLog: 'warn',
      },
    }),
  ],
})
```

已经使用 `agentGit()` 时，把 guard 放进 `agentGit`，不要同时再装 `agentGuard()`：

```ts
agentGit({
  guard: {
    level: 'block',
  },
  precommit: ['pnpm typecheck', 'pnpm lint'],
  webhook: [],
})
```

等级：

| level | 行为 |
| --- | --- |
| `warn` | 只报告，不阻断提交 |
| `block` | 红线阻断，文件过长/TODO/any/console.log 只警告 |
| `strict` | 预留给更严格策略 |

报告会写入 `log/guard-report.json`，人能看控制台，agent 也能读 JSON。
```

- [ ] **Step 2: Fix README client manual import mismatch**

Find:

```ts
import { installAgentErrorReporter, logApiCall, logConsole, snapshotDom } from 'vite-plugin-agent-eyes/client'
```

Replace with:

```ts
import { installAgentErrorReporter, logApiCall, logConsoleEntry, snapshotDom } from 'vite-plugin-agent-eyes/client'
```

Find:

```ts
logConsole('warn', ['deprecated API called'])
```

Replace with:

```ts
logConsoleEntry('warn', ['deprecated API called'])
```

- [ ] **Step 3: Add changelog entry**

Add above `## [0.6.0]`:

```md
## [0.8.0] - 2026-06-27

### Added
- **`agentGuard()` Human Guard**：新增提交前风险门禁，检查 staged files 中的敏感信息、超大文件、文件过长、TODO/FIXME/HACK、TypeScript `any` 和 `console.log`。
- `agentGit({ guard })` 可复用同一套 guard，在自定义 `precommit` 命令前先执行红线检查。
- guard 报告同时输出到控制台和 `log/guard-report.json`，人和 agent 都能读取。

### Changed
- README 明确 `agentGuard()` 与 `agentGit({ guard })` 是二选一安装方式，避免重复接管 `pre-commit`。
```

- [ ] **Step 4: Update SKILL paths**

Change frontmatter:

```md
version: 0.8.0
```

Update log paths in the workflow section:

```md
1. **先读 `log/README.md`** —— 顶层台账，确认当前 dev 端口对应的 `log/<port>/`。
2. **读 `log/<port>/errors.log`** —— 定位"哪坏了"（最新在上，`head` 即可）。
```

Update quick table paths from `log/errors.log` to `log/<port>/errors.log`, and add:

```md
| `log/guard-report.json` | 提交前风险门禁报告（人提交前的阻断/警告项） |
```

- [ ] **Step 5: Run docs checks**

Run:

```bash
rg -n "log/errors.log|log/console.log|log/api-calls.log|log/proxy-" SKILL.md README.md
```

Expected: README can still mention generated runtime files, but SKILL should use `log/<port>/...`.

- [ ] **Step 6: Commit docs**

```bash
git add README.md CHANGELOG.md SKILL.md
git diff --cached --check
git commit -m "docs: 补充 agentGuard 使用说明"
```

## Task 7: Full Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected:

```text
no output and exit code 0
```

- [ ] **Step 2: Run tests**

```bash
pnpm test
```

Expected:

```text
PASS test/guard.test.ts
PASS test/guard-hook.test.ts
```

- [ ] **Step 3: Run temporary build**

```bash
pnpm build:tmp
```

Expected:

```text
ESM Build success
DTS Build success
```

- [ ] **Step 4: Inspect publish contents**

```bash
npm pack --dry-run
```

Expected tarball contents include:

```text
dist/client.d.ts
dist/client.js
dist/index.d.ts
dist/index.js
README.md
package.json
LICENSE
```

- [ ] **Step 5: Final status check**

```bash
git status --short --branch
```

Expected: only user-owned unrelated files remain, such as the pre-existing untracked `pnpm-workspace.yaml`.

## Self-Review

- Spec coverage:
  - `warn`, `block`, `strict` level semantics are represented in config normalization and docs.
  - First version staged-only behavior is implemented by `git diff --cached` and `git show :path`.
  - Human console report and agent-readable `log/guard-report.json` are included.
  - `agentGuard()` and `agentGit({ guard })` are both covered.
  - First-version non-goals remain out of scope.
- Placeholder scan:
  - The plan avoids implementation placeholders. The only TODO/FIXME text is used as literal check targets.
- Type consistency:
  - `AgentGuardOptions`, `NormalizedGuardConfig`, `GuardResult`, and `GuardReportItem` are introduced before use.
  - Export names in tests match planned exports.
