/** 本地 dev 可视化面板：爬虫配置与当前页面截图能力。只读取本项目，不导航其他标签页。 */
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { inspectCrawler } from './crawler'
import { captureScreenshot, inspectBrowserCapability } from './cdp'

export interface AgentVisualOptions {
  enabled?: boolean
  logDir?: string
  /** 关闭截图时面板只展示状态。 */
  screenshots?: boolean
}

const PANEL = '/__agent-eyes'
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** 默认入口集成的本地可视化面板与截图接口。 */
export function agentVisual(options: AgentVisualOptions = {}): Plugin {
  let port: number | string = 'middleware'
  let root = ''
  return {
    name: 'vite-plugin-agent-eyes-visual',
    apply: 'serve',
    transformIndexHtml() {
      if (options.enabled === false) return []
      // 新窗口打开仪表盘，URL 只带 origin + pathname，无 query/hash。
      return [{ tag: 'script', attrs: { type: 'module' }, injectTo: 'body', children: `
const link=document.createElement('a');link.textContent='◉ Agent Eyes';
link.href=${JSON.stringify(PANEL)}+'?page='+encodeURIComponent(location.origin+location.pathname);
link.target='_blank';link.rel='noopener';link.title='爬虫配置 · 当前路由截图';
link.style.cssText='position:fixed;bottom:14px;right:14px;z-index:2147483646;padding:9px 14px;background:#0f172a;color:#a5f3fc;border:1px solid #0e7490;border-radius:20px;font:12px system-ui;text-decoration:none;box-shadow:0 4px 16px #0003';
link.addEventListener('click',()=>{link.href=${JSON.stringify(PANEL)}+'?page='+encodeURIComponent(location.origin+location.pathname)});
document.body.appendChild(link);` }]
    },
    configureServer(server) {
      if (options.enabled === false) return
      root = server.config.root
      const address = () => {
        const value = server.httpServer?.address()
        port = value && typeof value === 'object' ? value.port : server.config.server.port ?? 'middleware'
      }
      server.httpServer?.once('listening', address)
      const snapshotDir = () => path.resolve(root, options.logDir ?? 'log', String(port), 'snapshots')
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname !== PANEL && !url.pathname.startsWith(`${PANEL}/`)) return next()
        address()
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        const json = (status: number, value: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(value))
        }
        const host = req.headers.host ?? ''
        // 仅本源页面可触发 CDP；Origin 缺失的命令行调用仍需显式本项目 page 地址。
        if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) return json(403, { error: 'Origin mismatch' })
        let pageUrl: string | undefined
        try {
          const candidate = new URL(url.searchParams.get('page') ?? '')
          if (candidate.host === host && /^https?:$/.test(candidate.protocol) && !candidate.pathname.startsWith(PANEL)) pageUrl = `${candidate.origin}${candidate.pathname}`
        } catch { /* UI 会要求从页面入口打开。 */ }
        if (url.pathname === `${PANEL}/status` && req.method === 'GET') {
          const crawler = inspectCrawler(root, { publicDir: server.config.publicDir })
          const browser = pageUrl ? await inspectBrowserCapability(pageUrl) : { available: false, engine: 'unknown', reason: '请从项目页面右下角打开面板', matchingPage: false }
          let snapshots: unknown = []
          try { snapshots = JSON.parse(fs.readFileSync(path.join(snapshotDir(), 'index.json'), 'utf8')) } catch { /* 尚无截图 */ }
          return json(200, { project: path.basename(root), mode: server.config.mode, route: pageUrl ? new URL(pageUrl).pathname : null, crawler, browser, screenshotsEnabled: options.screenshots !== false, snapshots })
        }
        if (url.pathname === `${PANEL}/capture`) {
          if (req.method !== 'POST') return json(405, { error: 'Use POST' })
          if (options.screenshots === false) return json(409, { error: '截图已显式关闭' })
          if (!pageUrl) return json(400, { error: '缺少本项目页面地址' })
          const file = await captureScreenshot(snapshotDir(), { pageUrl, project: path.basename(root), reason: 'manual' })
          return json(file ? 200 : 409, file ? { file: path.basename(file) } : { error: '截图不可用、目标不匹配或正在冷却；检查浏览器 CDP 状态' })
        }
        if (url.pathname.startsWith(`${PANEL}/image/`) && req.method === 'GET') {
          const name = url.pathname.slice(`${PANEL}/image/`.length)
          if (!/^[\w.-]+\.png$/.test(name)) return json(400, { error: 'Invalid image' })
          try {
            const file = path.join(snapshotDir(), name)
            if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('invalid')
            res.setHeader('Content-Type', 'image/png')
            res.end(fs.readFileSync(file))
          } catch { json(404, { error: 'Image not found' }) }
          return
        }
        if (url.pathname !== PANEL || req.method !== 'GET') return json(404, { error: 'Not found' })
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(panelHtml(path.basename(root), pageUrl))
      })
    },
  }
}

function panelHtml(project: string, pageUrl?: string): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Eyes · ${escapeHtml(project)}</title>
<style>body{margin:0;background:#0b1220;color:#e2e8f0;font:15px/1.65 system-ui}main{max-width:1000px;margin:44px auto;padding:0 24px}h1{font-size:30px}h2{font-size:18px;color:#a5f3fc}section{background:#111c30;border:1px solid #24334b;border-radius:16px;padding:22px;margin:18px 0}button{background:#0891b2;color:white;border:0;border-radius:9px;padding:11px 18px;cursor:pointer}button:disabled{opacity:.45}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;color:#b6c8de}img{max-width:100%;border-radius:10px}a{color:#67e8f9}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.card{background:#0b1526;padding:14px;border-radius:10px}.muted{color:#94a3b8}</style>
<main><p class="muted">LOCAL DEVELOPMENT · AGENT EYES</p><h1>${escapeHtml(project)} · 页面视野</h1><p id="route"></p>
<section><h2>浏览器与截图能力</h2><pre id="browser">检测中…</pre><button id="capture" disabled>截取当前路由 · 带项目标记</button><p id="message" role="status"></p><div id="preview"></div></section>
<section><h2>爬虫配置探测</h2><div id="crawler" class="grid"></div><p class="muted">这是本地源码探测；文件存在不代表线上可访问、搜索引擎或 AI 已收录。</p><pre id="suggestions"></pre></section>
<section><h2>截图索引</h2><pre id="index"></pre></section></main>
<script type="module">
const page=${JSON.stringify(pageUrl ?? '').replace(/</g, '\\u003c')};const query='?page='+encodeURIComponent(page);
const el=id=>document.getElementById(id);const show=async()=>{const r=await fetch('${PANEL}/status'+query);const d=await r.json();
el('route').textContent='项目 '+d.project+' · 环境 '+d.mode+' · 路由 '+(d.route||'未指定');
const ua=navigator.userAgent;const kernel=/Firefox\\//.test(ua)?'Gecko':/Chrome\\/|Chromium\\/|Edg\\//.test(ua)?'Chromium':/AppleWebKit\\//.test(ua)?'WebKit':'unknown';
el('browser').textContent='当前面板浏览器内核（UA 推断）：'+kernel+'\\nCDP 实测：'+JSON.stringify(d.browser,null,2);el('capture').disabled=!d.browser.available||!d.screenshotsEnabled;
el('crawler').replaceChildren();for(const [name,value] of Object.entries(d.crawler)){if(name==='suggestions'||name==='limitations')continue;const card=document.createElement('div');card.className='card';const title=document.createElement('strong');title.textContent=name;const pre=document.createElement('pre');pre.textContent=JSON.stringify(value,null,2);card.append(title,pre);el('crawler').append(card)}
el('suggestions').textContent=[...(d.crawler.suggestions||[]),...(d.crawler.limitations||[])].join('\\n');el('index').textContent=JSON.stringify(d.snapshots,null,2)};
el('capture').onclick=async()=>{el('capture').disabled=true;el('message').textContent='正在截图…';try{const r=await fetch('${PANEL}/capture'+query,{method:'POST'});const d=await r.json();el('message').textContent=d.error||'截图已保存 · '+d.file;if(d.file){const img=document.createElement('img');img.alt='当前路由截图';img.src='${PANEL}/image/'+encodeURIComponent(d.file);el('preview').replaceChildren(img)}}catch{el('message').textContent='截图请求失败'}finally{await show()}};
show().catch(()=>{el('browser').textContent='状态读取失败'});
</script></html>`
}
