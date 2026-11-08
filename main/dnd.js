'use strict';
// v2.6.1 — drag & drop between Nyx and Windows.
//  • drag OUT: cards → Explorer / desktop / other apps via webContents.startDrag (needs REAL files + a non-empty icon on
//    Windows). Media cards are hard-linked (or copied) to a temp folder under their original name, text cards become .txt,
//    link/web cards become .url shortcuts. Temp folders older than a day are removed on the next drag.
//  • built-in browser: a tiny isolated-world listener in each <webview> page reports dragstart/dragend through a console
//    marker, so the canvas can show a drop strip even when the browser panel covers it. Pages cannot use it for anything
//    else (it only shows/hides that strip). Guests may never navigate to file: (a file dropped on the page).
// Pure parts (plan/safeName/urlShortcut) have no Electron dependency → unit-tested in tests/dnd-unit.js.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const TMP_ROOT = () => path.join(os.tmpdir(), 'nyx-drag');
const MAX_ITEMS = 50, MAX_TEXT = 5 * 1024 * 1024, COPY_LIMIT = 512 * 1024 * 1024;
const MARK = '\u2063nyx-drag:';

function safeName(n, def = 'file') {
  let s = path.basename(String(n || '').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/[. ]+$/, '').trim().slice(0, 150);
  if (!s || /^\.+$/.test(s)) s = def;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(s)) s = '_' + s;
  return s;
}
const MEDIA_PREFIX = /^[a-z0-9]{5,12}-[a-f0-9]{6}-/;
function urlShortcut(href) { return '[InternetShortcut]\r\nURL=' + href + '\r\n'; }
// renderer payload → what to put on disk. Never reads outside mediaDir (basename only).
function plan(list, mediaDir) {
  const out = [];
  for (let f of (Array.isArray(list) ? list : [list]).slice(0, MAX_ITEMS)) {
    if (typeof f === 'string') f = { file: f };
    if (!f || typeof f !== 'object') continue;
    if (f.file) {
      const src = path.join(mediaDir, path.basename(String(f.file)));
      const ext = path.extname(src).toLowerCase();
      let name = safeName(f.name || path.basename(src).replace(MEDIA_PREFIX, ''), 'file' + ext);
      if (ext && path.extname(name).toLowerCase() !== ext) name += ext;
      out.push({ kind: 'file', src, name });
    } else if (f.url) {
      let u; try { u = new URL(String(f.url)); } catch (e) { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      out.push({ kind: 'text', name: safeName(String(f.name || u.hostname).replace(/\.url$/i, ''), 'link') + '.url', content: urlShortcut(u.href) });
    } else if (f.text != null) {
      let name = safeName(f.name || 'note.txt', 'note.txt'); if (!/\.(txt|md|csv|json|html?)$/i.test(name)) name += '.txt';
      let txt = String(f.text).slice(0, MAX_TEXT); if (process.platform === 'win32') txt = txt.replace(/\r?\n/g, '\r\n'); // Notepad-friendly
      out.push({ kind: 'text', name, content: txt });
    }
  }
  return out;
}
function uniqueIn(dir, name, used) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length); let n = name;
  for (let i = 1; used.has(n.toLowerCase()); i++) n = `${base} (${i})${ext}`;
  used.add(n.toLowerCase()); return path.join(dir, n);
}
// write the plan to a fresh temp folder → absolute paths
function materialize(steps) {
  const dir = path.join(TMP_ROOT(), Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true }); const used = new Set(); const paths = [];
  for (const s of steps) {
    try {
      if (s.kind === 'file') {
        const st = fs.statSync(s.src); if (!st.isFile()) continue;
        const dst = uniqueIn(dir, s.name, used);
        try { fs.linkSync(s.src, dst); paths.push(dst); continue; } catch (e) {}
        if (st.size <= COPY_LIMIT) { fs.copyFileSync(s.src, dst); paths.push(dst); } else paths.push(s.src); // huge + other drive → the media file itself
      } else { const dst = uniqueIn(dir, s.name, used); fs.writeFileSync(dst, s.content, 'utf8'); paths.push(dst); }
    } catch (e) { console.error('drag-out', s.name, e.message); }
  }
  return paths;
}
let cleaned = false;
function cleanup(maxAgeMs = 24 * 3600e3) {
  if (cleaned) return; cleaned = true;
  fs.promises.readdir(TMP_ROOT()).then(ds => Promise.all(ds.map(async d => { const p = path.join(TMP_ROOT(), d); try { const st = await fs.promises.stat(p); if (Date.now() - st.mtimeMs > maxAgeMs) await fs.promises.rm(p, { recursive: true, force: true }); } catch (e) {} }))).catch(() => {});
}
const IMG = /\.(png|jpe?g|gif|webp|bmp|ico)$/i;
function dragIcon(nativeImage, paths, appIcon) {
  let icon = null;
  const first = paths.find(p => IMG.test(p));
  if (first) { try { icon = nativeImage.createFromPath(first); } catch (e) { icon = null; } }
  if (!icon || icon.isEmpty()) { try { icon = nativeImage.createFromPath(appIcon); } catch (e) { icon = null; } }
  if (!icon || icon.isEmpty()) { const b = Buffer.alloc(48 * 48 * 4); for (let i = 0; i < b.length; i += 4) { b[i] = 0xf0; b[i + 1] = 0x8a; b[i + 2] = 0x6c; b[i + 3] = 0xff; } icon = nativeImage.createFromBitmap(b, { width: 48, height: 48 }); } // BGRA accent square
  const s = icon.getSize(); const k = 96 / Math.max(s.width, s.height, 1);
  return k < 1 ? icon.resize({ width: Math.max(1, Math.round(s.width * k)), height: Math.max(1, Math.round(s.height * k)), quality: 'good' }) : icon;
}
// ipcMain.on('drag:start') — must be synchronous: the OS drag starts while the mouse button is still down
function startDrag(wc, list, { mediaDir, nativeImage, appIcon }) {
  cleanup();
  const paths = materialize(plan(list, mediaDir));
  if (!paths.length) return { ok: false, paths };
  const icon = dragIcon(nativeImage, paths, appIcon);
  wc.startDrag(paths.length > 1 ? { file: paths[0], files: paths, icon } : { file: paths[0], icon });
  return { ok: true, paths };
}
// ---- built-in browser (webview guests)
const GUEST_JS = `(()=>{if(window.__nyxDrag)return;window.__nyxDrag=1;const M=${JSON.stringify(MARK)};addEventListener('dragstart',e=>{console.debug(M+'start')},true);addEventListener('dragend',()=>{console.debug(M+'end')},true)})()`;
function watchGuest(wc, send) {
  wc.on('will-navigate', (e, url) => { if (/^file:/i.test(String(url))) e.preventDefault(); }); // a file dropped on the page
  wc.on('dom-ready', () => { try { wc.executeJavaScriptInIsolatedWorld(1061, [{ code: GUEST_JS }]).catch(() => {}); } catch (e) {} });
  wc.on('console-message', (e, ...rest) => {
    const msg = String(e?.message ?? rest[1] ?? ''); if (!msg.startsWith(MARK)) return;
    send('browser:drag', { on: msg.endsWith('start'), wc: wc.id });
  });
}
module.exports = { plan, safeName, urlShortcut, materialize, startDrag, watchGuest, dragIcon, TMP_ROOT, MARK, GUEST_JS };
