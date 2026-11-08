'use strict';
// v2.5 Faces v1 — local only. Detect (YuNet) → embed (SFace) → cluster → name. Nothing leaves the PC.
// The ONNX runtime (WASM) + both models (~54 MB) are downloaded on demand into <data>/models/faces with pinned SHA-256,
// so the update patch stays small. Data: <data>/data/faces.json (embeddings) + <data>/faces/*.jpg (face thumbnails).
const fs = require('fs'), fsp = fs.promises, path = require('path'), crypto = require('crypto');
const { Worker } = require('worker_threads');
const F = require('./faces-core');
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
const ASSETS = [
  { name: 'ort.wasm.min.js', url: ORT + 'ort.wasm.min.js', size: 53796, sha: 'b8a78c408c40da65fdc8ba0846f7b2948e92a4c6d6b23cc8e4165e428ad95443' },
  { name: 'ort-wasm-simd-threaded.mjs', url: ORT + 'ort-wasm-simd-threaded.mjs', size: 24738, sha: '30ed0b5cd1182ede931fea448afb567d4dc705ec957af09f108a2be5f770dac3' },
  { name: 'ort-wasm-simd-threaded.wasm', url: ORT + 'ort-wasm-simd-threaded.wasm', size: 14848852, sha: '4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d' },
  { name: 'face_detection_yunet_2023mar.onnx', url: 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx', size: 232589, sha: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4' },
  { name: 'face_recognition_sface_2021dec.onnx', url: 'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx', size: 38696353, sha: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79' },
];
module.exports = function makeFaces({ dataRoot, nativeImage, send }) {
  const DIR = () => path.join(dataRoot(), 'models', 'faces');
  const DB = () => path.join(dataRoot(), 'data', 'faces.json');
  const THUMBS = () => path.join(dataRoot(), 'faces');
  const sha = (f) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
  const okCache = new Map();
  async function status() {
    const missing = []; let have = 0;
    for (const a of ASSETS) { const p = path.join(DIR(), a.name); let st = null; try { st = fs.statSync(p); } catch (e) {}
      if (!st || st.size !== a.size) { missing.push(a.name); continue; }
      const k = p + st.mtimeMs; if (!okCache.has(k)) okCache.set(k, (await sha(p)) === a.sha); if (!okCache.get(k)) missing.push(a.name); else have += a.size; }
    return { ready: !missing.length, missing, have, total: ASSETS.reduce((s, a) => s + a.size, 0), dir: DIR() };
  }
  let dl = null;
  function download() {
    if (dl) return dl;
    dl = (async () => {
      await fsp.mkdir(DIR(), { recursive: true }); const mirror = process.env.NYX_FACES_MIRROR; const total = ASSETS.reduce((s, a) => s + a.size, 0); let done = 0;
      for (const a of ASSETS) {
        const p = path.join(DIR(), a.name);
        try { if (fs.statSync(p).size === a.size && (await sha(p)) === a.sha) { done += a.size; continue; } } catch (e) {}
        const url = mirror ? mirror.replace(/\/?$/, '/') + a.name : a.url;
        const r = await fetch(url, { redirect: 'follow' }); if (!r.ok) throw new Error(`${a.name}: HTTP ${r.status}`);
        const tmp = p + '.part'; const out = fs.createWriteStream(tmp); const h = crypto.createHash('sha256'); let got = 0;
        for await (const chunk of r.body) { h.update(chunk); got += chunk.length; if (!out.write(chunk)) await new Promise(r2 => out.once('drain', r2)); send?.('faces:progress', { file: a.name, done: done + got, total }); }
        await new Promise(r2 => out.end(r2));
        if (h.digest('hex') !== a.sha) { await fsp.unlink(tmp).catch(() => {}); throw new Error(`${a.name}: SHA-256 mismatch`); }
        await fsp.rename(tmp, p); done += a.size;
      }
      return status();
    })().finally(() => { dl = null; });
    return dl;
  }
  // worker
  let W = null, seq = 0; const pend = new Map();
  function worker() {
    if (W) return W;
    W = new Worker(path.join(__dirname, 'faces-worker.js'), { workerData: { dir: DIR() } });
    W.on('message', (m) => { const p = pend.get(m.id); if (!p) return; pend.delete(m.id); m.ok ? p.res(m.r) : p.rej(new Error(m.error)); });
    W.on('error', (e) => { for (const p of pend.values()) p.rej(e); pend.clear(); W = null; });
    W.on('exit', () => { W = null; });
    return W;
  }
  const call = (msg, transfer) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); worker().postMessage({ ...msg, id }, transfer || []); });
  let idleT = null; const idle = () => { clearTimeout(idleT); idleT = setTimeout(() => { try { W?.terminate(); } catch (e) {} W = null; }, 90000); }; // free ~150 MB when unused
  // DB
  let db = null;
  function load() { if (db) return db; try { db = JSON.parse(fs.readFileSync(DB(), 'utf8')); } catch (e) { db = null; } db ||= { v: 1, files: {}, people: {} }; db.files ||= {}; db.people ||= {}; return db; }
  let saveT = null; function save(now) { clearTimeout(saveT); const w = () => { fs.mkdirSync(path.dirname(DB()), { recursive: true }); const tmp = DB() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, DB()); }; if (now) w(); else saveT = setTimeout(w, 400); }
  const embOf = (f) => f._e || (f._e = F.fromB64(f.emb));
  function centroids() { const by = {}; for (const fr of Object.values(load().files)) for (const f of fr.faces) if (f.pid && !f.reject) (by[f.pid] ||= []).push(embOf(f)); const out = {}; for (const [pid, l] of Object.entries(by)) out[pid] = { c: F.centroid(l), n: l.length }; return out; }
  const newPid = () => 'p' + crypto.randomBytes(5).toString('hex');
  async function analyzeFile(abs, rel) {
    let img = nativeImage.createFromPath(abs); if (img.isEmpty()) throw new Error('image');
    let { width: w, height: h } = img.getSize(); const m = Math.max(w, h); if (m > 1280) { img = img.resize({ width: Math.round(w * 1280 / m), height: Math.round(h * 1280 / m), quality: 'best' }); ({ width: w, height: h } = img.getSize()); }
    const k = 640 / Math.max(w, h); const sm = img.resize({ width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), quality: 'best' }); const ss = sm.getSize();
    const faces = await call({ op: 'analyze', big: img.toBitmap(), bw: w, bh: h, small: sm.toBitmap(), sw: ss.width, sh: ss.height, scaleSmall: w / ss.width, score: 0.8 });
    // thumbnails (96 px, a bit of margin)
    await fsp.mkdir(THUMBS(), { recursive: true });
    for (const f of faces) {
      f.id = 'f' + crypto.randomBytes(5).toString('hex'); const [x, y, bw, bh] = f.box; const mg = 0.25;
      const cx = Math.max(0, Math.round(x - bw * mg)), cy = Math.max(0, Math.round(y - bh * mg)); const cw = Math.min(w - cx, Math.round(bw * (1 + 2 * mg))), ch = Math.min(h - cy, Math.round(bh * (1 + 2 * mg)));
      try { const th = img.crop({ x: cx, y: cy, width: cw, height: ch }).resize({ width: 96, height: Math.round(96 * ch / cw), quality: 'best' }); await fsp.writeFile(path.join(THUMBS(), f.id + '.jpg'), th.toJPEG(82)); } catch (e) {}
    }
    return { faces, w, h };
  }
  async function scan(list, { mediaPath }) {
    const st = await status(); if (!st.ready) throw Object.assign(new Error('NOT_READY'), { code: 'NOT_READY' });
    const D = load(); let scanned = 0, found = 0, created = 0, skipped = 0, errors = 0; const C = centroids();
    for (let i = 0; i < list.length; i++) {
      const rel = list[i]; const abs = mediaPath(rel); let mt = 0; try { mt = fs.statSync(abs).mtimeMs; } catch (e) { errors++; continue; }
      if (D.files[rel] && D.files[rel].mtime === mt) { skipped++; continue; }
      let r; try { r = await analyzeFile(abs, rel); } catch (e) { errors++; continue; }
      for (const f of r.faces) { const a = F.assign(embOf(f), C); if (a.pid) { f.pid = a.pid; f.sim = Math.round(a.sim * 1000) / 1000; const c = C[a.pid]; c.n++; } else { f.pid = newPid(); D.people[f.pid] = { name: '', created: Date.now() }; C[f.pid] = { c: embOf(f), n: 1 }; created++; } }
      D.files[rel] = { mtime: mt, w: r.w, h: r.h, faces: r.faces.map(({ _e, ...f }) => f) }; scanned++; found += r.faces.length;
      send?.('faces:progress', { scan: i + 1, of: list.length, faces: found });
    }
    save(true); idle();
    return { scanned, skipped, faces: found, newPeople: created, errors };
  }
  function thumb(fid) { try { return 'data:image/jpeg;base64,' + fs.readFileSync(path.join(THUMBS(), fid + '.jpg')).toString('base64'); } catch (e) { return ''; } }
  function people() {
    const D = load(); const out = {};
    for (const [file, fr] of Object.entries(D.files)) for (const f of fr.faces) { if (!f.pid || f.reject) continue; const p = out[f.pid] ||= { pid: f.pid, name: D.people[f.pid]?.name || '', files: new Set(), faces: 0, best: null }; p.files.add(file); p.faces++; if (!p.best || f.score * f.box[2] > p.best.score * p.best.box[2]) p.best = f; }
    return Object.values(out).map(p => ({ pid: p.pid, name: p.name, faces: p.faces, files: [...p.files], thumb: p.best ? thumb(p.best.id) : '' })).sort((a, b) => (!!b.name - !!a.name) || b.faces - a.faces);
  }
  function faceList(pid) { const D = load(); const out = []; for (const [file, fr] of Object.entries(D.files)) for (const f of fr.faces) if (f.pid === pid && !f.reject) out.push({ id: f.id, file, box: f.box, score: f.score, sim: f.sim ?? 1, thumb: thumb(f.id) }); return out.sort((a, b) => b.score - a.score); }
  function name(pid, nm) { const D = load(); (D.people[pid] ||= { created: Date.now() }).name = String(nm || '').trim().slice(0, 80); // same name = same person → merge
    const other = Object.entries(D.people).find(([id, p]) => id !== pid && p.name && p.name.toLowerCase() === D.people[pid].name.toLowerCase()); if (other) merge(other[0], pid); save(); return true; }
  function merge(into, from) { const D = load(); for (const fr of Object.values(D.files)) for (const f of fr.faces) if (f.pid === from) f.pid = into; if (!D.people[into]?.name && D.people[from]?.name) D.people[into].name = D.people[from].name; delete D.people[from]; save(); return true; }
  function reject(fid) { const D = load(); for (const fr of Object.values(D.files)) for (const f of fr.faces) if (f.id === fid) { const np = newPid(); D.people[np] = { name: '', created: Date.now() }; f.pid = np; } save(); return true; }
  function forget(pid) { const D = load(); for (const fr of Object.values(D.files)) fr.faces = fr.faces.filter(f => { if (f.pid !== pid) return true; fsp.unlink(path.join(THUMBS(), f.id + '.jpg')).catch(() => {}); return false; }); delete D.people[pid]; save(true); return true; }
  async function forgetAll() { db = { v: 1, files: {}, people: {} }; save(true); await fsp.rm(THUMBS(), { recursive: true, force: true }); return true; }
  function names() { const D = load(); const out = {}; for (const [file, fr] of Object.entries(D.files)) { const n = [...new Set(fr.faces.map(f => D.people[f.pid]?.name).filter(Boolean))]; out[file] = { n, faces: fr.faces.length }; } return out; }
  function forFile(rel) { const D = load(); const fr = D.files[rel]; if (!fr) return null; return { w: fr.w, h: fr.h, faces: fr.faces.map(f => ({ id: f.id, box: f.box, pid: f.pid, name: D.people[f.pid]?.name || '' })) }; }
  function bestFiles(pid, n = 2) { return faceList(pid).sort((a, b) => b.score * b.box[2] - a.score * a.box[2]).map(f => f.file).filter((f, i, a) => a.indexOf(f) === i).slice(0, n); }
  function stop() { try { W?.terminate(); } catch (e) {} W = null; }
  return { ASSETS, status, download, scan, people, faceList, name, merge, reject, forget, forgetAll, names, forFile, bestFiles, stop, _db: load };
};
module.exports.ASSETS = ASSETS;
