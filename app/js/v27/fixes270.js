'use strict';
// v2.7.0 fixes (pure, exported for the unit tests; in the renderer window.NyxFix270):
//  - modelBytes: the size of a model = its real GGUF file(s) on disk. 2.6.12–2.6.13.1 took the FIRST file that matched by
//    name OR by folder, so for Qwen3.8-27B-UD-Q4_K_XL the MTP draft in the same folder (mtp-Qwen3.8-27B-Q4_0.gguf, 1,68 GB)
//    was shown as the model's size («1,7 GB» instead of ~17 GB). Now: mmproj / MTP / draft files never count, split GGUFs
//    (-00001-of-00003) are summed, and inside a model folder the biggest main file wins.
//  - vramFromProcs: VRAM from the real processes. gpu.ps1 (existing, read-only, since 2.5) already returns the dedicated
//    VRAM of every process (WMI GPUProcessMemory); 2.6.x showed only the adapter's total. No new query, no new spawn.
(function (root) {
  const norm = (x) => String(x || '').toLowerCase().replace(/\.gguf$/, '');
  const isAux = (name) => /^mmproj/i.test(name) || /^mtp[-_.]/i.test(name) || /(^|[-_.])(draft|mtp)([-_.]|$)/i.test(String(name).replace(/\.gguf$/i, ''));
  const dirOf = (f) => String((f && f.rel) || '').split(/[\\/]/).slice(0, -1).join('/').toLowerCase();
  const shardBase = (s) => norm(s).replace(/-\d{5}-of-\d{5}$/, '');
  function modelBytes(name, files) {
    const n = shardBase(String(name || '').split(/[\\/]/).pop()); const main = (files || []).filter((f) => f && f.name && !isAux(f.name));
    const sum = (list) => ({ bytes: list.reduce((a, f) => a + (Number(f.size) || 0), 0), files: list.map((f) => f.rel || f.name) });
    if (!n) return { bytes: 0, files: [] };
    let pick = main.filter((f) => shardBase(f.name) === n);
    if (pick.length) return sum(pick);
    const pre = main.filter((f) => norm(f.name).startsWith(n));
    if (pre.length) { const groups = {}; for (const f of pre) (groups[dirOf(f) + '|' + shardBase(f.name)] ||= []).push(f); return sum(Object.values(groups).sort((a, b) => sum(b).bytes - sum(a).bytes)[0]); }
    const inDir = main.filter((f) => dirOf(f).split('/').pop() === n);
    if (inDir.length) { const big = inDir.reduce((a, b) => ((Number(b.size) || 0) > (Number(a.size) || 0) ? b : a)); const base = shardBase(big.name); pick = inDir.filter((f) => shardBase(f.name) === base); return sum(pick); }
    return { bytes: 0, files: [] };
  }
  const isGvs = (p) => /GPU[-_ ]?Voice[-_ ]?Studio/i.test(String((p && p.path) || ''));
  function vramFromProcs(snap) {
    const g = (snap && snap.gpu) || {}; const procs = (g.procs || []).filter((p) => p && Number(p.vram) > 0);
    if (!procs.length) return null;
    const label = (p) => (p.owner && /^nyx:/.test(p.owner) ? 'Nyx' : p.owner === 'llama' ? 'llama-server' : (p.name || ('pid ' + p.pid))) + (isGvs(p) ? ' (Voice Studio)' : '');
    const by = {}; for (const p of procs) { const k = label(p); (by[k] ||= { label: k, vram: 0, n: 0 }); by[k].vram += Number(p.vram); by[k].n++; }
    const top = Object.values(by).sort((a, b) => b.vram - a.vram);
    const llama = procs.filter((p) => (p.owner === 'llama' || /^llama[-_]?(server|router)?$/i.test(p.name || '')) && !isGvs(p)).reduce((a, p) => a + Number(p.vram), 0);
    return { total: procs.reduce((a, p) => a + Number(p.vram), 0), top, llama, adapterTotal: (g.adapter && g.adapter.total) || null, adapterUsed: g.adapter && g.adapter.used != null ? g.adapter.used : null, count: procs.length };
  }
  const api = { modelBytes, vramFromProcs, isAux };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NyxFix270 = api;
})(typeof window !== 'undefined' ? window : globalThis);
