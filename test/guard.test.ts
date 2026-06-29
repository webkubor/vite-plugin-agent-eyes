import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ViteDevServer } from 'vite'
import { describe, expect, it } from 'vitest'
import { agentGuard, normalizeGuardConfig, runTextChecks, type StagedFile } from '../src/guard'

type GuardResultItem = {
  check: string
  severity: string
}

function stagedFile(file: Partial<StagedFile> = {}): StagedFile {
  return {
    path: file.path ?? 'src/example.ts',
    content: file.content ?? '',
    addedLines: file.addedLines ?? [],
    bytes: file.bytes ?? 0,
  }
}

function tempGitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-guard-'))
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.git/hooks'], { cwd: root, stdio: 'ignore' })
  return root
}

function tempGitRepoWithName(name: string): string {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-guard-')), name)
  fs.mkdirSync(root)
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.git/hooks'], { cwd: root, stdio: 'ignore' })
  return root
}

function fakeServer(root: string): ViteDevServer {
  return {
    config: {
      root,
      logger: {
        info() {},
        warn() {},
      },
    },
  } as unknown as ViteDevServer
}

function configureGuard(root: string): void {
  const plugin = agentGuard({ level: 'warn' })
  if (typeof plugin.configureServer !== 'function') throw new Error('configureServer is not a function')
  plugin.configureServer(fakeServer(root))
}

describe('normalizeGuardConfig', () => {
  it('defaults to block level with default checks enabled', () => {
    const config = normalizeGuardConfig()

    expect(config.level).toBe('block')
    expect(config.checks.secrets).toEqual({ enabled: true, severity: 'block' })
    expect(config.checks.largeFiles).toEqual({ enabled: true, severity: 'block', blockBytes: 1024 * 1024 })
    expect(config.checks.fileLength).toEqual({ enabled: true, severity: 'warn', warn: 400, block: 800 })
    expect(config.checks.todo).toEqual({ enabled: true, severity: 'warn' })
    expect(config.checks.noAny).toEqual({ enabled: true, severity: 'warn' })
    expect(config.checks.noConsoleLog).toEqual({ enabled: true, severity: 'warn' })
  })

  it('downgrades every built-in check to warn in warn mode', () => {
    const config = normalizeGuardConfig({ level: 'warn' })

    expect(config.checks.secrets.severity).toBe('warn')
    expect(config.checks.largeFiles.severity).toBe('warn')
  })

  it('enables only listed checks in array style config', () => {
    const config = normalizeGuardConfig({ checks: ['secrets'] })

    expect(config.checks.secrets.enabled).toBe(true)
    expect(config.checks.largeFiles.enabled).toBe(false)
    expect(config.checks.fileLength.enabled).toBe(false)
    expect(config.checks.todo.enabled).toBe(false)
    expect(config.checks.noAny.enabled).toBe(false)
    expect(config.checks.noConsoleLog.enabled).toBe(false)
  })

  it('disables object false checks while leaving other defaults enabled', () => {
    const config = normalizeGuardConfig({ checks: { noAny: false } })

    expect(config.checks.noAny.enabled).toBe(false)
    expect(config.checks.secrets.enabled).toBe(true)
    expect(config.checks.largeFiles.enabled).toBe(true)
    expect(config.checks.fileLength.enabled).toBe(true)
    expect(config.checks.todo.enabled).toBe(true)
    expect(config.checks.noConsoleLog.enabled).toBe(true)
  })
})

describe('agentGuard Vite plugin', () => {
  it('returns a serve-only Vite plugin with install hook', () => {
    const plugin = agentGuard({ level: 'warn' })

    expect(plugin.name).toBe('vite-plugin-agent-eyes-guard')
    expect(plugin.apply).toBe('serve')
    expect(typeof plugin.configureServer).toBe('function')
  })

  it('installs guard script and managed pre-commit hook in a git repo', () => {
    const root = tempGitRepo()

    configureGuard(root)

    const hooksDir = path.join(root, '.git', 'hooks')
    const guardFile = path.join(hooksDir, 'agent-eyes-guard.mjs')
    const preCommitFile = path.join(hooksDir, 'pre-commit')
    const preCommit = fs.readFileSync(preCommitFile, 'utf8')
    const quotedGuardFile = `'${guardFile}'`

    expect(fs.existsSync(guardFile)).toBe(true)
    expect(preCommit).toContain('agent-eyes managed')
    expect(preCommit).toContain(`node ${quotedGuardFile} || exit 1`)
    expect(preCommit).not.toContain(`node "${guardFile}" || exit 1`)
    expect(fs.statSync(preCommitFile).mode & 0o111).toBeGreaterThan(0)
  })

  it('installs into local core.hooksPath when configured', () => {
    const root = tempGitRepo()
    execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'ignore' })

    configureGuard(root)

    const hooksDir = path.join(root, '.githooks')
    expect(fs.existsSync(path.join(hooksDir, 'agent-eyes-guard.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true)
  })

  it('shell-quotes guard path in pre-commit hook', () => {
    const root = tempGitRepoWithName("repo $name `tick` 'quote'")

    configureGuard(root)

    const guardFile = path.join(root, '.git', 'hooks', 'agent-eyes-guard.mjs')
    const preCommit = fs.readFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), 'utf8')

    expect(preCommit).toContain(`node '${guardFile.replace(/'/g, "'\\''")}' || exit 1`)
    expect(preCommit).not.toContain(`node "${guardFile}" || exit 1`)
  })

  it('does not overwrite an existing user-owned pre-commit hook', () => {
    const root = tempGitRepo()
    const preCommitFile = path.join(root, '.git', 'hooks', 'pre-commit')
    const guardFile = path.join(root, '.git', 'hooks', 'agent-eyes-guard.mjs')
    const userHook = '#!/usr/bin/env sh\necho user-owned\n'
    fs.writeFileSync(preCommitFile, userHook)

    configureGuard(root)

    expect(fs.readFileSync(preCommitFile, 'utf8')).toBe(userHook)
    expect(fs.existsSync(guardFile)).toBe(false)
  })
})

describe('runTextChecks', () => {
  it('finds secret-like additions, TODO additions, any types, and console.log', () => {
    const config = normalizeGuardConfig({ level: 'block' })
    const items: GuardResultItem[] = runTextChecks(
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

  it('detects hyphenated provider key shapes', () => {
    const items = runTextChecks(
      stagedFile({
        content: 'const openaiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz"\n',
        addedLines: [{ line: 1, text: 'const openaiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz"' }],
      }),
      normalizeGuardConfig({ checks: ['secrets'] }),
    )

    expect(items.map((item) => item.check)).toEqual(['secrets'])
    expect(items[0]?.severity).toBe('block')
  })

  it('skips checks disabled by array or object config', () => {
    const onlySecrets = runTextChecks(
      stagedFile({
        content: ['const token = "sk_live_1234567890abcdef"', 'const value: any = {}'].join('\n'),
        addedLines: [
          { line: 1, text: 'const token = "sk_live_1234567890abcdef"' },
          { line: 2, text: 'const value: any = {}' },
        ],
      }),
      normalizeGuardConfig({ checks: ['secrets'] }),
    )
    const withoutNoAny = runTextChecks(
      stagedFile({
        content: 'const value: any = {}',
        addedLines: [{ line: 1, text: 'const value: any = {}' }],
      }),
      normalizeGuardConfig({ checks: { noAny: false } }),
    )

    expect(onlySecrets.map((item) => item.check)).toEqual(['secrets'])
    expect(withoutNoAny.map((item) => item.check)).not.toContain('noAny')
  })

  it('uses logical line counts for fileLength thresholds', () => {
    const config = normalizeGuardConfig({ checks: { fileLength: { warn: 3, block: 5 } } })
    const twoLinesWithTrailingNewline = runTextChecks(
      stagedFile({ content: 'one\ntwo\n' }),
      config,
    )
    const threeLinesWithTrailingNewline = runTextChecks(
      stagedFile({ content: 'one\ntwo\nthree\n' }),
      config,
    )
    const fiveLinesWithTrailingNewline = runTextChecks(
      stagedFile({ content: 'one\ntwo\nthree\nfour\nfive\n' }),
      config,
    )

    expect(twoLinesWithTrailingNewline.some((item) => item.check === 'fileLength')).toBe(false)
    expect(threeLinesWithTrailingNewline.find((item) => item.check === 'fileLength')?.severity).toBe('warn')
    expect(fiveLinesWithTrailingNewline.find((item) => item.check === 'fileLength')?.severity).toBe('block')
  })

  it('skips fileLength for generated lockfiles but not for source files', () => {
    const config = normalizeGuardConfig({ checks: { fileLength: { warn: 3, block: 5 } } })
    const longLockfile = 'a: 1\n'.repeat(10)
    const lock = runTextChecks(stagedFile({ path: 'pnpm-lock.yaml', content: longLockfile }), config)
    const source = runTextChecks(stagedFile({ path: 'src/big.ts', content: longLockfile }), config)

    expect(lock.some((item) => item.check === 'fileLength')).toBe(false)
    expect(source.find((item) => item.check === 'fileLength')?.severity).toBe('block')
  })

  it('allowlists configured webhook URLs from secret detection', () => {
    const url = 'https://open.feishu.cn/open-apis/bot/v2/hook/abc-123'
    const line = `webhook: [{ url: '${url}', format: 'feishu' }]`
    const config = normalizeGuardConfig({ checks: ['secrets'], allowSecrets: [url] })
    const withAllow = runTextChecks(stagedFile({ content: line, addedLines: [{ line: 1, text: line }] }), config)
    const withoutAllow = runTextChecks(
      stagedFile({ content: line, addedLines: [{ line: 1, text: line }] }),
      normalizeGuardConfig({ checks: ['secrets'] }),
    )

    expect(withAllow.some((item) => item.check === 'secrets')).toBe(false)
    expect(withoutAllow.some((item) => item.check === 'secrets')).toBe(true)
  })

  it('does not flag noAny in comments or string prose', () => {
    const items = runTextChecks(
      stagedFile({
        addedLines: [
          { line: 1, text: '// const value: any = {}' },
          { line: 2, text: 'const label = "Array<any>"' },
          { line: 3, text: 'const note = "accept any value"' },
          { line: 4, text: 'const value: any = {}' },
        ],
      }),
      normalizeGuardConfig(),
    )

    expect(items.filter((item) => item.check === 'noAny')).toHaveLength(1)
    expect(items.find((item) => item.check === 'noAny')?.line).toBe(4)
  })

  it('only flags console.log in script-like files', () => {
    const config = normalizeGuardConfig()
    const paths = ['src/a.ts', 'src/a.js', 'src/a.vue', 'src/a.svelte', 'README.md', 'notes.txt']
    const results = paths.map((path) => ({
      path,
      checks: runTextChecks(
        stagedFile({
          path,
          content: 'console.log(value)',
          addedLines: [{ line: 1, text: 'console.log(value)' }],
        }),
        config,
      ).map((item) => item.check),
    }))

    expect(results.filter((result) => result.checks.includes('noConsoleLog')).map((result) => result.path)).toEqual([
      'src/a.ts',
      'src/a.js',
      'src/a.vue',
      'src/a.svelte',
    ])
    expect(results.filter((result) => !result.checks.includes('noConsoleLog')).map((result) => result.path)).toEqual([
      'README.md',
      'notes.txt',
    ])
  })
})
