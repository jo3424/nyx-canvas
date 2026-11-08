'use strict';
// Cached tool index: merges legacy launchable tools (systools) with v2.1 detection (tooldetect).
// Results live in <DATA_ROOT>/cache/tools-index.json — startup never re-detects; Settings → Tools has "Rescan".
const fs = require('fs'), path = require('path');
const systools = require('./systools'), td = require('./tooldetect'); const { getLang } = require('./i18n');
let C = null, running = null, scan = null;
const file = () => path.join(C.DATA_ROOT(), 'cache', 'tools-index.json');
function load() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { return null; } }
function save(o) { try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(o)); } catch (e) {} }
const ovKey = (ov) => JSON.stringify(Object.entries(ov || {}).sort());
// Merge: new detector rows win for shared ids, legacy `kind` kept so launch buttons still work.
function merge(legacy, fresh) {
  const kinds = Object.fromEntries(systools.TOOLS.map(t => [t.id, t.kind]));
  const map = new Map();
  for (const t of legacy.tools) if (t.id !== 'vulkan') map.set(t.id, t);
  for (const t of fresh.tools) map.set(t.id, { ...(map.get(t.id) || {}), ...t, kind: kinds[t.id] || (map.get(t.id) || {}).kind });
  return [...map.values()];
}
// row notes are localized → a language change re-detects
async function detect(ov = {}, force = false) {
  const cached = load();
  if (!force && cached && cached.ov === ovKey(ov) && cached.lang === getLang() && cached.tools) return { ...cached, cached: true };
  if (running) return running;
  running = (async () => {
    const [legacy, fresh] = await Promise.all([systools.detectAll(ov), td.detect({}, ov)]);
    const o = { at: Date.now(), ov: ovKey(ov), lang: getLang(), platform: process.platform, tools: merge(legacy, fresh), files: legacy.files, scan: (cached && cached.scan) || null };
    save(o); return { ...o, cached: false };
  })().finally(() => { running = null; });
  return running;
}
function startScan(opts = {}) {
  if (scan) return { running: true };
  const signal = { cancelled: false }; const send = (ch, x) => C.mainWin()?.webContents.send(ch, x);
  scan = { signal, started: Date.now() };
  td.deepScan({}, { roots: opts.roots, signal, onProgress: (p) => send('sys:scanProgress', p) }).then((r) => {
    const o = load() || { tools: null }; o.scan = { ...r, at: Date.now() }; save(o); send('sys:scanDone', o.scan);
  }).catch((e) => send('sys:scanDone', { error: String(e.message || e) })).finally(() => { scan = null; });
  return { running: true, started: scan.started };
}
function wire(ctx, H) {
  C = ctx;
  H('sys:detect', (ov, force) => detect(ov || {}, !!force));
  H('sys:scan', (opts) => startScan(opts || {}));
  H('sys:scanCancel', () => { if (scan) scan.signal.cancelled = true; return !!scan; });
  H('sys:scanState', () => ({ running: !!scan, started: scan?.started || null, last: (load() || {}).scan || null }));
  H('sys:openFolder', (p) => { const { shell } = require('electron'); try { if (fs.statSync(p).isDirectory()) return shell.openPath(p); shell.showItemInFolder(p); } catch (e) { return 'missing'; } });
}
module.exports = { wire, detect, merge, load };
