// Mock web for the assistant web-agent tests: a search engine (localhost) + content site (127.0.0.1) + an OpenAI-compatible LLM.
// Engine pages live on "localhost", content on "127.0.0.1", so result links are "other host" like a real engine.
const http = require('http'), zlib = require('zlib'), fs = require('fs');
function png(w, h, seed = 1) {
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); let r = seed * 7919;
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { r = (r * 1103515245 + 12345) & 0x7fffffff; const o = y * (w * 3 + 1) + 1 + x * 3; const n = r % 40; raw[o] = 30 + n + (seed * 20) % 60; raw[o + 1] = 90 + (y * 120 / h | 0) + n; raw[o + 2] = 40 + (x * 80 / w | 0) + n; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function start({ video, slow = 0 } = {}) {
  const log = { hits: [], llm: [] }; const imgs = {};
  const img = (n) => imgs[n] ||= png(820, 520, n);
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x'); log.hits.push(q.headers.host + u.pathname + (q.headers.referer ? ' <' + q.headers.referer : ''));
    const H = (s, ty, b) => { r.writeHead(s, { 'content-type': ty }); r.end(b); };
    const port = srv.address().port; const C = `http://127.0.0.1:${port}`;
    if (u.pathname === '/robots.txt') return H(200, 'text/plain', 'User-agent: *\nDisallow: /private/\n');
    if (u.pathname === '/images') { const q2 = u.searchParams.get('q') || ''; return H(200, 'text/html', `<!doctype html><title>${q2} - Εικόνες</title><h1>${q2}</h1>
      <img src="${C}/private/huge.png" width="1600" height="1000" alt="blocked by robots">
      <img src="${C}/icon.png" width="32" height="32" alt="icon">
      <img src="${C}/img/1.png" alt="Δάσος με ομίχλη" width="820" height="520"><img src="${C}/img/2.png" alt="Λίμνη στα βουνά" width="820" height="520"><img src="${C}/img/3.png" alt="Καταρράκτης" width="820" height="520">`); }
    if (u.pathname === '/search') return H(200, 'text/html', `<!doctype html><title>search</title><div class="nyx-result"><a href="${C}/page/1">Nature page one</a></div><div class="nyx-result"><a href="${C}/page/2">Nature page two</a></div>`);
    if (/^\/page\/\d/.test(u.pathname)) return H(200, 'text/html', `<!doctype html><html><head><title>Nature ${u.pathname}</title><meta property="og:image" content="${C}/img/4.png"></head><body><p>Ελεύθερο υλικό φύσης.</p>${video ? `<video src="${C}/vid/river.webm" width="640" height="360"></video>` : ''}<img src="${C}/img/5.png" width="820" height="520"></body></html>`);
    if (/^\/(img|private)\//.test(u.pathname) || u.pathname === '/icon.png') { const n = +(u.pathname.match(/(\d+)/)?.[1] || 9); const send = () => H(200, 'image/png', u.pathname === '/icon.png' ? png(16, 16) : img(n)); return slow ? setTimeout(send, slow) : send(); }
    if (u.pathname === '/vid/river.webm' && video) return H(200, 'video/webm', fs.readFileSync(video));
    // ---- OpenAI-compatible LLM
    if (u.pathname === '/v1/models') return H(200, 'application/json', JSON.stringify({ data: [{ id: 'mock-qwen3.6' }] }));
    if (u.pathname === '/v1/chat/completions') { let b = ''; q.on('data', d => b += d); q.on('end', () => { const p = JSON.parse(b || '{}'); log.llm.push(p); const M = p.messages || []; const last = M[M.length - 1] || {}; const user = [...M].reverse().find(m => m.role === 'user'); const ut = typeof user?.content === 'string' ? user.content : '';
      const reply = (message) => H(200, 'application/json', JSON.stringify({ model: 'mock-qwen3.6', choices: [{ message: { role: 'assistant', ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
      if (last.role === 'tool') return reply({ content: 'Έτοιμο: έβαλα τις εικόνες στον καμβά σου με την πηγή τους.' });
      if (/nature wallpapers/i.test(ut) && p.tools) return reply({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'show_plan', arguments: JSON.stringify({ steps: ['Αναζήτηση εικόνων', 'Λήψη 2 εικόνων', 'Τοποθέτηση στον καμβά'] }) } }, { id: 'c2', type: 'function', function: { name: 'web_media_to_canvas', arguments: JSON.stringify({ query: 'nature wallpapers', kind: 'image', count: 2 }) } }] });
      return reply({ content: 'echo: ' + ut.slice(0, 2000) }); }); return; }
    H(404, 'text/plain', 'nope');
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port, log, png })));
}
module.exports = { start, png };
