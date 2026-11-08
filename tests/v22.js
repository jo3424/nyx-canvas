// Nyx v2.2 end-to-end (headless): xvfb-run -a node tests/v22.js
// AI Hub: provider errors + hints, base auto-fix (/v1), whisper model auto-find, 🔍 picker, 📁 browse, clean IPC errors,
// TTS «Δοκιμή» with stderr, settings survive an immediate quit. Screenshots → shots/v22-*.png
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), net = require('net');
const ROOT = path.join(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v22-home ')); const DATA = path.join(HOME, 'Δεδομένα Nyx'); fs.mkdirSync(DATA);
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const big = Buffer.alloc(1.2 * 1024 * 1024);
const mk = (rel, buf = big) => { const p = path.join(HOME, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return p; };
// what the user's disk looks like: model lives elsewhere than the default path
const WH = mk('GPU-Voice-Studio/models/ggml-large-v3-turbo-q5_0.bin'); mk('Downloads/Qwen3-8B-Q4_K_M.gguf'); mk('Downloads/llama-krikri-8b-instruct-q8_0.gguf');
const ENG = mk('OmniVoice-Vulkan/fake-tts.js', Buffer.from("const fs=require('fs');const a=process.argv;const o=a[a.indexOf('-o')+1];console.error('ggml_vulkan: Found 1 Vulkan devices: AMD Radeon RX 7900 XTX');if(a.includes('--bad')){console.error('error: unknown argument: --bad');process.exit(1)}fs.writeFileSync(o,Buffer.alloc(44))"));
const listen = (srv) => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, HOME, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_CODE_DIR: path.join(DATA, 'app-code') } });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 25000 }); await win.waitForTimeout(500);
  return { app, win };
}
async function quit(app) { const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 20)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const clearToasts = (win) => win.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
const toasts = (win) => win.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' | '));
const shotOf = async (win, sel, name) => { await win.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), sel); await win.waitForTimeout(350); await win.screenshot({ path: path.join(SHOTS, name) }); };

(async () => {
  const srv = http.createServer((q, r) => { if (q.url === '/v1/models') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ data: [{ id: 'qwen3.6-35b-a3b' }, { id: 'krikri-8b' }] })); } r.statusCode = 404; r.end(); });
  const LP = await listen(srv); const d = net.createServer(); const DEAD = await listen(d); d.close();
  let { app, win } = await launch();
  console.log('AI Hub — providers');
  await win.evaluate(({ LP, DEAD }) => { const A = Store.state.settings.ai; A.providers.find(p => p.id === 'lmstudio').base = `http://localhost:${DEAD}/v1`; const L = A.providers.find(p => p.id === 'llama'); L.base = `http://127.0.0.1:${LP}`; Store.save(); }, { LP, DEAD });
  await win.evaluate(() => Hub.open()); await win.waitForSelector('[data-prov=lmstudio]');
  await win.waitForFunction(() => document.querySelector('[data-prov=lmstudio] .pstat')?.classList.contains('bad'), null, { timeout: 15000 });
  const lm = await win.evaluate(() => ({ st: document.querySelector('[data-prov=lmstudio] .pstat').textContent, fix: document.querySelector('[data-prov=lmstudio] .pfix')?.textContent || '' }));
  ok(/αρνήθηκε τη σύνδεση/.test(lm.st) && !/είναι ανοιχτό/.test(lm.st), 'LM Studio off → precise reason (refused), not the old generic message', lm.st);
  ok(/Developer/.test(lm.fix) && /Start Server/.test(lm.fix) && /lms server start/.test(lm.fix), 'LM Studio hint: Developer → Start Server / lms server start', lm.fix);
  await win.evaluate(() => document.querySelector('[data-prov=llama] .btn.ghost.sm').click());
  await win.waitForFunction(() => document.querySelector('[data-prov=llama] .pstat')?.classList.contains('ok'), null, { timeout: 10000 }).catch(() => {});
  const ll = await win.evaluate(() => ({ st: document.querySelector('[data-prov=llama] .pstat').textContent, base: document.querySelector('[data-prov=llama] .prov-base').value, saved: Store.state.settings.ai.providers.find(p => p.id === 'llama').base }));
  ok(/2/.test(ll.st) && ll.base.endsWith('/v1') && ll.saved === ll.base, 'llama-server base without /v1 → works and is corrected to …/v1', ll);
  ok(/διορθώθηκε/.test(await toasts(win)), 'toast tells the base was corrected', await toasts(win));
  await win.evaluate(() => document.querySelector('[data-prov=llama]').scrollIntoView({ block: 'center' })); await clearToasts(win); await win.waitForTimeout(300);
  await shotOf(win, '[data-prov=lmstudio]', 'v22-hub-providers.png');

  console.log('Local servers');
  await win.waitForFunction(() => /ggml-large-v3-turbo/.test(Store.state.settings.ai.servers.whisper.model) && !Store.state.settings.ai.servers.whisper.model.includes('third_party'), null, { timeout: 12000 }).catch(() => {});
  const wm = await win.evaluate(() => Store.state.settings.ai.servers.whisper.model);
  ok(wm === WH, 'whisper model missing at the default path → found on disk and fixed automatically', wm);
  ok(await win.evaluate(() => document.querySelector('[data-srv=whisper] .prow .pchk.ok') !== null), 'whisper model row shows ✓');
  const missingExe = await win.evaluate(() => [...document.querySelectorAll('[data-srv=whisper] .pfind')].some(b => !b.hidden));
  ok(missingExe, '🔍 Find button shown for the missing whisper-server.exe');
  ok(await win.evaluate(() => [...document.querySelectorAll('.srv .pbrowse')].length >= 4 && [...document.querySelectorAll('.srv .pbrowse')].every(b => b.getBoundingClientRect().right <= document.querySelector('#drawer').getBoundingClientRect().right)), '📁 browse button visible on every path field');
  // starting with a missing exe: clean message, no "Error invoking remote method"
  await clearToasts(win); await win.evaluate(() => document.querySelector('[data-srv=whisper] .btn.primary').click()); await win.waitForTimeout(1500);
  let tt = await toasts(win); ok(/whisper-server/.test(tt) && !/Error invoking|remote method|Error:/.test(tt), 'start with missing exe → clean Greek toast', tt);
  const raw = await win.evaluate(() => API.inv('proc:start', 'whisper', { exe: '/nope/whisper-server.exe', model: 'x' }).then(() => 'resolved', e => e.message));
  ok(!/Error invoking|remote method/.test(raw) && /whisper-server\.exe/.test(raw), 'IPC errors reach the UI without the Electron prefix', raw);
  await clearToasts(win);
  // 🔍 picker on llama model
  await win.evaluate(() => { const S = Store.state.settings.ai.servers.llama; S.model = ''; Store.save(); Panels.drawerKind = null; Hub.open(); }); await win.waitForSelector('[data-srv=llama]');
  await win.evaluate(() => [...document.querySelectorAll('[data-srv=llama] .pfind')].find(b => !b.hidden && b.closest('.field').textContent.includes('gguf')).click());
  await win.waitForSelector('.find-item', { timeout: 10000 }).catch(() => {});
  const items = await win.evaluate(() => [...document.querySelectorAll('.find-item b')].map(b => b.textContent));
  ok(items.includes('Qwen3-8B-Q4_K_M.gguf') && items.includes('llama-krikri-8b-instruct-q8_0.gguf') && !items.some(n => /ggml/.test(n)), 'picker lists the .gguf models found on disk', items);
  await win.screenshot({ path: path.join(SHOTS, 'v22-find-picker.png') });
  await win.evaluate(() => [...document.querySelectorAll('.find-item')].find(b => /krikri/.test(b.textContent)).click()); await win.waitForTimeout(400);
  ok(await win.evaluate(() => /krikri/.test(Store.state.settings.ai.servers.llama.model) && /krikri/.test(document.querySelector('[data-srv=llama] .prow .inp')?.closest('[data-srv]').textContent + [...document.querySelectorAll('[data-srv=llama] .prow .inp')].map(i => i.value).join())), 'picking a file fills the field');
  // 📁 browse passes filters + current path
  await app.evaluate(({ dialog }) => { global.__dlg = null; dialog.showOpenDialog = async (w, o) => { global.__dlg = o || w; return { canceled: true, filePaths: [] }; }; });
  await win.evaluate(() => document.querySelector('[data-srv=whisper] .field:nth-of-type(2) .pbrowse, [data-srv=whisper] .pbrowse:last-of-type')); 
  await win.evaluate(() => [...document.querySelectorAll('[data-srv=whisper] .pbrowse')][1].click()); await win.waitForTimeout(500);
  const dlg = await app.evaluate(() => global.__dlg);
  ok(dlg && (dlg.filters || []).some(f => f.extensions.includes('bin')) && String(dlg.defaultPath || '').includes('ggml'), '📁 dialog opens at the current file with model filters', dlg);
  await clearToasts(win); await shotOf(win, '[data-srv=llama]', 'v22-hub-servers.png');

  console.log('TTS');
  const exe = await app.evaluate(() => process.execPath);
  await win.evaluate(({ ENG, exe }) => { const T = Store.state.settings.ai.tts; T.mode = 'command'; T.exe = exe; T.template = `{exe} "${ENG}" --model {model} -o {out} < {text_file}`; Store.save(); Panels.drawerKind = null; Hub.open(); }, { ENG, exe });
  await win.waitForSelector('.tts-out', { state: 'attached' });
  ok(await win.evaluate(() => !document.querySelector('.tts-box').hidden && document.querySelector('.tts-box').offsetHeight > 100), 'command mode shows the TTS engine fields (hidden in Windows-voice mode)');
  // ELECTRON_RUN_AS_NODE makes the electron binary behave like node for the fake engine
  await app.evaluate(() => { process.env.ELECTRON_RUN_AS_NODE = '1'; });
  const ttsBtn = () => win.evaluate(() => [...document.querySelectorAll('.hub-sec button')].find(b => b.textContent.trim() === 'Δοκιμή').click());
  await ttsBtn(); await win.waitForFunction(() => document.querySelector('.tts-out .ok, .tts-out .err'), null, { timeout: 20000 });
  let to = await win.evaluate(() => ({ t: document.querySelector('.tts-out').textContent, audio: !!document.querySelector('.tts-out audio') }));
  ok(/✓/.test(to.t) && to.audio && /7900 XTX/.test(to.t), 'Δοκιμή: runs the engine, plays the wav, shows stderr', to);
  await win.evaluate(() => { const T = Store.state.settings.ai.tts; T.template += ' --bad'; Store.save(); document.querySelector('.inp.mono').value = T.template; });
  await ttsBtn(); await win.waitForFunction(() => document.querySelector('.tts-out .err'), null, { timeout: 20000 });
  to = await win.evaluate(() => document.querySelector('.tts-out').textContent);
  ok(/unknown argument: --bad/.test(to) && /--bad/.test(to), 'Δοκιμή failure shows the engine’s own error (stderr) + command', to.slice(0, 300));
  await win.evaluate(() => { const s = document.querySelector('[data-testid=tts-preset], .hub-sec select'); }); 
  const presets = await win.evaluate(() => [...document.querySelectorAll('select option')].map(o => o.textContent).filter(t => /^(omnivoice|Piper|vs-engine)/.test(t)));
  ok(presets.length === 3, 'TTS presets: vs-engine / omnivoice.cpp / Piper', presets);
  await win.evaluate(() => document.querySelector('.tts-out').scrollIntoView({ block: 'end' })); await clearToasts(win); await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, 'v22-tts.png') });
  await app.evaluate(() => { delete process.env.ELECTRON_RUN_AS_NODE; });

  console.log('Saving');
  await win.evaluate(() => { Store.state.settings.ai.servers.llama.ctx = 16384; Store.save(); }); // debounced, then quit at once
  await quit(app);
  ({ app, win } = await launch());
  ok(await win.evaluate(() => Store.state.settings.ai.servers.llama.ctx) === 16384, 'change made right before quitting is not lost');
  const tmps = fs.readdirSync(DATA).filter(f => /\.tmp$/.test(f)); ok(tmps.length === 0, 'no leftover .tmp files', tmps);
  await quit(app); srv.close();
  ok(errors.length === 0, 'no renderer errors', errors);
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
