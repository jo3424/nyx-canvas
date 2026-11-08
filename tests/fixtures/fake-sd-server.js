#!/usr/bin/env node
// Fake stable-diffusion.cpp sd-server for tests: --model-dir/--lora-model-dir/--listen-port; web UI root + /sdapi/v1/txt2img (returns a PNG).
const http = require('http'), fs = require('fs'), zlib = require('zlib');
const a = process.argv.slice(2); const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const LOG = process.env.FAKE_SD_LOG || '/tmp/fake-sd.json'; const log = { argv: a, prompts: [] }; const save = () => fs.writeFileSync(LOG, JSON.stringify(log));
save();
function png(w, h) { const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 40 + x * 200 / w; raw[o + 1] = 90 + y * 120 / h; raw[o + 2] = 160; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
const srv = http.createServer((q, r) => {
  if (q.method === 'GET' && (q.url === '/' || q.url === '/index.html')) { r.writeHead(200, { 'content-type': 'text/html' }); return r.end('<!doctype html><title>sd-server</title><h1>sd.cpp web UI (fake)</h1>'); }
  if (q.method === 'POST' && q.url === '/sdapi/v1/txt2img') { let b = ''; q.on('data', d => b += d); q.on('end', () => { let p = {}; try { p = JSON.parse(b); } catch (e) {} log.prompts.push(p); save();
    r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ images: [png(Math.min(256, p.width || 256), Math.min(256, p.height || 256)).toString('base64')], parameters: p })); }); return; }
  r.writeHead(404); r.end('not found');
});
setTimeout(() => srv.listen(+arg('--listen-port') || 7860, arg('--listen-ip') || '127.0.0.1', () => console.log('[INFO] listening on: ' + srv.address().port)), 300);
