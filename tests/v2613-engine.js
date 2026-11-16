'use strict';
// v2.6.13 «φωνή ster» — engine choice + sentence queue against FAKE HTTP servers (Node http on 127.0.0.1):
//  A) 7802 /v1/status = 200 → Hermes's OmniVoice is used, the own vs-engine is NOT started (spy)
//  B) 7802 = 401 → own vs-engine on ANOTHER port, log «7802 refused (401); starting own vs-engine on port N» (no token)
//  C) nothing on 7802 → own vs-engine
//  D) Hermes dies in the middle of an answer → error for that sentence, the rest skipped, nothing started during the
//     answer; the probe runs again at the next answer
//  E) requests reach the server ONE at a time; sentence N plays while N+1 is synthesised
//  F) stop cancels the request in flight;  G) 400 bad_reference / 401 on synthesize → clear codes
//  H) no token, voice code or reference text in any log line, console output or error
const http = require('http'), path = require('path'), fs = require('fs');
const R = process.env.NYX_ROOT || path.join(__dirname, '..');
const VM = require(path.join(R, 'main/voice2613.js'));
const NV = require(path.join(R, 'app/js/v26/voice2613.js'));
let passes = 0, fails = 0;
const ok = (c, m, x) => { process.stdout.write((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 700) : '') + '\n'); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HT = 'HERMES-TOKEN-SECRET-7802-abcdef0123', OT = 'OWN-VS-TOKEN-SECRET-0123456789ab';
const FX = path.join(__dirname, 'fixtures', 'personas-ster.json'); const fx = JSON.parse(fs.readFileSync(FX, 'utf8'));
const DUMMY = fx[0].voice.rvq.b64, REF = fx[0].voice.refText;
const SECRETS = [HT, OT, DUMMY, REF];
// capture console output of this process (main logs go through console.log)
const consoleOut = []; const ol = console.log, oe = console.error;
const tap = (on) => { if (on) { console.log = (...a) => { consoleOut.push(a.join(' ')); }; console.error = (...a) => { consoleOut.push(a.join(' ')); }; } else { console.log = ol; console.error = oe; } };
const wav = () => { const b = Buffer.alloc(44 + 2400); b.write('RIFF', 0); b.writeUInt32LE(36 + 2400, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(2400, 40); return b; };
// fake vs-engine / OmniVoice server
function fake(port, o = {}) {
  const S = { port, status: 0, synth: [], active: 0, maxActive: 0, sockets: new Set(), t0: Date.now() };
  const srv = http.createServer((q, res) => {
    let body = ''; q.on('data', (d) => { body += d; }); q.on('end', async () => {
      const auth = q.headers.authorization || '';
      if (q.method === 'GET' && q.url === '/v1/status') { S.status++; if (o.statusCode) { res.writeHead(o.statusCode); return res.end('{}'); } if (auth !== 'Bearer ' + o.token) { res.writeHead(401); return res.end('{"error":"unauthorized"}'); } res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
      if (q.method === 'POST' && q.url === '/v1/synthesize') {
        if (auth !== 'Bearer ' + o.token) { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
        let j = {}; try { j = JSON.parse(body); } catch (e) {}
        const rec = { body: j, start: Date.now() - S.t0, end: 0 }; S.synth.push(rec); S.active++; S.maxActive = Math.max(S.maxActive, S.active);
        if (o.onSynth) o.onSynth(S, rec, res);
        if (res.writableEnded || res.destroyed) { S.active--; return; }
        if (j.ref_rvq_b64 && !j.ref_text) { S.active--; res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":{"code":"bad_reference"}}'); }
        if (o.badRef) { S.active--; res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":{"code":"bad_reference"}}'); }
        await sleep(o.delay || 60); rec.end = Date.now() - S.t0; S.active--;
        if (res.destroyed) return; res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(wav());
      }
      res.writeHead(404); res.end();
    });
  });
  srv.on('connection', (s) => { S.sockets.add(s); s.on('close', () => S.sockets.delete(s)); });
  S.close = () => new Promise((r) => { srv.close(() => r()); for (const s of S.sockets) s.destroy(); });
  return new Promise((res, rej) => { srv.once('error', rej); srv.listen(port, '127.0.0.1', () => { S.port = srv.address().port; res(S); }); });
}
// stub of main/vsengine.js: start() = spy; it «starts» a fake own engine on a random port (never 7802)
function vsStub(o = {}) {
  const st = { starts: 0, cfgPorts: [], own: null, running: false, stops: 0 };
  st.api = {
    token: () => OT,
    status: () => ({ running: st.running, port: st.own && st.own.port }),
    stop: () => { st.stops++; st.running = false; },
    start: async (cfg) => { st.starts++; st.cfgPorts.push(cfg.port); if (!st.own) st.own = await fake(0, { token: OT, delay: o.delay || 40, badRef: o.badRef }); st.running = true; return { running: true, port: st.own.port }; },
  };
  return st;
}
const lines = [];
const mk = (vs, env = { OMNIVOICE_HERMES_TOKEN: HT }) => VM.create({ vsengine: vs.api, secrets: {}, env, log: (s) => { lines.push(s); console.log('[voice] ' + s); } });
const tmpOut = (n) => path.join(require('os').tmpdir(), 'nyx2613e-' + process.pid + '-' + n + '.wav');
let outN = 0;
const opts = { file: FX };
async function answer(eng, cfg, voice, parts, playMs = 120) {
  const b = await eng.begin(cfg, voice, opts); if (!b.ok) return { b };
  const plays = []; const errors = [];
  const r = await NV.pipeline(parts, {
    isCancelled: () => false,
    synth: (i, s) => eng.speak(b.msg, s, 'el', tmpOut(outN++)),
    play: async (file, i) => { const p = { i, start: Date.now(), end: 0 }; plays.push(p); await sleep(playMs); p.end = Date.now(); },
    onError: (i, x) => errors.push({ i, code: x.code }),
  });
  return { b, r, plays, errors };
}

(async () => {
  tap(true);
  const out = [];
  // ---- A) 200 → Hermes, no spawn ----
  let H = await fake(7802, { token: HT, delay: 80 }).catch((e) => null);
  if (!H) { tap(false); console.log('port 7802 busy on this machine — cannot run'); process.exit(2); }
  let vs = vsStub(); let eng = mk(vs);
  const parts = NV.splitSentences('Καλημέρα σας. Το εισιτήριο κοστίζει 19,90 €. Η πτήση φεύγει στις 09:45. Φέρτε διαβατήριο κ.λπ. και βίζα.');
  const t0 = Date.now(); let A = await answer(eng, { port: '' }, '', parts, 150);
  out.push(['A', A.b.ok, A.b.engine, vs.starts, H.status, H.synth.length, H.maxActive]);
  ok(A.b.ok && A.b.engine.kind === 'hermes' && A.b.engine.port === 7802 && H.status === 1, 'A) 7802 /v1/status 200 (Bearer OMNIVOICE_HERMES_TOKEN) → Hermes OmniVoice in use', A.b);
  ok(vs.starts === 0, 'A) the own vs-engine was NOT started (spawn spy = 0)', vs.starts);
  ok(parts.length === 4 && H.synth.length === 4 && A.r.played === 4, 'A) 4 sentences (19,90 / 09:45 / κ.λπ. not cut) → 4 requests to 7802, 4 played', { parts, n: H.synth.length });
  const b0 = H.synth[0].body;
  ok(b0.ref_rvq_b64 === DUMMY && b0.ref_text === REF && b0.steps === 48 && b0.guidance_scale === 2.5 && b0.language === 'el' && b0.text === parts[0], 'A) body: ster ref_rvq_b64 + ref_text + steps 48 + guidance_scale 2.5 + language el');
  { const vr = vsStub(); vr.running = true; const er = mk(vr); lines.length = 0; const br = await er.begin({}, 'ster', opts);
    ok(br.ok && br.engine.kind === 'hermes' && vr.stops === 1 && vr.starts === 0 && lines.some((l) => /own vs-engine stopped \(one engine on the GPU\)/.test(l)), 'A) an own vs-engine left running from before is stopped when Hermes is used (one engine on the GPU)', { stops: vr.stops, lines }); }
  // ---- E) one at a time + overlap ----
  ok(H.maxActive === 1, 'E) the server never had 2 requests at once (max concurrent = 1)', H.maxActive);
  const sy = H.synth.map((x) => ({ start: x.start + H.t0, end: x.end + H.t0 }));
  const serial = sy.every((x, i) => i === 0 || x.start >= sy[i - 1].end - 2);
  const overlap = A.plays.slice(0, -1).every((p, i) => sy[i + 1].start < p.end && sy[i + 1].start >= p.start - 30);
  ok(serial, 'E) each request starts after the previous one finished (serial on the GPU)', sy.map((x) => [x.start - t0, x.end - t0]));
  ok(overlap, 'E) sentence N+1 is synthesised WHILE sentence N plays', { plays: A.plays.map((p) => [p.start - t0, p.end - t0]), synth: sy.map((x) => [x.start - t0, x.end - t0]) });
  ok(A.plays.every((p, i) => i === 0 || p.start >= A.plays[i - 1].end - 2), 'E) playback is in order, one after the other');
  // parallel calls straight to the queue (two windows / a quick second answer) still reach the server one at a time
  H.maxActive = 0; const b2 = await eng.begin({}, 'ster', opts);
  await Promise.all([1, 2, 3, 4, 5].map((k) => eng.speak(b2.msg, 'Πρόταση ' + k + '.', 'el', tmpOut(outN++))));
  ok(H.maxActive === 1, 'E) 5 parallel speak() calls → still one request at a time', H.maxActive);
  // ---- F) cancel ----
  const H2slow = H; H2slow.synth.length = 0; const b3 = await eng.begin({}, 'ster', opts);
  const slowEng = mk(vs); // same server, but cancel while in flight on a 1.5 s request
  await H.close(); H = await fake(7802, { token: HT, delay: 1500 });
  const b4 = await slowEng.begin({}, 'ster', opts); const tc = Date.now(); const pr = slowEng.speak(b4.msg, 'Αργή πρόταση.', 'el', tmpOut(outN++)); await sleep(150); slowEng.cancel(); const rc = await pr;
  ok(rc.code === 'cancelled' && Date.now() - tc < 1000, 'F) stop cancels the request in flight (no wait for the GPU)', { rc, ms: Date.now() - tc });
  await H.close();
  // ---- B) 401 → own engine on another port ----
  H = await fake(7802, { token: 'SOMETHING-ELSE-not-our-token' });
  vs = vsStub(); eng = mk(vs); lines.length = 0;
  let B = await answer(eng, { port: '7802' }, 'ster', ['Πρώτη.', 'Δεύτερη.']);
  ok(B.b.ok && B.b.engine.kind === 'own' && B.b.engine.port !== 7802 && vs.starts === 1, 'B) 7802 → 401 → own vs-engine started once, on another port', { e: B.b.engine, starts: vs.starts });
  ok(vs.cfgPorts[0] === '', 'B) a configured --port 7802 is not used (Hermes owns it) → automatic port', vs.cfgPorts);
  const refl = lines.find((l) => /^7802 refused \(401\); starting own vs-engine on port \d+$/.test(l));
  ok(!!refl && refl.endsWith(String(B.b.engine.port)), 'B) log: «7802 refused (401); starting own vs-engine on port N»', lines);
  ok(H.synth.length === 0 && vs.own.synth.length === 2 && B.r.played === 2, 'B) synthesis went to the own engine (with its own token), not to 7802');
  await H.close();
  // ---- C) down → own engine ----
  vs = vsStub(); eng = mk(vs); lines.length = 0;
  let C = await answer(eng, {}, 'ster', ['Μία πρόταση.']);
  ok(C.b.ok && C.b.engine.kind === 'own' && vs.starts === 1 && C.r.played === 1, 'C) nothing on 7802 → own vs-engine (as before)', C.b);
  ok(lines.some((l) => /^7802 no answer \(.+\); starting own vs-engine on port \d+$/.test(l)), 'C) log: «7802 no answer (…); starting own vs-engine on port N»', lines);
  vs = vsStub(); eng = mk(vs, {}); lines.length = 0;
  const C2 = await eng.begin({}, 'ster', opts);
  ok(C2.ok && C2.engine.kind === 'own' && lines.some((l) => /OMNIVOICE_HERMES_TOKEN not set/.test(l)), 'C) no OMNIVOICE_HERMES_TOKEN → own vs-engine, logged');
  // ---- D) Hermes dies in the middle of an answer ----
  H = await fake(7802, { token: HT, delay: 60, onSynth: (S, rec, res) => { if (S.synth.length === 2) { res.socket.destroy(); S.close(); } } });
  vs = vsStub(); eng = mk(vs); lines.length = 0;
  let D = await answer(eng, {}, 'ster', ['Ένα.', 'Δύο.', 'Τρία.', 'Τέσσερα.'], 80);
  ok(D.b.engine.kind === 'hermes' && D.r.played === 1, 'D) sentence 1 played from Hermes', D.r);
  ok(D.errors.length === 1 && D.errors[0].i === 1 && D.errors[0].code === 'engine_down', 'D) sentence 2: UI error «engine_down» (one message)', D.errors);
  ok(D.r.skipped === 2, 'D) sentences 3–4 of that answer skipped (no silent switch)', D.r);
  ok(vs.starts === 0, 'D) no own vs-engine started during that answer (spawn spy = 0), no retry on another engine', vs.starts);
  ok(lines.some((l) => /stopped answering during an answer/.test(l)), 'D) logged', lines);
  const before = H.status; const D2 = await eng.begin({}, 'ster', opts);
  ok(D2.ok && D2.probe.state === 'down' && D2.engine.kind === 'own' && vs.starts === 1, 'D) next answer: the probe runs again (7802 down now) → own vs-engine', D2);
  // ---- G) error codes from the engine ----
  vs = vsStub({ badRef: true }); eng = mk(vs);
  const G = await answer(eng, {}, 'ster', ['Α.']); ok(G.errors[0] && G.errors[0].code === 'bad_reference', 'G) 400 bad_reference → code bad_reference', G.errors);
  H = await fake(7802, { token: HT }); vs = vsStub(); eng = mk(vs); const g2 = await eng.begin({}, 'ster', opts); await H.close();
  H = await fake(7802, { token: 'changed-token-xxxxxxxx', statusCode: 0 }); const g3 = await eng.speak(g2.msg, 'Β.', 'el', tmpOut(outN++));
  ok(g3.code === 'engine_token', 'G) 401 on /v1/synthesize → engine_token', g3); await H.close();
  // ---- H) secrets never in logs ----
  tap(false);
  const all = lines.concat(consoleOut, JSON.stringify(out), JSON.stringify([A, B, C, D, G, g3].map((x) => x && (x.b || x))));
  const leak = SECRETS.filter((s) => all.some((l) => String(l).includes(s)));
  ok(leak.length === 0, `H) no token / voice code / reference text in ${all.length} log lines, console output, results`, leak.map((s) => s.slice(0, 6) + '…'));
  ok(consoleOut.some((l) => l.startsWith('[voice] 7802 refused (401)')), 'H) the main log really has the engine lines (so the check above is not empty)');
  if (process.env.NYX_LOG_OUT) fs.writeFileSync(process.env.NYX_LOG_OUT, consoleOut.join('\n') + '\n');
  await vs.own?.close?.();
  console.log(`\nv2.6.13 engine: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { tap(false); console.error(e); process.exit(2); });
