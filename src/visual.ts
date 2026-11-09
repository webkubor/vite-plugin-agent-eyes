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
          const browser = pageUrl ? await inspectBrowserCapability(pageUrl) : { available: false, engine: 'unknown' as const, reason: '请从项目页面右下角打开面板', matchingPage: false }
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

/**
 * 面板 HTML。
 *
 * 2026-11-09 重写（owner 2026-11-04 反馈「页面太丑」）。改动的三件事：
 *
 * 1. **状态先行**：原先浏览器能力是一坨 `pre` 里的裸 JSON，看不出「能不能截图」。
 *    现在首屏是一行状态徽章（可截图/不可截图 + 一句人话原因 + 下一步），
 *    明细 JSON 收进可展开的 `<details>`，需要时再看。
 * 2. **原因说人话**：CDP 的 reason 是英文（'CDP unavailable' / 'No unique matching
 *    CDP page with websocket'）。面板按 reason 映射成中文并给出下一步，
 *    英文原文保留在展开区里，方便排查。
 * 3. **爬虫配置分列**：robots / sitemap / llms / index.html 四项各自成卡，
 *    直接给「文件 / 状态 / 部署位置」，不再把整个对象 JSON 化。
 *
 * 契约（不可破坏）：`/status`、`/capture`、`/image/*` 的路径与响应形状不变；
 * 同源校验与文件路径保护不变；服务端日志脱敏不受影响。
 * 所有外部数据一律 textContent 注入，不拼 HTML 字符串。
 */
function panelHtml(project: string, pageUrl?: string): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Eyes · ${escapeHtml(project)}</title>
<style>
:root{--bg:#0b1220;--surface:#111c30;--surface-2:#0b1526;--line:#24334b;--text:#e2e8f0;--muted:#94a3b8;--accent:#67e8f9;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:32px 24px 64px}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;margin-bottom:6px}
h1{font-size:26px;margin:0;font-weight:650;letter-spacing:.2px}
h2{font-size:15px;margin:0;font-weight:600;color:var(--accent);letter-spacing:.3px}
.eyebrow{font-size:11px;letter-spacing:.14em;color:var(--muted);text-transform:uppercase;margin:0 0 4px}
.sub{color:var(--muted);font-size:13px;margin:0 0 24px}
.sub b{color:var(--text);font-weight:600}
section{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}
.sec-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
.badge.ok{color:var(--ok);background:#052e16;border-color:#14532d}
.badge.warn{color:var(--warn);background:#3b2606;border-color:#78350f}
.badge.bad{color:var(--bad);background:#3b0d0d;border-color:#7f1d1d}
.badge.idle{color:var(--muted);background:#1e293b;border-color:#334155}
.dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.hint{color:var(--muted);font-size:13px;margin:10px 0 0}
.hint code{background:var(--surface-2);border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:12px;color:var(--accent)}
button{background:#0891b2;color:#fff;border:0;border-radius:9px;padding:10px 16px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s,opacity .15s}
button:hover:not(:disabled){background:#06b6d4}
button:disabled{opacity:.4;cursor:not-allowed}
button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.msg{font-size:13px;margin:12px 0 0;min-height:1.4em}
.msg.ok{color:var(--ok)}
.msg.bad{color:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px;align-items:start}
.card{background:var(--surface-2);border:1px solid var(--line);border-radius:11px;padding:14px}
.card h3{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:8px}
.kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;font-size:12.5px;padding:3px 0;color:var(--muted)}
.kv span:first-child{white-space:nowrap}
.kv span:last-child{color:var(--text);text-align:right;overflow-wrap:anywhere}
details{margin-top:12px;border:1px solid var(--line);border-radius:9px;background:var(--surface-2);overflow:hidden}
summary{cursor:pointer;padding:9px 13px;font-size:12.5px;color:var(--muted);user-select:none;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸ ";color:var(--accent)}
details[open] summary::before{content:"▾ "}
pre{margin:0;padding:13px;border-top:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:#b6c8de;max-height:340px;overflow:auto}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.shot{background:var(--surface-2);border:1px solid var(--line);border-radius:11px;overflow:hidden;display:flex;flex-direction:column}
.shot img{width:100%;display:block;aspect-ratio:16/10;object-fit:contain;object-position:top;background:#020617}
.shot figcaption{padding:9px 11px;font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:2px}
.shot figcaption b{color:var(--text);font-weight:600;overflow-wrap:anywhere}
.preview{margin-top:14px;border:1px solid var(--line);border-radius:11px;overflow:hidden;background:var(--surface-2)}
.preview img{width:100%;display:block;max-height:520px;object-fit:contain;object-position:top;background:#020617}
.empty{color:var(--muted);font-size:13px;padding:18px;text-align:center;border:1px dashed var(--line);border-radius:11px}
.notice{border-left:3px solid var(--warn);background:#3b260633;padding:10px 13px;border-radius:0 8px 8px 0;font-size:13px;color:#fde68a;margin-top:12px}
@media (max-width:520px){main{padding:20px 16px 48px}h1{font-size:21px}.sec-head{flex-direction:column;align-items:flex-start;gap:8px}}
</style>
<main>
<p class="eyebrow">Local development · Agent Eyes</p>
<header><h1>${escapeHtml(project)}</h1></header>
<p class="sub" id="route">正在读取项目状态…</p>

<section>
  <div class="sec-head"><h2>浏览器与截图能力</h2><span class="badge idle" id="browserBadge"><span class="dot"></span>检测中</span></div>
  <div id="browserWhy"></div>
  <div class="actions" style="margin-top:14px">
    <button id="capture" disabled>截取当前路由</button>
    <span class="hint" id="captureNote" style="margin:0"></span>
  </div>
  <p class="msg" id="message" role="status" aria-live="polite"></p>
  <div class="preview" id="preview" hidden></div>
  <details><summary>原始状态数据</summary><pre id="browser"></pre></details>
</section>

<section>
  <div class="sec-head"><h2>爬虫与 AI 可读性配置</h2><span class="badge idle" id="crawlerBadge"><span class="dot"></span>检测中</span></div>
  <div class="grid" id="crawler"></div>
  <div id="crawlerNotes"></div>
  <details><summary>原始探测数据</summary><pre id="crawlerRaw"></pre></details>
</section>

<section>
  <div class="sec-head"><h2>截图索引</h2><span class="badge idle" id="shotBadge"><span class="dot"></span>—</span></div>
  <div id="shots"></div>
  <details><summary>原始索引数据</summary><pre id="index"></pre></details>
</section>
</main>
<script type="module">
const page=${JSON.stringify(pageUrl ?? '').replace(/</g, '\\u003c')};const query='?page='+encodeURIComponent(page);
const el=id=>document.getElementById(id);
const setBadge=(id,kind,text)=>{const b=el(id);b.className='badge '+kind;b.innerHTML='';const d=document.createElement('span');d.className='dot';const t=document.createElement('span');t.textContent=text;b.append(d,t)};
const clear=(id)=>{el(id).replaceChildren()};
const kv=(card,label,value)=>{const row=document.createElement('div');row.className='kv';const k=document.createElement('span');k.textContent=label;const v=document.createElement('span');v.textContent=value;row.append(k,v);card.append(row)};

// CDP 的 reason 是英文面向开发者，这里映射成中文并给下一步；英文原文保留在展开区。
const BROWSER_WHY={
  'CDP unavailable':['浏览器没有开放调试端口，无法截图','用带调试端口启动浏览器后重试（如 --remote-debugging-port）'],
  'No unique matching CDP page with websocket':['没找到与当前路由匹配的调试页','确认页面已打开，且浏览器带调试端口；多个同名页时只留当前项目这一个'],
  'Please open the panel from the project page':['请从项目页面右下角的入口打开面板','面板需要知道要截取哪个路由'],
  '请从项目页面右下角打开面板':['请从项目页面右下角的入口打开面板','面板需要知道要截取哪个路由']
};
const why=(reason)=>{
  const hit=BROWSER_WHY[reason]||BROWSER_WHY[Object.keys(BROWSER_WHY).find(k=>reason&&reason.includes(k))||''];
  return hit||['当前无法确认截图能力','展开下方原始数据查看英文原因'];
};

const show=async()=>{
  const r=await fetch('${PANEL}/status'+query);
  if(!r.ok) throw new Error('status '+r.status);
  const d=await r.json();
  el('route').textContent='';
  el('route').append('环境 ',Object.assign(document.createElement('b'),{textContent:d.mode}),' · 路由 ',Object.assign(document.createElement('b'),{textContent:d.route||'未指定'}));

  // 浏览器与截图
  const b=d.browser||{};
  if(d.screenshotsEnabled===false){setBadge('browserBadge','idle','截图已关闭');}
  else if(b.available){setBadge('browserBadge','ok','可截图');}
  else{setBadge('browserBadge','bad','不可截图');}
  clear('browserWhy');
  if(d.screenshotsEnabled===false){
    const p=document.createElement('p');p.className='hint';p.textContent='当前插件配置显式关闭了截图（screenshots: false），面板只展示状态。';el('browserWhy').append(p);
  }else if(!b.available){
    const [what,next]=why(b.reason||'');
    const p=document.createElement('p');p.className='hint';p.textContent=what;
    const n=document.createElement('p');n.className='hint';n.append('下一步：',Object.assign(document.createElement('code'),{textContent:next}));
    el('browserWhy').append(p,n);
  }else{
    const p=document.createElement('p');p.className='hint';p.textContent='已连接 '+(b.browser||'浏览器')+'（'+(b.engine||'unknown')+'），可截取当前路由。';el('browserWhy').append(p);
  }
  el('capture').disabled=!(b.available&&d.screenshotsEnabled!==false);
  el('captureNote').textContent=b.available?'将标记项目与路由':'';
  el('browser').textContent=JSON.stringify(d.browser,null,2);

  // 爬虫配置
  const c=d.crawler||{};
  const items=[['robots','robots.txt'],['sitemap','sitemap.xml'],['llms','llms.txt'],['indexHtml','index.html']];
  clear('crawler');
  let missing=0,present=0,unknown=0;
  for(const [key,label] of items){
    const item=c[key]||{};
    const card=document.createElement('div');card.className='card';
    const h=document.createElement('h3');
    const name=document.createElement('span');name.textContent=label;
    const st=document.createElement('span');
    const kind=item.status==='present'?'ok':item.status==='missing'?'bad':'warn';
    st.className='badge '+kind;
    st.style.fontSize='11px';st.style.padding='2px 8px';
    st.textContent=item.status==='present'?'已发现':item.status==='missing'?'未找到':'未知';
    h.append(name,st);card.append(h);
    kv(card,'文件',item.file||'—');
    kv(card,'部署位置',item.deployment==='public'?'public（静态候选）':item.deployment==='root-source'?'root-source（源码根）':item.deployment==='disabled'?'disabled（已禁用）':'—');
    if(item.noindex===true)kv(card,'noindex','是');
    if(item.hasTitle===false)kv(card,'title','缺失');
    if(item.hasCanonical===false)kv(card,'canonical','缺失');
    if(item.urlCount!=null)kv(card,'URL 数',String(item.urlCount));
    el('crawler').append(card);
    if(item.status==='present')present++;else if(item.status==='missing')missing++;else unknown++;
  }
  if(present===4)setBadge('crawlerBadge','ok','4/4 已就绪');
  else if(missing)setBadge('crawlerBadge','warn',present+'/4 已就绪');
  else setBadge('crawlerBadge','warn','部分未知');
  clear('crawlerNotes');
  const notes=[...(c.suggestions||[]),...(c.limitations||[])];
  if(notes.length){
    const box=document.createElement('div');box.className='notice';
    const ul=document.createElement('ul');ul.style.margin='0';ul.style.paddingLeft='18px';
    for(const n of notes){const li=document.createElement('li');li.textContent=n;li.style.margin='4px 0';ul.append(li)}
    box.append(ul);el('crawlerNotes').append(box);
  }else{
    const p=document.createElement('p');p.className='hint';p.textContent='未发现需要处理的配置项。';el('crawlerNotes').append(p);
  }
  el('crawlerRaw').textContent=JSON.stringify(c,null,2);

  // 截图索引
  const snaps=Array.isArray(d.snapshots)?d.snapshots:[];
  clear('shots');
  if(snaps.length){
    setBadge('shotBadge','ok',snaps.length+' 张');
    const grid=document.createElement('div');grid.className='shots';
    for(const s of snaps){
      const fig=document.createElement('figure');fig.className='shot';fig.style.margin='0';
      const img=document.createElement('img');
      img.loading='lazy';
      img.alt='截图 '+(s.pathname||'');
      img.src='${PANEL}/image/'+encodeURIComponent(s.file||'');
      img.addEventListener('error',()=>{img.replaceWith(Object.assign(document.createElement('div'),{className:'empty',textContent:'图片不可用'}))});
      const cap=document.createElement('figcaption');
      const b=document.createElement('b');b.textContent=s.pathname||s.file||'';
      const t=document.createElement('span');t.textContent=(s.time||'').replace('T',' ').slice(0,19);
      cap.append(b,t);
      fig.append(img,cap);grid.append(fig);
    }
    el('shots').append(grid);
  }else{
    setBadge('shotBadge','idle','暂无截图');
    const p=document.createElement('div');p.className='empty';p.textContent='还没有截图。连接浏览器后点上方「截取当前路由」。';el('shots').append(p);
  }
  el('index').textContent=JSON.stringify(d.snapshots,null,2);
};
el('capture').onclick=async()=>{el('capture').disabled=true;el('message').textContent='正在截图…';el('message').className='msg';
  try{const r=await fetch('${PANEL}/capture'+query,{method:'POST'});const d=await r.json();
    if(d.error){el('message').textContent=d.error;el('message').className='msg bad'}
    else{el('message').textContent='截图已保存 · '+d.file;el('message').className='msg ok';
      const box=el('preview');box.hidden=false;clear('preview');
      const img=document.createElement('img');img.alt='当前路由截图';img.src='${PANEL}/image/'+encodeURIComponent(d.file);box.append(img)}
  }catch{el('message').textContent='截图请求失败';el('message').className='msg bad'}
  finally{await show()}};
show().catch(()=>{setBadge('browserBadge','bad','状态读取失败');el('message').textContent='无法读取面板状态，确认 dev server 仍在运行。';el('message').className='msg bad'});
</script></html>`
}
