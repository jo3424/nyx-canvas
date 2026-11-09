'use strict';
// v2.5 main-process wiring: Performance, Models table, Faces v1, Sogni, sd-server helpers, router helpers.
// Everything here is lazy: nothing runs until the renderer asks for it.
const fs = require('fs'), path = require('path'), os = require('os');
const { app, nativeImage } = require('electron');
const { t } = require('./i18n');
// Identity tools act on real people's faces: sexual/nude edits of real people are refused outright (consent can't be verified).
const SEXUAL = /\b(nude|naked|nsfw|topless|undress|undressing|lingerie|porn|sex|sexy|explicit|bikini|underwear)\b|γυμν|ξεγύμν|ξεντυ|πορν|σεξ|εσώρουχ|μαγιό/i;
function wire(C, H, { procs, secrets, send, safeMedia, saveBuf, finder, systools }) {
  const perf = require('./perf');
  H('perf:snapshot', () => perf.snapshot(app, procs.pids()));
  H('proc:stopWait', (id, ms) => procs.stopWait(id, ms));
  H('proc:pids', () => procs.pids());
  // models table
  H('models:scan', async (o = {}) => {
    const gguf = require('./gguf');
    const r = await finder.find({ kind: 'gguf', roots: finder.defaultRoots(require('./paths').userHome(), systools.GVS(''), (o.extraRoots || []).filter(Boolean)), limit: 400, budgetMs: 12000, maxEntries: 200000 });
    const extra = (o.files || []).filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }).map(p => ({ path: p, size: fs.statSync(p).size }));
    const seen = new Set(); const files = [...(r.files || []), ...extra].filter(f => !seen.has(f.path) && seen.add(f.path));
    return gguf.table(files, { ctx: +o.ctx || 8192, vramGB: +o.vramGB || 24 });
  });
  // faces
  let faces = null; const F = () => faces || (faces = require('./faces')({ dataRoot: C.DATA_ROOT, nativeImage, send }));
  H('faces:status', () => F().status());
  H('faces:download', () => F().download());
  H('faces:scan', (list) => F().scan((list || []).map(String), { mediaPath: safeMedia }));
  H('faces:people', () => F().people());
  H('faces:faces', (pid) => F().faceList(pid));
  H('faces:name', (pid, n) => F().name(pid, n));
  H('faces:merge', (a, b) => F().merge(a, b));
  H('faces:reject', (fid) => F().reject(fid));
  H('faces:forget', (pid) => F().forget(pid));
  H('faces:forgetAll', () => F().forgetAll());
  H('faces:names', () => F().names());
  H('faces:forFile', (f) => F().forFile(path.basename(String(f || ''))));
  H('faces:bestFiles', (pid, n) => F().bestFiles(pid, n));

  // generic file listing (LoRA / checkpoint folder picker, shoot folders). Only lists names; never downloads anything.
  H('models:listDir', async (dir, exts) => {
    const want = new Set((exts || ['safetensors', 'gguf', 'ckpt']).map(x => '.' + String(x).toLowerCase())); const out = []; const root = String(dir || ''); if (!root || !fs.existsSync(root)) return { files: [], error: 'missing' };
    const walk = (d, depth) => { if (depth > 4 || out.length > 2000) return; let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(\.|node_modules$)/.test(e.name)) walk(p, depth + 1); } else if (want.has(path.extname(e.name).toLowerCase())) { let st; try { st = fs.statSync(p); } catch (x) { continue; } out.push({ path: p, rel: path.relative(root, p), name: path.parse(e.name).name, size: st.size, mtime: st.mtimeMs }); } } };
    walk(root, 0); out.sort((a, b) => a.rel.localeCompare(b.rel)); return { files: out };
  });
  // sd-server: A1111-compatible txt2img (LoRAs via <lora:name:w> prompt tags). Local only.
  H('sd:txt2img', async (o = {}) => {
    const port = +o.port || 7860; const body = { prompt: String(o.prompt || ''), negative_prompt: String(o.negative || ''), steps: +o.steps || 20, width: +o.width || 1024, height: +o.height || 1024, cfg_scale: +o.cfg || 5, seed: o.seed ?? -1, batch_size: 1 };
    const c = new AbortController(); const tm = setTimeout(() => c.abort(), 15 * 60e3);
    try { const r = await fetch(`http://127.0.0.1:${port}/sdapi/v1/txt2img`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: c.signal });
      if (!r.ok) throw new Error('sd-server HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200)); const j = await r.json(); const names = [];
      for (const b64 of j.images || []) names.push(await saveBuf('sd.png', Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64')));
      return { files: names };
    } finally { clearTimeout(tm); }
  });
  // batch enhance (classic, local): optional 2× upscale (high-quality resample) + levels/vibrance/sharpen in a worker
  let PW = null, pseq = 0; const ppend = new Map();
  const pw = () => { if (PW) return PW; const { Worker } = require('worker_threads'); PW = new Worker(path.join(__dirname, 'photo-worker.js')); PW.on('message', (m) => { const p = ppend.get(m.id); ppend.delete(m.id); m.ok ? p?.res(m.px) : p?.rej(new Error(m.error)); }); const w = PW;
    // v2.6 (B-29): a worker that dies (OOM, crash) rejects every pending job; only the current worker clears PW
    const fail = (e) => { for (const [id, p] of ppend) if (p.w === w) { ppend.delete(id); p.rej(e); } if (PW === w) PW = null; };
    w.on('error', fail); w.on('exit', (code) => fail(new Error('photo worker exited (' + code + ')'))); return w; };
  H('photo:enhance', async (files, o = {}) => {
    const out = [];
    for (let i = 0; i < (files || []).length; i++) {
      const f = files[i]; try {
        let img = nativeImage.createFromPath(safeMedia(f)); if (img.isEmpty()) throw new Error('image');
        let { width: w, height: h } = img.getSize(); const sc = Math.min(+o.scale || 1, Math.sqrt(64e6 / (w * h))); // cap at 64 MP
        if (sc > 1.01) { img = img.resize({ width: Math.round(w * sc), height: Math.round(h * sc), quality: 'best' }); ({ width: w, height: h } = img.getSize()); }
        const px = await new Promise((res, rej) => { const id = ++pseq; const wk = pw(); ppend.set(id, { res, rej, w: wk }); wk.postMessage({ id, px: img.toBitmap(), w, h, o }); });
        const done = nativeImage.createFromBitmap(Buffer.from(px), { width: w, height: h });
        const base = path.parse(path.basename(f)).name.replace(/^[a-z0-9]+-[a-f0-9]{6}-/, '').slice(0, 40);
        out.push({ src: f, file: await saveBuf(base + (sc > 1.01 ? '-x' + (Math.round(sc * 10) / 10) : '') + '-enh.jpg', done.toJPEG(+o.quality || 92)), w, h });
      } catch (e) { out.push({ src: f, error: String(e.message || e) }); }
      send('photo:progress', { i: i + 1, of: files.length });
    }
    setTimeout(() => { if (!ppend.size) { try { PW?.terminate(); } catch (e) {} PW = null; } }, 30000);
    return out;
  });
  // v2.6 (B-24): photo:attach removed (no caller; it read any path on disk)
  // sogni
  const sogni = () => require('./sogni');
  H('sogni:test', () => sogni().test(secrets.get('key:sogni')));
  H('sogni:run', async (kind, o = {}) => {
    if (!['identity', 'i2v', 'animate'].includes(kind)) throw new Error('kind');
    if ((kind === 'identity' || kind === 'animate') && !o.consent) throw new Error(t('v25.consent_need'));
    if ((kind === 'identity' || kind === 'animate') && SEXUAL.test(String(o.prompt || ''))) throw new Error(t('v25.sexual_block'));
    const files = (o.files || []).slice(0, 4).map(safeMedia); if (!files.length) throw new Error('image');
    const img0 = nativeImage.createFromPath(files[0]); const sz = img0.isEmpty() ? { width: 1024, height: 1024 } : img0.getSize();
    const images = files.map(f => fs.readFileSync(f)); const video = o.video ? fs.readFileSync(safeMedia(o.video)) : undefined;
    if (kind === 'animate' && !video) throw new Error('video');
    const r = await sogni().run(secrets.get('key:sogni'), kind, { ...o, images, video, w: sz.width, h: sz.height }, (p) => send('sogni:progress', p));
    const names = []; for (const b of r.bufs) names.push(await saveBuf(`sogni-${kind}.${r.ext}`, b));
    return { files: names, model: r.model, kind: r.ext === 'mp4' ? 'video' : 'image' };
  });
  // v2.5 — assistant attachments, memory/skills, guarded web automation
  require('./attach').wire(H, C);
  const memw = require('./memory').wire(H, C, { warn: (m) => send('toast', { text: m, kind: 'err', ms: 15000 }) });
  require('./webagent').wire(H, C, { saveBuf, PART: 'persist:nyxweb' });
  return { flushMemory: () => memw.flush(), flushMemorySync: () => memw.flushSync(), stop: () => { try { faces?.stop(); } catch (e) {} try { PW?.terminate(); } catch (e) {} } };
}
module.exports = { wire, SEXUAL };
