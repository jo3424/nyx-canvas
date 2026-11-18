// Nyx v2.4 unit tests (plain node): vs-engine server mode (fake engine), 429 / retry-after, Groq Whisper request.
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const listen = (srv) => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
(async () => {
  // v2.6.13.1: main/vsengine.js (vs-engine started hidden by Nyx) is removed — the vs-engine sections below only run on
  // versions that still have it; on 2.6.13.1+ the removal itself is checked (and tests/v26131-unit.js proves no spawn).
  const vsFile = path.join(__dirname, '..', 'main', 'vsengine.js'); const vs = fs.existsSync(vsFile) ? require(vsFile) : null;
  const ai = require('../main/ai');
  if (!vs) { console.log('vs-engine (removed in 2.6.13.1)'); ok(!fs.existsSync(vsFile), 'main/vsengine.js is gone — Nyx never starts vs-engine'); } else {
  console.log('vs-engine helpers');
  ok(vs.parsePort('[vs-engine] listening on http://127.0.0.1:51234') === 51234, 'port from "listening on http://…:N"');
  ok(vs.parsePort('Server started at 0.0.0.0:8080') === 8080 && vs.parsePort('port: 7860') === 7860, 'port from other common log lines');
  ok(vs.parsePort('loaded 12 layers in 3.2 s') === 0, 'no false port from unrelated numbers');
  const a = vs.args({ model: 'm.gguf', tokenizer: 't.gguf', device: 'Vulkan0', noFa: true, clampFp16: false }, 4567);
  ok(JSON.stringify(a) === JSON.stringify(['--model', 'm.gguf', '--codec', 't.gguf', '--device', 'Vulkan0', '--port', '4567', '--no-fa']), 'CLI = --model --codec --device --port [--no-fa]', a);
  const store = {}; const secrets = { get: (k) => store[k] || '', set: (k, v) => { store[k] = v; } };
  const tk = vs.token(secrets); ok(tk.length === 32 && /^[A-Za-z0-9]+$/.test(tk) && vs.token(secrets) === tk, 'random 32-char token, generated once and kept in secrets');
  const c = vs.candidates({ endpoint: 'POST /my/tts' }, 'γεια', ['POST /api/generate_speech']);
  ok(c[0].path === '/my/tts' && c[1].path === '/api/generate_speech' && c.some(x => x.path === '/v1/audio/speech'), 'user endpoint first, then discovered routes, then OpenAI /v1/audio/speech', c.map(x => x.path));

  console.log('vs-engine server (fake engine, real spawn)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-vs-')); const model = path.join(dir, 'omnivoice-base-Q8_0.gguf'), codec = path.join(dir, 'omnivoice-tokenizer-Q8_0.gguf');
  fs.writeFileSync(model, 'x'); fs.writeFileSync(codec, 'x'); process.env.FAKE_VS_ARGS = path.join(dir, 'args.json');
  const cfg = { exe: path.join(__dirname, 'fixtures', 'fake-vs-engine.js'), model, tokenizer: codec, device: 'Vulkan0', port: 0 };
  const st = await vs.start(cfg, secrets, { wait: 15000 });
  const seen = JSON.parse(fs.readFileSync(process.env.FAKE_VS_ARGS, 'utf8'));
  ok(st.running && st.port > 0, 'engine started hidden and answered on its port', st);
  ok(seen.tokenLen === 32 && seen.argv.includes('--codec') && seen.argv[seen.argv.indexOf('--device') + 1] === 'Vulkan0' && seen.argv.includes('--port'), 'VS_ENGINE_TOKEN passed in env + --codec/--device/--port', seen);
  ok(!st.cmd.includes(tk), 'token never appears in the shown command line');
  const pr = await vs.probe(secrets);
  ok(pr.auth === 'token' && pr.results.find(r => r.path === '/health')?.status === 200, 'probe: detects token auth and /health with Bearer', pr.results.map(r => r.path + ' ' + r.status));
  const out = path.join(dir, 'o.wav'); const sp = await vs.speak(cfg, secrets, 'Καλημέρα κόσμε', out, { report: true });
  ok(sp.ok && sp.endpoint === 'POST /v1/audio/speech' && fs.readFileSync(out).slice(0, 4).toString() === 'RIFF', 'speak: finds POST /v1/audio/speech and saves the WAV', sp);
  const sp2 = await vs.speak(cfg, secrets, 'δεύτερη', out, { report: true });
  ok(sp2.ok && sp2.tries.length === 1, 'second call uses the learned endpoint directly', sp2.tries);
  vs.stop(); await new Promise(r => setTimeout(r, 300)); ok(!vs.status().running, 'stop() ends the engine');
  // no token → the fake (like the real one) exits 2; our start() reports the real message
  const bad = { ...cfg, exe: path.join(dir, 'missing.exe') };
  let e1 = null; try { await vs.start(bad, secrets); } catch (e) { e1 = e; } ok(e1 && /vs-engine\.exe/.test(e1.message), 'missing exe → clear error');

  }
  console.log('Rate limits (429) + retry-after');
  ok(ai.parseWait('7') === 7 && Math.abs(ai.parseWait('2m59.56s') - 179.56) < 0.01 && Math.abs(ai.parseWait('7.66s') - 7.66) < 0.01 && ai.parseWait('250ms') === 0.25 && ai.parseWait('1h2m3s') === 3723, 'parses retry-after / x-ratelimit-reset formats');
  let hits = 0; const s429 = http.createServer((q, r) => { hits++; if (q.url.startsWith('/short') && hits === 1) { r.writeHead(429, { 'retry-after': '1', 'content-type': 'application/json' }); return r.end('{"error":{"message":"Rate limit reached"}}'); }
    if (q.url.startsWith('/long')) { r.writeHead(429, { 'x-ratelimit-reset-requests': '2m30s', 'content-type': 'application/json' }); return r.end('{"error":{"message":"Rate limit reached for model llama-3.3-70b-versatile on requests per day (RPD)"}}'); }
    r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"data":[{"id":"llama-3.3-70b-versatile"}]}'); });
  const P = await listen(s429);
  const t0 = Date.now(); const j = await ai.jfetch(`http://127.0.0.1:${P}/short`, {}, 10000);
  ok(j.data && hits === 2 && Date.now() - t0 >= 1000, 'short 429 → waits retry-after and retries by itself', { hits, ms: Date.now() - t0 });
  let e2 = null; try { await ai.jfetch(`http://127.0.0.1:${P}/long`, {}, 10000); } catch (e) { e2 = e; }
  ok(e2 && e2.code === 'rate' && e2.status === 429 && /150/.test(e2.message) && /RPD|Rate limit/.test(e2.message), 'long 429 → clear message with seconds to wait, no endless retry', e2 && e2.message);
  s429.close();

  console.log('Groq Whisper STT');
  let e3 = null; try { await ai.transcribe({ kind: 'groq', language: 'el' }, Buffer.alloc(100), 'a.wav'); } catch (e) { e3 = e; }
  ok(e3 && e3.code === 'config', 'no Groq key → clear message (no request sent)', e3 && e3.message);
  const ps = new Function('return ' + fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'v2', 'core.js'), 'utf8').match(/\{ id: 'groq'[^\n]*\}/)[0])();
  ok(ps.base === 'https://api.groq.com/openai/v1' && ps.keyRef === 'key:groq' && ps.defModel === 'llama-3.3-70b-versatile', 'Groq provider preset (OpenAI-compatible base, key in safeStorage, default chat model)', ps);

  console.log(`\n${passes} passed, ${fails} failed`); console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
