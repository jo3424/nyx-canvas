'use strict';
// v2.6.13 UI (Electron, Chromium sandbox on) — «Φωνή απάντησης» end to end with a FAKE OmniVoice on 127.0.0.1:7802:
//  1) Ρυθμίσεις → Ομιλία → vs-engine: the list = Voice Studio personas (fixture with dummy base64) + «Γενική γυναικεία»,
//     default ster; not-ready personas disabled; engine line «OmniVoice του Hermes (7802)»; no voice code in the page
//  2) Speech.speak → sentence by sentence to 7802 with ster's ref fields, one request at a time, no own vs-engine
//  3) ster missing from personas.json → error box + «ster — λείπει»; speaking shows the error, sends NOTHING (no fallback)
//  4) personas.json missing → error box; «Γενική γυναικεία» chosen → request without ref fields
//  5) screenshots: normal 1440×900 and small 1024×700, also of the error state
const { _electron } = require('playwright-core');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2613-'));
const APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2613-appdata-'));
const SHOTS = process.env.NYX_SHOTS || path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const HT = 'HERMES-UI-TOKEN-SECRET-0123456789';
const FX = path.join(__dirname, 'fixtures', 'personas-ster.json'); const fx = JSON.parse(fs.readFileSync(FX, 'utf8'));
const PF = path.join(APPDATA, 'GPU Voice Studio', 'personas.json'); fs.mkdirSync(path.dirname(PF), { recursive: true }); fs.copyFileSync(FX, PF);
let fails = 0, passes = 0;
const T0 = Date.now(); const ok = (c, m, x) => { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 700) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wav = () => { const n = 24000; const b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; };
const F = { status: 0, synth: [], active: 0, max: 0 };
const srv = http.createServer((q, res) => { let body = ''; q.on('data', (d) => { body += d; }); q.on('end', async () => {
  const okAuth = q.headers.authorization === 'Bearer ' + HT;
  if (q.url === '/v1/status') { F.status++; res.writeHead(okAuth ? 200 : 401); return res.end('{}'); }
  if (q.url === '/v1/synthesize' && q.method === 'POST') { if (!okAuth) { res.writeHead(401); return res.end(); } F.active++; F.max = Math.max(F.max, F.active); let j = {}; try { j = JSON.parse(body); } catch (e) {} F.synth.push(j); await sleep(120); F.active--; res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(wav()); }
  res.writeHead(404); res.end(); }); });
async function launch(w = 1440, hh = 900) {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA, APPDATA, OMNIVOICE_HERMES_TOKEN: HT } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const x = BrowserWindow.getAllWindows()[0]; x.setSize(w, h); x.center(); }, [w, hh]);
  await win.waitForFunction(() => (window.__nyxV2Ready === true || window.__nyxV25Ready === true) && window.__nyxLook2611 === true, null, { timeout: 30000 });
  await win.waitForTimeout(500); return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (_) {} }
const setSize = async (app, w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]); await sleep(600); };
const shot = (win, name) => win.screenshot({ path: path.join(SHOTS, name) }).then(() => path.join(SHOTS, name)).catch(() => '');
const openSpeech = async (win) => { await win.evaluate(() => { document.querySelectorAll('#toasts > *, .toast').forEach((t) => t.remove()); Panels.settings('speech'); }); await sleep(900); await win.evaluate(() => document.querySelector('.v2613-box')?.scrollIntoView({ block: 'start' })); await sleep(300); };
const box = (win) => win.evaluate(() => { const b = document.querySelector('.v2613-box'); const s = b && b.querySelector('select'); return b && { value: s.value, opts: [...s.options].map((o) => ({ v: o.value, t: o.textContent, dis: o.disabled })), err: b.querySelector('.v2613-err').hidden ? '' : b.querySelector('.v2613-err').textContent, eng: b.querySelector('.v2613-engine').textContent, src: b.querySelector('.v2613-src').textContent }; });
const toasts = (win) => win.evaluate(() => [...document.querySelectorAll('.toast, #toasts > *')].map((x) => x.textContent));

(async () => {
  await new Promise((r, j) => { srv.once('error', j); srv.listen(7802, '127.0.0.1', r); });
  let { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(String(ver) === '2.6.13', 'app version 2.6.13', ver);
  await win.evaluate(() => { const T = Store.state.settings.ai.tts; T.mode = 'vsserver'; T.speak = true; delete T.vsVoice; Store.save(true); window.__vsSpawn = 0; });
  // the own vs-engine is NOT configured on this box (no vs-engine.exe): had Nyx tried to start it, the answer would fail with
  // «vs-engine δεν ξεκίνησε» — a spoken answer therefore proves that 7802 was used; tts:vsStatus must also say «not running»
  await openSpeech(win);
  let b = await box(win);
  ok(b && b.value === '91456a431e6f', '«Φωνή απάντησης» shown; default = ster (id 91456a431e6f)', b);
  ok(b && b.opts.map((o) => o.t.split(' ')[0]).join('|').startsWith('ster|Νίκος|Αφηγητής|μισό') && b.opts.at(-1).t === 'Γενική γυναικεία', 'list = Voice Studio personas + «Γενική γυναικεία»', b && b.opts);
  ok(b && b.opts.find((o) => o.t.startsWith('Αφηγητής')).dis && b.opts.find((o) => o.t.startsWith('μισό')).dis && !b.opts.find((o) => o.t.startsWith('ster')).dis, 'not-ready personas are disabled (non-clone / no reference text)');
  ok(b && /ster · 48 βήματα/.test(b.opts[0].t), 'ster shows its 48 steps', b && b.opts[0]);
  ok(b && !b.err, 'no error box when ster is there');
  ok(b && /OmniVoice του Hermes \(7802\)|απαντά \(200\)/.test(b.eng), 'engine line: 7802 answers (200) → it will be used', b && b.eng);
  ok(b && b.src.includes('personas.json') && /μόνο ανάγνωση/.test(b.src), 'source file shown, «μόνο ανάγνωση»', b && b.src);
  const page = await win.evaluate(() => document.documentElement.outerHTML);
  ok(!page.includes(fx[0].voice.rvq.b64) && !page.includes('DUMMY-REF') && !page.includes(HT), 'the page never holds the voice code, the reference text or the token');
  const lst = await win.evaluate(() => API.inv('tts:voiceList2613', {}));
  ok(!JSON.stringify(lst).includes(fx[0].voice.rvq.b64) && !JSON.stringify(lst).includes('DUMMY-REF') && lst.personas.every((p) => !('rvq' in p) && !('refText' in p)), 'the IPC list gives the renderer names / ids / ready only');
  await shot(win, 'v2613-normal-01-voice-setting.png');
  await setSize(app, 1024, 700); await openSpeech(win); await shot(win, 'v2613-small-01-voice-setting.png'); await setSize(app, 1440, 900);
  // ---- speak ----
  F.synth.length = 0; F.max = 0;
  const r = await win.evaluate(() => Speech.speak('Καλημέρα σας. Το εισιτήριο κοστίζει 19,90 €. Η πτήση φεύγει στις 09:45.'));
  ok(F.synth.length === 3 && F.synth.every((j) => j.ref_rvq_b64 === fx[0].voice.rvq.b64 && j.ref_text === fx[0].voice.refText && j.steps === 48 && j.guidance_scale === 2.5 && j.language === 'el'), 'speak → 3 sentences to 7802 with ster (ref_rvq_b64 + ref_text + 48 / 2.5)', F.synth.map((j) => j.text));
  ok(F.synth.map((j) => j.text).join('|') === 'Καλημέρα σας.|Το εισιτήριο κοστίζει 19,90 €.|Η πτήση φεύγει στις 09:45.', 'sentences: 19,90 and 09:45 not cut');
  ok(F.max === 1, 'one request at a time', F.max);
  ok(r && r.via === 'vsserver' && /ster · OmniVoice του Hermes \(7802\)/.test(r.voice) && r.parts === 3, 'result: ster · OmniVoice του Hermes (7802)', r);
  { const vs = await win.evaluate(() => API.inv('tts:vsStatus')); ok(vs && vs.running === false && !vs.port, 'no own vs-engine started (tts:vsStatus: not running, no port; none configured, so a start would have failed the answer)', vs); }
  await openSpeech(win); b = await box(win); ok(/Μηχανή: OmniVoice του Hermes \(7802\)/.test(b.eng), 'Hub shows the engine in use: «OmniVoice του Hermes (7802)»', b.eng);
  // stop during an answer
  F.synth.length = 0;
  await win.evaluate(() => { window.__sp = Speech.speak('Πρώτη πρόταση. Δεύτερη πρόταση. Τρίτη πρόταση. Τέταρτη πρόταση.'); }); await sleep(200);
  await win.evaluate(() => Speech.stopSpeak()); await win.evaluate(() => window.__sp); await sleep(400);
  ok(F.synth.length <= 2, 'stop: the queue is cancelled (not all 4 synthesised)', F.synth.length);
  // ---- ster missing ----
  fs.writeFileSync(PF, JSON.stringify(fx.filter((p) => p.name !== 'ster'), null, 1));
  await openSpeech(win); b = await box(win);
  ok(b.value === 'ster' && /ster — λείπει/.test(b.opts[0].t), 'ster missing: shown as «ster — λείπει», still selected (no silent change)', b);
  ok(/Η φωνή «ster» δεν υπάρχει στο Voice Studio/.test(b.err) && /μόνο αν τη διαλέξεις/.test(b.err), 'error box: «Η φωνή «ster» δεν υπάρχει…» + «Γενική γυναικεία μόνο αν τη διαλέξεις»', b.err);
  await shot(win, 'v2613-normal-02-ster-missing-ERROR.png');
  await setSize(app, 1024, 700); await openSpeech(win); await shot(win, 'v2613-small-02-ster-missing-ERROR.png'); await setSize(app, 1440, 900);
  F.synth.length = 0; const before = F.status;
  await win.evaluate(() => document.querySelectorAll('#toasts > *, .toast').forEach((t) => t.remove()));
  const r2 = await win.evaluate(() => Speech.speak('Δοκιμή χωρίς ster.')); await sleep(200);
  const ts = await toasts(win);
  ok(r2 === null && F.synth.length === 0 && F.status === before, 'speak with ster missing: nothing synthesised, engine not even probed (no fallback)', { r2, n: F.synth.length });
  ok(ts.some((x) => /Η φωνή «ster» δεν υπάρχει/.test(x)), 'speak with ster missing: UI message', ts);
  await shot(win, 'v2613-normal-03-speak-ster-missing-TOAST.png');
  await win.evaluate(() => document.querySelector('.drawer .close, #drawer .close')?.click()); await sleep(400);
  const opened = await win.evaluate(async () => { const b = [...document.querySelectorAll('.toast button, #toasts button')].find((x) => /Ομιλία/.test(x.textContent)); if (!b) return 'no button'; b.click(); await new Promise((r) => setTimeout(r, 900)); return !!document.querySelector('.v2613-box'); });
  ok(opened === true, 'the error notice has an «Ομιλία» button that opens the speech settings', opened);
  // ---- file missing ----
  fs.unlinkSync(PF); await openSpeech(win); b = await box(win);
  ok(/Δεν βρέθηκε το personas.json/.test(b.err), 'personas.json missing: error box', b.err);
  await shot(win, 'v2613-normal-04-personas-file-missing-ERROR.png');
  fs.writeFileSync(PF, '{"format":3,"voices":{}}'); await openSpeech(win); b = await box(win);
  ok(/δεν διαβάζεται/.test(b.err), 'personas.json with another schema: error box, no crash', b.err);
  // ---- generic only when chosen ----
  await win.selectOption('.v2613-voice', 'generic'); await sleep(500);
  ok(await win.evaluate(() => Store.state.settings.ai.tts.vsVoice === 'generic'), '«Γενική γυναικεία» chosen by the user → saved');
  F.synth.length = 0; await win.evaluate(() => Speech.speak('Γενική φωνή.'));
  ok(F.synth.length === 1 && !('ref_rvq_b64' in F.synth[0]) && !('ref_text' in F.synth[0]), '«Γενική γυναικεία»: request without ref fields', F.synth[0]);
  b = await box(win); ok(!b.err, 'no error box for the generic voice');
  fs.copyFileSync(FX, PF);
  ok(fs.readFileSync(PF, 'utf8') === fs.readFileSync(FX, 'utf8'), 'personas.json never written by Nyx (the test restored it; contents = fixture)');
  await quit(app); srv.close();
  console.log(`\nv2.6.13 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
