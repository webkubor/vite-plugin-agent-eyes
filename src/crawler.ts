/**
 * 爬虫 / AI 可读性体检（§crawler）—— 本地候选文件与入口 HTML 的有限静态识别。
 * 路由：无
 * API：只读，不请求网络；源码候选与 public 配置均不能证明实际部署或收录。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 爬虫体检选项，接受 Vite resolved publicDir。 */
export interface CrawlerInspectionOptions {
  publicDir?: string | false
}

/** 单项探测结果；unknown 时旧布尔字段不能作为否定证据。 */
export interface CrawlerFile {
  file: string | null
  status: 'present' | 'missing' | 'unknown'
  deployment: 'public' | 'root-source' | 'disabled'
}

/** 爬虫 / AI 可读性体检结果，保留原有字段。 */
export interface CrawlerInspection {
  robots: CrawlerFile & {
    /** 已移除凭据、query 与 fragment 的 HTTP(S) Sitemap 地址。 */
    sitemapRefs: string[]
    /** 仅识别 User-agent: * 组中的全站禁止规则。 */
    disallowAll: boolean
  }
  sitemap: CrawlerFile & {
    /** 兼容字段：仅表示识别到 urlset / sitemapindex 根节点，不是 XML 合法校验。 */
    valid: boolean
    urlCount: number | null
  }
  llms: CrawlerFile
  indexHtml: CrawlerFile & {
    noindex: boolean
    hasCanonical: boolean
    hasTitle: boolean
  }
  suggestions: string[]
  limitations: string[]
}

const MAX_FILE_BYTES = 256 * 1024
const SITEMAP_NAMES = ['sitemap.xml', 'sitemap_index.xml', 'sitemap-index.xml']
type Candidate = { absolute: string; deployment: CrawlerFile['deployment'] }
type Scan = CrawlerFile & { text: string | null }

function candidates(root: string, publicDir: string | false, names: string[], entry = false): Candidate[] {
  const source = names.map((name) => ({ absolute: path.resolve(root, name), deployment: 'root-source' as const }))
  const published = publicDir === false ? [] : names.map((name) => ({
    absolute: path.resolve(root, publicDir, name), deployment: 'public' as const,
  }))
  return entry ? [...source, ...published] : [...published, ...source]
}

// 检查候选及其目录，不跟随 publicDir 或嵌套目录中的符号链接。
function checkPath(root: string, absolute: string): void {
  let base = root
  while (path.relative(base, absolute).startsWith(`..${path.sep}`)) base = path.dirname(base)
  if (fs.lstatSync(base).isSymbolicLink()) throw new Error('symbolic-link')
  let current = base
  for (const segment of path.relative(base, absolute).split(path.sep)) {
    current = path.join(current, segment)
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('symbolic-link')
  }
}

function scan(root: string, list: Candidate[], disabled: boolean, limitations: string[]): Scan {
  for (const candidate of list) {
    const file = path.relative(root, candidate.absolute).split(path.sep).join('/')
    let descriptor: number | undefined
    try {
      checkPath(root, candidate.absolute)
      descriptor = fs.openSync(candidate.absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
      const stat = fs.fstatSync(descriptor)
      if (!stat.isFile()) throw new Error('not-regular-file')
      if (stat.size > MAX_FILE_BYTES) throw new Error('over-256KiB')
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
      let size = 0
      while (size < buffer.length) {
        const count = fs.readSync(descriptor, buffer, size, buffer.length - size, null)
        if (!count) break
        size += count
      }
      if (size > MAX_FILE_BYTES) throw new Error('over-256KiB')
      return { file, status: 'present', deployment: candidate.deployment, text: buffer.toString('utf8', 0, size) }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      const reason = code || (error instanceof Error ? error.message : 'read-error')
      limitations.push(`${file} 无法检查（${reason}）；结果为 unknown，不能据此断言缺失。`)
      return { file, status: 'unknown', deployment: candidate.deployment, text: null }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor)
    }
  }
  return { file: null, status: 'missing', deployment: disabled ? 'disabled' : 'public', text: null }
}

function fileResult({ text: _text, ...result }: Scan): CrawlerFile {
  return result
}

function sanitizeSitemap(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    // 相对路径也不保留 query / fragment；其他无法识别的声明不回显。
    return /^\/(?!\/)/.test(value) ? value.split(/[?#]/, 1)[0] : null
  }
}

function inspectRobots(scan: Scan): CrawlerInspection['robots'] {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = []
  let group = { agents: [] as string[], disallow: [] as string[], allow: [] as string[] }
  let hasRules = false
  const sitemapRefs: string[] = []
  for (const line of (scan.text ?? '').split(/\r?\n/)) {
    const match = line.replace(/#.*/, '').match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/)
    if (!match) continue
    const [, rawKey, value] = match
    const key = rawKey.toLowerCase()
    if (key === 'sitemap') {
      const safe = sanitizeSitemap(value)
      if (safe) sitemapRefs.push(safe)
    } else if (key === 'user-agent') {
      if (hasRules) { groups.push(group); group = { agents: [], disallow: [], allow: [] }; hasRules = false }
      group.agents.push(value.toLowerCase())
    } else if (group.agents.length) {
      hasRules = true
      if (key === 'disallow') group.disallow.push(value)
      if (key === 'allow') group.allow.push(value)
    }
  }
  groups.push(group)
  const wildcard = groups.filter((item) => item.agents.includes('*'))
  const disallowAll = wildcard.some((item) => item.disallow.includes('/'))
    && !wildcard.some((item) => item.allow.includes('/'))
  return { ...fileResult(scan), sitemapRefs, disallowAll }
}

function inspectSitemap(scan: Scan): CrawlerInspection['sitemap'] {
  // 有意仅识别根节点：未使用 XML 解析器，不判断嵌套、实体、命名空间或语法合法性。
  const text = (scan.text ?? '').replace(/^\uFEFF/, '').replace(/^\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->)\s*/g, '').trimStart()
  const valid = /^<(?:urlset|sitemapindex)(?=[\s/>])/.test(text)
  return { ...fileResult(scan), valid, urlCount: valid ? (text.match(/<loc\s*>/g) ?? []).length : null }
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map((match) => [match[1].toLowerCase(), match[2] ?? match[3]]))
}

function inspectIndexHtml(scan: Scan): CrawlerInspection['indexHtml'] {
  const text = (scan.text ?? '').replace(/<!--[\s\S]*?-->/g, '')
  const metas = [...text.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)].map((match) => attributes(match[0]))
  const links = [...text.matchAll(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)].map((match) => attributes(match[0]))
  return {
    ...fileResult(scan),
    noindex: metas.some((meta) => ['robots', 'googlebot'].includes(meta.name?.toLowerCase())
      && /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(meta.content ?? '')),
    hasCanonical: links.some((link) => link.rel?.toLowerCase().split(/\s+/).includes('canonical') && Boolean(link.href?.trim())),
    hasTitle: /<title\b[^>]*>\s*[^\s<][\s\S]*?<\/title\s*>/i.test(text),
  }
}

/** 只读扫描本地候选；所有判断均不证明部署、爬虫可达或收录。 */
export function inspectCrawler(root: string, options: CrawlerInspectionOptions = {}): CrawlerInspection {
  root = path.resolve(root)
  const publicDir = options.publicDir ?? 'public'
  const limitations: string[] = []
  const read = (names: string[], entry = false) => scan(root, candidates(root, publicDir, names, entry), publicDir === false, limitations)
  const robots = inspectRobots(read(['robots.txt']))
  const sitemap = inspectSitemap(read(SITEMAP_NAMES))
  const llms = fileResult(read(['llms.txt']))
  const indexHtml = inspectIndexHtml(read(['index.html'], true))
  const suggestions: string[] = []
  if (indexHtml.noindex) suggestions.push(`${indexHtml.file} 声明了 noindex；请确认 robots/googlebot 的索引限制符合预期。`)
  if (robots.status === 'present' && sitemap.status === 'present' && !robots.sitemapRefs.length) {
    suggestions.push(`${robots.file} 未声明可识别的 Sitemap；可配置不含凭据的站点地图公开地址。`)
  }
  if (sitemap.status === 'present' && robots.status === 'missing') suggestions.push(`有 ${sitemap.file} 但本地候选未发现 robots.txt；可补充并声明 Sitemap。`)
  if (indexHtml.status === 'present' && robots.status === 'missing' && sitemap.status === 'missing') {
    suggestions.push('本地候选未发现 robots.txt / sitemap.xml；面向爬虫的站点可考虑补齐。')
  }
  if (sitemap.status === 'present' && !sitemap.valid) suggestions.push(`${sitemap.file} 未识别到 urlset / sitemapindex 根节点结构；请用 XML 解析器进一步检查。`)
  if (indexHtml.status === 'present' && llms.status === 'missing') suggestions.push('本地候选未发现 llms.txt；这是可选的社区约定，不保证 LLM 抓取或收录。')
  if (sitemap.status === 'present') limitations.push('sitemap 仅识别根节点结构，未使用 XML 解析器验证合法性。')
  if (llms.status === 'present') limitations.push('llms.txt 是社区约定，不保证 LLM 抓取或收录。')
  if ([robots, sitemap, llms].some((item) => item.status === 'present' && item.deployment === 'public')) {
    limitations.push('public 表示配置中的静态资源候选，未验证实际部署、网络可达或收录状态。')
  }
  if ([robots, sitemap, llms].some((item) => item.status === 'present' && item.deployment === 'root-source')) {
    limitations.push('根目录文件仅为源码候选，未确认会被复制到部署产物。')
  }
  if (publicDir === false) limitations.push('publicDir 已禁用，未扫描默认 public；根目录候选不代表部署文件。')
  return { robots, sitemap, llms, indexHtml, suggestions, limitations }
}
