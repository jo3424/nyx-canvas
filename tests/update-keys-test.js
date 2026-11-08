'use strict';
// Key-rotation test for the update verifier: patches signed with the LEGACY key or the CURRENT key
// must verify; anything else (other key, tampered manifest, garbage signature) must be rejected.
// Run: node tests/update-keys-test.js   (plain Node, no Electron needed)
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), crypto = require('crypto'), assert = require('assert');
const core = require('../main/update-core');
const KEYS = require('../main/update-key');
let n = 0; const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  ok', msg); };

// 0) the trusted list keeps the legacy key and adds the new one
ok(Array.isArray(KEYS) && KEYS.length >= 2, 'trusted key list has >= 2 keys');
ok(KEYS.includes(KEYS.LEGACY) && /MCowBQYDK2VwAyEA0BpU\/HCp14nIU6nzueOwMEDg0y4HIvfraHwlrXvoRwo=/.test(KEYS.LEGACY), 'legacy key is still trusted');
ok(KEYS.includes(KEYS.CURRENT) && KEYS.CURRENT !== KEYS.LEGACY, 'new key is trusted');

// 1) a real patch manifest signed with the LEGACY private key (2.4.0 -> 2.5.0)
const fx = path.join(__dirname, 'fixtures');
const legacyM = zlib.gunzipSync(fs.readFileSync(path.join(fx, 'legacy-2.4.0-to-2.5.0.manifest.json.gz')));
const legacyS = fs.readFileSync(path.join(fx, 'legacy-2.4.0-to-2.5.0.manifest.sig'), 'utf8');
ok(core.verifySig(legacyM, legacyS, KEYS), 'legacy-signed manifest verifies against the trusted list');
ok(core.verifySig(legacyM, legacyS, KEYS.LEGACY), 'legacy-signed manifest verifies with a single PEM string (old call style)');
ok(!core.verifySig(legacyM, legacyS, KEYS.CURRENT), 'legacy signature does not verify with the new key alone');
const tampered = Buffer.from(legacyM); tampered[tampered.length - 5] ^= 1;
ok(!core.verifySig(tampered, legacyS, KEYS), 'tampered legacy manifest is rejected');

// 2) the new key: if the private key is on this box, prove it matches CURRENT (never printed)
const privPath = process.env.NYX_UPDATE_KEY || path.join(__dirname, '..', '..', 'keys', 'nyx-update-private.pem');
if (fs.existsSync(privPath)) {
  const priv = fs.readFileSync(privPath, 'utf8');
  const pub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' });
  ok(pub.trim() === KEYS.CURRENT.trim(), 'private key on disk matches the CURRENT public key');
  const m = Buffer.from('{"probe":' + Date.now() + '}'); const s = core.signManifest(m, priv);
  ok(core.verifySig(m, s, KEYS), 'new-key signature verifies against the trusted list');
  ok(!core.verifySig(m, s, KEYS.LEGACY), 'new-key signature does not verify with the legacy key alone');
} else console.log('  skip new private key not present (', privPath, ')');

// 3) any-of semantics with throw-away keys + full buildPatch/openPatch round trip
const a = crypto.generateKeyPairSync('ed25519'), b = crypto.generateKeyPairSync('ed25519'), c = crypto.generateKeyPairSync('ed25519');
const pem = (k) => k.export({ type: k.type === 'private' ? 'pkcs8' : 'spki', format: 'pem' });
const trusted = [pem(a.publicKey), pem(b.publicKey)];
const msg = Buffer.from('manifest-bytes');
ok(core.verifySig(msg, core.signManifest(msg, pem(a.privateKey)), trusted), 'first key of list verifies');
ok(core.verifySig(msg, core.signManifest(msg, pem(b.privateKey)), trusted), 'second key of list verifies');
ok(!core.verifySig(msg, core.signManifest(msg, pem(c.privateKey)), trusted), 'untrusted key is rejected');
ok(!core.verifySig(msg, '', trusted) && !core.verifySig(msg, 'AAAA', trusted), 'empty/garbage signature is rejected');
ok(!core.verifySig(msg, core.signManifest(msg, pem(a.privateKey)), []), 'empty key list rejects');
ok(!core.verifySig(msg, core.signManifest(msg, pem(a.privateKey)), ['not a pem', pem(c.publicKey)]), 'broken PEM in list does not throw / accept');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-keys-'));
try {
  const to = path.join(tmp, 'to'); fs.mkdirSync(path.join(to, 'main'), { recursive: true });
  fs.writeFileSync(path.join(to, 'package.json'), JSON.stringify({ name: 'nyx-canvas', version: '9.9.9', main: 'boot.js' }));
  fs.writeFileSync(path.join(to, 'boot.js'), '//'); fs.writeFileSync(path.join(to, 'main', 'x.js'), '//');
  const { zip } = core.buildPatch({ fromFiles: null, toDir: to, toVersion: '9.9.9', privateKey: pem(b.privateKey) });
  const zp = path.join(tmp, 'p.zip'); fs.writeFileSync(zp, zip);
  const opened = core.openPatch(zp, trusted); ok(opened.manifest.version === '9.9.9', 'openPatch accepts a patch signed by the 2nd trusted key');
  let code = null; try { core.openPatch(zp, [pem(a.publicKey)]); } catch (e) { code = e.code; }
  ok(code === 'BAD_SIG', 'openPatch rejects the same patch when its key is not trusted');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`update-keys-test: ${n} passed`);
