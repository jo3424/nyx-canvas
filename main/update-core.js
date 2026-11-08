'use strict';
const { t, tr } = require('./i18n');
// Nyx code updater core — pure Node (no Electron), unit-tested in tests/update-unit.js.
// Layout under the code root (e.g. %LOCALAPPDATA%\Nyx Canvas\app-code):
//   state.json            { active, previous, confirmed, tries, electron, history[] }
//   <version>/            full verified app-code tree (main.js, preload.js, main/, app/ …)
// A patch zip contains  manifest.json + manifest.sig (ed25519 over the exact manifest bytes) + files/<rel path>.
// manifest = { format:1, app:'nyx-canvas', version, base|null, full:bool, electron, created, changelog:{el:[],en:[]},
//              files:{ rel:{ sha256, size } }  ← the COMPLETE file list of the resulting version
//              changed:[rel…], removed:[rel…] }
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const zip = require('./zip');
const APP_ID = 'nyx-canvas';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
function cmpVer(a, b) {
  const pa = String(a || '0').split(/[.-]/).map(x => parseInt(x, 10) || 0), pb = String(b || '0').split(/[.-]/).map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function safeRel(rel) {
  const r = String(rel).replace(/\\/g, '/');
  if (!r || r.startsWith('/') || /^[a-z]:/i.test(r) || r.split('/').some(s => s === '..' || s === '' || s === '.')) throw new Error('unsafe path in patch: ' + rel);
  return r;
}
// publicKeyPem: one PEM string (as before) or an array of trusted PEMs; true if ANY key verifies.
function verifySig(manifestBuf, sigB64, publicKeyPem) {
  const keys = (Array.isArray(publicKeyPem) ? publicKeyPem : [publicKeyPem]).filter(Boolean);
  let sig; try { sig = Buffer.from(String(sigB64).trim(), 'base64'); } catch (e) { return false; }
  if (!sig.length) return false;
  for (const k of keys) { try { if (crypto.verify(null, manifestBuf, crypto.createPublicKey(k), sig)) return true; } catch (e) {} }
  return false;
}
function signManifest(manifestBuf, privateKeyPem) { return crypto.sign(null, manifestBuf, crypto.createPrivateKey(privateKeyPem)).toString('base64'); }

// ---- state ----
function readState(root) { try { return JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8')); } catch (e) { return { active: null, previous: null, confirmed: true, tries: 0, history: [] }; } }
function writeState(root, st) { fs.mkdirSync(root, { recursive: true }); const f = path.join(root, 'state.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(st, null, 1)); fs.renameSync(f + '.tmp', f); }
const isCodeDir = (d) => { try { return fs.existsSync(path.join(d, 'main.js')) && fs.existsSync(path.join(d, 'package.json')); } catch (e) { return false; } };

// Decide which code to load at startup. Pure decision + state bookkeeping (crash counter / auto-rollback).
// Returns { dir|null (null = bundled), version, rolledBack, reason }
function chooseBoot(root, { builtinVersion, electron, maxTries = 2, publicKey = null }) {
  const st = readState(root); let rolledBack = null;
  // v2.5.1: with publicKey (passed by boot.js from the integrity-checked app.asar) an external code folder is only
  // loaded if its stored signed manifest verifies AND every file still matches it — tampered/unsigned folders are skipped.
  const valid = (v) => v && cmpVer(v, builtinVersion) > 0 && isCodeDir(path.join(root, v)) && (!st.electron || st.electron === electron)
    && (!publicKey || verifyCodeDir(path.join(root, v), publicKey, v).ok);
  if (st.active && !valid(st.active)) { // bundled build is newer (full reinstall) or folder broken → use bundled
    st.history = [...(st.history || []), { at: Date.now(), ev: 'skip', v: st.active, why: cmpVer(st.active, builtinVersion) <= 0 ? 'bundled-newer' : 'invalid' }].slice(-30);
    st.active = null; st.previous = null; st.confirmed = true; st.tries = 0; writeState(root, st);
    return { dir: null, version: builtinVersion, rolledBack: null };
  }
  if (!st.active) return { dir: null, version: builtinVersion, rolledBack: null };
  if (!st.confirmed) {
    st.tries = (st.tries || 0) + 1;
    if (st.tries > maxTries) { // new version failed to come up twice → roll back automatically
      rolledBack = st.active;
      st.history = [...(st.history || []), { at: Date.now(), ev: 'auto-rollback', v: st.active }].slice(-30);
      st.failed = st.active; st.active = valid(st.previous) ? st.previous : null; st.previous = null; st.confirmed = true; st.tries = 0;
    }
    writeState(root, st);
  }
  return st.active ? { dir: path.join(root, st.active), version: st.active, rolledBack } : { dir: null, version: builtinVersion, rolledBack };
}
// v2.5.1: re-verify an applied code folder against the signed manifest stored with it (.nyx-signed.json)
const META = new Set(['.nyx-manifest.json', '.nyx-signed.json']);
function verifyCodeDir(dir, publicKeyPem, version) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, '.nyx-signed.json'), 'utf8'));
    const mb = Buffer.from(String(rec.manifest || ''), 'base64');
    if (!verifySig(mb, rec.sig, publicKeyPem)) return { ok: false, why: 'signature' };
    const m = JSON.parse(mb.toString('utf8'));
    if (m.app !== APP_ID || m.format !== 1 || !m.files || (version && m.version !== version)) return { ok: false, why: 'manifest' };
    const want = Object.keys(m.files).map(safeRel).sort();
    const have = listTree(dir).filter(r => !META.has(r)).sort();
    if (want.length !== have.length || want.some((r, i) => r !== have[i])) return { ok: false, why: 'file set' };
    for (const rel of want) {
      const b = fs.readFileSync(path.join(dir, ...rel.split('/')));
      if (b.length !== m.files[rel].size || sha256(b) !== m.files[rel].sha256) return { ok: false, why: 'hash ' + rel };
    }
    return { ok: true, version: m.version };
  } catch (e) { return { ok: false, why: 'unsigned' }; }
}
function confirmBoot(root) { const st = readState(root); if (st.active && !st.confirmed) { st.confirmed = true; st.tries = 0; writeState(root, st); return true; } return false; }

// ---- reading / verifying a patch ----
function openPatch(src, publicKeyPem) {
  const z = zip.read(src);
  const mb = z.get('manifest.json'), sig = z.get('manifest.sig');
  if (!mb || !sig) throw Object.assign(new Error(t('updatecore.001')), { code: 'NOT_PATCH' });
  if (!verifySig(mb, sig.toString('utf8'), publicKeyPem)) throw Object.assign(new Error(t('updatecore.002')), { code: 'BAD_SIG' });
  const m = JSON.parse(mb.toString('utf8'));
  if (m.app !== APP_ID || m.format !== 1 || !m.version || !m.files) throw Object.assign(new Error(t('updatecore.003')), { code: 'BAD_MANIFEST' });
  return { zip: z, manifest: m };
}
function checkApplicable(m, { currentVersion, electron }) {
  if (cmpVer(m.version, currentVersion) <= 0) return { ok: false, code: 'NOT_NEWER', msg: t('updatecore.004', { version: m.version, currentVersion }) };
  if (m.electron && electron && m.electron !== electron) return { ok: false, code: 'NEEDS_FULL', msg: t('updatecore.005', { electron: m.electron, electron1: electron }) };
  if (!m.full && m.base && m.base !== currentVersion) return { ok: false, code: 'WRONG_BASE', msg: t('updatecore.006', { base: m.base, currentVersion }) };
  return { ok: true };
}

// ---- tree helpers (work on asar paths too: only readdir/readFile/stat) ----
function listTree(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listTree(p, base, out); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

// Apply a verified patch: stage <version>.staging from the current code + patch files, verify EVERY file, then swap in.
// opts = { root, currentDir, currentVersion, electron, publicKey, onProgress }
function applyPatch(src, opts) {
  const { root, currentDir, currentVersion, electron, publicKey, onProgress = () => {} } = opts;
  const { zip: z, manifest: m } = openPatch(src, publicKey);
  const chk = checkApplicable(m, { currentVersion, electron }); if (!chk.ok) throw Object.assign(new Error(chk.msg), { code: chk.code });
  const want = m.files; const rels = Object.keys(want).map(safeRel); // validate every path before touching the disk
  if (!/^\d+(\.\d+){1,3}(-[\w.]+)?$/.test(m.version)) throw Object.assign(new Error('bad version in patch: ' + m.version), { code: 'BAD_MANIFEST' });
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, m.version), stage = target + '.staging';
  rmrf(stage); fs.mkdirSync(stage, { recursive: true });
  let done = 0; const total = rels.length;
  try {
    for (const rel of rels) {
      const entry = 'files/' + rel; let data;
      if (z.has(entry)) data = z.get(entry);
      else if (!m.full) { try { data = fs.readFileSync(path.join(currentDir, ...rel.split('/'))); } catch (e) { throw Object.assign(new Error(t('updatecore.007') + rel), { code: 'BASE_MISSING' }); } }
      else throw Object.assign(new Error(t('updatecore.008') + rel), { code: 'PATCH_MISSING' });
      if (data.length !== want[rel].size || sha256(data) !== want[rel].sha256) throw Object.assign(new Error(t('updatecore.009') + rel + (z.has(entry) ? t('updatecore.010') : t('updatecore.011'))), { code: 'HASH_MISMATCH', file: rel });
      const out = path.join(stage, ...rel.split('/')); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, data);
      if (++done % 200 === 0) onProgress(done / total);
    }
    // final pass: re-read staged tree and verify exactly the manifest's file set
    const staged = listTree(stage);
    if (staged.length !== total) throw Object.assign(new Error(t('updatecore.012')), { code: 'TREE_MISMATCH' });
    for (const rel of rels) { const b = fs.readFileSync(path.join(stage, ...rel.split('/'))); if (sha256(b) !== want[rel].sha256) throw Object.assign(new Error(t('updatecore.013') + rel), { code: 'VERIFY_FAIL' }); }
    fs.writeFileSync(path.join(stage, '.nyx-manifest.json'), JSON.stringify({ version: m.version, changelog: m.changelog || {}, created: m.created, appliedAt: Date.now() }));
    fs.writeFileSync(path.join(stage, '.nyx-signed.json'), JSON.stringify({ manifest: z.get('manifest.json').toString('base64'), sig: z.get('manifest.sig').toString('utf8').trim() }));
  } catch (e) { rmrf(stage); throw e; }
  rmrf(target); fs.renameSync(stage, target);
  const st = readState(root);
  const prevActive = st.active && st.active !== m.version ? st.active : null;
  st.previous = prevActive; st.active = m.version; st.confirmed = false; st.tries = 0; st.electron = electron || m.electron || null;
  st.history = [...(st.history || []), { at: Date.now(), ev: 'apply', v: m.version, from: currentVersion }].slice(-30);
  writeState(root, st);
  prune(root, [st.active, st.previous]);
  onProgress(1);
  return { version: m.version, from: currentVersion, changelog: m.changelog || {}, changed: (m.changed || []).length, removed: (m.removed || []).length };
}
function prune(root, keep) {
  try { for (const d of fs.readdirSync(root)) { const p = path.join(root, d); if (fs.statSync(p).isDirectory() && !keep.includes(d)) rmrf(p); } } catch (e) {}
}
// Manual rollback → previous version (or the bundled one).
function rollback(root, builtinVersion) {
  const st = readState(root); if (!st.active) return { ok: false, msg: t('updatecore.014') };
  const from = st.active; const to = st.previous && isCodeDir(path.join(root, st.previous)) ? st.previous : null;
  st.history = [...(st.history || []), { at: Date.now(), ev: 'rollback', v: from, to: to || builtinVersion }].slice(-30);
  st.failed = from; st.active = to; st.previous = null; st.confirmed = true; st.tries = 0; writeState(root, st);
  return { ok: true, from, to: to || builtinVersion };
}

// ---- building patches (used by scripts/make-patch.js; also by tests) ----
function treeManifest(dir) { const files = {}; for (const rel of listTree(dir).sort()) { if (META.has(rel)) continue; const b = fs.readFileSync(path.join(dir, rel)); files[rel] = { sha256: sha256(b), size: b.length }; } return files; }
// fromFiles: manifest file map of the base (null → full patch). toDir: directory of the new tree.
function buildPatch({ fromFiles, fromVersion, toDir, toVersion, electron, changelog, privateKey }) {
  const files = treeManifest(toDir); const full = !fromFiles;
  const changed = Object.keys(files).filter(r => full || !fromFiles[r] || fromFiles[r].sha256 !== files[r].sha256);
  const removed = full ? [] : Object.keys(fromFiles).filter(r => !files[r]);
  const manifest = { format: 1, app: APP_ID, version: toVersion, base: full ? null : fromVersion, full, electron: electron || null, created: new Date().toISOString(), changelog: changelog || { el: [], en: [] }, changed, removed, files };
  const mb = Buffer.from(JSON.stringify(manifest, null, 1));
  const sig = signManifest(mb, privateKey);
  const zbuf = zip.write([{ name: 'manifest.json', data: mb }, { name: 'manifest.sig', data: Buffer.from(sig) }, ...changed.map(r => ({ name: 'files/' + r, data: fs.readFileSync(path.join(toDir, r)) }))]);
  return { zip: zbuf, manifest, sig };
}
module.exports = { verifyCodeDir, sha256, cmpVer, verifySig, signManifest, readState, writeState, chooseBoot, confirmBoot, openPatch, checkApplicable, applyPatch, rollback, listTree, treeManifest, buildPatch, isCodeDir, APP_ID };
