import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectDeclaredCssVars,
  normalizeGuardConfig,
  runCssVarChecks,
  runGuard,
  type StagedFile,
} from '../src/guard'

function stagedFile(filePath: string, addedTexts: string[]): StagedFile {
  return {
    path: filePath,
    content: addedTexts.join('\n'),
    addedLines: addedTexts.map((text, index) => ({ line: index + 1, text })),
    bytes: 0,
  }
}

function tempGitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-guard-cssvars-'))
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

describe('normalizeGuardConfig · cssVars', () => {
  it('defaults to an enabled block-level check with no extra declare sources', () => {
    const config = normalizeGuardConfig()

    expect(config.checks.cssVars.enabled).toBe(true)
    expect(config.checks.cssVars.severity).toBe('block')
    expect(config.checks.cssVars.declareFrom).toEqual([])
    expect(config.checks.cssVars.ignorePrefixes).toContain('--radix-')
  })

  it('downgrades to warn in warn mode', () => {
    expect(normalizeGuardConfig({ level: 'warn' }).checks.cssVars.severity).toBe('warn')
  })

  it('stays disabled when array style config omits it', () => {
    expect(normalizeGuardConfig({ checks: ['secrets'] }).checks.cssVars.enabled).toBe(false)
  })

  it('accepts object options without losing the default severity', () => {
    const config = normalizeGuardConfig({
      checks: { cssVars: { declareFrom: ['node_modules/@acme/tokens/tokens.css'], ignorePrefixes: ['--x-'] } },
    })

    expect(config.checks.cssVars.enabled).toBe(true)
    expect(config.checks.cssVars.severity).toBe('block')
    expect(config.checks.cssVars.declareFrom).toEqual(['node_modules/@acme/tokens/tokens.css'])
    expect(config.checks.cssVars.ignorePrefixes).toEqual(['--x-'])
  })
})

describe('collectDeclaredCssVars', () => {
  it('collects declarations from tracked css and inline style literals', () => {
    const root = tempGitRepo()
    write(root, 'src/tokens.css', ':root {\n  --mg-brand: #06f;\n  --mg-radius-md: 14px;\n}\n')
    write(root, 'src/Slide.tsx', "const s = { '--slide-offset': '4px' }\n")
    stage(root, 'src/tokens.css', 'src/Slide.tsx')

    const declared = collectDeclaredCssVars(root)

    expect(declared.has('--mg-brand')).toBe(true)
    expect(declared.has('--mg-radius-md')).toBe(true)
    expect(declared.has('--slide-offset')).toBe(true)
  })

  it('includes declareFrom sources that git does not track', () => {
    const root = tempGitRepo()
    // 设计 token 包位于 node_modules：不被 git 跟踪，只能靠 declareFrom 并入
    write(root, 'node_modules/@acme/tokens/tokens.css', ':root { --acme-z-modal: 1400; }\n')

    expect(collectDeclaredCssVars(root).has('--acme-z-modal')).toBe(false)
    expect(
      collectDeclaredCssVars(root, ['node_modules/@acme/tokens/tokens.css']).has('--acme-z-modal'),
    ).toBe(true)
  })
})

describe('runCssVarChecks', () => {
  const config = normalizeGuardConfig()
  const declared = new Set(['--mg-z-modal'])

  it('flags a Tailwind arbitrary value referencing an undeclared token', () => {
    // 事故回归：把硬编码 z-50 换成 var()，但变量从未声明 → z-index 整条失效退回 auto
    const file = stagedFile('src/ui/Sheet.tsx', ['  className="fixed inset-0 z-[var(--mg-z-overlay)]"'])

    const items = runCssVarChecks(file, config, declared)

    expect(items).toHaveLength(1)
    expect(items[0].check).toBe('cssVars')
    expect(items[0].severity).toBe('block')
    expect(items[0].file).toBe('src/ui/Sheet.tsx')
    expect(items[0].line).toBe(1)
    expect(items[0].message).toContain('--mg-z-overlay')
  })

  it('passes declared tokens', () => {
    const file = stagedFile('src/ui/Dialog.tsx', ['  className="z-[var(--mg-z-modal)]"'])

    expect(runCssVarChecks(file, config, declared)).toEqual([])
  })

  it('ignores framework runtime variables by prefix', () => {
    const file = stagedFile('src/ui/Select.tsx', ['  maxHeight: "var(--radix-select-content-available-height)"'])

    expect(runCssVarChecks(file, config, declared)).toEqual([])
  })

  it('reports each undeclared variable once per line', () => {
    const file = stagedFile('src/ui/Tip.tsx', [
      '  className="rounded-[var(--mg-tip-radius)] p-[var(--mg-tip-pad)] shadow-[var(--mg-tip-radius)]"',
    ])

    const items = runCssVarChecks(file, config, declared)

    expect(items).toHaveLength(2)
    expect(items.map((item) => item.message).join(' ')).toContain('--mg-tip-pad')
  })

  it('skips files that cannot hold css var references', () => {
    const file = stagedFile('docs/notes.md', ['var(--mg-z-overlay)'])

    expect(runCssVarChecks(file, config, declared)).toEqual([])
  })

  it('returns nothing when the check is disabled', () => {
    const file = stagedFile('src/ui/Sheet.tsx', ['z-[var(--mg-z-overlay)]'])

    expect(runCssVarChecks(file, normalizeGuardConfig({ checks: { cssVars: false } }), declared)).toEqual([])
  })
})

describe('runGuard · cssVars end to end', () => {
  it('blocks a staged tsx that references an undeclared token', () => {
    const root = tempGitRepo()
    write(root, 'src/tokens.css', ':root { --mg-z-modal: 1400; }\n')
    write(root, 'src/ui/Sheet.tsx', 'export const c = "fixed inset-0 z-[var(--mg-z-overlay)]"\n')
    stage(root, 'src/tokens.css', 'src/ui/Sheet.tsx')

    const result = runGuard({ checks: ['cssVars'] }, root)

    expect(result.passed).toBe(false)
    const hit = result.items.find((item) => item.check === 'cssVars')
    expect(hit?.file).toBe('src/ui/Sheet.tsx')
    expect(hit?.message).toContain('--mg-z-overlay')
  })

  it('passes once the token is declared', () => {
    const root = tempGitRepo()
    write(root, 'src/tokens.css', ':root {\n  --mg-z-modal: 1400;\n  --mg-z-overlay: 1300;\n}\n')
    write(root, 'src/ui/Sheet.tsx', 'export const c = "fixed inset-0 z-[var(--mg-z-overlay)]"\n')
    stage(root, 'src/tokens.css', 'src/ui/Sheet.tsx')

    expect(runGuard({ checks: ['cssVars'] }, root).passed).toBe(true)
  })

  it('does not fire when no declaration exists anywhere (avoids blanket false positives)', () => {
    // 全集为空 = 采集失败或项目根本没有自定义属性；此时宁可放行也不能把每个 var() 都判成未声明
    const root = tempGitRepo()
    write(root, 'src/ui/Sheet.tsx', 'export const c = "z-[var(--mg-z-overlay)]"\n')
    stage(root, 'src/ui/Sheet.tsx')

    expect(runGuard({ checks: ['cssVars'] }, root).passed).toBe(true)
  })

  it('resolves declarations from a token package via declareFrom', () => {
    const root = tempGitRepo()
    write(root, 'node_modules/@acme/tokens/tokens.css', ':root { --acme-z-overlay: 1300; }\n')
    write(root, 'src/ui/Sheet.tsx', 'export const c = "z-[var(--acme-z-overlay)]"\n')
    // 仓库内必须至少有一处声明，否则命中空集合保护
    write(root, 'src/local.css', ':root { --local-gap: 8px; }\n')
    stage(root, 'src/ui/Sheet.tsx', 'src/local.css')

    const without = runGuard({ checks: ['cssVars'] }, root)
    expect(without.passed).toBe(false)

    const withPackage = runGuard(
      { checks: { cssVars: { declareFrom: ['node_modules/@acme/tokens/tokens.css'] } } },
      root,
    )
    expect(withPackage.items.some((item) => item.check === 'cssVars')).toBe(false)
  })
})
