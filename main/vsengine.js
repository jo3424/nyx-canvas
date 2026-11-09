'use strict';
// v2.4: vs-engine (GPU-Voice-Studio) is an HTTP server, not a CLI:
//   vs-engine.exe --model <gguf> --codec <gguf> [--device Vulkan0|CPU] [--port 0] [--no-fa] [--clamp-fp16]
//   and it refuses to start without VS_ENGINE_TOKEN (>= 16 chars) in the environment.
// Its HTTP API is not documented anywhere public, so we: start it hidden with our own random token, read the port it
// prints, PROBE the usual endpoints (raw answers are shown in «Δοκιμή»), then try OpenAI-style /v1/audio/speech and
// the common /tts-like routes (or the user's own endpoint) and keep the first that returns audio.
const { spawn } = require('child_process');
const fs = require('fs'), fsp = fs.promises, path = require('path'), net = require('net'), crypto = require('crypto');
const nyxPath = require('./paths');
let proc = null, info = null, logBuf = '', learned = null;
const log = (s) => { logBuf = (logBuf + s).slice(-12000); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function token(secrets) {
  let tk = secrets.get('vsengine.token');
  if (!tk || tk.length < 16) { tk = crypto.randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32); while (tk.length < 32) tk += crypto.randomBytes(4).toString('hex'); tk = tk.slice(0, 32); secrets.set('vsengine.token', tk); }
  return tk;
}
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
// "listening on http://127.0.0.1:51234", "port: 51234", "Server started at 0.0.0.0:8080" …
function parsePort(txt) {
  const m = /https?:\/\/[\w.\-\[\]:]*?:(\d{2,5})\b/i.exec(txt) || /\b(?:listen\w*|port|serving|server\s+(?:started|running))\b[^\n\d]{0,40}?(?:[\d.]+:)?(\d{2,5})\b/i.exec(txt) || /\b(?:127\.0\.0\.1|0\.0\.0\.0|localhost):(\d{2,5})\b/i.exec(txt);
  const p = m && +m[1]; return p && p > 0 && p < 65536 ? p : 0;
}
const authHeaders = (tk) => ({ Authorization: 'Bearer ' + tk, 'X-Token': tk, 'X-API-Key': tk, 'X-VS-Engine-Token': tk });

async function req(url, { method = 'GET', headers = {}, body, timeout = 8000 } = {}) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { method, headers, body, signal: ac.signal });
    const ct = r.headers.get('content-type') || ''; const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ctype: ct, buf };
  } catch (e) { return { status: 0, error: e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message) }; }
  finally { clearTimeout(tm); }
}
const isAudio = (r) => r.status >= 200 && r.status < 300 && r.buf && r.buf.length > 44 && (/^audio\//i.test(r.ctype) || /octet-stream/i.test(r.ctype) && r.buf.slice(0, 4).toString() === 'RIFF' || r.buf.slice(0, 4).toString() === 'RIFF' || r.buf.slice(0, 4).toString() === 'OggS' || r.buf.slice(0, 3).toString() === 'ID3');
const snippet = (r) => r.error ? r.error : (/json|text|html|xml/i.test(r.ctype) || !r.ctype ? r.buf.toString('utf8').slice(0, 600) : `[${r.ctype} · ${r.buf.length} bytes]`);

function args(cfg, port) {
  const a = ['--model', cfg.model || '', '--codec', cfg.tokenizer || cfg.codec || ''];
  if (cfg.device) a.push('--device', String(cfg.device));
  a.push('--port', String(port));
  if (cfg.noFa) a.push('--no-fa'); if (cfg.clampFp16) a.push('--clamp-fp16');
  return a;
}
function status() { return { running: !!(proc && proc.exitCode == null && proc.signalCode == null), ...(info || {}), log: logBuf.slice(-4000), learned }; }

async function start(cfg, secrets, { wait = 180000 } = {}) {
  if (proc && proc.exitCode == null && proc.signalCode == null && info?.port && info.exe === cfg.exe && info.model === cfg.model) return status();
  stop();
  cfg = nyxPath.resolveCfgPaths(cfg || {}, ['exe', 'model', 'tokenizer', 'codec', 'refAudio']);
  if (!cfg.exe || !fs.existsSync(cfg.exe)) throw new Error('vs-engine.exe: ' + (cfg.exe || '—'));
  for (const k of ['model', 'tokenizer']) if (!cfg[k] || !fs.existsSync(cfg[k])) throw new Error((k === 'model' ? '--model' : '--codec') + ': ' + (cfg[k] || '—'));
  const tk = token(secrets); const want = +cfg.port || await freePort();
  logBuf = ''; learned = null;
  const a = args(cfg, want);
  const ch = proc = spawn(cfg.exe, a, { cwd: path.dirname(cfg.exe), windowsHide: true, env: { ...process.env, VS_ENGINE_TOKEN: tk } });
  info = { exe: cfg.exe, model: cfg.model, port: want, cmd: [cfg.exe, ...a].map(x => /\s/.test(x) ? `"${x}"` : x).join(' '), startedAt: Date.now(), tokenLen: tk.length };
  let exited = null;
  ch.stdout.on('data', d => { log(String(d)); const p = parsePort(String(d)); if (p && p !== info.port) info.port = p; });
  ch.stderr.on('data', d => { log(String(d)); const p = parsePort(String(d)); if (p && p !== info.port) info.port = p; });
  ch.on('error', e => { exited = e.message; log('\n[spawn] ' + e.message); });
  ch.on('exit', (c) => { exited = exited || ('exit ' + c); log(`\n[exit ${c}]`); if (proc === ch) proc = null; });
  // ready = anything answers HTTP on the port (even 401/404) — model loading can take a while on first start
  const t0 = Date.now();
  while (Date.now() - t0 < wait) {
    if (exited) { const e = new Error(exited + ': ' + lastLine(logBuf)); e.log = logBuf.slice(-3000); e.cmd = info.cmd; throw e; }
    const r = await req(`http://127.0.0.1:${info.port}/`, { timeout: 1500 });
    if (r.status) { info.readyMs = Date.now() - t0; return status(); }
    await sleep(400);
  }
  const e = new Error('vs-engine: no HTTP answer on port ' + info.port + ' after ' + Math.round(wait / 1000) + 's'); e.log = logBuf.slice(-3000); e.cmd = info.cmd; throw e;
}
const lastLine = (s) => { const L = String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean); return (L.filter(x => /error|fail|invalid|requires|unknown|not found|cannot/i.test(x)).pop() || L.pop() || '').slice(0, 240); };
function stop() { if (proc) { try { proc.kill(); } catch (e) {} } proc = null; info = null; }

const PROBE = ['/', '/health', '/healthz', '/status', '/info', '/v1/models', '/voices', '/v1/voices', '/api', '/docs', '/openapi.json'];
async function probe(secrets) {
  if (!info?.port) throw new Error('vs-engine: not running');
  const tk = token(secrets), base = `http://127.0.0.1:${info.port}`, out = [];
  const anon = await req(base + '/', { timeout: 4000 });
  out.push({ path: '/ (no token)', status: anon.status, ctype: anon.ctype || '', body: snippet(anon) });
  let routes = [];
  for (const p of PROBE) {
    const r = await req(base + p, { headers: authHeaders(tk), timeout: 5000 });
    out.push({ path: p, status: r.status, ctype: r.ctype || '', body: snippet(r) });
    if (p === '/openapi.json' && r.status === 200) { try { const j = JSON.parse(r.buf.toString()); routes = Object.entries(j.paths || {}).flatMap(([k, v]) => Object.keys(v).map(m => m.toUpperCase() + ' ' + k)); } catch (e) {} }
  }
  // any JSON that lists routes/endpoints
  for (const o of out) if (!routes.length && /^\s*[{[]/.test(o.body)) { const m = o.body.match(/"(\/[\w\/\-{}.]+)"/g); if (m) routes = [...new Set(m.map(x => x.slice(1, -1)))].slice(0, 30); }
  return { base, port: info.port, auth: anon.status === 401 || anon.status === 403 ? 'token' : anon.status ? 'open' : '?', routes, results: out };
}

// candidate synth requests, most likely first (user-defined endpoint always first)
function candidates(cfg, text, routes) {
  const ref = cfg.refAudio && fs.existsSync(cfg.refAudio) ? cfg.refAudio : '';
  const lang = cfg.lang || 'el';
  const c = [];
  if (cfg.endpoint) { const [m, p] = /^(GET|POST)\s+/i.test(cfg.endpoint) ? cfg.endpoint.split(/\s+/, 2) : ['POST', cfg.endpoint]; c.push({ method: m.toUpperCase(), path: p, body: { text, input: text, language: lang, lang, ref_audio: ref || undefined, reference_audio: ref || undefined, voice: ref || cfg.voiceName || undefined, response_format: 'wav', format: 'wav' } }); }
  for (const r of routes || []) { const m = /^POST\s+(\S*(?:tts|speech|synth|generat|speak)\S*)/i.exec(r); if (m) c.push({ method: 'POST', path: m[1], body: { text, input: text, language: lang, ref_audio: ref || undefined, response_format: 'wav' } }); }
  c.push({ method: 'POST', path: '/v1/audio/speech', body: { model: 'omnivoice', input: text, voice: ref || cfg.voiceName || 'default', response_format: 'wav', language: lang, ref_audio: ref || undefined } });
  for (const p of ['/tts', '/api/tts', '/synthesize', '/v1/tts', '/generate', '/speak']) c.push({ method: 'POST', path: p, body: { text, language: lang, ref_audio: ref || undefined, format: 'wav' } });
  const seen = new Set(); return c.filter(x => { const k = x.method + x.path; if (seen.has(k)) return false; seen.add(k); return true; });
}
async function speak(cfg, secrets, text, outFile, { report = false } = {}) {
  if (!proc || proc.exitCode != null || !info?.port) await start(cfg, secrets);
  const tk = token(secrets), base = `http://127.0.0.1:${info.port}`; const tries = [];
  let routes = []; if (!learned) { try { routes = (await probe(secrets)).routes; } catch (e) {} }
  const list = learned ? [learned].concat(candidates(cfg, text, routes).filter(c => c.path !== learned.path)) : candidates(cfg, text, routes);
  for (const c of list) {
    const body = { ...c.body }; for (const k of ['text', 'input']) if (k in body) body[k] = text;
    const r = await req(base + c.path, { method: c.method, headers: { ...authHeaders(tk), 'Content-Type': 'application/json', Accept: 'audio/wav, audio/*, application/json' }, body: JSON.stringify(body), timeout: 180000 });
    let buf = isAudio(r) ? r.buf : null;
    // some servers answer JSON with base64 audio or a file path
    if (!buf && r.status >= 200 && r.status < 300 && /json/i.test(r.ctype)) { try { const j = JSON.parse(r.buf.toString()); const b64 = j.audio || j.audio_base64 || j.data?.audio || j.wav; const fp = j.file || j.path || j.output; if (typeof b64 === 'string' && b64.length > 100) buf = Buffer.from(b64.replace(/^data:[^,]+,/, ''), 'base64'); else if (typeof fp === 'string' && fs.existsSync(fp)) buf = await fsp.readFile(fp); } catch (e) {} }
    tries.push({ endpoint: c.method + ' ' + c.path, status: r.status, ctype: r.ctype || '', body: buf ? `[audio · ${buf.length} bytes]` : snippet(r) });
    if (buf) { await fsp.writeFile(outFile, buf); learned = { method: c.method, path: c.path, body: c.body }; return { ok: true, endpoint: c.method + ' ' + c.path, tries, port: info.port }; }
    if (r.status === 401 || r.status === 403) break; // token not accepted with any of our headers → no point trying more routes
  }
  const e = new Error('vs-engine: ' + (tries.some(x => x.status === 401 || x.status === 403) ? 'token rejected (401/403)' : 'no endpoint returned audio')); e.tries = tries; e.log = logBuf.slice(-3000);
  if (report) return { ok: false, error: e.message, tries, port: info?.port, log: e.log }; throw e;
}
module.exports = { start, stop, probe, speak, status, parsePort, token, args, candidates, _authHeaders: authHeaders };
