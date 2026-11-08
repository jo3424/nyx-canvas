// Nyx v2.6.4 — packaged + fused build e2e (headless, Chromium sandbox on): xvfb-run -a node tests/v263-fused.js
// Drives the real packaged binary dist/NyxCanvas-linux-x64 (built by `node scripts/pack.js --platform linux`).
// Playwright's _electron.launch needs --inspect, which the NodeCliInspectArguments fuse now refuses, so the app is
// driven over Chromium's remote-debugging port (renderer only — the main process is not reachable, which is the point).
//   A  real installed 2.6.3 (Electron 45.2.1, unfused): finds 2.6.4, sees the runtime changed → asks for the full build
//   B  signed patch 2.6.3 → 2.6.4 on the fused 45.2.3 runtime: download over http, verify, restart, 2.6.4 boots
//   C  fused 2.6.4 full build ignores unsigned / leftover app-code folders
//   F  fuses: readout, ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect are ignored; unpacked-file integrity
const { chromium, _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), net = require('net'), { spawn, execFileSync } = require('child_process');
const asar = require('@electron/asar'); const core = require('../main/update-core'); const { copyFiltered } = require('../scripts/pack-filter');
const ROOT = path.join(__dirname, '..'); const BUILD = path.join(ROOT, 'dist', 'NyxCanvas-linux-x64'); const EXE_NAME = 'NyxCanvas';
const UPD = path.join(ROOT, 'dist', 'updates'); const PATCH = path.join(UPD, 'nyx-2.6.3-to-2.6.4.zip'); const BASE_REF = process.env.NYX_BASE_REF || '2456b28';
const ELOLD = process.env.NYX_ELECTRON_OLD || '/workspace/nebula-v26/node_modules/electron/dist/electron';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-fused-'));
let fails = 0, passes = 0; const errors = [];
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const listening = (port) => new Promise(res => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });
const getJson = (url) => new Promise((res, rej) => http.get(url, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));

async function startFused(dir, { home, data, code, args = [], env = {}, wait = true } = {}) {
  const port = await freePort(); const out = [];
  const p = spawn(path.join(dir, EXE_NAME), [`--remote-debugging-port=${port}`, ...args], { env: { ...process.env, HOME: home, NYX_TEST: '1', NYX_DATA_DIR: data, ...(code ? { NYX_CODE_DIR: code } : {}), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => out.push(String(d))); p.stderr.on('data', d => out.push(String(d)));
  const r = { p, port, out, kill: async () => { if (r.browser) await r.browser.close().catch(() => {}); if (p.exitCode === null) { p.kill('SIGTERM'); await Promise.race([new Promise(x => p.once('exit', x)), sleep(8000)]); try { p.kill('SIGKILL'); } catch (e) {} } } };
  if (!wait) return r;
  for (let i = 0; i < 100 && p.exitCode === null; i++) { try { await getJson(`http://127.0.0.1:${port}/json/version`); break; } catch (e) { await sleep(200); } }
  r.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = r.browser.contexts()[0];
  for (let i = 0; i < 100 && !r.win; i++) { r.win = ctx.pages().find(pg => /\/app\/index\.html/.test(pg.url())); if (!r.win) await sleep(200); }
  r.win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await r.win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 30000 }); await r.win.waitForTimeout(400);
  return r;
}
const info = (win) => win.evaluate(() => nyxAPI.inv('upd:info'));
const openUpdate = (win) => win.evaluate(() => { Panels.drawerKind = null; Panels.settings('update'); }).then(() => win.waitForTimeout(600));
const status = (win) => win.evaluate(() => document.querySelector('.upd-status')?.textContent || '');
function dirs(name) { const d = path.join(TMP, name); const o = { home: path.join(d, 'home'), data: path.join(d, 'data'), code: path.join(d, 'app-code') }; for (const x of Object.values(o)) fs.mkdirSync(x, { recursive: true }); return o; }
function base263() { const d = path.join(TMP, 'src-2.6.3'); fs.mkdirSync(d); execFileSync('bash', ['-c', 'git archive --format=tar "$1" | tar -x -C "$2"', '_', BASE_REF, d], { cwd: ROOT }); return d; }

(async () => {
  if (!fs.existsSync(path.join(BUILD, EXE_NAME))) { console.log('missing ' + BUILD + ' → node scripts/pack.js --platform linux'); process.exit(1); }
  if (!fs.existsSync(PATCH)) { console.log('missing ' + PATCH + ' → node scripts/make-patch.js'); process.exit(1); }
  const latest = JSON.parse(fs.readFileSync(path.join(UPD, 'nyx-latest.json'), 'utf8'));
  const srv = http.createServer((q, s) => { const f = path.join(UPD, path.basename(decodeURIComponent(q.url.split('?')[0]))); if (!/^\/(nyx-latest\.json|nyx-2\.6\.3-to-2\.6\.4\.zip)$/.test(q.url) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200); fs.createReadStream(f).pipe(s); }).listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r)); const URL_ = `http://127.0.0.1:${srv.address().port}/nyx-latest.json`;
  ok(latest.version === '2.6.4' && latest.electron === '45.2.3' && latest.patches['2.6.3'] === 'nyx-2.6.3-to-2.6.4.zip', 'nyx-latest.json: 2.6.4 on Electron 45.2.3, delta from 2.6.3', latest.patches);

  console.log('F — fuses on the packaged binary');
  const fr = execFileSync('npx', ['--no-install', '@electron/fuses', 'read', '--app', path.join(BUILD, EXE_NAME)], { cwd: ROOT, encoding: 'utf8' }).replace(/\x1b\[[0-9;]*m/g, '');
  console.log(fr.split('\n').filter(l => /is (Enabled|Disabled)/.test(l)).map(l => '     ' + l.trim()).join('\n'));
  const fuse = (n) => (fr.match(new RegExp(n + ' is (Enabled|Disabled)')) || [])[1];
  ok(fuse('RunAsNode') === 'Disabled' && fuse('EnableNodeOptionsEnvironmentVariable') === 'Disabled' && fuse('EnableNodeCliInspectArguments') === 'Disabled' && fuse('EnableEmbeddedAsarIntegrityValidation') === 'Enabled' && fuse('OnlyLoadAppFromAsar') === 'Enabled', 'RunAsNode / NODE_OPTIONS / --inspect off, asar integrity + only-from-asar on');

  console.log('C — fused 2.6.4 build, leftover + unsigned app-code folders');
  let D = dirs('c');
  const fake = path.join(D.code, '2.7.0'); asar.extractAll(path.join(BUILD, 'resources', 'app.asar'), fake);
  const pj = JSON.parse(fs.readFileSync(path.join(fake, 'package.json'), 'utf8')); pj.version = '2.7.0'; fs.writeFileSync(path.join(fake, 'package.json'), JSON.stringify(pj));
  fs.appendFileSync(path.join(fake, 'main.js'), '\nrequire("fs").writeFileSync(require("path").join(process.env.NYX_DATA_DIR, "PWNED"), "1");\n');
  fs.writeFileSync(path.join(D.code, 'state.json'), JSON.stringify({ active: '2.7.0', previous: null, confirmed: true, tries: 0, electron: '45.2.3', history: [] }));
  let A = await startFused(BUILD, D);
  let I = await info(A.win);
  ok(I.version === '2.6.4' && !I.external && !fs.existsSync(path.join(D.data, 'PWNED')), 'an unsigned "2.7.0" folder in app-code is NOT loaded; bundled 2.6.4 boots', { v: I.version, ext: I.external });
  ok(I.electron === '45.2.3' && /^156\./.test(I.chrome), 'packaged runtime: Electron ' + I.electron + ' · Chromium ' + I.chrome + ' · Node ' + I.node, I);
  await openUpdate(A.win);
  const rt = await A.win.evaluate(() => document.querySelector('[data-testid=upd-runtime]')?.textContent || '');
  ok(rt === `Electron ${I.electron} · Chromium ${I.chrome} · Node ${I.node}`, 'Settings → About: ' + rt, rt);
  const r0 = await A.win.evaluate(() => ({ req: typeof require, proc: typeof process, api: typeof nyxAPI }));
  ok(r0.req === 'undefined' && r0.proc === 'undefined' && r0.api === 'object', 'packaged renderer: no Node, only the bridge', r0);
  const procs = fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)).map(pid => { try { return { pid, ppid: (fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s*(\d+)/m) || [])[1], cmd: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8') }; } catch (e) { return null; } }).filter(Boolean);
  const desc = new Set([String(A.p.pid)]); for (let k = 0; k < 6; k++) for (const x of procs) if (desc.has(x.ppid)) desc.add(x.pid);
  const tabs = procs.filter(x => desc.has(x.pid) && x.cmd.includes('--type=renderer')).map(x => x.pid);
  const sec = [...new Set(tabs)].map(pid => { try { return (fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^Seccomp:\s*(\d)/m) || [])[1]; } catch (e) { return 'gone'; } }).filter(x => x !== 'gone');
  ok(sec.length > 0 && sec.every(x => x === '2'), `packaged renderers run under seccomp-bpf (${sec.length})`, sec);
  const pl = await A.win.evaluate(() => nyxAPI.inv('plugins:list').then(l => l.map(p => p.id)));
  ok(pl.includes('pomodoro') && pl.length >= 15, 'bundled plugins load from app.asar.unpacked (hash-checked)', pl.length);
  await A.kill();

  console.log('F — RunAsNode / NODE_OPTIONS / --inspect are ignored');
  D = dirs('f');
  const marker = path.join(TMP, 'node-ran'); const evil = path.join(TMP, 'evil.js'); fs.writeFileSync(evil, `require('fs').writeFileSync(${JSON.stringify(marker)}, process.argv.join(' '))`);
  const ran = await startFused(BUILD, { ...D, args: [evil], env: { ELECTRON_RUN_AS_NODE: '1' }, wait: false }); await sleep(6000);
  ok(!fs.existsSync(marker), 'ELECTRON_RUN_AS_NODE=1 does not turn the exe into node (script not run)'); await ran.kill();
  const insp = await freePort();
  A = await startFused(BUILD, { ...D, args: [`--inspect=${insp}`], env: { NODE_OPTIONS: `--require ${evil}` } });
  ok(!fs.existsSync(marker), 'NODE_OPTIONS=--require … is ignored');
  ok(!(await listening(insp)), `--inspect=${insp} opens no debugger port`);
  ok((await info(A.win)).version === '2.6.4', 'app still starts normally with those switches');
  await A.kill();

  console.log('F — tampered app.asar.unpacked file is refused');
  const T = path.join(TMP, 'tampered'); execFileSync('cp', ['-a', BUILD, T]);
  fs.appendFileSync(path.join(T, 'resources', 'app.asar.unpacked', 'app', 'plugins', 'pomodoro', 'manifest.json'), ' ');
  A = await startFused(T, dirs('t'));
  const pl2 = await A.win.evaluate(() => nyxAPI.inv('plugins:list').then(l => l.map(p => p.id)));
  ok(!pl2.includes('pomodoro') && pl2.includes('weather'), 'modified unpacked plugin manifest → that plugin is not loaded, others are', pl2.length);
  await A.kill(); fs.rmSync(T, { recursive: true, force: true });

  console.log('A — real installed 2.6.3 (Electron 45.2.1) checks for updates');
  const SRC = base263(); ok(JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version === '2.6.3', 'base is the released v2.6.3 code (' + BASE_REF + ')');
  if (fs.existsSync(ELOLD)) {
    D = dirs('a'); fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SRC, 'node_modules'), 'dir');
    const app = await _electron.launch({ chromiumSandbox: true, executablePath: ELOLD, args: [SRC], env: { ...process.env, HOME: D.home, NYX_TEST: '1', NYX_DATA_DIR: D.data, NYX_CODE_DIR: D.code } });
    const win = await app.firstWindow(); await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 30000 });
    const v = await app.evaluate(() => process.versions.electron);
    await win.evaluate((u) => { (Store.state.settings.update ||= {}).url = u; Store.save(true); }, URL_); await openUpdate(win);
    await win.evaluate(() => [...document.querySelectorAll('#drawer button')].find(b => /Έλεγχος/.test(b.textContent)).click());
    await win.waitForFunction(() => /✨|⚠️|✅/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 20000 });
    const nb = await win.evaluate(() => ({ s: document.querySelector('.upd-status')?.textContent, card: document.querySelector('.upd-card.new')?.textContent || '', btn: !!document.querySelector('.upd-card.new button') }));
    ok(v === '45.2.1' && /2\.6\.4/.test(nb.s) && !nb.btn && /Nyx|πλήρ|full/i.test(nb.card), 'v2.6.3 on 45.2.1 sees 2.6.4 and asks for the full build (no code-only install on the old runtime)', nb);
    ok(!fs.existsSync(path.join(D.code, '2.6.4')), 'nothing was installed');
    await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await sleep(1500); try { app.process().kill(); } catch (e) {}
    fs.unlinkSync(path.join(SRC, 'node_modules'));
  } else ok(false, 'Electron 45.2.1 not found at ' + ELOLD);

  console.log('B — signed patch 2.6.3 → 2.6.4 on the fused runtime');
  const F = path.join(TMP, 'fixture-2.6.3'); execFileSync('cp', ['-a', BUILD, F]);
  const flt = copyFiltered(SRC, path.join(TMP, 'src-2.6.3-f')); fs.rmSync(path.join(F, 'resources', 'app.asar')); fs.rmSync(path.join(F, 'resources', 'app.asar.unpacked'), { recursive: true, force: true });
  await asar.createPackageWithOptions(flt, path.join(F, 'resources', 'app.asar'), { unpack: '{**/main/res/**,**/app/plugins/**}' });
  D = dirs('b');
  A = await startFused(F, D);
  ok((await info(A.win)).version === '2.6.3', 'fixture runs the 2.6.3 code (fused 45.2.3 exe)');
  const sid = await A.win.evaluate(() => { const it = Features.addAtCenter({ type: 'sticky', html: 'πριν την 2.6.4', w: 300, h: 220 }); Store.save(true); return it.id; });
  await A.win.evaluate((u) => { (Store.state.settings.update ||= {}).url = u; Store.save(true); }, URL_); await openUpdate(A.win);
  await A.win.evaluate(() => [...document.querySelectorAll('#drawer button')].find(b => /Έλεγχος/.test(b.textContent)).click());
  await A.win.waitForSelector('.upd-card.new button', { timeout: 20000 });
  await A.win.evaluate(() => document.querySelector('.upd-card.new button').click());
  await A.win.waitForFunction(() => /✅|⚠️/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 60000 });
  const st = await status(A.win);
  ok(/✅/.test(st) && st.includes('2.6.4'), 'downloaded over http + signature verified + applied', st);
  ok(core.readState(D.code).active === '2.6.4' && fs.existsSync(path.join(D.code, '2.6.4', 'main', 'ipc-guard.js')), 'applied into app-code/2.6.4', core.readState(D.code));
  ok(fs.existsSync(path.join(D.code, '2.6.4', '.nyx-signed.json')), 'the 2.6.3 updater stores the signed record (.nyx-signed.json) for boot verification');
  await sleep(1500); await A.kill();
  A = await startFused(F, D);
  I = await info(A.win);
  ok(I.version === '2.6.4' && I.external && I.electron === '45.2.3', 'after restart 2.6.4 starts (from verified app-code)', { v: I.version, ext: I.external, el: I.electron });
  ok(await A.win.evaluate((id) => !!Store.get(id) && /πριν την 2\.6\.4/.test(Store.get(id).html), sid), 'your canvas survived');
  const csp = await A.win.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '');
  ok(/default-src 'none'/.test(csp), '2.6.4 strict CSP active after the patch');
  await openUpdate(A.win);
  ok(/Electron 45\.2\.3 · Chromium 156\./.test(await A.win.evaluate(() => document.querySelector('[data-testid=upd-runtime]')?.textContent || '')), 'About shows the new runtime');
  await A.win.evaluate(() => Panels.closeDrawer());
  await sleep(10500); ok(core.readState(D.code).confirmed === true, 'healthy start confirmed (no rollback)', core.readState(D.code));
  await A.kill();
  // tamper the installed code → 2.6.4's verification refuses it on the next boot of a 2.6.4 build (here: the real build, code root shared)
  fs.appendFileSync(path.join(D.code, '2.6.4', 'main.js'), '\n// tampered\n');
  const st2 = core.readState(D.code); const pk = require('../main/update-key');
  // write the record a 2.6.4 updater stores (signed manifest + signature from the real patch), then check boot verification
  const zp = core.openPatch(PATCH, pk).zip; fs.writeFileSync(path.join(D.code, '2.6.4', '.nyx-signed.json'), JSON.stringify({ manifest: zp.get('manifest.json').toString('base64'), sig: zp.get('manifest.sig').toString('utf8').trim() }));
  fs.writeFileSync(path.join(D.code, '2.6.4', 'main.js'), fs.readFileSync(path.join(D.code, '2.6.4', 'main.js'), 'utf8').replace(/\n\/\/ tampered\n$/, ''));
  const good = core.chooseBoot(D.code, { builtinVersion: '2.6.3', electron: '45.2.3', publicKey: pk });
  ok(good.dir && good.version === '2.6.4', '2.6.4 boot verification accepts the intact, signed app-code/2.6.4', good);
  fs.appendFileSync(path.join(D.code, '2.6.4', 'main.js'), '\n// tampered\n');
  const pick = core.chooseBoot(D.code, { builtinVersion: '2.6.3', electron: '45.2.3', publicKey: pk });
  ok(!pick.dir, 'one modified file in app-code/2.6.4 → refused, falls back to bundled code', { pick, active: st2.active });

  srv.close();
  ok(!errors.length, 'no page errors', errors.slice(0, 6));
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nv2.6.4 fused build: ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
