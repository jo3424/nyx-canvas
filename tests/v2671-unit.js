'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const R = path.join(__dirname, '..');
const el = require(R + '/app/locales/el.json'), en = require(R + '/app/locales/en.json');
const L = require(R + '/main/limits');
const procs = require(R + '/main/procs');
const ai = require(R + '/main/ai');
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? pass++ : fail++; };

console.log('version + electron');
const pkg = require(R + '/package.json');
ok(((pkg.version.startsWith('2.6.9') || pkg.version.startsWith('2.6.10') || pkg.version.startsWith('2.6.11') || pkg.version.startsWith('2.6.12') || pkg.version.startsWith('2.6.13') || pkg.version.startsWith('2.7.')) || pkg.version === '2.6.7.1' || pkg.version === '2.6.8' || pkg.version.startsWith('2.6.8')) && pkg.devDependencies.electron === '45.2.3', 'version 2.6.7.1/2.6.8, Electron 45.2.3', pkg.version);
const log = require(R + '/CHANGELOG.json')['2.6.7.1'];
ok(log && log.el.length === log.en.length && log.el.length >= 5, 'CHANGELOG 2.6.7.1 el+en');
ok(/2\.6\.8/.test(log.el.join(' ')) && /streaming/.test(log.en.join(' ').toLowerCase()), '2.6.8 mentioned only as upcoming');
ok(/prompt cache|περιεχόμενο του πίνακα|board content after history/i.test(log.el.join(' ') + log.en.join(' ')), '2.6.8 plan mentions board-after-history');
ok(/request cancelled|αναμονή όσο φορτώνει/i.test(log.el.join(' ') + log.en.join(' ')), '2.6.8 plan mentions wait while model loads');
const hubTabs = fs.readFileSync(R + '/app/js/v2/hub-tabs.js', 'utf8');
ok(!/stream[ing]* του βοηθού|faster file/.test(hubTabs), 'hub-tabs does not add 2.6.8 streaming');

console.log('i18n placeholders');
for (const k of Object.keys(el).filter((k) => k.startsWith('v2671.') || k === 'procs.014')) {
  const a = (el[k].match(/\{v\d+\}/g) || []).sort().join();
  const b = (en[k].match(/\{v\d+\}/g) || []).sort().join();
  ok(a === b && el[k] && en[k], 'placeholders ' + k);
}

console.log('duplicate tools icon removed');
const boot = fs.readFileSync(R + '/app/js/v2/boot.js', 'utf8');
ok(!/tb\('btn-tools'/.test(boot), 'btn-tools is not inserted in the titlebar');
ok(/tools\(\)\s*\{[^}]*settings\('tools'\)/.test(fs.readFileSync(R + '/app/js/v2/hub.js', 'utf8')), 'Hub.tools remains for Settings and Ctrl+K');
ok(/boot\.003/.test(fs.readFileSync(R + '/app/js/v2/search.js', 'utf8')), 'Ctrl+K still has System tools');

console.log('status tab is non-blocking');
ok(/raceMs/.test(hubTabs) && /v2671\.loading/.test(hubTabs), 'status fill uses parallel short races and placeholders');
ok(/const paintStatus = \(el\) =>/.test(hubTabs) && !/const paintStatus = async/.test(hubTabs), 'paintStatus is synchronous (shell first)');
ok(/hub-dot ' \+ \(llamaOn \? 'g' : 'r'\)/.test(hubTabs) || /llamaOn \? 'g' : 'r'/.test(hubTabs), 'down router uses red dot');
ok(/v2671\.router_down/.test(hubTabs) && /v2671\.max_unknown/.test(hubTabs), 'router-down and unknown max strings used');
ok(/ai:routerInfo/.test(hubTabs), 'Engines/Status try /props via ai:routerInfo');
ok(/winAutostart/.test(hubTabs) && /v2671\.win_autostart/.test(hubTabs), 'Windows autostart checkbox is in Advanced');
ok(/v2671\.n_parallel/.test(hubTabs), '-np field is in Advanced');

console.log('note types discoverable');
const tools = fs.readFileSync(R + '/app/js/tools.js', 'utf8');
const panels = fs.readFileSync(R + '/app/js/panels.js', 'utf8');
const items = fs.readFileSync(R + '/app/js/items.js', 'utf8');
ok(/function stickyDefaults/.test(items) && /PAPER_KINDS/.test(items), 'stickyDefaults helper exists');
ok(/data-pk/.test(tools) && /v23\.paper_kind/.test(tools) && /stickyDefaults/.test(tools), 'sticky tool options show paper kinds');
ok(/paperKindSub/.test(panels) && /pk-sub/.test(panels), 'context menu has a paper-kind picker');

console.log('no-model warning');
const core = fs.readFileSync(R + '/app/js/v2/core.js', 'utf8');
ok(/NOMODEL/.test(core) && /v2671\.need_model/.test(core), 'pickModel throws a visible NOMODEL warning');
ok(/v2671\.need_model_row/.test(fs.readFileSync(R + '/app/js/v2/hub.js', 'utf8')), 'Models tab row warns when no model is chosen');
ok(/NOMODEL/.test(fs.readFileSync(R + '/app/js/v2/assistant.js', 'utf8')), 'assistant surfaces NOMODEL instead of silent offline');

console.log('ctx never auto-raised');
ok(L.resolveLaunchCtx({ ctx: 32768 }, { ctx: 262144 }).ctx === 32768, 'user 32768 kept');
ok(L.resolveLaunchCtx({ ctx: 0 }, { ctx: 262144 }).omitted, 'ctx 0 omits -c');

console.log('router argsFor + precheck');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-md-'));
const exe = process.execPath;
const cfg = { exe, modelsDir: dir, modelsMax: 2, ctx: 32768, ngl: 99, np: 1, port: 8080, fa: true, jinja: true };
const args = procs.argsFor('llama', cfg);
ok(!args.includes('-m'), 'router mode does not pass -m', args);
ok(args.includes('--models-dir') && args[args.indexOf('--models-dir') + 1] === dir, 'passes --models-dir', args);
ok(args.includes('--models-max') && args[args.indexOf('--models-max') + 1] === '2', 'passes --models-max 2', args);
ok(args.includes('--ctx-size') && args[args.indexOf('--ctx-size') + 1] === '32768', 'passes --ctx-size 32768', args);
ok(args.includes('--flash-attn') && args[args.indexOf('--flash-attn') + 1] === 'on', 'passes --flash-attn on', args);
ok(args.includes('--n-gpu-layers') && args[args.indexOf('--n-gpu-layers') + 1] === '99', 'passes --n-gpu-layers 99', args);
ok(args.includes('-np') && args[args.indexOf('-np') + 1] === '1', 'passes -np 1', args);
ok(args.includes('--jinja'), 'keeps --jinja for tool calling', args);
ok(!args.includes('-c') || args.includes('--ctx-size'), 'uses --ctx-size rather than inventing another ctx', args);
ok(procs.isRouterMode(cfg) && procs.routerDir(cfg) === dir, 'isRouterMode from modelsDir');
ok(procs.modelsMaxOf(cfg) === 2 && procs.modelsMaxOf({ extra: '--models-max 3' }) === 3, 'modelsMaxOf from field and extra');
ok(procs.precheck('llama', cfg) == null, 'router precheck passes without a model file');
ok(procs.precheck('llama', { exe, modelsDir: path.join(dir, 'missing') })?.field === 'modelsDir', 'missing modelsDir reported');
const wh = path.join(dir, 'm.gguf'); fs.writeFileSync(wh, 'x');
ok(procs.precheck('llama', { exe, model: wh }) == null, 'single-model precheck still requires a model and passes');
ok(procs.precheck('llama', { exe })?.field === 'model', 'single-model without model still errors');
const single = procs.argsFor('llama', { model: wh, port: 8080, ngl: 99, ctx: 32768, fa: true });
ok(single.includes('-m') && single[single.indexOf('-m') + 1] === wh, 'single-model path still uses -m', single);

console.log('parseRouterMax');
ok(ai.parseRouterMax({ role: 'router', max_instances: 2 }) === 2, 'max_instances from /props');
ok(ai.parseRouterMax({ models_max: 4 }) === 4, 'models_max alias');
ok(ai.parseRouterMax({ role: 'router' }) == null, 'missing max is null');
ok(ai.parseRouterMax(null) == null, 'null raw');

console.log('Windows autostart VBS');
const startDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-st-'));
const prev = process.env.NYX_STARTUP_DIR;
process.env.NYX_STARTUP_DIR = startDir;
const vbs = procs.startupVbs({ exe, modelsDir: dir, modelsMax: 2, ctx: 32768, ngl: 99, np: 1, port: 8080, fa: true });
ok(/WScript\.Shell/.test(vbs) && /,\s*0,\s*False/.test(vbs), 'VBS runs hidden (window style 0)', vbs.slice(0, 400));
ok(/127\.0\.0\.1:8080\/health/.test(vbs) && /WScript\.Quit 0/.test(vbs), 'VBS checks /health and skips if already up');
ok(/--models-dir/.test(vbs) && /--models-max 2/.test(vbs) && /--ctx-size 32768/.test(vbs) && /--flash-attn on/.test(vbs) && /--n-gpu-layers 99/.test(vbs) && /-np 1/.test(vbs), 'VBS has the exact router flags', vbs);
ok(!/\s-m\s/.test(vbs), 'VBS is router mode (no -m)');
const off = procs.winAutostartGet();
ok(off.available && !off.on && off.dir === startDir, 'get: available, off', off);
const on = procs.winAutostartSet(true, { exe, modelsDir: dir, modelsMax: 2, ctx: 32768, ngl: 99, np: 1, port: 8080 });
ok(on.on && fs.existsSync(on.path) && path.basename(on.path) === 'Nyx-llama-router.vbs', 'set writes the VBS', on);
ok(fs.readFileSync(on.path, 'utf8').includes('--ctx-size 32768'), 'written VBS has ctx 32768');
const off2 = procs.winAutostartSet(false, {});
ok(!off2.on && !fs.existsSync(on.path), 'clear removes the VBS');
if (prev == null) delete process.env.NYX_STARTUP_DIR; else process.env.NYX_STARTUP_DIR = prev;
try { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(startDir, { recursive: true, force: true }); } catch (e) {}

console.log('IPC + security leftovers');
const guard = fs.readFileSync(R + '/main/ipc-guard.js', 'utf8');
ok(/ai:routerInfo/.test(guard) && /proc:winAutostart/.test(guard), 'new IPC channels are in the guard');
ok(pkg.devDependencies.electron === '45.2.3', 'Electron unchanged');
ok(/refusing to start with --/.test(fs.readFileSync(R + '/main.js', 'utf8')) && /no-sandbox/.test(fs.readFileSync(R + '/main.js', 'utf8')), 'main.js refuses --no-sandbox');

console.log(`\nv2.6.7.1 unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
