// Nyx v2.1 end-to-end (headless): xvfb-run -a node tests/v21.js
// Settings → Ενημερώσεις: install a signed patch from file, restart into it, update over (local) URL, rollback ×2.
// Settings → Εργαλεία & διαδρομές: cached detection, rescan, deep scan. English mode across the new tabs.
// Needs the box signing key (/workspace/nebula-keys) to sign the test patches; it is read here only, never written anywhere.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), crypto = require('crypto');
const core = require('../main/update-core'); const { copyFiltered } = require('../scripts/pack-filter');
const ROOT = path.join(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const KEYF = process.env.NYX_SIGN_KEY || '/workspace/nebula-keys/nyx-update-ed25519.pem';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v21-')); const CODE = path.join(DATA, 'app-code'); const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v21p-'));
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const snap = async (win, name) => { await win.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove())); await win.waitForTimeout(200); await win.screenshot({ path: path.join(SHOTS, name) }); };
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_CODE_DIR: CODE } });
  app.process().stdout.on('data', d => { const s = String(d); if (/\[renderer\]|Error/.test(s)) errors.push('main: ' + s.trim().slice(0, 300)); });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 25000 }); await win.waitForTimeout(500);
  return { app, win };
}
async function quit(app) { const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const openTab = async (win, tab) => { await win.evaluate((tab) => { Panels.drawerKind = null; Panels.settings(tab); }, tab); await win.waitForTimeout(400); };
const version = (win) => win.waitForSelector('[data-testid=upd-version]').then(e => e.textContent());
const status = (win) => win.evaluate(() => document.querySelector('.upd-status')?.textContent || '');
const clickText = (win, txt) => win.evaluate((txt) => { const b = [...document.querySelectorAll('#drawer button')].find(b => b.textContent.includes(txt)); if (!b) throw new Error('no button ' + txt); b.click(); }, txt);
const stubDialog = (app, file) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, file);
const stateNow = () => core.readState(CODE);

function makeTree(ver, note) { // filtered working tree with a bumped version + changelog entry
  const d = copyFiltered(ROOT, path.join(TMP, 'tree-' + ver));
  const pj = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')); pj.version = ver; fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pj, null, 2));
  const clf = path.join(d, 'CHANGELOG.json'); const cl = JSON.parse(fs.readFileSync(clf, 'utf8')); cl[ver] = note; fs.writeFileSync(clf, JSON.stringify(cl, null, 1));
  fs.writeFileSync(path.join(d, 'app', 'e2e-marker.txt'), 'built for ' + ver);
  return d;
}
(async () => {
  if (!fs.existsSync(KEYF)) { console.log('signing key missing → skipped'); process.exit(0); }
  const priv = fs.readFileSync(KEYF, 'utf8'); const E = require('electron/package.json').version;
  const base = copyFiltered(ROOT, path.join(TMP, 'base')); const baseFiles = core.treeManifest(base); const BASEV = require('../package.json').version;
  const [MA, MI] = BASEV.split('.'); const v1 = `${MA}.${MI}.91`, v2 = `${MA}.${MI}.92`; // always NEWER than the code under test (was hard-coded 2.1.x → a downgrade once the app reached 2.2)
  const t1 = makeTree(v1, { el: ['Δοκιμαστική ενημέρωση ' + v1], en: ['Test update ' + v1] });
  const t2 = makeTree(v2, { el: ['Νέα λειτουργία δοκιμής', 'Διορθώσεις σταθερότητας'], en: ['Test feature', 'Stability fixes'] });
  const P1 = core.buildPatch({ fromFiles: baseFiles, fromVersion: BASEV, toDir: t1, toVersion: v1, electron: E, changelog: { el: ['Δοκιμαστική ενημέρωση ' + v1], en: ['Test update ' + v1] }, privateKey: priv });
  const P2 = core.buildPatch({ fromFiles: core.treeManifest(t1), fromVersion: v1, toDir: t2, toVersion: v2, electron: E, changelog: { el: ['Νέα λειτουργία δοκιμής', 'Διορθώσεις σταθερότητας'], en: ['Test feature', 'Stability fixes'] }, privateKey: priv });
  const f1 = path.join(TMP, `nyx-${BASEV}-to-${v1}.zip`); fs.writeFileSync(f1, P1.zip);
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const fBad = path.join(TMP, 'nyx-forged.zip'); fs.writeFileSync(fBad, core.buildPatch({ fromFiles: baseFiles, fromVersion: BASEV, toDir: t1, toVersion: v1, electron: E, privateKey: other }).zip);
  console.log(`test patches: delta ${BASEV}→${v1} ${P1.manifest.changed.length} files / ${(P1.zip.length / 1024).toFixed(0)} KB; ${v1}→${v2} ${P2.manifest.changed.length} files`);
  ok(P1.manifest.changed.length <= 3 && P1.manifest.changed.includes('package.json'), 'delta contains only the changed files', P1.manifest.changed);
  // local release server (stands in for GitHub Releases)
  const srv = http.createServer((q, r) => {
    if (q.url === '/rel/nyx-latest.json') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ version: v2, electron: E, changelog: P2.manifest.changelog, date: new Date().toISOString(), patches: { [v1]: `nyx-${v1}-to-${v2}.zip` } })); }
    if (q.url === `/rel/nyx-${v1}-to-${v2}.zip`) return r.end(P2.zip);
    r.statusCode = 404; r.end();
  }); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const URL_ = `http://127.0.0.1:${srv.address().port}/rel/nyx-latest.json`;

  console.log('Run 1 — bundled version, install from file');
  let { app, win } = await launch();
  await openTab(win, 'update'); await win.waitForTimeout(600);
  ok(await win.evaluate(() => [...document.querySelectorAll('.set-tabs button')].map(b => b.dataset.settab).join()) === 'general,update,tools', 'Settings has 3 tabs: general / update / tools');
  ok(await version(win) === 'v' + BASEV, 'shows current version', await version(win));
  ok(await win.evaluate(() => !!document.querySelector('.upd-changelog')), 'changelog shown');
  ok(await win.evaluate(() => !document.querySelector('#board .upd, #canvas .upd')), 'nothing added to the canvas');
  await stubDialog(app, fBad); await clickText(win, 'Εγκατάσταση από αρχείο'); await win.waitForFunction(() => /⚠️/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 10000 });
  ok(/υπογραφ/i.test(await status(win)) && !fs.existsSync(path.join(CODE, v1)), 'forged patch (wrong key) rejected, nothing written', await status(win));
  await stubDialog(app, f1); await clickText(win, 'Εγκατάσταση από αρχείο'); await win.waitForFunction(() => /✅/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 20000 });
  ok((await status(win)).includes(v1) && await win.evaluate(() => !document.querySelector('.upd-restart').hidden), 'installed → restart prompt shown', await status(win));
  ok(stateNow().active === v1 && fs.existsSync(path.join(CODE, v1, 'app', 'e2e-marker.txt')), 'applied into versioned folder app-code/' + v1, stateNow());
  await quit(app);

  console.log('Run 2 — restarted into ' + v1 + ', update over URL');
  ({ app, win } = await launch());
  const boot = await app.evaluate(() => global.__nyxBoot);
  ok(boot.external && boot.version === v1 && boot.dir.endsWith(v1), 'boots the updated code folder', boot);
  await openTab(win, 'update');
  ok(await version(win) === 'v' + v1, 'UI shows v' + v1);
  await win.waitForTimeout(10600); ok(stateNow().confirmed === true, 'healthy start confirmed (crash counter reset)', stateNow());
  await win.evaluate((u) => { Store.state.settings.update = { ...(Store.state.settings.update || {}), url: u }; Store.save(); }, URL_);
  await openTab(win, 'update'); await clickText(win, 'Έλεγχος για ενημερώσεις');
  await win.waitForFunction(() => /✨/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 15000 }).catch(() => {});
  ok((await status(win)).includes(v2) && await win.evaluate(() => document.querySelector('.upd-card.new')?.textContent.includes('Διορθώσεις σταθερότητας')), 'check finds ' + v2 + ' with its changelog', await status(win));
  await snap(win, 'v21-update.png');
  await clickText(win, 'Λήψη'); await win.waitForFunction(() => /✅|⚠️/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 20000 });
  ok((await status(win)).includes(v2) && stateNow().active === v2 && stateNow().previous === v1, 'download + verify + apply ' + v2, [await status(win), stateNow()]);
  ok(fs.readdirSync(CODE).filter(d => !d.endsWith('.json')).sort().join() === [v1, v2].join(), 'only active + previous kept', fs.readdirSync(CODE));
  await quit(app);

  console.log('Run 3 — ' + v2 + ', rollback');
  ({ app, win } = await launch()); await openTab(win, 'update');
  ok(await version(win) === 'v' + v2, 'restarted into v' + v2);
  await win.evaluate(() => { window.confirm = () => true; }); await clickText(win, 'Επαναφορά');
  await win.waitForFunction(() => /↩️/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 10000 });
  ok(stateNow().active === v1 && (await status(win)).includes(v1), 'rollback → ' + v1, [await status(win), stateNow()]);
  await quit(app);
  ({ app, win } = await launch()); await openTab(win, 'update');
  ok(await version(win) === 'v' + v1, 'after restart: v' + v1);
  await win.evaluate(() => { window.confirm = () => true; }); await clickText(win, 'Επαναφορά');
  await win.waitForFunction(() => /↩️/.test(document.querySelector('.upd-status')?.textContent), null, { timeout: 10000 });
  ok(stateNow().active === null, 'second rollback → bundled version', stateNow());
  await quit(app);

  console.log('Run 4 — bundled again; tools & paths');
  ({ app, win } = await launch());
  ok((await app.evaluate(() => global.__nyxBoot)).external === false, 'back on the bundled code');
  const t0 = Date.now(); await openTab(win, 'tools'); await win.waitForSelector('[data-testid=tools-at]', { timeout: 30000 }); const firstMs = Date.now() - t0;
  const rows = await win.evaluate(() => [...document.querySelectorAll('#drawer .tool-row, #drawer .row')].length);
  ok(rows >= 8, 'tool rows listed', rows);
  ok(await win.evaluate(() => /FFmpeg/i.test(document.querySelector('#drawer').textContent) && /Python/.test(document.querySelector('#drawer').textContent) && /Vulkan/.test(document.querySelector('#drawer').textContent)), 'ffmpeg / Python / Vulkan rows present');
  const t1s = Date.now(); await openTab(win, 'tools'); await win.waitForSelector('[data-testid=tools-at]'); const cachedMs = Date.now() - t1s;
  ok(await win.evaluate(() => /cache|μνήμη|αποθηκ/i.test(document.querySelector('[data-testid=tools-at]').textContent)), 'second open served from cache', await win.evaluate(() => document.querySelector('[data-testid=tools-at]').textContent));
  console.log(`     (first ${firstMs} ms, cached ${cachedMs} ms)`);
  await win.click('[data-testid=tools-rescan]'); await win.waitForTimeout(300); await win.waitForSelector('[data-testid=tools-at]', { timeout: 30000 });
  ok(!/cache|μνήμη|αποθηκ/i.test(await win.evaluate(() => document.querySelector('[data-testid=tools-at]').textContent)), '«Επανασάρωση» re-detects');
  // deep scan over a folder with a (sparse) 80 MB model
  const MD = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-models-')); fs.mkdirSync(path.join(MD, 'llm', 'deep'), { recursive: true });
  const fh = fs.openSync(path.join(MD, 'llm', 'deep', 'qwen3-test-Q4_K_M.gguf'), 'w'); fs.ftruncateSync(fh, 80 * 1024 * 1024); fs.closeSync(fh);
  await win.evaluate((r) => API.inv('sys:scan', { roots: [r] }), MD);
  await win.waitForFunction(() => API.inv('sys:scanState').then(s => !s.running && s.last), null, { timeout: 20000, polling: 300 });
  await openTab(win, 'tools'); await win.waitForTimeout(500);
  ok(await win.evaluate(() => document.querySelector('.scan-res')?.textContent.includes('qwen3-test-Q4_K_M.gguf')), 'deep scan finds the .gguf, results cached in the panel');
  await win.evaluate(() => { document.querySelector('#drawer-body').scrollTop = 0; });
  await snap(win, 'v21-tools.png');

  console.log('Run 5 — English');
  await win.evaluate(() => App.setLang('en')); await win.waitForTimeout(800);
  await win.waitForFunction(() => window.__nyxV2Ready === true && LANG === 'en', null, { timeout: 25000 });
  const greek = (sel) => win.evaluate((sel) => { const el = document.querySelector(sel); const txt = el ? el.innerText : ''; return (txt.match(/[^\n]*[\u0370-\u03ff\u1f00-\u1fff][^\n]*/g) || []).filter(l => !/Ελληνικά/.test(l)); }, sel);
  await openTab(win, 'update'); await win.waitForTimeout(500);
  const gU = await greek('#drawer'); ok(gU.length === 0, 'Update tab fully English', gU);
  ok(await win.evaluate(() => /Check for updates/.test(document.querySelector('#drawer').textContent)), 'English labels');
  await snap(win, 'v21-english.png');
  await openTab(win, 'tools'); await win.waitForSelector('[data-testid=tools-at]'); await win.waitForTimeout(300);
  const gT = await greek('#drawer'); ok(gT.length === 0, 'Tools tab fully English', gT);
  await openTab(win, 'general'); const gG = await greek('#drawer'); ok(gG.length === 0, 'General settings fully English', gG);
  await win.evaluate(() => { Panels.drawerKind = null; Panels.closeDrawer?.(); });
  const boards = await win.evaluate(() => Store.state.boards.map(b => b.name)); // user data (board names) stays as typed
  const gTop = (await greek('#topbar, .topbar, header')).filter(l => !boards.some(b => l.includes(b))); ok(gTop.length === 0, 'top bar English (user board names excluded)', gTop);
  await win.evaluate(() => App.setLang('el')); await win.waitForTimeout(800); await win.waitForFunction(() => window.__nyxV2Ready === true && LANG === 'el', null, { timeout: 25000 });
  await quit(app); srv.close();

  const errs = errors.filter(e => !/DevTools|Autofill|GPU|gpu|ERR_|Electron Security/.test(e));
  ok(errs.length === 0, 'no renderer/page errors', errs);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
