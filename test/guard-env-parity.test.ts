import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeGuardConfig, parseEnvEntries, runGuard } from '../src/guard'

function tempGitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-guard-envparity-'))
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', '--local', 'user.email', 'test@example.com'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', '--local', 'user.name', 'test'], { cwd: root, stdio: 'ignore' })
  return root
}

function write(root: string, relative: string, text: string): void {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
}

function stage(root: string, ...relatives: string[]): void {
  execFileSync('git', ['add', ...relatives], { cwd: root, stdio: 'ignore' })
}

function envParityItems(result: ReturnType<typeof runGuard>) {
  return result.items.filter((item) => item.check === 'envParity')
}

describe('normalizeGuardConfig · envParity', () => {
  it('defaults to an enabled block-level check with the production/test pair', () => {
    const config = normalizeGuardConfig()

    expect(config.checks.envParity.enabled).toBe(true)
    expect(config.checks.envParity.severity).toBe('block')
    expect(config.checks.envParity.files).toEqual(['.env.production', '.env.test'])
    expect(config.checks.envParity.allowDiffKeywords).toContain('url')
    expect(config.checks.envParity.ignoreVars).toEqual([])
  })

  it('downgrades to warn in warn mode', () => {
    expect(normalizeGuardConfig({ level: 'warn' }).checks.envParity.severity).toBe('warn')
  })

  it('stays disabled when array style config omits it', () => {
    expect(normalizeGuardConfig({ checks: ['secrets'] }).checks.envParity.enabled).toBe(false)
  })

  it('accepts object options and keeps the default severity', () => {
    const config = normalizeGuardConfig({
      checks: { envParity: { files: ['.env.prod', '.env.staging'], ignoreVars: ['FEATURE_X'] } },
    })

    expect(config.checks.envParity.severity).toBe('block')
    expect(config.checks.envParity.files).toEqual(['.env.prod', '.env.staging'])
    expect(config.checks.envParity.ignoreVars).toEqual(['FEATURE_X'])
  })
})

describe('parseEnvEntries', () => {
  it('skips comments and blank lines, strips export and paired quotes', () => {
    const entries = parseEnvEntries([
      '# 注释',
      '',
      'PUBLIC_API_URL=https://api.example.com',
      'export PUBLIC_TOKEN="abc"',
      "PUBLIC_NAME='x'",
      'not a declaration',
    ].join('\n'))

    expect(entries).toEqual([
      { name: 'PUBLIC_API_URL', value: 'https://api.example.com', line: 3 },
      { name: 'PUBLIC_TOKEN', value: 'abc', line: 4 },
      { name: 'PUBLIC_NAME', value: 'x', line: 5 },
    ])
  })
})

describe('runGuard · envParity', () => {
  it('blocks a variable that only exists on one side (PUBLIC_MARKET case)', () => {
    const root = tempGitRepo()
    write(root, '.env.production', 'PUBLIC_API_URL=https://modelgo.ai\n')
    write(root, '.env.test', 'PUBLIC_API_URL=https://test.modelgo.com\nPUBLIC_MARKET=global\n')
    stage(root, '.env.production', '.env.test')

    const result = runGuard({}, root)
    const items = envParityItems(result)

    expect(result.passed).toBe(false)
    expect(items).toHaveLength(1)
    expect(items[0].file).toBe('.env.test')
    expect(items[0].message).toContain('PUBLIC_MARKET')
    expect(items[0].message).toContain('仅在 .env.test 定义')
  })

  it('blocks differing values of a non-addressing variable but allows URL-style diffs', () => {
    const root = tempGitRepo()
    write(
      root,
      '.env.production',
      [
        'PUBLIC_API_URL=https://api.modelgo.ai',
        'PUBLIC_DEMO_CONTACT_EMAIL=feedback@modelgo.com',
        'PUBLIC_DEMO_BOOKING_URL=https://calendar.google.com/x',
      ].join('\n') + '\n',
    )
    write(
      root,
      '.env.test',
      [
        'PUBLIC_API_URL=https://api.test.modelgo.com',
        'PUBLIC_DEMO_CONTACT_EMAIL=support@modelgo.com',
        'PUBLIC_DEMO_BOOKING_URL=https://calendar.google.com/x',
      ].join('\n') + '\n',
    )
    stage(root, '.env.production', '.env.test')

    const items = envParityItems(runGuard({}, root))

    // URL 类允许不同；联系邮箱是业务取值，必须一致。
    expect(items).toHaveLength(1)
    expect(items[0].message).toContain('PUBLIC_DEMO_CONTACT_EMAIL')
    expect(items[0].message).toContain('两环境取值不同')
  })

  it('respects ignoreVars for intentional single-environment markers', () => {
    const root = tempGitRepo()
    write(root, '.env.production', 'PUBLIC_API_URL=https://modelgo.ai\n')
    write(root, '.env.test', 'PUBLIC_API_URL=https://test.modelgo.com\nPUBLIC_MARKET=global\n')
    stage(root, '.env.test')

    const result = runGuard({ checks: { envParity: { ignoreVars: ['PUBLIC_MARKET'] } } }, root)

    expect(envParityItems(result)).toHaveLength(0)
    expect(result.passed).toBe(true)
  })

  it('passes when the pair is consistent apart from addressing values', () => {
    const root = tempGitRepo()
    write(
      root,
      '.env.production',
      'PUBLIC_SITE_URL=https://modelgo.ai\nPUBLIC_GLOBAL_CONSOLE=https://console.modelgo.ai\n',
    )
    write(
      root,
      '.env.test',
      'PUBLIC_SITE_URL=https://test.modelgo.com\nPUBLIC_GLOBAL_CONSOLE=https://console.test.modelgo.com\n',
    )
    stage(root, '.env.production', '.env.test')

    const result = runGuard({}, root)

    expect(envParityItems(result)).toHaveLength(0)
    expect(result.passed).toBe(true)
  })

  it('skips silently when only one side of the pair exists', () => {
    const root = tempGitRepo()
    write(root, '.env.production', 'PUBLIC_API_URL=https://modelgo.ai\n')
    stage(root, '.env.production')

    const result = runGuard({}, root)

    expect(envParityItems(result)).toHaveLength(0)
  })

  it('does not run when no env file is staged', () => {
    const root = tempGitRepo()
    write(root, '.env.production', 'PUBLIC_DEMO_CONTACT_EMAIL=a@x.com\n')
    write(root, '.env.test', 'PUBLIC_DEMO_CONTACT_EMAIL=b@x.com\n')
    write(root, 'src/main.ts', 'console.info("no env touched")\n')
    stage(root, 'src/main.ts')

    const result = runGuard({}, root)

    expect(envParityItems(result)).toHaveLength(0)
  })
})
