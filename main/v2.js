'use strict';
const { t, tr } = require('./i18n');
// Nyx v2 main-process features: AI hub, STT/TTS, managed servers, system tools, browser (persistent session),
// video (ffmpeg), plugins, snapshots, sticky/capture/viewer windows, drag-out.
const { app, BrowserWindow, ipcMain, dialog, shell, session, webContents, nativeImage, screen, Notification, clipboard } = require('electron');
const fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const vsengine = require('./vsengine');
const dnd = require('./dnd');
const { isInside, writeFileAtomic } = require('./fsutil');
const secure = require('./secure');
const secrets = require('./secrets'), ai = require('./ai'), procs = require('./procs'), systools = require('./systools'), nyxPath = require('./paths'), finder = require('./finder'), video = require('./video'), plugins = require('./plugins');

const WEB_PARTITION = 'persist:nyxweb';
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
let v25 = null;
let C; // context from main.js: { mainWin(), widgetWin(), USER, DATA_ROOT, MEDIA_DIR, uniqueName, mimeOf, notify, state() , stateText() }
const stickyWins = new Map(); let captureWin = null; const viewerWins = new Set();
const pending = new Map(); // plugin op requests to renderer

function safeMedia(f) { return path.join(C.MEDIA_DIR(), path.basename(String(f || ''))); }
async function saveBuf(name, buf) { const n = C.uniqueName(name); await fsp.writeFile(path.join(C.MEDIA_DIR(), n), buf); return n; }
const SNAP_DIR = () => path.join(C.DATA_ROOT(), 'snapshots');
const send = (ch, ...a) => { const w = C.mainWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, ...a); };

// ---------- browser session ----------
function setupWebSession() {
  const ses = session.fromPartition(WEB_PARTITION);
  ses.setUserAgent(CHROME_UA);
  const allow = ['fullscreen', 'clipboard-sanitized-write', 'notifications'];
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(allow.includes(perm)));
  ses.setPermissionCheckHandler((wc, perm) => allow.includes(perm));
  ses.on('will-download', (_e, item) => { const p = uniqueIn(app.getPath('downloads'), item.getFilename()); item.setSavePath(p); item.once('done', (_ev, st) => { if (st === 'completed') send('browser:download', { path: p, name: item.getFilename() }); }); });
}
// Windows-safe file name + never overwrite: 'name.ext' → 'name (1).ext' …
function safeFileName(n, def = 'file') {
  let s = path.basename(String(n || '')).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/[. ]+$/, '').slice(0, 180);
  if (!s || /^\.+$/.test(s)) s = def;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(s)) s = '_' + s;
  return s;
}
function uniqueIn(dir, name) {
  const n = safeFileName(name, 'download'); const ext = path.extname(n), base = n.slice(0, n.length - ext.length);
  let p = path.join(dir, n); for (let i = 1; fs.existsSync(p) && i < 10000; i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}
// only the in-app browser's own pages (webview guests in the isolated partition) may be read/captured by id
function browserWc(id) {
  const wc = webContents.fromId(+id); if (!wc || wc.isDestroyed()) throw new Error('no page');
  if (wc.getType() !== 'webview' || wc.session !== session.fromPartition(WEB_PARTITION)) throw new Error('not a Nyx browser page');
  return wc;
}
function onWebContentsCreated(_e, wc) {
  if (wc.getType() === 'webview') {
    wc.setWindowOpenHandler(({ url, features, disposition }) => {
      const popup = /width=|height=|popup/i.test(features || '') || /accounts\.google|oauth|login|signin|auth/i.test(url);
      if (popup && disposition !== 'background-tab') return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, webPreferences: { partition: WEB_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false } } };
      send('browser:newTab', url); return { action: 'deny' };
    });
    dnd.watchGuest(wc, send); // v2.6.1: drag from the page → drop strip on the canvas; no file: navigation
    // v2.3: browser shortcuts work while the page has focus (Ctrl+T/W/L/Tab, F5, Esc for fullscreen-less exit is left to the page)
    wc.on('before-input-event', (e, inp) => {
      if (inp.type !== 'keyDown') return; const c = inp.control || inp.meta; const k = String(inp.key || '').toLowerCase();
      const hit = (c && ['t', 'w', 'l', 'tab', 'r'].includes(k)) || k === 'f5' || (inp.alt && ['arrowleft', 'arrowright'].includes(k));
      if (!hit) return; e.preventDefault(); send('browser:key', { k, c, shift: !!inp.shift, alt: !!inp.alt });
    });
  }
}
function onWillAttachWebview(_e, prefs, params) {
  delete prefs.preload; delete prefs.preloadURL; prefs.nodeIntegration = false; prefs.nodeIntegrationInSubFrames = false; prefs.contextIsolation = true; prefs.sandbox = true;
  prefs.webSecurity = true; prefs.allowRunningInsecureContent = false; prefs.partition = WEB_PARTITION;
  if (params.src && !/^(https?:|about:blank)/i.test(params.src)) params.src = 'about:blank';
}
// Read a page's visible text with the logged-in session (for trackers). Never reads cookies/passwords.
async function renderText(url, { selector, wait = 2500, timeout = 30000, capture } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error(t('main.012'));
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: WEB_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, offscreen: false } });
  try {
    await Promise.race([w.loadURL(url, { userAgent: CHROME_UA }), new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), timeout))]);
    await new Promise(r => setTimeout(r, wait));
    const js = selector ? `(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e?e.innerText:''})()` : 'document.body ? document.body.innerText : ""';
    const text = await w.webContents.executeJavaScript(js, true);
    let file = null;
    if (capture) { const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 900 }); file = await saveBuf('web.png', img.resize({ width: 960 }).toPNG()); }
    return { text: String(text || ''), title: w.webContents.getTitle(), url: w.webContents.getURL(), file };
  } finally { w.destroy(); }
}

// ---------- windows ----------
function winPrefs() { return secure.appPrefs({ backgroundThrottling: false }); }
function openSticky(item) {
  if (stickyWins.has(item.id)) { stickyWins.get(item.id).show(); return; }
  const a = screen.getPrimaryDisplay().workArea; const b = item.desk?.bounds || { width: 300, height: 300, x: a.x + a.width - 340 - stickyWins.size * 30, y: a.y + 80 + stickyWins.size * 30 };
  const w = new BrowserWindow({ ...b, minWidth: 180, minHeight: 140, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, show: false, resizable: true, backgroundColor: '#00000000', webPreferences: winPrefs() });
  secure.harden(w);
  w.loadFile(path.join(__dirname, '..', 'app', 'sticky.html'), { query: { id: item.id } });
  w.once('ready-to-show', () => w.showInactive());
  const sb = () => !w.isDestroyed() && send('sticky:bounds', { id: item.id, bounds: w.getBounds() });
  w.on('moved', sb); w.on('resized', sb);
  w.on('closed', () => { stickyWins.delete(item.id); send('sticky:closed', item.id); });
  stickyWins.set(item.id, w);
}
function openCapture() {
  if (captureWin && !captureWin.isDestroyed()) { captureWin.show(); captureWin.focus(); return; }
  const a = screen.getPrimaryDisplay().workArea;
  captureWin = new BrowserWindow({ width: 560, height: 210, x: Math.round(a.x + a.width / 2 - 280), y: a.y + Math.round(a.height * .22), frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false, backgroundColor: '#00000000', webPreferences: winPrefs() });
  secure.harden(captureWin);
  captureWin.loadFile(path.join(__dirname, '..', 'app', 'capture.html'));
  captureWin.once('ready-to-show', () => { captureWin.show(); captureWin.focus(); });
  captureWin.on('blur', () => { if (!process.env.NYX_TEST) captureWin?.hide(); });
  captureWin.on('closed', () => { captureWin = null; });
}
function openViewer(boardId) {
  const w = new BrowserWindow({ width: 1100, height: 760, title: t('v2.001'), backgroundColor: '#05060a', autoHideMenuBar: true, webPreferences: { ...winPrefs(), webviewTag: false } });
  secure.harden(w);
  w.loadFile(path.join(__dirname, '..', 'app', 'index.html'), { query: { viewer: boardId } });
  viewerWins.add(w); w.on('closed', () => viewerWins.delete(w));
}
function broadcastState(text) { for (const w of [...stickyWins.values(), ...viewerWins]) if (!w.isDestroyed()) w.webContents.send('state', text); }

// ---------- snapshots ----------
async function snapshot(label = 'auto') {
  const t = C.stateText(); if (!t) return null;
  await fsp.mkdir(SNAP_DIR(), { recursive: true });
  const files = (await fsp.readdir(SNAP_DIR())).filter(f => f.endsWith('.json')).sort();
  if (label === 'auto' && files.length) { const last = await fsp.readFile(path.join(SNAP_DIR(), files[files.length - 1]), 'utf8').catch(() => ''); if (last === t) return null; }
  const name = `snap-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${String(label).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 30)}.json`;
  await fsp.writeFile(path.join(SNAP_DIR(), name), t, 'utf8');
  files.push(name); while (files.length > 60) await fsp.unlink(path.join(SNAP_DIR(), files.shift())).catch(() => {});
  return name;
}

// ---------- plugin bridge (main <-> renderer ops) ----------
function bridgeOp(op, args, pluginId) {
  return new Promise((res, rej) => {
    const w = C.mainWin(); if (!w) return rej(new Error(tr('v2.002')));
    const id = crypto.randomBytes(6).toString('hex');
    const t = setTimeout(() => { pending.delete(id); rej(new Error('Timeout op ' + op)); }, 120000);
    pending.set(id, { res, rej, t });
    w.webContents.send('plugin:op', { id, op, args, plugin: pluginId });
  });
}

function wire(ctx) {
  C = ctx;
  secrets.init(C.USER()); secrets.setWarn((m) => send('toast', { text: m, kind: 'err', ms: 15000 }));
  plugins.init({ builtinDir: path.join(__dirname, '..', 'app', 'plugins'), userDir: path.join(C.DATA_ROOT(), 'plugins'), dataDir: C.DATA_ROOT(), bridge: { op: bridgeOp, emit: (ev, data) => send('plugin:event', { ev, data }), toast: (m) => send('toast', m), win: () => C.mainWin() } });
  setupWebSession();
  app.on('web-contents-created', onWebContentsCreated);
  app.on('web-contents-created', (e, wc) => secure.onWebContentsCreated(e, wc, { webSession: () => session.fromPartition(WEB_PARTITION) }));
  const H = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => fn(...a));

  // secrets
  H('secret:set', (k, v) => { if (!/^[\w:.-]+$/.test(k)) throw new Error('bad key'); secrets.set(k, v); return true; });
  H('secret:has', (k) => secrets.has(k));
  // AI
  // v2.6 (B-31): an unreachable local provider (LM Studio off…) is an expected answer, not a crash → no stack trace in the log
  H('ai:models', async (p) => { try { return await ai.models(p); } catch (e) { if (e && e.constructor?.name === 'NetError' && typeof e.code === 'string') return { error: String(e.message || e), code: e.code, status: e.status }; throw e; } });
  H('ai:ping', (p) => ai.ping(p));
  H('ai:chat', (p, body) => ai.chat(p, body));
  H('ai:prepare', (p, opts) => ai.prepare(p, opts || {}));
  H('ai:props', (p, opts) => ai.props(p, opts || {}));
  H('ai:routerInfo', (p, opts) => ai.routerInfo(p, opts || {}));
  H('ai:tokenize', (p, content) => ai.tokenize(p, content));
  H('ai:context', (p, opts) => ai.contextInfo(p, opts || {}));
  H('ai:recommendCtx', (file, o) => { const limits = require('./limits'); if (file) return limits.recommendFromGguf(file, o || {}); return limits.recommendCtx({ meta: limits.GEMMA4_12B, weightsBytes: (o && o.weightsBytes) || 6.71 * 2 ** 30, ...(o || {}) }); });
  H('ai:embed', (p, model, input) => ai.embed(p, model, input));
  H('ai:imageData', async (file) => { const p = safeMedia(file); const img = nativeImage.createFromPath(p); if (img.isEmpty()) { const b = await fsp.readFile(p); return 'data:' + C.mimeOf(p) + ';base64,' + b.toString('base64'); } const s = img.getSize(); const r = s.width > 1024 || s.height > 1024 ? img.resize(s.width >= s.height ? { width: 1024 } : { height: 1024 }) : img; return 'data:image/jpeg;base64,' + r.toJPEG(85).toString('base64'); });
  // STT
  H('stt:buffer', async (cfg, buf, name, opts) => ai.transcribe(cfg, Buffer.from(buf), name, opts));
  H('stt:media', async (cfg, file, opts) => {
    const p = safeMedia(file); let wav = p, tmp = null;
    if (!/\.wav$/i.test(p)) { tmp = wav = await video.extractWav(p); }
    try { return await ai.transcribe(cfg, await fsp.readFile(wav), 'audio.wav', opts); } finally { if (tmp) fsp.unlink(tmp).catch(() => {}); }
  });
  // TTS
  H('tts:run', async (cfg, text) => { const out = await ai.tts(cfg, text, C.MEDIA_DIR()); return path.basename(out); });
  H('tts:test', async (cfg, text) => ai.tts(cfg, text || t('v22.tts_sample'), C.MEDIA_DIR(), { report: true, timeout: 120000 }));
  H('tts:help', (exe) => ai.exeHelp(exe));
  // v2.4: Windows voices = SAPI5 (System.Speech) + OneCore (Windows.Media.SpeechSynthesis, where Greek «Stefanos» lives).
  // Picks a voice for the TEXT language, renders a WAV (Nyx plays it), never spells Greek with an English voice.
  let sapiProc = null;
  const winTts = (env, timeout = 120000) => new Promise((res, rej) => {
    if (process.platform !== 'win32') return rej(new Error(t('v23.sapi_win')));
    let ps; try { ps = require('./unpacked-integrity').verifyFile(path.join(__dirname, 'res', 'tts.ps1').replace('app.asar', 'app.asar.unpacked')); } catch (e) { return rej(e); }
    const ch = require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps],
      { env: { ...process.env, ...env }, timeout, windowsHide: true, maxBuffer: 4 << 20, encoding: 'utf8' },
      (e, out, err) => { if (ch === sapiProc) sapiProc = null; const line = String(out || '').trim().split(/\r?\n/).filter(l => l.startsWith('{')).pop(); let j = null; try { j = line && JSON.parse(line); } catch (x) {}
        if (j) return res(j); if (e && e.killed) return res({ ok: false, error: 'stopped' }); rej(new Error(String(err || e?.message || 'SAPI').trim().slice(0, 300))); });
    if (env.NYX_TTS_MODE === 'speak') sapiProc = ch;
  });
  let voiceCache = null;
  H('tts:voices', async (fresh) => { if (voiceCache && !fresh) return voiceCache; const j = await winTts({ NYX_TTS_MODE: 'list' }, 30000); voiceCache = (j.voices || []).filter(v => v && v.name).map(v => ({ name: v.name, lang: v.lang || '', gender: v.gender || '', src: v.src })); return voiceCache; });
  H('tts:sapi', async (text, lang, rate, o = {}) => {
    try { sapiProc?.kill(); } catch (e) {}
    const n = C.uniqueName('speak.wav'); const out = path.join(C.MEDIA_DIR(), n);
    const j = await winTts({ NYX_TTS_MODE: 'speak', NYX_TTS_TEXT: String(text || '').slice(0, 4000), NYX_TTS_LANG: String(lang || 'el').slice(0, 2), NYX_TTS_RATE: String(Math.max(-10, Math.min(10, rate | 0))), NYX_TTS_PITCH: String(Math.max(-10, Math.min(10, o.pitch | 0))), NYX_TTS_VOICE: String(o.voice || ''), NYX_TTS_SRC: String(o.src || ''), NYX_TTS_OUT: out });
    if (!j.ok) { if (j.error === 'NOVOICE') return { ok: false, noVoice: true, lang: j.lang, voices: (j.voices || []).map(v => ({ name: v.name, lang: v.lang, src: v.src })) }; throw new Error(j.error || 'SAPI'); }
    if (!fs.existsSync(out)) throw new Error(t('ai.006') + out);
    return { ok: true, file: n, voice: j.voice, culture: j.culture, src: j.src };
  });
  // v2.4: vs-engine HTTP server mode (own random token via safeStorage, hidden process, API probing)
  H('tts:vsStart', async (cfg) => { try { return { ok: true, ...(await vsengine.start(cfg, secrets)) }; } catch (e) { return { ok: false, error: e.message, log: e.log || '', cmd: e.cmd || '' }; } });
  H('tts:vsStop', () => { vsengine.stop(); return true; });
  H('tts:vsStatus', () => vsengine.status());
  H('tts:vsProbe', async () => vsengine.probe(secrets));
  H('tts:vsSpeak', async (cfg, text) => { const n = C.uniqueName('vs.wav'); const r = await vsengine.speak(cfg, secrets, String(text || '').slice(0, 4000), path.join(C.MEDIA_DIR(), n)); return { file: n, endpoint: r.endpoint }; });
  H('tts:vsTest', async (cfg, text) => {
    const t0 = Date.now(); let st;
    try { st = await vsengine.start(cfg, secrets); } catch (e) { return { ok: false, stage: 'start', error: e.message, log: e.log || '', cmd: e.cmd || '', ms: Date.now() - t0 }; }
    let pr = null; try { pr = await vsengine.probe(secrets); } catch (e) {}
    const n = C.uniqueName('vs.wav'); const r = await vsengine.speak(cfg, secrets, text || t('v22.tts_sample'), path.join(C.MEDIA_DIR(), n), { report: true });
    return { ...r, stage: 'speak', file: r.ok ? n : null, probe: pr, cmd: st.cmd, log: vsengine.status().log, ms: Date.now() - t0 };
  });
  H('sys:winSettings', (k) => { const u = ({ speech: 'ms-settings:speech', lang: 'ms-settings:regionlanguage' })[k]; if (u && process.platform === 'win32') shell.openExternal(u); return !!u; });
  H('tts:sapiStop', () => { try { sapiProc?.kill(); } catch (e) {} sapiProc = null; return true; });
  H('ai:lmsFind', () => ai.findLms());
  H('ai:lmsStart', () => ai.lmsServerStart());
  // v2.2: find model / exe files (GPU-Voice-Studio, OmniVoice-Vulkan, LM Studio models, Downloads …)
  H('sys:findFiles', (q = {}) => finder.find({ ...q, roots: finder.defaultRoots(nyxPath.userHome(), systools.GVS(''), (q.extraRoots || []).filter(Boolean)) }));
  // managed servers
  const procEv = (id, st) => send('proc:status', { id, ...st });
  H('proc:start', (id, cfg) => procs.start(id, cfg, procEv));
  H('proc:precheck', (id, cfg) => { const e = procs.precheck(id, cfg); return e ? { ok: false, field: e.field, error: e.message } : { ok: true }; });
  H('proc:stop', (id) => procs.stop(id));
  H('proc:status', (id) => procs.status(id));
  H('proc:health', async (url, ms) => { try { const c = new AbortController(); const wait = (ms > 0 ? +ms : 2000); setTimeout(() => c.abort(), wait); const r = await fetch(url, { signal: c.signal }); return { ok: r.ok, status: r.status }; } catch (e) { return { ok: false }; } });
  H('proc:winAutostart', (opts) => {
    opts = opts || {};
    if (opts.on === true || opts.on === false) return procs.winAutostartSet(!!opts.on, opts.cfg || {});
    return procs.winAutostartGet();
  });
  // system tools
  require('./toolindex').wire(C, H);
  v25 = require('./v25').wire(C, H, { procs, secrets, send, safeMedia, saveBuf, finder, systools });
  H('sys:launch', (p, kind) => systools.launch(p, kind));
  H('sys:exists', (paths) => (paths || []).map(p => { try { const st = fs.statSync(p); return { p, exists: true, size: st.size, dir: st.isDirectory() }; } catch (e) { return { p, exists: false }; } }));
  H('sys:ocr', (file, lang) => new Promise((res, rej) => {
    if (process.platform !== 'win32') return rej(new Error(t('v2.003')));
    let ps; try { ps = require('./unpacked-integrity').verifyFile(path.join(__dirname, 'res', 'ocr.ps1').replace('app.asar', 'app.asar.unpacked')); } catch (e) { return rej(e); }
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { env: { ...process.env, NYX_OCR_FILE: safeMedia(file), NYX_OCR_LANG: lang || 'el' }, timeout: 60000, windowsHide: true, maxBuffer: 8 << 20 }, (e, out, err) => e ? rej(new Error((err || e.message).slice(0, 300))) : res(String(out).trim()));
  }));
  H('sys:reveal', (p) => { if (fs.existsSync(p)) shell.showItemInFolder(p); });
  H('sys:pickExe', async (title, filters, defaultPath) => { const dp = defaultPath && fs.existsSync(defaultPath) ? defaultPath : (defaultPath && fs.existsSync(path.dirname(defaultPath)) ? path.dirname(defaultPath) : undefined); const r = await dialog.showOpenDialog(C.mainWin(), { title, defaultPath: dp, properties: ['openFile'], filters: filters || [{ name: t('pluginsui.030'), extensions: ['*'] }] }); return r.canceled ? null : r.filePaths[0]; });
  H('sys:pickDir', async (title) => { const r = await dialog.showOpenDialog(C.mainWin(), { title, properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  H('sys:info', () => ({ cpus: os.cpus().length, cpu: os.cpus()[0]?.model, mem: os.totalmem(), free: os.freemem(), platform: `${os.type()} ${os.release()}`, home: nyxPath.userHome(), userprofile: process.env.USERPROFILE || nyxPath.userHome(), gvs: systools.GVS(''), dataRoot: C.DATA_ROOT(), portable: C.portable(), ffmpeg: video.path }));
  H('sys:migrateAiPaths', (bag = {}) => {
    const r = nyxPath.migrateAiPaths(bag || {});
    if (r.log && r.log.length) console.log('[nyx] path migrate:', r.log.join(' | '));
    return r;
  });
  // video / ffmpeg
  H('video:probe', (file) => video.probe(safeMedia(file)));
  H('video:clip', async (file, t0, t1, label) => {
    const src = safeMedia(file); const base = (label || path.parse(file).name).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40);
    const r = await dialog.showSaveDialog(C.mainWin(), { title: t('v2.004'), defaultPath: path.join(app.getPath('videos'), `${base}-${Math.round(t0)}s.mp4`), filters: [{ name: 'MP4', extensions: ['mp4'] }] });
    if (r.canceled || !r.filePath) return null; await video.clip(src, t0, t1, r.filePath); shell.showItemInFolder(r.filePath); return r.filePath;
  });
  H('video:clipToMedia', async (file, t0, t1) => { const n = C.uniqueName('clip.mp4'); await video.clip(safeMedia(file), t0, t1, path.join(C.MEDIA_DIR(), n)); return n; });
  H('video:frame', async (file, t) => { const n = C.uniqueName('frame.jpg'); await video.frame(safeMedia(file), Math.max(0, +t || 0), path.join(C.MEDIA_DIR(), n)); return n; });
  H('video:ffmpeg', async (p) => video.resolve(p));
  // browser
  H('web:capture', async (wcId) => { const wc = browserWc(wcId); const img = await wc.capturePage(); const s = img.getSize(); const n = await saveBuf('web.png', img.toPNG()); return { file: n, w: s.width, h: s.height, title: wc.getTitle(), url: wc.getURL() }; });
  H('web:selection', async (wcId) => { const wc = browserWc(wcId); const r = await wc.executeJavaScript(`(()=>{const s=getSelection();let html='';if(s.rangeCount){const d=document.createElement('div');d.appendChild(s.getRangeAt(0).cloneContents());html=d.innerHTML}return {text:s.toString(),html}})()`, true); return { ...r, url: wc.getURL(), title: wc.getTitle() }; });
  H('web:pageText', async (wcId) => { const wc = browserWc(wcId); const text = await wc.executeJavaScript('document.body?document.body.innerText:""', true); return { text: String(text).slice(0, 60000), url: wc.getURL(), title: wc.getTitle() }; });
  H('web:renderText', (url, opts) => renderText(url, opts));
  H('web:clearSession', async () => { await session.fromPartition(WEB_PARTITION).clearStorageData(); return true; });
  // drag out / save as / reveal
  // drag OUT (v2.6.1: main/dnd.js — real temp files with proper names, .txt for text, .url for links, image icon)
  ipcMain.on('drag:start', (e, files) => {
    try { dnd.startDrag(e.sender, files, { mediaDir: C.MEDIA_DIR(), nativeImage, appIcon: path.join(__dirname, '..', 'app', 'assets', 'icon.png') }); } catch (err) { console.error('drag', err); }
  });
  H('file:saveAs', async (file, suggested) => { const src = safeMedia(file); const r = await dialog.showSaveDialog(C.mainWin(), { defaultPath: path.join(app.getPath('downloads'), suggested || path.basename(src).replace(/^[a-z0-9]+-[a-f0-9]{6}-/, '')) }); if (r.canceled || !r.filePath) return null; await fsp.copyFile(src, r.filePath); return r.filePath; });
  H('file:saveText', async (name, text) => { const r = await dialog.showSaveDialog(C.mainWin(), { defaultPath: path.join(app.getPath('documents'), name) }); if (r.canceled || !r.filePath) return null; await fsp.writeFile(r.filePath, text, 'utf8'); return r.filePath; });
  H('file:reveal', (file) => shell.showItemInFolder(safeMedia(file)));
  H('file:readMedia', async (file) => (await fsp.readFile(safeMedia(file))));
  // plugins
  H('plugins:list', () => plugins.list());
  H('plugins:install', (id, approved) => plugins.install(id, approved));
  H('plugins:uninstall', (id) => plugins.uninstall(id));
  H('plugins:enable', (id, on) => plugins.setEnabled(id, on));
  H('plugins:config', (id, v) => plugins.setConfig(id, v));
  H('plugins:action', (id, a, args) => plugins.action(id, a, args));
  H('plugins:card', (id, t, cfg) => plugins.cardRefresh(id, t, cfg));
  H('plugins:panel', (id) => plugins.panel(id));
  H('plugins:logs', (id) => plugins.logs(id));
  H('plugins:installFolder', async () => { const r = await dialog.showOpenDialog(C.mainWin(), { title: t('v2.005'), properties: ['openDirectory'] }); if (r.canceled) return null; return plugins.installFromFolder(r.filePaths[0]); });
  H('plugins:installPending', (id, approved) => plugins.installPending(id, approved));
  H('plugins:openFolder', () => shell.openPath(path.join(C.DATA_ROOT(), 'plugins')));
  ipcMain.on('plugin:opResult', (_e, { id, ok, value, error }) => { const p = pending.get(id); if (!p) return; pending.delete(id); clearTimeout(p.t); ok ? p.res(value) : p.rej(new Error(error)); });
  ipcMain.on('plugin:dispatch', (_e, ev, data) => plugins.dispatch(ev, data));
  // snapshots
  H('snap:create', (label) => snapshot(label || t('extras.060')));
  H('snap:list', async () => { try { const fl = (await fsp.readdir(SNAP_DIR())).filter(f => f.endsWith('.json')).sort().reverse(); return await Promise.all(fl.map(async f => ({ name: f, size: (await fsp.stat(path.join(SNAP_DIR(), f))).size }))); } catch (e) { return []; } });
  H('snap:read', (name) => fsp.readFile(path.join(SNAP_DIR(), path.basename(name)), 'utf8'));
  // windows
  H('sticky:open', (item) => openSticky(item));
  H('sticky:close', (id) => stickyWins.get(id)?.close());
  H('sticky:update', (id, html) => send('sticky:update', { id, html }));
  H('capture:open', () => openCapture());
  H('capture:submit', (payload) => { send('capture:submit', payload); captureWin?.hide(); });
  H('capture:hide', () => captureWin?.hide());
  H('viewer:open', (boardId) => openViewer(boardId));
  // data location (Syncthing / portable)
  H('data:location', () => ({ root: C.DATA_ROOT(), portable: C.portable(), custom: C.customRoot() }));
  // v2.6: copies everything that lives in the data folder (not just data/media/plugins), never overwrites,
  // removes half-copied items on failure and merges .stignore instead of replacing it.
  const MOVE_ITEMS = ['data', 'media', 'plugins', 'plugins.json', 'plugin-data', 'memory', 'faces', 'models', 'snapshots', 'backups'];
  const STIGNORE = ['*.tmp', '(?d)Thumbs.db', 'backups', 'snapshots', 'tmp', 'cache'];
  H('data:setLocation', async (dir) => {
    const f = path.join(app.getPath('appData'), 'Nyx Canvas', 'location.json'); await fsp.mkdir(path.dirname(f), { recursive: true });
    if (!dir) { await fsp.unlink(f).catch(() => {}); return null; }
    dir = path.resolve(String(dir)); const cur = path.resolve(C.DATA_ROOT());
    if (dir === cur || isInside(cur, dir) || isInside(dir, cur)) throw new Error(t('v26.loc_nested'));
    await fsp.mkdir(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, 'data', 'nyx.json'))) {
      const created = [];
      try {
        for (const sub of MOVE_ITEMS) {
          const src = path.join(cur, sub), dst = path.join(dir, sub);
          if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
          created.push(dst); await fsp.cp(src, dst, { recursive: true, force: false, errorOnExist: false });
        }
        const txt = C.stateText?.(); if (txt && created.includes(path.join(dir, 'data'))) await writeFileAtomic(path.join(dir, 'data', 'nyx.json'), txt); // newest state, not a possibly older file on disk
      } catch (e) {
        for (const p of created) if (isInside(dir, p)) await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
        throw new Error(t('v26.loc_copy_failed', { err: e.message }));
      }
    }
    const sti = path.join(dir, '.stignore'); let lines = [];
    try { lines = (await fsp.readFile(sti, 'utf8')).split(/\r?\n/); } catch (e) {}
    const have = new Set(lines.map(l => l.trim())); const add = STIGNORE.filter(l => !have.has(l));
    if (add.length || !lines.length) { while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); await fsp.writeFile(sti, [...lines, ...add].join('\n') + '\n'); }
    await writeFileAtomic(f, JSON.stringify({ dir })); return dir;
  });
  H('data:conflicts', async () => { try { return (await fsp.readdir(path.join(C.DATA_ROOT(), 'data'))).filter(f => /sync-conflict/i.test(f)); } catch (e) { return []; } });
  H('app:relaunch', () => { app.relaunch(); app.exit(0); });

  setInterval(() => snapshot('auto').catch(() => {}), 60 * 60000);
  setTimeout(() => snapshot('auto').catch(() => {}), 5 * 60000);
}
async function afterReady(state) {
  video.resolve(state?.settings?.tools?.ffmpeg).catch(() => {});
  if (!process.env.NYX_TEST) for (const b of state?.boards || []) for (const it of b.items || []) if (it.desk?.open) openSticky(it);
  await new Promise(r => setImmediate(r)); // let the first frame/input through before plugins spin up
  await plugins.startEnabled().catch(e => console.error('plugins', e));
}
function shutdown() { try { v25?.flushMemorySync?.(); } catch (e) {} try { v25?.stop(); } catch (e) {} try { vsengine.stop(); } catch (e) {} procs.stopAll(); plugins.unloadAll(); }
module.exports = { wire, afterReady, shutdown, onWillAttachWebview, broadcastState, openCapture, snapshot, renderText, WEB_PARTITION, plugins, stickyWins };
