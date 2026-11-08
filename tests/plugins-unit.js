// Unit tests for built-in plugin logic (no Electron). Run: node tests/plugins-unit.js
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const load = (id, nyx = {}) => { const ctx = { module: { exports: {} }, console, setTimeout, setInterval, clearTimeout, clearInterval, URL, URLSearchParams, nyx }; vm.createContext(ctx); new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'app', 'plugins', id, 'plugin.js'), 'utf8')).runInContext(ctx); return ctx.module.exports; };
let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('✓', name); }, (e) => { console.error('✗', name, e.message); process.exitCode = 1; });
(async () => {
  const ci = load('clipboard-inbox');
  await ok('clipboard: strip utm/fbclid', () => assert.strictEqual(ci.cleanUrl('https://ex.com/a?id=5&utm_source=x&utm_medium=y&fbclid=abc'), 'https://ex.com/a?id=5'));
  await ok('clipboard: keep youtube v, strip si', () => assert.strictEqual(ci.cleanUrl('https://youtu.be/abc?si=XYZ&t=3'), 'https://youtu.be/abc?t=3'));
  await ok('clipboard: categories', () => { assert.strictEqual(ci.cat('https://a.gr'), 'link'); assert.strictEqual(ci.cat('a@b.gr'), 'email'); assert.strictEqual(ci.cat('+30 210 1234567'), 'phone'); assert.strictEqual(ci.cat('#ff00aa'), 'color'); assert.strictEqual(ci.cat('const x = 1;'), 'code'); assert.strictEqual(ci.cat('Γεια σου κόσμε'), 'text'); });
  const eo = load('eortologio');
  await ok('eortologio: Orthodox Easter 2026/2027', () => { const e = eo.easter(2026); assert.strictEqual(e.getMonth() + '-' + e.getDate(), '3-12'); const f = eo.easter(2027); assert.strictEqual(f.getMonth() + '-' + f.getDate(), '4-2'); });
  await ok('eortologio: names', () => { assert.match(eo.names(new Date(2026, 9, 26)), /Δημήτριος/); assert.match(eo.names(new Date(2026, 3, 23)), /Γεώργιος/); assert.match(eo.names(new Date(2027, 4, 3)), /Γεώργιος/); });
  const rss = load('rss');
  await ok('rss: parse rss+atom', () => { const r = rss.parse('<rss><channel><title>T</title><item><title><![CDATA[Α &amp; Β]]></title><link>https://x/1</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>'); assert.strictEqual(r.items[0].title, 'Α & Β'); const a = rss.parse('<feed><title>F</title><entry><title>v1</title><link href="https://g/r"/><updated>2026-10-01T00:00:00Z</updated></entry></feed>'); assert.strictEqual(a.items[0].url, 'https://g/r'); });
  const ics = load('calendar-ics');
  await ok('ics: parse', () => { const e = ics.parse('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261031T090000Z\r\nSUMMARY:Οδοντ\r\n ίατρος\r\nLOCATION:Αθήνα\\, Κέντρο\r\nEND:VEVENT\r\nEND:VCALENDAR'); assert.strictEqual(e[0].title, 'Οδοντίατρος'); assert.strictEqual(e[0].loc, 'Αθήνα, Κέντρο'); assert.strictEqual(e[0].start.toISOString(), '2026-10-31T09:00:00.000Z'); });
  const jc = load('jsoncanvas');
  await ok('jsoncanvas: export nodes+edges', () => { const c = jc.toCanvas({ items: [{ id: 'a', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'A', tags: ['x'] }, { id: 'b', type: 'link', x: 400, y: 0, w: 300, h: 200, url: 'https://a.gr', tags: [] }, { id: 'f', type: 'frame', x: -50, y: -50, w: 900, h: 400, title: 'G', tags: [] }, { id: 'r', type: 'arrow', x1: 100, y1: 100, x2: 500, y2: 100, tags: [] }] }); assert.strictEqual(c.nodes.length, 3); assert.strictEqual(c.edges[0].fromNode, 'a'); assert.strictEqual(c.nodes[1].type, 'link'); assert.strictEqual(c.nodes[2].type, 'group'); });
  const hf = load('hyperframes-mp4');
  await ok('hyperframes: storyboard', () => assert.match(hf.storyboard({ board: 'B', items: [{ type: 'sticky', x: 0, y: 0, title: 'Τίτλος', text: 'κείμενο' }] }, 3), /Σκηνή 1 · 0s–3s/));
  // MCP server: token + origin checks
  let handler; const store = {}; const nyx = { config: { port: 7801, write: true }, secret: { get: (k) => store[k], set: (k, v) => store[k] = v }, randomId: () => 'tok123', safeEqual: (a, b) => String(a) === String(b), serve: (p, h) => { handler = h; }, log() {}, board: { search: async (a) => ({ count: 1, q: a.query }), addCard: async (a) => ({ ok: true, id: 'x' }), read: async () => ({}), snapshot: async () => ({}) } };
  const mcp = load('mcp-server', nyx); await mcp.activate(nyx); // v2.6: also checks Host (DNS rebinding) + constant-time token compare
  const call = (body, h = {}) => handler({ method: 'POST', url: '/mcp', headers: { host: '127.0.0.1:7801', authorization: 'Bearer tok123', ...h }, body: JSON.stringify(body) });
  await ok('mcp: rejects no token', async () => { const r = await handler({ method: 'POST', url: '/mcp', headers: { host: '127.0.0.1:7801' }, body: '{}' }); assert.strictEqual(r.status, 401); });
  await ok('mcp: rejects foreign Host (DNS rebinding)', async () => { const r = await call({ jsonrpc: '2.0', id: 1, method: 'ping' }, { host: 'evil.example:7801' }); assert.strictEqual(r.status, 403); });
  await ok('mcp: rejects web origin', async () => { const r = await call({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.com' }); assert.strictEqual(r.status, 403); });
  await ok('mcp: initialize + tools/list + call', async () => { let r = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }); assert.strictEqual(r.body.result.serverInfo.name, 'nyx-canvas'); r = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); assert.ok(r.body.result.tools.length >= 4); r = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_cards', arguments: { query: 'γάλα' } } }); assert.match(r.body.result.content[0].text, /γάλα/); });
  for (const d of fs.readdirSync(path.join(__dirname, '..', 'app', 'plugins'))) { const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'plugins', d, 'manifest.json'))); assert.ok(m.id && m.name && m.description && Array.isArray(m.permissions), d); }
  console.log(`\n${n} plugin unit tests passed`);
})();
