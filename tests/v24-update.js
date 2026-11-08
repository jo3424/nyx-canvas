// Nyx v2.4 release check (headless): xvfb-run -a node tests/v24-update.js
// Starts the REAL v2.3.0 code (git commit), installs the REAL release patch dist/updates/nyx-2.3.0-to-2.4.0.zip
// through Ρυθμίσεις → Ενημερώσεις → «Εγκατάσταση από αρχείο», restarts and checks that v2.4.0 runs with its new features.
// No signing key needed: the patch is already signed; the v2.3.0 app verifies it with its baked-in public key.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
const core = require('../main/update-core');
const ROOT = path.join(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots');
const PATCH = path.join(ROOT, 'dist', 'updates', 'nyx-2.3.0-to-2.4.0.zip'); const BASE_REF = process.env.NYX_BASE_REF || '076741d';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v23u-')); const CODE = path.join(DATA, 'app-code'); const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-base22-'));
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
  ok(JSON.parse(fs.readFileSync(path.join(BASE, 'package.json'), 'utf8')).version === '2.3.0', 'base is the released v2.3.0 code (' + BASE_REF + ')');
  const pub = require('../main/update-key'); const m = core.openPatch(PATCH, pub).manifest;
  ok(m.base === '2.3.0' && m.version === '2.4.0' && !m.changed.some(f => /\.pem$|\.key$|nebula-keys|^tests\/|^shots\//.test(f)), 'patch manifest 2.3.0 → 2.4.0, no keys/tests inside', { base: m.base, version: m.version, changed: m.changed });

  console.log('Run 1 — v2.3.0, install the release patch from file');
  let { app, win } = await launch();
  await openTab(win, 'update');
  ok(await version(win) === 'v2.3.0', 'running v2.3.0', await version(win));
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, PATCH);
  await win.evaluate(() => { const b = [...document.querySelectorAll('#drawer button')].find(b => b.textContent.includes('Εγκατάσταση από αρχείο')); b.click(); });
  await win.waitForFunction(() => /✅|⚠️/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 30000 });
  ok(/✅/.test(await status(win)) && (await status(win)).includes('2.4.0'), 'v2.3.0 updater accepts the signed patch', await status(win));
  ok(core.readState(CODE).active === '2.4.0' && fs.existsSync(path.join(CODE, '2.4.0', 'app', 'js', 'features.js')), 'applied into app-code/2.4.0', core.readState(CODE));
  await win.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove())); await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(SHOTS, 'v24-update-installed.png') });
  await quit(app);

  console.log('Run 2 — restarted into v2.4.0');
  ({ app, win } = await launch());
  const boot = await app.evaluate(() => global.__nyxBoot);
  ok(boot.external && boot.version === '2.4.0', 'boots the updated 2.4.0 code', boot);
  await openTab(win, 'update');
  ok(await version(win) === 'v2.4.0', 'UI shows v2.4.0', await version(win));
  ok(/υπογραμμιστ|Groq|ελληνική φωνή/i.test(await win.evaluate(() => document.querySelector('.upd-changelog')?.textContent || '')), 'v2.4 changelog shown');
  ok(await win.evaluate(() => Canvas.ATTACHABLE.includes('ink') && typeof Tools.hostUnder === 'function' && typeof Assistant.layout === 'function' && typeof Speech.speechText === 'function' && !!AI.prov('groq')), 'v2.4 code is live (ink on notes, assistant layout, speech, Groq provider)');
  ok(fs.existsSync(path.join(CODE, '2.4.0', 'main', 'res', 'tts.ps1')) && fs.existsSync(path.join(CODE, '2.4.0', 'main', 'vsengine.js')), 'new main files shipped (tts.ps1, vsengine.js)');
  const sid = await win.evaluate(() => { const it = Features.addAtCenter({ type: 'sticky', html: 'update', w: 300, h: 220 }); Canvas.select([]); return it.id; });
  const r = await win.evaluate((id) => { const b = Items.el(Store.get(id)).getBoundingClientRect(); return [b.x, b.y]; }, sid);
  await win.evaluate(() => Tools.pick('highlighter')); await win.mouse.move(r[0] + 30, r[1] + 60); await win.mouse.down(); await win.mouse.move(r[0] + 200, r[1] + 62, { steps: 6 }); await win.mouse.up(); await win.waitForTimeout(200);
  ok(await win.evaluate((id) => Store.items().some(i => i.type === 'ink' && i.kind === 'highlighter' && i.parent === id), sid), 'after the update the highlighter marks on a note');
  await win.evaluate(() => { Panels.settings(); Assistant.show(); }); await win.waitForTimeout(500);
  ok(await win.evaluate(() => { const d = document.querySelector('#drawer').getBoundingClientRect(), a = document.querySelector('#assistant').getBoundingClientRect(); return a.right <= d.left + 1 || a.left >= d.right - 1 || a.bottom <= d.top + 1 || a.top >= d.bottom - 1; }), 'after the update the assistant sits beside Settings');
  await win.evaluate(() => { Assistant.hide(); Panels.closeDrawer(); });
  await win.waitForTimeout(10500); ok(core.readState(CODE).confirmed === true, 'healthy start confirmed', core.readState(CODE));
  await quit(app);
  ok(!errors.length, 'no renderer/main errors', errors);
  console.log(`\n${passes} passed, ${fails} failed`);
  fs.rmSync(BASE, { recursive: true, force: true }); fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
