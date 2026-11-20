'use strict';
const i18n = require('./main/i18n'); const { t, tr } = i18n;
const updater = require('./main/updater');
// Nyx Canvas — Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, Notification, globalShortcut, nativeImage, screen, session, net, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { pathToFileURL } = require('url');
// v2.5.1: every ipcMain channel goes through one guard (trusted app page sender + argument schema)
require('./main/ipc-guard').install(ipcMain, { appDir: path.join(__dirname, 'app') });
const secure = require('./main/secure');
// v2.5.1: never run with Chromium's sandbox or web security switched off (e.g. a shortcut or launcher adding such switches)
for (const sw of ['no-sandbox', 'disable-web-security', 'disable-gpu-sandbox', 'disable-site-isolation-trials']) if (app.commandLine.hasSwitch(sw)) { console.error('[nyx] refusing to start with --' + sw); app.exit(1); process.exit(1); }
// Never let a stray plugin/timer exception pop the blocking "JavaScript error in main process" dialog.
process.on('uncaughtException', (e) => { try { console.error('[nyx] uncaught', e && (e.stack || e.message || e)); } catch {} });
process.on('unhandledRejection', (e) => { try { console.error('[nyx] unhandled rejection', e && (e.message || e)); } catch {} });

app.setName('Nyx Canvas');
if (process.platform === 'win32') app.setAppUserModelId('gr.jonh.nyxcanvas');

// Data location: NYX_DATA_DIR (tests) > portable "NyxData" folder next to the exe > custom folder (Syncthing) > userData
let PORTABLE = false, CUSTOM_ROOT = null;
if (process.env.NYX_DATA_DIR) app.setPath('userData', process.env.NYX_DATA_DIR);
else {
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  const pd = path.join(exeDir, 'NyxData');
  if (app.isPackaged && fs.existsSync(pd)) { PORTABLE = true; app.setPath('userData', pd); }
  else { try { const loc = JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), 'Nyx Canvas', 'location.json'), 'utf8')); if (loc.dir && fs.existsSync(loc.dir)) CUSTOM_ROOT = loc.dir; } catch (e) {} }
}
const v2 = require('./main/v2');
// v2.3: Chromium formats <input type=date> by the UI locale — Greek/en-GB are day-first (30/11), unlike en-US (11/30)
try { let lang = 'el'; try { const m = fs.readFileSync(path.join(CUSTOM_ROOT || app.getPath('userData'), 'data', 'nyx.json'), 'utf8').match(/"lang"\s*:\s*"(en|el)"/); if (m) lang = m[1]; } catch (e) {} app.commandLine.appendSwitch('lang', lang === 'en' ? 'en-GB' : 'el'); } catch (e) {}

const gotLock = process.env.NYX_TEST ? true : app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

const USER = () => app.getPath('userData');
const DATA_ROOT = () => CUSTOM_ROOT || USER();
const DATA_DIR = () => path.join(DATA_ROOT(), 'data');
const MEDIA_DIR = () => path.join(DATA_ROOT(), 'media');
const BACKUP_DIR = () => path.join(DATA_ROOT(), 'backups');
const DATA_FILE = () => path.join(DATA_DIR(), 'nyx.json');
const ICON = path.join(__dirname, 'app', 'assets', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'app', 'assets', 'tray.png');

let mainWin = null, widgetWin = null, tray = null;
let lastState = null;          // last parsed state (for scheduler/widget)
let lastStateText = null;
let quitting = false;
const firedKeys = new Set();

function ensureDirs() { for (const d of [DATA_DIR(), MEDIA_DIR(), BACKUP_DIR()]) fs.mkdirSync(d, { recursive: true }); }

// ---------- persistence ----------
// v2.2: serialized + unique tmp + retry rename (Windows AV / Syncthing / indexer can briefly lock the file → EPERM/EBUSY)
// v2.6: fsync before rename + a write generation: the async queue and the synchronous flush (quit / hide) share
// one ordering, so an older queued write can never land after a newer one (stale-state overwrite).
let writeChain = Promise.resolve();
let writeGen = 0, committedGen = 0, diskText = null;
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {} };
function atomicWrite(file, text) {
  const gen = ++writeGen;
  const job = writeChain.then(() => atomicWriteNow(file, text, gen));
  writeChain = job.catch(() => {});
  return job;
}
async function atomicWriteNow(file, text, gen) {
  if (gen < committedGen) return false; // a newer state is already on disk
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try { await fh.writeFile(text, 'utf8'); await fh.sync(); } finally { await fh.close(); }
  for (let i = 0; ; i++) {
    // check + rename in the same synchronous block → no interleaving with state:saveSync
    if (gen < committedGen) { await fsp.unlink(tmp).catch(() => {}); return false; }
    try { fs.renameSync(tmp, file); committedGen = gen; diskText = text; return true; }
    catch (e) { if (i >= 6 || !/EPERM|EBUSY|EACCES/.test(e.code || '')) { await fsp.unlink(tmp).catch(() => {}); throw e; } await new Promise(r => setTimeout(r, 40 * (i + 1))); }
  }
}
function atomicWriteSync(file, text) {
  const gen = ++writeGen;
  const tmp = `${file}.${process.pid}.sync${Math.random().toString(36).slice(2, 6)}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); break; }
    catch (e) { if (i >= 6 || !/EPERM|EBUSY|EACCES/.test(e.code || '')) { try { fs.copyFileSync(tmp, file); fs.unlinkSync(tmp); break; } catch (_) { try { fs.unlinkSync(tmp); } catch (__) {} throw e; } } sleepSync(30 * (i + 1)); }
  }
  committedGen = gen; diskText = text;
}
async function dailyBackup(text) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const f = path.join(BACKUP_DIR(), `nyx-${day}.json`);
    if (!fs.existsSync(f)) {
      await fsp.writeFile(f, text, 'utf8');
      const files = (await fsp.readdir(BACKUP_DIR())).filter(x => x.startsWith('nyx-')).sort();
      while (files.length > 14) await fsp.unlink(path.join(BACKUP_DIR(), files.shift()));
    }
  } catch (e) { console.error('backup', e); }
}
function loadState() {
  let tmps = [];
  try { const dir = path.dirname(DATA_FILE()), base = path.basename(DATA_FILE()); tmps = fs.readdirSync(dir).filter(x => x.startsWith(base + '.') && x.endsWith('.tmp')).map(x => path.join(dir, x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); } catch (e) {}
  for (const f of [DATA_FILE(), ...tmps]) {
    try { const t = fs.readFileSync(f, 'utf8'); const s = JSON.parse(t); lastState = s; lastStateText = t; if (f === DATA_FILE()) diskText = t; for (const x of tmps) if (x !== f) fs.rmSync(x, { force: true }); return t; } catch (e) { /* try next */ }
  }
  // fall back to newest backup
  try {
    const files = fs.readdirSync(BACKUP_DIR()).filter(x => x.startsWith('nyx-')).sort();
    if (files.length) { const t = fs.readFileSync(path.join(BACKUP_DIR(), files.pop()), 'utf8'); JSON.parse(t); lastState = JSON.parse(t); return t; }
  } catch (e) {}
  return null;
}

function uniqueName(orig) {
  const ext = path.extname(orig || '').toLowerCase().slice(0, 10) || '';
  const base = path.basename(orig || 'file', path.extname(orig || '')).replace(/[^\p{L}\p{N}_.-]+/gu, '_').slice(0, 40) || 'file';
  return `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${base}${ext}`;
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.m4v': 'video/mp4', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/opus', '.weba': 'audio/webm',
  '.txt': 'text/plain', '.md': 'text/markdown', '.pdf': 'application/pdf', '.json': 'application/json', '.html': 'text/html', '.csv': 'text/csv' };
const mimeOf = f => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

// ---------- windows ----------
function overlayColors(theme) {
  return { color: theme?.bar || '#00000000', symbolColor: theme?.text || '#e8e8f0', height: 44 };
}
function createMain() {
  mainWin = new BrowserWindow({
    width: 1400, height: 880, minWidth: 720, minHeight: 480,
    show: false, backgroundColor: '#05060a', icon: ICON, title: 'Nyx Canvas',
    titleBarStyle: 'hidden', titleBarOverlay: overlayColors(),
    autoHideMenuBar: true,
    webPreferences: secure.appPrefs({ spellcheck: true, backgroundThrottling: false, webviewTag: true })
  });
  secure.harden(mainWin, { webview: true });
  mainWin.setMenuBarVisibility(false);
  mainWin.webContents.on('will-attach-webview', v2.onWillAttachWebview);
  mainWin.loadFile(path.join(__dirname, 'app', 'index.html'));
  // v2.6 (B-23): started at login (--hidden) → never shown, stays in the tray (no flash)
  mainWin.once('ready-to-show', () => { if (!process.env.NYX_HIDDEN && !process.argv.includes('--hidden')) { mainWin.show(); } });
  mainWin.on('close', (e) => {
    const closeToTray = lastState?.settings?.closeToTray !== false;
    if (!quitting && closeToTray && tray) {
      e.preventDefault(); try { mainWin.webContents.send('state:flush'); } catch (err) {} mainWin.hide();
      if (!app._toldTray) { app._toldTray = true; notify('Nyx Canvas', t('main.001')); }
    }
  });
  // v2.6 (B-30): Electron ≥ 35 passes a single event object (level: 'info'|'warning'|'error'|'debug')
  if (process.env.NYX_TEST) mainWin.webContents.on('console-message', (e) => { if (e.level === 'warning' || e.level === 'error') console.log('[renderer]', e.message); });
}
function showMain(focusId) {
  if (!mainWin) createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
  if (focusId) mainWin.webContents.send('focus-item', focusId);
}
function widgetBounds() {
  const wb = lastState?.settings?.widget?.bounds;
  const area = screen.getPrimaryDisplay().workArea;
  if (wb && wb.width > 200) return wb;
  return { width: 380, height: Math.min(720, area.height - 40), x: area.x + area.width - 400, y: area.y + 20 };
}
function createWidget() {
  const b = widgetBounds();
  widgetWin = new BrowserWindow({
    ...b, minWidth: 280, minHeight: 240, frame: false, transparent: true, resizable: true, alwaysOnTop: lastState?.settings?.widget?.onTop !== false,
    skipTaskbar: true, show: false, hasShadow: false, icon: ICON, title: 'Nyx Widget', backgroundColor: '#00000000',
    webPreferences: secure.appPrefs({ backgroundThrottling: false })
  });
  secure.harden(widgetWin);
  widgetWin.loadFile(path.join(__dirname, 'app', 'widget.html'));
  widgetWin.once('ready-to-show', () => { if (!process.env.NYX_HIDDEN) widgetWin.showInactive(); });
  const saveBounds = () => { if (widgetWin && !widgetWin.isDestroyed()) mainWin?.webContents.send('widget-bounds', widgetWin.getBounds()); };
  widgetWin.on('moved', saveBounds); widgetWin.on('resized', saveBounds);
  widgetWin.on('closed', () => { widgetWin = null; mainWin?.webContents.send('widget-state', false); refreshTray(); });
  mainWin?.webContents.send('widget-state', true);
}
function toggleWidget(force) {
  const want = typeof force === 'boolean' ? force : !(widgetWin && widgetWin.isVisible());
  if (want) { if (!widgetWin) createWidget(); else widgetWin.showInactive(); }
  else if (widgetWin) widgetWin.close();
  refreshTray();
  return want;
}
let clickThrough = false;
function setClickThrough(on) {
  clickThrough = !!on;
  if (widgetWin) { widgetWin.setIgnoreMouseEvents(clickThrough, { forward: true }); widgetWin.webContents.send('click-through', clickThrough); }
  refreshTray();
}

// ---------- tray ----------
function refreshTray() {
  if (!tray) return;
  const loginOn = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('main.002'), click: () => showMain() },
    { label: (widgetWin ? t('main.003') : t('main.004')) + ' Widget   (Ctrl+Alt+N)', click: () => toggleWidget() },
    { label: t('main.005'), type: 'checkbox', checked: clickThrough, enabled: !!widgetWin, click: (m) => setClickThrough(m.checked) },
    { type: 'separator' },
    { label: t('main.006'), type: 'checkbox', checked: loginOn, click: (m) => setLogin(m.checked) },
    { label: t('main.007'), click: () => v2.openCapture() },
    { label: t('main.008'), click: () => shell.openPath(DATA_ROOT()) },
    { type: 'separator' },
    { label: t('main.009'), click: () => { quitting = true; app.quit(); } }
  ]));
}
function setLogin(on) {
  try { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); } catch (e) {}
  refreshTray();
}
function notify(title, body, focusId) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: ICON, silent: true });
    n.on('click', () => showMain(focusId));
    n.show();
  } catch (e) { console.error(e); }
}

// ---------- scheduler: reminders + subscription renewals ----------
function addCycle(dateStr, cycle) {
  const d = new Date(dateStr + 'T00:00:00');
  if (cycle === 'weekly') d.setDate(d.getDate() + 7);
  else if (cycle === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function tick() {
  const s = lastState; if (!s) return;
  const now = Date.now();
  for (const b of s.boards || []) for (const it of b.items || []) {
    const r = it.reminder;
    if (!r || !r.on || !r.at) continue;
    const at = new Date(r.at).getTime();
    if (isNaN(at) || at > now) continue;
    const key = it.id + '@' + r.at;
    if (firedKeys.has(key)) continue;
    firedKeys.add(key);
    if (now - at > 1000 * 60 * 60 * 24 * 3 && r.repeat === 'none') continue; // too old, skip silently
    const title = '⏰ ' + (r.msg || it.title || plain(it.html) || t('features.007'));
    notify(title.slice(0, 120), `${b.name} · ${new Date(at).toLocaleString('el-GR')}`, it.id);
    const payload = { id: it.id, boardId: b.id, title, sound: r.sound || 'chime', at: r.at };
    mainWin?.webContents.send('reminder-fire', payload);
    widgetWin?.webContents.send('reminder-fire', payload);
  }
  for (const sub of s.subs || []) {
    if (!sub.next || sub.active === false || !(sub.remindDays >= 0)) continue;
    const due = new Date(sub.next + 'T10:00:00').getTime() - sub.remindDays * 864e5;
    const key = 'sub:' + sub.id + '@' + sub.next;
    if (now >= due && now < due + 864e5 * (sub.remindDays + 1) && !firedKeys.has(key) && !(s.firedSubs || []).includes(key)) {
      firedKeys.add(key);
      notify(t('main.010', { name: sub.name }), t('main.011', { v0: sub.price ?? '', v1: sub.currency || '€', v2: new Date(sub.next).toLocaleDateString('el-GR') }));
      mainWin?.webContents.send('sub-fire', { id: sub.id, key, sound: s.settings?.subSound || 'soft' });
    }
  }
}
const plain = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

// ---------- web helpers (tracker / TVmaze / link titles) ----------
async function fetchText(url, { timeout = 15000, accept } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error(tr('main.012'));
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 NyxCanvas/1.0', 'Accept': accept || 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'el,en;q=0.8' } });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: text.slice(0, 4_000_000), url: res.url };
  } finally { clearTimeout(t); }
}
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
async function checkTracker({ url, keyword, session: viaBrowser, selector }) {
  let r;
  if (viaBrowser) { const rt = await v2.renderText(url, { selector }); r = { ok: true, status: 200, text: rt.text, url: rt.url, title: rt.title }; }
  else r = await fetchText(url);
  const text = !viaBrowser && /<html|<body|<div/i.test(r.text) ? htmlToText(r.text) : r.text;
  const titleM = viaBrowser ? [0, r.title || ''] : r.text.match(/<title[^>]*>([^<]*)<\/title>/i);
  const kws = String(keyword || '').split(',').map(s => s.trim()).filter(Boolean);
  const ntext = norm(text);
  let count = 0; const snippets = [];
  for (const kw of kws) {
    const nk = norm(kw); if (!nk) continue;
    let i = 0;
    while ((i = ntext.indexOf(nk, i)) !== -1) {
      count++;
      if (snippets.length < 5) snippets.push(text.slice(Math.max(0, i - 70), i + nk.length + 70).trim());
      i += nk.length;
    }
  }
  const hash = crypto.createHash('sha1').update(kws.length ? snippets.join('|') + '#' + count : text).digest('hex').slice(0, 16);
  return { ok: r.ok, status: r.status, count, snippets, hash, title: titleM ? htmlToText(titleM[1]).slice(0, 120) : '', checkedAt: new Date().toISOString(), size: text.length, excerpt: kws.length ? '' : text.slice(0, 400) };
}
// v2.6 (B-26): one run at a time (5-min interval + «Έλεγχος όλων»); a forced run during a run is queued once
let trackerJob = null, trackerForce = false;
function runTrackers(force) {
  if (trackerJob) { if (force) trackerForce = true; return trackerJob; }
  trackerJob = (async () => {
    try { await runTrackersNow(force); while (trackerForce) { trackerForce = false; await runTrackersNow(true); } }
    finally { trackerJob = null; trackerForce = false; }
  })();
  return trackerJob;
}
async function runTrackersNow(force) {
  const s = lastState; if (!s || !mainWin) return;
  const now = Date.now();
  for (const b of s.boards || []) for (const it of b.items || []) {
    if (it.type !== 'tracker' || !it.url) continue;
    const every = Math.max(5, Number(it.interval) || 60) * 60000;
    const last = it.checkedAt ? new Date(it.checkedAt).getTime() : 0;
    if (!force && now - last < every) continue;
    let res;
    try { res = await checkTracker(it); } catch (e) { res = { ok: false, error: String(e.message || e), checkedAt: new Date().toISOString() }; }
    if (res.ok && it.hash && res.hash !== it.hash) res.changed = true;
    if (res.ok && it.hash && res.hash !== it.hash) notify(t('main.013', { v0: it.keyword || it.url }), t('main.014', { count: res.count, hostname: new URL(it.url).hostname }), it.id);
    mainWin?.webContents.send('tracker-result', { id: it.id, ...res });
  }
}

// ---------- IPC ----------
function wireIpc() {
  ipcMain.handle('state:load', () => ({ text: loadState(), mediaBase: pathToFileURL(MEDIA_DIR()).href + '/', userData: DATA_ROOT(), portable: PORTABLE, version: require('./package.json').version, platform: process.platform, loginItem: app.getLoginItemSettings().openAtLogin, widgetOpen: !!widgetWin }));
  ipcMain.handle('state:save', async (_e, text) => {
    try { lastState = JSON.parse(text); i18n.setLang(lastState?.settings?.lang); } catch (e) { return { ok: false, error: 'bad json' }; }
    lastStateText = text;
    await atomicWrite(DATA_FILE(), text);
    dailyBackup(text);
    widgetWin?.webContents.send('state', text);
    v2.broadcastState(text);
    return { ok: true };
  });
  // v2.2: synchronous flush from the renderer's beforeunload / hide-to-tray → the last <350 ms of edits are never lost on quit
  ipcMain.on('state:saveSync', (e, text) => {
    try { const st = JSON.parse(text); if (text !== diskText || committedGen < writeGen) { atomicWriteSync(DATA_FILE(), text); } lastState = st; lastStateText = text; e.returnValue = { ok: true }; }
    catch (err) { e.returnValue = { ok: false, error: String(err.message || err) }; }
  });
  ipcMain.handle('state:get', () => lastStateText);
  ipcMain.handle('media:importPath', async (_e, p) => {
    const st = await fsp.stat(p); if (!st.isFile()) throw new Error('not a file');
    const name = uniqueName(path.basename(p));
    await fsp.copyFile(p, path.join(MEDIA_DIR(), name));
    return { file: name, name: path.basename(p), mime: mimeOf(p), size: st.size };
  });
  // MCP add_image (local path): home / Nyx data only, images only, size from opts.maxBytes (plugin setting), no file:// or UNC.
  ipcMain.handle('media:importUserImage', async (_e, p, opts) => {
    const os = require('os');
    const chk = require('./main/import-image').checkUserImage(p, { home: os.homedir(), dataRoot: DATA_ROOT(), mediaDir: MEDIA_DIR(), maxBytes: opts && opts.maxBytes });
    const name = uniqueName(path.basename(chk.path));
    await fsp.copyFile(chk.path, path.join(MEDIA_DIR(), name));
    return { file: name, name: path.basename(chk.path), mime: chk.mime, size: chk.size };
  });
  ipcMain.handle('media:importBuffer', async (_e, origName, buf) => {
    const name = uniqueName(path.basename(origName || 'clip.png'));
    await fsp.writeFile(path.join(MEDIA_DIR(), name), Buffer.from(buf));
    return { file: name, name: origName, mime: mimeOf(name), size: buf.byteLength };
  });
  // v2.6.1: was an unguarded net.fetch of any URL (no size/type/SSRF checks). Now: images only, through the web agent's
  // guarded fetcher (public addresses only, every redirect hop checked, 30 MB cap, magic-byte check).
  ipcMain.handle('media:download', async (_e, url, hint) => {
    const r = await require('./main/webagent').dropImage(url, { hint: hint || 'remote' });
    return { file: r.file, name: r.name, mime: r.mime, size: r.size };
  });
  ipcMain.handle('media:thumb', async (_e, file) => {
    try {
      file = path.basename(file); const src = path.join(MEDIA_DIR(), file);
      const img = nativeImage.createFromPath(src); if (img.isEmpty()) return null;
      const size = img.getSize(); let thumb = null;
      if (size.width > 640 || size.height > 640) {
        const t = img.resize(size.width >= size.height ? { width: 512, quality: 'good' } : { height: 512, quality: 'good' });
        thumb = uniqueName(path.parse(file).name + '.thumb.jpg');
        await fsp.writeFile(path.join(MEDIA_DIR(), thumb), t.toJPEG(82));
      }
      return { w: size.width, h: size.height, thumb };
    } catch (e) { return null; }
  });
  ipcMain.handle('media:pickFiles', async (_e, kind) => {
    const filters = kind === 'image' ? [{ name: t('assistant.031'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] }]
      : kind === 'video' ? [{ name: t('assistant.032'), extensions: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv'] }]
      : kind === 'audio' ? [{ name: t('main.015'), extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba'] }] : [{ name: t('pluginsui.030'), extensions: ['*'] }];
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openFile', 'multiSelections'], filters });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('media:pickFolderImages', async () => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] });
    if (r.canceled) return [];
    const dir = r.filePaths[0];
    const files = (await fsp.readdir(dir)).filter(f => /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(f)).slice(0, 2000);
    return files.map(f => path.join(dir, f));
  });
  ipcMain.handle('backup:export', async (_e, text) => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const r = await dialog.showOpenDialog(mainWin, { title: t('main.016'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    const out = path.join(r.filePaths[0], `NyxCanvas-backup-${stamp}`);
    await fsp.mkdir(path.join(out, 'media'), { recursive: true });
    await fsp.writeFile(path.join(out, 'nyx-backup.json'), text, 'utf8');
    // v2.6 (B-27): media/ may contain sub-folders
    if (fs.existsSync(MEDIA_DIR())) await fsp.cp(MEDIA_DIR(), path.join(out, 'media'), { recursive: true, force: false, errorOnExist: false });
    shell.showItemInFolder(path.join(out, 'nyx-backup.json'));
    return out;
  });
  ipcMain.handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(mainWin, { title: t('main.017'), properties: ['openFile'], filters: [{ name: 'Nyx backup', extensions: ['json'] }] });
    if (r.canceled) return null;
    const file = r.filePaths[0]; const text = await fsp.readFile(file, 'utf8'); JSON.parse(text);
    const mdir = path.join(path.dirname(file), 'media');
    if (fs.existsSync(mdir)) for (const f of await fsp.readdir(mdir)) { const dst = path.join(MEDIA_DIR(), f); if (!fs.existsSync(dst)) await fsp.copyFile(path.join(mdir, f), dst); }
    return text;
  });
  ipcMain.handle('web:fetch', async (_e, url, opts) => { const r = await fetchText(url, opts || {}); return r; });
  require('./main/today271').register(ipcMain, { dataDir: DATA_DIR, net }); // v2.7.1 «Σήμερα»: fixed Open-Meteo URL only
  ipcMain.handle('web:linkInfo', async (_e, url) => {
    try {
      const r = await fetchText(url, { timeout: 8000 });
      const m = (re) => (r.text.match(re) || [])[1];
      const title = m(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || m(/<title[^>]*>([^<]*)<\/title>/i) || '';
      const desc = m(/<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']+)/i) || '';
      let image = m(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || '';
      if (image) image = new URL(image, r.url).href;
      return { title: htmlToText(title).slice(0, 140), desc: htmlToText(desc).slice(0, 220), image };
    } catch (e) { return { error: String(e.message || e) }; }
  });
  ipcMain.handle('tracker:check', async (_e, item) => { try { return await checkTracker(item); } catch (e) { return { ok: false, error: String(e.message || e), checkedAt: new Date().toISOString() }; } });
  ipcMain.handle('open:external', (_e, url) => { secure.openExternal(url); });
  ipcMain.handle('open:media', (_e, file) => shell.openPath(path.join(MEDIA_DIR(), path.basename(file))));
  ipcMain.handle('open:dataFolder', () => shell.openPath(DATA_ROOT()));
  ipcMain.handle('notify', (_e, title, body) => notify(title, body));
  ipcMain.handle('widget:toggle', (_e, force) => toggleWidget(force));
  ipcMain.handle('widget:clickThrough', (_e, on) => setClickThrough(on));
  ipcMain.handle('widget:setOnTop', (_e, on) => widgetWin?.setAlwaysOnTop(!!on));
  ipcMain.handle('widget:close', () => toggleWidget(false));
  ipcMain.handle('widget:quickNote', (_e, text) => { mainWin?.webContents.send('quick-note', text); });
  ipcMain.handle('widget:agenda', (_e, op) => { if (!op || typeof op !== 'object' || !['add', 'toggle', 'del', 'edit', 'canvas'].includes(op.op)) return false; if (op.op === 'canvas') { mainWin?.show(); mainWin?.focus(); } mainWin?.webContents.send('agenda-op', op); return true; });
  ipcMain.handle('main:show', (_e, focusId) => showMain(focusId));
  ipcMain.handle('main:titlebar', (_e, colors) => { try { mainWin?.setTitleBarOverlay(overlayColors(colors)); } catch (e) {} });
  ipcMain.handle('main:fullscreen', () => mainWin?.setFullScreen(!mainWin.isFullScreen()));
  ipcMain.handle('login:set', (_e, on) => { setLogin(on); return app.getLoginItemSettings().openAtLogin; });
  ipcMain.handle('clipboard:readImage', async () => { try { const img = await clipboard.readImage(); return !img || img.isEmpty() ? null : img.toPNG(); } catch { return null; } });
  ipcMain.handle('trackers:runAll', () => runTrackers(true));
  ipcMain.handle('sub:ack', (_e, key) => { firedKeys.add(key); });
}

// ---------- lifecycle ----------
app.on('second-instance', () => showMain());
app.whenReady().then(() => {
  ensureDirs();
  loadState();
  i18n.setLang(lastState?.settings?.lang);
  i18n.wire(ipcMain);
  ipcMain.on('i18n:set', (e, l) => { i18n.setLang(l); refreshTray(); });
  secure.wireSession({ scriptDir: path.join(__dirname, 'app') });
  // v2.6.4: clipboard permissions only for the app's own windows (not <webview> / web pages).
  const PERM_ALL = ['media', 'notifications', 'fullscreen'], PERM_APP = ['clipboard-read', 'clipboard-sanitized-write'];
  const permOk = (wc, perm) => PERM_ALL.includes(perm) || (PERM_APP.includes(perm) && !!wc && secure.isAppWc(wc));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(permOk(wc, perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => permOk(wc, perm));
  // v2.6 (B-14): next to the CSP (which on file:// treats every local file as 'self'), the app's own windows may
  // only load scripts from the app folder — a <script src="file:///…/Downloads/x.js"> is cancelled. v2.6.3: this rule is
  // part of secure.wireSession({ scriptDir }) above (one onBeforeRequest listener per session).
  wireIpc();
  v2.wire({ mainWin: () => mainWin, widgetWin: () => widgetWin, USER, DATA_ROOT, MEDIA_DIR, uniqueName, mimeOf, notify, state: () => lastState, stateText: () => lastStateText, portable: () => PORTABLE, customRoot: () => CUSTOM_ROOT });
  createMain();
  updater.wire({ mainWin: () => mainWin, send: (ch, x) => mainWin?.webContents.send(ch, x), DATA_ROOT });
  mainWin.webContents.once('did-finish-load', () => { v2.afterReady(lastState); updater.afterReady(); });
  try {
    tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
    tray.setToolTip('Nyx Canvas');
    tray.on('click', () => showMain());
    refreshTray();
  } catch (e) { console.error('tray', e); }
  try {
    globalShortcut.register('Control+Alt+N', () => toggleWidget());
    globalShortcut.register('Control+Alt+Space', () => { showMain(); mainWin?.webContents.send('assistant:open'); });
    globalShortcut.register('Control+Alt+Q', () => v2.openCapture());
  } catch (e) {}
  if (lastState?.settings?.widget?.open && !process.env.NYX_TEST) setTimeout(() => toggleWidget(true), 800);
  setInterval(tick, 10000); setTimeout(tick, 4000);
  setInterval(() => runTrackers(false), 5 * 60000); setTimeout(() => runTrackers(false), 30000);
});
app.on('before-quit', () => { quitting = true; v2.shutdown(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// test hooks
if (process.env.NYX_TEST) {
  global.__nyx = { toggleWidget, tick, runTrackers, getWidget: () => widgetWin, firedKeys, v2, checkTracker };
}
