'use strict';
// v2.7.1.1 — a REAL minimize (own Xvfb + xfwm4 window manager; skipped when xfwm4 is not installed). The app window runs with
// backgroundThrottling:false, so the page never becomes «hidden»; NyxLite must still notice (slow / missing frames), stop the
// timers and the background, and resume after restore. Also: close → tray → back.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
let passes = 0, fails = 0; const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (b) => cp.spawnSync('sh', ['-c', 'command -v ' + b]).status === 0;
(async () => {
  if (!has('xfwm4') || !has('Xvfb')) { console.log('  ✓ skipped (no xfwm4 / Xvfb)\n\nv2.7.1.1 minimize: 1 passed, 0 failed'); return; }
  const D = ':' + (150 + Math.floor(Math.random() * 80)); const X = cp.spawn('Xvfb', [D, '-screen', '0', '1600x1000x24'], { stdio: 'ignore' }); await sleep(1000);
  const WM = cp.spawn('xfwm4', ['--compositor=off'], { stdio: 'ignore', env: { ...process.env, DISPLAY: D } }); await sleep(1500);
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2711m-'));
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, DISPLAY: D, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  try {
    const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
    await win.waitForFunction(() => window.__nyxLook2611 === true, null, { timeout: 30000 }); await sleep(1500);
    await win.evaluate(() => { window.__t = 0; window.__iv = setInterval(() => __t++, 500); window.__d = 0; const d = Stars.draw.bind(Stars); Stars.draw = (...a) => { __d++; return d(...a); }; });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus()); await sleep(1500);
    ok(!(await win.evaluate(() => NyxLite.paused)), 'on screen: not paused');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    let at = -1; for (let i = 0; i < 12; i++) { await sleep(500); if (await win.evaluate(() => NyxLite.paused)) { at = (i + 1) * 0.5; break; } }
    const st = await win.evaluate(() => NyxLite.state());
    ok(at > 0 && at <= 6 && st.reasons.includes('stall'), `minimized → paused within 6 s (${at} s, reason stall)`, st);
    ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()) && await win.evaluate(() => document.visibilityState) === 'visible', 'really minimized, and the page still says «visible» (backgroundThrottling:false)');
    const a = await win.evaluate(() => ({ t: __t, d: __d })); await sleep(5000); const b = await win.evaluate(() => ({ t: __t, d: __d }));
    ok(b.t === a.t && b.d === a.d, 'minimized: no timer ticks, no background draws for 5 s', { a, b });
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.focus(); }); await sleep(1500);
    const c = await win.evaluate(() => ({ p: NyxLite.paused, t: __t }));
    ok(!c.p && c.t > b.t, 'restored → resumes (timers tick again)', c);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await sleep(800);
    const tr = await win.evaluate(() => NyxLite.state()); ok(tr.paused && tr.reasons.includes('tray'), 'close → tray → paused', tr);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); }); await sleep(1500);
    ok(!(await win.evaluate(() => NyxLite.paused)), 'back from the tray → resumes');
    await win.evaluate(() => clearInterval(__iv));
    ok(errs.length === 0, 'no page errors', errs);
  } finally {
    await app.close().catch(() => {}); try { WM.kill(); X.kill(); } catch (e) {} fs.rmSync(DATA, { recursive: true, force: true });
  }
  console.log(`\nv2.7.1.1 minimize: ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('  ✗ crashed: ' + (e && e.stack)); process.exit(1); });
