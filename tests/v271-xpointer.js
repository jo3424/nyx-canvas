'use strict';
// v2.7.1 — «Σήμερα» widget with a REAL pointer (xdotool → XTest, like a physical mouse). Weather answer mocked.
//  1) drag by the header (title and the weather line) → it moves; one undo step; v2.7.1.1: a drag on the boxes moves it too
//  2) resize by the bottom-right handle → bigger (8 boxes), then narrow (6 boxes) → nothing spills out of the card
//  3) real clicks: ⋯ → «Μέγεθος: Μικρό» → 380 wide; ⋯ → «Χρώμα: Κεχριμπάρι» → accent saved
// Needs an X server (xvfb-run -a -s "-screen 0 1600x1000x24") and xdotool.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const FX = require('./fixtures/openmeteo271');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v271x-'));
const MOCK = path.join(DATA, 'mock-openmeteo.json'); fs.writeFileSync(MOCK, JSON.stringify({ body: FX.build(Date.now()) }));
const SHOTS = process.env.NYX_SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 700) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let XDO = ''; try { XDO = cp.execFileSync('sh', ['-c', 'command -v xdotool']).toString().trim(); } catch (_) {}
if (!XDO || !process.env.DISPLAY) { console.log('v2.7.1 real-pointer: SKIPPED (needs DISPLAY + xdotool)'); process.exit(0); }
const X = (...a) => cp.execFileSync(XDO, a.map(String));
(async () => {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_TODAY271_MOCK: MOCK } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 0, y: 0, width: 1440, height: 900 }); w.focus(); });
  await win.waitForFunction(() => window.__nyxLook2611 === true && window.__nyxWidgets270 === true, null, { timeout: 30000 }); await sleep(800);
  console.log('app version ' + await win.evaluate(() => Store.info && Store.info.version) + ' · root ' + ROOT);
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  const S = (p) => [Math.round(cb.x + p.x), Math.round(cb.y + p.y)];
  const id = await win.evaluate(() => {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    Store.state.boards.push({ id: 'wx', name: 'Widgets', emoji: '🧩', color: '#7c8cff', view: { x: 0, y: 0, z: 1 }, items: [] }); Store.save(true); App.switchBoard('wx');
    const a = Widgets.add('today', 'm'); a.x = -400; a.y = -200; Items.mount(a);
    Canvas.view = { x: innerWidth / 2, y: innerHeight / 2, z: 1 }; Canvas.applyView(); Canvas.deselect && Canvas.deselect(); Store.save(true); return a.id;
  });
  await win.waitForFunction((id) => { const c = document.querySelector(`.item[data-id="${id}"] .wg-card`); return c && c.getAttribute('data-t271-state') === 'ok'; }, id, { timeout: 15000 }).catch(() => {});
  await sleep(300);
  const pt = (sel, fx = 0.5, fy = 0.5) => win.evaluate(([s, fx, fy]) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; }, [sel, fx, fy]);
  const item = () => win.evaluate((id) => { const i = Store.state.boards.find((b) => b.id === 'wx').items.find((x) => x.id === id); const n = document.querySelector(`.item[data-id="${id}"]`); const b = n.getBoundingClientRect();
    return i && { x: i.x, y: i.y, w: i.w, h: i.h, wsize: i.wsize, acc: i.waccent || '', cells: [...n.querySelectorAll('[data-t271-cell]')].filter((c) => getComputedStyle(c).display !== 'none').length,
      over: [...n.querySelectorAll('.t271-ft, .t271-strip, .wg-head')].some((e) => e.getBoundingClientRect().bottom > b.bottom + 1 || e.getBoundingClientRect().right > b.right + 1) }; }, id);
  async function xdrag(a, b) {
    const [ax, ay] = S(a), [bx, by] = S(b);
    X('mousemove', ax, ay); await sleep(150); X('mousedown', 1); await sleep(120);
    for (let i = 1; i <= 12; i++) { X('mousemove', Math.round(ax + (bx - ax) * i / 12), Math.round(ay + (by - ay) * i / 12)); await sleep(40); }
    await sleep(150); X('mouseup', 1); await sleep(500);
  }
  const xclick = async (p) => { const [x, y] = S(p); X('mousemove', x, y); await sleep(120); X('click', 1); await sleep(450); };
  const A0 = await item(); ok(A0 && A0.cells === 8, 'Σήμερα widget on the board with the weather (8 boxes)', A0);
  // 1) drag by the title, then by the weather line
  let p = await pt(`.item[data-id="${id}"] .wg-title`); await xdrag(p, { x: p.x + 180, y: p.y + 120 });
  const A1 = await item(); ok(Math.abs(A1.x - A0.x - 180) <= 12 && Math.abs(A1.y - A0.y - 120) <= 12, 'real pointer · drag by the title moves it (≈ +180, +120)', { A0, A1 });
  if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'v271x-drag.png') });
  await win.evaluate(() => document.body.focus()); await win.keyboard.press('Control+z'); await sleep(500);
  const A2 = await item(); ok(Math.abs(A2.x - A0.x) <= 1 && Math.abs(A2.y - A0.y) <= 1, 'Ctrl+Z puts it back (one undo step)', { A0, A2 });
  p = await pt(`.item[data-id="${id}"] [data-t271-cur]`, 0.3, 0.5); await xdrag(p, { x: p.x - 100, y: p.y + 50 });
  const A2b = await item(); ok(Math.abs(A2b.x - A2.x + 100) <= 12 && Math.abs(A2b.y - A2.y - 50) <= 12, 'drag by the weather line in the header also moves it', { A2, A2b });
  p = await pt(`.item[data-id="${id}"] .t271-strip`, 0.5, 0.5); await xdrag(p, { x: p.x + 120, y: p.y + 60 });
  const A3m = await item(); ok(Math.abs(A3m.x - A2b.x - 120) <= 12 && Math.abs(A3m.y - A2b.y - 60) <= 12, 'v2.7.1.1: a drag on the hourly boxes also moves it', { A2b, A3m });
  await win.evaluate(() => document.body.focus()); await win.keyboard.press('Control+z'); await sleep(500);
  const A3 = await item(); ok(Math.abs(A3.x - A2b.x) <= 1 && Math.abs(A3.y - A2b.y) <= 1, 'Ctrl+Z puts it back', { A2b, A3 });
  // 2) resize
  await xclick(await pt(`.item[data-id="${id}"] .wg-title`)); await sleep(200);
  let hp = await pt('.hdl[data-h=se]'); ok(!!hp, 'header click selects it (resize handles shown)');
  if (hp) await xdrag(hp, { x: hp.x + 120, y: hp.y + 60 });
  const A4 = await item(); ok(A4.w >= A3.w + 100 && A4.h >= A3.h + 40 && A4.cells === 8 && !A4.over, 'real pointer · resize bigger: w/h grow, 8 boxes, inside', { A3, A4 });
  if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'v271x-resize-big.png') });
  hp = await pt('.hdl[data-h=se]'); if (hp) await xdrag(hp, { x: hp.x - 260, y: hp.y - 40 });
  const A5 = await item(); ok(A5.w <= 400 && A5.cells === 6 && !A5.over, 'real pointer · resize narrow (≤ 400): 6 boxes, nothing spills out', A5);
  if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'v271x-resize-narrow.png') });
  // 3) real clicks in the ⋯ menu
  await xclick(await pt(`.item[data-id="${id}"] .wg-more`));
  ok(await win.evaluate(() => { const m = document.querySelector('#ctxmenu'); return m && m.dataset.menu === 'widget' && !m.hidden; }), 'real click on ⋯ opens the widget menu (no drag)');
  await xclick(await pt('#ctxmenu [data-wmi=sz-s]'));
  const A6 = await item(); ok(A6.wsize === 's' && A6.w === 380 && A6.h === 204 && A6.cells === 6 && !A6.over, 'real click «Μέγεθος: Μικρό» → 380×204', A6);
  await xclick(await pt(`.item[data-id="${id}"] .wg-more`)); await xclick(await pt('#ctxmenu [data-wmi=acc-amber]'));
  const A7 = await item(); const accVar = await win.evaluate((id) => getComputedStyle(document.querySelector(`.item[data-id="${id}"] .wg-card`)).getPropertyValue('--accent').trim(), id);
  ok(A7.acc === 'amber' && accVar === '#e3a33b', 'real click «Χρώμα: Κεχριμπάρι» → accent saved and shown', { A7, accVar });
  if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'v271x-amber.png') });
  const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {}
  console.log(`\nv2.7.1 real-pointer: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
