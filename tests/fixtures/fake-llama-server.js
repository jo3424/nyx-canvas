#!/usr/bin/env node
// Fake llama-server for tests: -m <gguf> --port N; /health, /v1/models, /v1/chat/completions (echoes which model answered).
const http = require('http'), fs = require('fs'), path = require('path');
const a = process.argv.slice(2); const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const model = arg('-m'); if (!model || !fs.existsSync(model)) { console.error('error: failed to load model ' + model); process.exit(1); }
if (process.env.FAKE_LLAMA_LOG) fs.appendFileSync(process.env.FAKE_LLAMA_LOG, JSON.stringify({ argv: a, at: Date.now() }) + '\n');
const name = path.basename(model);
const srv = http.createServer((q, r) => {
  const j = (o, s = 200) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.url === '/health') return j({ status: 'ok' });
  if (q.url === '/v1/models') return j({ data: [{ id: name }] });
  if (q.method === 'POST' && q.url === '/v1/chat/completions') { let b = ''; q.on('data', d => b += d); q.on('end', () => { let p = {}; try { p = JSON.parse(b); } catch (e) {} const last = (p.messages || []).filter(m => m.role === 'user').pop(); const sys = (p.messages || []).find(m => m.role === 'system');
    const text = `[${name}] ${typeof last?.content === 'string' ? last.content : 'ok'}` + (sys && /private|ιδιωτικ/i.test(sys.content) ? ' (private)' : '');
    if (p.stream) { r.writeHead(200, { 'content-type': 'text/event-stream' }); r.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n'); r.end('data: [DONE]\n\n'); }
    else j({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], model: name }); }); return; }
  j({ error: 'not found' }, 404);
});
setTimeout(() => srv.listen(+arg('--port') || 8080, '127.0.0.1', () => console.log('main: server is listening on http://127.0.0.1:' + srv.address().port)), 400);
