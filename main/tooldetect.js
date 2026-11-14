'use strict';
// v2.1 tool & path detection for Settings → Tools & paths.
// All I/O goes through `deps` so tests can run it against a mocked file system (tests/tools-unit.js).
//   deps = { fs: {existsSync, statSync, readdirSync, readFileSync}, fsp: {readdir, stat}, exec(cmd,args,timeout)→{err,out}, env, platform, home, http(url)→bool }
const nodePath = require('path');
const nyxPath = require('./paths');

function mkDeps(over = {}) {
  const fs = over.fs || require('fs');
  const d = {
    fs, fsp: over.fsp || fs.promises, platform: over.platform || process.platform, env: over.env || process.env, home: over.home || nyxPath.userHome({ env: over.env || process.env, platform: over.platform || process.platform }),
    exec: over.exec || ((cmd, args, timeout = 5000) => new Promise((res) => { try { require('child_process').execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 << 20 }, (err, out, er) => res({ err, out: String(out || '') + String(er || '') })); } catch (e) { res({ err: e, out: '' }); } })),
    http: over.http || (async (url) => { try { const c = new AbortController(); setTimeout(() => c.abort(), 1200); const r = await fetch(url, require('./routerkey').withAuth(url, { signal: c.signal })); return r.ok; } catch (e) { return false; } }),
  };
  d.path = d.platform === 'win32' ? nodePath.win32 : nodePath.posix;
  return d;
}
const ex = (d, p) => { try { return !!p && d.fs.existsSync(p); } catch (e) { return false; } };
const isDir = (d, p) => { try { return d.fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const size = (d, p) => { try { return d.fs.statSync(p).size; } catch (e) { return 0; } };
const ls = (d, p) => { try { return d.fs.readdirSync(p); } catch (e) { return []; } };
const E = (d, s) => s.replace(/%([^%]+)%/g, (m, k) => d.env[k] ?? d.env[k.toUpperCase()] ?? m);
const firstLine = (s) => (String(s || '').split(/\r?\n/).find(Boolean) || '').trim().slice(0, 100);
async function which(d, name) {
  const r = await d.exec(d.platform === 'win32' ? 'where' : 'which', [name], 3000); if (r.err) return [];
  return r.out.split(/\r?\n/).map(s => s.trim()).filter(p => p && ex(d, p));
}
async function version(d, exe, args, re) {
  const r = await d.exec(exe, args, 5000); const out = r.out || '';
  const m = re && out.match(re); return m ? (m[1] || m[0]).trim() : firstLine(out);
}
const row = (id, name, cat, o = {}) => ({ id, name, cat, found: false, version: '', path: '', size: 0, note: '', items: [], ...o });

// ---------- individual detectors ----------
async function exeTool(d, { id, name, cat, cmds, paths = [], ver, parse, override }) {
  const r = row(id, name, cat);
  let p = override && ex(d, nyxPath.expandVars(override, { env: d.env, platform: d.platform, home: d.home })) ? nyxPath.expandVars(override, { env: d.env, platform: d.platform, home: d.home }) : null;
  if (!p) for (const c of cmds) { const w = await which(d, c); if (w.length) { p = w[0]; break; } }
  if (!p) for (const k of paths) { const q = E(d, k); if (!/%/.test(q) && ex(d, q)) { p = q; break; } }
  if (p) { r.found = true; r.path = p; r.size = size(d, p); if (ver) r.version = await version(d, p, ver, parse); }
  return r;
}
async function vulkanRuntime(d) {
  const r = row('vulkan-rt', 'Vulkan runtime', 'GPU');
  if (d.platform === 'win32') {
    const dll = d.path.join(E(d, '%SystemRoot%'), 'System32', 'vulkan-1.dll');
    if (ex(d, dll)) { r.found = true; r.path = dll; r.size = size(d, dll); }
    const q = await d.exec('reg', ['query', 'HKLM\\SOFTWARE\\Khronos\\Vulkan\\Drivers'], 3000);
    const drivers = q.err ? [] : q.out.split(/\r?\n/).map(l => l.trim().match(/^(.+?\.json)\s+REG_DWORD/i)).filter(Boolean).map(m => m[1]);
    r.items = drivers.map(p => ({ name: d.path.basename(p), path: p }));
    if (drivers.length) r.version = drivers.length + ' ICD driver(s)';
  } else {
    for (const p of ['/usr/lib/x86_64-linux-gnu/libvulkan.so.1', '/usr/lib/libvulkan.so.1', '/usr/lib64/libvulkan.so.1']) if (ex(d, p)) { r.found = true; r.path = p; break; }
    const icd = '/usr/share/vulkan/icd.d'; r.items = ls(d, icd).map(n => ({ name: n, path: d.path.join(icd, n) }));
  }
  return r;
}
async function vulkanSdk(d) {
  const r = row('vulkan-sdk', 'Vulkan SDK', 'GPU');
  let sdk = d.env.VULKAN_SDK && isDir(d, d.env.VULKAN_SDK) ? d.env.VULKAN_SDK : null;
  if (!sdk && d.platform === 'win32') { const base = 'C:\\VulkanSDK'; const vs = ls(d, base).filter(n => /^\d+\.\d+/.test(n)).sort(cmpV); if (vs.length) sdk = d.path.join(base, vs[vs.length - 1]); }
  if (sdk) {
    r.found = true; r.path = sdk; r.version = (d.path.basename(sdk).match(/\d+\.\d+[\d.]*/) || [''])[0];
    const vi = d.path.join(sdk, d.platform === 'win32' ? 'Bin' : 'bin', d.platform === 'win32' ? 'vulkaninfo.exe' : 'vulkaninfo');
    if (ex(d, vi)) r.items.push({ name: 'vulkaninfo', path: vi });
  } else {
    const w = (await which(d, 'vulkaninfo'))[0] || (d.platform === 'win32' && ex(d, 'C:\\Windows\\System32\\vulkaninfoSDK.exe') ? 'C:\\Windows\\System32\\vulkaninfoSDK.exe' : null);
    if (w) { r.note = 'vulkaninfo: ' + w; r.version = await version(d, w, ['--summary'], /Vulkan Instance Version:\s*([\d.]+)/); }
  }
  return r;
}
function cmpV(a, b) { const pa = String(a).match(/\d+/g) || [], pb = String(b).match(/\d+/g) || []; for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = (+pa[i] || 0) - (+pb[i] || 0); if (x) return x; } return 0; }
async function pythons(d) {
  // v2.3: one entry per real file — paths are canonicalised (quotes, / vs \\, case, 8.3 names/junctions via realpath) before keying
  const canon = (p) => { let q = String(p).trim().replace(/^"+|"+$/g, ''); if (d.platform === 'win32') q = q.replace(/\//g, '\\').replace(/\\{2,}/g, '\\'); try { const rp = d.fs.realpathSync?.native || d.fs.realpathSync; if (rp) q = rp(q); } catch (e) {} return q; };
  const found = new Map(); const add = (p0, src) => { if (!p0) return; const p = canon(p0); const k = d.platform === 'win32' ? p.toLowerCase() : p; if (!ex(d, p)) return; if (!found.has(k)) found.set(k, { path: p, src: [src] }); else if (!found.get(k).src.includes(src)) found.get(k).src.push(src); };
  for (const c of d.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']) for (const p of await which(d, c)) add(p, 'PATH');
  if (d.platform === 'win32') {
    const py = await d.exec('py', ['-0p'], 4000);
    if (!py.err) for (const l of py.out.split(/\r?\n/)) { const m = l.match(/(?:^|\s)([A-Za-z]:\\.+?python[w\d.t]*\.exe)\s*$/i); if (m) add(m[1].trim(), 'py'); }
    for (const hive of ['HKCU', 'HKLM', 'HKLM\\SOFTWARE\\WOW6432Node']) {
      const key = hive.startsWith('HKLM\\SOFTWARE') ? hive + '\\Python' : hive + '\\Software\\Python';
      const q = await d.exec('reg', ['query', key, '/s', '/v', 'ExecutablePath'], 4000);
      if (!q.err) for (const l of q.out.split(/\r?\n/)) { const m = l.match(/ExecutablePath\s+REG_SZ\s+(.+)$/i); if (m) add(m[1].trim(), 'registry'); }
    }
    const lp = E(d, '%LOCALAPPDATA%\\Programs\\Python'); for (const n of ls(d, lp)) add(d.path.join(lp, n, 'python.exe'), 'folder');
  }
  const r = row('python', 'Python', 'Dev', { items: [] });
  for (const { path: p, src } of found.values()) {
    const store = /WindowsApps/i.test(p);
    const v = store ? '' : await version(d, p, ['--version'], /Python\s+(\S+)/);
    r.items.push({ name: 'Python ' + (v || '?'), version: v, path: p, note: (store ? 'Microsoft Store alias · ' : '') + src.join(', ') });
  }
  // same install reached by two different paths (same version + same exe size) → keep one, merge sources
  const uniq = []; for (const it of r.items) { const sz = size(d, it.path); const dup = it.version && uniq.find(u => u.version === it.version && u._sz === sz && !/WindowsApps/i.test(u.path)); if (dup) { dup.note += ', ' + it.note; dup.alt = (dup.alt || []).concat(it.path); } else uniq.push({ ...it, _sz: sz }); }
  // the Microsoft Store alias is only a launcher stub when a real Python exists
  const real = uniq.filter(i => !/WindowsApps/i.test(i.path)); r.items = (real.length ? real : uniq).map(({ _sz, ...i }) => i);
  // primary = what «python» runs (first real one on PATH), else the newest
  r.items.sort((a, b) => cmpV(b.version, a.version));
  const prim = r.items.find(i => /PATH/.test(i.note)) || r.items[0]; if (prim) { prim.primary = true; r.items = [prim, ...r.items.filter(i => i !== prim)]; }
  if (r.items.length) { r.found = true; r.version = r.items.filter(i => i.version).map(i => i.version).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4).join(' · '); r.path = prim.path; }
  return r;
}
// Folder-style things (models dirs, caches, ComfyUI)
function dirRow(d, id, name, cat, candidates, extra) {
  const r = row(id, name, cat);
  for (const c of candidates) { const p = E(d, c); if (!/%/.test(p) && isDir(d, p)) { r.found = true; r.path = p; break; } }
  if (r.found && extra) extra(r);
  return r;
}
function countModels(d, dir, depth = 3, out = { n: 0, bytes: 0, items: [] }) {
  if (depth < 0 || out.n > 400) return out;
  for (const n of ls(d, dir)) {
    const p = d.path.join(dir, n);
    if (/\.(gguf|safetensors|ckpt|onnx)$/i.test(n)) { const s = size(d, p); out.n++; out.bytes += s; if (out.items.length < 60) out.items.push({ name: n, path: p, size: s }); }
    else if (depth > 0 && isDir(d, p)) countModels(d, p, depth - 1, out);
  }
  return out;
}
function comfy(d) {
  const H = d.home; const cands = d.platform === 'win32' ? ['C:\\ComfyUI-Zluda', 'C:\\ComfyUI', 'C:\\ComfyUI_windows_portable\\ComfyUI', d.path.join(H, 'ComfyUI'), d.path.join(H, 'ComfyUI-Zluda'), d.path.join(H, 'Desktop', 'ComfyUI'), 'D:\\ComfyUI', 'D:\\ComfyUI-Zluda'] : [d.path.join(H, 'ComfyUI')];
  return dirRow(d, 'comfyui', 'ComfyUI', 'AI', cands, (r) => {
    try { const v = d.fs.readFileSync(d.path.join(r.path, 'comfyui_version.py'), 'utf8').match(/__version__\s*=\s*["']([^"']+)/); if (v) r.version = v[1]; } catch (e) {}
    if (!ex(d, d.path.join(r.path, 'main.py'))) r.note = 'main.py ?';
    const md = d.path.join(r.path, 'models'); if (isDir(d, md)) { const c = countModels(d, md, 2); r.items = c.items; r.note = c.n + ' models'; r.size = c.bytes; }
  });
}
function lmstudio(d) {
  const H = d.home; let custom = null;
  try { const s = JSON.parse(d.fs.readFileSync(d.path.join(H, '.lmstudio', 'settings.json'), 'utf8')); custom = s.downloadsFolder || null; } catch (e) {}
  return dirRow(d, 'lmstudio-models', 'LM Studio models', 'AI', [custom, d.path.join(H, '.lmstudio', 'models'), d.path.join(H, '.cache', 'lm-studio', 'models')].filter(Boolean), (r) => { const c = countModels(d, r.path, 3); r.items = c.items; r.version = c.n + ' .gguf'; r.size = c.bytes; });
}
function hfCache(d) {
  const H = d.home; const e = d.env;
  const c = [e.HUGGINGFACE_HUB_CACHE, e.HF_HUB_CACHE, e.HF_HOME && d.path.join(e.HF_HOME, 'hub'), d.path.join(H, '.cache', 'huggingface', 'hub')].filter(Boolean);
  return dirRow(d, 'hf-cache', 'Hugging Face cache', 'AI', c, (r) => { const repos = ls(d, r.path).filter(n => /^models--/.test(n)); r.items = repos.slice(0, 80).map(n => ({ name: n.replace(/^models--/, '').replace(/--/g, '/'), path: d.path.join(r.path, n) })); r.version = repos.length + ' repos'; });
}
async function ollama(d, ov) {
  const r = await exeTool(d, { id: 'ollama', name: 'Ollama', cat: 'AI', cmds: ['ollama'], paths: ['%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe'], ver: ['--version'], parse: /version is (\S+)|(\d+\.\d+\.\d+)/, override: ov.ollama });
  const md = d.env.OLLAMA_MODELS || d.path.join(d.home, '.ollama', 'models');
  if (isDir(d, md)) { const lib = d.path.join(md, 'manifests', 'registry.ollama.ai', 'library'); const names = ls(d, lib); r.items = names.map(n => ({ name: n, path: d.path.join(lib, n) })); r.note = 'models: ' + md + ' (' + names.length + ')'; }
  r.serving = await d.http('http://127.0.0.1:11434/api/version');
  return r;
}
const GVS = (d, rel) => d.path.join(d.home, 'GPU-Voice-Studio', rel);
async function detect(over = {}, overrides = {}) {
  const d = mkDeps(over); const W = d.platform === 'win32'; const H = d.home;
  const jobs = [
    exeTool(d, { id: 'ffmpeg', name: 'FFmpeg', cat: 'Media', cmds: ['ffmpeg'], paths: ['C:\\ffmpeg\\bin\\ffmpeg.exe', '%ProgramFiles%\\ffmpeg\\bin\\ffmpeg.exe', '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\ffmpeg.exe', '/usr/bin/ffmpeg'], ver: ['-version'], parse: /ffmpeg version (\S+)/, override: overrides.ffmpeg }),
    exeTool(d, { id: 'ffprobe', name: 'FFprobe', cat: 'Media', cmds: ['ffprobe'], paths: ['C:\\ffmpeg\\bin\\ffprobe.exe'], ver: ['-version'], parse: /ffprobe version (\S+)/, override: overrides.ffprobe }),
    vulkanRuntime(d), vulkanSdk(d), pythons(d),
    exeTool(d, { id: 'git', name: 'Git', cat: 'Dev', cmds: ['git'], paths: ['%ProgramFiles%\\Git\\cmd\\git.exe'], ver: ['--version'], parse: /git version (\S+)/, override: overrides.git }),
    exeTool(d, { id: 'node', name: 'Node.js', cat: 'Dev', cmds: ['node'], paths: ['%ProgramFiles%\\nodejs\\node.exe'], ver: ['--version'], parse: /v?(\d[\d.]+)/, override: overrides.node }),
    exeTool(d, { id: 'llama', name: 'llama.cpp (llama-server)', cat: 'AI', cmds: ['llama-server', 'llama-cli'], paths: [GVS(d, 'third_party\\llama\\llama-server.exe'), 'C:\\llama.cpp\\build\\bin\\Release\\llama-server.exe', 'C:\\llama.cpp\\llama-server.exe', d.path.join(H, 'llama.cpp', 'build', 'bin', W ? 'Release\\llama-server.exe' : 'llama-server')], ver: ['--version'], parse: /version:\s*(\S+(?: \([0-9a-f]+\))?)/, override: overrides.llama }),
    exeTool(d, { id: 'whisper', name: 'whisper.cpp', cat: 'AI', cmds: ['whisper-server', 'whisper-cli'], paths: [GVS(d, 'third_party\\whisper.cpp\\build-vulkan\\bin\\Release\\whisper-server.exe'), 'C:\\whisper.cpp\\build\\bin\\Release\\whisper-server.exe', d.path.join(H, 'whisper.cpp', 'build', 'bin', W ? 'Release\\whisper-server.exe' : 'whisper-server')], override: overrides.whisper }),
    Promise.resolve(comfy(d)), Promise.resolve(lmstudio(d)), ollama(d, overrides), Promise.resolve(hfCache(d)),
    Promise.resolve(dirRow(d, 'forge-models', 'Forge models', 'AI', ['C:\\ForgeXTX\\models', d.path.join(H, 'ForgeXTX', 'models')], (r) => { const c = countModels(d, r.path, 2); r.version = c.n + ' models'; r.size = c.bytes; r.items = c.items; })),
    Promise.resolve(dirRow(d, 'gvs', 'GPU-Voice-Studio', 'AI', [GVS(d, '')], (r) => { const c = countModels(d, d.path.join(r.path, 'models'), 1); r.items = c.items; r.version = c.n + ' models'; r.size = c.bytes; })),
    exeTool(d, { id: 'everything', name: 'Everything (es.exe)', cat: 'Apps', cmds: ['es'], paths: ['%ProgramFiles%\\Everything\\es.exe', '%ProgramFiles%\\Everything 1.5a\\es.exe'] }),
  ];
  const tools = (await Promise.all(jobs.map(j => j.catch(e => row('error', String(e.message || e), 'Dev'))))).filter(Boolean);
  return { tools, platform: d.platform, at: Date.now() };
}

// ---------- deep scan for model files (async, cancellable, yields to the event loop) ----------
const SKIP = /^(windows|\$recycle\.bin|system volume information|programdata\\microsoft|node_modules|\.git|temp|tmp|\$windows\.~bt|\$winreagent|appdata\\local\\temp|proc|sys|dev|snap|\.cache\\pip|__pycache__|\.npm|site-packages)$/i;
const MODEL_RE = /\.(gguf|safetensors|ckpt|onnx)$|^ggml-.*\.bin$/i;
function deepScan(over = {}, { roots, minSize = 50 * 1024 * 1024, maxDepth = 14, onProgress = () => {}, signal = { cancelled: false } } = {}) {
  const d = mkDeps(over);
  return (async () => {
    if (!roots) roots = d.platform === 'win32' ? 'CDEFGHIJ'.split('').map(l => l + ':\\').filter(p => ex(d, p)) : [d.home];
    const items = []; let dirs = 0; const t0 = Date.now();
    // Everything fast path
    const es = d.platform === 'win32' ? (await which(d, 'es'))[0] : null;
    if (es) {
      const r = await d.exec(es, ['-size', '-full-path-and-name', 'regex:\\.(gguf|safetensors|ckpt|onnx)$|\\\\ggml-[^\\\\]*\\.bin$'], 30000);
      if (!r.err && r.out.trim()) {
        for (const l of r.out.split(/\r?\n/)) { const m = l.trim().match(/^([\d,]+)\s+(.+)$/); if (m) { const s = +m[1].replace(/,/g, ''); if (s >= minSize) items.push({ name: d.path.basename(m[2]), path: m[2], size: s }); } }
        return { items: sortItems(items), dirs: 0, roots, via: 'everything', ms: Date.now() - t0, cancelled: false };
      }
    }
    const stack = roots.map(r => [r, 0]);
    while (stack.length) {
      if (signal.cancelled) return { items: sortItems(items), dirs, roots, via: 'walk', ms: Date.now() - t0, cancelled: true };
      const [dir, depth] = stack.pop(); let ents;
      try { ents = await d.fsp.readdir(dir, { withFileTypes: true }); } catch (e) { continue; }
      dirs++; if (dirs % 200 === 0) { onProgress({ dirs, found: items.length, dir }); await new Promise(r => setImmediate(r)); }
      for (const e of ents) {
        const p = d.path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < maxDepth && !SKIP.test(e.name) && !e.name.startsWith('$')) stack.push([p, depth + 1]); }
        else if (MODEL_RE.test(e.name)) { let s = 0; try { s = (await d.fsp.stat(p)).size; } catch (er) {} if (s >= minSize) items.push({ name: e.name, path: p, size: s }); }
      }
    }
    return { items: sortItems(items), dirs, roots, via: 'walk', ms: Date.now() - t0, cancelled: false };
  })();
}
const sortItems = (a) => a.sort((x, y) => y.size - x.size);
module.exports = { detect, deepScan, mkDeps, cmpV, MODEL_RE };
