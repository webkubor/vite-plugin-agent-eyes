import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectStagedFiles, createGuardHookScript, runGuard } from '../src/guard'

let createdRepos: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-eyes-guard-'))
  createdRepos = [...createdRepos, dir]
  git(dir, ['init'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test User'])
  return dir
}

describe('generated guard hook script', () => {
  afterEach(() => {
    for (const dir of createdRepos) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    createdRepos = []
  })

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

  it('collects staged file contents and added line numbers from the index', () => {
    const dir = makeRepo()
    fs.writeFileSync(path.join(dir, 'src.ts'), ['const one = 1', 'const two = 2', 'const three = 3'].join('\n'))
    git(dir, ['add', 'src.ts'])
    git(dir, ['commit', '-m', 'init'])
    fs.writeFileSync(
      path.join(dir, 'src.ts'),
      ['const one = 1', 'const two = 22', 'const three = 3', 'const four = 4'].join('\n'),
    )
    git(dir, ['add', 'src.ts'])
    fs.writeFileSync(path.join(dir, 'src.ts'), 'const unstaged = true\n')

    const files = collectStagedFiles(dir)

    expect(files).toHaveLength(1)
    expect(files[0]?.content).toContain('const four = 4')
    expect(files[0]?.content).not.toContain('unstaged')
    expect(files[0]?.addedLines).toEqual([
      { line: 2, text: 'const two = 22' },
      { line: 3, text: 'const three = 3' },
      { line: 4, text: 'const four = 4' },
    ])
  })

  it('runs guard checks and writes a JSON report', () => {
    const dir = makeRepo()
    fs.writeFileSync(path.join(dir, 'src.ts'), 'const value: any = {}\n')
    git(dir, ['add', 'src.ts'])

    const reportFile = 'tmp/report.json'
    const result = runGuard({ checks: ['noAny'], reportFile }, dir)
    const report = JSON.parse(fs.readFileSync(path.join(dir, reportFile), 'utf8')) as typeof result

    expect(result.passed).toBe(true)
    expect(result.summary.warn).toBe(1)
    expect(report.items[0]?.check).toBe('noAny')
  })

  it('keeps a passing result when only report writing fails', () => {
    const dir = makeRepo()
    fs.writeFileSync(path.join(dir, 'safe.ts'), 'const value = 1\n')
    git(dir, ['add', 'safe.ts'])

    const result = runGuard({ reportFile: '.' }, dir)

    expect(result.passed).toBe(true)
    expect(result.summary).toEqual({ block: 0, warn: 0 })
    expect(result.items).toEqual([])
    expect(result.reportError).toContain('guard report write failed')
  })

  it('blocks staged secrets in paths containing newlines', () => {
    const dir = makeRepo()
    const fileName = 'a\nb.ts'
    fs.writeFileSync(path.join(dir, fileName), 'const token = "sk_live_1234567890abcdef"\n')
    git(dir, ['add', fileName])

    const result = runGuard({ checks: ['secrets'] }, dir)

    expect(result.passed).toBe(false)
    expect(result.summary.block).toBe(1)
    expect(result.items[0]?.file).toBe(fileName)
  })

  it('returns a block result and still writes a report when git commands fail', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-eyes-no-git-'))
    createdRepos = [...createdRepos, dir]

    const result = runGuard({ reportFile: 'log/guard-report.json' }, dir)
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'log', 'guard-report.json'), 'utf8')) as typeof result

    expect(result.passed).toBe(false)
    expect(result.items[0]?.check).toBe('guard')
    expect(result.items[0]?.severity).toBe('block')
    expect(report.items[0]?.message).toContain('git staged file collection failed')
  })

  it('lets generated hook pass when only report writing fails', () => {
    const dir = makeRepo()
    fs.writeFileSync(path.join(dir, 'safe.ts'), 'const value = 1\n')
    git(dir, ['add', 'safe.ts'])

    const scriptFile = path.join(dir, '.git', 'hooks', 'agent-eyes-guard.mjs')
    fs.mkdirSync(path.dirname(scriptFile), { recursive: true })
    fs.writeFileSync(scriptFile, createGuardHookScript({ reportFile: '.' }))

    const output = execFileSync(process.execPath, [scriptFile], { cwd: dir, encoding: 'utf8' })

    expect(output).toContain('[agent-eyes:guard] PASS')
    expect(output).toContain('guard report write failed')
  })

  it('blocks staged secrets in newline paths from the generated hook', () => {
    const dir = makeRepo()
    const fileName = 'a\nb.ts'
    fs.writeFileSync(path.join(dir, fileName), 'const token = "sk_live_1234567890abcdef"\n')
    git(dir, ['add', fileName])

    const scriptFile = path.join(dir, '.git', 'hooks', 'agent-eyes-guard.mjs')
    fs.mkdirSync(path.dirname(scriptFile), { recursive: true })
    fs.writeFileSync(scriptFile, createGuardHookScript({ checks: ['secrets'] }))

    let failed = false
    try {
      execFileSync(process.execPath, [scriptFile], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      failed = true
    }

    expect(failed).toBe(true)
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'log', 'guard-report.json'), 'utf8')) as {
      items: Array<{ file?: string }>
    }
    expect(report.items[0]?.file).toBe(fileName)
  })

  it('preserves narrowed noAny behavior in the generated script', () => {
    const dir = makeRepo()
    fs.writeFileSync(
      path.join(dir, 'src.ts'),
      ['// const value: any = {}', 'const label = "Array<any>"', 'const value: any = {}'].join('\n'),
    )
    git(dir, ['add', 'src.ts'])

    const scriptFile = path.join(dir, '.git', 'hooks', 'agent-eyes-guard.mjs')
    fs.mkdirSync(path.dirname(scriptFile), { recursive: true })
    fs.writeFileSync(scriptFile, createGuardHookScript({ checks: ['noAny'] }))

    const output = execFileSync(process.execPath, [scriptFile], { cwd: dir, encoding: 'utf8' })
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'log', 'guard-report.json'), 'utf8')) as {
      items: Array<{ check: string; line?: number }>
    }

    expect(output).toContain('新增 TypeScript any')
    expect(report.items).toEqual([{ check: 'noAny', severity: 'warn', file: 'src.ts', line: 3, message: '新增 TypeScript any' }])
  })
})
