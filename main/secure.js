'use strict';
// v2.5.1 — window/webContents security policy in one place.
//  • appPrefs(): every app window → contextIsolation, sandbox, no Node, webSecurity on, minimal preload only.
//  • harden(): app windows may only show the app's own pages; window.open is denied; external links (http/https/mailto)
//    go to the system browser via shell.openExternal; anything else is blocked.
//  • The app window never loads remote http(s) content itself: remote pictures (favicons, link previews, TV posters,
//    in-app-browser tab icons) are fetched by the main process through the private "nyx-img:" scheme
//    (http(s) only, images only, size-capped, no cookies) and an app-window request to http(s)/ws(s) is cancelled.
const path = require('path');
const { app, shell, protocol, session, net } = require('electron');
const guard = require('./ipc-guard');
const { fileURLToPath } = require('url');
const { isInside } = require('./fsutil');

const CODE = path.join(__dirname, '..');
const PRELOAD = path.join(CODE, 'preload.js');
const appWcIds = new Set();

function appPrefs(extra = {}) {
  return {
    preload: PRELOAD,
    contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
    webSecurity: true, allowRunningInsecureContent: false, experimentalFeatures: false, enableBlinkFeatures: '', navigateOnDragDrop: false,
    webviewTag: false, ...extra,
  };
}
const EXTERNAL = /^(https?|mailto):/i;
function openExternal(url) { try { if (EXTERNAL.test(url)) { shell.openExternal(url); return true; } } catch (e) {} return false; }

function harden(win, { webview = false } = {}) {
  const wc = win.webContents; appWcIds.add(wc.id); if (webview) wc.__nyxAllowWebview = true;
  const id = wc.id; wc.once('destroyed', () => appWcIds.delete(id));
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  const nav = (e, url) => { if (guard.isAppPageUrl(url)) return; e.preventDefault(); openExternal(url); };
  wc.on('will-navigate', nav);
  wc.on('will-redirect', nav);
  wc.on('will-frame-navigate', (e) => { if (!e.isMainFrame && !/^(about:blank|about:srcdoc)$/.test(e.url) && !guard.isAppPageUrl(e.url)) e.preventDefault(); });
  // <webview> only in the main window (wired by main.js); every other app window refuses to attach one
  return win;
}
const isAppWc = (wc) => !!wc && appWcIds.has(wc.id);

// ---------- nyx-img: remote pictures fetched by main ----------
protocol.registerSchemesAsPrivileged([{ scheme: 'nyx-img', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false } }]);
const IMG_CT = /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)\b/i;
const MAX_IMG = 12 * 1024 * 1024;
const cache = new Map(); // url → { ct, buf } (LRU, ~300 items)
async function fetchImage(target) {
  const u = new URL(target);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error('blocked');
  if (cache.has(target)) { const v = cache.get(target); cache.delete(target); cache.set(target, v); return v; }
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await net.fetch(target, { signal: ctl.signal, credentials: 'omit', redirect: 'follow', headers: { Accept: 'image/avif,image/webp,image/png,image/*;q=0.8' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ct = String(r.headers.get('content-type') || ''); if (!IMG_CT.test(ct)) throw new Error('not an image');
    if (+r.headers.get('content-length') > MAX_IMG) throw new Error('too big');
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX_IMG) throw new Error('too big');
    const v = { ct: ct.split(';')[0], buf }; cache.set(target, v); while (cache.size > 300) cache.delete(cache.keys().next().value);
    return v;
  } finally { clearTimeout(tm); }
}
function wireSession({ scriptDir } = {}) {
  const ses = session.defaultSession;
  protocol.handle('nyx-img', async (req) => {
    try {
      const target = new URL(req.url).searchParams.get('u') || '';
      const { ct, buf } = await fetchImage(target);
      return new Response(buf, { status: 200, headers: { 'content-type': ct, 'cache-control': 'max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } });
    } catch (e) { return new Response('', { status: 404 }); }
  });
  // No remote http(s)/ws(s) loads from app windows (main-process net.fetch has no webContents and is unaffected;
  // the in-app browser uses its own partition/session).
  // v2.6.3: Electron keeps ONE onBeforeRequest listener per session (a second call replaces the first), so the v2.6 B-14
  // rule (app windows may only load scripts from the app folder) lives in this same listener.
  const norm = (p) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  const scriptOk = (url) => {
    if (!scriptDir) return true;
    let p = ''; try { p = fileURLToPath(url); } catch (e) { return false; }
    return isInside(norm(scriptDir), norm(p));
  };
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file:///*'] }, (d, cb) => {
    if (/^file:/i.test(d.url)) {
      if (d.resourceType !== 'script') return cb({});
      const ok = scriptOk(d.url); if (!ok) console.warn('[nyx] blocked script', d.url.slice(0, 200));
      return cb({ cancel: !ok });
    }
    const wcId = d.webContents ? d.webContents.id : d.webContentsId;
    const block = wcId != null && appWcIds.has(wcId);
    if (block && process.env.NYX_TEST) console.warn('[nyx] blocked remote load from app window:', d.url.slice(0, 120));
    cb({ cancel: block });
  });
}
// Global net for any webContents created later (popups, hidden reader windows…): no new windows from app windows,
// web popups / hidden reader windows only navigate to http(s) and cannot open further windows.
function onWebContentsCreated(_e, wc, { webSession }) {
  if (wc.getType() === 'webview') return; // handled by v2 (tabs/popups) + will-attach-webview
  if (webSession && wc.session === webSession()) {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, url) => { if (!/^(https?:|about:blank)/i.test(url)) e.preventDefault(); });
    wc.on('will-attach-webview', (e) => e.preventDefault());
    return;
  }
  wc.on('will-attach-webview', (e) => { if (!isAppWc(wc) || !wc.__nyxAllowWebview) e.preventDefault(); });
}
const appProtocolOk = (u) => guard.isAppPageUrl(u);
module.exports = { appPrefs, harden, isAppWc, wireSession, onWebContentsCreated, openExternal, appProtocolOk, PRELOAD, _fetchImage: fetchImage };
