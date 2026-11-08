#!/usr/bin/env node
// Fake vs-engine for tests: same CLI + token rule as the real one; an invented API (only /v1/audio/speech + /health).
const http = require('http');
const a = process.argv.slice(2); const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const tk = process.env.VS_ENGINE_TOKEN || '';
if (tk.length < 16) { console.error('Requires VS_ENGINE_TOKEN in the environment (>= 16 chars).'); process.exit(2); }
if (!arg('--model') || !arg('--codec')) { console.error('usage: vs-engine.exe --model <gguf> --codec <gguf> [--device Vulkan0|CPU|...] [--port 0] [--no-fa] [--clamp-fp16]'); process.exit(2); }
require('fs').writeFileSync(process.env.FAKE_VS_ARGS || '/tmp/fake-vs-args.json', JSON.stringify({ argv: a, tokenLen: tk.length }));
function wav(n = 8000) { const b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2); return b; }
const srv = http.createServer((q, r) => {
  const auth = q.headers.authorization === 'Bearer ' + tk;
  if (!auth) { r.writeHead(401, { 'content-type': 'application/json' }); return r.end('{"error":"unauthorized"}'); }
  if (q.url === '/health') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"status":"ok","model":"omnivoice"}'); }
  if (q.method === 'POST' && q.url === '/v1/audio/speech') { let body = ''; q.on('data', d => body += d); q.on('end', () => { let j = {}; try { j = JSON.parse(body); } catch (e) {} if (!j.input) { r.writeHead(400); return r.end('no input'); } r.writeHead(200, { 'content-type': 'audio/wav' }); r.end(wav()); }); return; }
  r.writeHead(404, { 'content-type': 'text/plain' }); r.end('not found');
});
const port = +arg('--port') || 0;
setTimeout(() => srv.listen(port, '127.0.0.1', () => console.log(`[vs-engine] model loaded · listening on http://127.0.0.1:${srv.address().port}`)), 300);
