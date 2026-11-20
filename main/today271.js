'use strict';
// v2.7.1 — «Σήμερα» widget, main-process side. The renderer's CSP has no network, so the weather comes from here.
//  · ONE fixed URL on api.open-meteo.com (Thessaloniki, °C, km/h, Europe/Athens). GET only, no redirects, no cookies,
//    8 s timeout, 64 KB cap; the answer is validated and reduced to a few numbers before it reaches the renderer.
//  · Nothing runs until a «Σήμερα» widget asks (lazy): then one attempt, next one in 30′; after a failure 10′, then 30′.
//    One timer at a time (setTimeout chain), no polling from the renderer (it reads the cached result over IPC).
//  · The last good answer is kept in data/today271-cache.json, so the widget shows the last values offline.
//  · Name days come from the bundled «Εορτολόγιο» plugin (app/plugins/eortologio/plugin.js, unchanged), read through
//    the same integrity check and sandbox the plugin host uses.
//  · Tests: with NYX_TEST there are never live calls unless NYX_TODAY271_LIVE=1 (one manual check); NYX_TODAY271_MOCK
//    points to a JSON file that stands in for the answer ({ body } | { fail: 'net' | 'http' | 'timeout' | 'big' }).
const fs = require('fs'), path = require('path'), vm = require('vm');

const HOST = 'api.open-meteo.com';
const URL_FIXED = 'https://api.open-meteo.com/v1/forecast?latitude=40.627&longitude=22.444'
  + '&current=temperature_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m'
  + '&hourly=temperature_2m,weather_code,precipitation_probability,is_day'
  + '&forecast_hours=24&wind_speed_unit=kmh&timezone=Europe%2FAthens';
const TIMEOUT_MS = 8000, MAX_BYTES = 64 * 1024;
const EVERY_MS = 30 * 60000, RETRY1_MS = 10 * 60000, RETRY2_MS = 30 * 60000, FORCE_GAP_MS = 15000;

const fin = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const TIME_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;
const DAY_RE = /^(\d{4})-(\d\d)-(\d\d)$/;

// Open-Meteo answer → { cur, hours[] } or throws 'bad'. Only these fields survive.
function normalize(j) {
  const bad = () => { const e = new Error('bad answer'); e.kind = 'bad'; throw e; };
  if (!j || typeof j !== 'object') bad();
  const c = j.current, h = j.hourly;
  if (!c || !h || !Array.isArray(h.time)) bad();
  if (!(typeof c.time === 'string' && TIME_RE.test(c.time) && fin(c.temperature_2m, -90, 70) && Number.isInteger(c.weather_code) && fin(c.weather_code, 0, 99)
    && (c.is_day === 0 || c.is_day === 1) && fin(c.wind_speed_10m, 0, 500) && fin(c.wind_direction_10m, 0, 360))) bad();
  const n = h.time.length; if (n < 1 || n > 48) bad();
  for (const k of ['temperature_2m', 'weather_code', 'precipitation_probability', 'is_day']) if (!Array.isArray(h[k]) || h[k].length !== n) bad();
  const hours = [];
  for (let i = 0; i < n; i++) {
    const time = h.time[i], t = h.temperature_2m[i], code = h.weather_code[i], day = h.is_day[i]; let pop = h.precipitation_probability[i];
    if (pop === null) pop = 0;
    if (!(typeof time === 'string' && TIME_RE.test(time) && fin(t, -90, 70) && Number.isInteger(code) && fin(code, 0, 99) && (day === 0 || day === 1) && fin(pop, 0, 100))) bad();
    hours.push({ time, t, code, day, pop: Math.round(pop) });
  }
  return { cur: { time: c.time, t: c.temperature_2m, code: c.weather_code, day: c.is_day, ws: c.wind_speed_10m, wd: c.wind_direction_10m }, hours };
}

// the only network call: fixed URL, checked again right before it goes out
async function fetchFixed(fetchFn, url) {
  const u = new URL(url);
  if (url !== URL_FIXED || u.protocol !== 'https:' || u.hostname !== HOST || u.port || u.username || u.password) { const e = new Error('url not allowed'); e.kind = 'bad'; throw e; }
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let r;
    try { r = await fetchFn(url, { method: 'GET', signal: ctl.signal, redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } }); }
    catch (e) { const x = new Error(ctl.signal.aborted ? 'timeout' : 'network'); x.kind = ctl.signal.aborted ? 'timeout' : 'net'; throw x; }
    if (!r || !r.ok) { const e = new Error('http ' + (r && r.status)); e.kind = 'http'; throw e; }
    const len = +((r.headers && r.headers.get && r.headers.get('content-length')) || 0);
    if (len > MAX_BYTES) { const e = new Error('too big'); e.kind = 'big'; throw e; }
    const chunks = []; let size = 0;
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader();
      for (;;) {
        let s; try { s = await rd.read(); } catch (e) { const x = new Error(ctl.signal.aborted ? 'timeout' : 'network'); x.kind = ctl.signal.aborted ? 'timeout' : 'net'; throw x; }
        if (s.done) break; size += s.value.byteLength;
        if (size > MAX_BYTES) { try { rd.cancel(); } catch (e) {} const e = new Error('too big'); e.kind = 'big'; throw e; }
        chunks.push(Buffer.from(s.value));
      }
    } else { const b = Buffer.from(await r.arrayBuffer()); if (b.length > MAX_BYTES) { const e = new Error('too big'); e.kind = 'big'; throw e; } chunks.push(b); size = b.length; }
    let j; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { const x = new Error('bad json'); x.kind = 'bad'; throw x; }
    return normalize(j);
  } finally { clearTimeout(tm); }
}

// the bundled Εορτολόγιο plugin, loaded like the plugin host does (integrity-checked read, sandbox without eval)
function loadNames(pluginFile, readFile) {
  const code = String(readFile(pluginFile));
  const ctx = vm.createContext({ module: { exports: {} }, exports: {}, Date, Math, String, Object, Array }, { name: 'today271:eortologio', codeGeneration: { strings: false, wasm: false } });
  new vm.Script(code, { filename: 'eortologio/plugin.js' }).runInContext(ctx, { timeout: 2000 });
  const f = ctx.module.exports && ctx.module.exports.names; if (typeof f !== 'function') throw new Error('names() missing');
  return f;
}

function create(o) {
  const now = o.now || Date.now;
  const cacheFile = o.cacheFile;
  const sched = o.setTimeout || setTimeout, unsched = o.clearTimeout || clearTimeout;
  let cache = null, lastTry = 0, lastErr = null, fails = 0, timer = null, nextAt = 0, inflight = null, started = false, namesFn = null, namesErr = null, calls = 0;
  try { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c && c.data && fin(c.fetchedAt, 0, 1e15)) cache = { data: normalize(c.raw || toRaw(c.data)), fetchedAt: c.fetchedAt }; } catch (e) { cache = null; }
  function toRaw(d) { return { current: { time: d.cur.time, temperature_2m: d.cur.t, weather_code: d.cur.code, is_day: d.cur.day, wind_speed_10m: d.cur.ws, wind_direction_10m: d.cur.wd }, hourly: { time: d.hours.map((x) => x.time), temperature_2m: d.hours.map((x) => x.t), weather_code: d.hours.map((x) => x.code), precipitation_probability: d.hours.map((x) => x.pop), is_day: d.hours.map((x) => x.day) } }; }
  function save() { try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); const tmp = cacheFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ v: 1, fetchedAt: cache.fetchedAt, data: cache.data })); fs.renameSync(tmp, cacheFile); } catch (e) {} }
  function plan(ms) { if (timer) unsched(timer); nextAt = now() + ms; timer = sched(() => { timer = null; run(); }, ms); if (timer && timer.unref) timer.unref(); }
  function run() {
    if (inflight) return inflight;
    lastTry = now(); calls++;
    inflight = fetchFixed(o.fetch, URL_FIXED).then((data) => { cache = { data, fetchedAt: now() }; lastErr = null; fails = 0; save(); plan(EVERY_MS); },
      (e) => { lastErr = (e && e.kind) || 'net'; fails++; plan(fails === 1 ? RETRY1_MS : RETRY2_MS); })
      .finally(() => { inflight = null; });
    return inflight;
  }
  function start() {
    if (started) return null; started = true;
    const age = cache ? now() - cache.fetchedAt : Infinity;
    if (age >= 0 && age < EVERY_MS) { plan(EVERY_MS - age); return null; }
    return run();
  }
  function names(day) {
    const m = String(day || '').match(DAY_RE); const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(now());
    try { if (!namesFn && !namesErr) namesFn = loadNames(o.pluginFile, o.readFile); } catch (e) { namesErr = e; }
    if (!namesFn) return { names: '', namesOk: false };
    try { return { names: String(namesFn(d) || ''), namesOk: true }; } catch (e) { return { names: '', namesOk: false }; }
  }
  function status(day) {
    return { ok: !!cache, data: cache ? cache.data : null, fetchedAt: cache ? cache.fetchedAt : 0, lastTry, lastErr, fails, nextAt, now: now(), ...names(day) };
  }
  // the one IPC entry: { day?: 'YYYY-MM-DD', force?: true } → status (waits for the first attempt / a forced one)
  async function get(arg) {
    const a = (arg && typeof arg === 'object') ? arg : {};
    const p = start() || (a.force && now() - lastTry >= FORCE_GAP_MS ? run() : null) || (a.force ? inflight : null);
    if (p) await p;
    return status(a.day);
  }
  function stop() { if (timer) unsched(timer); timer = null; }
  return { get, stop, status, _calls: () => calls, _plan: () => nextAt };
}

// production wiring: electron net (system proxy), data/ cache, the bundled plugin; test mocks only under NYX_TEST
function register(ipcMain, { dataDir, net }) {
  const integ = require('./unpacked-integrity');
  let fetchFn = (u, opts) => net.fetch(u, opts);
  if (process.env.NYX_TEST) {
    const mock = process.env.NYX_TODAY271_MOCK;
    if (mock) fetchFn = async (u) => {
      try { fs.appendFileSync(mock + '.calls', u + '\n'); } catch (e) {}
      const m = JSON.parse(fs.readFileSync(mock, 'utf8'));
      if (m.delayMs) await new Promise((r) => setTimeout(r, Math.min(+m.delayMs, 9000)));
      if (m.fail === 'net') throw new TypeError('net::ERR_INTERNET_DISCONNECTED');
      if (m.fail === 'timeout') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      if (m.fail === 'http') return { ok: false, status: 503, headers: { get: () => null } };
      const txt = m.fail === 'big' ? 'x'.repeat(MAX_BYTES + 10) : JSON.stringify(m.body);
      return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => Buffer.from(txt) };
    };
    else if (process.env.NYX_TODAY271_LIVE !== '1') fetchFn = async () => { throw new TypeError('no live calls in tests'); };
  }
  const T = create({ fetch: fetchFn, cacheFile: path.join(dataDir(), 'today271-cache.json'), pluginFile: path.join(__dirname, '..', 'app', 'plugins', 'eortologio', 'plugin.js'), readFile: (f) => integ.readVerified(f) });
  ipcMain.handle('app:today271', (_e, arg) => T.get(arg));
  return T;
}

module.exports = { URL_FIXED, HOST, TIMEOUT_MS, MAX_BYTES, EVERY_MS, RETRY1_MS, RETRY2_MS, normalize, fetchFixed, loadNames, create, register };
