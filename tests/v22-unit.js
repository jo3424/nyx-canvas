'use strict';
// v2.2 unit tests: AI provider connection diagnostics (localhost→127.0.0.1, missing /v1, refused/timeout/HTTP),
// file finder, local-server prechecks (missing exe/model, busy port, early exit), TTS command building. node tests/v22-unit.js
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), net = require('net');
const ai = require('../main/ai'); const finder = require('../main/finder'); const procs = require('../main/procs'); const i18n = require('../main/i18n');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); c ? passes++ : fails++; };
const greek = (s) => /[\u0370-\u03ff]/.test(s);
const listen = (srv, host) => new Promise((r, j) => { srv.once('error', j); srv.listen(0, host, () => r(srv.address().port)); });
const freePort = async () => { const s = net.createServer(); const p = await listen(s, '127.0.0.1'); await new Promise(r => s.close(r)); return p; };

(async () => {
  console.log('AI providers — errors & fallbacks');
  ok(ai.netCode({ cause: { code: 'ECONNREFUSED' } }) === 'refused', 'ECONNREFUSED → refused');
  ok(ai.netCode({ name: 'AbortError' }) === 'timeout', 'AbortError → timeout');
  ok(ai.netCode({ cause: { code: 'ENOTFOUND' } }) === 'dns', 'ENOTFOUND → dns');
  ok(ai.netCode({ cause: { code: 'ECONNRESET' } }) === 'reset', 'ECONNRESET → reset');
  const m = ai.netMessage('refused', 'http://localhost:1234/v1/models'); ok(greek(m) && m.includes('localhost:1234') && !/\{v\d\}/.test(m), 'refused message is Greek and names host:port', m);
  ok(JSON.stringify(ai.baseVariants('http://localhost:1234/v1')) === JSON.stringify(['http://localhost:1234/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:1234/v1']), 'localhost → also 127.0.0.1 and [::1]', ai.baseVariants('http://localhost:1234/v1'));
  ok(ai.baseVariants('http://0.0.0.0:8080/v1').includes('http://127.0.0.1:8080/v1'), '0.0.0.0 → 127.0.0.1');
  ok(/Start Server/.test(ai.hintFor({ id: 'lmstudio', base: 'http://localhost:1234/v1' }, 'refused')) && /lms server start/.test(ai.hintFor({ id: 'lmstudio', base: 'http://localhost:1234/v1' }, 'refused')), 'LM Studio hint: Developer → Start Server / lms server start');
  ok(/ollama serve/.test(ai.hintFor({ id: 'ollama', base: 'http://localhost:11434/v1' }, 'refused')), 'Ollama hint');
  ok(/llama-server/.test(ai.hintFor({ id: 'llama', base: 'http://127.0.0.1:8080/v1' }, 'refused')), 'llama-server hint');

  // stub OpenAI server on IPv4 only, models under /v1 only
  let hits = [];
  const srv = http.createServer((q, r) => { hits.push(q.url); if (q.url === '/v1/models') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ data: [{ id: 'qwen3-8b' }, { id: 'text-embedding-nomic' }] })); } if (q.url === '/v1/key/v1/models' || q.url === '/key/models') { r.statusCode = 401; return r.end('{"error":"bad key"}'); } r.statusCode = 404; r.end('not found'); });
  const port = await listen(srv, '127.0.0.1');
  let r = await ai.ping({ id: 'lmstudio', base: `http://localhost:${port}/v1` });
  ok(r.ok && r.count === 2, 'localhost base works against an IPv4-only server', r);
  r = await ai.ping({ id: 'custom', base: `http://127.0.0.1:${port}` });
  ok(r.ok && r.fixed === `http://127.0.0.1:${port}/v1`, 'missing /v1 → found and reported as fix', r);
  hits = []; r = await ai.ping({ id: 'custom', base: `http://127.0.0.1:${port}` }); ok(r.ok && hits.length === 1, 'working base cached (1 request on the next ping)', hits);
  r = await ai.ping({ id: 'custom', base: `http://127.0.0.1:${port}/key` });
  ok(!r.ok && r.status === 401 && greek(r.error) && /API key/.test(r.error), '401 → «λάθος API key», not "server not answering"', r);
  const dead = await freePort();
  r = await ai.ping({ id: 'lmstudio', base: `http://localhost:${dead}/v1` });
  ok(!r.ok && r.code === 'refused' && greek(r.error) && /Start Server/.test(r.hint) && r.ms < 5000, 'nothing listening → refused + LM Studio hint, fast', r);
  r = await ai.ping({ id: 'x', base: 'localhost:1234' }); ok(!r.ok && /http:\/\//.test(r.error), 'URL without http:// → explicit message', r);
  const slow = net.createServer(() => {}); const sp = await listen(slow, '127.0.0.1');
  const t0 = Date.now(); r = await ai.ping({ id: 'llama', base: `http://127.0.0.1:${sp}/v1` });
  ok(!r.ok && r.code === 'timeout' && Date.now() - t0 < 6000, 'hung local server → timeout in ≤4 s (not 30 s)', { r, ms: Date.now() - t0 });
  slow.close(); srv.close();

  console.log('File finder');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Νέος φάκελος ')); const big = Buffer.alloc(1.5 * 1024 * 1024);
  const mk = (rel, buf = big) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return p; };
  const wh = mk('GPU Voice Studio/third_party/whisper.cpp/build/models/ggml-large-v3-turbo-q5_0.bin'); mk('x/ggml-base.bin'); mk('x/ggml-silero-vad.bin'); mk('x/tiny.bin');
  mk('node_modules/ggml-large-v3-turbo-q5_0.bin'); mk('models/Qwen3-8B-Q4_K_M.gguf'); mk('models/mmproj-qwen.gguf'); mk('ov/omnivoice-base-Q8_0.gguf'); mk('ov/omnivoice-tokenizer-Q8_0.gguf'); mk('ov/bin/omnivoice-tts.exe', Buffer.from('MZ'));
  let f = await finder.find({ kind: 'whisper', want: 'C:\\GVS\\third_party\\whisper.cpp\\models\\ggml-large-v3-turbo-q5_0.bin', roots: [root] });
  ok(f.files[0]?.path === wh && f.files[0].score >= 1000, 'whisper model found by exact name in a Greek path with spaces', f.files);
  ok(!f.files.some(x => /silero|node_modules|tiny/.test(x.path)), 'skips VAD, node_modules and tiny files', f.files.map(x => x.path));
  f = await finder.find({ kind: 'llama', roots: [root] }); ok(f.files.length === 1 && /Qwen3/.test(f.files[0].name), 'llama: LLM gguf only (no mmproj / omnivoice)', f.files.map(x => x.name));
  f = await finder.find({ kind: 'tts-model', roots: [root] }); ok(f.files.length === 1 && /base/.test(f.files[0].name), 'TTS model');
  f = await finder.find({ kind: 'tts-tokenizer', roots: [root] }); ok(f.files.length === 1 && /tokenizer/.test(f.files[0].name), 'TTS tokenizer');
  f = await finder.find({ kind: 'exe', names: ['omnivoice-tts.exe'], roots: [root] }); ok(f.files[0]?.name === 'omnivoice-tts.exe', 'exe by name');
  f = await finder.find({ kind: 'gguf', roots: [root], maxEntries: 3 }); ok(f.scanned <= 40 && f.truncated, 'bounded scan (entry limit)', f);

  console.log('Local servers');
  let e = procs.precheck('whisper', { exe: path.join(root, 'nope.exe'), model: wh }); ok(e && e.field === 'exe' && greek(e.message), 'missing exe → field exe, Greek', e && e.message);
  e = procs.precheck('whisper', { exe: process.execPath, model: path.join(root, 'none.bin') }); ok(e && e.field === 'model' && e.message.includes('none.bin'), 'missing model → field model with the path', e && e.message);
  e = procs.precheck('llama', { exe: root, model: wh }); ok(e && e.field === 'exe', 'folder as exe rejected');
  ok(procs.precheck('llama', { exe: process.execPath, model: wh }) == null, 'valid paths pass');
  const busy = net.createServer(); const bp = await listen(busy, '127.0.0.1');
  ok(await procs.portBusy(bp) === true && await procs.portBusy(await freePort()) === false, 'portBusy');
  try { await procs.start('llama', { exe: process.execPath, model: wh, port: bp }, () => {}); ok(false, 'busy port must throw'); } catch (err) { ok(/θύρα|port/i.test(err.message) && err.message.includes(String(bp)), 'busy port → clear message', err.message); }
  busy.close();
  // early exit: node with unknown flags exits immediately
  try { await procs.start('llama', { exe: process.execPath, model: wh, port: await freePort() }, () => {}, { settleMs: 2500 }); ok(false, 'early exit must throw'); }
  catch (err) { ok(/σταμάτησε/.test(err.message), 'server that exits immediately → error with its last log lines', err.message.slice(0, 200)); }
  procs.stopAll && procs.stopAll();

  console.log('TTS');
  ok(!/["%\n]/.test(ai.cmdQuote('a"b%PATH%\nc').slice(1, -1)), 'cmdQuote strips quotes, % and newlines', ai.cmdQuote('a"b%PATH%\nc'));
  const cmd = ai.buildTtsCmd({ exe: 'C:\\Program Files\\ov\\omnivoice-tts.exe', model: 'C:\\m\\base.gguf', tokenizer: 'C:\\m\\tok.gguf', template: '{exe} --model {model} --codec {tokenizer} --lang Greek -o {out} < {text_file}' }, 'Γεια', 'C:\\t\\o.wav', 'C:\\t\\in.txt');
  ok(/^"C:\\Program Files\\ov\\omnivoice-tts.exe" --model "C:\\m\\base.gguf" --codec "C:\\m\\tok.gguf" --lang Greek -o "C:\\t\\o.wav" < "C:\\t\\in.txt"$/.test(cmd), 'omnivoice.cpp template builds a quoted command', cmd);
  r = await ai.tts({ exe: path.join(root, 'missing.exe'), template: '{exe}' }, 'x', root, { report: true });
  ok(r && r.ok === false && greek(r.error), 'TTS test with a missing exe → Greek error, no crash', r);

  // real run with a fake engine (node script) that writes the wav and prints to stderr
  const eng = mk('engine/fake-tts.js', Buffer.from("const fs=require('fs');const a=process.argv;const o=a[a.indexOf('-o')+1];console.error('loading model '+a[a.indexOf('--model')+1]);if(a.includes('--fail')){console.error('error: unknown option --fail');process.exit(2)}fs.writeFileSync(o,'RIFF')"));
  const T = { exe: process.execPath, model: wh, tokenizer: wh, template: `{exe} ${ai.cmdQuote(eng)} --model {model} -o {out} < {text_file}` };
  r = await ai.tts(T, 'Γεια σου', root, { report: true }); ok(r.ok && fs.existsSync(r.file) && /loading model/.test(r.stderr), 'TTS «Δοκιμή»: runs, returns file + stderr', r);
  r = await ai.tts({ ...T, template: T.template + ' --fail' }, 'x', root, { report: true }); ok(!r.ok && /unknown option --fail/.test(r.stderr) && r.cmd, 'TTS «Δοκιμή» failure shows the engine stderr', r);
  console.log('i18n');
  i18n.setLang('en'); ok(!greek(ai.netMessage('refused', 'http://localhost:1234')) && !greek(ai.hintFor({ id: 'lmstudio', base: 'http://localhost:1234/v1' }, 'refused')), 'English mode messages have no Greek'); i18n.setLang('el');

  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
