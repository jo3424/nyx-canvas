// Runs inside Electron (main process): end-to-end Faces pipeline on real photos with a local mirror for the model download.
const { app, nativeImage } = require('electron'); const path = require('path'), fs = require('fs'), http = require('http');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const out = { ok: false }; try {
    const root = process.env.FX_ROOT, mirrorDir = process.env.FX_MIRROR;
    const srv = http.createServer((q, s) => { const f = path.join(mirrorDir, path.basename(q.url)); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200); fs.createReadStream(f).pipe(s); }).listen(0);
    await new Promise(r => srv.once('listening', r)); process.env.NYX_FACES_MIRROR = `http://127.0.0.1:${srv.address().port}/`;
    const media = path.join(root, 'media');
    const l = nativeImage.createFromPath(path.join(media, 'lena.jpg')); fs.writeFileSync(path.join(media, 'lena-small.jpg'), l.resize({ width: 300 }).toJPEG(90));
    const prog = []; const faces = require('../main/faces')({ dataRoot: () => root, nativeImage, send: (c, p) => prog.push(p) });
    out.before = (await faces.status()).ready; out.dl = (await faces.download()).ready; out.progress = prog.length > 0;
    const t0 = Date.now(); out.scan = await faces.scan(['lena.jpg', 'lena-small.jpg', 'messi5.jpg'], { mediaPath: f => path.join(media, f) }); out.ms = Date.now() - t0;
    out.rescan = await faces.scan(['lena.jpg'], { mediaPath: f => path.join(media, f) });
    const ppl = faces.people(); out.people = ppl.map(p => ({ files: p.files, faces: p.faces, thumb: p.thumb.length }));
    const lena = ppl.find(p => p.files.includes('lena.jpg')); out.lenaBoth = !!lena && lena.files.includes('lena-small.jpg');
    faces.name(lena.pid, 'Lena'); out.names = faces.names(); out.forFile = faces.forFile('lena.jpg');
    out.best = faces.bestFiles(lena.pid, 2);
    out.dbFile = fs.existsSync(path.join(root, 'data', 'faces.json'));
    faces.forget(lena.pid); out.afterForget = faces.people().filter(p => p.files.includes('lena.jpg')).length;
    faces.stop(); srv.close(); out.ok = true;
  } catch (e) { out.error = String(e.stack || e); }
  fs.writeFileSync(process.env.FX_OUT, JSON.stringify(out, null, 1)); app.exit(0);
});
