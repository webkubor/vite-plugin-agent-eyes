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
