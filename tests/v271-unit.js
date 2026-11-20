'use strict';
// v2.7.1 unit tests — «Σήμερα» widget (Variant C): main/today271.js (fixed URL, GET, 8 s, 64 KB, cache, 30′ / 10′ → 30′,
// name days from the unchanged Εορτολόγιο plugin) and app/js/v27/today271.js (WMO → icon/text, 8 directions, 3-hour
// boxes, stale / offline / down). The network is always mocked: global fetch throws if anything touches it.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const M = require('../main/today271');
const R = require('../app/js/v27/today271');
const WD = require('../app/js/v27/widgetdata');
const FX = require('./fixtures/openmeteo271');
const EL = require('../app/locales/el.json'), EN = require('../app/locales/en.json');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };
globalThis.fetch = () => { throw new Error('LIVE NETWORK IN A TEST'); };
const tr = (k, v) => String(EL[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => (v && v[n] !== undefined ? v[n] : ''));
const resp = (txt, o = {}) => ({ ok: o.status ? o.status < 400 : true, status: o.status || 200, headers: { get: (h) => (h === 'content-length' ? o.len || null : null) }, body: o.stream ? { getReader() { let i = 0; const ch = o.stream; return { read: async () => (i < ch.length ? { done: false, value: ch[i++] } : { done: true }), cancel() {} }; } } : null, arrayBuffer: async () => Buffer.from(txt || '') });

(async () => {
  console.log('v2.7.1 unit — «Σήμερα»');
  // ---- fixed URL ----
  const u = new URL(M.URL_FIXED);
  ok(u.protocol === 'https:' && u.hostname === 'api.open-meteo.com' && u.pathname === '/v1/forecast', 'one fixed URL on https://api.open-meteo.com/v1/forecast');
  ok(u.searchParams.get('latitude') === '40.627' && u.searchParams.get('longitude') === '22.444' && u.searchParams.get('timezone') === 'Europe/Athens' && u.searchParams.get('wind_speed_unit') === 'kmh' && !u.searchParams.has('temperature_unit') && u.searchParams.get('forecast_hours') === '24', 'Thessaloniki, Europe/Athens, km/h, °C (default unit), 24 hours');
  const srcMain = fs.readFileSync(path.join(ROOT, 'main/today271.js'), 'utf8');
  ok((srcMain.match(/https?:\/\//g) || []).length === 1, 'main/today271.js contains exactly one URL', srcMain.match(/https?:\/\/[^'"\s]+/g));
  ok(M.TIMEOUT_MS === 8000 && M.MAX_BYTES === 65536 && M.EVERY_MS === 1800000 && M.RETRY1_MS === 600000 && M.RETRY2_MS === 1800000, '8 s timeout, 64 KB cap, every 30′, retry 10′ then 30′');
  // ---- fetchFixed ----
  let seen = null; const body = FX.build(new Date('2026-11-25T14:10:00+02:00'));
  const d1 = await M.fetchFixed(async (url, opts) => { seen = { url, opts }; return resp(JSON.stringify(body)); }, M.URL_FIXED);
  ok(seen.url === M.URL_FIXED && seen.opts.method === 'GET' && seen.opts.redirect === 'error' && seen.opts.credentials === 'omit', 'GET, no redirects, no cookies', seen.opts);
  ok(d1.cur.t === 15.2 && d1.cur.code === 2 && d1.cur.wd === 315 && d1.hours.length === 24 && d1.hours[0].time === '2026-11-25T14:00', 'answer reduced to current + 24 hours', d1.cur);
  ok(Object.keys(d1).join() === 'cur,hours' && Object.keys(d1.hours[0]).join() === 'time,t,code,day,pop', 'only the needed fields survive (latitude, timezone… dropped)');
  const kind = async (fn, url) => { try { await M.fetchFixed(fn, url || M.URL_FIXED); return 'ok'; } catch (e) { return e.kind; } };
  let called = 0;
  ok(await kind(async () => { called++; return resp('{}'); }, 'https://evil.example/v1/forecast') === 'bad' && called === 0, 'any other URL is refused before a request');
  ok(await kind(async () => { called++; return resp('{}'); }, M.URL_FIXED + '&x=1') === 'bad' && called === 0, 'even the same host with other parameters is refused');
  ok(await kind(async () => { throw new TypeError('net::ERR_INTERNET_DISCONNECTED'); }) === 'net', 'no network → kind net');
  ok(await kind(async () => resp('', { status: 503 })) === 'http', 'HTTP 503 → kind http');
  ok(await kind(async () => resp('{not json')) === 'bad', 'not JSON → kind bad');
  ok(await kind(async () => resp('x', { len: '70000' })) === 'big', 'Content-Length over 64 KB → refused (big)');
  ok(await kind(async () => resp('', { stream: [new Uint8Array(40000), new Uint8Array(30000)] })) === 'big', 'streamed body over 64 KB → stopped at the cap (big)');
  ok(await kind(async () => resp('', { stream: [Buffer.from(JSON.stringify(body))] })) === 'ok', 'streamed body under the cap → ok');
  const t0 = Date.now();
  ok(await kind((url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted'))))) === 'timeout' && Date.now() - t0 >= 7900 && Date.now() - t0 < 9500, '8 s timeout → kind timeout (' + (Date.now() - t0) + ' ms)');
  // ---- validation ----
  const bad = (mut) => { const b = JSON.parse(JSON.stringify(body)); mut(b); try { M.normalize(b); return false; } catch (e) { return e.kind === 'bad'; } };
  ok(bad((b) => { b.current.temperature_2m = 'hot'; }) && bad((b) => { b.current.temperature_2m = 999; }) && bad((b) => { b.current.weather_code = 2.5; }) && bad((b) => { b.current.wind_direction_10m = 400; }), 'bad current values refused (type, range, integer code, direction)');
  ok(bad((b) => { b.hourly.time.pop(); }) && bad((b) => { b.hourly.time[3] = '<img>'; }) && bad((b) => { b.hourly.precipitation_probability[2] = 140; }) && bad((b) => { delete b.hourly; }), 'bad hourly values refused (lengths, time format, %)');
  { const b = JSON.parse(JSON.stringify(body)); b.hourly.precipitation_probability[1] = null; ok(M.normalize(b).hours[1].pop === 0, 'missing rain % (null) → 0'); }
  // ---- schedule + cache (fake clock and timers) ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx271-')); const cacheFile = path.join(dir, 'data', 'today271-cache.json');
  let clock = Date.parse('2026-11-25T12:10:00Z'); const timers = []; let mode = 'ok', calls = 0;
  const pluginFile = path.join(ROOT, 'app/plugins/eortologio/plugin.js');
  const mk = () => M.create({ now: () => clock, cacheFile, pluginFile, readFile: (f) => fs.readFileSync(f), setTimeout: (fn, ms) => { const t = { fn, at: clock + ms, ms }; timers.push(t); return t; }, clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    fetch: async () => { calls++; if (mode === 'net') throw new TypeError('offline'); return resp(JSON.stringify(FX.build(new Date(clock)))); } });
  const T = mk();
  ok(calls === 0 && timers.length === 0, 'nothing runs until a widget asks (no timer, no request)');
  let s = await T.get({ day: '2026-11-25' });
  ok(calls === 1 && s.ok && s.data.hours.length === 24 && s.fetchedAt === clock, 'first ask → one request, values returned');
  ok(timers.length === 1 && timers[0].ms === 1800000, 'next request planned in 30′', timers.map((x) => x.ms));
  ok(fs.existsSync(cacheFile) && JSON.parse(fs.readFileSync(cacheFile, 'utf8')).data.cur.t === 15.2, 'last values cached in data/today271-cache.json');
  s = await T.get({ day: '2026-11-25' }); ok(calls === 1, 'asking again (60 s repaint) does not fetch — cached');
  s = await T.get({ day: '2026-11-25', force: true }); ok(calls === 1, '«Ξανά» within 15 s of a request does not fetch again');
  mode = 'net'; clock += 1800000; { const t = timers.shift(); t.fn(); } await new Promise((r) => setTimeout(r, 5));
  s = T.status('2026-11-25'); ok(calls === 2 && s.ok && s.lastErr === 'net' && timers[0].ms === 600000, 'failure → keeps the last values, retry in 10′', { calls, e: s.lastErr, t: timers.map((x) => x.ms) });
  clock += 600000; { const t = timers.shift(); t.fn(); } await new Promise((r) => setTimeout(r, 5));
  ok(calls === 3 && timers[0].ms === 1800000, 'second failure → retry in 30′', timers.map((x) => x.ms));
  mode = 'ok'; clock += 1800000; { const t = timers.shift(); t.fn(); } await new Promise((r) => setTimeout(r, 5));
  s = T.status('2026-11-25'); ok(calls === 4 && s.lastErr === null && s.fetchedAt === clock && timers[0].ms === 1800000, 'back online → fresh values, every 30′ again');
  ok(timers.length === 1, 'one timer at a time');
  T.stop();
  const T2 = mk(); timers.length = 0; const before = calls; clock += 5 * 60000;
  s = await T2.get({ day: '2026-11-25' });
  ok(calls === before && s.ok && timers.length === 1 && timers[0].ms === 25 * 60000, 'restart with a fresh cache (5′ old) → no request, next in 25′', { c: calls - before, t: timers.map((x) => x.ms) });
  T2.stop();
  fs.writeFileSync(cacheFile, '{"v":1,"fetchedAt":1,"data":{"cur":{"t":"<script>"}}}');
  const T3 = mk(); ok(T3.status().ok === false, 'a broken / tampered cache is ignored'); T3.stop();
  // ---- name days: the unchanged Εορτολόγιο plugin ----
  const base = fs.readFileSync(pluginFile);
  ok(crypto.createHash('sha256').update(base).digest('hex') === '24bd682b9a0d659448d7f43595c6b6d1db8de05b455e6e3c9b21232d21de58d3', 'app/plugins/eortologio/plugin.js unchanged (same sha256 as 2.7.0)');
  ok(/Αικατερίνη/.test(T.status('2026-11-25').names) && T.status('2026-11-25').namesOk, '25/11 → Αικατερίνη', T.status('2026-11-25').names);
  ok(T.status('2026-11-21').names === '' && T.status('2026-11-21').namesOk, '21/11 → no entry (empty)');
  ok(/Ανδρέας/.test(T.status('2026-11-30').names), '30/11 → Ανδρέας');
  // ---- renderer (Variant C) ----
  const W = (c, d) => R.wmo(c, d);
  ok(W(0, 1)[0] === 'sun' && W(0, 0)[0] === 'moon' && W(2, 1)[0] === 'pcd' && W(2, 0)[0] === 'pcn' && W(3, 1)[0] === 'cloud' && W(45, 1)[0] === 'fog' && W(63, 1)[0] === 'rain' && W(73, 1)[0] === 'snow' && W(95, 1)[0] === 'storm' && W(99, 0)[0] === 'storm', 'WMO → icon (day / night)');
  const allCodes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  ok(allCodes.every((c) => EL[W(c, 1)[1]] && EN[W(c, 1)[1]] && EL[W(c, 1)[1]] !== '—'), 'every WMO code has a Greek and English text');
  ok(tr(W(2, 1)[1]) === 'Λίγα σύννεφα' && tr(W(0, 0)[1]) === 'Ξαστεριά' && tr(W(96, 1)[1]) === 'Καταιγίδα με χαλάζι', 'texts as the mockup (Λίγα σύννεφα, Ξαστεριά, Καταιγίδα με χαλάζι)');
  ok([[0, 'n'], [22.4, 'n'], [22.5, 'ne'], [90, 'e'], [180, 's'], [270, 'w'], [315, 'nw'], [359, 'n'], [360, 'n']].every(([d, k]) => R.dir8(d) === k) && tr('v271.d_' + R.dir8(315)) === 'ΒΔ', '8 wind directions (315° → ΒΔ)');
  const now = Date.parse('2026-11-25T14:20:00+02:00'); /* Athens wall clock, whatever the machine's zone */ const data = M.normalize(FX.build(now));
  const cells = R.strip(data.hours, now);
  ok(cells.length === 8 && cells[0].now && cells[1].label === '17:00' && cells[7].label === '11:00', '8 boxes every 3 hours from now (Τώρα, 17:00 … 11:00)', cells.map((c) => c.label));
  ok(cells[1].pop === 70 && cells[2].pop === 80 && cells[0].pop === 10, 'box rain % = highest of its three hours', cells.map((c) => c.pop));
  ok(cells[2].code === 95 && cells[0].t === 15, 'box icon + temperature = its first hour');
  const later = now + 4 * 3600000; ok(R.strip(data.hours, later)[0].label === '18:00' && R.strip(data.hours, later).length === 7, 'hours already past are dropped (stale data shows what is left)');
  ok(R.hourKey(Date.parse('2026-11-25T12:20:00Z')) === '2026-11-25T14:00' && R.hm(Date.parse('2026-11-25T12:05:00Z')) === '14:05' && R.hourKey(Date.parse('2026-07-01T12:00:00Z')) === '2026-07-01T15:00', '«Τώρα» / ΩΩ:ΛΛ on the Europe/Athens clock (winter +2, summer +3), like the answer');
  const st = (o) => ({ ok: true, data, fetchedAt: now - 5 * 60000, lastErr: null, nextAt: now + 25 * 60000, names: 'Αικατερίνη', ...o });
  let V = R.view(st(), now, true); ok(!V.down && !V.stale && !V.offline, 'fresh: normal');
  V = R.view(st({ fetchedAt: now - 61 * 60000 }), now, true); ok(V.stale && !V.down, 'over 60′ old → stale (dimmed)');
  V = R.view(st({ fetchedAt: now - 59 * 60000 }), now, true); ok(!V.stale, 'under 60′ → not stale');
  V = R.view(st({ lastErr: 'net' }), now, true); ok(V.offline && !V.down, 'last try had no network → «Χωρίς σύνδεση» with the last values');
  V = R.view(st(), now, false); ok(V.offline, 'navigator offline → «Χωρίς σύνδεση»');
  V = R.view({ ok: false, data: null, lastErr: 'http', nextAt: now + 10 * 60000 }, now, true); ok(V.down && V.retryMin === 10, 'no value → «Ο καιρός δεν ήρθε», retry in 10′');
  V = R.view(st({ fetchedAt: now - 25 * 3600000 }), now, true); ok(V.down, 'values older than a day are not shown');
  let P = R.parts(st(), { now, online: true }, tr);
  ok(/<b>15°<\/b> Λίγα σύννεφα <span class="t271-mu">· 12 km\/h ΒΔ<\/span>/.test(P.inl), 'header line: «15° Λίγα σύννεφα · 12 km/h ΒΔ»', P.inl);
  ok((P.body.match(/data-t271-cell/g) || []).length === 8 && /Τώρα/.test(P.body) && /Γιορτή<\/span><b>Αικατερίνη<\/b>/.test(P.body) && /Ενημέρωση 14:15/.test(P.body) && /Weather data by Open-Meteo\.com/.test(P.body), 'body: 8 boxes, Τώρα, Γιορτή Αικατερίνη, Ενημέρωση ΩΩ:ΛΛ, Open-Meteo credit');
  ok(!/°F|πυξίδα|compass|<canvas|<a /i.test(P.body + P.inl), 'no °F, no compass, no canvas, no link');
  P = R.parts(st({ names: '' }), { now, online: true }, tr); ok(/Δεν υπάρχει καταχώριση/.test(P.body), 'no name day → «Δεν υπάρχει καταχώριση»');
  P = R.parts(st({ fetchedAt: now - 90 * 60000 }), { now, online: true }, tr); ok(P.state === 'stale' && /Τελευταία διαθέσιμα · 12:50/.test(P.body) && /t271-dim/.test(P.inl) && /t271-wx t271-dim/.test(P.body), 'stale: dimmed + «Τελευταία διαθέσιμα · 12:50»');
  P = R.parts(st({ lastErr: 'net' }), { now, online: false }, tr); ok(/Χωρίς σύνδεση/.test(P.off) && (P.body.match(/data-t271-cell/g) || []).length === 8, 'offline: chip + last values');
  P = R.parts({ ok: false, nextAt: now + 10 * 60000, names: '' }, { now, online: true }, tr); ok(P.state === 'down' && /Ο καιρός δεν ήρθε/.test(P.body) && /data-act="w-retry"[^>]*>Ξανά/.test(P.body) && /Νέα προσπάθεια σε 10′/.test(P.body), 'down: «Ο καιρός δεν ήρθε» + «Ξανά»');
  P = R.parts(st({ names: '<img src=x onerror=1>' }), { now, online: true }, tr); ok(!/<img/.test(P.body), 'text is escaped');
  // ---- sizes, accent, no animation / timers / blur ----
  ok(WD.sizeFor('today', 's').w === 380 && WD.sizeFor('today', 'm').w === 480 && WD.sizeFor('today', 'l').w === 600 && WD.newItem('today').wsize === 'm', 'sizes S/M/L as Variant C, default M');
  ok(WD.sizeFor('calendar', 'l').w === 400 && WD.sizeFor('subs', 'm').w === 320 && WD.sizeFor('reminders', 'm').w === 320, 'other widgets keep their sizes');
  ok(R.ACC.nyx === '' && Object.keys(R.ACC).join() === 'nyx,teal,amber,rose', 'accent: Nyx (theme accent, default), teal, amber, rose');
  const srcR = fs.readFileSync(path.join(ROOT, 'app/js/v27/today271.js'), 'utf8'), css = fs.readFileSync(path.join(ROOT, 'app/v271.css'), 'utf8');
  ok(!/setInterval|setTimeout|requestAnimationFrame|<canvas|getContext/.test(srcR), 'renderer module: no timers, no animation frames, no canvas');
  ok(!/@keyframes/.test(css) && !/backdrop-filter:\s*(?!none)/.test(css) && !/(?<![-\w])filter:/.test(css) && !/transition:\s*(?!none)/.test(css), 'v271.css: no keyframes, no blur, no filter, no transitions');
  const guard = fs.readFileSync(path.join(ROOT, 'main/ipc-guard.js'), 'utf8');
  ok(/'app:today271': \['o\?'\]/.test(guard), 'one IPC entry in ipc-guard (app:today271)');
  console.log(`\nv2.7.1 unit: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ crashed: ' + (e && e.stack)); process.exit(1); });
