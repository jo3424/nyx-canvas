'use strict';
// v2.6.1 — drag & drop with the outside world. v2.6.2 — robust drops from Firefox and Brave (and any other source).
//  IN : Explorer files + web content from Chrome/Edge/Brave/Firefox and from Nyx's own browser panel.
//       Every representation the DataTransfer carries is collected synchronously in the drop event (snapshot) and then
//       tried IN ORDER until one works (plan → steps):
//         1. real/virtual files with bytes that ARE images (magic bytes — name, extension and mime are not trusted:
//            Firefox hands over a %TEMP% copy, sometimes .bmp or a random name, Brave/Chromium a file with no extension
//            or an empty type, items of kind 'file' may have no name)
//         2. image URLs: <img src>/srcset in text/html, data: URLs, image-looking text/uri-list / text/x-moz-url / URL /
//            DownloadURL entries → main process download (web:dropImage: public addresses only, 30 MB, magic bytes)
//         3. links: text/uri-list, text/x-moz-url(-data), URL, a lone <a href>, URL-only text/plain
//         4. other files (Explorer style, .url shortcuts), 5. plain text (text/plain, html text, x-moz-url-desc)
//       A failed step (unreadable temp file, 403 image, not an image…) falls through to the next one. Cards appear where
//       the mouse was released. The last drops are kept as diagnostics (Ctrl+Alt+Shift+D copies them).
//  OUT: cards → Explorer/desktop/other apps (main/dnd.js: real temp files, .txt for text, .url for links, icon):
//       the round handle on hovered/selected cards, or (Windows/macOS) pull a card past the window edge.
//       Link cards are dragged as a real URL drag (text/uri-list) so browsers open them and Explorer still gets a .url.
//  The whole window accepts drags (dragenter/dragover.preventDefault) so a drop can never navigate the app away.
const DnD = {
  IMG_EXT: /\.(png|jpe?g|gif|webp|avif|bmp)(?:[?#]|$)/i,
  MAX_BYTES: 30 * 1048576,
  selfDrag: 0,
  diag: [],
  // string flavours worth asking for even when not listed in types (Chromium on Linux/macOS and Firefox→Firefox expose the moz ones)
  STR_TYPES: ['text/uri-list', 'text/x-moz-url', 'text/x-moz-url-data', 'text/x-moz-url-desc', 'URL', 'text/html', 'text/plain', 'Text', 'DownloadURL', 'application/x-moz-file-promise-url', 'nyx/item'],
  // ---------- pure helpers (unit-tested in tests/dnd-unit.js / tests/dnd-browsers.js) ----------
  types(dt) { try { return [...(dt?.types || [])].map(String); } catch (e) { return []; } },
  uriList(s) { return String(s || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')); },
  isHttp(u) { return /^https?:\/\/[^\s]+$/i.test(String(u || '').trim()); },
  isDataImg(u) { return /^data:image\/(png|jpe?g|gif|webp|avif|bmp|x-ms-bmp);base64,/i.test(String(u || '').trim()); },
  // text/x-moz-url = "url\ntitle\nurl\ntitle…"
  mozUrls(s) { const l = String(s || '').split(/\r?\n/); const out = []; for (let i = 0; i < l.length; i += 2) { const url = (l[i] || '').trim(); if (url) out.push({ url, title: (l[i + 1] || '').trim() }); } return out; },
  // Chromium DownloadURL = "mime:filename:url"
  downloadUrl(s) { const m = /^([^:\s]+\/[^:\s]+):([^:]*):(https?:\/\/\S+|data:\S+)$/i.exec(String(s || '').trim()); return m ? { mime: m[1].toLowerCase(), name: m[2], url: m[3] } : null; },
  // text/plain that is only URL(s), one per line
  plainUrls(s) { const l = this.uriList(s); return l.length && l.length <= 50 && l.every(u => this.isHttp(u)) ? l : []; },
  // magic bytes (same set the main process accepts: jpeg/png/gif/webp/avif/bmp)
  sniff(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf || new ArrayBuffer(0)); const a = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
    if (b.length < 12) return '';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (a(0, 4) === 'RIFF' && a(8, 4) === 'WEBP') return 'image/webp';
    if (a(0, 3) === 'GIF') return 'image/gif';
    if (a(4, 4) === 'ftyp' && /avi[fs]/.test(a(8, 4))) return 'image/avif';
    if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
    return '';
  },
  isShortcut(buf) { const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf || new ArrayBuffer(0)); if (b.length > 65536) return ''; const s = new TextDecoder().decode(b); return /^\uFEFF?\s*\[InternetShortcut\]/i.test(s) ? (/^URL=(https?:\/\/\S+)/im.exec(s)?.[1] || '') : ''; },
  isTempPath(p) { return /[\\/](temp|tmp)[\\/]|mozilla-temp-files|[\\/]INetCache[\\/]|[\\/]Temporary Internet Files[\\/]/i.test(String(p || '')); },
  // largest srcset candidate, else src
  bestSrc(img, base) {
    let u = img.getAttribute('src') || '', best = -1; const ss = img.getAttribute('srcset') || '';
    for (const part of ss.split(/,\s+/)) { const [s, d] = part.trim().split(/\s+/); if (!s) continue; const n = parseFloat(d) || 1; if (n > best) { best = n; u = s; } }
    if (!u || this.isDataImg(u)) return u;
    try { return new URL(u, base || undefined).href; } catch (e) { return this.isHttp(u) ? u : ''; }
  },
  parseHtml(html, base) {
    const out = { imgs: [], links: [], text: '' }; if (!html) return out;
    let doc; try { doc = new DOMParser().parseFromString(String(html).slice(0, 2e6), 'text/html'); } catch (e) { return out; } // inert: no scripts, no image loads
    const abs = (v) => { try { return new URL(v, base || undefined).href; } catch (e) { return v; } };
    for (const im of doc.querySelectorAll('img')) { const src = this.bestSrc(im, base); const a = im.closest('a[href]'); const href = a ? abs(a.getAttribute('href')) : ''; if (src && (this.isHttp(src) || this.isDataImg(src))) out.imgs.push({ src, alt: (im.getAttribute('alt') || '').trim(), href: this.isHttp(href) ? href : '' }); }
    for (const a of doc.querySelectorAll('a[href]')) { const href = abs(a.getAttribute('href')); if (this.isHttp(href)) out.links.push({ href, text: (a.textContent || '').trim().slice(0, 200) }); }
    out.text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
    return out;
  },
  // DataTransfer → plain snapshot. MUST run synchronously inside the drop event (the data is gone afterwards).
  snapshot(dt) {
    const types = this.types(dt);
    const get = (k) => { try { return String(dt.getData(k) || ''); } catch (e) { return ''; } };
    const str = {};
    for (const k of new Set([...this.STR_TYPES, ...types.filter(x => x !== 'Files' && !/^application\/x-moz-(nativeimage|file|file-promise)$/i.test(x))])) { const v = get(k); if (v) str[k] = v.length > 4e6 ? v.slice(0, 4e6) : v; }
    // files: dt.files + items of kind 'file' (some sources expose a file only as an item, with an empty type and/or no name)
    const raw = []; const has = (f) => raw.some(g => g === f || (g.name === f.name && g.size === f.size && g.lastModified === f.lastModified && g.type === f.type));
    try { for (const f of dt?.files || []) if (f && !has(f)) raw.push(f); } catch (e) {}
    try { for (const it of dt?.items || []) { if (it?.kind !== 'file') continue; let f = null; try { f = it.getAsFile(); } catch (e) {} if (f && !has(f)) raw.push(f); } } catch (e) {}
    const files = raw.map(f => {
      let p = ''; try { p = API?.pathForFile?.(f) || ''; } catch (e) {}
      const name = String(f.name || (p ? p.split(/[\\/]/).pop() : '') || '');
      return { f, name, type: String(f.type || ''), size: +f.size || 0, path: p, ext: (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] || '').toLowerCase(), temp: this.isTempPath(p) };
    });
    const snap = { types, str, files, uris: this.uriList(str['text/uri-list'] || str.URL), html: str['text/html'] || '', plain: str['text/plain'] || str.Text || '', nyx: str['nyx/item'] || '', self: types.includes('nyx/self') };
    // read the bytes NOW: Chromium virtual files and Firefox's %TEMP% copy (deleted ~0.5 s after the drop) vanish soon after
    const web = this.webish(snap);
    for (const x of files) if (x.size <= this.MAX_BYTES && (!x.path || web || x.temp || !x.ext)) { try { x.bytes = x.f.arrayBuffer().catch(() => null); } catch (e) { x.bytes = null; } }
    return snap;
  },
  webish(s) { const ty = s.types || [], str = s.str || {}; return (s.uris || []).length > 0 || !!s.html || ['text/uri-list', 'text/html', 'text/x-moz-url', 'URL', 'DownloadURL'].some(k => ty.includes(k) || str[k]); },
  isImgFile(x) { return /^image\/(png|jpe?g|gif|webp|avif|bmp|x-ms-bmp)$/i.test(x.type) || this.IMG_EXT.test(x.name); },
  // a file a browser attached to a web drag that MIGHT be the picture (decided by magic bytes when the step runs)
  maybeImgFile(x) { return !/\.url$/i.test(x.name) && (!x.type || /^(image\/|application\/octet-stream)/i.test(x.type)) && (!x.ext || x.temp || !/^(pdf|zip|exe|msi|txt|html?|docx?|xlsx?|pptx?|mp4|webm|mov|mp3|wav|svg)$/.test(x.ext)); },
  // what does this drop mean? (pure) → { kind, steps: [...] } — steps are tried in order by handle()
  plan(s0, base) {
    const s = { types: [], files: [], uris: [], html: '', plain: '', nyx: '', self: false, ...s0 }; const str = s.str || {};
    if (s.self) return { kind: 'none', why: 'self', steps: [] };
    if (s.nyx) return { kind: 'nyx', steps: [] };
    const uniq = (a) => [...new Set(a.map(u => String(u || '').trim()).filter(Boolean))];
    const moz = this.mozUrls(str['text/x-moz-url']); const dl = this.downloadUrl(str.DownloadURL);
    const all = uniq([...s.uris, ...moz.map(m => m.url), str['text/x-moz-url-data'], ...this.uriList(str.URL), dl?.url, str['application/x-moz-file-promise-url']]);
    const http = all.filter(u => this.isHttp(u)), datas = all.filter(u => this.isDataImg(u));
    const files = s.files.filter(x => !/[\\/]nyx-drag[\\/]/.test(x.path || ''));
    const web = this.webish(s) || http.length > 0 || datas.length > 0;
    if (s.files.length && !web) return { kind: 'files', steps: [{ t: 'files', files: s.files }] }; // Explorer (extension-less images are sniffed in importFiles)
    const h = this.parseHtml(s.html, base || http[0] || '');
    const plainUrls = this.plainUrls(s.plain); const plainData = this.isDataImg(s.plain) ? s.plain.trim() : '';
    const urlFiles = files.filter(x => /\.url$/i.test(x.name)), other = files.filter(x => !urlFiles.includes(x));
    const imgFiles = other.filter(x => this.isImgFile(x)), maybe = other.filter(x => !imgFiles.includes(x) && this.maybeImgFile(x));
    const im = h.imgs[0] || null;
    const onlyPicture = h.imgs.length >= 1 && h.imgs.length <= 3 && (!h.text || h.text === im.alt);
    const imgUri = http.find(u => this.IMG_EXT.test(u)) || (dl && /^image\//.test(dl.mime) ? dl.url : '') || '';
    const isImage = imgFiles.length > 0 || onlyPicture || datas.length > 0 || !!plainData || (!!imgUri && !h.text) || (maybe.length > 0 && (onlyPicture || !!imgUri || (!h.text && !s.plain.trim()) || http.length > 0 && !h.links.length));
    const steps = []; let src = '', link = '';
    if (isImage) {
      src = im?.src || datas[0] || plainData || imgUri || '';
      link = im?.href || (http.find(u => u !== src && !this.IMG_EXT.test(u)) || '');
      if (link === src) link = '';
      for (const x of [...imgFiles, ...maybe]) steps.push({ t: 'fileImage', file: x });
      for (const u of uniq([src, ...h.imgs.map(i => i.src), ...datas, plainData])) if (this.isDataImg(u)) steps.push({ t: 'dataImage', src: u });
      for (const u of uniq([src, ...h.imgs.map(i => i.src), imgUri, ...http.filter(u => u !== link)])) if (this.isHttp(u)) steps.push({ t: 'urlImage', src: u, link });
      const fb = uniq([link, ...(this.isHttp(src) ? [src] : [])]); if (fb.length) steps.push({ t: 'links', links: fb.slice(0, 1), fallback: true, title: im?.alt || '' });
      if (other.length) steps.push({ t: 'files', files: other });
    } else {
      let links = uniq([...http, ...plainUrls]);
      if (!links.length && h.links.length === 1 && h.text === h.links[0].text) links = [h.links[0].href]; // html that is just one <a>
      const title = moz.find(m => m.url === links[0])?.title || h.links.find(l => l.href === links[0])?.text || str['text/x-moz-url-desc'] || dl?.name || '';
      // a lone URL with no html (e.g. only text/uri-list): it may be the picture itself → quietly try it as an image first
      if (links.length === 1 && http.length === 1 && !s.html && !imgUri && !other.length) steps.push({ t: 'urlImage', src: links[0], link: '', quiet: true });
      if (links.length) steps.push({ t: 'links', links: links.slice(0, 20), title: title && title !== links[0] ? title : '' });
      if (other.length || urlFiles.length) steps.push({ t: 'files', files: [...other, ...urlFiles] });
      const text = (s.plain || h.text || str['text/x-moz-url-desc'] || '').trim();
      if (text && !(links.length && (plainUrls.length || text === links[0]))) steps.push({ t: 'text', text: text.slice(0, 200000) });
    }
    const first = steps.find(x => !x.quiet) || steps[0]; if (!first) return { kind: 'none', why: 'empty', steps };
    const kind = /Image$/.test(first.t) ? 'image' : first.t;
    const ls = steps.find(x => x.t === 'links'), tx = steps.find(x => x.t === 'text');
    return { kind, steps, file: first.t === 'fileImage' ? first.file : null, src, link, alt: im?.alt || '', links: ls?.links, title: ls?.title || '', text: tx?.text };
  },
  b64ToBytes(dataUrl) { const b = atob(String(dataUrl).slice(String(dataUrl).indexOf(',') + 1)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
  nameFromUrl(u, def = 'web') { try { const p = new URL(u).pathname.split('/').filter(Boolean).pop() || ''; return decodeURIComponent(p).replace(/\.[^.]+$/, '').slice(0, 40) || hostOf(u) || def; } catch (e) { return def; } },
  async bytesOf(x) { let b = null; try { b = await x.bytes; } catch (e) {} if (!b) { try { b = await x.f.arrayBuffer(); } catch (e) { throw new Error('file unreadable (' + (e.name || e.message) + ')'); } } if (!b || !b.byteLength) throw new Error('empty file'); return new Uint8Array(b); },
  // ---------- actions ----------
  async addImage(r, at, meta = {}) {
    const it = await Features.addMedia({ file: r.file, name: r.name, mime: r.mime, size: r.size }, at.x, at.y);
    const source = meta.link || (this.isHttp(meta.src) ? meta.src : '');
    if (it && source) { it.source = source; if (meta.alt && !it.caption) it.caption = meta.alt.slice(0, 140); Items.mount(it); Store.save(); }
    return it;
  },
  // one image the old way (kept for callers/tests): file bytes → data: → download → link fallback
  async importImage(p, at, referer) {
    const steps = []; if (p.file) steps.push({ t: 'fileImage', file: p.file });
    if (this.isDataImg(p.src)) steps.push({ t: 'dataImage', src: p.src }); if (this.isHttp(p.src)) steps.push({ t: 'urlImage', src: p.src, link: p.link || '' });
    const fb = p.link || (this.isHttp(p.src) ? p.src : ''); if (fb) steps.push({ t: 'links', links: [fb], fallback: true });
    return this.run({ kind: 'image', steps, src: p.src, link: p.link || '', alt: p.alt || '' }, null, at, { referer });
  },
  async step(st, p, at, opts) {
    const meta = { link: st.link ?? p.link, src: st.src || p.src, alt: p.alt };
    if (st.t === 'fileImage') {
      const b = await this.bytesOf(st.file); if (!this.sniff(b)) throw new Error('not an image: ' + (st.file.name || st.file.type || '?'));
      return this.addImage(await API.inv('file:importImage', st.file.name || 'image', b), at, meta);
    }
    if (st.t === 'dataImage') return this.addImage(await API.inv('file:importImage', 'image', this.b64ToBytes(st.src)), at, meta);
    if (st.t === 'urlImage') return this.addImage(await API.inv('web:dropImage', st.src, { referer: opts.referer || st.link || '', hint: this.nameFromUrl(st.src, 'web') }), at, { ...meta, src: st.src });
    if (st.t === 'links') {
      const out = []; for (let i = 0; i < st.links.length; i++) { const u = st.links[i], pos = { x: at.x + (i % 4) * 360, y: at.y + Math.floor(i / 4) * 300 }; out.push(!st.fallback && this.IMG_EXT.test(u) ? await this.importImage({ src: u, link: '' }, pos, opts.referer) : await Features.addLinkUrl(u, pos)); }
      if (st.title && out[0] && out[0].type === 'link' && (!out[0].title || out[0].title === hostOf(out[0].url))) { out[0].title = st.title; Items.mount(out[0]); Store.save(); }
      return out.filter(Boolean).length ? out : null;
    }
    if (st.t === 'files') { const n = await this.importFiles(st.files, at); return n ? { files: n } : null; }
    if (st.t === 'text') return Features.addAt({ type: 'text', w: 380, h: 40, html: esc(st.text).replace(/\n/g, '<br>'), size: 17, source: opts.referer || undefined }, at.x, at.y);
    return null;
  },
  // try the steps in order; the first one that produces something wins
  async run(p, s, at, opts = {}) {
    const tried = []; let imgErr = null;
    for (const st of p.steps) {
      try {
        const r = await this.step(st, p, at, opts);
        if (r) { tried.push(st.t + ':ok'); if (st.fallback && imgErr) toast(t('v26.dnd_img_fail', { v0: imgErr.message || '?' }), { kind: 'err', ms: 6000 }); this.note(s, p, tried); return r; }
        tried.push(st.t + ':empty');
      } catch (e) { tried.push(st.t + ':' + (e?.message || e)); if (/Image$/.test(st.t) && !st.quiet) imgErr = e; console.warn('dnd step', st.t, e?.message); }
    }
    this.note(s, p, tried);
    toast('⚠️ ' + (imgErr?.message || t('v26.dnd_nothing')) + (s?.types?.length ? ' [' + s.types.join(', ').slice(0, 160) + ']' : ''), { kind: 'err', ms: 7000 });
    return null;
  },
  // Explorer-style files; .url shortcuts become link cards; images are recognised by their bytes (even without extension);
  // temp copies are imported from the bytes read during the drop; Nyx's own drag-out temp files are ignored → count imported
  async importFiles(files, at) {
    const keep = []; let n = 0; const pos = () => ({ x: at.x + n * 30, y: at.y + n * 30 });
    for (const x of files) {
      if (/[\\/]nyx-drag[\\/]/.test(x.path || '')) continue;
      let b = null; if (x.bytes || !x.path) { try { b = await this.bytesOf(x); } catch (e) { b = null; } }
      if (!b && /\.url$/i.test(x.name) && x.size < 65536) { try { b = new Uint8Array(await x.f.arrayBuffer()); } catch (e) {} }
      const sc = b && this.isShortcut(b); if (sc) { await Features.addLinkUrl(sc, pos()); n++; continue; }
      if (b && this.sniff(b)) { try { const it = await this.addImage(await API.inv('file:importImage', x.name || 'image', b), pos(), {}); if (it) { n++; continue; } } catch (e) { console.warn('dnd image file', e.message); } }
      if (b && (!x.path || x.temp)) { try { const it = await Features.addMedia(await API.importBuffer(x.name || 'file', b), pos().x, pos().y); if (it) { n++; continue; } } catch (e) { console.warn('dnd buffer', e.message); } }
      if (x.path || !b) keep.push(x.f);
    }
    if (keep.length) { await Features.importFiles(keep, pos()); n += keep.length; }
    return n;
  },
  async handle(s, at, opts = {}) {
    const p = this.plan(s, opts.referer);
    if (p.kind === 'nyx') { try { return Features.addAt(JSON.parse(s.nyx), at.x, at.y); } catch (e) { return null; } }
    if (p.kind === 'none') { this.note(s, p, []); if (p.why === 'empty') toast(t('v26.dnd_nothing') + (s.types?.length ? ' [' + s.types.join(', ').slice(0, 160) + ']' : '')); return null; }
    return this.run(p, s, at, opts);
  },
  // diagnostics: what the last drops contained (no file contents, URLs shortened) → Ctrl+Alt+Shift+D copies it
  note(s, p, tried) {
    if (!s) return;
    try {
      const cut = (v) => { v = String(v || ''); return v.length > 160 ? v.slice(0, 160) + '…(' + v.length + ')' : v; };
      this.diag.push({ at: new Date().toISOString(), ua: navigator.userAgent.replace(/^.*?(Electron\/\S+).*$/, '$1'), types: s.types, str: Object.fromEntries(Object.entries(s.str || {}).map(([k, v]) => [k, cut(v)])), files: (s.files || []).map(x => ({ name: x.name, type: x.type, size: x.size, ext: x.ext, path: !!x.path, temp: !!x.temp })), plan: p.kind, steps: (p.steps || []).map(x => x.t), tried });
      this.diag = this.diag.slice(-15); localStorage.setItem('nyx.dnd.diag', JSON.stringify(this.diag));
    } catch (e) {}
  },
  async copyDiag() { let d = this.diag; try { if (!d.length) d = JSON.parse(localStorage.getItem('nyx.dnd.diag') || '[]'); } catch (e) {} const txt = JSON.stringify(d, null, 1); const ok = await navigator.clipboard.writeText(txt).then(() => true, () => false); if (!ok) { const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px'; document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); } toast('📋 ' + t('v26.copied') + ' (drag & drop: ' + d.length + ')'); },
  // ---------- drag OUT ----------
  OUT_TYPES: ['image', 'video', 'audio', 'file', 'text', 'sticky', 'reminder', 'link', 'web'],
  payloadFor(it) {
    if (!it) return null;
    if (['image', 'video', 'audio', 'file'].includes(it.type)) return it.file && !/^(https?:|data:|blob:)/.test(it.file) ? { file: it.file, name: it.name || '' } : null;
    if (it.type === 'link' || it.type === 'web') return this.isHttp(it.url) ? { url: it.url, name: it.title || hostOf(it.url) } : null;
    if (['text', 'sticky', 'reminder'].includes(it.type)) { const txt = (plainText(String(it.html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')).replace(/\n{3,}/g, '\n\n').trim()) || it.reminder?.msg || ''; if (!txt) return null; return { text: txt, name: (txt.split('\n')[0].trim().slice(0, 40) || 'note') + '.txt' }; }
    return null;
  },
  payloadsFrom(it) { const its = Canvas.sel?.has(it.id) && Canvas.sel.size > 1 ? Canvas.selItems() : [it]; return its.map(x => this.payloadFor(x)).filter(Boolean); },
  dragOut(list) { if (!list.length || !API?.startDrag) return false; this.selfDrag = Date.now(); API.startDrag(list); return true; },
  canEdge() { return /Windows|Macintosh/.test(navigator.userAgent) && Store.state.settings.dragOutEdge !== false; },
  // card being moved → pulled past the window edge → hand it to the OS (Windows/macOS)
  armEdge(e) {
    if (!this.canEdge() || e.button !== 0) return;
    const id = e.pointerId; const M = 6;
    const mv = (ev) => {
      if (ev.pointerId !== id) return;
      if (!(ev.buttons & 1)) return off();
      if (ev.clientX > -M && ev.clientY > -M && ev.clientX < innerWidth + M && ev.clientY < innerHeight + M) return;
      off();
      const list = Canvas.selItems().map(x => this.payloadFor(x)).filter(Boolean); if (!list.length) return;
      // end the in-canvas move first (put the cards back), then start the OS drag while the button is still down
      try { Canvas.vp.releasePointerCapture(id); } catch (x) {}
      const n0 = Store.undoStack.length;
      dispatchEvent(new PointerEvent('pointerup', { pointerId: id, bubbles: true, clientX: ev.clientX, clientY: ev.clientY }));
      if (Store.undoStack.length > n0 && Store.undo()) { Store.redoStack.pop(); Canvas.refresh(); Panels.stylebar?.(); } // only our own move is undone
      this.dragOut(list);
    };
    const off = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); };
    const up = (ev) => { if (ev.pointerId === id) off(); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  },
  // ---------- wiring ----------
  editable(el) { return !!el?.closest?.('input,textarea,[contenteditable=""],[contenteditable=true],[contenteditable=plaintext-only]'); },
  overPanel(el) { return !el?.closest?.('#viewport') || !!el?.closest?.('#drawer,#browser,.modal,#assistant,.assistant,#settings'); },
  effect(dt) { const a = String(dt.effectAllowed || 'all'); return /^(all|uninitialized|none|copy|copyLink|copyMove)$/.test(a) ? 'copy' : /link/i.test(a) ? 'link' : 'move'; },
  init() {
    const dz = $('#dropzone'); let hideT = 0;
    const showDz = (on) => { clearTimeout(hideT); if (on) { if (dz.hidden) dz.hidden = false; hideT = setTimeout(() => { dz.hidden = true; }, 250); } else dz.hidden = true; };
    const internal = (ty) => ty.includes('nyx/tab') || ty.includes('nyx/self');
    // dragenter is cancelled too (spec: makes the canvas the drop target for every source, not only Chromium ones)
    addEventListener('dragenter', (e) => {
      const ty = this.types(e.dataTransfer);
      if (ty.includes('nyx/tab') || (this.editable(e.target) && !ty.includes('Files'))) return;
      e.preventDefault();
    });
    addEventListener('dragover', (e) => {
      const ty = this.types(e.dataTransfer);
      if (ty.includes('nyx/tab')) return; // board tabs reorder themselves
      if (this.editable(e.target) && !ty.includes('Files')) return; // text into a field: native behaviour
      e.preventDefault(); // always: Electron must never navigate to a dropped file/link
      if (internal(ty)) { e.dataTransfer.dropEffect = 'none'; return; }
      e.dataTransfer.dropEffect = this.effect(e.dataTransfer);
      if (!e.target.closest?.('#assistant,.assistant,#br-drop')) showDz(true);
    });
    addEventListener('dragleave', (e) => { if (!e.relatedTarget) showDz(false); });
    addEventListener('dragend', () => { showDz(false); this.strip(false); });
    addEventListener('drop', (e) => {
      const ty = this.types(e.dataTransfer);
      if (ty.includes('nyx/tab')) return;
      if (this.editable(e.target) && !ty.includes('Files')) return;
      e.preventDefault(); showDz(false);
      const strip = !!e.target.closest?.('#br-drop'); this.strip(false);
      if (internal(ty)) return;
      // memes library drawer (unchanged behaviour)
      if (e.target.closest?.('#drawer') && Panels.libTab === 'memes' && e.dataTransfer.files.length && API) return Features.dropMemes?.([...e.dataTransfer.files]);
      let s; try { s = this.snapshot(e.dataTransfer); } catch (err) { console.error(err); toast('⚠️ ' + err.message, { kind: 'err' }); return; }
      if (s.files.some(x => /[\\/]nyx-drag[\\/]/.test(x.path)) && Date.now() - this.selfDrag < 120000) return; // our own drag-out came back
      const at = (strip || this.overPanel(e.target)) ? Canvas.center() : Canvas.s2w(e.clientX, e.clientY);
      const referer = strip || e.target.closest?.('#browser') ? (Browser.cur?.url || '') : '';
      if (strip && Browser.isOn()) Browser.minimize();
      this.handle(s, at, { referer }).catch(err => { console.error(err); toast('⚠️ ' + err.message, { kind: 'err' }); });
    });
    // drag OUT: the round handle (all exportable cards). Shift on a text card = drag the text itself (for Word, mail …)
    document.addEventListener('dragstart', (e) => {
      const d = e.target.closest?.('.dragout'); if (!d) return;
      const it = Store.get(d.closest('.item')?.dataset.id); if (!it) { e.preventDefault(); return; }
      if (e.shiftKey && ['text', 'sticky', 'reminder', 'link', 'web'].includes(it.type)) {
        const txt = it.url || plainText(it.html) || ''; e.dataTransfer.setData('text/plain', txt); if (it.url) e.dataTransfer.setData('text/uri-list', it.url); else e.dataTransfer.setData('text/html', sanitize(it.html || ''));
        e.dataTransfer.setData('nyx/self', '1'); e.dataTransfer.effectAllowed = 'copy'; return;
      }
      const list = this.payloadsFrom(it);
      // only links → a real URL drag: Firefox/Brave/Chrome open it, Explorer still makes a .url shortcut (Chromium adds one)
      if (list.length && list.every(x => x.url)) {
        const urls = list.map(x => x.url); e.dataTransfer.setData('text/uri-list', urls.join('\r\n')); e.dataTransfer.setData('text/plain', urls.join('\n'));
        e.dataTransfer.setData('text/html', list.map(x => '<a href="' + esc(x.url) + '">' + esc(x.name || x.url) + '</a>').join('<br>'));
        e.dataTransfer.setData('nyx/self', '1'); e.dataTransfer.effectAllowed = 'copyLink'; this.selfDrag = Date.now(); return;
      }
      e.preventDefault();
      if (!this.dragOut(list)) toast(t('v26.dnd_out_none'));
    }, true);
    // the built-in browser started a drag → show a drop strip over the browser panel (it usually covers the canvas)
    API?.onBrowserDrag?.((m) => this.strip(!!m.on));
    // Ctrl+Alt+Shift+D = copy drop diagnostics (capture + stopPropagation: wins over Ctrl+Shift+D daily note / Ctrl+D)
    addEventListener('keydown', (e) => { if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); e.stopPropagation(); this.copyDiag(); } }, true);
    addEventListener('pointerdown', () => { if (this.selfDrag && Date.now() - this.selfDrag > 1500) this.selfDrag = 0; }, true);
  },
  strip(on) {
    let el = $('#br-drop');
    if (!on) { if (el) el.hidden = true; clearTimeout(this._stripT); return; }
    if (!Browser.isOn?.()) return;
    if (!el) { el = h('div', { id: 'br-drop', hidden: true }, h('span', { html: iconSvg('arrow-down-to-line', 22) }), h('b', {}, t('v26.dnd_strip'))); Browser.el.append(el); }
    const v = $('#br-views'); if (v) el.style.top = (v.offsetTop + 8) + 'px';
    el.hidden = false; clearTimeout(this._stripT); this._stripT = setTimeout(() => this.strip(false), 60000);
  },
};
// Features.initDrop is called by App.init → the new handlers replace the v2.0 ones (which only knew Explorer files)
Features.initDrop = function () {
  DnD.init();
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('input,textarea')) return;
    if (Canvas.editing) { e.preventDefault(); const txt = e.clipboardData.getData('text/plain'); document.execCommand('insertText', false, txt); return; }
    e.preventDefault(); Clip.paste(null, e);
  });
  $('#viewport').addEventListener('pointermove', (e) => { this.mouseWorld = Canvas.s2w(e.clientX, e.clientY); }, { passive: true });
};
Features.dropMemes = async function (files) {
  const paths = files.map(f => API.pathForFile(f)).filter(Boolean);
  for (const p of paths) { const r = await API.importPath(p); const info = (await API.thumb(r.file)) || { w: 300, h: 300 }; const sc = Math.min(1, 380 / Math.max(info.w, info.h)); Store.state.library.memes.push({ file: r.file, thumb: info.thumb || undefined, name: r.name, w: info.w * sc, h: info.h * sc }); }
  Store.save(); Panels.refreshDrawer();
};
// drag-out handle on every exportable card (v2.0 had it only on media cards with a file)
{
  const _r = Items.render.bind(Items);
  Items.render = function (n, it) {
    _r(n, it);
    if (V2.viewer || n.querySelector(':scope > .dragout') || !DnD.OUT_TYPES.includes(it.type) || !DnD.payloadFor(it)) return;
    n.insertAdjacentHTML('beforeend', t('extras.002', { v0: iconSvg('hand-grab', 13) }));
  };
  const _sm = Canvas.startMove.bind(Canvas);
  Canvas.startMove = function (e, ...a) { DnD.armEdge(e); return _sm(e, ...a); }; // v2.7.1.1: pass the widget threshold / late capture through
}
