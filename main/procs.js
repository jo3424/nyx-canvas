'use strict';
const { t, tr } = require('./i18n');
// Managed local servers: llama-server, whisper-server (start/stop from Nyx, logs, health).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const nyxPath = require('./paths');
const procs = {}; // id -> { child, log:[], startedAt, cmd }
function splitArgs(s) { const out = []; const re = /"([^"]*)"|(\S+)/g; let m; while ((m = re.exec(s || ''))) out.push(m[1] ?? m[2]); return out; }
function argsFor(id, c) {
  const a = [];
  if (id === 'llama') { a.push('-m', c.model, '--host', '127.0.0.1', '--port', String(c.port || 8080)); if (c.ngl !== '') a.push('-ngl', String(c.ngl ?? 99)); if (c.ctx) a.push('-c', String(c.ctx)); if (c.jinja !== false) a.push('--jinja'); }
  else if (id === 'whisper') { a.push('-m', c.model, '--host', '127.0.0.1', '--port', String(c.port || 8178)); if (c.language) a.push('-l', c.language); if (c.convert) a.push('--convert'); }
  // v2.5: stable-diffusion.cpp sd-server (native Vulkan): models are picked in its web UI from --model-dir
  else if (id === 'sd') { if (c.modelDir) a.push('--model-dir', c.modelDir); if (c.loraDir) a.push('--lora-model-dir', c.loraDir); if (c.upscaleDir) a.push('--hires-upscalers-dir', c.upscaleDir); a.push('--listen-ip', '127.0.0.1', '--listen-port', String(c.port || 7860)); }
  return a.concat(splitArgs(c.extra));
}
const alive = (c) => !!c && c.exitCode == null && c.signalCode == null;
function status(id) { const p = procs[id]; return p ? { running: alive(p.child), pid: p.child?.pid, startedAt: p.startedAt, log: p.log.slice(-60), exit: p.exit, cmd: p.cmd } : { running: false, log: [] }; }
// v2.2: is something already listening on 127.0.0.1:port? (another llama-server, LM Studio, a previous Nyx run …)
function portBusy(port, host = '127.0.0.1', ms = 600) {
  return new Promise((res) => { const s = require('net').connect({ port: +port, host }); const done = (v) => { try { s.destroy(); } catch (e) {} res(v); }; s.setTimeout(ms, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false)); });
}
class ProcError extends Error { constructor(code, msg, extra = {}) { super(msg); this.code = code; Object.assign(this, extra); } }
// v2.6 (B-15): .bat/.cmd can't be spawned directly on Node ≥ 20.12 (CVE-2024-27980 → EINVAL). They run through
// cmd.exe (shell: true) with every token double-quoted; tokens cmd would still expand inside quotes are refused.
const isBatch = (exe) => process.platform === 'win32' && /\.(bat|cmd)$/i.test(String(exe || ''));
function cmdQuote(a) {
  a = String(a);
  if (/["%\r\n\0]/.test(a)) throw new ProcError('args', t('v26.bat_bad_arg', { v0: a.slice(0, 120) }));
  return '"' + a.replace(/(\\+)$/, '$1$1') + '"'; // a trailing backslash must not escape the closing quote
}
function batchLine(exe, args) { return [exe, ...args].map(cmdQuote).join(' '); }
// cmd.exe → the real server is its child: kill the whole tree on Windows
function killProc(p, force) {
  if (!alive(p?.child)) return;
  if (p.shell && process.platform === 'win32') { try { spawn('taskkill', ['/pid', String(p.child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {}); return; } catch (e) {} }
  try { p.child.kill(force ? 'SIGKILL' : undefined); } catch (e) {}
}
function resolveServerCfg(c) {
  return nyxPath.resolveCfgPaths(c || {}, ['exe', 'model', 'modelDir', 'loraDir', 'upscaleDir']);
}
function precheck(id, c) {
  c = resolveServerCfg(c);
  if (!c.exe || !fs.existsSync(c.exe)) return new ProcError('exe', t('procs.001') + (c.exe || '—'), { field: 'exe' });
  if (fs.statSync(c.exe).isDirectory()) return new ProcError('exe', t('procs.010', { v0: c.exe }), { field: 'exe' });
  if (id === 'sd') { if (c.modelDir && !fs.existsSync(c.modelDir)) return new ProcError('model', t('v25.sd_nodir', { v0: c.modelDir }), { field: 'modelDir' }); return null; }
  if (!c.model) return new ProcError('model', t('procs.011'), { field: 'model' });
  if (!fs.existsSync(c.model)) return new ProcError('model', t('procs.002') + c.model, { field: 'model' });
  return null;
}
async function start(id, c, onEvent, { settleMs = 1500 } = {}) {
  c = resolveServerCfg(c);
  if (alive(procs[id]?.child)) return status(id);
  const bad = precheck(id, c); if (bad) throw bad;
  const port = +c.port || ({ llama: 8080, sd: 7860 })[id] || 8178;
  if (await portBusy(port)) throw new ProcError('port', t('procs.012', { v0: port }), { port });
  const args = argsFor(id, c);
  const shell = isBatch(c.exe);
  const child = shell ? spawn(batchLine(c.exe, args), [], { cwd: path.dirname(c.exe), windowsHide: true, shell: true }) : spawn(c.exe, args, { cwd: path.dirname(c.exe), windowsHide: true });
  const P = procs[id] = { child, shell, log: [], startedAt: Date.now(), cmd: [c.exe, ...args].map(a => /\s/.test(a) ? `"${a}"` : a).join(' ') };
  const push = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { P.log.push(l.slice(0, 400)); if (P.log.length > 400) P.log.shift(); } };
  child.stdout.on('data', push); child.stderr.on('data', push);
  const ended = new Promise((res) => {
    child.on('error', (e) => { push('ERROR ' + e.message); P.exit = String(e.message); onEvent?.(id, status(id)); res(); });
    child.on('exit', (code, sig) => { P.exit = code ?? sig; push(t('procs.003') + code); onEvent?.(id, status(id)); res(); });
  });
  onEvent?.(id, status(id));
  // a server that dies right away (bad flag, wrong model format, missing DLL, out of VRAM) → report it with the log tail
  await Promise.race([ended, new Promise(r => setTimeout(r, settleMs))]);
  if (child.exitCode != null || P.exit != null) {
    const tail = P.log.filter(l => !l.startsWith(t('procs.003'))).slice(-6).join('\n');
    throw new ProcError('exited', t('procs.013', { v0: P.exit }) + (tail ? '\n' + tail : ''), { log: P.log.slice(-60) });
  }
  return status(id);
}
function stop(id) { const p = procs[id]; killProc(p); return status(id); }
function stopAll() { for (const id of Object.keys(procs)) stop(id); }
// v2.5: stop and wait until the process is really gone (router model switch frees VRAM before the next load)
function stopWait(id, ms = 15000) { const p = procs[id]; if (!alive(p?.child)) return Promise.resolve(status(id)); return new Promise((res) => { const done = () => { clearTimeout(tm); res(status(id)); }; const tm = setTimeout(() => { killProc(p, true); setTimeout(done, 300); }, ms); p.child.once('exit', done); try { killProc(p); } catch (e) { done(); } }); }
// v2.5: memory of the managed servers (Performance panel)
function pids() { const o = {}; for (const [id, p] of Object.entries(procs)) if (alive(p.child)) o[id] = p.child.pid; return o; }
module.exports = { start, stop, stopWait, stopAll, status, splitArgs, argsFor, precheck, portBusy, pids, batchLine, isBatch };
