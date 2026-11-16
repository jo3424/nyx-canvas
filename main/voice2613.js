'use strict';
// v2.6.13 «φωνή ster» — the answer voice = a GPU Voice Studio persona (a voice clone) or the generic voice of vs-engine.
//  - personas.json (%APPDATA%\GPU Voice Studio\personas.json) is READ ONLY: opened with flag 'r', never written.
//    voice.refFile is ignored on purpose (it can point to an old C:\Users\Administrator path); voice.rvq.b64 + voice.refText
//    are used instead. The rvq code, the reference text and every token stay in the main process: the renderer only gets
//    names / ids / a ready flag, and everything that can reach a log, a toast or an error is redacted.
//  - Engine, chosen at the START of every answer (beginMessage):
//      GET http://127.0.0.1:7802/v1/status with «Authorization: Bearer <OmniVoice token>»
//        200            → Hermes's OmniVoice server is used; no own vs-engine (no spawn).
//        401 / 403      → UI message «λάθος token OmniVoice»; NO own vs-engine (two voice models + Qwen do not fit in 24 GB).
//        other answer   → UI message; NO own vs-engine (something is on 7802).
//        nothing answers (connection refused / timeout) → own vs-engine, started exactly as before by main/vsengine.js
//                         (its own port — never 7802 — and its own token).
//      The OmniVoice token: env OMNIVOICE_HERMES_TOKEN, else the file named by env OMNIVOICE_HERMES_TOKEN_FILE, else
//      %APPDATA%\OmniVoice\hermes.token (first line). Read in main for each probe, kept in memory only — never in Nyx's
//      settings, so it cannot reach an export, a backup or a snapshot. With no token, 7802 is still probed (without auth):
//      if anything answers there, no own vs-engine is started either.
//    If the engine dies in the middle of an answer: that sentence reports the error, the rest of the answer is skipped,
//    nothing new is started during that answer; the probe runs again at the start of the next answer.
//  - POST /v1/synthesize {text, language, ref_rvq_b64, ref_text, steps, guidance_scale} → WAV. One request at a time
//    (a single queue for the whole app); cancel() aborts the request in flight and drops the queue.
//  - Only 127.0.0.1 URLs; no new process: the own engine is started by the existing vsengine.start().
const fs = require('fs'), fsp = fs.promises, path = require('path');
const nyxPath = require('./paths');
const { redactText } = require('./redact');

const HERMES_PORT = 7802;
const HERMES_BASE = 'http://127.0.0.1:' + HERMES_PORT;
const GENERIC = 'generic';
const DEFAULT_VOICE = 'ster';

// ---------- personas.json ----------
function personasFile(opts = {}) {
  const env = opts.env || process.env;
  const plat = opts.platform || process.platform;
  let base = nyxPath.expandVars('%APPDATA%', { ...opts, env });
  if (!base || base === '%APPDATA%') {
    const home = nyxPath.userHome({ ...opts, env, platform: plat }); if (!home) return '';
    base = plat === 'win32' ? path.join(home, 'AppData', 'Roaming') : plat === 'darwin' ? path.join(home, 'Library', 'Application Support') : (env.XDG_CONFIG_HOME || path.join(home, '.config'));
  }
  return (plat === 'win32' ? path.win32 : path).join(base, 'GPU Voice Studio', 'personas.json');
}
// the OmniVoice token file (no settings involved): OMNIVOICE_HERMES_TOKEN_FILE, else %APPDATA%\OmniVoice\hermes.token
function tokenFile(opts = {}) {
  const env = opts.env || process.env; const plat = opts.platform || process.platform;
  if (typeof env.OMNIVOICE_HERMES_TOKEN_FILE === 'string' && env.OMNIVOICE_HERMES_TOKEN_FILE.trim()) return nyxPath.expandVars(env.OMNIVOICE_HERMES_TOKEN_FILE.trim(), { ...opts, env });
  const vs = personasFile({ ...opts, env, platform: plat }); if (!vs) return '';
  const P = plat === 'win32' ? path.win32 : path;
  return P.join(P.dirname(P.dirname(vs)), 'OmniVoice', 'hermes.token');
}
// → { token, source: 'env' | 'file' | 'none', file }
async function readToken(opts = {}) {
  const env = opts.env || process.env; const file = tokenFile(opts);
  const v = env.OMNIVOICE_HERMES_TOKEN; if (typeof v === 'string' && v.trim()) return { token: v.trim(), source: 'env', file };
  if (file) {
    try { const fh = await fsp.open(file, 'r'); try { const b = Buffer.alloc(4096); const { bytesRead } = await fh.read(b, 0, 4096, 0); const tk = b.slice(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim(); if (tk) return { token: tk, source: 'file', file }; } finally { await fh.close(); } } catch (e) { /* no file */ }
  }
  return { token: '', source: 'none', file };
}
const B64 = /^[A-Za-z0-9+/_\-\s]+={0,2}\s*$/;
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
// → { ok, personas: [full entries, main only], error: { code } }
function parsePersonas(text) {
  let j; try { j = JSON.parse(String(text == null ? '' : text).replace(/^\uFEFF/, '')); } catch (e) { return { ok: false, personas: [], error: { code: 'personas_schema', detail: 'json' } }; }
  const list = Array.isArray(j) ? j : (j && Array.isArray(j.personas) ? j.personas : null);
  if (!list) return { ok: false, personas: [], error: { code: 'personas_schema', detail: 'no list' } };
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim()) continue;
    const v = p.voice && typeof p.voice === 'object' ? p.voice : null; const tts = p.tts && typeof p.tts === 'object' ? p.tts : {};
    const type = v && typeof v.type === 'string' ? v.type : '';
    const rvq = v && v.rvq && typeof v.rvq === 'object' && typeof v.rvq.b64 === 'string' && v.rvq.b64.length > 8 && B64.test(v.rvq.b64) ? v.rvq.b64.replace(/\s+/g, '') : '';
    const refText = v && typeof v.refText === 'string' ? v.refText.trim() : '';
    let reason = '';
    if (!v) reason = 'no_voice'; else if (type !== 'clone') reason = 'type'; else if (!rvq) reason = 'no_rvq'; else if (!refText) reason = 'no_ref_text';
    out.push({ id: typeof p.id === 'string' || typeof p.id === 'number' ? String(p.id) : '', name: p.name.trim(), type, ready: !reason, reason,
      steps: num(tts.steps, 1, 256), guidance: num(tts.guidance_scale, 0, 30), rvq, refText });
  }
  if (list.length && !out.length) return { ok: false, personas: [], error: { code: 'personas_schema', detail: 'no entries' } };
  return { ok: true, personas: out, error: null };
}
async function readPersonas(opts = {}) {
  const file = opts.file || personasFile(opts); const rd = opts.readFile || ((f) => fsp.readFile(f, { encoding: 'utf8', flag: 'r' }));
  if (!file) return { ok: false, file: '', personas: [], error: { code: 'personas_missing' } };
  let txt; try { txt = await rd(file); } catch (e) { return { ok: false, file, personas: [], error: { code: e && e.code === 'ENOENT' ? 'personas_missing' : 'personas_read', detail: e && e.code || '' } }; }
  return { file, ...parsePersonas(txt) };
}
const pub = (p) => ({ id: p.id, name: p.name, type: p.type, ready: p.ready, reason: p.reason, steps: p.steps, guidance: p.guidance });
// the setting value: '' (unset) = ster · 'generic' · a persona id · a persona name
function findPersona(personas, want) {
  const w = String(want || '') || DEFAULT_VOICE;
  return personas.find((p) => p.id && p.id === w) || personas.find((p) => p.name === w) || personas.find((p) => p.name.toLowerCase() === w.toLowerCase()) || null;
}
// ---------- request body ----------
function synthBody(text, persona, lang) {
  const body = { text: String(text || ''), language: lang === 'en' ? 'en' : 'el' };
  if (persona) {
    if (persona.rvq && !persona.refText) throw Object.assign(new Error('bad_reference'), { code: 'bad_reference' }); // vs-engine: ref_rvq_b64 without ref_text = 400
    if (!persona.rvq) throw Object.assign(new Error('no_rvq'), { code: 'persona_not_ready' });
    body.ref_rvq_b64 = persona.rvq; body.ref_text = persona.refText;
    if (persona.steps != null) body.steps = persona.steps;
    if (persona.guidance != null) body.guidance_scale = persona.guidance;
  }
  return body;
}
// ---------- redaction ----------
function redactor(secretsList) {
  const xs = secretsList.filter((s) => typeof s === 'string' && s.length >= 4).sort((a, b) => b.length - a.length);
  return (s) => { let x = String(s == null ? '' : s); for (const k of xs) x = x.split(k).join('***'); return redactText(x); };
}
// ---------- HTTP (127.0.0.1 only) ----------
async function httpReq(url, { method = 'GET', headers = {}, body, timeout = 8000, signal } = {}) {
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}\//.test(url)) return { status: 0, error: 'not_local' };
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort('timeout'), timeout);
  const onAbort = () => ac.abort('cancel'); if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    const r = await fetch(url, { method, headers, body, signal: ac.signal });
    const ctype = r.headers.get('content-type') || ''; const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ctype, buf };
  } catch (e) { return { status: 0, error: ac.signal.aborted ? String(ac.signal.reason || 'abort') : ((e.cause && e.cause.code) || e.name || 'error') }; }
  finally { clearTimeout(tm); if (signal) signal.removeEventListener('abort', onAbort); }
}
const isWav = (r) => r.status >= 200 && r.status < 300 && r.buf && r.buf.length > 44 && r.buf.slice(0, 4).toString() === 'RIFF';
const errCode = (r) => { try { const j = JSON.parse(r.buf.toString('utf8')); return String(j.error && (j.error.code || j.error.type || j.error) || j.code || '').slice(0, 40); } catch (e) { return ''; } };

// ---------- the engine + queue ----------
// deps: { vsengine, secrets, env, req, writeFile, log, now }
function create(deps = {}) {
  const vse = deps.vsengine || require('./vsengine');
  const secretsStore = deps.secrets;
  const env = deps.env || process.env;
  const req = deps.req || httpReq;
  const writeFile = deps.writeFile || ((f, b) => fsp.writeFile(f, b));
  const now = deps.now || Date.now;
  const logBuf = [];
  let choice = null; let msgSeq = 0; let session = null; let chain = Promise.resolve(); let inflight = null; let cancelGen = 0;
  let tokenNow = { token: '', source: 'none', file: '' }; // memory only (main process)
  const hermesToken = () => tokenNow.token;
  const own = () => { try { return vse.token(secretsStore); } catch (e) { return ''; } };
  const red = () => redactor([hermesToken(), choice && choice.token, session && session.persona && session.persona.rvq, session && session.persona && session.persona.refText, own()]);
  const log = (s) => { const line = red()(s); logBuf.push(new Date(now()).toISOString().slice(11, 19) + ' ' + line); if (logBuf.length > 200) logBuf.shift(); if (deps.log) deps.log(line); };
  const publicChoice = () => choice ? { kind: choice.kind, port: choice.port, msg: choice.msg, dead: !!choice.dead } : null;

  async function probeHermes() {
    try { tokenNow = await (deps.readToken || readToken)({ env }); } catch (e) { tokenNow = { token: '', source: 'none', file: '' }; }
    const tk = hermesToken(); const src = { source: tokenNow.source, file: tokenNow.file };
    const r = await req(HERMES_BASE + '/v1/status', { headers: tk ? { Authorization: 'Bearer ' + tk } : {}, timeout: 1500 });
    if (!r.status) return { state: 'down', why: r.error || 'no answer', ...src }; // nothing on 7802 (refused / timeout)
    if (!tk) return { state: 'no_token', status: r.status, ...src };              // something answers, but no token
    if (r.status === 200) return { state: 'ok', ...src };
    if (r.status === 401 || r.status === 403) return { state: 'refused', status: r.status, ...src };
    return { state: 'other', status: r.status, ...src };
  }
  // the start of an answer: probe 7802, otherwise the own vs-engine (started as before; never on 7802)
  async function beginMessage(cfg) {
    const msg = ++msgSeq; const p = await probeHermes();
    if (p.state === 'ok') {
      choice = { kind: 'hermes', port: HERMES_PORT, base: HERMES_BASE, token: hermesToken(), msg };
      let ownRunning = false; try { ownRunning = !!(vse.status && vse.status().running); } catch (e) {}
      if (ownRunning) { try { vse.stop(); } catch (e) {} log('7802 OK (200): Hermes OmniVoice in use; own vs-engine stopped (one engine on the GPU)'); }
      else log('7802 OK (200): Hermes OmniVoice in use, own vs-engine not started');
      return { probe: p, engine: publicChoice() };
    }
    // something answers on 7802 but not with 200: a message, and NO own vs-engine (the VRAM would not hold two voice models)
    if (p.state !== 'down') {
      choice = null;
      const code = p.state === 'refused' ? 'hermes_token' : p.state === 'no_token' ? 'hermes_no_token' : 'hermes_http';
      log(p.state === 'refused' ? `7802 refused (${p.status}): wrong OmniVoice token; own vs-engine NOT started (VRAM)`
        : p.state === 'no_token' ? `7802 answered ${p.status} but no OmniVoice token was found (env OMNIVOICE_HERMES_TOKEN / file); own vs-engine NOT started (VRAM)`
          : `7802 answered ${p.status}; own vs-engine NOT started (VRAM)`);
      throw Object.assign(new Error(code), { code, status: p.status || 0 });
    }
    const ownCfg = { ...(cfg || {}) }; if (+ownCfg.port === HERMES_PORT) ownCfg.port = ''; // never take Hermes's port
    const why = `7802 no answer (${p.why})`;
    let st;
    try { st = await vse.start(ownCfg, secretsStore); }
    catch (e) { choice = null; log(`${why}; own vs-engine failed to start: ${e && e.message}`); throw Object.assign(new Error(red()(e && e.message || 'start')), { code: 'engine_start' }); }
    if (!st || !st.port || st.port === HERMES_PORT) { choice = null; log(`${why}; own vs-engine has no usable port`); throw Object.assign(new Error('port'), { code: 'engine_start' }); }
    choice = { kind: 'own', port: st.port, base: 'http://127.0.0.1:' + st.port, token: own(), msg };
    log(`${why}; starting own vs-engine on port ${st.port}`);
    return { probe: p, engine: publicChoice() };
  }
  // one synthesis; queued so that requests reach the GPU one at a time
  function synth(msg, text, persona, lang, outFile) {
    const gen = cancelGen;
    const run = async () => {
      if (gen !== cancelGen) return { ok: false, code: 'cancelled' };
      if (!choice || choice.msg !== msg) return { ok: false, code: 'stale' };
      if (choice.dead) return { ok: false, code: 'engine_down', skipped: true };
      let body; try { body = synthBody(text, persona, lang); } catch (e) { return { ok: false, code: e.code || 'bad_request' }; }
      const ac = new AbortController(); inflight = ac; const t0 = now();
      const r = await req(choice.base + '/v1/synthesize', { method: 'POST', headers: { Authorization: 'Bearer ' + choice.token, 'Content-Type': 'application/json', Accept: 'audio/wav' }, body: JSON.stringify(body), timeout: 120000, signal: ac.signal });
      inflight = null;
      if (gen !== cancelGen || r.error === 'cancel') return { ok: false, code: 'cancelled' };
      if (isWav(r)) { await writeFile(outFile, r.buf); return { ok: true, ms: now() - t0, engine: choice.kind }; }
      if (!r.status) { choice.dead = true; log(`${choice.kind === 'hermes' ? 'Hermes OmniVoice (7802)' : 'own vs-engine (port ' + choice.port + ')'} stopped answering during an answer (${r.error}); rest of this answer skipped, probe again at the next answer`); return { ok: false, code: 'engine_down' }; }
      const c = errCode(r);
      if (r.status === 400 && /bad_reference/.test(c)) return { ok: false, code: 'bad_reference' };
      if (r.status === 401 || r.status === 403) { log(`/v1/synthesize refused (${r.status})`); return { ok: false, code: 'engine_token' }; }
      return { ok: false, code: 'engine_http', status: r.status, detail: red()(c) };
    };
    const p = chain.then(run, run); chain = p.catch(() => {}); return p;
  }
  function cancel() { cancelGen++; try { inflight && inflight.abort(); } catch (e) {} inflight = null; return true; }
  // ---- the IPC-facing calls ----
  async function list(opts = {}) {
    const r = await readPersonas(opts);
    const hermes = opts.probe === false ? null : await probeHermes();
    return { ok: r.ok, file: r.file, error: r.error ? { code: r.error.code } : null, personas: r.personas.map(pub), generic: GENERIC, def: DEFAULT_VOICE, engine: publicChoice(), hermes: hermes && { state: hermes.state, status: hermes.status || 0 }, token: hermes ? { source: hermes.source, file: hermes.file } : null, log: logBuf.slice(-30) };
  }
  // the start of an answer: check the chosen voice FIRST (no silent change, no fallback), then pick the engine
  async function begin(cfg, want, opts = {}) {
    cancel(); session = null;
    const w = String(want || '') || DEFAULT_VOICE; let persona = null;
    if (w !== GENERIC) {
      const r = await readPersonas(opts);
      if (!r.ok) return { ok: false, code: r.error.code, voice: w };
      persona = findPersona(r.personas, w);
      if (!persona) return { ok: false, code: 'persona_missing', voice: w };
      if (!persona.ready) return { ok: false, code: 'persona_not_ready', reason: persona.reason, voice: persona.name };
    }
    let b; try { b = await beginMessage(cfg); } catch (e) { return { ok: false, code: e.code || 'engine_start', status: e.status || 0, file: e.code === 'hermes_no_token' ? tokenNow.file : undefined, error: red()(e.message) }; }
    session = { msg: choice.msg, persona };
    return { ok: true, msg: choice.msg, voice: persona ? { id: persona.id, name: persona.name, steps: persona.steps, guidance: persona.guidance } : { id: GENERIC }, engine: b.engine, probe: { state: b.probe.state, status: b.probe.status || 0 } };
  }
  async function speak(msg, text, lang, outFile) {
    if (!session || session.msg !== msg) return { ok: false, code: 'stale' };
    return synth(msg, String(text || '').slice(0, 4000), session.persona, lang, outFile);
  }
  return { probeHermes, beginMessage, synth, cancel, list, begin, speak, log: () => logBuf.slice(), state: () => ({ engine: publicChoice(), msg: msgSeq }) };
}
module.exports = { HERMES_PORT, HERMES_BASE, GENERIC, DEFAULT_VOICE, personasFile, tokenFile, readToken, parsePersonas, readPersonas, findPersona, synthBody, redactor, httpReq, create, _pub: pub };
