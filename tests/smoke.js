// Headless smoke test: xvfb-run -a node tests/smoke.js
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-test-'));
const SHOTS = path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const errors = []; let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
async function quit(app) {
  const done = new Promise(r => app.process().once('exit', r));
  await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {});
  await Promise.race([done, new Promise(r => setTimeout(r, 8000))]);
  try { app.process().kill(); } catch (e) {}
}
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  app.process().stdout.on('data', d => { const s = String(d); if (/\[renderer\]/.test(s)) errors.push(s.trim()); });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await win.setViewportSize({ width: 1440, height: 880 }).catch(() => {});
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxReady === true, null, { timeout: 20000 });
  await win.waitForTimeout(800);
  return { app, win };
}
(async () => {
  console.log('Run 1 — fresh profile');
  let { app, win } = await launch();
  const n0 = await win.evaluate(() => Store.items().length);
  ok(n0 > 5, `welcome board has ${n0} items`);
  ok(await win.evaluate(() => document.querySelectorAll('.item').length) > 0, 'items rendered in DOM');
  await win.screenshot({ path: path.join(SHOTS, '01-midnight-welcome.png') });
  // real interaction: sticky tool + click
  await win.keyboard.press('n'); await win.mouse.click(1000, 620); await win.waitForTimeout(150);
  await win.keyboard.type('Από το τεστ 🚀'); await win.keyboard.press('Escape'); await win.waitForTimeout(150);
  // programmatic adds of many types
  await win.evaluate(() => {
    Features.addAtCenter({ type: 'text', html: 'PERSIST-CHECK κείμενο', font: 'Caveat', size: 34, w: 360, h: 60 });
    Features.addAtCenter({ type: 'emoji', char: '🔥', w: 90, h: 90 });
    Features.newCountdown && Features.addAt({ type: 'countdown', title: 'Πρεμιέρα', emoji: '🎬', target: new Date(Date.now() + 5 * 864e5).toISOString(), w: 260, h: 150, color: '#ff4d6d' }, 300, 300);
    Store.change(() => Store.state.subs.push({ id: uid(), name: 'Netflix', price: 13.99, currency: 'EUR', cycle: 'monthly', next: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), remindDays: 2, active: true, color: '#e50914', icon: '🎬' }));
    const r = Features.addAtCenter({ type: 'sticky', html: 'Υπενθύμιση τεστ', paper: '#8fd3ff', w: 200, h: 160, pinned: true });
    Store.change(() => { r.reminder = { on: true, at: new Date(Date.now() + 3600e3).toISOString(), repeat: 'none', sound: 'chime', msg: 'Πότισμα φυτών' }; });
    Store.save(true);
  });
  await win.waitForTimeout(400);
  // undo/redo
  const before = await win.evaluate(() => Store.items().length);
  await win.evaluate(() => { Features.addAtCenter({ type: 'emoji', char: '🧪' }); });
  await win.keyboard.press('Control+z'); await win.waitForTimeout(100);
  ok(await win.evaluate(() => Store.items().length) === before, 'undo removes added item');
  await win.keyboard.press('Control+y'); await win.waitForTimeout(100);
  ok(await win.evaluate(() => Store.items().length) === before + 1, 'redo restores it');
  // zoom
  await win.mouse.move(700, 450); for (let i = 0; i < 4; i++) await win.mouse.wheel(0, 300);
  ok(await win.evaluate(() => Canvas.view.z) < 1, 'wheel zoom-out works');
  await win.keyboard.press('Shift+!').catch(() => {}); await win.evaluate(() => Canvas.fit && Canvas.fit()); await win.waitForTimeout(500);
  // reload persistence
  await win.evaluate(() => Store.save(true)); await win.waitForTimeout(600);
  const n1 = await win.evaluate(() => Store.items().length);
  await win.reload(); await win.waitForFunction(() => window.__nyxReady === true); await win.waitForTimeout(500);
  const n2 = await win.evaluate(() => Store.items().length);
  ok(n1 === n2, `items persist across reload (${n1} → ${n2})`);
  ok(await win.evaluate(() => Store.items().some(i => (i.html || '').includes('PERSIST-CHECK'))), 'text content persisted');
  ok(await win.evaluate(() => Store.items().some(i => (i.html || '').includes('Από το τεστ'))), 'typed sticky persisted');
  ok(await win.evaluate(() => Store.state.subs.length === 1), 'subscription persisted');
  await win.evaluate(() => Canvas.fit && Canvas.fit()); await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, '02-midnight-board.png') });
  // themes
  for (const [i, th] of [['03', 'neon'], ['04', 'sunset'], ['05', 'aurora']]) {
    await win.evaluate((t) => { Store.state.settings.theme = t; Theme.apply(Store.state.settings); Store.save(); }, th); await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(SHOTS, `${i}-theme-${th}.png`) });
  }
  // drawers / picker
  await win.evaluate(() => { Store.state.settings.theme = 'cosmos'; Theme.apply(Store.state.settings); }); await win.waitForTimeout(200);
  const pick = await win.evaluate(() => { Panels.library('emoji'); return true; });
  await win.waitForTimeout(600); if (pick) await win.screenshot({ path: path.join(SHOTS, '06-picker-cosmos.png') });
  await win.keyboard.press('Escape');
  await win.evaluate(() => Panels.themes()); await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, '07-themes-drawer.png') });
  await win.keyboard.press('Escape');
  const missing = await win.evaluate(() => [...(window.__missingIcons || [])]);
  ok(missing.length === 0, 'no missing icons ' + JSON.stringify(missing));
  // widget
  await win.evaluate(() => { Store.state.settings.theme = 'midnight'; Theme.apply(Store.state.settings); Store.save(true); }); await win.waitForTimeout(400);
  await app.evaluate(() => global.__nyx.toggleWidget(true));
  const ww = await app.waitForEvent('window', { timeout: 10000 });
  ww.on('console', m => { if (m.type() === 'error') errors.push('widget: ' + m.text()); });
  ww.on('pageerror', e => errors.push('widget pageerror: ' + e.message));
  await ww.waitForLoadState(); await ww.waitForTimeout(1200);
  ok(await ww.evaluate(() => document.querySelectorAll('.w-row').length) >= 2, 'widget lists upcoming + subs');
  await ww.screenshot({ path: path.join(SHOTS, '08-widget.png') });
  await ww.fill('#w-q', 'Σημείωση από widget'); await ww.press('#w-q', 'Enter'); await win.waitForTimeout(600);
  ok(await win.evaluate(() => (Store.state.agenda || []).some(a => a.text === 'Σημείωση από widget' && a.day === ymd(Date.now()))), 'widget quick-note lands in today\'s agenda (v2.3: not a paper on the canvas)');
  const wMissing = await ww.evaluate(() => [...(window.__missingIcons || [])]);
  ok(wMissing.length === 0, 'widget icons ok ' + JSON.stringify(wMissing));
  await win.evaluate(() => Store.save(true)); await win.waitForTimeout(500);
  await quit(app);
  console.log('Run 2 — relaunch same profile');
  ({ app, win } = await launch());
  ok(await win.evaluate(() => (Store.state.agenda || []).some(a => a.text === 'Σημείωση από widget')), 'data survives full app restart');
  ok(fs.existsSync(path.join(DATA, 'data', 'nyx.json')), 'nyx.json on disk');
  await quit(app);
  const real = errors.filter(e => !/Autofill|DevTools|Electron Security Warning/.test(e));
  ok(real.length === 0, 'no console errors' + (real.length ? ':\n    ' + real.join('\n    ') : ''));
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); console.error(errors.join('\n')); process.exit(2); });
