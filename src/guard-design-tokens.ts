/**
 * 设计 token 提交检查：只报告新增行里的颜色字面量。
 * 路由：无；API：无。纯函数同时序列化进独立 Git hook，不能依赖模块闭包。
 */
import type { GuardReportItem, NormalizedGuardConfig, StagedFile } from './guard-types'

/** 扫描新增颜色；读取完整快照仅用于识别跨行注释。 */
export function runDesignTokenChecks(
  file: StagedFile,
  check: NormalizedGuardConfig['checks']['designTokens'],
): GuardReportItem[] {
  const filename = file.path.replace(/\\/g, '/')
  if (!check.enabled || file.binary || !/\.(?:css|scss|less|vue|tsx|jsx|ts|js|astro|svelte)$/i.test(filename)) return []
  if (/(?:^|\/)(?:__tests__|__fixtures__|tests?|fixtures?)(?:\/|$)|\.(?:test|spec|fixture)\./i.test(filename)) return []
  // 小型、可移植的 glob 子集，**/ 同时匹配根目录和任意层级。
  for (const glob of check.tokenFiles) {
    let pattern = ''
    for (let i = 0; i < glob.length; i++) {
      const char = glob[i]
      if (char === '*' && glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') { pattern += '(?:.*/)?'; i++ }
        else pattern += '.*'
      } else if (char === '*') pattern += '[^/]*'
      else if (char === '?') pattern += '[^/]'
      else pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    if (new RegExp('^' + pattern + '$', 'i').test(filename)) return []
  }
  const added = new Set(file.addedLines.map((line) => line.line))
  const allowed = new Set(check.allowValues.map((value) => value.trim().toLowerCase()))
  const items: GuardReportItem[] = []
  let blockEnd = ''
  let quote = ''
  const lines = file.content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    let text = ''
    for (let i = 0; i < line.length; i++) {
      if (blockEnd) {
        if (line.startsWith(blockEnd, i)) { i += blockEnd.length - 1; blockEnd = '' }
      } else if (quote) {
        text += line[i]
        if (line[i] === '\\') { text += line[++i] ?? '' }
        else if (line[i] === quote) quote = ''
      } else if (line.startsWith('/*', i)) { blockEnd = '*/'; i++ }
      else if (line.startsWith('<!--', i)) { blockEnd = '-->'; i += 3 }
      else if (line.startsWith('//', i)) break
      else {
        text += line[i]
        if (/['"`]/.test(line[i])) quote = line[i]
      }
    }
    if (!added.has(index + 1)) continue
    // 删除自定义属性声明本身，保留同一行其余普通声明。
    text = text.replace(/(?:['"])?--[\w-]+(?:['"])?\s*:\s*[^;}]+/g, '')
    const colors = text.match(/#[\da-f]{8}(?![\w-])|#[\da-f]{6}(?![\w-])|#[\da-f]{4}(?![\w-])|#[\da-f]{3}(?![\w-])|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[+\-.\d][^)]*\)|\bcolor\(\s*[a-z][\w-]*\s+[+\-.\d][^)]*\)/gi) ?? []
    if (colors.some((value) => !allowed.has(value.trim().toLowerCase()))) {
      items.push({ check: 'designTokens', severity: check.severity, file: file.path, line: index + 1, message: '硬编码颜色，应使用项目 tokens（见 DESIGN.md）' })
    }
  }
  return items
}
