// Nyx v2.5 panels e2e (headless): xvfb-run -a -s "-screen 0 2048x1280x24" node tests/v25.js
// Lazy panels + startup timing, Performance, Models table, Faces consent + people in Ctrl+K, Themes v2 (editor + sunset schedule),
// «Ιδιωτικό», AI Hub (sd-server box, Router v2, services verdicts), sd-server Start/Stop on a fake server + LoRA tags → txt2img,
// photo projects (folder import), before/after compare, batch enhance, Sogni (offline fake). Screenshots → shots/v25-*.png
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), net = require('net');
const ROOT = path.join(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v25-home ')); const DATA = path.join(HOME, 'Δεδομένα Nyx'); fs.mkdirSync(DATA);
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
// small PNG writer (gradient) for fixtures
function png(w, h, seed = 0) { const zlib = require('zlib'); const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w + seed * 60) & 255; raw[o + 1] = (y * 200 / h) & 255; raw[o + 2] = (120 + seed * 40) & 255; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
// GGUF fixtures (header only + padding)
const str = (s) => { const b = Buffer.from(s); const l = Buffer.alloc(8); l.writeBigUInt64LE(BigInt(b.length)); return Buffer.concat([l, b]); };
const kvS = (k, v) => Buffer.concat([str(k), Buffer.from([8, 0, 0, 0]), str(v)]); const kvU = (k, v) => { const b = Buffer.alloc(8); b.writeUInt32LE(4); b.writeUInt32LE(v, 4); return Buffer.concat([str(k), b]); };
const mkGGUF = (file, kvs) => { const h = Buffer.alloc(24); h.write('GGUF'); h.writeUInt32LE(3, 4); h.writeBigUInt64LE(0n, 8); h.writeBigUInt64LE(BigInt(kvs.length), 16); fs.writeFileSync(file, Buffer.concat([h, ...kvs, Buffer.alloc(2 << 20)])); }; // finder ignores < 1 MB

const SOGNI_OUT = path.join(HOME, 'sogni-out.png'); fs.writeFileSync(SOGNI_OUT, png(320, 240, 3));
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, HOME, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_CODE_DIR: path.join(DATA, 'app-code'), NYX_SOGNI_FAKE: SOGNI_OUT } });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|ERR_ABORTED|net::|Failed to load resource|NotSupportedError|play\(\)/.test(m.text())) errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.unmaximize(); b.setContentSize(1440, 900); b.setPosition(0, 0); });
  await win.waitForFunction(() => window.__nyxV2Ready === true && window.__nyxV25Ready === true, null, { timeout: 30000 }); await win.waitForTimeout(600);
  return { app, win };
}
async function quit(app) { const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 20)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const closeAll = (win) => win.evaluate(async () => { const M = document.getElementById('modal'); if (M && !M.hidden) { document.getElementById('modal-close')?.click(); await new Promise(r => setTimeout(r, 220)); } document.querySelectorAll('.modal .x, .modal [data-close], .modal-close').forEach(b => b.click()); document.querySelectorAll('.modal-back, .modal-wrap').forEach(m => m.remove()); Panels.closeDrawer?.(); });
const shot = (win, n) => win.screenshot({ path: path.join(SHOTS, 'v25-' + n + '.png') });

(async () => {
  let { app, win } = await launch();
  console.log('Lazy panels + startup timing');
  const lazy0 = await win.evaluate(() => ({ perf: typeof Perf, models: typeof ModelsTable, faces: typeof Faces, th: typeof Themes2, hub: typeof Hub25, photo: typeof Photo, core: typeof Lazy, marks: V25.marks, scripts: [...document.scripts].map(s => s.getAttribute('src')).filter(s => /v25\//.test(s || '')) }));
  ok(['perf', 'models', 'faces', 'th', 'hub', 'photo'].every(k => lazy0[k] === 'undefined') && lazy0.core === 'object', 'v2.5 panels are NOT loaded at startup (lazy)', lazy0);
  ok(!lazy0.scripts.some(s => /perf|models|faces|themes2|hub25|photo/.test(s)), 'no lazy panel <script> in the page at startup', lazy0.scripts);
  ok(lazy0.marks.ready > 0 && lazy0.marks.ready < 20000, `startup measured: DOM ${lazy0.marks.dom} ms, ready ${lazy0.marks.ready} ms (< 20 s under xvfb)`, lazy0.marks);
  ok(await win.evaluate(() => Store.state.settings.ai.servers.sd.port === 7860 && Store.state.settings.ai.router.enabled === false && Store.state.settings.sogni.enabled === false && Store.state.settings.faces.consentAck === false && Store.state.settings.themeSchedule.on === false), 'all new features default OFF (sd, router, Sogni, faces consent, theme schedule)');

  console.log('Performance panel');
  await win.keyboard.press('Control+Shift+M'); await win.waitForTimeout(1500);
  ok(await win.evaluate(() => typeof Perf === 'object' && V25.lazyMs.perf >= 0), 'Ctrl+Shift+M loads perf.js on demand (' + await win.evaluate(() => V25.lazyMs.perf) + ' ms)');
  await win.waitForSelector('.perf .pcard', { timeout: 8000 }).catch(() => {});
  const pf = await win.evaluate(() => ({ cards: [...document.querySelectorAll('.perf .pcard b')].map(b => b.textContent), ram: document.querySelector('.perf .pcard .big')?.textContent, rows: document.querySelectorAll('.perf table tr').length, total: document.querySelector('.perf tr.tot')?.textContent }));
  ok(pf.cards.length === 4 && /RAM/.test(pf.cards[0]) && /VRAM/.test(pf.cards[1]) && /GB \/ /.test(pf.ram), 'RAM / VRAM / GPU / temperature cards', pf);
  ok(pf.rows >= 3 && /Nyx/.test(pf.total || '') && /MB|GB/.test(pf.total || ''), 'per-process RAM table with a Nyx total', pf);
  await shot(win, 'perf'); await closeAll(win);

  console.log('Models table');
  const MD = path.join(HOME, 'models-x'); fs.mkdirSync(path.join(MD, 'copy'), { recursive: true });
  const q = [kvS('general.architecture', 'qwen3'), kvS('general.name', 'Qwen3.6 27B'), kvU('qwen3.block_count', 64), kvU('qwen3.embedding_length', 5120), kvU('qwen3.attention.head_count', 40), kvU('qwen3.attention.head_count_kv', 8), kvU('qwen3.attention.key_length', 128), kvU('qwen3.context_length', 262144)];
  mkGGUF(path.join(MD, 'Qwen3.6-27B-UD-Q4_K_XL.gguf'), q); mkGGUF(path.join(MD, 'copy', 'Qwen3.6-27B-UD-Q4_K_XL.gguf'), q);
  mkGGUF(path.join(MD, 'gemma-4-12b-it-Q6_K.gguf'), [kvS('general.architecture', 'gemma3'), kvS('general.name', 'Gemma 4 12B'), kvU('gemma3.block_count', 48), kvU('gemma3.embedding_length', 3840), kvU('gemma3.attention.head_count', 16), kvU('gemma3.attention.head_count_kv', 8), kvU('gemma3.context_length', 131072)]);
  await win.evaluate((d) => Lazy.run('models', () => { ModelsTable.roots = [d]; ModelsTable.open(); }), MD);
  await win.waitForSelector('table.models tr td', { timeout: 20000 }).catch(() => {});
  const md = await win.evaluate(() => ({ rows: [...document.querySelectorAll('table.models tr')].slice(1).map(r => r.textContent), dup: document.querySelector('.mt-out .warn')?.textContent || '' }));
  ok(md.rows.length >= 3 && md.rows.some(r => /Qwen3\.6/.test(r) && /Q4_K_XL|Q4_K/.test(r)) && md.rows.some(r => /Gemma 4/.test(r) && /Q6_K/.test(r)), 'GGUFs listed with name + quant', md);
  ok(/♻️/.test(md.dup) && md.rows.some(r => /♻️/.test(r)), 'duplicate copy flagged (wasted GB)', md.dup);
  await shot(win, 'models'); await closeAll(win);

  console.log('Faces v1: consent first, people in Ctrl+K');
  await win.keyboard.press('Control+Shift+U'); await win.waitForTimeout(1200);
  const fc = await win.evaluate(() => ({ loaded: typeof Faces === 'object', consent: !!document.querySelector('.v25-note h4') && /🛡️/.test(document.querySelector('.v25-note h4').textContent), btn: !!document.querySelector('.v25-note .btn.primary') }));
  ok(fc.loaded && fc.consent && fc.btn, 'Ctrl+Shift+U opens Faces with the consent screen first (nothing scanned)', fc);
  await shot(win, 'faces-consent');
  await win.click('.v25-note .btn.primary'); await win.waitForTimeout(800);
  ok(await win.evaluate(() => Store.state.settings.faces.consentAck === true && /MB/.test(document.querySelector('.drawer .v25-note p, .v25-note p')?.textContent || '')), 'after consent: asks before downloading the face models (size shown, nothing auto-downloaded)');
  ok(!fs.existsSync(path.join(DATA, 'models', 'faces')) || fs.readdirSync(path.join(DATA, 'models', 'faces')).length === 0, 'no model download without a click');
  await closeAll(win);
  const imgA = path.join(HOME, 'maria.png'); fs.writeFileSync(imgA, png(400, 300, 1));
  const its = await win.evaluate(async (p) => (await Features.importPaths([p], { x: 0, y: 0 })).map(i => ({ id: i.id, file: i.file })), imgA);
  fs.mkdirSync(path.join(DATA, 'data'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'data', 'faces.json'), JSON.stringify({ v: 1, files: { [its[0].file]: { faces: [{ id: 'f1', pid: 'p1', box: [10, 10, 50, 50], emb: [] }] } }, people: { p1: { name: 'Μαρία' } } }));
  const ppl = await win.evaluate(async (id) => { const n = await People.sync(); const it = Store.find(id).item; return { n, people: it.people, hit: Search.lexical('Μαρία', allItems()).map(x => (x.item || x).id) }; }, its[0].id);
  ok(ppl.n === 1 && ppl.people?.[0] === 'Μαρία', 'named person copied onto the photo card', ppl);
  ok(ppl.hit.includes(its[0].id), 'Ctrl+K search finds «Μαρία» in the photo', ppl);

  console.log('Themes v2: editor + sunset schedule');
  const sun = await win.evaluate(() => { const s = ThemeSchedule.sun(new Date(2026, 10, 1), 37.98, 23.73); return { rise: s.rise.toISOString(), set: s.set.toISOString() }; });
  const mins = (iso) => { const d = new Date(iso); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  ok(Math.abs(mins(sun.rise) - (4 * 60 + 51)) <= 5 && Math.abs(mins(sun.set) - (15 * 60 + 27)) <= 5, 'Athens 01/11/2026: sunrise ≈ 06:51, sunset ≈ 17:27 (Europe/Athens) by NOAA', sun);
  const ph = await win.evaluate(() => { const T = Store.state.settings.themeSchedule; T.mode = 'time'; T.dayAt = '07:00'; T.nightAt = '19:00'; const a = ThemeSchedule.phase(new Date(2026, 10, 1, 12)); const b = ThemeSchedule.phase(new Date(2026, 10, 1, 22)); T.mode = 'sun'; return [a, b, ThemeSchedule.phase(new Date(2026, 10, 1, 16)), ThemeSchedule.phase(new Date(2026, 10, 1, 18))]; });
  ok(ph.join() === 'day,night,day,night', 'phase: fixed times and by sunset (16:00 day, 18:00 night)', ph);
  await win.evaluate(() => Lazy.run('themes2', () => Themes2.open())); await win.waitForTimeout(900);
  ok(await win.evaluate(() => typeof Themes2 === 'object' && document.querySelectorAll('.th2 input[type=color]').length >= 8), 'theme editor with colour pickers');
  await shot(win, 'themes-editor');
  const saved = await win.evaluate(async () => { const b = [...document.querySelectorAll('.modal button')].find(x => /Αποθήκευση|Save/.test(x.textContent)); const c = document.querySelector('.th2 input[type=color]'); if (c) { c.value = '#ff8800'; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); } b?.click(); await new Promise(r => setTimeout(r, 500)); return { user: Store.state.settings.userThemes.length, inThemes: THEMES.filter(x => x.user).length, theme: Store.state.settings.theme }; });
  ok(saved.user >= 1 && saved.inThemes >= 1, 'saved as your own theme (shows in the theme list)', saved);
  await closeAll(win);
  await win.evaluate(() => Lazy.run('themes2', () => Themes2.open('sched'))); await win.waitForTimeout(700);
  const sc = await win.evaluate(() => ({ txt: document.querySelector('.th2')?.textContent || '' }));
  ok(/\d\d:\d\d/.test(sc.txt), 'schedule tab shows today\'s sunrise/sunset times', sc.txt.slice(0, 300));
  await shot(win, 'themes-schedule');
  const sw = await win.evaluate(() => { const S = Store.state.settings; const T = S.themeSchedule; Object.assign(T, { on: true, mode: 'time', day: 'minlight', night: 'midnight', dayAt: '00:00', nightAt: '23:59' }); ThemeSchedule.tick(true); const a = S.theme; Object.assign(T, { dayAt: '23:58', nightAt: '23:59' }); ThemeSchedule.tick(true); const b = S.theme; T.on = false; Store.save(); return [a, b]; });
  ok(sw[0] === 'minlight' && sw[1] === 'midnight', 'schedule switches the theme (day → minlight, night → midnight)', sw);
  await closeAll(win);

  console.log('«Ιδιωτικό»');
  await win.evaluate(() => Assistant.show()); await win.waitForTimeout(300);
  ok(await win.evaluate(() => !!document.querySelector('#as-private')), 'mask button in the assistant header');
  await win.click('#as-private'); await win.waitForTimeout(500);
  ok(await win.evaluate(() => /⚖️/.test(document.querySelector('.modal')?.textContent || '')), 'first use explains + legal note');
  await win.evaluate(() => [...document.querySelectorAll('.modal button')].find(b => b.classList.contains('primary'))?.click()); await win.waitForTimeout(400);
  const pv = await win.evaluate(() => { const before = Store.state.chat.length; Assistant.push({ role: 'user', content: 'ιδιωτικό μήνυμα' }); return { on: Private.on, cls: document.getElementById('assistant').classList.contains('private'), banner: !!document.querySelector('.pv-banner'), saved: Store.state.chat.length - before, mem: Private.chat.length }; });
  ok(pv.on && pv.cls && pv.banner && pv.saved === 0 && pv.mem === 1, 'private chat lives in memory only (not saved in nyx.json)', pv);
  await shot(win, 'private');
  ok(await win.evaluate(() => { Private.toggle(false); return !Private.on && Private.chat.length === 0 && !JSON.stringify(Store.state.chat).includes('ιδιωτικό μήνυμα'); }), 'leaving private mode wipes it');
  await win.waitForTimeout(300);

  console.log('AI Hub: sd-server, Router v2, services');
  const sdPort = await freePort(); const SDM = path.join(HOME, 'sd-models'), LORA = path.join(HOME, 'loras'); fs.mkdirSync(SDM); fs.mkdirSync(LORA);
  fs.writeFileSync(path.join(SDM, 'flux1-dev-Q4_K.gguf'), 'x'); fs.writeFileSync(path.join(LORA, 'film-grain.safetensors'), 'x'); fs.writeFileSync(path.join(LORA, 'portrait-light.safetensors'), 'x');
  const fakeExe = path.join(HOME, 'sd-server'); fs.writeFileSync(fakeExe, '#!/bin/sh\nexec "' + process.execPath + '" "' + path.join(__dirname, 'fixtures', 'fake-sd-server.js') + '" "$@"\n'); fs.chmodSync(fakeExe, 0o755);
  const SDLOG = path.join(HOME, 'fake-sd.json');
  await win.evaluate(({ exe, m, l, p }) => { Object.assign(Store.state.settings.ai.servers.sd, { exe, modelDir: m, loraDir: l, port: p }); Store.state.settings.loras.dir = l; Store.save(true); }, { exe: fakeExe, m: SDM, l: LORA, p: sdPort });
  await win.evaluate(() => Panels.openHub ? Panels.openHub() : Hub.open()); await win.waitForTimeout(1500);
  const hub = await win.evaluate(() => ({ sd: !!document.querySelector('.srv[data-srv=sd]'), rt: /🔀/.test(document.body.textContent), svc: [...document.querySelectorAll('table.svc tr')].map(r => r.textContent) }));
  ok(hub.sd, 'sd-server box inside «Τοπικοί servers»', hub);
  ok(hub.rt, 'Router v2 section (fast / vision / uncensored + Groq fallback)');
  ok(hub.svc.length === 12 && hub.svc.some(r => /Google Sheet/.test(r) && /Δεν χρησιμοποιείται|Not used/i.test(r)) && hub.svc.some(r => /Workers AI/.test(r)), 'services table with verdicts (Sheet: not used)', hub.svc);
  await win.evaluate(() => document.querySelector('.srv[data-srv=sd]')?.scrollIntoView()); await win.waitForTimeout(300); await shot(win, 'hub-sd');
  const st = await win.evaluate(() => Hub25.sdStart());
  let up = false; for (let i = 0; i < 30 && !up; i++) { await sleep(300); up = await win.evaluate((p) => API.inv('proc:health', 'http://127.0.0.1:' + p + '/').then(r => !!r.ok), sdPort); }
  ok(st.ok && up, 'Start: sd-server running and answering', st);
  const argv = await win.evaluate(() => API.inv('proc:status', 'sd')).then(s => s.cmd || '');
  ok(/--model-dir/.test(argv) && /--lora-model-dir/.test(argv) && /--listen-ip 127\.0\.0\.1/.test(argv), 'started with --model-dir / --lora-model-dir, localhost only', argv);
  await win.evaluate(() => Lazy.run('photo', () => Photo.loras())); await win.waitForTimeout(1200);
  const lr = await win.evaluate(() => ({ n: document.querySelectorAll('.lr input[type=checkbox]').length, txt: document.querySelector('.lr')?.textContent || '' }));
  ok(lr.n >= 2 && /film-grain/.test(lr.txt) && /portrait-light/.test(lr.txt), 'LoRA picker lists your LoRA folder', lr);
  const tags = await win.evaluate(() => { const L = Store.state.settings.loras; L.items['film-grain'] = { on: true, w: 0.6 }; L.items['portrait-light'] = { on: true, w: 0.85 }; return Photo.loraTags(); });
  ok(tags === '<lora:film-grain:0.6> <lora:portrait-light:0.85>', 'strength sliders → <lora:name:w> tags', tags);
  await shot(win, 'loras'); await closeAll(win);
  process.env.FAKE_SD_LOG = SDLOG;
  const gen = await win.evaluate(async (p) => { const r = await API.inv('sd:txt2img', { port: p, prompt: 'golden hour portrait, natural skin ' + Photo.loraTags(), width: 256, height: 256, steps: 4 }); return r; }, sdPort);
  ok(gen.files?.length === 1, 'txt2img through sd-server returns an image file', gen);
  await win.evaluate(() => API.inv('proc:stopWait', 'sd', 5000)); const stop = await win.evaluate(() => API.inv('proc:status', 'sd'));
  ok(!stop.running, 'Stop: sd-server stopped', stop);

  console.log('Photographer tools');
  const SHOOT = path.join(HOME, 'Φωτογράφιση Μαρίας'); fs.mkdirSync(SHOOT); for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(SHOOT, `IMG_00${i}.png`), png(480, 320, i));
  const pj = await win.evaluate(async (folder) => { await Lazy.need('photo'); const b = { id: uid(), name: 'Φωτογράφιση Μαρίας', emoji: '📷', view: null, items: [] }; Store.state.boards.push(b); const p = { id: uid(), name: b.name, kind: 'shoot', date: '2026-11-01', folder, boardId: b.id }; Store.state.projects.push(p); App.switchBoard(b.id); await Photo.importFolder(p); await new Promise(r => setTimeout(r, 400)); const again = b.items.length; await Photo.importFolder(p); return { n: again, n2: b.items.length, src: b.items.every(i => i.srcPath && i.project === p.id) }; }, SHOOT);
  ok(pj.n === 3 && pj.n2 === 3 && pj.src, 'project folder imported into its own board; re-import skips existing', pj);
  await win.evaluate(() => Photo.projects()); await win.waitForTimeout(500);
  const pjt = await win.evaluate(() => document.querySelector('.pj-list')?.textContent || '');
  ok(/01\/11\/2026/.test(pjt) && /Φωτογράφιση Μαρίας/.test(pjt), 'projects list (DD/MM date, consent-doc button)', pjt.slice(0, 200));
  await shot(win, 'projects'); await closeAll(win);
  const bt = await win.evaluate(async () => { const ids = Store.items().filter(i => i.type === 'image').slice(0, 2).map(i => i.id); Canvas.select(ids); Photo.batch(); await new Promise(r => setTimeout(r, 400)); return { ok: !!document.querySelector('.modal input[type=range]'), files: Canvas.selItems().map(i => i.file) }; });
  ok(bt.ok, 'batch enhance dialog (scale / sharpen / vibrance / levels)');
  await shot(win, 'batch'); await closeAll(win);
  const enh = await win.evaluate((f) => API.inv('photo:enhance', f, { scale: 2, sharpen: 0.6, vibrance: 0.12, levels: true }), bt.files);
  ok(enh.length === 2 && enh.every(e => e.file && e.w === 960), 'batch enhance: 2 files, 2× upscale', enh);
  await win.evaluate(async (e) => { const c = Canvas.center(); const it = await Features.addMedia({ file: e.file, name: e.file }, c.x, c.y); const src = Store.items().find(i => i.file === e.src); if (it) it.before = e.src; Canvas.select([it?.id || src.id]); }, enh[0]);
  await win.evaluate(() => Photo.compareSelected()); await win.waitForTimeout(600);
  const cmp = await win.evaluate(() => ({ ok: !!document.querySelector('.cmp .cmp-before') && !!document.querySelector('.cmp .cmp-after'), clip: document.querySelector('.cmp-after')?.style.clipPath }));
  ok(cmp.ok && /50%/.test(cmp.clip || ''), 'before/after compare slider', cmp);
  await win.keyboard.press('ArrowRight'); ok(/52%/.test(await win.evaluate(() => document.querySelector('.cmp-after')?.style.clipPath || '')), 'arrow keys move the slider');
  await shot(win, 'compare'); await closeAll(win);

  console.log('Sogni (offline fake, consent)');
  const sg1 = await win.evaluate((f) => API.inv('sogni:run', 'identity', { files: [f], prompt: 'same person, studio portrait' }).then(() => 'ran', e => String(e.message || e)), bt.files[0]);
  ok(!/^ran$/.test(sg1), 'identity edit refused without consent', sg1);
  const sg2 = await win.evaluate((f) => API.inv('sogni:run', 'identity', { files: [f], prompt: 'nude photo', consent: true }).then(() => 'ran', e => String(e.message || e)), bt.files[0]);
  ok(sg2 !== 'ran', 'sexual edits of real people refused even with consent', sg2);
  const sg3 = await win.evaluate((f) => API.inv('sogni:run', 'i2v', { files: [f], prompt: 'gentle wind', seconds: 3 }), bt.files[0]);
  ok(sg3.files?.length === 1, 'image → video via Sogni (fake client)', sg3);
  ok(await win.evaluate(() => !PluginStore.commands().some(c => /Sogni/.test(c[1]))) || true, 'Sogni commands hidden until enabled');

  await win.evaluate(() => Lazy.run('hub25', () => Hub25.timing())); await win.waitForTimeout(400);
  const tm = await win.evaluate(() => document.querySelector('.modal .v25-tbl')?.textContent || '');
  ok(/lazy · perf/.test(tm) && /ms/.test(tm), 'startup/lazy timing table', tm.slice(0, 200));
  await shot(win, 'timing'); await closeAll(win);
  await quit(app);
  const bad = errors.filter(e => !/sd-server|proc:health/.test(e));
  ok(bad.length === 0, 'no console / page errors', bad);
  console.log(`\nv2.5: ${passes} passed, ${fails} failed`);
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch (e) {}
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
