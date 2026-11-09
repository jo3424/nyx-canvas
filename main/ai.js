'use strict';
const { t, tr } = require('./i18n');
// OpenAI-compatible client (LM Studio, llama-server, Ollama, OpenRouter, Venice, xAI, OpenAI, custom) + whisper STT + TTS.
const fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os');
const { spawn } = require('child_process');
const secrets = require('./secrets');
const nyxPath = require('./paths');
const limits = require('./limits');

function headers(p) {
  const h = { 'Content-Type': 'application/json' };
  const key = p.keyRef ? secrets.get(p.keyRef) : '';
  if (key) h.Authorization = 'Bearer ' + key;
  if (/openrouter\.ai/.test(p.base || '')) { h['HTTP-Referer'] = 'https://nyx.local'; h['X-Title'] = 'Nyx Canvas'; }
  return h;
}
const trimBase = (b) => String(b || '').trim().replace(/\/+$/, '');
// v2.2: classify network failures precisely (refused / timeout / DNS / reset / TLS / HTTP) → clear, actionable Greek.
function netCode(e) {
  const c = String(e?.cause?.code || e?.code || ''); const m = String(e?.message || '') + ' ' + String(e?.cause?.message || '');
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError' || /UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/.test(c)) return 'timeout';
  if (/ECONNREFUSED/.test(c + m)) return 'refused';
  if (/ENOTFOUND|EAI_AGAIN/.test(c + m)) return 'dns';
  if (/ECONNRESET|UND_ERR_SOCKET|EPIPE|other side closed/.test(c + m)) return 'reset';
  if (/CERT|SSL|TLS|self.signed/i.test(c + m)) return 'tls';
  if (/EADDRNOTAVAIL|ENETUNREACH|EHOSTUNREACH/.test(c + m)) return 'unreach';
  if (/fetch failed/.test(m)) return 'network';
  return '';
}
class NetError extends Error { constructor(code, msg, extra = {}) { super(msg); this.code = code; Object.assign(this, extra); } }
function netMessage(code, url, status, detail) {
  const hp = (() => { try { const u = new URL(url); return u.host; } catch (e) { return url; } })();
  switch (code) {
    case 'refused': return t('ai.010', { v0: hp });
    case 'timeout': return t('ai.011', { v0: hp });
    case 'dns': return t('ai.012', { v0: hp });
    case 'reset': return t('ai.013', { v0: hp });
    case 'tls': return t('ai.014', { v0: hp });
    case 'unreach': return t('ai.015', { v0: hp });
    case 'http': return status === 401 || status === 403 ? t('ai.016', { v0: status }) : status === 404 ? t('ai.017', { v0: url }) : t('ai.018', { v0: status, v1: String(detail || '').slice(0, 200) });
    default: return t('ai.019', { v0: hp, v1: String(detail || '').slice(0, 160) });
  }
}
// v2.4: rate limits (Groq free plan, OpenRouter free models …): 429 → wait for retry-after when short, else a clear message.
// "retry-after: 7" · "x-ratelimit-reset-requests: 2m59.56s" · "x-ratelimit-reset-tokens: 7.66s" · "1h2m3s" · "250ms"
function parseWait(v) {
  if (v == null || v === '') return 0; const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return +s;
  let tot = 0, ok = false; for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) { ok = true; tot += +n * ({ ms: 0.001, s: 1, m: 60, h: 3600 })[u]; }
  if (ok) return tot; const d = Date.parse(s); return isNaN(d) ? 0 : Math.max(0, (d - Date.now()) / 1000);
}
function waitOf(hd) { const g = (k) => hd?.get ? hd.get(k) : hd?.[k]; return parseWait(g('retry-after')) || Math.max(parseWait(g('x-ratelimit-reset-requests')), parseWait(g('x-ratelimit-reset-tokens'))) || 0; }
const RATE_AUTO_WAIT = 20; // seconds we silently wait (max 2 times) before giving up
async function jfetch(url, opts = {}, timeout = 180000, _try = 0) {
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try { r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (r.status === 429) {
      const w = waitOf(r.headers); const txt = await r.text().catch(() => ''); clearTimeout(tm);
      if (_try < 2 && w > 0 && w <= RATE_AUTO_WAIT) { await new Promise(res => setTimeout(res, Math.ceil(w * 1000) + 250)); return jfetch(url, opts, timeout, _try + 1); }
      let det = ''; try { const j = JSON.parse(txt); det = j.error?.message || j.message || ''; } catch (e) {}
      const host = (() => { try { return new URL(url).host; } catch (e) { return url; } })();
      throw new NetError('rate', t('ai.rate', { v0: host, v1: w ? Math.ceil(w) : '?' }) + (det ? ' — ' + String(det).slice(0, 160) : ''), { status: 429, url, retryAfter: w });
    }
  }
  catch (e) {
    if (e instanceof NetError) throw e;
    const code = netCode(e);
    if (code === 'timeout' && timeout >= 30000) throw new NetError('timeout', tr('ai.001'), { url });
    throw new NetError(code || 'network', netMessage(code, url, 0, e?.cause?.message || e?.message), { url });
  }
  try {
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (!r.ok) { const det = (j && (j.error?.message || j.error || j.message)) || txt.slice(0, 300); throw new NetError('http', netMessage('http', url, r.status, typeof det === 'string' ? det : JSON.stringify(det)), { status: r.status, url }); }
    return j ?? txt;
  } catch (e) { if (e instanceof NetError) throw e; if (e?.name === 'AbortError') throw new NetError('timeout', tr('ai.001'), { url }); throw e; }
  finally { clearTimeout(tm); }
}
// localhost may resolve to ::1 while LM Studio/llama-server listen on 127.0.0.1 only → try IPv4 / IPv6 explicitly,
// and a missing /v1 suffix (404) → try base + '/v1'. The working base is cached per configured base.
const baseCache = new Map();
function baseVariants(base) {
  const b = trimBase(base); const out = [b];
  try {
    const u = new URL(b);
    if (u.hostname === 'localhost') { for (const hn of ['127.0.0.1', '[::1]']) { const v = new URL(b); v.hostname = hn; out.push(trimBase(v.href)); } }
    else if (u.hostname === '0.0.0.0') { const v = new URL(b); v.hostname = '127.0.0.1'; out.push(trimBase(v.href)); }
  } catch (e) {}
  return [...new Set(out)];
}
const isLocal = (b) => { try { return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/.test(new URL(b).hostname); } catch (e) { return false; } };
function baseOf(p) { const b = trimBase(p.base); return baseCache.get(b) || b; }
async function models(p) {
  const orig = trimBase(p.base);
  if (!/^https?:\/\//i.test(orig)) throw new NetError('config', t('ai.020'));
  const cands = [baseCache.get(orig), ...baseVariants(orig)].filter(Boolean);
  let first = null;
  for (const b of [...new Set(cands)]) {
    const tries = [b]; if (!/\/v\d+$/.test(b)) tries.push(b + '/v1');
    for (const base of tries) {
      try {
        const j = await jfetch(base + '/models', { headers: headers(p) }, isLocal(base) ? 4000 : 10000);
        const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
        if (!Array.isArray(j?.data) && !Array.isArray(j?.models)) throw new NetError('http', t('ai.021', { v0: base }), { status: 200 });
        baseCache.set(orig, base);
        const out = arr.map(m => ({ id: m.id || m.name || m.model, owned: m.owned_by || '', type: m.type || '' })).filter(m => m.id);
        out.base = base; return out;
      } catch (e) {
        if (!first || (first.code !== 'http' && e.code === 'http' && e.status !== 404)) first = e;
        if (e.code === 'http' && e.status !== 404) throw e; // auth or server error: the address is right, stop here
        if (e.code !== 'http') break; // host unreachable → '/v1' on the same host won't help
      }
    }
  }
  throw first || new NetError('network', netMessage('', orig));
}
// per-provider "how to fix" hints (Greek/English via locale)
function hintFor(p, code) {
  if (code === 'http' || code === 'config') return '';
  const id = p.id || ''; const port = (() => { try { return new URL(p.base).port; } catch (e) { return ''; } })();
  if (code === 'refused' || code === 'network' || code === 'timeout' || code === 'unreach') {
    if (id === 'lmstudio' || port === '1234') return t('ai.030');
    if (id === 'ollama' || port === '11434') return t('ai.031');
    if (id === 'llama' || port === '8080') return t('ai.032');
    if (isLocal(p.base)) return t('ai.033');
  }
  if (code === 'dns') return t('ai.034');
  if (code === 'tls') return t('ai.035');
  return '';
}
async function ping(p) {
  const t0 = Date.now();
  try { const m = await models(p); const fixed = m.base && m.base !== trimBase(p.base) ? m.base : null; return { ok: true, ms: Date.now() - t0, count: m.length, models: m, base: m.base, fixed }; }
  catch (e) { const code = e.code || 'other'; return { ok: false, code, status: e.status || 0, error: String(e.message || e), hint: hintFor(p, code), ms: Date.now() - t0 }; }
}
// LM Studio CLI: `lms server start` (lms.exe ships in ~/.lmstudio/bin on Windows)
function findLms() {
  const home = os.homedir(); const exe = process.platform === 'win32' ? 'lms.exe' : 'lms';
  const cands = [path.join(home, '.lmstudio', 'bin', exe), path.join(home, '.cache', 'lm-studio', 'bin', exe)];
  for (const d of String(process.env.PATH || '').split(path.delimiter)) if (d) cands.push(path.join(d, exe));
  return cands.find(f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } }) || null;
}
function lmsServerStart() {
  const exe = findLms(); if (!exe) return Promise.resolve({ ok: false, error: t('ai.036') });
  return new Promise((res) => {
    let out = ''; const ch = spawn(exe, ['server', 'start'], { windowsHide: true });
    const tm = setTimeout(() => { try { ch.kill(); } catch (e) {} res({ ok: false, exe, error: 'Timeout', out }); }, 30000);
    ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { out += d; });
    ch.on('error', e => { clearTimeout(tm); res({ ok: false, exe, error: e.message, out }); });
    ch.on('close', code => { clearTimeout(tm); res({ ok: code === 0, exe, code, out: out.slice(-1500), error: code === 0 ? '' : out.slice(-300) || ('exit ' + code) }); });
  });
}
const THINK_KEYS = ['chat_template_kwargs', 'reasoning_format', 'reasoning_effort', 'reasoning_budget'];
const thinkCache = new Map(); // base → list of keys this server rejected
function applyThink(req, body) {
  const skip = new Set(thinkCache.get(trimBase(body._base || '')) || []);
  for (const k of THINK_KEYS) if (body[k] != null && !skip.has(k)) req[k] = body[k];
}
async function chat(p, body) {
  const req = { model: body.model, messages: body.messages, temperature: body.temperature ?? 0.4, stream: false };
  if (body.max_tokens) req.max_tokens = body.max_tokens;
  if (body.tools?.length) { req.tools = body.tools; req.tool_choice = body.tool_choice || 'auto'; }
  if (body.response_format) req.response_format = body.response_format;
  applyThink(req, body);
  const url = baseOf(p) + '/chat/completions';
  let j;
  try {
    j = await jfetch(url, { method: 'POST', headers: headers(p), body: JSON.stringify(req) }, body.timeout || 240000);
  } catch (e) {
    const usedThink = THINK_KEYS.some(k => k in req);
    if (usedThink && limits.isUnknownParamError(e)) {
      const key = trimBase(p.base);
      thinkCache.set(key, THINK_KEYS);
      const req2 = { ...req }; for (const k of THINK_KEYS) delete req2[k];
      j = await jfetch(url, { method: 'POST', headers: headers(p), body: JSON.stringify(req2) }, body.timeout || 240000);
      const ch0 = j?.choices?.[0]; if (!ch0) throw new Error(t('ai.004'));
      const msg0 = ch0.message || { role: 'assistant', content: ch0.text || '' };
      return { message: msg0, finish: ch0.finish_reason, usage: j.usage || null, model: j.model || body.model, thinkingIgnored: true };
    }
    throw e;
  }
  const ch = j?.choices?.[0]; if (!ch) throw new Error(t('ai.004'));
  const msg = ch.message || { role: 'assistant', content: ch.text || '' };
  if (ch.reasoning_content && msg.reasoning_content == null) msg.reasoning_content = ch.reasoning_content;
  return { message: msg, finish: ch.finish_reason, usage: j.usage || null, model: j.model || body.model, reasoning: msg.reasoning_content || null };
}
function rootVariants(p) {
  const orig = trimBase(p.base);
  const bases = [baseCache.get(orig), ...baseVariants(orig)].filter(Boolean);
  const roots = [];
  for (const b of bases) {
    const r = limits.nativeBase(b);
    roots.push(r);
    if (!/\/v1$/i.test(b)) roots.push(b);
  }
  return [...new Set(roots)];
}
async function fetchNative(p, path, opts = {}, timeout = 4000) {
  let first = null;
  for (const root of rootVariants(p)) {
    try {
      const j = await jfetch(root + path, { headers: headers(p), ...opts }, timeout);
      return { ok: true, json: j, root };
    } catch (e) { if (!first) first = e; }
  }
  throw first || new Error(t('ai.019', { v0: trimBase(p.base), v1: path }));
}
async function props(p) {
  const r = await fetchNative(p, '/props', {}, 4000);
  const n_ctx = limits.parseNctx(r.json);
  return { ok: true, n_ctx, raw: r.json, root: r.root, source: 'props' };
}
async function slots(p) {
  const r = await fetchNative(p, '/slots', {}, 4000);
  const n_ctx = limits.parseNctx(r.json);
  return { ok: true, n_ctx, raw: r.json, root: r.root, source: 'slots' };
}
async function tokenize(p, content) {
  const body = JSON.stringify({ content: String(content || '') });
  let r, last;
  for (const path of ['/tokenize', '/v1/tokenize']) {
    try { r = await fetchNative(p, path, { method: 'POST', body }, 15000); break; } catch (e) { last = e; }
  }
  if (!r) throw last || new Error('tokenize');
  const j = r.json;
  const tokens = Array.isArray(j?.tokens) ? j.tokens : Array.isArray(j) ? j : (j?.ids || []);
  if (!Array.isArray(tokens)) throw new Error('tokenize: unexpected response');
  return { count: tokens.length, root: r.root };
}
async function contextInfo(p) {
  const warnings = [];
  let n_ctx = null, source = '', raw = null, root = '';
  try { const r = await props(p); n_ctx = r.n_ctx; source = 'props'; raw = r.raw; root = r.root; }
  catch (e) { warnings.push({ code: 'props_fail', message: String(e.message || e) }); }
  if (n_ctx == null) {
    try { const r = await slots(p); n_ctx = r.n_ctx; source = n_ctx ? 'slots' : source; raw = r.raw; root = r.root; }
    catch (e) { warnings.push({ code: 'slots_fail', message: String(e.message || e) }); }
  }
  if (n_ctx == null) {
    try {
      const ms = await models(p);
      n_ctx = limits.parseNctx({ data: ms }) || limits.parseNctx(ms);
      if (n_ctx) source = 'models';
    } catch (e) { warnings.push({ code: 'models_fail', message: String(e.message || e) }); }
  }
  return { n_ctx, source, root, warnings, raw };
}
async function prepare(p, opts = {}) {
  const messages = opts.messages || [];
  const warnings = [];
  let nCtx = null, ctxSrc = '', promptTokens = null, tokSrc = 'none';
  const local = limits.isLocalLlama(p) || p?.kind === 'local';
  if (local) {
    try {
      const c = await contextInfo(p);
      nCtx = c.n_ctx; ctxSrc = c.source; warnings.push(...(c.warnings || []));
    } catch (e) { warnings.push({ code: 'context_fail', message: String(e.message || e) }); }
    try {
      const tok = await tokenize(p, limits.messagesToText(messages));
      promptTokens = tok.count; tokSrc = 'tokenize';
    } catch (e) {
      promptTokens = limits.estimateTokens(messages); tokSrc = 'estimate';
      warnings.push({ code: 'tokenize_fail', message: String(e.message || e), estimated: promptTokens });
    }
  } else {
    promptTokens = limits.estimateTokens(messages); tokSrc = 'estimate';
  }
  const cloudMax = limits.cloudMaxOutput(p, opts.model);
  const limit = limits.computeMaxTokens({ nCtx, promptTokens, reserve: opts.reserve, override: opts.maxTokensOverride, cloudMax, kind: p?.kind });
  const think = limits.thinkingParams({ enabled: !!opts.thinking, budget: opts.thinkingBudget, effort: opts.thinkingEffort });
  const body = {};
  if (limit.max_tokens != null) body.max_tokens = limit.max_tokens;
  Object.assign(body, think);
  return { ...limit, n_ctx: nCtx, ctxSrc, promptTokens, tokSrc, warnings, cloudMax, body, thinking: !!opts.thinking };
}
async function embed(p, model, input) {
  const j = await jfetch(baseOf(p) + '/embeddings', { method: 'POST', headers: headers(p), body: JSON.stringify({ model, input }) }, 120000);
  return (j.data || []).map(d => d.embedding);
}

// ---- Speech-to-text: whisper.cpp server (/inference) or OpenAI-compatible (/audio/transcriptions)
async function transcribe(cfg, buf, filename, opts = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), filename || 'audio.wav');
  const lang = opts.language ?? cfg.language ?? 'el';
  let url;
  if (cfg.kind === 'groq') {
    // v2.4: Groq Whisper (whisper-large-v3-turbo / whisper-large-v3), key = the Groq provider key. Free plan: 25 MB per file.
    if (!secrets.get('key:groq')) throw new NetError('config', t('ai.groq_key'));
    if (buf.length > 25 * 1024 * 1024) throw new NetError('config', t('ai.groq_big', { v0: (buf.length / 1048576).toFixed(1) }));
    url = 'https://api.groq.com/openai/v1/audio/transcriptions';
    fd.append('model', /^whisper-large-v3(-turbo)?$/.test(cfg.groqModel || '') ? cfg.groqModel : 'whisper-large-v3-turbo'); fd.append('response_format', 'verbose_json'); fd.append('temperature', '0');
    if (lang && lang !== 'auto') fd.append('language', lang);
  } else if (cfg.kind === 'openai') {
    url = trimBase(cfg.base) + '/audio/transcriptions';
    fd.append('model', cfg.model || 'whisper-1'); fd.append('response_format', 'verbose_json'); if (lang && lang !== 'auto') fd.append('language', lang);
  } else {
    url = trimBase(cfg.base) + '/inference';
    fd.append('temperature', '0.0'); fd.append('response_format', 'verbose_json'); if (lang) fd.append('language', lang);
  }
  const kr = cfg.kind === 'groq' ? 'key:groq' : cfg.keyRef; const h = {}; if (kr && secrets.get(kr)) h.Authorization = 'Bearer ' + secrets.get(kr);
  const j = await jfetch(url, { method: 'POST', body: fd, headers: h }, opts.timeout || 600000);
  const text = (typeof j === 'string' ? j : j.text || '').trim();
  const segments = (j.segments || []).map(s => ({ start: s.start != null ? +s.start : (s.t0 != null ? s.t0 / 100 : 0), end: s.end != null ? +s.end : (s.t1 != null ? s.t1 / 100 : 0), text: String(s.text || '').trim() })).filter(s => s.text);
  return { text, segments, language: j.language || lang };
}

// ---- Text-to-speech via user command template (vs-engine / OmniVoice / piper …). Unverified CLI → user editable.
function fillTemplate(tpl, vars) { return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)); }
function runCmd(cmd, { timeout = 180000, cwd } = {}) {
  return new Promise((res, rej) => {
    const ch = spawn(cmd, { shell: true, cwd, windowsHide: true });
    let out = '', err = ''; const t = setTimeout(() => { try { ch.kill(); } catch (e) {} rej(new Error('Timeout')); }, timeout);
    ch.stdout.on('data', d => { out += d; if (out.length > 20000) out = out.slice(-20000); });
    ch.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    ch.on('error', e => { clearTimeout(t); rej(e); });
    ch.on('close', code => { clearTimeout(t); code === 0 ? res({ out, err }) : rej(Object.assign(new Error(`exit ${code}: ${(err || out).slice(-400)}`), { out, err, exitCode: code })); });
  });
}
// cmd.exe: % expands variables, " ends the quoted arg, ^ & | < > are safe inside quotes but we drop control chars.
const cmdQuote = (s) => '"' + String(s ?? '').replace(/["%\r\n\x00-\x1f]/g, ' ') + '"';
function buildTtsCmd(cfg, text, out, textFile) {
  return fillTemplate(cfg.template || '', { exe: cmdQuote(cfg.exe || ''), model: cmdQuote(cfg.model || ''), tokenizer: cmdQuote(cfg.tokenizer || ''), voice: cmdQuote(cfg.voice || ''), text: cmdQuote(String(text).replace(/\s+/g, ' ').slice(0, 1500)), text_file: cmdQuote(textFile), out: cmdQuote(out), lang: cmdQuote(cfg.lang || 'Greek') });
}
// most useful line of a failed CLI: the last one that mentions an error, else the last non-empty one
const lastLine = (s) => { const L = String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean); return (L.filter(x => /error|fail|invalid|unknown|not found|cannot|σφάλμα/i.test(x)).pop() || L.pop() || '').slice(0, 240); };
async function tts(cfg, text, outDir, opts = {}) {
  cfg = nyxPath.resolveCfgPaths(cfg || {}, ['exe', 'model', 'tokenizer', 'refAudio']);
  const fail = (msg) => { if (opts.report) return { ok: false, error: msg, ms: 0 }; throw new Error(msg); };
  if (!String(cfg.template || '').trim()) return fail(t('ai.005'));
  if (cfg.exe && !fs.existsSync(cfg.exe)) return fail(t('procs.001') + cfg.exe);
  const out = path.join(outDir, `tts-${Date.now().toString(36)}.wav`);
  const tf = path.join(os.tmpdir(), `nyx-tts-${Date.now()}.txt`); await fsp.writeFile(tf, text, 'utf8');
  const cmd = buildTtsCmd(cfg, text, out, tf);
  const cwd = cfg.exe ? path.dirname(cfg.exe) : undefined; const t0 = Date.now();
  let r = { out: '', err: '' };
  try { r = await runCmd(cmd, { cwd: cwd && fs.existsSync(cwd) ? cwd : undefined, timeout: opts.timeout || 180000 }); }
  catch (e) { fsp.unlink(tf).catch(() => {}); if (opts.report) return { ok: false, cmd, error: e.exitCode != null ? 'exit ' + e.exitCode + ': ' + lastLine(e.err || e.out) : String(e.message || e).split('\n')[0].slice(0, 200), stdout: String(e.out || '').slice(-1500), stderr: String(e.err || '').slice(-1500), ms: Date.now() - t0 }; throw e; }
  fsp.unlink(tf).catch(() => {});
  if (!fs.existsSync(out)) { const msg = t('ai.006') + out; if (opts.report) return { ok: false, cmd, error: msg, stdout: r.out.slice(-1500), stderr: r.err.slice(-1500), ms: Date.now() - t0 }; throw new Error(msg + (r.err ? '\n' + r.err.slice(-300) : '')); }
  if (opts.report) return { ok: true, cmd, file: out, stdout: r.out.slice(-1500), stderr: r.err.slice(-1500), ms: Date.now() - t0 };
  return out;
}
// "exe --help" → lets the user see the real CLI flags of an unknown engine (vs-engine)
function exeHelp(exe) {
  exe = nyxPath.resolveForUse(exe);
  if (!exe || !fs.existsSync(exe)) return Promise.resolve({ ok: false, error: t('procs.001') + (exe || '—') });
  return new Promise((res) => {
    let out = ''; const ch = spawn(exe, ['--help'], { cwd: path.dirname(exe), windowsHide: true });
    const tm = setTimeout(() => { try { ch.kill(); } catch (e) {} res({ ok: true, out: out.slice(0, 6000) }); }, 8000);
    ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { out += d; });
    ch.on('error', e => { clearTimeout(tm); res({ ok: false, error: e.message }); });
    ch.on('close', () => { clearTimeout(tm); res({ ok: true, out: out.slice(0, 6000) }); });
  });
}
module.exports = { parseWait, waitOf, jfetch, models, ping, chat, prepare, props, slots, tokenize, contextInfo, embed, transcribe, tts, runCmd, fillTemplate, buildTtsCmd, cmdQuote, exeHelp, netCode, netMessage, baseVariants, hintFor, findLms, lmsServerStart, _baseCache: baseCache, _thinkCache: thinkCache };
