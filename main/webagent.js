'use strict';
// v2.5 — guarded web automation for the assistant. Fixed scripts only (the model never sends JS):
// read text/links/media/results, click, fill (never password/card fields), scroll, press Enter.
// Downloads go through the Nyx browser session with robots.txt, type, magic-byte and size checks.
const path = require('path');
const { webContents, session, net } = require('electron');
const { urlLooksPublic, assertPublicUrl } = require('./netguard');

const IMG_MIME = /^image\/(jpeg|png|webp|gif|avif)$/i, VID_MIME = /^video\/(mp4|webm|quicktime)$/i;
const LIM = { image: 30 * 1024 * 1024, video: 250 * 1024 * 1024 };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 NyxCanvas/2.6';
const ROBOTS_UA = 'nyxcanvas';

// ---- robots.txt (cached 1h). Applies to pages we read and files we download.
const robotsCache = new Map();
function parseRobots(txt, ua = ROBOTS_UA) {
  const groups = []; let cur = null, lastUA = false;
  for (let line of String(txt).split(/\r?\n/)) {
    line = line.replace(/#.*/, '').trim(); if (!line) continue;
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line); if (!m) continue; const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastUA = true; continue; }
    lastUA = false; if (!cur) continue;
    if (k === 'allow' || k === 'disallow') cur.rules.push({ allow: k === 'allow', path: v });
  }
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && ua.toLowerCase().includes(a)));
  const pick = mine.length ? mine : groups.filter(g => g.agents.includes('*'));
  return pick.flatMap(g => g.rules);
}
function robotsAllows(rules, p) {
  let best = null;
  for (const r of rules) {
    if (!r.path) { continue; }
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(p) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
async function robots(url, fetcher) {
  const u = new URL(url); const key = u.origin; let c = robotsCache.get(key);
  if (!c || Date.now() - c.at > 3600e3) {
    let rules = [];
    try { const r = await fetcher(key + '/robots.txt', { timeout: 8000 }); if (r.ok) rules = parseRobots(await r.text()); else if (r.status === 401 || r.status === 403) rules = [{ allow: false, path: '/' }]; } catch (e) {}
    c = { at: Date.now(), rules }; robotsCache.set(key, c);
  }
  return robotsAllows(c.rules, u.pathname + u.search);
}

// ---- magic bytes
// streaming/social platforms whose terms forbid downloading their media
const NO_GRAB = /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com|tiktok\.com|tiktokcdn\.com|instagram\.com|cdninstagram\.com|facebook\.com|fbcdn\.net|netflix\.com|nflxvideo\.net|disneyplus\.com|primevideo\.com|twitch\.tv|spotify\.com|onlyfans\.com|vimeocdn\.com)$/i;
function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  if (b.toString('ascii', 4, 8) === 'ftyp') { const brand = b.toString('ascii', 8, 12); if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic'; return /avi[fs]/.test(brand) ? 'image/avif' : /qt/.test(brand) ? 'video/quicktime' : 'video/mp4'; }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  return '';
}
// drops: the image types above + BMP (Windows apps put BMP on drags/clipboard)
const sniffDrop = (b) => { const m = b.length >= 12 ? sniff(b) : ''; if (IMG_MIME.test(m)) return m; if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'; return ''; };
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };

// ---- fixed page scripts
const SCRIPTS = {
  info: () => `({url:location.href,title:document.title})`,
  text: (a) => `(document.body?document.body.innerText:'').slice(0,${Math.min(40000, +a.max || 20000)})`,
  links: () => `[...document.querySelectorAll('a[href]')].filter(a=>/^https?:/.test(a.href)&&a.innerText.trim()).slice(0,200).map(a=>({text:a.innerText.trim().slice(0,140),href:a.href}))`,
  // search results: Bing / DuckDuckGo / Google-like / generic (links whose host differs from the engine)
  results: () => `(()=>{const out=[],seen=new Set(),host=location.hostname;const add=(a,s)=>{let h=a.href;try{const u=new URL(h);if(u.searchParams.get('uddg'))h=decodeURIComponent(u.searchParams.get('uddg'));}catch(e){}if(!/^https?:/.test(h)||seen.has(h))return;try{if(new URL(h).hostname===host&&!/\\/l\\/\\?/.test(a.href))return;}catch(e){return}seen.add(h);out.push({title:(a.innerText||'').trim().slice(0,160),url:h,snippet:(s||'').trim().slice(0,240)})};
    document.querySelectorAll('li.b_algo h2 a, a.result__a, [data-testid=result-title-a], .g a h3, .result a.title, .nyx-result a').forEach(a=>{a=a.closest('a')||a;const box=a.closest('li,.result,.g,article,div');add(a,box&&box.innerText.replace(a.innerText,''));});
    if(!out.length)document.querySelectorAll('main a[href], #content a[href], body a[href]').forEach(a=>{if(a.innerText.trim().length>12)add(a,'')});return out.slice(0,20)})()`,
  // media: <img> (largest srcset), og:image, <video>/<source>, links to image/video files, Bing image results (a.iusc[m])
  media: (a) => `(()=>{const out=[],seen=new Set(),base=location.href;const abs=u=>{try{return new URL(u,base).href}catch(e){return ''}};const add=(o)=>{o.url=abs(o.url);if(!/^https?:/.test(o.url)||seen.has(o.url))return;seen.add(o.url);out.push(o)};
    document.querySelectorAll('a.iusc[m]').forEach(a=>{try{const m=JSON.parse(a.getAttribute('m'));if(m.murl)add({kind:'image',url:m.murl,page:m.purl||'',alt:m.t||'',w:0,h:0,from:'bing'})}catch(e){}});
    const og=document.querySelector('meta[property="og:image"],meta[name="og:image"],meta[property="og:image:url"]');if(og&&og.content)add({kind:'image',url:og.content,page:base,alt:document.title,from:'og'});
    const ogv=document.querySelector('meta[property="og:video"],meta[property="og:video:url"]');if(ogv&&ogv.content)add({kind:'video',url:ogv.content,page:base,alt:document.title,from:'og'});
    document.querySelectorAll('img').forEach(i=>{let u=i.currentSrc||i.src;const ss=i.getAttribute('srcset')||i.getAttribute('data-srcset');if(ss){let best=0;ss.split(',').forEach(p=>{const [s,d]=p.trim().split(/\\s+/);const n=parseFloat(d)||1;if(n>=best){best=n;u=s}})}if(!u||/^data:/.test(u))u=i.getAttribute('data-src')||i.getAttribute('data-lazy-src')||'';if(!u)return;add({kind:'image',url:u,page:base,alt:(i.alt||'').slice(0,140),w:i.naturalWidth||+i.getAttribute('width')||0,h:i.naturalHeight||+i.getAttribute('height')||0,from:'img'})});
    document.querySelectorAll('video').forEach(v=>{const s=v.currentSrc||v.src||(v.querySelector('source[src]')||{}).src;if(s&&!/^blob:/.test(s))add({kind:'video',url:s,page:base,alt:v.title||document.title,w:v.videoWidth||0,h:v.videoHeight||0,from:'video'})});
    document.querySelectorAll('a[href]').forEach(a=>{if(/\\.(jpe?g|png|webp|avif)(\\?|$)/i.test(a.href))add({kind:'image',url:a.href,page:base,alt:(a.innerText||'').trim().slice(0,140),from:'link'});else if(/\\.(mp4|webm)(\\?|$)/i.test(a.href))add({kind:'video',url:a.href,page:base,alt:(a.innerText||'').trim().slice(0,140),from:'link'})});
    return out.slice(0,${Math.min(200, +a.max || 80)})})()`,
  click: (a) => `(()=>{const sel=${JSON.stringify(a.selector || '')},txt=${JSON.stringify(String(a.text || '').toLowerCase())};let el=null;if(sel){try{el=document.querySelector(sel)}catch(e){return {ok:false,error:'bad selector'}}}if(!el&&txt){el=[...document.querySelectorAll('a,button,[role=button],input[type=submit],summary,label')].find(e=>(e.innerText||e.value||e.getAttribute('aria-label')||'').toLowerCase().includes(txt))}if(!el)return {ok:false,error:'not found'};el.scrollIntoView({block:'center'});el.click();return {ok:true,tag:el.tagName.toLowerCase(),text:(el.innerText||el.value||'').trim().slice(0,80)}})()`,
  fill: (a) => `(()=>{const sel=${JSON.stringify(a.selector || '')};let el=null;try{el=sel?document.querySelector(sel):document.querySelector('input[type=search],input[name=q],input[type=text],textarea')}catch(e){return {ok:false,error:'bad selector'}}if(!el)return {ok:false,error:'not found'};const ac=(el.getAttribute('autocomplete')||'')+' '+(el.name||'')+' '+(el.id||'');if(el.type==='password'||/cc-|card|cvc|cvv|iban|password|passwd|otp|one-time/i.test(ac))return {ok:false,error:'protected field (password/card/OTP) — the user must type it'};el.focus();const set=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;set.call(el,${JSON.stringify(String(a.value || ''))});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));if(${!!a.submit}){if(el.form){el.form.requestSubmit?el.form.requestSubmit():el.form.submit()}else{el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))}}return {ok:true}})()`,
  scroll: (a) => `(()=>{window.scrollBy(0,${Math.max(-20000, Math.min(20000, +a.dy || 800))});return {ok:true,y:scrollY,max:document.documentElement.scrollHeight}})()`,
};

function guardWc(id, PART) {
  const wc = webContents.fromId(+id); if (!wc || wc.isDestroyed()) throw new Error('no page');
  if (wc.getType() !== 'webview' && wc.getType() !== 'window') throw new Error('not a browser page');
  if (wc.session !== session.fromPartition(PART)) throw new Error('not a Nyx browser page');
  return wc;
}

// cross-origin Referer: origin only (Chromium's default policy; a full URL is rejected as ERR_BLOCKED_BY_CLIENT)
const refOrigin = (r) => { try { const u = new URL(r); return /^https?:$/.test(u.protocol) ? u.origin + '/' : ''; } catch (e) { return ''; } };
function wire(H, C, { saveBuf, PART }) {
  const ses = () => session.fromPartition(PART);
  const allowLocal = () => process.env.NYX_TEST === '1' || process.env.NYX_ALLOW_LOCAL_WEB === '1';
  // sync check (scheme + literal IP / local names); the async DNS check runs in guardedFetch / before loading pages
  const okUrl = (u) => { let x; try { x = new URL(u); } catch (e) { return false; } if (!/^https?:$/.test(x.protocol)) return false; return allowLocal() || urlLooksPublic(u); };
  const checkUrl = async (u) => { if (!okUrl(u)) throw Object.assign(new Error('blocked URL'), { code: 'BLOCKED' }); if (!allowLocal()) await assertPublicUrl(u); };
  // where does `url` redirect to? (net.request in manual mode; the redirect itself is never followed here)
  const redirectTarget = (url, headers) => new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; clearTimeout(tm); try { req.abort(); } catch (e) {} resolve(v); } };
    const req = net.request({ url, session: ses(), redirect: 'manual', method: 'GET' });
    for (const [k, v] of Object.entries({ 'User-Agent': UA, ...headers })) try { req.setHeader(k, v); } catch (e) {}
    req.on('redirect', (_st, _m, loc) => fin(loc)); req.on('response', () => fin(null)); req.on('error', () => fin(null));
    const tm = setTimeout(() => fin(null), 15000); req.end();
  });
  // every hop is checked (incl. DNS) before it is requested: redirects can't reach local/private addresses
  const fetcher = async (url, { timeout = 20000, headers = {} } = {}) => {
    let cur = url;
    for (let hop = 0; hop <= 5; hop++) {
      await checkUrl(cur);
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
      try { const r = await ses().fetch(cur, { signal: ctl.signal, headers: { 'User-Agent': UA, ...headers }, redirect: 'error' }); Object.defineProperty(r, 'finalUrl', { value: cur }); return r; }
      catch (e) { if (!/redirect/i.test(String(e?.message))) throw e; const loc = await redirectTarget(cur, headers); if (!loc) throw e; cur = new URL(loc, cur).href; }
      finally { clearTimeout(tm); }
    }
    throw new Error('too many redirects');
  };
  H('web:robots', async (url) => { try { await checkUrl(url); } catch (e) { return { allowed: false }; } return { allowed: await robots(url, fetcher) }; });
  H('web:auto', async (wcId, op, args = {}) => {
    const wc = guardWc(wcId, PART); const fn = Object.hasOwn(SCRIPTS, op) ? SCRIPTS[op] : null; if (typeof fn !== 'function') throw new Error('unknown op ' + op);
    return await wc.executeJavaScript(fn(args || {}), true);
  });
  H('web:press', async (wcId) => { const wc = guardWc(wcId, PART); for (const type of ['keyDown', 'char', 'keyUp']) wc.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Enter' }); return { ok: true }; });
  // grab(url, { kind: 'image'|'video'|'any', referer, hint, minBytes }) → { file, mime, size, url }
  H('web:grab', async (url, o = {}) => {
    await checkUrl(url);
    if (NO_GRAB.test(new URL(url).hostname) || (o.referer && NO_GRAB.test((() => { try { return new URL(o.referer).hostname; } catch (e) { return ''; } })()))) throw new Error('site does not allow downloads (streaming/social platform)');
    if (!await robots(url, fetcher)) { const e = new Error('robots.txt disallows ' + new URL(url).hostname); e.code = 'ROBOTS'; throw e; }
    const want = o.kind || 'any'; const max = want === 'video' ? LIM.video : want === 'image' ? LIM.image : LIM.video;
    const r = await fetcher(url, { timeout: want === 'video' ? 180000 : 45000, headers: refOrigin(o.referer) ? { Referer: refOrigin(o.referer) } : {} });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const finalUrl = r.finalUrl || r.url || url; if (!okUrl(finalUrl)) throw new Error('redirected to a blocked URL');
    const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(); const len = +r.headers.get('content-length') || 0;
    if (len && len > max) throw new Error('too large (' + Math.round(len / 1048576) + ' MB)');
    const parts = []; let got = 0; const rd = r.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.length; if (got > max) { try { rd.cancel(); } catch (e) {} throw new Error('too large'); } parts.push(Buffer.from(value)); }
    const buf = Buffer.concat(parts); const mime = sniff(buf);
    const okType = (m) => want === 'image' ? IMG_MIME.test(m) : want === 'video' ? VID_MIME.test(m) : IMG_MIME.test(m) || VID_MIME.test(m);
    if (!mime || !okType(mime)) throw new Error('not a supported ' + (want === 'any' ? 'image/video' : want) + ' (' + (ct || 'unknown type') + ')');
    if (buf.length < (o.minBytes ?? 4096)) throw new Error('too small (icon/thumbnail)');
    const base = String(o.hint || path.basename(new URL(finalUrl).pathname).replace(/\.[^.]+$/, '') || 'web').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'web';
    const file = await saveBuf(base + EXT[mime], buf);
    return { file, mime, size: buf.length, url: finalUrl };
  });
  // v2.6.1 — an image the USER dragged from a web page (Chrome/Edge or the built-in browser) or a show poster → media folder.
  // Same SSRF guard as web:grab (scheme, literal IP, DNS of every redirect hop), 30 MB cap (header + streamed), magic-byte
  // check (jpeg/png/webp/gif/avif/bmp only — never html/svg/scripts). No robots.txt: it is the user's own explicit action,
  // like «Save image as…» in a browser.
  async function dropImage(url, o = {}) {
    url = String(url || ''); await checkUrl(url);
    const max = (o.maxBytes != null && +o.maxBytes > 0) ? +o.maxBytes : LIM.image;
    const r = await fetcher(url, { timeout: 45000, headers: refOrigin(o.referer) ? { Referer: refOrigin(o.referer) } : {} });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const finalUrl = r.finalUrl || r.url || url; if (!okUrl(finalUrl)) throw new Error('redirected to a blocked URL');
    const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(); const len = +r.headers.get('content-length') || 0;
    if (ct && !/^(image\/|application\/octet-stream|binary\/octet-stream)/.test(ct)) { try { r.body?.cancel().catch(() => {}); } catch (e) {} throw Object.assign(new Error('not an image (' + ct + ')'), { code: 'TYPE' }); }
    if (len > max) throw Object.assign(new Error('too large (' + Math.round(len / 1048576) + ' MB; limit ' + Math.round(max / 1048576) + ' MB)'), { code: 'SIZE', maxBytes: max });
    const parts = []; let got = 0; const rd = r.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.length; if (got > max) { try { rd.cancel(); } catch (e) {} throw Object.assign(new Error('too large (limit ' + Math.round(max / 1048576) + ' MB)'), { code: 'SIZE', maxBytes: max }); } parts.push(Buffer.from(value)); }
    return saveImage(Buffer.concat(parts), o.hint || path.basename(new URL(finalUrl).pathname), finalUrl, max);
  }
  // bytes the renderer already has (a dragged image file / data: URL) → validated the same way
  async function saveImage(buf, hint, url, maxBytes) {
    const max = (maxBytes != null && +maxBytes > 0) ? +maxBytes : LIM.image;
    const mime = sniffDrop(buf); if (!mime) throw Object.assign(new Error('not a supported image'), { code: 'TYPE' });
    if (buf.length > max) throw Object.assign(new Error('too large (limit ' + Math.round(max / 1048576) + ' MB)'), { code: 'SIZE', maxBytes: max });
    const base = String(hint || 'web').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'web';
    const file = await saveBuf(base + (EXT[mime] || '.bmp'), buf);
    return { file, mime, size: buf.length, url: url || '', name: base + (EXT[mime] || '.bmp') };
  }
  module.exports.dropImage = dropImage;
  H('web:dropImage', (url, o) => dropImage(url, o || {}));
  H('file:importImage', (name, bytes) => { if (!bytes || !(bytes.byteLength >= 0)) throw new Error('no data'); if (bytes.byteLength > LIM.image) throw Object.assign(new Error('too large'), { code: 'SIZE' }); return saveImage(Buffer.from(bytes), name, ''); });
  // read a page without showing it (robots-checked), with the same fixed scripts
  H('web:inspect', async (url, op = 'media', args = {}) => {
    const fn = Object.hasOwn(SCRIPTS, op) ? SCRIPTS[op] : null; if (typeof fn !== 'function' || !['info', 'text', 'links', 'results', 'media'].includes(op)) throw new Error('unknown op ' + op);
    await checkUrl(url);
    if (!await robots(url, fetcher)) { const e = new Error('robots.txt disallows ' + new URL(url).hostname); e.code = 'ROBOTS'; throw e; }
    const { BrowserWindow } = require('electron');
    const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: PART, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false } });
    // the hidden page may not navigate / redirect to local addresses, nor open windows
    const stop = (e, u) => { if (!okUrl(u)) e.preventDefault(); };
    w.webContents.on('will-redirect', stop); w.webContents.on('will-navigate', stop); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await Promise.race([w.loadURL(url, { userAgent: UA }), new Promise((_, rj) => setTimeout(() => rj(new Error('Timeout')), 30000))]);
      await new Promise(r => setTimeout(r, +args.wait || 1500));
      const now = w.webContents.getURL(); if (!okUrl(now)) throw new Error('blocked URL'); if (!allowLocal()) await assertPublicUrl(now);
      const res = await w.webContents.executeJavaScript(fn(args), true);
      return { url: w.webContents.getURL(), title: w.webContents.getTitle(), result: res };
    } finally { w.destroy(); }
  });
}

Object.assign(module.exports, { wire, parseRobots, robotsAllows, sniff, sniffDrop, SCRIPTS, NO_GRAB });
