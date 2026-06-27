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
