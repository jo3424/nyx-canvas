'use strict';
// v2.5.1 — one central guard for EVERY ipcMain handler (ipcMain.handle / ipcMain.on are wrapped once, before any module
// registers a channel). Each call must come from the top frame of one of the app's own pages (file: URL inside the
// app's code folder, in an app window — never a <webview> guest or a remote page), and its arguments must match the
// channel's schema below (types, sizes, URL schemes, media names confined to the media folder, absolute local paths
// only — no UNC/device/relative paths). A channel without a schema cannot be registered at all.
const path = require('path');
const { fileURLToPath } = require('url');

const WIN = process.platform === 'win32';
const MAX_STR = 2 * 1024 * 1024, MAX_TEXT = 512 * 1024 * 1024, MAX_BUF = 2 * 1024 * 1024 * 1024, MAX_DEPTH = 40;
const CTRL = /[\u0000-\u001f\u007f]/;

function jsonish(v, d = 0) {
  if (d > MAX_DEPTH) return false;
  if (v === null || v === undefined) return true;
  const t = typeof v;
  if (t === 'string') return v.length <= MAX_TEXT;
  if (t === 'number') return Number.isFinite(v) || Number.isNaN(v);
  if (t === 'boolean') return true;
  if (t !== 'object') return false;
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v.byteLength <= MAX_BUF;
  if (v instanceof Date) return true;
  if (Array.isArray(v)) { if (v.length > 1e6) return false; for (const x of v) if (!jsonish(x, d + 1)) return false; return true; }
  const p = Object.getPrototypeOf(v); if (p !== Object.prototype && p !== null) return false;
  for (const k of Object.keys(v)) { if (k === '__proto__') return false; if (!jsonish(v[k], d + 1)) return false; }
  return true;
}
const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) && jsonish(v);
function isUrl(v, schemes) { if (typeof v !== 'string' || v.length > 16384) return false; try { return schemes.includes(new URL(v).protocol); } catch (e) { return false; } }
// Absolute, local, non-device path. Windows: "C:\..." only (UNC "\\server\share" would leak NTLM hashes, "\\?\" and "\\.\" are device paths).
function isAbsLocal(v) {
  if (typeof v !== 'string' || !v || v.length > 4096 || v.includes('\0') || CTRL.test(v)) return false;
  if (/^[\\/]{2}/.test(v)) return false;
  if (WIN) return /^[a-zA-Z]:[\\/]/.test(v);
  return v.startsWith('/');
}
// A file *name* inside one of the app's own folders (media, snapshots…): never a path, never "..".
const isName = (v) => typeof v === 'string' && v.length > 0 && v.length <= 255 && !/[\\/:\0]/.test(v) && v !== '.' && v !== '..' && !CTRL.test(v);
// media items are stored by name; older boards may still hold a path-ish value → accept, the handlers keep only the basename
const isMediaRef = (v) => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !v.includes('\0') && isName(v.split(/[\\/]/).pop());

const T = {
  any: (v) => jsonish(v),
  p: (v) => v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v) && (typeof v !== 'string' || v.length <= MAX_STR),
  s: (v) => typeof v === 'string' && v.length <= MAX_STR,
  text: (v) => typeof v === 'string' && v.length <= MAX_TEXT,
  n: (v) => typeof v === 'number' && Number.isFinite(v),
  b: (v) => typeof v === 'boolean',
  o: (v) => isPlainObj(v),
  a: (v) => Array.isArray(v) && jsonish(v),
  strs: (v) => Array.isArray(v) && v.length <= 100000 && v.every(x => typeof x === 'string' && x.length <= 4096),
  buf: (v) => (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) && v.byteLength <= MAX_BUF,
  key: (v) => (typeof v === 'string' && v.length > 0 && v.length <= 512 && !CTRL.test(v)) || (typeof v === 'number' && Number.isFinite(v)),
  keys: (v) => (Array.isArray(v) && v.length <= 100000 && v.every(T.key)) || T.key(v),
  url: (v) => isUrl(v, ['http:', 'https:']),
  link: (v) => isUrl(v, ['http:', 'https:', 'mailto:']),
  name: isName,
  media: isMediaRef,
  medias: (v) => Array.isArray(v) && v.length <= 100000 && v.every(isMediaRef),
  path: isAbsLocal,
  paths: (v) => Array.isArray(v) && v.length <= 100000 && v.every(isAbsLocal),
  zip: (v) => isAbsLocal(v) && /\.zip$/i.test(v),
  wc: (v) => Number.isInteger(v) && v > 0,
  // v2.6.3: drag-out list (main/dnd.js plan): media names, or { file | url | text, name } (≤ 50 used, text ≤ 5 MB)
  drag: (v) => Array.isArray(v) && v.length <= 1000 && v.every(x => isMediaRef(x) || (isPlainObj(x) && Object.keys(x).every(k => ['file', 'url', 'text', 'name', 'kind', 'id'].includes(k))
    && (x.file == null || isMediaRef(x.file)) && (x.url == null || isUrl(x.url, ['http:', 'https:'])) && (x.text == null || (typeof x.text === 'string' && x.text.length <= 8 * 1024 * 1024))
    && (x.name == null || (typeof x.name === 'string' && x.name.length <= 1024)) && (x.file != null || x.url != null || x.text != null))),
  // a dropped file's display name (only used as a hint; main sanitises it)
  fname: (v) => typeof v === 'string' && v.length <= 1024 && !v.includes('\0'),
};

// channel → argument schema ('?' = optional / may be null). Every channel the app registers must be listed here.
const SCHEMA = {
  // core (main.js)
  'state:load': [], 'state:save': ['text'], 'state:saveSync': ['text'], 'state:get': [],
  'media:importPath': ['path'], 'media:importUserImage': ['path', 'o?'], 'media:importBuffer': ['name?', 'buf'], 'media:download': ['url', 's?'], 'media:thumb': ['media'],
  'media:pickFiles': ['s?'], 'media:pickFolderImages': [],
  'backup:export': ['text'], 'backup:import': [],
  'web:fetch': ['url', 'o?'], 'web:linkInfo': ['url'], 'tracker:check': ['o'],
  'open:external': ['link'], 'open:media': ['media'], 'open:dataFolder': [], 'notify': ['p', 'p'],
  'widget:toggle': ['p'], 'widget:clickThrough': ['p'], 'widget:setOnTop': ['p'], 'widget:close': [], 'widget:quickNote': ['s'], 'widget:agenda': ['o'],
  'main:show': ['key?'], 'main:titlebar': ['o?'], 'main:fullscreen': [],
  'login:set': ['p'], 'clipboard:readImage': [], 'trackers:runAll': [], 'sub:ack': ['s'],
  'i18n:get': ['p'], 'i18n:set': ['p'],
  // v2
  'secret:set': ['key', 's?'], 'secret:has': ['key'],
  'ai:models': ['o?'], 'ai:ping': ['o?'], 'ai:chat': ['o', 'o'], 'ai:chatStream': ['o', 'o'], 'ai:chatAbort': ['s?'], 'ai:embed': ['o?', 's?', 'any'], 'ai:imageData': ['media'],
  'ai:lmsFind': [], 'ai:lmsStart': [], 'ai:prepare': ['o', 'o?'], 'ai:props': ['o?', 'o?'], 'ai:routerInfo': ['o?', 'o?'], 'ai:tokenize': ['o?', 'text?', 'o?'], 'ai:context': ['o?', 'o?'], 'ai:recommendCtx': ['path?', 'o?'],
  'stt:buffer': ['o?', 'buf', 's?', 'o?'], 'stt:media': ['o?', 'media', 'o?'],
  'tts:run': ['o?', 's'], 'tts:test': ['o?', 's?'], 'tts:help': ['s'], 'tts:voices': ['p'], 'tts:sapi': ['s', 'p', 'p', 'o?'], 'tts:sapiStop': [],
  'tts:vsStart': ['o?'], 'tts:vsStop': [], 'tts:vsStatus': [], 'tts:vsProbe': [], 'tts:vsSpeak': ['o?', 's'], 'tts:vsTest': ['o?', 's?'],
  'sys:winSettings': ['s'], 'sys:findFiles': ['o?'], 'sys:launch': ['path', 's?'], 'sys:exists': ['strs'], 'sys:ocr': ['media', 's?'],
  'sys:reveal': ['path'], 'sys:pickExe': ['s?', 'a?', 's?'], 'sys:pickDir': ['s?'], 'sys:info': [], 'sys:migrateAiPaths': ['o?'], 'sys:detect': ['o?', 'p'],
  'sys:scan': ['o?'], 'sys:scanCancel': [], 'sys:scanState': [], 'sys:openFolder': ['path'],
  'proc:start': ['key', 'o'], 'proc:precheck': ['key', 'o'], 'proc:stop': ['key'], 'proc:status': ['key'], 'proc:health': ['url', 'n?'], 'proc:winAutostart': ['o?'], 'proc:pids': [], 'proc:stopWait': ['key', 'n?'],
  'video:probe': ['media'], 'video:clip': ['media', 'n', 'n', 's?'], 'video:clipToMedia': ['media', 'n', 'n'], 'video:frame': ['media', 'n?'], 'video:ffmpeg': ['s?'],
  'web:capture': ['wc'], 'web:selection': ['wc'], 'web:pageText': ['wc'], 'web:renderText': ['url', 'o?'], 'web:clearSession': [],
  'drag:start': ['drag'], 'file:saveAs': ['media', 's?'], 'file:saveText': ['s', 'text'], 'file:reveal': ['media'], 'file:readMedia': ['media'],
  'plugins:list': [], 'plugins:install': ['key', 'any'], 'plugins:uninstall': ['key'], 'plugins:enable': ['key', 'p'], 'plugins:config': ['key', 'any'],
  'plugins:action': ['key', 's', 'any'], 'plugins:card': ['key', 's?', 'any'], 'plugins:panel': ['key'], 'plugins:logs': ['key'],
  'plugins:installFolder': [], 'plugins:installPending': ['key', 'strs'], 'plugins:openFolder': [], 'plugin:opResult': ['o'], 'plugin:dispatch': ['s', 'any'],
  'snap:create': ['s?'], 'snap:list': [], 'snap:read': ['name'],
  'sticky:open': ['o'], 'sticky:close': ['key'], 'sticky:update': ['key', 's'],
  'capture:open': [], 'capture:submit': ['any'], 'capture:hide': [], 'viewer:open': ['key'],
  'data:location': [], 'data:setLocation': ['path?'], 'data:conflicts': [], 'app:relaunch': [],
  // updater
  'upd:info': [], 'upd:components': [], 'upd:check': ['s?'], 'upd:download': ['s?'], 'upd:installFile': ['zip?'], 'upd:rollback': [],
  'upd:restart': [], 'upd:openRoot': [], 'upd:setToken': ['s?'], 'upd:hasToken': [],
  // v2.5
  'att:cleanup': [], 'att:inspect': ['path'], 'att:pick': [], 'att:unzip': ['zip'],
  'faces:bestFiles': ['key', 'n?'], 'faces:download': [], 'faces:faces': ['key'], 'faces:forFile': ['media'], 'faces:forget': ['key'], 'faces:forgetAll': [],
  'faces:merge': ['key', 'key'], 'faces:name': ['key', 's'], 'faces:names': [], 'faces:people': [], 'faces:reject': ['key'], 'faces:scan': ['medias'], 'faces:status': [],
  'mem:add': ['o'], 'mem:day': ['s?'], 'mem:export': [], 'mem:forget': ['keys'], 'mem:forgetAll': [], 'mem:journal': ['any'], 'mem:list': [], 'mem:needEmb': [],
  'mem:search': ['s', 'o?'], 'mem:skillDel': ['key'], 'mem:skillMatch': ['s', 'n?'], 'mem:skillNote': ['key', 's'], 'mem:skillSave': ['o'], 'mem:skillUse': ['key'], 'mem:update': ['key', 'o'],
  'models:listDir': ['path', 'strs?'], 'models:scan': ['o?'], 'perf:snapshot': [],
  'photo:enhance': ['medias', 'o?'], 'sd:txt2img': ['o?'], 'sogni:run': ['s', 'o?'], 'sogni:test': [],
  'web:auto': ['wc', 's', 'o?'], 'web:press': ['wc'], 'web:grab': ['url', 'o?'], 'web:inspect': ['url', 's?', 'o?'], 'web:robots': ['url'],
  // v2.6 drag & drop in (app/js/v26/dnd.js)
  'web:dropImage': ['url', 'o?'], 'file:importImage': ['fname?', 'buf'],
};

let PAGES = null; // normalised absolute paths of the app's own pages
const normP = (p) => { p = path.normalize(p); return WIN ? p.toLowerCase() : p; };
function setAppDir(appDir) {
  PAGES = new Set(['index.html', 'widget.html', 'sticky.html', 'capture.html'].map(f => normP(path.join(appDir, f))));
}
function pageOf(url) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return null;
  try { return normP(fileURLToPath(url.split(/[?#]/)[0])); } catch (e) { return null; }
}
const isAppPageUrl = (url) => { const p = pageOf(url); return !!p && !!PAGES && PAGES.has(p); };
function trustedSender(e) {
  try {
    const wc = e.sender; if (!wc || wc.isDestroyed() || wc.getType() !== 'window') return false;
    const f = e.senderFrame; if (!f || f.parent) return false; // top frame only
    return isAppPageUrl(f.url);
  } catch (err) { return false; }
}
function checkArgs(ch, args) {
  const spec = SCHEMA[ch];
  let n = args.length; while (n > spec.length && args[n - 1] === undefined) n--; // trailing undefined is harmless
  if (n > spec.length) return `too many arguments (${n} > ${spec.length})`;
  for (let i = 0; i < spec.length; i++) {
    const s = spec[i]; const opt = s.endsWith('?'); const ty = opt ? s.slice(0, -1) : s; const v = args[i];
    if ((v === undefined || v === null) && (opt || ty === 'p' || ty === 'any')) continue;
    const fn = T[ty]; if (!fn) return 'bad schema ' + s;
    if (!fn(v)) return `argument ${i + 1} is not a valid ${ty}`;
  }
  return null;
}
const blocked = [];
function reject(ch, why) {
  const m = `[nyx] ipc blocked ${ch}: ${why}`; blocked.push(m); if (blocked.length > 200) blocked.shift();
  console.warn(m);
  const err = new Error('IPC rejected: ' + ch + ' (' + why + ')'); err.code = 'IPC_REJECTED'; return err;
}
function guard(ch, e, args) {
  if (!trustedSender(e)) return reject(ch, 'untrusted sender ' + (e.senderFrame?.url || '?'));
  const why = checkArgs(ch, args); if (why) return reject(ch, why);
  return null;
}
let installed = false;
function install(ipcMain, { appDir }) {
  setAppDir(appDir);
  if (installed) return; installed = true;
  const handle = ipcMain.handle.bind(ipcMain), on = ipcMain.on.bind(ipcMain);
  const need = (ch) => { if (!Object.prototype.hasOwnProperty.call(SCHEMA, ch)) throw new Error('ipc-guard: channel without schema: ' + ch); };
  ipcMain.handle = (ch, fn) => { need(ch); return handle(ch, (e, ...a) => { const bad = guard(ch, e, a); if (bad) throw bad; return fn(e, ...a); }); };
  ipcMain.handleOnce = () => { throw new Error('ipc-guard: handleOnce not allowed'); };
  ipcMain.on = ipcMain.addListener = (ch, fn) => { need(ch); return on(ch, (e, ...a) => { const bad = guard(ch, e, a); if (bad) { e.returnValue = { ok: false, error: bad.message }; return; } return fn(e, ...a); }); };
  ipcMain.once = () => { throw new Error('ipc-guard: once not allowed'); };
}
module.exports = { install, SCHEMA, T, checkArgs, trustedSender, isAppPageUrl, isAbsLocal, blocked: () => blocked.slice() };
