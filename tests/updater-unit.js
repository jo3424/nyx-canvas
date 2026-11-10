'use strict';
// Updater unit tests (plain node): signature + hash verification, apply, rollback, auto-rollback, unsafe paths.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const core = require('../main/update-core'), zip = require('../main/zip');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); c ? passes++ : fails++; };
const throws = (fn, code, m) => { try { fn(); ok(false, m, 'no throw'); } catch (e) { ok(!code || e.code === code || (code instanceof RegExp && code.test(e.message)), m, e.code + ' ' + e.message); } };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-upd-'));
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }), PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });
const other = crypto.generateKeyPairSync('ed25519'); const PUB2 = other.publicKey.export({ type: 'spki', format: 'pem' }), PRIV2 = other.privateKey.export({ type: 'pkcs8', format: 'pem' });
const EL = '45.1.0';
function mkTree(name, version, files) {
  const d = path.join(T, name); fs.rmSync(d, { recursive: true, force: true });
  const all = { 'package.json': JSON.stringify({ name: 'nyx-canvas', version }), 'main.js': `module.exports = ${JSON.stringify(version)};`, ...files };
  for (const [rel, data] of Object.entries(all)) { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }
  return d;
}
const tree = (d) => core.treeManifest(d);
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const opts = (root, currentDir, currentVersion, extra = {}) => ({ root, currentDir, currentVersion, electron: EL, publicKey: PUB, ...extra });
const write = (name, buf) => { const p = path.join(T, name); fs.writeFileSync(p, buf); return p; };
// rebuild a zip with some entries replaced (keeps the original signature unless given)
function rezip(src, edits) { const z = zip.read(src); return zip.write(z.names.map(n => ({ name: n, data: n in edits ? Buffer.from(edits[n]) : z.get(n) })).concat(Object.keys(edits).filter(n => !z.has(n)).map(n => ({ name: n, data: Buffer.from(edits[n]) })))); }

console.log('signatures');
const mb = Buffer.from('{"hello":1}'); const sig = core.signManifest(mb, PRIV);
ok(core.verifySig(mb, sig, PUB), 'valid ed25519 signature verifies');
ok(!core.verifySig(Buffer.from('{"hello":2}'), sig, PUB), 'tampered manifest fails verification');
ok(!core.verifySig(mb, sig, PUB2), 'signature from another key fails');
ok(!core.verifySig(mb, 'not-base64!!', PUB), 'garbage signature fails (no throw)');
ok(core.cmpVer('2.10.0', '2.9.9') > 0 && core.cmpVer('2.1.0', '2.1') === 0 && core.cmpVer('2.0.0', '2.1.0') < 0, 'semantic version compare');
ok(core.cmpVer('2.6.5.1', '2.6.5') > 0 && core.cmpVer('2.6.5.1', '2.6.6') < 0, 'four-part 2.6.5.1 is newer than 2.6.5 and older than reserved 2.6.6');
ok(core.cmpVer('2.6.5.2', '2.6.5.1') > 0 && core.cmpVer('2.6.5.2', '2.6.6') < 0, 'four-part 2.6.5.2 is newer than 2.6.5.1 and older than reserved 2.6.6');

console.log('build + apply (delta)');
const A = mkTree('A', '1.0.0', { 'app/index.html': '<h1>A</h1>', 'app/keep.js': 'keep()', 'app/old.js': 'old()', 'app/Ελληνικά.txt': 'γεια', 'app/bin.dat': crypto.randomBytes(5000) });
const B = mkTree('B', '1.1.0', { 'app/index.html': '<h1>B</h1>', 'app/keep.js': 'keep()', 'app/new/feature.js': 'feature()', 'app/Ελληνικά.txt': 'γεια', 'app/bin.dat': fs.readFileSync(path.join(A, 'app/bin.dat')) });
const p1 = core.buildPatch({ fromFiles: tree(A), fromVersion: '1.0.0', toDir: B, toVersion: '1.1.0', electron: EL, changelog: { el: ['x'], en: ['x'] }, privateKey: PRIV });
ok(p1.manifest.changed.sort().join() === ['app/index.html', 'app/new/feature.js', 'main.js', 'package.json'].join(), 'delta contains only changed files', p1.manifest.changed);
ok(p1.manifest.removed.join() === 'app/old.js', 'delta records removed files', p1.manifest.removed);
ok(!zip.read(p1.zip).has('files/app/keep.js'), 'unchanged files are not in the zip');
const P1 = write('p1.zip', p1.zip); const R = path.join(T, 'root');
const r1 = core.applyPatch(P1, opts(R, A, '1.0.0'));
ok(r1.version === '1.1.0' && r1.from === '1.0.0', 'applyPatch returns new version');
ok(same(tree(path.join(R, '1.1.0')), tree(B)), 'applied tree is byte-identical to the target (incl. Greek filename, binary, removals)');
ok(!fs.existsSync(path.join(R, '1.1.0', 'app/old.js')), 'removed file is gone');
ok(!fs.existsSync(path.join(R, '1.1.0.staging')), 'no staging dir left');
let st = core.readState(R); ok(st.active === '1.1.0' && st.confirmed === false && st.previous === null && st.electron === EL, 'state: active=1.1.0, unconfirmed', st);
ok(fs.existsSync(path.join(R, '1.1.0', '.nyx-manifest.json')), 'version folder carries .nyx-manifest.json (changelog)');

console.log('rejections (nothing changes on failure)');
const snap = () => JSON.stringify({ st: core.readState(R), dirs: fs.readdirSync(R).sort() });
const before = snap();
throws(() => core.applyPatch(P1, opts(R, A, '1.0.0', { publicKey: PUB2 })), 'BAD_SIG', 'patch rejected with a different public key');
const mjson = JSON.parse(zip.read(P1).get('manifest.json')); mjson.files['app/index.html'].sha256 = core.sha256(Buffer.from('<h1>EVIL</h1>')); mjson.files['app/index.html'].size = 13;
throws(() => core.applyPatch(write('t1.zip', rezip(P1, { 'manifest.json': JSON.stringify(mjson, null, 1) })), opts(R, A, '1.0.0')), 'BAD_SIG', 'edited manifest (hash swapped) → bad signature');
throws(() => core.applyPatch(write('t2.zip', rezip(P1, { 'files/app/index.html': '<h1>EVIL</h1>' })), opts(R, A, '1.0.0')), 'HASH_MISMATCH', 'tampered file content → hash mismatch');
const A2 = mkTree('A2', '1.0.0', { 'app/index.html': '<h1>A</h1>', 'app/keep.js': 'keep() // edited locally', 'app/old.js': 'old()', 'app/Ελληνικά.txt': 'γεια', 'app/bin.dat': fs.readFileSync(path.join(A, 'app/bin.dat')) });
throws(() => core.applyPatch(P1, opts(R, A2, '1.0.0')), 'HASH_MISMATCH', 'modified base file → hash mismatch (delta needs a pristine base)');
fs.rmSync(path.join(A2, 'app/keep.js'));
throws(() => core.applyPatch(P1, opts(R, A2, '1.0.0')), 'BASE_MISSING', 'missing base file → rejected');
throws(() => core.applyPatch(P1, opts(R, A, '0.9.0')), 'WRONG_BASE', 'delta for another base version → rejected');
throws(() => core.applyPatch(P1, opts(R, B, '1.1.0')), 'NOT_NEWER', 'same/older version → rejected');
throws(() => core.applyPatch(P1, opts(R, A, '1.0.0', { electron: '46.0.0' })), 'NEEDS_FULL', 'different Electron → needs full download');
throws(() => core.applyPatch(write('t3.zip', zip.write([{ name: 'readme.txt', data: Buffer.from('hi') }])), opts(R, A, '1.0.0')), 'NOT_PATCH', 'random zip → not a patch');
// signed but malicious paths
for (const bad of ['../evil.js', '/abs/evil.js', 'C:/evil.js', 'app/../../evil.js', 'app//x.js']) {
  const m = { format: 1, app: core.APP_ID, version: '1.2.0', base: null, full: true, electron: EL, files: { [bad]: { sha256: core.sha256(Buffer.from('x')), size: 1 } } };
  const b = Buffer.from(JSON.stringify(m)); const zf = write('bad.zip', zip.write([{ name: 'manifest.json', data: b }, { name: 'manifest.sig', data: Buffer.from(core.signManifest(b, PRIV)) }, { name: 'files/' + bad, data: Buffer.from('x') }]));
  throws(() => core.applyPatch(zf, opts(R, B, '1.1.0')), /unsafe path/, 'signed patch with unsafe path rejected: ' + bad);
}
ok(!fs.existsSync(path.join(T, 'evil.js')) && !fs.existsSync(path.join(R, '..', 'evil.js')), 'nothing written outside the code root');
ok(snap() === before, 'state and folders unchanged after every rejected patch', [before, snap()]);

console.log('boot choice + auto-rollback');
const BI = { builtinVersion: '1.0.0', electron: EL };
let c = core.chooseBoot(R, BI); ok(c.dir === path.join(R, '1.1.0') && c.version === '1.1.0', 'boot 1 (unconfirmed) loads 1.1.0');
c = core.chooseBoot(R, BI); ok(c.dir && !c.rolledBack, 'boot 2 still tries 1.1.0');
c = core.chooseBoot(R, BI); ok(c.dir === null && c.rolledBack === '1.1.0', 'boot 3 → automatic rollback to bundled', c);
st = core.readState(R); ok(st.active === null && st.failed === '1.1.0', 'state records failed version', st);
// re-apply and confirm
fs.rmSync(R, { recursive: true, force: true }); core.applyPatch(P1, opts(R, A, '1.0.0'));
core.chooseBoot(R, BI); ok(core.confirmBoot(R) === true, 'confirmBoot marks good start');
for (let i = 0; i < 4; i++) c = core.chooseBoot(R, BI); ok(c.version === '1.1.0' && !c.rolledBack, 'confirmed version keeps loading');
ok(core.chooseBoot(R, { builtinVersion: '1.1.0', electron: EL }).dir === null, 'bundled build same/newer (full reinstall) wins over code folder');
fs.rmSync(R, { recursive: true, force: true }); core.applyPatch(P1, opts(R, A, '1.0.0')); core.confirmBoot(R);
ok(core.chooseBoot(R, { builtinVersion: '1.0.0', electron: '46.0.0' }).dir === null, 'code folder ignored after Electron changed');
fs.rmSync(R, { recursive: true, force: true }); core.applyPatch(P1, opts(R, A, '1.0.0')); core.confirmBoot(R);

console.log('chained update + manual rollback');
const C = mkTree('C', '1.2.0', { 'app/index.html': '<h1>C</h1>', 'app/keep.js': 'keep()', 'app/new/feature.js': 'feature2()', 'app/Ελληνικά.txt': 'γεια σου', 'app/bin.dat': fs.readFileSync(path.join(A, 'app/bin.dat')) });
const p2 = core.buildPatch({ fromFiles: tree(B), fromVersion: '1.1.0', toDir: C, toVersion: '1.2.0', electron: EL, privateKey: PRIV });
core.applyPatch(write('p2.zip', p2.zip), opts(R, path.join(R, '1.1.0'), '1.1.0'));
st = core.readState(R); ok(st.active === '1.2.0' && st.previous === '1.1.0', '1.1.0 → 1.2.0 applied from the code folder; previous kept', st);
ok(same(tree(path.join(R, '1.2.0')), tree(C)), '1.2.0 tree identical');
let rb = core.rollback(R, '1.0.0'); ok(rb.ok && rb.from === '1.2.0' && rb.to === '1.1.0', 'rollback → 1.1.0', rb);
ok(core.chooseBoot(R, BI).version === '1.1.0', 'boots 1.1.0 after rollback');
rb = core.rollback(R, '1.0.0'); ok(rb.ok && rb.to === '1.0.0', 'second rollback → bundled 1.0.0', rb);
ok(core.chooseBoot(R, BI).dir === null, 'boots bundled');
ok(core.rollback(R, '1.0.0').ok === false, 'nothing left to roll back');

console.log('full package + pruning');
const D = mkTree('D', '1.3.0', { 'app/index.html': '<h1>D</h1>' });
const pf = core.buildPatch({ fromFiles: null, toDir: D, toVersion: '1.3.0', electron: EL, privateKey: PRIV });
ok(pf.manifest.full && zip.read(pf.zip).names.filter(n => n.startsWith('files/')).length === Object.keys(tree(D)).length, 'full package carries every file');
core.applyPatch(write('pf.zip', pf.zip), opts(R, A, '1.0.0'));
ok(same(tree(path.join(R, '1.3.0')), tree(D)), 'full package applies over any older version');
core.confirmBoot(R); const p3 = core.buildPatch({ fromFiles: tree(D), fromVersion: '1.3.0', toDir: mkTree('E', '1.4.0', { 'app/index.html': '<h1>E</h1>' }), toVersion: '1.4.0', electron: EL, privateKey: PRIV });
core.applyPatch(write('p3.zip', p3.zip), opts(R, path.join(R, '1.3.0'), '1.3.0'));
ok(fs.readdirSync(R).filter(d => fs.statSync(path.join(R, d)).isDirectory()).sort().join() === '1.3.0,1.4.0', 'old version folders pruned (keeps active + previous)', fs.readdirSync(R));

console.log('release tooling');
const realKey = '/workspace/nebula-keys/nyx-update-ed25519.pem';
if (fs.existsSync(realKey)) {
  const pz = core.buildPatch({ fromFiles: null, toDir: D, toVersion: '9.9.9', electron: EL, privateKey: fs.readFileSync(realKey, 'utf8') });
  ok(!!core.openPatch(write('real.zip', pz.zip), require('../main/update-key')), 'box signing key matches the public key baked into the app');
} else console.log('  - (signing key not on this machine, skipped)');
const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'update-key.js'), 'utf8');
ok(!/PRIVATE KEY/.test(src), 'app ships only the public key');
const pf2 = require('../scripts/pack-filter');
ok(pf2.ignored('tests/x.js') && pf2.ignored('node_modules/a') && pf2.ignored('README.md') && !pf2.ignored('app/index.html') && !pf2.ignored('main/updater.js'), 'pack filter: code in, tests/docs/node_modules out');

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
