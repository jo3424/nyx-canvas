'use strict';
const { t, tr } = require('./i18n');
// Electron side of the code updater: IPC for Settings → Update. Core logic lives in update-core.js.
const { app, ipcMain, dialog, net, shell } = require('electron');
const fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os');
const core = require('./update-core');
const PUBLIC_KEY = require('./update-key');
const CODE_DIR = path.join(__dirname, '..');
const VERSION = require('../package.json').version;
const boot = () => global.__nyxBoot || { root: process.env.NYX_CODE_DIR || null, builtinVersion: VERSION, dir: CODE_DIR, version: VERSION, external: false };
let C = null; let busy = false;

function changelog() {
  try { const m = JSON.parse(fs.readFileSync(path.join(CODE_DIR, '.nyx-manifest.json'), 'utf8')); if (m.changelog) return { [m.version]: m.changelog, ...readBundledLog() }; } catch (e) {}
  return readBundledLog();
}
function readBundledLog() { try { return JSON.parse(fs.readFileSync(path.join(CODE_DIR, 'CHANGELOG.json'), 'utf8')); } catch (e) { return {}; } }
function info() {
  const b = boot(); const st = b.root ? core.readState(b.root) : {};
  return { version: VERSION, builtinVersion: b.builtinVersion, external: !!b.external, codeDir: CODE_DIR, root: b.root, canUpdate: !!b.root, active: st.active || null, previous: st.previous || null, confirmed: st.confirmed !== false, rolledBack: b.rolledBack || null, failed: st.failed || null, history: (st.history || []).slice(-8),
    electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, changelog: changelog() };
}
const err = (e) => ({ ok: false, code: e.code || 'ERROR', msg: String(e.message || e) });

async function get(url, { token, accept, json, timeout = 30000 } = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = { 'User-Agent': 'NyxCanvas/' + VERSION, Accept: accept || 'application/vnd.github+json' };
    if (token && /^https:\/\/(api\.)?github\.com\//.test(url)) headers.Authorization = 'Bearer ' + token;
    const r = await net.fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status + ' · ' + url), { code: r.status === 404 ? 'NOT_FOUND' : 'HTTP' });
    return json ? await r.json() : Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}
// Source = "owner/repo", "https://github.com/owner/repo" or a direct URL to nyx-latest.json
async function resolveSource(src) {
  const token = (() => { try { return require('./secrets').get('update:token'); } catch (e) { return ''; } })();
  src = String(src || '').trim(); if (!src) throw Object.assign(new Error(t('updater.001')), { code: 'NO_URL' });
  const gh = src.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (gh && !/\.json$/i.test(src)) {
    const rel = await get(`https://api.github.com/repos/${gh[1]}/${gh[2]}/releases/latest`, { token, json: true });
    const assets = Object.fromEntries((rel.assets || []).map(a => [a.name, a.url]));
    if (!assets['nyx-latest.json']) throw Object.assign(new Error(t('updater.002')), { code: 'NO_LATEST' });
    const latest = JSON.parse((await get(assets['nyx-latest.json'], { token, accept: 'application/octet-stream' })).toString('utf8'));
    return { latest, page: rel.html_url, fetchAsset: (name) => assets[name] ? get(assets[name], { token, accept: 'application/octet-stream', timeout: 600000 }) : Promise.reject(Object.assign(new Error(t('updater.003') + name), { code: 'NO_ASSET' })) };
  }
  if (!/^https:\/\//i.test(src) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(src)) throw Object.assign(new Error(t('updater.004')), { code: 'BAD_URL' });
  const latest = await get(src, { json: true, accept: 'application/json' });
  return { latest, page: src, fetchAsset: (name) => get(new URL(name, src).href, { accept: 'application/octet-stream', timeout: 600000 }) };
}
function pickAsset(latest) {
  if (latest.electron && latest.electron !== process.versions.electron) return { needsFull: true };
  const name = (latest.patches || {})[VERSION] || latest.fullCode || null;
  return { name };
}
async function check(src) {
  try {
    const { latest, page } = await resolveSource(src);
    const newer = core.cmpVer(latest.version, VERSION) > 0; const a = pickAsset(latest);
    return { ok: true, current: VERSION, latest: { version: latest.version, changelog: latest.changelog || {}, date: latest.date || null }, newer, needsFull: !!a.needsFull, asset: a.name, page };
  } catch (e) { return err(e); }
}
function applyFile(file) {
  const b = boot(); if (!b.root) return { ok: false, code: 'DEV', msg: t('updater.005') };
  if (busy) return { ok: false, code: 'BUSY', msg: t('updater.006') };
  busy = true;
  try { const r = core.applyPatch(file, { root: b.root, currentDir: CODE_DIR, currentVersion: VERSION, electron: process.versions.electron, publicKey: PUBLIC_KEY, onProgress: (p) => C?.send('upd:progress', p) }); return { ok: true, ...r, restart: true }; }
  catch (e) { return err(e); } finally { busy = false; }
}
async function download(src) {
  try {
    const s = await resolveSource(src); const a = pickAsset(s.latest);
    if (a.needsFull) return { ok: false, code: 'NEEDS_FULL', msg: t('updater.007'), page: s.page };
    if (core.cmpVer(s.latest.version, VERSION) <= 0) return { ok: false, code: 'NOT_NEWER', msg: t('updater.008') };
    if (!a.name) return { ok: false, code: 'NO_ASSET', msg: t('updater.009'), page: s.page };
    C?.send('upd:progress', 0.02);
    const buf = await s.fetchAsset(a.name); const tmp = path.join(os.tmpdir(), 'nyx-' + path.basename(a.name)); await fsp.writeFile(tmp, buf);
    try { return applyFile(tmp); } finally { fsp.unlink(tmp).catch(() => {}); }
  } catch (e) { return err(e); }
}
// Components (check-only): latest upstream releases of the external tools Nyx uses. Never downloads/installs.
async function componentsLatest() {
  const one = async (id, fn) => { try { return [id, { ok: true, ...(await fn()) }]; } catch (e) { return [id, { ok: false, msg: String(e.message || e) }]; } };
  const gh = (repo) => async () => { const r = await get(`https://api.github.com/repos/${repo}/releases/latest`, { json: true, timeout: 15000 }); return { tag: r.tag_name, date: r.published_at, url: r.html_url }; };
  const ff = async () => { const b = await get('https://www.gyan.dev/ffmpeg/builds/release-version', { accept: 'text/plain', timeout: 15000 }); return { tag: b.toString('utf8').trim(), url: 'https://www.gyan.dev/ffmpeg/builds/' }; };
  return Object.fromEntries(await Promise.all([one('llama', gh('ggml-org/llama.cpp')), one('whisper', gh('ggml-org/whisper.cpp')), one('ffmpeg', ff)]));
}
function wire(ctx) {
  C = ctx;
  const H = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => fn(...a));
  H('upd:info', () => info());
  H('upd:components', () => componentsLatest());
  H('upd:check', (src) => check(src));
  H('upd:download', (src) => download(src));
  H('upd:installFile', async (file) => {
    if (!file) { const r = await dialog.showOpenDialog(C.mainWin(), { title: t('updater.010'), properties: ['openFile'], filters: [{ name: 'Nyx update', extensions: ['zip'] }] }); if (r.canceled) return null; file = r.filePaths[0]; }
    return applyFile(file);
  });
  H('upd:rollback', () => { const b = boot(); if (!b.root) return { ok: false, code: 'DEV', msg: 'dev' }; return core.rollback(b.root, b.builtinVersion); });
  H('upd:restart', () => { app.relaunch(); app.exit(0); });
  H('upd:openRoot', () => { const b = boot(); if (b.root) { fs.mkdirSync(b.root, { recursive: true }); shell.openPath(b.root); } });
  H('upd:setToken', (tok) => { require('./secrets').set('update:token', tok || ''); return !!tok; });
  H('upd:hasToken', () => require('./secrets').has('update:token'));
}
// The window loaded fine and stayed up → mark this version as good (stops the crash counter).
function afterReady() { const b = boot(); if (b.root && b.external) setTimeout(() => { try { core.confirmBoot(b.root); } catch (e) {} }, 10000); }
module.exports = { wire, afterReady, info, check, VERSION };
