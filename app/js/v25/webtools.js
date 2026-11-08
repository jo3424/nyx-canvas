'use strict';
// v2.5 — the assistant can use the Nyx browser for real: search, read results, open pages, click/fill/scroll (guarded, fixed scripts in main),
// find image/video URLs (img/srcset/og:image/<video>), download through the browser session (robots.txt, type/magic/size checks),
// and place them on the canvas with source attribution. Every step shows live in the assistant and can be cancelled.
const WebAgent = {
  S() { return Agent.S(); },
  BLOCK: /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|tiktok\.com|instagram\.com|facebook\.com|fbcdn\.net|netflix\.com|disneyplus\.com|primevideo\.com|spotify\.com|twitch\.tv|onlyfans\.com)$/i,
  host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } },
  url(kind, q) {
    const S = this.S(); const tpl = kind === 'images' ? S.imageSearchUrl : kind === 'videos' ? S.videoSearchUrl : S.searchUrl;
    let u = tpl.replace('%s', encodeURIComponent(q));
    if (kind === 'images' && S.freeLicense && /bing\.com\/images/.test(u) && !/license/.test(u)) u += (u.includes('qft=') ? '' : '&qft=') + '+filterui:license-L2_L3_L4_L5_L6_L7';
    return u;
  },
  // open a tab and wait for it to load (dom-ready + did-stop-loading), then a short settle delay for JS pages
  async open(url, { show = true, settle = 900, timeout = 25000 } = {}) {
    Agent.check();
    const tab = Browser.cur && Browser.cur._agent && !Browser.el.hidden ? (Browser.nav(url), Browser.cur) : Browser.open(url);
    if (!show) Browser.hide(true);
    tab._agent = true;
    await new Promise((res) => {
      const wv = tab.wv; let done = false; const fin = () => { if (done) return; done = true; clearTimeout(tm); wv.removeEventListener('did-stop-loading', stop); wv.removeEventListener('did-fail-load', fail); res(); };
      const stop = () => fin(); const fail = (e) => { if (e.isMainFrame && e.errorCode !== -3) fin(); };
      const tm = setTimeout(fin, timeout); wv.addEventListener('did-stop-loading', stop); wv.addEventListener('did-fail-load', fail);
    });
    await sleep(settle); Agent.check();
    return tab;
  },
  wc(tab = Browser.cur) { if (!tab?.wv) throw new Error(t('v25.wb_nopage')); return tab.wv.getWebContentsId(); },
  auto(op, args, tab) { return API.inv('web:auto', this.wc(tab), op, args || {}); },
  async results(q, kind = 'web') { const tab = await this.open(this.url(kind, q)); const r = await this.auto(kind === 'images' ? 'media' : 'results', { max: 120 }, tab); return { tab, list: r || [] }; },
  good(m, kind) { if (m.kind !== kind) return false; if (this.BLOCK.test(this.host(m.url)) || this.BLOCK.test(this.host(m.page || ''))) return false; if (/\.svg(\?|$)|sprite|logo|icon|avatar|favicon|pixel|1x1|spacer|badge/i.test(m.url)) return false; if (m.w && m.w < (kind === 'video' ? 240 : 500)) return false; if (/^https?:\/\/(?:[^/]+\.)?(bing|duckduckgo)\.com\/th/.test(m.url) && m.from !== 'bing') return false; return true; },
  // candidates for {query, kind}: image search page (Bing a.iusc → full-size murl + source page); else web results → robots-checked pages
  async candidates(q, kind, need) {
    const out = []; const seen = new Set(); const add = (m) => { if (!seen.has(m.url) && this.good(m, kind)) { seen.add(m.url); out.push(m); } };
    if (kind === 'image') { Agent.sub(t('v25.wb_img_search', { q })); try { const r = await this.results(q, 'images'); r.list.forEach(add); } catch (e) { Agent.sub('⚠️ ' + cleanErr(e)); } }
    if (out.length >= need * 2) return out;
    const wq = kind === 'video' ? q + ' ' + (this.S().videoHint || 'video mp4 site:commons.wikimedia.org OR site:pexels.com OR site:pixabay.com OR site:coverr.co') : q;
    Agent.sub(t('v25.wb_web_search', { q: wq })); const r = await this.results(wq, 'web');
    for (const res of r.list.slice(0, this.S().maxPages || 6)) {
      Agent.check(); if (this.BLOCK.test(this.host(res.url))) continue;
      Agent.sub(t('v25.wb_reading', { host: this.host(res.url) }));
      try { const x = await API.inv('web:inspect', res.url, 'media', { max: 80 }); (x.result || []).forEach(m => add({ ...m, page: m.page || res.url })); }
      catch (e) { Agent.sub('↷ ' + this.host(res.url) + ': ' + cleanErr(e)); }
      if (out.length >= need * 3) break;
    }
    return out;
  },
  async download(cands, kind, n) {
    const got = [], skipped = [];
    for (const m of cands) {
      if (got.length >= n) break; Agent.check();
      Agent.sub(t('v25.wb_dl', { i: got.length + 1, n, host: this.host(m.url) }));
      try { const r = await API.inv('web:grab', m.url, { kind, referer: m.page || undefined, hint: (m.alt || this.S().lastQuery || 'web').slice(0, 40) }); got.push({ ...r, page: m.page || '', alt: m.alt || '' }); }
      catch (e) { skipped.push({ url: m.url, why: cleanErr(e) }); }
      if (skipped.length > n * 6) break;
    }
    return { got, skipped };
  },
  // the page an image came from; when it is the search engine's own result page, credit the image's host instead
  srcOf(g) { const S = this.S(); const eng = new Set([S.searchUrl, S.imageSearchUrl, S.videoSearchUrl].map(u => this.host(String(u || '').replace('%s', 'x')))); return g.page && !eng.has(this.host(g.page)) ? g.page : g.url; },
  async place(got, title) {
    const items = await Agent.placeGrid(got.map(g => { const src = this.srcOf(g); return { file: g.file, mime: g.mime, name: (g.alt || this.host(src)).slice(0, 60), source: src, caption: t('v25.wb_src', { host: this.host(src) }) }; }), { title });
    return items;
  },
};

Object.assign(Cmd.T, {
  web_media_to_canvas: { d: t('v25.tl_wmc'), p: { query: { type: 'string' }, kind: { type: 'string', enum: ['image', 'video'] }, count: { type: 'number' }, board: { type: 'string' } }, req: ['query'],
    async run(a) {
      const kind = a.kind === 'video' ? 'video' : 'image'; const n = Math.max(1, Math.min(+a.count || 2, WebAgent.S().webMaxDl || 6)); WebAgent.S().lastQuery = a.query;
      if (a.board) { const b = Store.state.boards.find(x => norm(x.name) === norm(a.board)); if (b) await Cmd.T.open_board.run({ name: b.name }); else await Cmd.T.create_board.run({ name: a.board }); }
      const cands = await WebAgent.candidates(a.query, kind, n);
      if (!cands.length) return { ok: false, error: t('v25.wb_none') };
      const { got, skipped } = await WebAgent.download(cands, kind, n);
      if (!got.length) return { ok: false, error: t('v25.wb_dlfail'), skipped: skipped.slice(0, 6) };
      Agent.sub(t('v25.wb_placing', { n: got.length }));
      const items = await WebAgent.place(got, a.query); Browser.hide(true);
      Agent.say(t('v25.wb_done', { n: items.length, kind: t(kind === 'video' ? 'v25.wb_k_video' : 'v25.wb_k_image'), q: a.query, hosts: [...new Set(got.map(g => WebAgent.host(WebAgent.srcOf(g))))].join(', ') }) + (skipped.length ? ' ' + t('v25.wb_skipped', { n: skipped.length }) : ''));
      return { ok: true, placed: items.length, kind, files: got.map(g => ({ file: g.file, source: WebAgent.srcOf(g), size: g.size })), skipped: skipped.length, ids: items.map(i => i.id.slice(0, 8)) };
    } },
  browse_open: { d: t('v25.tl_bopen'), p: { url: { type: 'string' } }, req: ['url'], async run(a) { const tab = await WebAgent.open(Browser.fix(a.url)); return { ok: true, ...(await WebAgent.auto('info', {}, tab)) }; } },
  browse_search: { d: t('v25.tl_bsearch'), p: { query: { type: 'string' }, kind: { type: 'string', enum: ['web', 'images'] } }, req: ['query'],
    async run(a) { const r = await WebAgent.results(a.query, a.kind === 'images' ? 'images' : 'web'); return { ok: true, results: r.list.slice(0, a.kind === 'images' ? 30 : 12) }; } },
  browse_read: { d: t('v25.tl_bread'), p: { what: { type: 'string', enum: ['text', 'links', 'media', 'results'] } },
    async run(a) { const w = a.what || 'text'; const r = await WebAgent.auto(w, { max: w === 'text' ? 12000 : 80 }); return { ok: true, url: Browser.cur?.url, data: r }; } },
  browse_click: { d: t('v25.tl_bclick'), p: { selector: { type: 'string' }, text: { type: 'string' } }, async run(a) { const r = await WebAgent.auto('click', a); await sleep(1200); return r; } },
  browse_fill: { d: t('v25.tl_bfill'), p: { selector: { type: 'string' }, value: { type: 'string' }, submit: { type: 'boolean' } }, req: ['value'], async run(a) { const r = await WebAgent.auto('fill', a); if (a.submit) await sleep(1800); return r; } },
  browse_scroll: { d: t('v25.tl_bscroll'), p: { dy: { type: 'number' } }, async run(a) { return WebAgent.auto('scroll', a); } },
  browse_screenshot: { d: t('v25.tl_bshot'), p: {}, async run() { if (!Browser.cur) return { ok: false, error: t('v25.wb_nopage') }; const s = await API.inv('web:capture', WebAgent.wc()); const sc = Math.min(1, 560 / s.w); const p = Cmd.freeSpot(s.w * sc, s.h * sc); const it = Features.addAt({ type: 'image', file: s.file, name: (s.title || 'screenshot') + '.png', caption: t('v25.wb_src', { host: WebAgent.host(s.url) }), source: s.url, w: s.w * sc, h: s.h * sc }, p.x, p.y); return { ok: true, id: it.id.slice(0, 8) }; } },
  find_media: { d: t('v25.tl_findmedia'), p: { url: { type: 'string' }, kind: { type: 'string', enum: ['image', 'video'] } },
    async run(a) { const kind = a.kind === 'video' ? 'video' : 'image'; let list; if (a.url) { const x = await API.inv('web:inspect', Browser.fix(a.url), 'media', { max: 120 }); list = x.result || []; } else list = await WebAgent.auto('media', { max: 120 }); return { ok: true, media: list.filter(m => WebAgent.good(m, kind)).slice(0, 25) }; } },
  download_media: { d: t('v25.tl_dlmedia'), p: { urls: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: ['image', 'video'] }, page: { type: 'string' } }, req: ['urls'],
    async run(a) { const kind = a.kind === 'video' ? 'video' : 'image'; const c = (a.urls || []).slice(0, 12).map(u => ({ url: u, kind, page: a.page || '' })).filter(m => !WebAgent.BLOCK.test(WebAgent.host(m.url))); const { got, skipped } = await WebAgent.download(c, kind, c.length); const items = got.length ? await WebAgent.place(got) : []; return { ok: got.length > 0, placed: items.length, skipped }; } },
  web_fetch: { d: t('v25.tl_wfetch'), p: { url: { type: 'string' } }, req: ['url'],
    async run(a) { const x = await API.inv('web:inspect', Browser.fix(a.url), 'text', { max: 12000 }); return { ok: true, url: x.url, title: x.title, text: String(x.result || '').slice(0, 12000) }; } },
});
