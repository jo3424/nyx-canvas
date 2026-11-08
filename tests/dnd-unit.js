'use strict';
// v2.6.1 drag & drop — pure main-process parts (no Electron): node tests/dnd-unit.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const dnd = require('../main/dnd');
const Module = require('module'); const _load = Module._load; // webagent.js imports electron at top level → stub it (only pure helpers are used)
Module._load = function (req, ...a) { return req === 'electron' ? { app: { getPath: () => os.tmpdir() }, net: {}, session: {}, ipcMain: {}, BrowserWindow: function () {} } : _load.call(this, req, ...a); };
const { sniffDrop } = require('../main/webagent'); Module._load = _load;
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };

ok('safeName strips Windows-illegal chars and reserved names', () => {
  assert.strictEqual(dnd.safeName('a<b>:c"d|e?f*.txt'), 'a_b_c_d_e_f_.txt');
  assert.strictEqual(dnd.safeName('CON.txt'), '_CON.txt');
  assert.strictEqual(dnd.safeName('..\\..\\evil.png'), 'evil.png');
  assert.strictEqual(dnd.safeName('name. . '), 'name');
  assert.strictEqual(dnd.safeName('', 'x.txt'), 'x.txt');
  assert.strictEqual(dnd.safeName('Σημείωση.txt'), 'Σημείωση.txt');
});
ok('urlShortcut is a CRLF [InternetShortcut]', () => {
  assert.strictEqual(dnd.urlShortcut('https://a.gr/x'), '[InternetShortcut]\r\nURL=https://a.gr/x\r\n');
});
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-media-'));
fs.writeFileSync(path.join(media, 'mvy3l28r-cf6c2f-pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13]));
fs.writeFileSync(path.join(os.tmpdir(), 'nyx-secret.txt'), 'secret');
ok('plan: media file → original name, only inside mediaDir', () => {
  const p = dnd.plan([{ file: 'mvy3l28r-cf6c2f-pic.png' }, { file: '../nyx-secret.txt' }, { file: 'mvy3l28r-cf6c2f-pic.png', name: 'Φωτό' }], media);
  assert.strictEqual(p[0].name, 'pic.png'); assert.strictEqual(p[0].src, path.join(media, 'mvy3l28r-cf6c2f-pic.png'));
  assert.strictEqual(p[1].src, path.join(media, 'nyx-secret.txt')); // basename only → stays in mediaDir (and does not exist)
  assert.strictEqual(p[2].name, 'Φωτό.png');
});
ok('plan: links → .url (http/https only), text → .txt', () => {
  const p = dnd.plan([{ url: 'https://example.org/a', name: 'Example' }, { url: 'javascript:alert(1)' }, { url: 'file:///C:/x' }, { text: 'γεια', name: 'σημ' }, { text: 'x', name: 'a.md' }], media);
  assert.deepStrictEqual(p.map(x => x.name), ['Example.url', 'σημ.txt', 'a.md']);
  assert.ok(p[0].content.includes('URL=https://example.org/a'));
});
ok('plan: max 50 items', () => { assert.strictEqual(dnd.plan(Array.from({ length: 80 }, (_, i) => ({ text: 'x' + i })), media).length, 50); });
ok('materialize: temp folder, unique names, missing files skipped', () => {
  const paths = dnd.materialize(dnd.plan([{ file: 'mvy3l28r-cf6c2f-pic.png' }, { file: 'mvy3l28r-cf6c2f-pic.png' }, { file: '../nyx-secret.txt' }, { text: 'a\nb', name: 'n.txt' }], media));
  assert.deepStrictEqual(paths.map(p => path.basename(p)), ['pic.png', 'pic (1).png', 'n.txt']);
  for (const p of paths) assert.ok(p.startsWith(dnd.TMP_ROOT()) && fs.existsSync(p));
  assert.ok(fs.readFileSync(paths[0]).equals(fs.readFileSync(path.join(media, 'mvy3l28r-cf6c2f-pic.png'))));
  fs.rmSync(path.dirname(paths[0]), { recursive: true, force: true });
});
ok('sniffDrop: magic bytes, not the server content-type', () => {
  assert.strictEqual(sniffDrop(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13])), 'image/png');
  assert.strictEqual(sniffDrop(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])), 'image/jpeg');
  assert.strictEqual(sniffDrop(Buffer.concat([Buffer.from('BM'), Buffer.alloc(40)])), 'image/bmp');
  assert.strictEqual(sniffDrop(Buffer.from('<html><script>alert(1)</script></html>')), '');
  assert.strictEqual(sniffDrop(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), '');
});
ok('guest script marker', () => { assert.ok(dnd.GUEST_JS.includes('dragstart') && dnd.MARK.startsWith('\u2063')); });
(async () => {
  const { assertPublicUrl } = require('../main/netguard');
  for (const u of ['http://127.0.0.1/x.png', 'http://169.254.169.254/latest', 'http://[::1]/a.png', 'http://10.0.0.5/a.png', 'http://192.168.1.1/a.png']) {
    let threw = false; try { await assertPublicUrl(u); } catch (e) { threw = true; } assert.ok(threw, 'SSRF guard must block ' + u);
  }
  n++; console.log('PASS SSRF guard blocks private/loopback/metadata image URLs');
  fs.rmSync(media, { recursive: true, force: true }); fs.rmSync(path.join(os.tmpdir(), 'nyx-secret.txt'), { force: true });
console.log(`dnd-unit: ${n} groups OK`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
