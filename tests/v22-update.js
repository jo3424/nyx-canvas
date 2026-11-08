// Nyx v2.2 release check (headless): xvfb-run -a node tests/v22-update.js
// Starts the REAL v2.1.0 code (git tag/commit), installs the REAL release patch dist/updates/nyx-2.1.0-to-2.2.0.zip
// through Ρυθμίσεις → Ενημερώσεις → «Εγκατάσταση από αρχείο», restarts and checks that v2.2.0 runs with its new features.
// No signing key needed: the patch is already signed; the v2.1.0 app verifies it with its baked-in public key.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
const core = require('../main/update-core');
const ROOT = path.join(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots');
const PATCH = path.join(ROOT, 'dist', 'updates', 'nyx-2.1.0-to-2.2.0.zip'); const BASE_REF = process.env.NYX_BASE_REF || '33ad5ed';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v22u-')); const CODE = path.join(DATA, 'app-code'); const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-base21-'));
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: process.env.NYX_ELECTRON || require('electron'), args: [BASE], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_CODE_DIR: CODE } });
  app.process().stdout.on('data', d => { const s = String(d); if (/\[renderer\]|Error/.test(s)) errors.push('main: ' + s.trim().slice(0, 300)); });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 25000 }); await win.waitForTimeout(500);
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
  ok(JSON.parse(fs.readFileSync(path.join(BASE, 'package.json'), 'utf8')).version === '2.1.0', 'base is the released v2.1.0 code (' + BASE_REF + ')');
  const pub = require('../main/update-key'); const m = core.openPatch(PATCH, pub).manifest;
  ok(m.base === '2.1.0' && m.version === '2.2.0' && !m.changed.some(f => /\.pem$|\.key$|nebula-keys|^tests\/|^shots\//.test(f)), 'patch manifest 2.1.0 → 2.2.0, no keys/tests inside', { base: m.base, version: m.version, changed: m.changed });

  console.log('Run 1 — v2.1.0, install the release patch from file');
  let { app, win } = await launch();
  await openTab(win, 'update');
  ok(await version(win) === 'v2.1.0', 'running v2.1.0', await version(win));
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, PATCH);
  await win.evaluate(() => { const b = [...document.querySelectorAll('#drawer button')].find(b => b.textContent.includes('Εγκατάσταση από αρχείο')); b.click(); });
  await win.waitForFunction(() => /✅|⚠️/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 30000 });
  ok(/✅/.test(await status(win)) && (await status(win)).includes('2.2.0'), 'v2.1.0 updater accepts the signed patch', await status(win));
  ok(core.readState(CODE).active === '2.2.0' && fs.existsSync(path.join(CODE, '2.2.0', 'main', 'finder.js')), 'applied into app-code/2.2.0', core.readState(CODE));
  await win.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove())); await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(SHOTS, 'v22-update-installed.png') });
  await quit(app);

  console.log('Run 2 — restarted into v2.2.0');
  ({ app, win } = await launch());
  const boot = await app.evaluate(() => global.__nyxBoot);
  ok(boot.external && boot.version === '2.2.0', 'boots the updated 2.2.0 code', boot);
  await openTab(win, 'update');
  ok(await version(win) === 'v2.2.0', 'UI shows v2.2.0', await version(win));
  ok(/whisper|LM Studio|TTS|Φωνή/i.test(await win.evaluate(() => document.querySelector('.upd-changelog')?.textContent || '')), 'v2.2 changelog shown');
  await win.evaluate(() => Panels.hub ? Panels.hub() : Hub.open()).catch(() => {}); await win.waitForTimeout(1200);
  ok(await win.evaluate(() => !!document.querySelector('[data-srv]') && typeof Hub.ttsRows === 'function'), 'v2.2 Hub (servers with auto-find, TTS presets) is live');
  await win.waitForTimeout(10500); ok(core.readState(CODE).confirmed === true, 'healthy start confirmed', core.readState(CODE));
  await quit(app);
  ok(!errors.length, 'no renderer/main errors', errors);
  console.log(`\n${passes} passed, ${fails} failed`);
  fs.rmSync(BASE, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
