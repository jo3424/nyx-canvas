// Nyx v2.5 release check (headless): xvfb-run -a node tests/v25-update.js
// Starts the REAL v2.4.0 code (git commit 6808299), installs the REAL signed patch dist/updates/nyx-2.4.0-to-2.5.0.zip
// through Ρυθμίσεις → Ενημερώσεις → «Εγκατάσταση από αρχείο», restarts and checks that v2.5.0 runs with its new features
// and that the user's canvas survives. No signing key needed: the v2.4.0 app verifies the patch with its baked-in public key.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
const core = require('../main/update-core');
const ROOT = path.join(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots');
const PATCH = path.join(ROOT, 'dist', 'updates', 'nyx-2.4.0-to-2.5.0.zip'); const BASE_REF = process.env.NYX_BASE_REF || '6808299';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v24u-')); const CODE = path.join(DATA, 'app-code'); const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-base24-'));
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function launch(v25) {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: process.env.NYX_ELECTRON || require('electron'), args: [BASE], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_CODE_DIR: CODE } });
  app.process().stdout.on('data', d => { const s = String(d); if (/\[renderer\]|Error/.test(s)) errors.push('main: ' + s.trim().slice(0, 300)); });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction((v25) => window.__nyxV2Ready === true && (!v25 || window.__nyxV25Ready === true), v25, { timeout: 30000 }); await win.waitForTimeout(500);
  return { app, win };
}
async function quit(app) { const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const openTab = async (win, tab) => { await win.evaluate((tab) => { Panels.drawerKind = null; Panels.settings(tab); }, tab); await win.waitForTimeout(500); };
const version = (win) => win.waitForSelector('[data-testid=upd-version]').then(e => e.textContent());
const status = (win) => win.evaluate(() => document.querySelector('.upd-status')?.textContent || '');
(async () => {
  if (!fs.existsSync(PATCH)) { console.log('missing ' + PATCH + ' → run node scripts/make-patch.js first'); process.exit(1); }
  execFileSync('bash', ['-c', 'git archive --format=tar "$1" | tar -x -C "$2"', '_', BASE_REF, BASE], { cwd: ROOT });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(BASE, 'node_modules'), 'dir');
  ok(JSON.parse(fs.readFileSync(path.join(BASE, 'package.json'), 'utf8')).version === '2.4.0', 'base is the released v2.4.0 code (' + BASE_REF + ')');
  const pub = require('../main/update-key'); const m = core.openPatch(PATCH, pub).manifest;
  ok(m.base === '2.4.0' && m.version === '2.5.0', 'patch manifest 2.4.0 → 2.5.0, signature verifies', { base: m.base, version: m.version });
  ok(!Object.keys(m.files).some(f => /\.pem$|\.key$|nebula-keys|^tests\/|^shots\/|^dist\/|^node_modules\//.test(f)), 'no keys / tests / shots / dist / node_modules inside');
  ok(['app/js/v25/core.js', 'app/js/v25/faces.js', 'main/v25.js', 'main/faces-worker.js', 'main/res/gpu.ps1', 'main/procs.js', 'CHANGELOG.json'].every(f => m.changed.includes(f)), 'new + changed v2.5 files in the delta', m.changed.length);

  console.log('Run 1 — v2.4.0: make a note, install the release patch from file');
  let { app, win } = await launch(false);
  const sid = await win.evaluate(() => { const it = Features.addAtCenter({ type: 'sticky', html: 'πριν την ενημέρωση', w: 300, h: 220 }); Store.save(true); return it.id; });
  await openTab(win, 'update');
  ok(await version(win) === 'v2.4.0', 'running v2.4.0', await version(win));
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, PATCH);
  await win.evaluate(() => { const b = [...document.querySelectorAll('#drawer button')].find(b => b.textContent.includes('Εγκατάσταση από αρχείο')); b.click(); });
  await win.waitForFunction(() => /✅|⚠️/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 30000 });
  ok(/✅/.test(await status(win)) && (await status(win)).includes('2.5.0'), 'v2.4.0 updater accepts the signed patch', await status(win));
  ok(core.readState(CODE).active === '2.5.0' && fs.existsSync(path.join(CODE, '2.5.0', 'app', 'js', 'v25', 'core.js')), 'applied into app-code/2.5.0', core.readState(CODE));
  await win.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove())); await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(SHOTS, 'v25-update-installed.png') });
  await quit(app);

  console.log('Run 2 — restarted into v2.5.0');
  ({ app, win } = await launch(true));
  const boot = await app.evaluate(() => global.__nyxBoot);
  ok(boot.external && boot.version === '2.5.0', 'boots the updated 2.5.0 code', boot);
  await openTab(win, 'update');
  ok(await version(win) === 'v2.5.0', 'UI shows v2.5.0', await version(win));
  ok(/Πρόσωπα|sd-server|Απόδοση/.test(await win.evaluate(() => document.querySelector('.upd-changelog')?.textContent || '')), 'v2.5 changelog shown (Greek)');
  await win.evaluate(() => Panels.closeDrawer());
  ok(await win.evaluate((id) => !!Store.get(id) && /πριν την ενημέρωση/.test(Store.get(id).html), sid), 'your canvas survived the update');
  ok(await win.evaluate(() => typeof Lazy === 'object' && typeof Perf === 'undefined' && typeof Faces === 'undefined'), 'v2.5 core live, heavy panels still lazy');
  await win.keyboard.press('Control+Shift+M'); await win.waitForSelector('.perf .pcard', { timeout: 10000 }).catch(() => {});
  ok(await win.evaluate(() => typeof Perf === 'object' && document.querySelectorAll('.perf .pcard').length === 4), 'Performance panel opens after the update (new main IPC perf:snapshot works)');
  await win.screenshot({ path: path.join(SHOTS, 'v25-update-running.png') });
  ok(await win.evaluate(() => Store.state.settings.faces.consentAck === false && Store.state.settings.ai.router.enabled === false && Store.state.settings.sogni.enabled === false), 'new features arrive OFF');
  ok(fs.existsSync(path.join(CODE, '2.5.0', 'main', 'res', 'gpu.ps1')) && fs.existsSync(path.join(CODE, '2.5.0', 'main', 'vendor', 'sogni.js')) && !fs.readdirSync(path.join(CODE, '2.5.0')).some(f => /\.pem$/.test(f)), 'new main files shipped (gpu.ps1, vendor), no key files');
  await win.evaluate(() => Panels.closeDrawer());
  await win.waitForTimeout(10500); ok(core.readState(CODE).confirmed === true, 'healthy start confirmed', core.readState(CODE));
  await quit(app);
  ok(!errors.length, 'no renderer/main errors', errors);
  console.log(`\nv2.5 update: ${passes} passed, ${fails} failed`);
  fs.rmSync(BASE, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
