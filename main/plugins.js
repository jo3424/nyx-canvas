'use strict';
const { t, tr } = require('./i18n');
// Plugin host. Each plugin = folder with manifest.json + plugin.js, run in a node:vm context with a permissioned `nyx` API.
// NOTE: node:vm is isolation-by-convention, NOT a hard security sandbox — only install plugins you trust.
const vm = require('vm'), fs = require('fs'), fsp = fs.promises, path = require('path'), http = require('http');
const { Notification, clipboard, dialog, shell } = require('electron');
const secrets = require('./secrets');
const ai = require('./ai');
const { writeFileAtomicSync, writeFileAtomic, isInside } = require('./fsutil');

let BUILTIN_DIR, USER_DIR, REG_FILE, DATA_DIR, bridge; // bridge: { op(name,args)->Promise, emit(event,data), toast(msg), win() }
let reg = { installed: {} };
const APP_VERSION = (() => { try { return require('../package.json').version; } catch (e) { return ''; } })();
const loaded = {}; // id -> { manifest, mod, api, timers:Set, servers:[], handlers:{} }
const logs = {};

function init(o) { BUILTIN_DIR = o.builtinDir; USER_DIR = o.userDir; DATA_DIR = o.dataDir; REG_FILE = path.join(o.dataDir, 'plugins.json'); bridge = o.bridge; fs.mkdirSync(USER_DIR, { recursive: true }); fs.mkdirSync(path.join(DATA_DIR, 'plugin-data'), { recursive: true }); try { reg = JSON.parse(fs.readFileSync(REG_FILE, 'utf8')); } catch (e) { reg = { installed: {} }; } reg.installed ||= {}; migrateMcpPerms(false); }
// v2.6.5.2: split the MCP «write» checkbox into read / write / delete.
// Existing installs keep write as it was (the old default was true). New installs get write off, read on, delete off.
function migrateMcpPerms(isNewInstall) {
  const r = reg.installed['mcp-server']; if (!r) return;
  r.config ||= {};
  if (r.config.mcpPerms2652) return;
  if (!('read' in r.config)) r.config.read = true;
  if (!('del' in r.config)) r.config.del = false;
  if (!('write' in r.config)) r.config.write = isNewInstall ? false : true;
  r.config.mcpPerms2652 = true;
  saveReg();
}
const saveReg = () => { try { writeFileAtomicSync(REG_FILE, JSON.stringify(reg, null, 1)); } catch (e) { console.error('plugins.json', e.message); } };
// Plugin ids become folder names: strict charset, no dots (no '..'), no Windows device names.
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const validId = (id) => typeof id === 'string' && ID_RE.test(id) && !RESERVED.test(id);
function userDirFor(id) {
  if (!validId(id)) throw new Error(t('plugins.017'));
  const dst = path.join(USER_DIR, id);
  if (!isInside(USER_DIR, dst) || path.dirname(path.resolve(dst)) !== path.resolve(USER_DIR)) throw new Error(t('plugins.017'));
  return dst;
}
function readManifest(dir) { try { const m = JSON.parse(require('./unpacked-integrity').readVerified(path.join(dir, 'manifest.json')).toString('utf8')); m._dir = dir; return m; } catch (e) { return null; } }
function catalog() {
  const out = [];
  for (const [base, src] of [[BUILTIN_DIR, 'builtin'], [USER_DIR, 'user']]) {
    let ds = []; try { ds = fs.readdirSync(base); } catch (e) {}
    for (const d of ds) { if (d.startsWith('.')) continue; const m = readManifest(path.join(base, d)); if (m && validId(m.id) && (src === 'builtin' || m.id === d)) { m.source = src; out.push(m); } }
  }
  return out;
}
function find(id) { return catalog().find(m => m.id === id); }
function log(id, ...a) { const l = (logs[id] ||= []); l.push(new Date().toLocaleTimeString('el-GR') + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ').slice(0, 500)); if (l.length > 200) l.shift(); if (process.env.NYX_PLUGIN_DEBUG) console.log('[plugin ' + id + ']', l.at(-1)); }
function cfgOf(m) {
  const inst = reg.installed[m.id] || {}; const c = {};
  for (const f of m.config || []) { if (f.type === 'password') c[f.key] = secrets.get(`plugin:${m.id}:${f.key}`) || ''; else c[f.key] = inst.config?.[f.key] ?? f.default ?? ''; }
  return c;
}
// English labels for a manifest (name_en, description_en, i18n_en{long, category, requires, config, cards, actions}).
function localize(m) {
  if (require('./i18n').getLang() !== 'en' || !m) return m;
  const e = m.i18n_en || {}; const o = { ...m, name: m.name_en || m.name, description: m.description_en || m.description, long: e.long ?? m.long, category: e.category || m.category };
  if (m.requires && e.requires) o.requires = { ...m.requires, text: e.requires };
  if (m.config && e.config) o.config = m.config.map(c => { const x = e.config[c.key]; if (!x) return c; if (typeof x === 'string') return { ...c, label: x }; return { ...c, label: x.label || c.label, options: Array.isArray(c.options) && x.options ? c.options.map(op => Array.isArray(op) && x.options[op[0]] ? [op[0], x.options[op[0]]] : op) : c.options }; });
  if (m.cards && e.cards) o.cards = m.cards.map(c => e.cards[c.type] ? { ...c, name: e.cards[c.type] } : c);
  if (m.actions && e.actions) o.actions = m.actions.map(a => { const x = e.actions[a.id]; if (!x) return a; return { ...a, label: x.label || a.label, args: a.args ? a.args.map(g => ({ ...g, label: x.args?.[g.key] || g.label, ...(x.defaults && g.key in x.defaults ? { default: x.defaults[g.key] } : {}) })) : a.args }; });
  return o;
}
function list() {
  return catalog().map(m => { const inst = reg.installed[m.id]; const c = {}; for (const f of m.config || []) c[f.key] = f.type === 'password' ? (secrets.has(`plugin:${m.id}:${f.key}`) ? '••••••' : '') : (inst?.config?.[f.key] ?? f.default ?? '');
    m = localize(m);
    return { id: m.id, name: m.name, version: m.version, author: m.author, description: m.description, long: m.long || '', icon: m.icon || 'puzzle', category: m.category || t('assistant.036'), permissions: m.permissions || [], config: m.config || [], actions: m.actions || [], cards: m.cards || [], panel: !!m.panel, verified: m.source === 'builtin' && m.verified !== false, source: m.source, rendererCard: m.rendererCard || null, installed: !!inst, enabled: !!inst?.enabled, running: !!loaded[m.id], error: loaded[m.id]?.error || inst?.error || null, values: c, events: m.events || [], approved: inst?.approved || [], requires: m.requires || null, homepage: m.homepage || '', license: m.license || '' }; });
}
const has = (m, p) => (m.permissions || []).includes(p);
function deny(p) { throw new Error(t('plugins.001', { p })); }
function makeApi(m, L) {
  const id = m.id;
  const storeFile = path.join(DATA_DIR, 'plugin-data', id + '.json');
  let store = {}; try { store = JSON.parse(fs.readFileSync(storeFile, 'utf8')); } catch (e) {}
  let st = null; const saveStore = () => { clearTimeout(st); st = setTimeout(() => { st = null; writeFileAtomic(storeFile, JSON.stringify(store)).catch(e => log(id, 'storage', e.message)); }, 300); };
  L.flushStore = () => { if (!st) return; clearTimeout(st); st = null; try { writeFileAtomicSync(storeFile, JSON.stringify(store)); } catch (e) { log(id, 'storage', e.message); } };
  const api = {
    id, version: m.version,
    get config() { return cfgOf(m); },
    log: (...a) => log(id, ...a),
    storage: { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; saveStore(); }, all: () => ({ ...store }) },
    fetch: (url, opts) => has(m, 'net') ? fetch(url, opts) : deny('net'),
    notify: (title, body) => { if (!has(m, 'notify')) deny('notify'); try { new Notification({ title: String(title), body: String(body || '') }).show(); } catch (e) {} bridge.toast(`${m.name}: ${title}${body ? ' — ' + body : ''}`); },
    toast: (msg) => bridge.toast(String(msg)),
    board: new Proxy({}, { get: (_, op) => (typeof op !== 'string' || op === 'then' || op === 'toJSON' || op === 'constructor') ? undefined : (...args) => has(m, 'board') ? bridge.op('board.' + String(op), args, id) : deny('board') }),
    assistant: (text, opts) => has(m, 'assistant') ? bridge.op('assistant', [text, opts || {}], id) : deny('assistant'),
    setShared: (k, v) => has(m, 'widget') ? bridge.op('shared', [k, v], id) : deny('widget'),
    emit: (ev, data) => bridge.emit(id + ':' + ev, data),
    on: (ev, fn) => { (L.handlers[ev] ||= []).push(fn); },
    clipboard: {
      // Electron 45: clipboard.readText/writeText/readImage may be Promise-based — always expose async API.
      readText: async () => { if (!has(m, 'clipboard')) deny('clipboard'); const t = await clipboard.readText(); return typeof t === 'string' ? t : ''; },
      writeText: async (t) => { if (!has(m, 'clipboard')) deny('clipboard'); await clipboard.writeText(String(t)); return true; },
      readImagePNG: async () => { if (!has(m, 'clipboard')) deny('clipboard'); const im = await clipboard.readImage(); return !im || im.isEmpty() ? null : im.toPNG().toString('base64'); },
    },
    saveFile: async (name, content) => { if (!has(m, 'files')) deny('files'); const r = await dialog.showSaveDialog(bridge.win(), { defaultPath: name }); if (r.canceled || !r.filePath) return null; await fsp.writeFile(r.filePath, content); return r.filePath; },
    saveToFolder: async (files) => { if (!has(m, 'files')) deny('files'); const r = await dialog.showOpenDialog(bridge.win(), { properties: ['openDirectory', 'createDirectory'] }); if (r.canceled || !r.filePaths[0]) return null; for (const f of files) { const p = path.join(r.filePaths[0], path.basename(f.name)); if (f.copyFrom) await fsp.copyFile(f.copyFrom, p); else await fsp.writeFile(p, f.content); } shell.openPath(r.filePaths[0]); return r.filePaths[0]; },
    openFile: async (filters) => { if (!has(m, 'files')) deny('files'); const r = await dialog.showOpenDialog(bridge.win(), { properties: ['openFile'], filters }); if (r.canceled || !r.filePaths[0]) return null; return { path: r.filePaths[0], text: await fsp.readFile(r.filePaths[0], 'utf8') }; },
    // Resolves once listening; rejects (and marks the plugin as failed + toast) if the port is busy.
    serve: (port, handler) => {
      if (!has(m, 'server')) deny('server');
      const srv = http.createServer(async (req, res) => {
        const chunks = []; let size = 0, tooBig = false;
        req.on('data', d => { if (tooBig) return; size += d.length; if (size > 5e6) { tooBig = true; res.writeHead(413, { 'Content-Type': 'application/json' }); res.end('{"error":"too large"}'); req.destroy(); return; } chunks.push(d); });
        req.on('end', async () => { if (tooBig) return; const body = Buffer.concat(chunks).toString('utf8'); try { const r = await handler({ method: req.method, url: req.url, headers: req.headers, body }); res.writeHead(r?.status || 200, { 'Content-Type': 'application/json; charset=utf-8', ...(r?.headers || {}) }); res.end(typeof r?.body === 'string' ? r.body : JSON.stringify(r?.body ?? {})); } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })); } });
      });
      L.servers.push(srv);
      const p = new Promise((resolve, reject) => {
        let up = false;
        srv.on('listening', () => { up = true; log(id, 'listening on 127.0.0.1:' + port); resolve(true); });
        srv.on('error', (e) => {
          log(id, 'server error', e.message); if (up) return;
          const msg = e.code === 'EADDRINUSE' ? t('v26.port_busy', { name: m.name, port }) : t('v26.server_failed', { name: m.name, port, err: e.message });
          L.error = msg; if (reg.installed[id]) { reg.installed[id].error = msg; saveReg(); }
          try { bridge.toast({ text: msg, kind: 'err' }); } catch (_) {}
          reject(Object.assign(new Error(msg), { code: e.code }));
        });
      });
      p.catch(() => {}); // plugins that don't await serve() must not cause an unhandled rejection
      srv.listen(+port, '127.0.0.1'); return p;
    },
    exec: (cmd, o) => has(m, 'exec') ? ai.runCmd(String(cmd), { timeout: o?.timeout || 600000, cwd: o?.cwd }) : deny('exec'),
    randomId: (n) => require('crypto').randomBytes(Math.min(64, n || 24)).toString('hex'),
    platform: process.platform,
    secret: { get: (k) => secrets.get(`plugin:${id}:${k}`), set: (k, v) => secrets.set(`plugin:${id}:${k}`, v) },
    appVersion: APP_VERSION,
    // constant-time string compare (tokens, signatures)
    safeEqual: (a, b) => { const c = require('crypto'); const h = (x) => c.createHash('sha256').update(String(x ?? '')).digest(); return c.timingSafeEqual(h(a), h(b)); },
  };
  for (const k of ['storage', 'clipboard', 'secret']) Object.freeze(api[k]);
  return Object.freeze(api);
}
function sandbox(m, L, api) {
  const safe = (cb) => typeof cb !== 'function' ? cb : (...x) => { try { const r = cb(...x); if (r && typeof r.catch === 'function') r.catch(e => log(m.id, 'ERR timer', e?.message || String(e))); } catch (e) { log(m.id, 'ERR timer', e?.message || String(e)); } };
  const track = (fn, clr) => (cb, ...a) => { const h = fn(safe(cb), ...a); L.timers.add({ h, clr }); return h; };
  const ctx = { module: { exports: {} }, console: { log: (...a) => log(m.id, ...a), error: (...a) => log(m.id, 'ERR', ...a), warn: (...a) => log(m.id, 'WARN', ...a) },
    setTimeout: track(setTimeout, clearTimeout), setInterval: track(setInterval, clearInterval), clearTimeout, clearInterval,
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, nyx: api };
  // Date, Math, JSON, Promise come from the context itself (the host versions would hand out the host Function constructor).
  ctx.exports = ctx.module.exports;
  return vm.createContext(ctx, { name: 'plugin:' + m.id, codeGeneration: { strings: false, wasm: false } });
}
async function load(id) {
  if (loaded[id]) return loaded[id];
  const m = find(id); if (!m) throw new Error(t('plugins.002') + id);
  if (m.rendererCard && !fs.existsSync(path.join(m._dir, 'plugin.js'))) { loaded[id] = { manifest: m, mod: {}, timers: new Set(), servers: [], handlers: {} }; return loaded[id]; }
  const appr = reg.installed[id]?.approved || []; const missing = (m.permissions || []).filter(p => !appr.includes(p)); if (missing.length) throw new Error(t('plugins.003') + missing.join(', '));
  const code = require('./unpacked-integrity').readVerified(path.join(m._dir, 'plugin.js')).toString('utf8');
  const L = { manifest: m, timers: new Set(), servers: [], handlers: {} };
  L.api = makeApi(m, L);
  const ctx = sandbox(m, L, L.api);
  try { new vm.Script(code, { filename: `${id}/plugin.js` }).runInContext(ctx, { timeout: 2000 }); L.mod = ctx.module.exports || {}; loaded[id] = L; if (L.mod.activate) await L.mod.activate(L.api); log(id, t('plugins.004')); }
  catch (e) { log(id, t('plugins.005'), String(e.stack || e)); L.error = String(e.message || e); await unload(id); throw e; }
  return L;
}
async function unload(id) {
  const L = loaded[id]; if (!L) return;
  try { await L.mod?.deactivate?.(L.api); } catch (e) {}
  for (const t of L.timers) try { t.clr(t.h); } catch (e) {}
  for (const s of L.servers) try { s.close(); } catch (e) {}
  try { L.flushStore?.(); } catch (e) {}
  delete loaded[id]; log(id, t('plugins.006'));
}
async function startEnabled() { for (const [id, v] of Object.entries(reg.installed)) if (v.enabled && find(id)) { try { await load(id); reg.installed[id].error = null; } catch (e) { reg.installed[id].error = String(e.message || e); } } saveReg(); }
async function install(id, approved) { const m = find(id); if (!m) throw new Error(t('plugins.007')); if (!Array.isArray(approved) || !(m.permissions || []).every(p => approved.includes(p))) throw new Error(t('plugins.008')); const first = !reg.installed[id]; reg.installed[id] ||= { enabled: true, config: {} }; reg.installed[id].enabled = true; reg.installed[id].approved = [...approved]; if (id === 'mcp-server' && first) migrateMcpPerms(true); saveReg(); try { await load(id); } catch (e) { reg.installed[id].error = String(e.message); saveReg(); } return list(); }
async function uninstall(id) { await unload(id); delete reg.installed[id]; saveReg(); return list(); }
async function setEnabled(id, on) { const r = reg.installed[id]; if (!r) throw new Error(t('plugins.009')); r.enabled = !!on; r.error = null; saveReg(); if (on) { try { await load(id); } catch (e) { r.error = String(e.message); saveReg(); } } else await unload(id); return list(); }
async function setConfig(id, values) {
  const m = find(id); if (!m) throw new Error(t('plugins.007'));
  const r = (reg.installed[id] ||= { enabled: false, config: {} }); r.config ||= {};
  for (const f of m.config || []) { if (!(f.key in values)) continue; if (f.type === 'password') { if (values[f.key] !== '••••••') secrets.set(`plugin:${id}:${f.key}`, values[f.key]); } else r.config[f.key] = values[f.key]; }
  saveReg();
  if (loaded[id]) { await unload(id); try { await load(id); r.error = null; } catch (e) { r.error = String(e.message); } saveReg(); }
  return list();
}
async function action(id, act, args) {
  const L = loaded[id] || (reg.installed[id]?.enabled ? await load(id) : null);
  if (!L) throw new Error(t('plugins.010') + id);
  const fn = L.mod.actions?.[act]; if (!fn) throw new Error(t('plugins.011', { id, act }));
  log(id, t('plugins.012'), act); return await fn(args || {}, L.api);
}
async function cardRefresh(id, type, cfg) {
  const L = loaded[id] || (reg.installed[id]?.enabled ? await load(id) : null);
  if (!L) throw new Error(t('plugins.013') + id + t('plugins.014'));
  const fn = L.mod.cards?.[type]?.refresh; if (!fn) throw new Error(t('plugins.015') + type);
  return await fn(cfg || {}, L.api);
}
async function panel(id) { const L = loaded[id]; if (!L?.mod.panel) return null; return await L.mod.panel(L.api); }
function dispatch(ev, data) { for (const L of Object.values(loaded)) for (const fn of L.handlers[ev] || []) Promise.resolve().then(() => fn(data)).catch(e => log(L.manifest.id, 'handler', ev, String(e))); }
// Installing from a folder is two-step: installFromFolder() only validates the folder and remembers it;
// nothing is copied, replaced or deleted until the user approved the permissions (installPending).
const pendingFolders = new Map(); // id -> { src, perms }
function checkFolder(src) {
  const m = readManifest(src); if (!m?.id) throw new Error(t('plugins.016'));
  if (!validId(m.id)) throw new Error(t('plugins.017'));
  userDirFor(m.id);
  if (catalog().some(x => x.id === m.id && x.source === 'builtin')) throw new Error(t('v26.plugin_builtin_id', { id: m.id }));
  if (!m.rendererCard && !fs.existsSync(path.join(src, 'plugin.js'))) throw new Error(t('plugins.016'));
  if (isInside(USER_DIR, src) || path.resolve(src) === path.resolve(USER_DIR) || isInside(src, USER_DIR)) throw new Error(t('plugins.017'));
  return m;
}
async function installFromFolder(src) {
  const m = checkFolder(src);
  pendingFolders.set(m.id, { src, perms: [...(m.permissions || [])] });
  return { pending: m.id, permissions: m.permissions || [], name: m.name || m.id, version: m.version || '', requires: m.requires || null, verified: false, source: 'user', folder: true };
}
async function installPending(id, approved) {
  const p = pendingFolders.get(id); if (!p) throw new Error(t('plugins.007'));
  const m = checkFolder(p.src); // re-read: the folder may have changed since the dialog
  if (m.id !== id || JSON.stringify(m.permissions || []) !== JSON.stringify(p.perms)) { pendingFolders.delete(id); throw new Error(t('plugins.008')); }
  if (!Array.isArray(approved) || !(m.permissions || []).every(x => approved.includes(x))) throw new Error(t('plugins.008'));
  const dst = userDirFor(id); const stamp = Date.now() + '-' + require('crypto').randomBytes(3).toString('hex');
  const staging = path.join(USER_DIR, '.staging-' + id + '-' + stamp), old = path.join(USER_DIR, '.old-' + id + '-' + stamp);
  if (!isInside(USER_DIR, staging) || !isInside(USER_DIR, old)) throw new Error(t('plugins.017'));
  try { await fsp.cp(p.src, staging, { recursive: true, errorOnExist: true, filter: async (f) => !(await fsp.lstat(f)).isSymbolicLink() }); }
  catch (e) { await fsp.rm(staging, { recursive: true, force: true }).catch(() => {}); throw e; }
  await unload(id);
  let moved = false;
  try { if (fs.existsSync(dst)) { await fsp.rename(dst, old); moved = true; } await fsp.rename(staging, dst); }
  catch (e) { if (moved && !fs.existsSync(dst)) await fsp.rename(old, dst).catch(() => {}); await fsp.rm(staging, { recursive: true, force: true }).catch(() => {}); throw e; }
  pendingFolders.delete(id);
  if (moved && isInside(USER_DIR, old)) await fsp.rm(old, { recursive: true, force: true }).catch(() => {});
  return install(id, approved);
}
module.exports = { init, list, install, uninstall, setEnabled, setConfig, action, cardRefresh, panel, dispatch, startEnabled, unloadAll: async () => { for (const id of Object.keys(loaded)) await unload(id); }, logs: (id) => logs[id] || [], installFromFolder, installPending, validId, migrateMcpPerms };
