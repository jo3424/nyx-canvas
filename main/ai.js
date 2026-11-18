'use strict';
const { t, tr } = require('./i18n');
// OpenAI-compatible client (LM Studio, llama-server, Ollama, OpenRouter, Venice, xAI, OpenAI, custom) + whisper STT + TTS.
const fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os');
const { spawn } = require('child_process');
const secrets = require('./secrets');
const nyxPath = require('./paths');
const limits = require('./limits');
const routerkey = require('./routerkey');
const novoice = require('./novoice'); // v2.6.13.1: never start vs-engine / omnivoice-tts

function headers(p) {
  const h = { 'Content-Type': 'application/json' };
  let key = p.keyRef ? secrets.get(p.keyRef) : '';
  // v2.6.10.1: the local router (provider «llama» / the router port) gets Nyx's router key unless the provider has its own
  if (!key && routerkey.isRouterProvider(p)) key = routerkey.key();
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
function abortedErr(url) { const e = new NetError('aborted', t('v268.cancelled'), { url }); e.code = 'ABORTED'; return e; }
async function jfetch(url, opts = {}, timeout = 180000, _try = 0) {
  opts = routerkey.withAuth(url, opts); // v2.6.10.1: every router call carries the key (also retries / probes)
  const ext = opts.signal;
  const ctrl = new AbortController();
  const tm = timeout > 0 ? setTimeout(() => ctrl.abort(), timeout) : null;
  const onAb = () => ctrl.abort();
  if (ext) { if (ext.aborted) ctrl.abort(); else ext.addEventListener('abort', onAb, { once: true }); }
  let r;
  try { r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (r.status === 429) {
      const w = waitOf(r.headers); const txt = await r.text().catch(() => ''); if (tm) clearTimeout(tm);
      if (_try < 2 && w > 0 && w <= RATE_AUTO_WAIT) { await new Promise(res => setTimeout(res, Math.ceil(w * 1000) + 250)); return jfetch(url, opts, timeout, _try + 1); }
      let det = ''; try { const j = JSON.parse(txt); det = j.error?.message || j.message || ''; } catch (e) {}
      const host = (() => { try { return new URL(url).host; } catch (e) { return url; } })();
      throw new NetError('rate', t('ai.rate', { v0: host, v1: w ? Math.ceil(w) : '?' }) + (det ? ' — ' + String(det).slice(0, 160) : ''), { status: 429, url, retryAfter: w });
    }
  }
  catch (e) {
    if (e instanceof NetError) throw e;
    if (e?.name === 'AbortError' && ext && ext.aborted) throw abortedErr(url);
    const code = netCode(e);
    if (code === 'timeout' && timeout >= 30000) throw new NetError('timeout', tr('ai.001'), { url });
    throw new NetError(code || 'network', netMessage(code, url, 0, e?.cause?.message || e?.message), { url });
  }
  try {
    if (opts._raw) return r;
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (!r.ok) { const det = (j && (j.error?.message || j.error || j.message)) || txt.slice(0, 300); const err = new NetError('http', netMessage('http', url, r.status, typeof det === 'string' ? det : JSON.stringify(det)), { status: r.status, url, detail: typeof det === 'string' ? det : '' }); throw withImageHint(err); }
    return j ?? txt;
  } catch (e) { if (e instanceof NetError) throw e; if (e?.name === 'AbortError') throw (ext && ext.aborted ? abortedErr(url) : new NetError('timeout', tr('ai.001'), { url })); throw e; }
  finally { if (tm) clearTimeout(tm); if (ext) ext.removeEventListener('abort', onAb); }
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
// v2.6.9.1: keep the router's per-model status (b12230 /v1/models: status { value: loaded|loading|unloaded|sleeping|…, args })
// — it was dropped here, so «loaded» was never known: the Hub showed «3 / 2 διαθέσιμα» and the load-wait could not tell
// «loading» from «not loading» (endless resend). state = status.value; ctxArg = -c / --ctx-size from the launch args.
function argCtx(args) {
  const a = Array.isArray(args) ? args.map(String) : [];
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^(?:-c|--ctx-size)(?:=(\d+))?$/);
    if (m) { const v = m[1] != null ? +m[1] : +a[i + 1]; if (Number.isFinite(v) && v > 0) return Math.floor(v); }
  }
  return null;
}
function routerEntry(m) {
  const o = { id: m.id || m.name || m.model, owned: m.owned_by || '', type: m.type || '' };
  const st = m.status;
  const val = (st && typeof st === 'object') ? (st.value || st.status || '') : (typeof st === 'string' ? st : (m.state || ''));
  if (val) o.state = String(val);
  if (typeof m.loaded === 'boolean') o.loaded = m.loaded;
  else if (o.state) o.loaded = /^(loaded|ready|ok)$/i.test(o.state);
  if (st && typeof st === 'object') { const c = argCtx(st.args); if (c) o.ctxArg = c; if (st.failed) o.failed = true; }
  if (m.context_length) o.ctxTrain = +m.context_length;
  if (m.meta && +m.meta.n_ctx > 0) o.nCtx = +m.meta.n_ctx; // single llama-server: runtime n_ctx (router entries carry only the train length)
  if (m.size || m.bytes) o.size = m.size || m.bytes;
  return o;
}
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
        const out = arr.map(m => routerEntry(m)).filter(m => m.id);
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
function isForbidden(e) { return !!(e && (e.status === 403 || e.code === 'forbidden' || /\b403\b/.test(String(e.message || e)))); }

async function chat(p, body) {
  const local = limits.isLocalLlama(p) || p?.kind === 'local';
  const timeout = body.timeout != null ? body.timeout : (local ? 0 : 240000);
  const run = async (reqBody) => {
    const req = { model: reqBody.model, messages: limits.oneSystem(reqBody.messages), temperature: reqBody.temperature ?? 0.4, stream: false };
    if (reqBody.max_tokens) req.max_tokens = reqBody.max_tokens;
    if (reqBody.tools?.length) { req.tools = reqBody.tools; req.tool_choice = reqBody.tool_choice || 'auto'; }
    if (reqBody.response_format) req.response_format = reqBody.response_format;
    if (reqBody.cache_prompt != null ? reqBody.cache_prompt : local) req.cache_prompt = true;
    applyThink(req, reqBody);
    const url = baseOf(p) + '/chat/completions';
    let j;
    try {
      j = await jfetch(url, { method: 'POST', headers: headers(p), body: JSON.stringify(req), signal: reqBody.signal }, timeout);
    } catch (e) {
      const usedThink = THINK_KEYS.some(k => k in req);
      if (usedThink && limits.isUnknownParamError(e)) {
        const key = trimBase(p.base);
        thinkCache.set(key, THINK_KEYS);
        const req2 = { ...req }; for (const k of THINK_KEYS) delete req2[k];
        j = await jfetch(url, { method: 'POST', headers: headers(p), body: JSON.stringify(req2), signal: reqBody.signal }, timeout);
        const ch0 = j?.choices?.[0]; if (!ch0) throw new Error(t('ai.004'));
        const msg0 = ch0.message || { role: 'assistant', content: ch0.text || '' };
        return { message: msg0, finish: ch0.finish_reason, usage: j.usage || null, model: j.model || reqBody.model, thinkingIgnored: true, timings: j.timings || null };
      }
      throw withImageHint(e);
    }
    const ch = j?.choices?.[0]; if (!ch) throw new Error(t('ai.004'));
    const msg = ch.message || { role: 'assistant', content: ch.text || '' };
    if (ch.reasoning_content && msg.reasoning_content == null) msg.reasoning_content = ch.reasoning_content;
    return { message: msg, finish: ch.finish_reason, usage: j.usage || null, model: j.model || reqBody.model, reasoning: msg.reasoning_content || null, timings: j.timings || null };
  };
  return withLoadRetry(p, body, () => withGate(p, () => run(body)), { signal: body.signal, onStatus: body.onStatus });
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
const PROPS_MODEL_MS = 120000;
function modelQuery(model) { return model ? ('?model=' + encodeURIComponent(String(model))) : ''; }
function isNeedModel(e) { return !!(e && (e.status === 400 || /\b400\b/.test(String(e.message || e)))); }

async function props(p, opts = {}) {
  const q = modelQuery(opts.model) + (opts.model && opts.autoload === false ? '&autoload=false' : '');
  // /props?model= waits for a load on llama-server b12230. A short abort (default 4s)
  // is what the server logs as 500 "request cancelled while waiting for model".
  // Only use a short timeout when the caller is a probe (no ?model=). With ?model=,
  // wait until the model is ready unless the user cancels (timeout 0 = no timer).
  // v2.6.8.2: the wait for a load has a ceiling (PROPS_MODEL_MS, 120 s) instead of no timer at all.
  const timeout = ('timeout' in opts) ? (opts.timeout === 0 && opts.model ? PROPS_MODEL_MS : opts.timeout) : (opts.model ? PROPS_MODEL_MS : 4000);
  const run = () => fetchNative(p, '/props' + q, { signal: opts.signal }, timeout);
  const r = (opts.model && opts.gate !== false) ? await withGate(p, run) : await run();
  const n_ctx = limits.parseNctx(r.json);
  return { ok: true, n_ctx, raw: r.json, root: r.root, source: 'props', model: opts.model || null };
}
function parseRouterMax(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw.max_instances ?? raw.models_max ?? raw.modelsMax ?? (raw.router && (raw.router.max_instances ?? raw.router.models_max));
  if (n == null || !Number.isFinite(+n)) return null;
  return Math.floor(+n);
}
async function routerInfo(p, opts = {}) {
  const timeout = opts.timeout || 800;
  try {
    const r = await props(p, { timeout });
    const max = parseRouterMax(r.raw);
    const role = r.raw && r.raw.role;
    return { ok: true, role: role || (max != null ? 'router' : null), max_instances: max, n_ctx: r.n_ctx, raw: r.raw, root: r.root };
  } catch (e) {
    return { ok: false, status: e.status, error: String(e.message || e), max_instances: null };
  }
}
async function slots(p, opts = {}) {
  const q = modelQuery(opts.model);
  const r = await fetchNative(p, '/slots' + q, {}, 4000);
  const n_ctx = limits.parseNctx(r.json);
  return { ok: true, n_ctx, raw: r.json, root: r.root, source: 'slots', model: opts.model || null };
}
// v2.6.9.1: a short, human-readable record of each router call (what Nyx asked, what came back) — shown in the Hub.
function traceAnswer(j) {
  if (j == null) return '';
  if (Array.isArray(j?.tokens)) return 'tokens: ' + j.tokens.length;
  if (j && j.role === 'router') return 'role=router, n_ctx=' + (j.default_generation_settings ? j.default_generation_settings.n_ctx : '—') + ' (' + t('v2691.router_dummy') + ')';
  const n = limits.parseNctx(j); if (n) return 'n_ctx=' + n;
  if (Array.isArray(j) && j.length && j[0] && j[0].id) return j.map((m) => m.id + (m.state ? ' [' + m.state + ']' : '')).join(', ').slice(0, 300);
  if (Array.isArray(j?.data)) return j.data.map((m) => routerEntry(m)).map((m) => m.id + (m.state ? ' [' + m.state + ']' : '')).join(', ').slice(0, 300);
  return JSON.stringify(j).slice(0, 200);
}
async function traced(trace, label, fn) {
  const t0 = Date.now();
  try { const r = await fn(); if (trace) trace.push({ req: label, status: 200, ans: traceAnswer(r && r.json !== undefined ? r.json : r), ms: Date.now() - t0 }); return r; }
  catch (e) { if (trace) trace.push({ req: label, status: e.status || 0, ans: errText(e).slice(0, 240), ms: Date.now() - t0, error: true }); throw e; }
}
// state of one model: router /v1/models status.value (b12230), else /slots for a single-model server.
async function modelState(p, model, trace) {
  let state = null;
  try {
    const r = await traced(trace, 'GET /v1/models', () => fetchNative(p, '/v1/models', {}, 2000));
    const j = r.json || {};
    const arr = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
    const e = modelEntry(p, model, arr.map((m) => routerEntry(m)));
    if (e && e.state) { state = e.state; return { loaded: /^(loaded|ready|ok)$/i.test(state), state, router: true }; }
    if (e && e.loaded === true) return { loaded: true, state: 'loaded' };
    if (!e && arr.length) return { loaded: false, state: 'not_listed' };
  } catch (e) {}
  return { loaded: await slotsLoaded(p, model), state };
}
async function tokenize(p, content, opts = {}) {
  // v2.6.8.2: router mode needs the model id. v2.6.9.1 (b12230 source, server-models.cpp proxy_post): the router reads the
  // model ONLY from the JSON body («model name is missing from the request» otherwise) and loads it unless ?autoload=false.
  // Callers outside a chat pass onlyIfLoaded → ?autoload=false, so a count never starts a load.
  const model = opts.model || '';
  const trace = opts.trace || [];
  let state = null;
  if (opts.onlyIfLoaded && model) {
    const st = await modelState(p, model, trace); state = st.state;
    if (!st.loaded) return { count: null, skipped: 'not_loaded', state, model, trace };
  }
  const body = JSON.stringify(model ? { content: String(content || ''), model } : { content: String(content || '') });
  const q = opts.onlyIfLoaded && model ? '?autoload=false' : '';
  let r, last;
  for (const path of ['/tokenize', '/v1/tokenize']) {
    try { r = await traced(trace, 'POST ' + path + q + ' {model: ' + (model || '—') + ', content: ' + String(content || '').length + ' chars}', () => fetchNative(p, path + q, { method: 'POST', body }, opts.timeout || 15000)); break; } catch (e) { last = e; if (e && e.status && e.status !== 404) break; }
  }
  if (!r) { if (opts.trace || opts.withTrace) { const e = last || new Error('tokenize'); e.trace = trace; throw e; } throw last || new Error('tokenize'); }
  const j = r.json;
  const tokens = Array.isArray(j?.tokens) ? j.tokens : Array.isArray(j) ? j : (j?.ids || []);
  if (!Array.isArray(tokens)) throw new Error('tokenize: unexpected response');
  return { count: tokens.length, root: r.root, model, state, trace };
}
// Loaded = /v1/models says loaded, or /slots shows the model. Unknown counts as not loaded.
async function modelLoaded(p, model) {
  return (await modelState(p, model)).loaded;
}
async function contextInfo(p, opts = {}) {
  const warnings = [];
  let n_ctx = null, source = '', raw = null, root = '', router = false, model = opts.model || null;
  let modelList = opts.models || null;
  // Short Hub probes must not call /props?model= or /slots?model=: a 4s abort can cancel a model that is still loading
  // (llama-server then answers 500 «request cancelled while waiting for model»).
  const trace = [];
  if (opts.probe) {
    // v2.6.9.1 (b12230 source, server-models.cpp get_router_props): GET /props WITHOUT ?model= on a router answers 200 with
    // role=router and a dummy n_ctx 0 — that is why «Ανανέωση ctx» said «δεν διαβάστηκε ακόμα (—)». The real n_ctx comes from
    // /props?model=<a LOADED model>&autoload=false (never starts a load). Every call is recorded in `trace` for the Hub.
    let configured = null;
    try {
      if (!modelList) modelList = (await traced(trace, 'GET /v1/models', () => models(p)));
      const hit = modelList.find((m) => m.nCtx);
      if (hit) { n_ctx = hit.nCtx; source = 'models'; model = hit.id; }
    } catch (e) { warnings.push({ code: 'models_fail', message: String(e.message || e) }); }
    if (n_ctx == null) {
      try {
        const r = await traced(trace, 'GET /props', () => props(p, { timeout: opts.timeout || 800 }).then((x) => ({ ...x, json: x.raw })));
        raw = r.raw; root = r.root;
        if (r.raw && r.raw.role === 'router') router = true;
        else if (r.n_ctx) { n_ctx = r.n_ctx; source = 'props'; }
      } catch (e) {
        if (isNeedModel(e)) router = true;
        warnings.push({ code: router ? 'props_need_model' : 'props_fail', message: String(e.message || e), status: e.status });
      }
    }
    if (n_ctx == null && router) {
      const list = modelList || [];
      const loaded = list.filter((m) => /^(loaded|ready|ok)$/i.test(m.state || ''));
      const want = opts.model ? modelEntry(p, opts.model, loaded) : null;
      const pick = want || loaded[0] || null;
      const ent = (opts.model && modelEntry(p, opts.model, list)) || list[0] || null;
      if (ent && ent.ctxArg) configured = ent.ctxArg;
      if (pick) {
        try {
          const r = await traced(trace, 'GET /props?model=' + pick.id + '&autoload=false', () => props(p, { model: pick.id, autoload: false, gate: false, timeout: Math.max(2000, +opts.timeout || 0) }).then((x) => ({ ...x, json: x.raw })));
          if (r.n_ctx) { n_ctx = r.n_ctx; source = 'props_model'; model = pick.id; raw = r.raw; root = r.root; }
        } catch (e) { warnings.push({ code: 'props_model_fail', message: String(e.message || e), status: e.status }); }
      } else if (list.some((m) => m.state)) {
        warnings.push({ code: 'router_none_loaded', message: t('v2691.none_loaded') });
      } else {
        // no status in /v1/models (not the b12230 router format): do not claim «none loaded», say it is unknown
        warnings.push({ code: 'router_state_unknown', message: t('v2691.state_unknown') });
      }
    }
    return { n_ctx, source, root, warnings, raw, router, model, models: modelList || undefined, probe: true, trace, configured };
  }
  const tryProps = async (m, autoload) => {
    const r = await props(p, { model: m, autoload, timeout: ('timeout' in opts) ? opts.timeout : (m ? PROPS_MODEL_MS : 4000), signal: opts.signal });
    n_ctx = r.n_ctx; source = m ? 'props_model' : 'props'; raw = r.raw; root = r.root; model = m || model;
  };
  const trySlots = async (m) => {
    const r = await slots(p, { model: m });
    if (r.n_ctx) { n_ctx = r.n_ctx; source = m ? 'slots_model' : 'slots'; raw = r.raw; root = r.root; model = m || model; }
  };
  // 1) /props with ?model= when we know the id (router mode of llama-server b12230 returns HTTP 400 without it).
  if (model) {
    try { await tryProps(model); }
    catch (e) { warnings.push({ code: 'props_model_fail', message: String(e.message || e) }); }
    if (n_ctx == null) {
      try { await trySlots(model); }
      catch (e) { warnings.push({ code: 'slots_model_fail', message: String(e.message || e) }); }
    }
  }
  // 2) /props without a model (single-model llama-server).
  if (n_ctx == null) {
    try { await tryProps(undefined); if (raw && raw.role === 'router') { router = true; n_ctx = null; } }
    catch (e) {
      if (isNeedModel(e)) router = true;
      warnings.push({ code: router ? 'props_need_model' : 'props_fail', message: String(e.message || e), status: e.status });
    }
  }
  if (n_ctx == null && !router) {
    try { await trySlots(undefined); }
    catch (e) {
      if (isNeedModel(e)) router = true;
      warnings.push({ code: 'slots_fail', message: String(e.message || e), status: e.status });
    }
  }
  // 3) list /v1/models; if /props without model was 400, retry with an id.
  if (n_ctx == null || router) {
    try {
      if (!modelList) modelList = await models(p);
      if (!n_ctx) {
        n_ctx = limits.parseNctx({ data: modelList }) || limits.parseNctx(modelList);
        if (n_ctx) source = 'models';
      }
    } catch (e) { warnings.push({ code: 'models_fail', message: String(e.message || e) }); }
  }
  if (n_ctx == null && modelList && modelList.length) {
    router = router || modelList.length > 1;
    // v2.6.9.1: without a known model, only a LOADED one is asked (a random first id would start a load on the router)
    const loadedOne = modelList.find((m) => /^(loaded|ready|ok)$/i.test(m.state || ''));
    const known = modelList.some((m) => m.state);
    const id = model || (loadedOne ? loadedOne.id : (known ? null : modelList[0].id));
    if (id) try { await tryProps(id, model ? undefined : false); }
    catch (e) { warnings.push({ code: 'props_model_fail', message: String(e.message || e) }); }
    if (n_ctx == null && id) {
      try { await trySlots(id); }
      catch (e) { warnings.push({ code: 'slots_model_fail', message: String(e.message || e) }); }
    }
  }
  if (!router && modelList && modelList.length > 1 && warnings.some(w => w.code === 'props_need_model')) router = true;
  return { n_ctx, source, root, warnings, raw, router, model, models: modelList || undefined };
}
async function prepare(p, opts = {}) {
  const messages = opts.messages || [];
  const warnings = [];
  let nCtx = null, ctxSrc = '', promptTokens = null, tokSrc = 'none';
  const local = limits.isLocalLlama(p) || p?.kind === 'local';
  if (local) {
    if (opts.model && opts.wait !== false) {
      try { await waitForModel(p, opts.model, { signal: opts.signal, onStatus: opts.onStatus }); }
      catch (e) { if (e && e.code === 'ABORTED') throw e; warnings.push({ code: 'wait_fail', message: String(e.message || e) }); }
    }
    try {
      const c = await contextInfo(p, { model: opts.model, signal: opts.signal, timeout: 0 });
      nCtx = c.n_ctx; ctxSrc = c.source; warnings.push(...(c.warnings || []));
      if (c.router) warnings.push({ code: 'router_mode', message: 'llama-server router mode', model: c.model });
    } catch (e) { warnings.push({ code: 'context_fail', message: String(e.message || e) }); }
    try {
      const tok = await withGate(p, () => tokenize(p, limits.requestToText(messages, opts.tools), { model: opts.model }));
      promptTokens = tok.count; tokSrc = 'tokenize';
    } catch (e) {
      promptTokens = limits.estimateTokens(messages, opts.tools); tokSrc = 'estimate';
      warnings.push({ code: 'tokenize_fail', message: String(e.message || e), estimated: promptTokens });
    }
  } else {
    promptTokens = limits.estimateTokens(messages, opts.tools); tokSrc = 'estimate';
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
  if (novoice.isLocalVoiceExe(cfg.exe) || novoice.mentionsLocalVoice(cfg.template)) return fail(novoice.refuse(cfg.exe || 'template').message);
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
// "exe --help" → lets the user see the real CLI flags of an unknown engine (never vs-engine / omnivoice-tts: v2.6.13.1)
function exeHelp(exe) {
  exe = nyxPath.resolveForUse(exe);
  if (novoice.isLocalVoiceExe(exe)) return Promise.resolve({ ok: false, error: novoice.refuse(exe).message });
  if (!exe || !fs.existsSync(exe)) return Promise.resolve({ ok: false, error: t('procs.001') + (exe || '—') });
  return new Promise((res) => {
    let out = ''; const ch = spawn(exe, ['--help'], { cwd: path.dirname(exe), windowsHide: true });
    const tm = setTimeout(() => { try { ch.kill(); } catch (e) {} res({ ok: true, out: out.slice(0, 6000) }); }, 8000);
    ch.stdout.on('data', d => { out += d; }); ch.stderr.on('data', d => { out += d; });
    ch.on('error', e => { clearTimeout(tm); res({ ok: false, error: e.message }); });
    ch.on('close', () => { clearTimeout(tm); res({ ok: true, out: out.slice(0, 6000) }); });
  });
}

// ---- v2.6.8: streaming, load-wait (no fixed cap), mmproj hint, request gate ----
function errText(e) { return String((e && (e.detail || e.message || e.error || e)) || ''); }
// v2.6.9: a model that cannot parse tool calls answers 500 too (Krikri on b12230: «does not match the expected
// peg-native format»). That is not a model load: retrying forever showed «loading model» with no end. Thrown as NOTOOLS.
function isToolFormatError(e) {
  const s = errText(e);
  return /peg-native|does not match the expected .{0,40}format|failed to parse tool|tool[_ ]?call[s]? (?:are |is )?not supported|tools? (?:are |is )?not supported|unable to (?:parse|generate) tool/i.test(s);
}
// v2.6.9.1: a 500 is NOT a model load by itself. b12230 answers 500 for template errors too («Jinja Exception: System message
// must be at the beginning»), and treating every 500 as «loading» resent the request every ~1,6 s forever. Only the text
// of a load (or the router's /v1/models saying «loading») counts; everything else stops at once with the server's message.
const LOAD_TEXT_RE = /request cancelled while waiting for (?:the )?model|waiting for (?:the )?model|model is (?:being |still )?loading|loading (?:the )?model|model (?:is )?(?:still )?loading|\bLoading model\b/i;
const TEMPLATE_RE = /jinja|chat template|template (?:error|exception)|system message must be|raise_exception/i;
function isTemplateError(e) { return TEMPLATE_RE.test(errText(e)); }
function isLoadCancel(e) {
  if (isToolFormatError(e) || isTemplateError(e)) return false;
  const s = errText(e) + ' ' + String((e && e.code) || '');
  if (/model is not loaded|cancelled by a stop/i.test(s)) return false; // router with autoload off / a user stop: not a wait
  return LOAD_TEXT_RE.test(s);
}
const LOAD_RETRY_DEFAULT = 10;
function loadRetryMax(body) {
  const v = body && body.loadRetries;
  if (v == null || v === '' || !Number.isFinite(+v)) return LOAD_RETRY_DEFAULT;
  return Math.max(0, Math.floor(+v));
}
function markToolFormat(e, body) {
  if (!e || !(body && body.tools && body.tools.length) || !isToolFormatError(e)) return e;
  try { e.code = 'NOTOOLS'; e.toolModel = body.model || ''; } catch (x) {}
  return e;
}
function isImageInputError(e) { return /image input is not supported/i.test(errText(e)); }
function mmprojHint() { return t('v268.mmproj_hint'); }
function withImageHint(e) {
  if (!isImageInputError(e)) return e;
  const msg = errText(e).split(' — ')[0] + ' — ' + mmprojHint();
  if (e instanceof Error) { e.message = msg; e.code = e.code || 'NOMMPROJ'; e.hint = mmprojHint(); return e; }
  const n = new NetError('http', msg, { status: (e && e.status) || 400 }); n.code = 'NOMMPROJ'; n.hint = mmprojHint(); return n;
}
const gates = new Map();
function hostKey(p) { try { return new URL(baseOf(p) || p.base).host; } catch (e) { return String((p && p.base) || ''); } }
function withGate(p, fn) {
  const k = hostKey(p) || '_';
  const prev = gates.get(k) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  gates.set(k, next.catch(() => {}));
  return next;
}
function sleep(ms, signal) {
  return new Promise((res, rej) => {
    const tm = setTimeout(res, ms);
    if (!signal) return;
    const onAb = () => { clearTimeout(tm); rej(abortedErr()); };
    if (signal.aborted) { onAb(); return; }
    signal.addEventListener('abort', onAb, { once: true });
  });
}
function modelEntry(p, model, list) {
  const id = String(model || '');
  const arr = list || [];
  return arr.find((x) => x && (x.id === id || String(x.id).split(/[\\/]/).pop() === id.split(/[\\/]/).pop())) || null;
}
function entryLoading(m) {
  if (!m) return null;
  const raw = m.status || m.state || '';
  const st = String((raw && typeof raw === 'object') ? (raw.value || raw.status || '') : raw);
  // v2.6.8.2: «loaded» / «unloaded» used to match /load(ing)?/ and count as loading. Router b12230 sends status { value }.
  // v2.6.9.1: unloaded / sleeping / failed = not loading (null), so a wait never spins on them.
  if (/^(ok|ready|loaded)$/i.test(st)) return false;
  if (/^(loading|downloading)$/i.test(st) || m.loading === true) return true;
  if (st) return null;
  if (m.loaded === true || m.ready === true) return false;
  return null; // loaded:false = idle, not «loading» (a wait on it would never end)
}
async function slotsLoaded(p, model) {
  try {
    const r = await fetchNative(p, '/slots', {}, 2000);
    const arr = Array.isArray(r.json) ? r.json : (r.json && (r.json.slots || r.json.data)) || [];
    const id = String(model || '');
    const hit = arr.find((s) => s && s.model && (s.model === id || String(s.model).includes(id) || id.includes(String(s.model))));
    if (hit) return true;
  } catch (e) {}
  return false;
}
async function waitForModel(p, model, { signal, onStatus, interval, force } = {}) {
  const ms = Math.max(200, +interval || 800);
  let announced = false;
  const announce = () => { if (!announced && onStatus) { announced = true; onStatus('load', t('v268.loading_model')); } };
  const check = async () => {
    if (signal && signal.aborted) throw abortedErr();
    try {
      const list = await models(p);
      const loading = entryLoading(modelEntry(p, model, list));
      if (loading === false) return { ready: true, loading };
      if (await slotsLoaded(p, model)) return { ready: true, loading, via: 'slots' };
      return { ready: false, loading };
    } catch (e) {
      if (await slotsLoaded(p, model)) return { ready: true, loading: false, via: 'slots' };
      return { ready: false, loading: null };
    }
  };
  const first = await check();
  if (first.ready) return { ok: true, ready: true, model, via: first.via };
  // b12230 often lists models without a loaded flag. Do not block the first request in that case;
  // after a 500 the caller passes force and we wait one interval (or keep going while loading is known).
  if (first.loading !== true && !force) return { ok: true, ready: 'unknown', model };
  announce();
  while (true) {
    await sleep(ms, signal);
    const st = await check();
    if (st.ready) return { ok: true, ready: true, model, via: st.via };
    if (st.loading !== true) return { ok: true, ready: 'unknown', model };
  }
}
// v2.6.9.1: resend only while the model is really loading — the error text says so, or the router's /v1/models lists the
// model as «loading». Any other 500 (Jinja, template, …) is thrown at once. Resends are limited (settings → «Επαναλήψεις
// όσο φορτώνει το μοντέλο», default 10, shown in the notice as k/N); Stop aborts the signal and ends the loop.
async function routerSaysLoading(p, model) {
  try {
    const list = await models(p);
    return entryLoading(modelEntry(p, model, list)) === true;
  } catch (e) { return false; }
}
async function withLoadRetry(p, body, run, { signal, onStatus } = {}) {
  const local = limits.isLocalLlama(p) || p?.kind === 'local';
  if (!local) return run();
  const max = loadRetryMax(body);
  let tries = 0;
  while (true) {
    if (signal && signal.aborted) throw abortedErr();
    try {
      if (tries > 0 && body && body.model) await waitForModel(p, body.model, { signal, onStatus, interval: 800, force: true });
      return await run();
    } catch (e) {
      const err = withImageHint(e);
      if (err && err.code === 'ABORTED') throw err;
      if (signal && signal.aborted) throw abortedErr();
      if (isImageInputError(err)) throw err;
      if (isToolFormatError(err)) throw markToolFormat(err, body);
      let loading = isLoadCancel(err);
      if (!loading && !isTemplateError(err) && (err.status === 500 || err.status === 503) && body && body.model) loading = await routerSaysLoading(p, body.model);
      if (!loading) { try { if (isTemplateError(err)) err.code = err.code && err.code !== 'http' ? err.code : 'TEMPLATE'; } catch (x) {} throw err; }
      tries++;
      if (tries > max) {
        const ex = new NetError('http', t('v2691.retry_exhausted', { v0: max, v1: errText(err).slice(0, 300) }), { status: err.status || 0 });
        ex.code = 'LOADRETRY'; ex.tries = tries - 1; throw ex;
      }
      if (onStatus) onStatus('load', t('v2691.loading_try', { v0: tries, v1: max }));
      await sleep(800, signal);
    }
  }
}

function chatBody(p, body) {
  const local = limits.isLocalLlama(p) || p?.kind === 'local';
  const req = { model: body.model, messages: limits.oneSystem(body.messages), temperature: body.temperature ?? 0.4, stream: !!body.stream };
  if (body.max_tokens) req.max_tokens = body.max_tokens;
  if (body.tools?.length) { req.tools = body.tools; req.tool_choice = body.tool_choice || 'auto'; }
  if (body.response_format) req.response_format = body.response_format;
  if (body.cache_prompt != null ? body.cache_prompt : local) req.cache_prompt = true;
  applyThink(req, body);
  return req;
}
function parseSSE(chunk, acc) {
  acc = acc || { buf: '', events: [] };
  acc.buf = (acc.buf || '') + chunk;
  let idx;
  while ((idx = acc.buf.indexOf('\n')) >= 0) {
    let line = acc.buf.slice(0, idx); acc.buf = acc.buf.slice(idx + 1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      if (data === '[DONE]') { acc.done = true; continue; }
      try { acc.events.push(JSON.parse(data)); } catch (e) {}
    }
  }
  return acc;
}
function assembleDelta(events, state) {
  state = state || { content: '', reasoning: '', finish: '', usage: null, timings: null, model: '', tool_calls: [] };
  for (const ev of events || []) {
    if (ev && ev.model) state.model = ev.model;
    if (ev && ev.usage) state.usage = ev.usage;
    if (ev && ev.timings) state.timings = ev.timings;
    const ch = ev && ev.choices && ev.choices[0];
    if (!ch) continue;
    if (ch.finish_reason) state.finish = ch.finish_reason;
    const d = ch.delta || {};
    if (d.content) state.content += d.content;
    if (d.reasoning_content) state.reasoning += d.reasoning_content;
    if (ch.reason || ch.reasoning_content) state.reasoning += String(ch.reason || ch.reasoning_content);
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const i = tc.index != null ? tc.index : state.tool_calls.length;
        if (!state.tool_calls[i]) state.tool_calls[i] = { id: tc.id || '', type: tc.type || 'function', function: { name: '', arguments: '' } };
        const slot = state.tool_calls[i];
        if (tc.id) slot.id = tc.id;
        if (tc.function && tc.function.name) slot.function.name += tc.function.name;
        if (tc.function && tc.function.arguments) slot.function.arguments += tc.function.arguments;
      }
    }
  }
  return state;
}

async function readSSE(res, { signal, onEvent } = {}) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let acc = { buf: '', events: [] };
  try {
    while (true) {
      if (signal && signal.aborted) { try { await reader.cancel(); } catch (e) {} throw abortedErr(); }
      const { done, value } = await reader.read();
      if (done) break;
      acc.events = [];
      parseSSE(dec.decode(value, { stream: true }), acc);
      for (const ev of acc.events) if (onEvent) onEvent(ev);
      if (acc.done) break;
    }
    if (acc.buf && acc.buf.trim()) {
      parseSSE('\n', acc);
      for (const ev of acc.events) if (onEvent) onEvent(ev);
    }
  } finally {
    try { reader.releaseLock(); } catch (e) {}
  }
}

// v2.6.9: thinking counted while it streams (one SSE event ≈ one token on llama-server). With a user cap (think_cap > 0)
// the stream stops when the cap is reached before any visible answer and returns finish 'think_cap' — the renderer then
// asks again without thinking and says so. No cap = nothing is cut here.
function openThinkInContent(content) {
  const c = String(content || '');
  if (/^\s*<think>/i.test(c) && !/<\/think>/i.test(c)) return true;
  if (/<\|channel\|?>\s*(thought|reasoning|analysis)\b/i.test(c) && !/<channel\|>|<\|channel\|?>\s*(final|response)\b/i.test(c.replace(/^[\s\S]*?(thought|reasoning|analysis)\b/i, ''))) return true;
  return false;
}
async function chatStreamOnce(p, body, { signal, onDelta } = {}) {
  const req = chatBody(p, { ...body, stream: true });
  const url = baseOf(p) + '/chat/completions';
  const local = limits.isLocalLlama(p) || p?.kind === 'local';
  const timeout = body.timeout != null ? body.timeout : (local ? 0 : 240000);
  const cap = Math.max(0, Math.floor(+body.think_cap || 0));
  const inner = new AbortController();
  if (signal) { if (signal.aborted) inner.abort(); else signal.addEventListener('abort', () => inner.abort(), { once: true }); }
  const r = await jfetch(url, { method: 'POST', headers: { ...headers(p), Accept: 'text/event-stream' }, body: JSON.stringify(req), signal: inner.signal, _raw: true }, timeout);
  const ctype = (r.headers && (r.headers.get && r.headers.get('content-type') || r.headers['content-type'])) || '';
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    const det = (j && (j.error && (j.error.message || j.error) || j.message)) || txt.slice(0, 300);
    throw withImageHint(new NetError('http', netMessage('http', url, r.status, typeof det === 'string' ? det : JSON.stringify(det)), { status: r.status, url, detail: typeof det === 'string' ? det : '' }));
  }
  // some servers ignore stream=true and return a JSON body
  if (!/text\/event-stream|ndjson/i.test(String(ctype)) && !String(ctype).includes('event-stream')) {
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (j && j.choices) {
      const ch = j.choices[0] || {};
      const msg = ch.message || { role: 'assistant', content: ch.text || '' };
      if (onDelta && msg.content) onDelta({ type: 'delta', text: msg.content, raw: msg.content, reasoning: msg.reasoning_content || '' });
      return { message: msg, finish: ch.finish_reason, usage: j.usage || null, model: j.model || body.model, reasoning: msg.reasoning_content || null, timings: j.timings || null, streamed: false };
    }
  }
  const state = { content: '', reasoning: '', finish: '', usage: null, timings: null, model: '', tool_calls: [] };
  let reasonN = 0, capHit = false;
  try {
    await readSSE(r, {
      signal: inner.signal,
      onEvent: (ev) => {
        if (capHit) return;
        const before = state.content.length, rBefore = state.reasoning.length;
        assembleDelta([ev], state);
        const grewR = state.reasoning.length !== rBefore;
        const grewC = state.content.length !== before;
        if (grewR || (grewC && openThinkInContent(state.content))) reasonN++;
        if (onDelta && grewC) onDelta({ type: 'delta', text: state.content.slice(before), raw: state.content, reasoning: state.reasoning, reasoning_n: reasonN });
        else if (onDelta && grewR) onDelta({ type: 'delta', text: '', raw: state.content, reasoning: state.reasoning, reasoning_n: reasonN });
        else if (onDelta && ev && ev.timings) onDelta({ type: 'timings', timings: ev.timings });
        if (cap > 0 && reasonN >= cap && !limits.extractThink(state.content, '').text && !(state.tool_calls || []).some(Boolean)) {
          capHit = true; inner.abort();
        }
      },
    });
  } catch (e) {
    if (!capHit || (signal && signal.aborted)) throw e;
  }
  const msg = { role: 'assistant', content: state.content };
  if (state.reasoning) msg.reasoning_content = state.reasoning;
  const calls = (state.tool_calls || []).filter(Boolean);
  if (calls.length) msg.tool_calls = calls;
  return { message: msg, finish: capHit ? 'think_cap' : (state.finish || 'stop'), usage: state.usage, model: state.model || body.model, reasoning: state.reasoning || null, timings: state.timings, streamed: true, reasoning_n: reasonN, think_cap: cap || null };
}

async function chatStream(p, body, { signal, onDelta, onStatus } = {}) {
  const hook = onStatus || ((kind, msg) => { if (onDelta) onDelta({ type: kind, text: msg || '', notice: msg }); });
  return withLoadRetry(p, body, () => withGate(p, async () => {
    // v2.6.8.2: a request cancelled while it waited in the queue never reaches the server.
    if (signal && signal.aborted) throw abortedErr();
    // After a 500, waitForModel has already run. Before the first try, a silent ready-check avoids a cancelled first request.
    const local = limits.isLocalLlama(p) || p?.kind === 'local';
    if (local && body.model) {
      try { await waitForModel(p, body.model, { signal, onStatus: hook }); } catch (e) { if (e && e.code === 'ABORTED') throw e; }
    }
    return chatStreamOnce(p, body, { signal, onDelta });
  }), { signal, onStatus: hook });
}

module.exports = { traced, traceAnswer, modelState, isTemplateError, loadRetryMax, LOAD_RETRY_DEFAULT, routerEntry, argCtx, routerSaysLoading, isToolFormatError, markToolFormat, openThinkInContent, parseWait, waitOf, jfetch, models, ping, chat, chatStream, chatBody, parseSSE, assembleDelta, isLoadCancel, isImageInputError, mmprojHint, withImageHint, waitForModel, modelEntry, entryLoading, withLoadRetry, withGate, prepare, props, parseRouterMax, routerInfo, slots, tokenize, modelLoaded, PROPS_MODEL_MS, contextInfo, embed, transcribe, tts, runCmd, fillTemplate, buildTtsCmd, cmdQuote, exeHelp, netCode, netMessage, baseVariants, hintFor, findLms, lmsServerStart, isForbidden, isNeedModel, modelQuery, _baseCache: baseCache, _thinkCache: thinkCache, NetError };
