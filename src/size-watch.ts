/**
 * agentSizeWatch —— dev 期实时文件体积/行数看门狗（§agentSizeWatch）
 * 路由：无
 * API：无；dev 启动扫一遍源文件，热更新时增量检查，超阈值在控制台 warn。
 *
 * 与 commit 期的 agentGuard 互补：guard 在提交时阻断，sizeWatch 在写代码当下就提示，
 * 让"AI 把 CSS 堆成超长屎山文件"在早期就被看见。只 warn，不阻断、不影响 build。
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { lineCount } from './guard-core'
import { DEFAULT_CSS_LENGTH_WARN, DEFAULT_FILE_LENGTH_WARN } from './guard-types'

const DEFAULT_INCLUDE = /\.(?:ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|css|scss|sass|less)$/
const DEFAULT_EXCLUDE = /(?:^|[\\/])(?:node_modules|dist|build|\.git|\.astro|\.next|\.nuxt|coverage|log)(?:[\\/]|$)/
const CSS_EXT = /\.(?:css|scss|sass|less)$/
// guard-core 跳过二进制看 NUL 字节；这里只处理文本源文件，按扩展名已足够，超大文件直接跳过。
const MAX_BYTES = 1024 * 1024

/** agentSizeWatch 用户配置。 */
export interface AgentSizeWatchOptions {
  /** 是否启用，默认 true。 */
  enabled?: boolean
  /** 通用源码（ts/tsx/js/vue/astro…）行数警告阈值，默认 400。 */
  warn?: number
  /** CSS/SCSS/Less 行数警告阈值，默认 300（更严）。 */
  cssWarn?: number
  /** 纳入扫描的文件，默认常见源码 + 样式扩展名。 */
  include?: RegExp
  /** 排除的路径（相对项目根匹配），默认 node_modules/dist/.git/.astro 等。 */
  exclude?: RegExp
}

function loggerPrefix(): string {
  return '\x1b[33m[agent-eyes:size]\x1b[0m'
}

function thresholdFor(rel: string, warn: number, cssWarn: number): number {
  return CSS_EXT.test(rel) ? cssWarn : warn
}

/** 检查单个文件，超阈值返回 warn 文本，否则 null。读不了/非文本/超大直接跳过。 */
function checkFile(abs: string, rel: string, warn: number, cssWarn: number): string | null {
  let content: string
  try {
    const stat = fs.statSync(abs)
    if (!stat.isFile() || stat.size > MAX_BYTES) return null
    content = fs.readFileSync(abs, 'utf8')
  } catch {
    return null
  }
  if (content.includes('\0')) return null
  const lines = lineCount(content)
  const limit = thresholdFor(rel, warn, cssWarn)
  if (lines < limit) return null
  const kind = CSS_EXT.test(rel) ? 'CSS' : '源码'
  return `${rel} 已 ${lines} 行（${kind}警告阈值 ${limit}）—— 建议拆分`
}

/** 递归收集 root 下符合 include 且不被 exclude 命中的文件绝对路径。 */
function collectFiles(root: string, include: RegExp, exclude: RegExp): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      const rel = path.relative(root, abs)
      if (exclude.test(rel)) continue
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile() && include.test(entry.name)) out.push(abs)
    }
  }
  walk(root)
  return out
}

/**
 * agentSizeWatch —— dev 期文件体积/行数实时看门狗。
 *
 * dev 启动时扫一遍源文件，并在热更新（文件保存）时增量检查改动文件，超过行数阈值就在 Vite
 * 控制台以 `[agent-eyes:size]` 黄色前缀 warn。**只在 serve 生效，只 warn 不阻断**，不影响 build。
 *
 * CSS/SCSS/Less 用更严的阈值（默认 300），其它源码用通用阈值（默认 400），均可在选项覆盖。
 *
 * @example
 * ```ts
 * import { defineConfig } from 'vite'
 * import { agentSizeWatch } from 'vite-plugin-agent-eyes'
 *
 * export default defineConfig({
 *   plugins: [agentSizeWatch({ warn: 400, cssWarn: 300 })],
 * })
 * ```
 */
export function agentSizeWatch(options: AgentSizeWatchOptions = {}): Plugin {
  const enabled = options.enabled ?? true
  const warn = options.warn ?? DEFAULT_FILE_LENGTH_WARN
  const cssWarn = options.cssWarn ?? DEFAULT_CSS_LENGTH_WARN
  const include = options.include ?? DEFAULT_INCLUDE
  const exclude = options.exclude ?? DEFAULT_EXCLUDE

  return {
    name: 'vite-plugin-agent-eyes-size-watch',
    apply: 'serve',
    configureServer(server) {
      if (!enabled) return
      const root = server.config.root || process.cwd()
      const log = (message: string) => server.config.logger.warn(`${loggerPrefix()} ${message}`)

      // 启动全量扫一遍：一次性把现有的超长文件全报出来。
      const hits = collectFiles(root, include, exclude)
        .map((abs) => checkFile(abs, path.relative(root, abs), warn, cssWarn))
        .filter((m): m is string => m !== null)
      if (hits.length) {
        log(`dev 启动扫描发现 ${hits.length} 个超长源文件：`)
        hits.forEach((m) => log(`  ${m}`))
      }
    },
    // 热更新增量检查：保存某文件时只查它一个，避免每次保存全量扫。
    handleHotUpdate({ file, server }) {
      if (!enabled) return
      const root = server.config.root || process.cwd()
      const rel = path.relative(root, file)
      if (exclude.test(rel) || !include.test(path.basename(file))) return
      const hit = checkFile(file, rel, warn, cssWarn)
      if (hit) server.config.logger.warn(`${loggerPrefix()} ${hit}`)
    },
  }
}
