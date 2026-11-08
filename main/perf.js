'use strict';
// v2.5: Performance snapshot — RAM per Nyx process + managed servers, system RAM, GPU VRAM / utilisation / temperature.
// Windows: WMI GPU counters (hidden PowerShell); temperature only via LibreHardwareMonitor's WMI (honest null otherwise).
// Linux: amdgpu sysfs (mem_info_vram_*, gpu_busy_percent, hwmon temp*_input).
const fs = require('fs'), path = require('path'), os = require('os'), { execFile } = require('child_process');
function rssOf(pid) {
  if (process.platform === 'linux') { try { const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)\s+kB/); return m ? +m[1] * 1024 : 0; } catch (e) { return 0; } }
  return 0;
}
function winProcs(pids) {
  return new Promise((res) => { if (!pids.length) return res({}); execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.Id) $($_.WorkingSet64)\" }`], { windowsHide: true, timeout: 8000 }, (e, out) => { const o = {}; for (const l of String(out || '').split(/\r?\n/)) { const [p, w] = l.trim().split(/\s+/); if (p && w) o[+p] = +w; } res(o); }); });
}
function linuxGpu(root = '/sys/class/drm') {
  const out = { adapters: [], procs: [], temp: null, hot: null, util: null, tempSrc: '' };
  let cards = []; try { cards = fs.readdirSync(root).filter(c => /^card\d+$/.test(c)); } catch (e) { return out; }
  for (const c of cards) {
    const d = path.join(root, c, 'device'); const rd = (f) => { try { return fs.readFileSync(path.join(d, f), 'utf8').trim(); } catch (e) { return null; } };
    const total = +rd('mem_info_vram_total'); if (!total) continue;
    const a = { name: (rd('product_name') || 'AMD GPU ' + c), total, used: +rd('mem_info_vram_used') || 0 };
    const busy = rd('gpu_busy_percent'); if (busy != null) out.util = +busy;
    try { const hw = path.join(d, 'hwmon'); for (const hm of fs.readdirSync(hw)) { for (const f of fs.readdirSync(path.join(hw, hm)).filter(f => /^temp\d+_input$/.test(f))) { const v = +fs.readFileSync(path.join(hw, hm, f), 'utf8') / 1000; let lab = ''; try { lab = fs.readFileSync(path.join(hw, hm, f.replace('_input', '_label')), 'utf8').trim(); } catch (e) {} if (/junction|hotspot/i.test(lab)) out.hot = v; else if (out.temp == null || /edge/i.test(lab)) { out.temp = v; out.tempSrc = 'amdgpu'; } } } } catch (e) {}
    out.adapters.push(a); out.dedicated = (out.dedicated || 0) + a.used;
  }
  return out;
}
let gpuBusy = null, lastGpu = null, lastAt = 0;
function gpu() {
  if (process.platform === 'linux') return Promise.resolve(linuxGpu(process.env.NYX_DRM_ROOT || '/sys/class/drm'));
  if (process.platform !== 'win32') return Promise.resolve({ adapters: [], procs: [] });
  if (lastGpu && Date.now() - lastAt < 1500) return Promise.resolve(lastGpu);
  if (gpuBusy) return gpuBusy;
  let ps; try { ps = require('./unpacked-integrity').verifyFile(path.join(__dirname, 'res', 'gpu.ps1').replace('app.asar', 'app.asar.unpacked')); } catch (e) { return Promise.resolve({ adapters: [], procs: [], error: e.message }); }
  gpuBusy = new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps], { windowsHide: true, timeout: 15000, maxBuffer: 1 << 20 }, (e, out) => {
    gpuBusy = null; let j = null; try { j = JSON.parse(String(out).trim().split(/\r?\n/).filter(l => l.startsWith('{')).pop()); } catch (x) {}
    j = j || { adapters: [], procs: [], error: e ? String(e.message).slice(0, 200) : 'no data' };
    for (const k of ['adapters', 'procs']) if (j[k] && !Array.isArray(j[k])) j[k] = [j[k]];
    lastGpu = j; lastAt = Date.now(); res(j);
  }));
  return gpuBusy;
}
// pick the big discrete GPU (e.g. RX 7900 XTX 24 GB) as «the» GPU
function mainAdapter(g) { const a = (g.adapters || []).slice().sort((x, y) => (y.total || 0) - (x.total || 0))[0]; return a ? { ...a, used: a.used ?? g.dedicated ?? null } : null; }
async function snapshot(app, servers = {}) {
  const t0 = Date.now();
  const metrics = app.getAppMetrics().map(m => ({ pid: m.pid, type: m.type, name: m.name || m.serviceName || '', mem: (m.memory?.workingSetSize || 0) * 1024, cpu: Math.round((m.cpu?.percentCPUUsage || 0) * 10) / 10 }));
  const sp = Object.entries(servers); let srv = [];
  if (sp.length) { const w = process.platform === 'win32' ? await winProcs(sp.map(x => x[1])) : {}; srv = sp.map(([id, pid]) => ({ id, pid, mem: w[pid] || rssOf(pid) })); }
  const g = await gpu().catch(() => ({ adapters: [], procs: [] }));
  const pidSet = new Map([...metrics.map(m => [m.pid, 'nyx:' + m.type]), ...srv.map(s => [s.pid, s.id])]);
  const vramProcs = (g.procs || []).map(p => ({ ...p, owner: pidSet.get(p.pid) || '' })).sort((a, b) => b.vram - a.vram).slice(0, 12);
  for (const s of srv) s.vram = vramProcs.filter(p => p.pid === s.pid).reduce((a, p) => a + p.vram, 0) || null;
  return { at: Date.now(), ms: Date.now() - t0, platform: process.platform, ram: { total: os.totalmem(), free: os.freemem() }, nyx: metrics, nyxTotal: metrics.reduce((a, m) => a + m.mem, 0), servers: srv, gpu: { adapter: mainAdapter(g), util: g.util ?? null, temp: g.temp ?? null, hot: g.hot ?? null, tempSrc: g.tempSrc || '', procs: vramProcs, error: g.error || '' } };
}
module.exports = { snapshot, linuxGpu, mainAdapter };
