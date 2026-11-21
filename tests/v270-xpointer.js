'use strict';
// v2.7.0 — widgets with a REAL pointer (xdotool → XTest, like a physical mouse; Chromium's normal input path):
//  1) drag a widget by its header → it moves (x,y change by the drag, one undo step), content clicks do NOT move it
//  2) resize by the bottom-right handle → w/h grow
//  3) ⋯ → «Καρφίτσωμα στο παράθυρο Widget» with real clicks → it.pinned; ⋯ → «Μέγεθος: Μικρό» → 240 wide
//  4) calendar › with a real click changes the month (the click is not swallowed by the card's drag)
// Needs an X server (xvfb-run -a -s "-screen 0 1600x1000x24") and xdotool.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v270x-'));
const SHOTS = process.env.NYX_SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 700) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let XDO = ''; try { XDO = cp.execFileSync('sh', ['-c', 'command -v xdotool']).toString().trim(); } catch (_) {}
if (!XDO || !process.env.DISPLAY) { console.log('v2.7.0 real-pointer: SKIPPED (needs DISPLAY + xdotool)'); process.exit(0); }
const X = (...a) => cp.execFileSync(XDO, a.map(String));
(async () => {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 0, y: 0, width: 1440, height: 900 }); w.focus(); });
  await win.waitForFunction(() => window.__nyxLook2611 === true && window.__nyxWidgets270 === true, null, { timeout: 30000 }); await sleep(800);
  console.log('app version ' + await win.evaluate(() => Store.info && Store.info.version) + ' · root ' + ROOT);
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  const S = (p) => [Math.round(cb.x + p.x), Math.round(cb.y + p.y)];
  const ids = await win.evaluate(() => {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    Store.state.boards.push({ id: 'wx', name: 'Widgets', emoji: '🧩', color: '#7c8cff', view: { x: 0, y: 0, z: 1 }, items: [] }); Store.save(true); App.switchBoard('wx');
    const a = Widgets.add('today', 'm'); a.x = -400; a.y = -200; const c = Widgets.add('calendar', 'm'); c.x = 300; c.y = -200; /* 2.7.1: Σήμερα is wider (480) */ Items.mount(a); Items.mount(c);
    Canvas.view = { x: innerWidth / 2, y: innerHeight / 2, z: 1 }; Canvas.applyView(); Canvas.deselect && Canvas.deselect(); Store.save(true); return { a: a.id, c: c.id };
  });
  await sleep(500);
  const pt = (sel, fx = 0.5, fy = 0.5) => win.evaluate(([s, fx, fy]) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; }, [sel, fx, fy]);
  const item = (id) => win.evaluate((id) => { const i = Store.state.boards.find((b) => b.id === 'wx').items.find((x) => x.id === id); return i && { x: i.x, y: i.y, w: i.w, h: i.h, wsize: i.wsize, pinned: !!i.pinned }; }, id);
  async function xdrag(a, b) {
    const [ax, ay] = S(a), [bx, by] = S(b);
    X('mousemove', ax, ay); await sleep(150); X('mousedown', 1); await sleep(120);
    for (let i = 1; i <= 12; i++) { X('mousemove', Math.round(ax + (bx - ax) * i / 12), Math.round(ay + (by - ay) * i / 12)); await sleep(40); }
    await sleep(150); X('mouseup', 1); await sleep(500);
  }
  const xclick = async (p) => { const [x, y] = S(p); X('mousemove', x, y); await sleep(120); X('click', 1); await sleep(450); };
  // 1) drag by the header
  const A0 = await item(ids.a);
  const hist0 = await win.evaluate(() => (typeof NyxUndo !== 'undefined' && Store.undoStack ? Store.undoStack.length : (Store.hist || []).length));
  await xdrag(await pt(`.item[data-id="${ids.a}"] .wg-title`, 0.5, 0.5), { x: (await pt(`.item[data-id="${ids.a}"] .wg-title`)).x + 180, y: (await pt(`.item[data-id="${ids.a}"] .wg-title`)).y + 120 });
  const A1 = await item(ids.a);
  ok(Math.abs(A1.x - A0.x - 180) <= 12 && Math.abs(A1.y - A0.y - 120) <= 12, 'real pointer · drag by the header moves the widget (≈ +180, +120)', { A0, A1 });
  if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'v270x-drag.png') });
  await win.evaluate(() => document.body.focus()); await win.keyboard.press('Control+z'); await sleep(500);
  const A2 = await item(ids.a); ok(Math.abs(A2.x - A0.x) <= 1 && Math.abs(A2.y - A0.y) <= 1, 'Ctrl+Z puts it back (one undo step)', { A0, A2 });
  // v2.7.1.1: a drag that starts inside the content (a row / the body) moves the card too (it did not before 2.7.1.1)
  await xdrag(await pt(`.item[data-id="${ids.a}"] .wg-body`, 0.5, 0.4), { x: (await pt(`.item[data-id="${ids.a}"] .wg-body`, 0.5, 0.4)).x + 120, y: (await pt(`.item[data-id="${ids.a}"] .wg-body`, 0.5, 0.4)).y + 60 });
  const A3m = await item(ids.a); ok(Math.abs(A3m.x - A2.x - 120) <= 12 && Math.abs(A3m.y - A2.y - 60) <= 12, 'v2.7.1.1: a drag inside the content moves it too', { A2, A3m });
  await win.evaluate(() => document.body.focus()); await win.keyboard.press('Control+z'); await sleep(500);
  const A3 = await item(ids.a); ok(Math.abs(A3.x - A2.x) <= 1 && Math.abs(A3.y - A2.y) <= 1, 'Ctrl+Z puts it back', { A2, A3 });
  // 2) resize: select with a header click, then pull the se handle
  await xclick(await pt(`.item[data-id="${ids.a}"] .wg-title`)); await sleep(200);
  const hp = await pt('.hdl[data-h=se]');
  ok(!!hp, 'header click selects the widget (resize handles shown)');
  if (hp) await xdrag(hp, { x: hp.x + 100, y: hp.y + 80 });
  const A4 = await item(ids.a);
  ok(A4.w >= A3.w + 80 && A4.h >= A3.h + 60, 'real pointer · resize by the corner handle (w/h grow)', { A3, A4 });
  if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'v270x-resize.png') });
  // 3) ⋯ menu with real clicks
  await xclick(await pt(`.item[data-id="${ids.a}"] .wg-more`));
  const menuOpen = await win.evaluate(() => document.querySelector('#ctxmenu') && document.querySelector('#ctxmenu').dataset.menu === 'widget' && !document.querySelector('#ctxmenu').hidden);
  ok(menuOpen, 'real click on ⋯ opens the widget menu (and does not start a drag)');
  if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'v270x-menu.png') });
  await xclick(await pt('#ctxmenu [data-wmi=pin]'));
  ok((await item(ids.a)).pinned === true, 'real click «Καρφίτσωμα στο παράθυρο Widget» → pinned');
  await xclick(await pt(`.item[data-id="${ids.a}"] .wg-more`)); await xclick(await pt('#ctxmenu [data-wmi=sz-s]'));
  const A5 = await item(ids.a); const S5 = await win.evaluate(() => NyxWidgetData.sizeFor('today', 's').w); /* 2.7.0: 240 · 2.7.1: 380 */ ok(A5.wsize === 's' && A5.w === S5, 'real click «Μέγεθος: Μικρό» → ' + S5 + ' wide', A5);
  // 4) calendar › real click
  const mon = () => win.evaluate((id) => (document.querySelector(`.item[data-id="${id}"] .wg-cal-head b`) || {}).textContent, ids.c);
  const C0 = await item(ids.c); const m0 = await mon();
  await xclick(await pt(`.item[data-id="${ids.c}"] [data-act=w-next]`));
  const m1 = await mon(); const C1 = await item(ids.c);
  ok(m1 && m1 !== m0 && C1.x === C0.x && C1.y === C0.y, 'real click on › changes the month, the card stays put', { m0, m1 });
  const app2 = app; const done = new Promise((r) => app2.process().once('exit', r)); await app2.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app2.process().kill(); } catch (e) {}
  console.log(`\nv2.7.0 real-pointer: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
