/**
 * 设计 token 检查回归：命中、豁免、配置与真实独立 hook 一致性。
 * 路由：无；API：无。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGuardHookScript, normalizeGuardConfig, runGuard, runTextChecks, type AgentGuardOptions } from '../src/guard'

function scan(content: string, filename = 'src/card.css', options: AgentGuardOptions = {}) {
  return runTextChecks({ path: filename, content, bytes: content.length, addedLines: content.split('\n').map((text, i) => ({ text, line: i + 1 })) }, normalizeGuardConfig({ ...options, checks: options.checks ?? ['designTokens'] }))
}

describe('designTokens', () => {
  it.each(['#fff', '#ABCD', '#123456', '#12345678', 'rgb(1 2 3)', 'rgba(1, 2, 3, .5)', 'hsl(20 30% 40%)', 'hsla(20, 30%, 40%, .5)', 'oklch(.5 .2 30)', 'oklab(.5 .2 .3)', 'lab(50 20 30)', 'lch(50 20 30)', 'color(display-p3 1 0 0)'])('warns on %s', (color) => {
    expect(scan(`.card { color: ${color}; }`)).toEqual([expect.objectContaining({ check: 'designTokens', severity: 'warn', line: 1, message: '硬编码颜色，应使用项目 tokens（见 DESIGN.md）' })])
  })
  it.each(['css', 'scss', 'less', 'vue', 'tsx', 'jsx', 'ts', 'js', 'astro', 'svelte'])('checks %s and Tailwind arbitrary values', (ext) => {
    expect(scan('className="bg-[#fff] text-[#aabbcc]"', `src/card.${ext}`)).toHaveLength(1)
  })
  it.each(['tokens.css', 'src/tokens.ts', 'styles/my-tokens.css', 'theme.ts', 'src/design-tokens/colors.ts', 'styles/variables.scss', 'src/styles/variables.css', 'icon.svg', 'test/card.ts', '__tests__/card.ts', 'src/card.spec.tsx', 'fixtures/color.css', '__fixtures__/card.vue', 'src/card.fixture.ts'])('exempts %s', (file) => {
    expect(scan('color: #fff;', file)).toEqual([])
  })
  it.each(['--brand: #fff;', ':root { --brand: rgb(1 2 3); }', "style={{ '--brand': '#fff' }}", '// color: #fff', '/* color: #fff */', '<!-- #fff -->', '/*\ncolor: #fff\n*/', '<!--\n#fff\n-->', 'color: transparent; color: currentColor; color: inherit;', 'color: var(--brand);', 'color: rgb(var(--channels));', 'color: #fffff;', 'color: #fffffffff;'])('exempts declarations/comments/non-literals: %s', (text) => {
    expect(scan(text)).toEqual([])
  })
  it('still checks ordinary declarations next to tokens and comments', () => {
    expect(scan(':root { --brand: #fff; color: #000; } /* #abc */')).toHaveLength(1)
    expect(scan('/* #fff */ color: #000')).toHaveLength(1)
  })
  it('only checks added lines, using old lines for comment context', () => {
    const content = 'color: #fff;\n/*\n#000\n*/\ncolor: var(--brand);'
    expect(runTextChecks({ path: 'src/a.css', content, bytes: 0, addedLines: [{ line: 3, text: '#000' }, { line: 5, text: 'color: var(--brand);' }] }, normalizeGuardConfig({ checks: ['designTokens'] }))).toEqual([])
  })
  it('supports disable, allowlist, custom globs and block with global warn downgrade', () => {
    expect(normalizeGuardConfig().checks.designTokens.severity).toBe('warn')
    expect(scan('color: #fff', 'a.css', { checks: { designTokens: false } })).toEqual([])
    expect(scan('color: #fff', 'a.css', { checks: ['noAny'] })).toEqual([])
    expect(scan('color: #FFF', 'a.css', { checks: { designTokens: { allowValues: [' #fff '] } } })).toEqual([])
    expect(scan('color: #fff; background: #000', 'a.css', { checks: { designTokens: { allowValues: ['#fff'] } } })).toHaveLength(1)
    expect(scan('color: #fff', 'src/palette.css', { checks: { designTokens: { tokenFiles: ['**/palette.?ss'] } } })).toEqual([])
    expect(scan('color: #fff', 'a.css', { checks: { designTokens: 'block' } })[0].severity).toBe('block')
    expect(scan('color: #fff', 'a.css', { checks: { designTokens: { level: 'block' } } })[0].severity).toBe('block')
    expect(scan('color: #fff', 'a.css', { level: 'warn', checks: { designTokens: { level: 'block' } } })[0].severity).toBe('warn')
  })
  it.each(['warn', 'block'] as const)('matches API in an actual standalone hook (%s) using staged content', (level) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-design-tokens-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: root })
      fs.writeFileSync(path.join(root, 'card.tsx'), 'const color = "#fff"\n')
      execFileSync('git', ['add', 'card.tsx'], { cwd: root })
      fs.writeFileSync(path.join(root, 'card.tsx'), 'const color = "var(--brand)"\n')
      const options: AgentGuardOptions = { checks: { designTokens: { level } } }
      const expected = runGuard(options, root)
      const hook = path.join(root, 'hook.mjs')
      fs.writeFileSync(hook, createGuardHookScript(options))
      const result = spawnSync(process.execPath, [hook], { cwd: root, encoding: 'utf8' })
      expect(result.stderr).toBe('')
      expect(result.status).toBe(level === 'block' ? 1 : 0)
      expect(JSON.parse(fs.readFileSync(path.join(root, 'log/guard-report.json'), 'utf8'))).toEqual(expected)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
