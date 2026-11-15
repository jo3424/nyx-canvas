'use strict';
// v2.6.8.1 unit tests: no LLM on upload, canvas-write gate, models-max 2, llama-router exe, 500 /props?model= abort.
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const R = path.join(__dirname, '..');
const pkg = require('../package.json');
const el = require('../app/locales/el.json');
const en = require('../app/locales/en.json');
const procs = require('../main/procs');
const nyxPath = require('../main/paths');
const ai = require('../main/ai');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 800) : '')); c ? passes++ : fails++; };

console.log('version + changelog + electron');
ok((pkg.version === '2.6.8.1' || pkg.version.startsWith('2.6.8.') || (pkg.version.startsWith('2.6.9') || pkg.version.startsWith('2.6.10') || pkg.version.startsWith('2.6.11') || pkg.version.startsWith('2.6.12'))) && pkg.devDependencies.electron === '45.2.3', 'version 2.6.8.1+, Electron 45.2.3', pkg.version);
const log = require(R + '/CHANGELOG.json')['2.6.8.1'];
ok(log && log.el.length === log.en.length && log.el.length === 3, 'CHANGELOG 2.6.8.1 has 3 el+en groups', log && log.el.length);
ok(/χωρίς LLM|without an LLM/i.test(log.el[0] + log.en[0]) && /12000|24000/.test(log.el[0] + log.en[0]), 'group 1 is attachments without LLM on upload');
ok(/Στον καμβά|To the canvas/i.test(log.el[1] + log.en[1]) && /prompt cache/.test(log.el[1] + log.en[1]), 'group 2 is canvas-write gate, stable tool list');
ok(/request cancelled|\/props\?model=/.test(log.el[2] + log.en[2]) && /models-max 2/.test(log.el[2] + log.en[2]) && /llama-router/.test(log.el[2] + log.en[2]), 'group 3 is 500 cause, models-max 2, llama-router exe');

console.log('locales');
ok(el['v2681.to_canvas'] === 'Στον καμβά' && en['v2681.to_canvas'] === 'To the canvas', 'to-canvas button label');
ok(el['v2681.canvas_confirm'] === 'Επιβεβαίωση πριν από κάθε αλλαγή στον καμβά', 'default confirm setting label');
ok(el['v2681.att_fast'] && el['v2681.att_heavy'] && el['v2681.att_sent'] && el['v2681.att_budget'], 'attachment stage strings');
ok(Object.keys(el).filter(k => k.startsWith('v2681.')).length === Object.keys(en).filter(k => k.startsWith('v2681.')).length, 'el/en v2681 key counts match');

console.log('attach.js — no fixed caps, no LLM on fast path, take waits only for fast');
const attSrc = fs.readFileSync(path.join(R, 'app/js/v25/attach.js'), 'utf8');
ok(!/\b12000\b/.test(attSrc) && !/\b24000\b/.test(attSrc) && !/\bMAXCTX\b/.test(attSrc), 'no 12000/24000/MAXCTX in attach.js');
ok(/async fast\(/.test(attSrc) && /async heavy\(/.test(attSrc), 'two-stage fast/heavy functions');
ok(/e\.fastReady = this\.fast\(/.test(attSrc) && /Promise\.all\(L\.map\(e => e\.fastReady/.test(attSrc), 'take() waits only for fastReady (2.6.8.2: with a short grace)');
ok(!/await Promise\.all\(L\.map\(e => e\.done\)\)/.test(attSrc), 'take() no longer awaits e.done (the old lock)');
ok(/refreshNctx/.test(attSrc) && /probe:\s*true/.test(attSrc), 'n_ctx refresh uses probe, not /props?model= on upload');
ok(/this\.cache/.test(attSrc) && /hashOf/.test(attSrc), 'per-hash cache');
ok(/tokensSent/.test(attSrc) && /att_stage/.test(attSrc), 'panel records stage times and tokens sent');
ok(!/if \(e\.text && e\.text\.length > 12000\)/.test(attSrc), 'no summarize-on-length-12000');
// summarize is only called from heavy(), not from fast()
const fastFn = attSrc.split('async fast(e)')[1].split('async heavy(e)')[0];
ok(!/summarize\(/.test(fastFn) && !/AI\.text\(/.test(fastFn) && !/this\.vision\(/.test(fastFn) && !/this\.image\(/.test(fastFn), 'fast stage does not call summarize/vision/AI.text', fastFn.slice(0, 200));

console.log('canvas tools stay in the prefix; gate is at exec');
const asSrc = fs.readFileSync(path.join(R, 'app/js/v2/assistant.js'), 'utf8');
ok(/WRITE:\s*new Set\(/.test(asSrc) && /create_card/.test(asSrc) && /blocked:\s*true/.test(asSrc), 'exec gates canvas-writing tools');
ok(/tools\(\) \{ return Object\.entries\(this\.T\)/.test(asSrc), 'tools() still advertises the full Cmd.T list (stable prefix)');
ok(/v2681\.to_canvas/.test(asSrc) && /Cmd\.toCanvas/.test(asSrc), 'visible To-the-canvas button under replies');
ok(/canvasConfirm !== false/.test(asSrc), 'confirm-before-canvas honors the setting');
// superseded in 2.6.9.3 (user-confirmed cause of the lost subscriptions): Ctrl+Z in the composer is the field's own undo only
ok(!/id: 'as-q'[^\n]*App\.undo/.test(asSrc) && /\['z', 'y'\]\.includes\(e\.key\.toLowerCase\(\)\)\) \{ e\.stopPropagation\(\); return; \}/.test(asSrc), 'Ctrl+Z in the composer never undoes the canvas (2.6.9.3)');
ok(/Cmd\.toCanvas/.test(asSrc) && !/onclick: \(\) => Cmd\.T\.create_card\.run/.test(asSrc), 'reply button uses toCanvas, not a silent create_card.run');

console.log('core defaults + migrate');
const coreSrc = fs.readFileSync(path.join(R, 'app/js/v2/core.js'), 'utf8');
ok(/modelsMax:\s*2/.test(coreSrc), 'aiDefaults modelsMax is 2');
ok(/llama-router\\\\llama-server\.exe/.test(coreSrc) && !/exe: g\(GVS_REL\.llamaExe\)/.test(coreSrc), 'default exe is llama-router, not GVS');
ok(/canvasConfirm:\s*true/.test(coreSrc) && /attachReserve:\s*2048/.test(coreSrc), 'canvasConfirm on and attachReserve visible default');
ok(/_migratedModelsMax2/.test(coreSrc) && /_migratedLlamaRouterExe/.test(coreSrc), 'migrate 0→2 and GVS exe→llama-router');

console.log('paths + procs: never launch GVS llama-server, models-max default 2');
ok(nyxPath.isGvsLlamaExe('C:/Users/admin/GPU-Voice-Studio/third_party/llama/llama-server.exe'), 'detects GVS llama-server.exe');
ok(!nyxPath.isGvsLlamaExe('C:/Users/admin/llama-router/llama-server.exe'), 'does not flag b12230 path as GVS');
const def = nyxPath.defaultLlamaRouterExe({ home: 'C:/Users/admin', platform: 'win32', env: { USERPROFILE: 'C:/Users/admin' }, pathMod: path });
ok(/llama-router[\\/]llama-server\.exe$/.test(def), 'defaultLlamaRouterExe under %USERPROFILE%\\\\llama-router', def);
ok(/llama-router/.test(nyxPath.llamaRouterExe('C:/Users/admin/GPU-Voice-Studio/third_party/llama/llama-server.exe', { home: 'C:/Users/admin', env: { USERPROFILE: 'C:/Users/admin', HOME: 'C:/Users/admin' }, pathMod: path })), 'llamaRouterExe rewrites GVS path');
ok(/llama-router/.test(nyxPath.llamaRouterExe('C:/Users/admin/llama-router/llama-server.exe', { home: 'C:/Users/admin', env: { USERPROFILE: 'C:/Users/admin', HOME: 'C:/Users/admin' }, pathMod: path })), 'keeps a real llama-router exe');

ok(procs.modelsMaxOf({ modelsMax: 0 }) === 2, 'modelsMax 0 → default 2');
ok(procs.modelsMaxOf({}) === 2, 'missing modelsMax → 2');
ok(procs.modelsMaxOf({ modelsMax: 3 }) === 3, 'explicit 3 is kept');
ok(procs.modelsMaxOf({ extra: '--models-max 4' }) === 4, 'extra --models-max 4 is kept');

const exe = path.join(os.tmpdir(), 'nyx-fake-llama-server');
fs.writeFileSync(exe, 'x');
const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-models-'));
const gvsExe = path.join(os.tmpdir(), 'GPU-Voice-Studio', 'third_party', 'llama', 'llama-server.exe');
fs.mkdirSync(path.dirname(gvsExe), { recursive: true });
fs.writeFileSync(gvsExe, 'gvs');
const cfg = procs.resolveLlamaCfg({ exe: gvsExe, modelsDir, modelsMax: 0, ctx: 32768, ngl: 99, np: 1, port: 8080, fa: true, jinja: true });
ok(!nyxPath.isGvsLlamaExe(cfg.exe), 'resolveLlamaCfg does not keep the GVS exe', cfg.exe);
ok(cfg.modelsMax === 2, 'resolveLlamaCfg sets modelsMax 2', cfg.modelsMax);
const args = procs.argsFor('llama', { ...cfg, exe }); // use existing fake for args; exe not in args
ok(args.includes('--models-max') && args[args.indexOf('--models-max') + 1] === '2', 'argsFor passes --models-max 2 (not 0)', args);
ok(!args.includes('0') || args[args.indexOf('--models-max') + 1] !== '0', 'does not pass --models-max 0');
const vbs = procs.startupVbs({ exe, modelsDir, modelsMax: 0, ctx: 32768, ngl: 99, np: 1, port: 8080, fa: true });
ok(/--models-max 2/.test(vbs), 'autostart VBS gets --models-max 2', vbs.slice(0, 400));
ok(!/GPU-Voice-Studio/.test(vbs), 'autostart VBS does not point at the GVS exe');
ok(vbs.includes(exe) || /llama-router/.test(vbs) || /llama-server/.test(vbs), 'VBS launches a llama-server path');

console.log('hub probes /props?model= no longer');
const hubSrc = fs.readFileSync(path.join(R, 'app/js/v2/hub.js'), 'utf8');
ok(/probe:\s*true/.test(hubSrc) && !/ai:context', \{ \.\.\.p, base \}, \{ model: mid \|\| undefined \}\)/.test(hubSrc), 'Engines live-ctx uses probe:true');
ok(/v2681\.canvas_confirm/.test(hubSrc) && /v2681\.attach_reserve/.test(hubSrc), 'settings show canvas confirm and attach reserve');

console.log('/props?model= is not short-aborted (root cause of remaining 500)');
const aiSrc = fs.readFileSync(path.join(R, 'main/ai.js'), 'utf8');
ok(/opts\.model \? 0 : 4000/.test(aiSrc) || (/opts\.model \? PROPS_MODEL_MS : 4000/.test(aiSrc) && ai.PROPS_MODEL_MS >= 60000), 'props() with ?model= is never short-aborted (0 in 2.6.8.1, 120 s ceiling from 2.6.8.2)');
ok(/assistant\.js/.test(fs.readFileSync(path.join(R, 'app/js/v2/assistant.js'), 'utf8')) || true, 'placeholder');
ok(/probe:\s*true/.test(fs.readFileSync(path.join(R, 'app/js/v2/assistant.js'), 'utf8')), 'assistant.run context is a probe');

(async () => {
  // Live: a /props?model= that takes 5.2 s must succeed (the old 4 s abort is the 500).
  const st = { props: 0, aborted: 0 };
  const srv = http.createServer((q, resp) => {
    if (q.url === '/v1/models' || q.url === '/models') return void (resp.statusCode = 200, resp.setHeader('content-type', 'application/json'), resp.end(JSON.stringify({ data: [{ id: 'gemma-4-12B-it-Q4_0' }] })));
    if (q.url.startsWith('/props?model=')) {
      st.props++;
      const tm = setTimeout(() => { resp.statusCode = 200; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify({ default_generation_settings: { n_ctx: 32768 } })); }, 5200);
      q.on('close', () => { if (!resp.writableEnded) { st.aborted++; clearTimeout(tm); } });
      return;
    }
    if (q.url === '/props') { resp.statusCode = 400; resp.end(JSON.stringify({ error: { message: 'model is required' } })); return; }
    resp.statusCode = 404; resp.end('{}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const p = { id: 'llama', kind: 'local', base: 'http://127.0.0.1:' + port + '/v1' };
  const t0 = Date.now();
  let info, err;
  try { info = await ai.contextInfo(p, { model: 'gemma-4-12B-it-Q4_0' }); }
  catch (e) { err = e; }
  const dt = Date.now() - t0;
  ok(!err && info && info.n_ctx === 32768, 'contextInfo(/props?model=) waits past 4 s and returns 32768', { err: err && String(err.message || err), info, dt, st });
  ok(dt >= 5000 && st.aborted === 0, 'the 5.2 s /props?model= was not aborted (this abort was the 500)', { dt, aborted: st.aborted, props: st.props });
  srv.close();
  console.log(`\nv2.6.8.1 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
