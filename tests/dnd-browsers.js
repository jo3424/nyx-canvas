'use strict';
// v2.6.2 — renderer drop logic (app/js/v26/dnd.js) against Firefox / Brave / Chrome / Explorer DataTransfer payloads
// (tests/fixtures/dnd-payloads.js). Real Chromium DOMParser/File/Blob, stubbed app + IPC. Run:
//   xvfb-run -a electron tests/dnd-browsers.js      (exit code 0 = all pass)
const { app, BrowserWindow } = require('electron'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..');
const STUBS = `
window.__out = []; window.__toasts = []; window.__paths = new WeakMap(); window.__calls = [];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\\./, ''); } catch (e) { return u; } }
const t = (k) => k; const toast = (m) => { __toasts.push(String(m)); };
const sniffMain = (b) => { b = new Uint8Array(b && b.buffer ? b.buffer : b || []); if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'; if (b[0] === 0x89 && b[1] === 0x50) return 'image/png'; if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'; if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif'; return ''; }; // stand-in for main sniffDrop
const API = {
  pathForFile: (f) => __paths.get(f) || '',
  inv: async (ch, a, b) => {
    __calls.push(ch + ' ' + (typeof a === 'string' ? a : ''));
    if (ch === 'file:importImage') { const m = sniffMain(b); if (!m) throw new Error('not a supported image'); return { file: 'm-' + (a || 'image'), name: a || 'image', mime: m, size: b.length }; }
    if (ch === 'web:dropImage') { if (/^(file|javascript|data):/i.test(a) || /127\\.0\\.0\\.1|localhost/.test(a)) throw new Error('blocked URL'); if (/403/.test(a)) throw new Error('HTTP 403'); if (/page\\.html|fake|example\\.org/.test(a)) throw new Error('not an image (text/html)'); return { file: 'm-web', name: 'web.jpg', mime: 'image/jpeg', size: 5000, url: a }; }
    throw new Error('unexpected ' + ch);
  },
  importBuffer: async (name, b) => ({ file: 'm-' + name, name, mime: '', size: b.length }),
};
const kindOf = (name, mime) => /^image\\//.test(mime || '') || /\\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(name || '') ? 'image' : 'file';
const Features = {
  addMedia: async (r, x, y) => { const it = { type: kindOf(r.name || r.file, r.mime), file: r.file, name: r.name }; __out.push(it); return it; },
  addLinkUrl: async (url) => { const it = { type: 'link', url, title: hostOf(url) }; __out.push(it); return it; },
  addAt: (p) => { const it = { ...p }; __out.push(it); return it; },
  importFiles: async (files) => { for (const f of files) __out.push({ type: kindOf(f.name, f.type), name: f.name, viaPath: true }); },
};
const Items = { mount() {}, render() {} }; const Store = { save() {}, state: { settings: {} } }; const Canvas = { startMove() {} };
const V2 = {}; const $ = () => null; const h = () => null; const iconSvg = () => ''; const plainText = (s) => String(s || ''); const sanitize = (s) => s;
`;
process.on('unhandledRejection', (e) => { console.log('FATAL', e && e.stack || e); app.exit(2); });
app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-dndb-'));
  fs.writeFileSync(path.join(dir, 'stubs.js'), STUBS);
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><script src="stubs.js"></script><script src="${'file://' + path.join(ROOT, 'app/js/v26/dnd.js')}"></script><script src="${'file://' + path.join(ROOT, 'tests/fixtures/dnd-payloads.js')}"></script>`);
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('CONSOLE', e.message); });
  await w.loadFile(path.join(dir, 'index.html'));
  const res = await w.webContents.executeJavaScript(`(async () => {
    // tiny but valid magic-byte headers
    const png = new Uint8Array([0x89,0x50,0x4e,0x47,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0]);
    const jpg = new Uint8Array([0xff,0xd8,0xff,0xe0,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0,0xff,0xd9]);
    const bmp = new Uint8Array(60); bmp[0] = 0x42; bmp[1] = 0x4d;
    const file = (bytes, name, type, o = {}) => { let f = new File([bytes], name, { type }); if (o.broken) { Object.defineProperty(f, 'arrayBuffer', { value: () => Promise.reject(new DOMException('A requested file could not be found', 'NotFoundError')) }); } if (o.path) __paths.set(f, o.path); return f; };
    const out = [];
    const run = async (c, mutate) => {
      __out.length = 0; __toasts.length = 0; __calls.length = 0; if (DnD.diag) DnD.diag.length = 0;
      const dt = mutate ? mutate(c.dt) : c.dt;
      let p = {}; try { const s = DnD.snapshot(dt); p = DnD.plan(s, ''); await DnD.handle(s, { x: 0, y: 0 }, {}); } catch (err) { return { name: c.name, ok: false, errs: ['threw ' + err.message] }; }
      const tried = DnD.diag?.at(-1)?.tried || []; const e = c.expect; const errs = [];
      const types = __out.map(i => i.type);
      if (JSON.stringify(types) !== JSON.stringify(e.types)) errs.push('cards ' + JSON.stringify(types) + ' ≠ ' + JSON.stringify(e.types));
      if (e.via && !tried.includes(e.via + ':ok')) errs.push('via ' + e.via + ' (tried ' + tried.join(' | ') + ')');
      if (e.source && __out[0]?.source !== e.source) errs.push('source ' + __out[0]?.source);
      if (e.title && __out[0]?.title !== e.title) errs.push('title ' + __out[0]?.title);
      if (e.src && !__calls.some(x => x === 'web:dropImage ' + e.src)) errs.push('src not downloaded: ' + __calls.join(','));
      if (e.toast && !__toasts.some(x => x.includes(e.toast))) errs.push('toast ' + e.toast + ' missing: ' + __toasts.join(' / '));
      if (e.noToast && __toasts.length) errs.push('unexpected toast ' + __toasts.join(' / '));
      if (__calls.some(x => /web:dropImage (file|javascript|data):/i.test(x))) errs.push('unsafe download attempted');
      return { name: c.name + (mutate ? ' [types reversed]' : ''), ok: !errs.length, errs, plan: p.kind, tried };
    };
    for (const c of makeCases({ png, jpg, bmp, file })) out.push(await run(c));
    // types list ordering must not matter
    for (const c of makeCases({ png, jpg, bmp, file })) out.push(await run(c, (d) => ({ ...d, types: [...d.types].reverse(), items: d.items && [...d.items].reverse() })));
    // pure helpers
    const H = !DnD.sniff ? [] : [
      ['sniff png/jpeg/gif/webp/bmp, rejects svg/html', DnD.sniff(png) === 'image/png' && DnD.sniff(jpg) === 'image/jpeg' && DnD.sniff(new TextEncoder().encode('GIF89a......')) === 'image/gif' && DnD.sniff(new TextEncoder().encode('RIFF....WEBPVP8 ')) === 'image/webp' && DnD.sniff(bmp) === 'image/bmp' && !DnD.sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')) && !DnD.sniff(new TextEncoder().encode('<html><body>hi</body></html>'))],
      ['mozUrls pairs', JSON.stringify(DnD.mozUrls('https://a.gr\\nA\\nhttps://b.gr\\nB')) === JSON.stringify([{ url: 'https://a.gr', title: 'A' }, { url: 'https://b.gr', title: 'B' }])],
      ['downloadUrl', DnD.downloadUrl('image/png:p.png:https://x.gr/p')?.url === 'https://x.gr/p' && DnD.downloadUrl('nonsense') === null],
      ['isShortcut', DnD.isShortcut(new TextEncoder().encode('[InternetShortcut]\\r\\nURL=https://a.gr/x\\r\\n')) === 'https://a.gr/x' && DnD.isShortcut(new TextEncoder().encode('[InternetShortcut]\\r\\nURL=file:///C:/x')) === ''],
      ['isTempPath', DnD.isTempPath('C:\\\\Users\\\\u\\\\AppData\\\\Local\\\\Temp\\\\abc') && !DnD.isTempPath('C:\\\\Docs\\\\abc')],
      ['plainUrls only when every line is a URL', DnD.plainUrls('https://a.gr\\r\\nhttps://b.gr').length === 2 && DnD.plainUrls('see https://a.gr').length === 0],
    ];
    if (DnD.sniff) for (const [n, ok] of H) out.push({ name: 'helper: ' + n, ok, errs: ok ? [] : ['failed'] });
    return out;
  })()`);
  let bad = 0; for (const r of res) { if (!r.ok) bad++; console.log(r.ok ? 'PASS' : 'FAIL', r.name, r.ok ? '' : JSON.stringify(r.errs) + ' plan=' + r.plan + ' tried=' + (r.tried || []).join(' | ')); }
  console.log(`dnd-browsers: ${res.length - bad}/${res.length} OK`);
  fs.rmSync(dir, { recursive: true, force: true }); app.exit(bad ? 1 : 0);
});
