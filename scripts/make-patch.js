#!/usr/bin/env node
'use strict';
// Build a signed, code-only Nyx update (never contains Electron, never contains the private key).
//
//   node scripts/make-patch.js                          # delta: <last released tree> → working tree (package.json version)
//   node scripts/make-patch.js --from v2.1.0 --to HEAD  # git refs (tags/commits) or a saved tree file dist/updates/tree-X.json
//   node scripts/make-patch.js --full                   # full code package (any older 2.x with the same Electron)
//
// Output (dist/updates/): nyx-<from>-to-<to>.zip, nyx-<to>-full.zip, nyx-latest.json, tree-<to>.json
//   Upload the zip(s) + nyx-latest.json as assets of a GitHub Release → the app's «Έλεγχος για ενημερώσεις» finds them.
// Signing key: $NYX_SIGN_KEY or /workspace/nebula-keys/nyx-update-ed25519.pem (outside the repo, gitignored).
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { execFileSync } = require('child_process');
const core = require('../main/update-core'); const PUB = require('../main/update-key');
const { copyFiltered } = require('./pack-filter');
const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const OUT = path.resolve(arg('out', path.join(ROOT, 'dist', 'updates'))); fs.mkdirSync(OUT, { recursive: true });
const KEY = arg('key', process.env.NYX_SIGN_KEY || '/workspace/nebula-keys/nyx-update-ed25519.pem');
const ELECTRON = require('electron/package.json').version;
const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 30 });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-mkpatch-'));

function treeOf(ref) { // → directory with the filtered app-code tree
  const dir = path.join(tmp, 'src-' + String(ref).replace(/[^\w.-]/g, '_'));
  if (ref === 'WORKTREE') return copyFiltered(ROOT, dir + '-f');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('bash', ['-c', `git archive --format=tar "$1" | tar -x -C "$2"`, '_', ref, dir], { cwd: ROOT });
  return copyFiltered(dir, dir + '-f');
}
function verOf(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; }
function latestTreeFile(below) {
  const xs = fs.readdirSync(OUT).map(f => f.match(/^tree-(.+)\.json$/)).filter(Boolean).map(m => m[1]).filter(v => core.cmpVer(v, below) < 0).sort(core.cmpVer);
  return xs.length ? path.join(OUT, 'tree-' + xs.at(-1) + '.json') : null;
}
(function main() {
  if (!fs.existsSync(KEY)) throw new Error('signing key not found: ' + KEY);
  const priv = fs.readFileSync(KEY, 'utf8');
  // the key must match the public key baked into the app, otherwise every install would reject the patch
  const probe = Buffer.from('nyx-key-check'); const probeSig = crypto.sign(null, probe, crypto.createPrivateKey(priv)); if (![].concat(PUB).some(k => crypto.verify(null, probe, crypto.createPublicKey(k), probeSig))) throw new Error('private key does not match main/update-key.js');
  const toRef = arg('to', 'WORKTREE'); const toDir = treeOf(toRef); const toVersion = arg('version', verOf(toDir));
  for (const f of ['main.js', 'package.json', 'preload.js', 'app/index.html']) if (!fs.existsSync(path.join(toDir, f))) throw new Error('target tree incomplete: ' + f);
  if (fs.readdirSync(toDir).some(f => /\.(pem|key)$/i.test(f)) || core.listTree(toDir).some(f => /nebula-keys|\.pem$|\.key$/i.test(f))) throw new Error('refusing: key-like file in target tree');
  const log = (() => { try { return JSON.parse(fs.readFileSync(path.join(toDir, 'CHANGELOG.json'), 'utf8'))[toVersion]; } catch (e) { return null; } })() || { el: [], en: [] };
  const latest = { version: toVersion, electron: ELECTRON, changelog: log, date: new Date().toISOString().slice(0, 10), patches: {}, fullCode: null };
  const write = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log('  →', path.join(OUT, name), (buf.length / 1048576).toFixed(2) + ' MB'); };
  let fromRef = arg('from', null); if (fromRef === true) fromRef = null;
  if (!fromRef && !arg('full', false)) fromRef = latestTreeFile(toVersion);
  const prev = fs.existsSync(path.join(OUT, 'nyx-latest.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'nyx-latest.json'), 'utf8')) : null;
  if (prev && prev.version === toVersion) Object.assign(latest.patches, prev.patches || {}), latest.fullCode = prev.fullCode || null;
  if (fromRef) {
    let fromFiles, fromVersion;
    if (/\.json$/.test(fromRef) && fs.existsSync(fromRef)) { const T = JSON.parse(fs.readFileSync(fromRef, 'utf8')); fromFiles = T.files; fromVersion = T.version; }
    else { const d = treeOf(fromRef); fromFiles = core.treeManifest(d); fromVersion = verOf(d); }
    if (core.cmpVer(toVersion, fromVersion) <= 0) throw new Error(`target ${toVersion} must be newer than base ${fromVersion}`);
    const p = core.buildPatch({ fromFiles, fromVersion, toDir, toVersion, electron: ELECTRON, changelog: log, privateKey: priv });
    const name = `nyx-${fromVersion}-to-${toVersion}.zip`; write(name, p.zip); latest.patches[fromVersion] = name;
    console.log(`  delta ${fromVersion} → ${toVersion}: ${p.manifest.changed.length} changed, ${p.manifest.removed.length} removed, ${Object.keys(p.manifest.files).length} files in tree`);
  }
  if (arg('full', false) || !fromRef || arg('also-full', false)) {
    const p = core.buildPatch({ fromFiles: null, toDir, toVersion, electron: ELECTRON, changelog: log, privateKey: priv });
    const name = `nyx-${toVersion}-full.zip`; write(name, p.zip); latest.fullCode = name;
  }
  // self-check: every zip we wrote opens + verifies with the public key baked into the app
  for (const n of [...Object.values(latest.patches), latest.fullCode].filter(Boolean)) core.openPatch(path.join(OUT, n), PUB);
  fs.writeFileSync(path.join(OUT, 'nyx-latest.json'), JSON.stringify(latest, null, 1));
  fs.writeFileSync(path.join(OUT, `tree-${toVersion}.json`), JSON.stringify({ version: toVersion, electron: ELECTRON, files: core.treeManifest(toDir) }));
  console.log('  → nyx-latest.json, tree-' + toVersion + '.json (signature self-check OK)');
  fs.rmSync(tmp, { recursive: true, force: true });
})();
