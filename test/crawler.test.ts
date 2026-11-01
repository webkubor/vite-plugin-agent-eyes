/**
 * 爬虫 / AI 可读性体检测试（§crawler）
 * 路由：无
 * API：验证 robots、sitemap、llms.txt 与 index.html 元信息的识别与建议。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
import { inspectCrawler } from '../src/crawler'

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-crawler-'))
  roots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return root
}

describe('inspectCrawler', () => {
  it('detects robots with sitemap reference, valid sitemap and llms.txt', () => {
    const root = fixture({
      'public/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n',
      'public/sitemap.xml': '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>',
      'public/llms.txt': '# Site\n> 说明',
      'index.html': '<html><head><title>Demo</title><link rel="canonical" href="/" /></head></html>',
    })
    const result = inspectCrawler(root)
    expect(result.robots).toMatchObject({ file: 'public/robots.txt', sitemapRefs: ['https://example.com/sitemap.xml'], disallowAll: false })
    expect(result.sitemap).toMatchObject({ file: 'public/sitemap.xml', valid: true, urlCount: 1 })
    expect(result.llms.file).toBe('public/llms.txt')
    expect(result.indexHtml).toMatchObject({ noindex: false, hasCanonical: true, hasTitle: true })
    expect(result.suggestions).toEqual([])
  })

  it('flags noindex, disallow all and robots without sitemap reference', () => {
    const root = fixture({
      'public/robots.txt': 'User-agent: *\nDisallow: /\n',
      'public/sitemap.xml': '<urlset><url><loc>/</loc></url></urlset>',
      'index.html': '<html><head><meta name="robots" content="noindex,nofollow" /><title>Demo</title></head></html>',
    })
    const result = inspectCrawler(root)
    expect(result.robots.disallowAll).toBe(true)
    expect(result.indexHtml.noindex).toBe(true)
    expect(result.suggestions.join('\n')).toContain('noindex')
    expect(result.suggestions.join('\n')).toContain('未声明可识别的 Sitemap')
    expect(result.suggestions.join('\n')).toContain('llms.txt')
  })

  it('suggests robots and sitemap for a website without them, and rejects invalid sitemap', () => {
    const root = fixture({ 'index.html': '<html><head><title>Demo</title></head></html>' })
    expect(inspectCrawler(root).suggestions.join('\n')).toContain('robots.txt / sitemap.xml')

    const invalid = fixture({ 'public/sitemap.xml': '<html>not a sitemap</html>' })
    const result = inspectCrawler(invalid)
    expect(result.sitemap.valid).toBe(false)
    expect(result.suggestions.join('\n')).toContain('未识别到 urlset')
  })

  it.each(['assets', 'absolute'])('respects custom publicDir: %s', (mode) => {
    const root = fixture({
      'assets/robots.txt': 'User-agent: *\nDisallow: /',
      'assets/sitemap_index.xml': '<sitemapindex/>',
      'public/robots.txt': 'User-agent: *\nAllow: /',
    })
    const result = inspectCrawler(root, { publicDir: mode === 'absolute' ? path.join(root, 'assets') : 'assets' })
    expect(result.robots).toMatchObject({ file: 'assets/robots.txt', deployment: 'public', status: 'present', disallowAll: true })
    expect(result.sitemap).toMatchObject({ file: 'assets/sitemap_index.xml', valid: true })
  })

  it('does not scan default public when disabled and distinguishes root source', () => {
    const root = fixture({ 'public/robots.txt': 'User-agent: *\nDisallow: /', 'robots.txt': 'User-agent: *\nAllow: /' })
    expect(inspectCrawler(root, { publicDir: false }).robots).toMatchObject({ file: 'robots.txt', deployment: 'root-source', disallowAll: false })
    fs.unlinkSync(path.join(root, 'robots.txt'))
    const result = inspectCrawler(root, { publicDir: false })
    expect(result.robots).toMatchObject({ file: null, status: 'missing', deployment: 'disabled' })
    expect(result.limitations.join(' ')).toContain('未扫描默认 public')
  })

  it.each([
    ['User-agent: SpecialBot\nDisallow: /\nUser-agent: *\nAllow: /', false],
    ['User-agent: SpecialBot\nDisallow: /', false],
    ['Disallow: /', false],
    ['User-agent: *\nDisallow: /\nAllow: /private', true],
    ['User-agent: *\nDisallow: /\nAllow: /', false],
    ['User-agent: Other\nUser-agent: *\nDisallow: /\nUser-agent: Bot\nAllow: /', true],
  ])('handles robots groups: %s', (text, expected) => {
    const root = fixture({ 'public/robots.txt': text })
    expect(inspectCrawler(root).robots.disallowAll).toBe(expected)
  })

  it('recognizes reordered quoted meta attributes and googlebot noindex', () => {
    const root = fixture({ 'index.html': `<title class='x'>Demo</title>
      <meta content='nofollow, NOINDEX' data-x="a" name='Googlebot'>
      <link href='/home' data-x='x' rel="canonical">` })
    expect(inspectCrawler(root).indexHtml).toMatchObject({ noindex: true, hasCanonical: true, hasTitle: true })
  })

  it('does not treat nested sitemap nodes as a recognized root or claim XML validation', () => {
    const root = fixture({ 'public/sitemap.xml': '<html><urlset/></html>' })
    expect(inspectCrawler(root).sitemap.valid).toBe(false)
    fs.writeFileSync(path.join(root, 'public/sitemap.xml'), '<urlset><broken>')
    expect(inspectCrawler(root).sitemap.valid).toBe(true)
  })

  it('supports hyphenated sitemap indexes', () => {
    const root = fixture({ 'public/sitemap-index.xml': '<sitemapindex/>' })
    expect(inspectCrawler(root).sitemap.valid).toBe(true)
  })

  it('removes credentials, query and fragment from sitemap references without fetching', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const root = fixture({ 'public/robots.txt': 'Sitemap: https://user:password@example.com/map.xml?token=secret#x\nSitemap: /map.xml?key=secret\nSitemap: invalid?secret' })
    const result = inspectCrawler(root)
    expect(result.robots.sitemapRefs).toEqual(['https://example.com/map.xml', '/map.xml'])
    expect(JSON.stringify(result)).not.toMatch(/password|token=secret|key=secret|invalid\?secret/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('limits every file to 256 KiB and reports unknown instead of missing', () => {
    const root = fixture({
      'public/robots.txt': 'x'.repeat(256 * 1024 + 1),
      'public/sitemap.xml': 'x'.repeat(256 * 1024 + 1),
      'public/llms.txt': 'x'.repeat(256 * 1024 + 1),
      'index.html': 'x'.repeat(256 * 1024 + 1),
    })
    const result = inspectCrawler(root)
    for (const item of [result.robots, result.sitemap, result.llms, result.indexHtml]) expect(item.status).toBe('unknown')
    expect(result.limitations).toHaveLength(4)
    expect(result.suggestions).toEqual([])
    fs.writeFileSync(path.join(root, 'public/robots.txt'), ' '.repeat(256 * 1024))
    expect(inspectCrawler(root).robots.status).toBe('present')
  })

  it('does not follow file or public directory symbolic links', () => {
    const root = fixture({ 'target/robots.txt': 'User-agent: *\nDisallow: /' })
    fs.symlinkSync(path.join(root, 'target'), path.join(root, 'public'))
    expect(inspectCrawler(root).robots.status).toBe('unknown')
    fs.symlinkSync(path.join(root, 'target/robots.txt'), path.join(root, 'robots.txt'))
    expect(inspectCrawler(root, { publicDir: false }).robots.status).toBe('unknown')
  })

  it('reports read errors without declaring missing assets', () => {
    const root = fixture({ 'public/robots.txt': 'User-agent: *\nDisallow: /', 'index.html': '<title>Demo</title>' })
    vi.spyOn(fs, 'openSync').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) })
    const result = inspectCrawler(root)
    expect(result.robots.status).toBe('unknown')
    expect(result.limitations.join(' ')).toContain('EACCES')
    expect(result.suggestions.join(' ')).not.toContain('未发现 robots')
  })

  it('stays quiet for non-website projects without index.html', () => {
    const root = fixture({ 'package.json': '{"name":"lib"}' })
    const result = inspectCrawler(root)
    expect(result.robots.file).toBeNull()
    expect(result.sitemap.file).toBeNull()
    expect(result.llms.file).toBeNull()
    expect(result.indexHtml.file).toBeNull()
    expect(result.suggestions).toEqual([])
  })
})
