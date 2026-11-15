'use strict';
// v2.6.12.2 — the same drags with a REAL pointer: xdotool moves the X server's pointer (XTest), exactly like a physical
// mouse, so Chromium runs its normal input path and — for HTML5 drag & drop — the operating system's drag loop (XDND).
// Playwright's mouse cannot show that: it drives Chromium's own drag emulation (CDP Input.dispatchDragEvent), which is
// why the 2.6.12.1 tests passed while the owner's real mouse failed. Version-agnostic: run it against 2.6.12.1
// (NYX_ROOT=<2.6.12.1 tree>) to see it fail, against 2.6.12.2 to see it pass.
// Needs: an X server (xvfb-run -a -s "-screen 0 1600x1000x24") and xdotool. Cases:
//  1) «+N ▾»: last row → above the first (grab the name)   2) menu → bar (before the 2nd tab)
//  3) bar → «+N ▾» (to the end)                              4) «Διαχείριση πινάκων»: 1st row → after the 3rd (by ⋮⋮)
//  5) × on a «+N ▾» row deletes (App.deleteBoard)            6) right-click on a «+N ▾» row = the tab menu
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v26122x-'));
const SHOTS = process.env.NYX_SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 700) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let XDO = ''; try { XDO = cp.execFileSync('sh', ['-c', 'command -v xdotool']).toString().trim(); } catch (_) {}
if (!XDO || !process.env.DISPLAY) { console.log('v2.6.12.2 real-pointer: SKIPPED (needs DISPLAY + xdotool)'); process.exit(0); }
const X = (...a) => cp.execFileSync(XDO, a.map(String));
(async () => {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 0, y: 0, width: 1440, height: 900 }); w.focus(); });
  await win.waitForFunction(() => window.__nyxLook2611 === true, null, { timeout: 30000 }); await win.waitForTimeout(800);
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  console.log('app version ' + ver + ' · root ' + ROOT);
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  const S = (p) => [Math.round(cb.x + p.x), Math.round(cb.y + p.y)];
  await win.evaluate(() => {
    document.querySelectorAll('#toasts > *, .toast').forEach((t) => t.remove());
    window.__del = []; const o = App.deleteBoard; App.deleteBoard = function (b) { window.__del.push(b.id); return o.call(this, b); };
    const B = Store.state.boards; for (let i = 0; i < 10; i++) B.push({ id: 'f' + i, name: 'Πίνακας ' + i, emoji: '📁', color: '#7c8cff', view: null, items: [] });
    Store.save(true); Panels.tabs();
    window.__ev = []; for (const t of ['pointerdown', 'dragstart', 'drop', 'dragend', 'pointerup']) addEventListener(t, (e) => __ev.push(t), true);
  });
  const ids = () => win.evaluate(() => Store.state.boards.map((b) => b.id));
  const hid = () => win.evaluate(() => (TabStrip._hidden || []).map((b) => b.id));
  const fH = () => win.evaluate(() => { const h = TabStrip._hidden || []; return h.length ? Store.state.boards.indexOf(h[0]) : Store.state.boards.length; });
  const pt = (sel, fx = 0.5, fy = 0.5) => win.evaluate(([s, fx, fy]) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; }, [sel, fx, fy]);
  const ev = () => win.evaluate(() => __ev.splice(0).filter((x, i, a) => x !== a[i - 1]).join('>'));
  // the 2.6.12.1 helpers (present in both versions) give the expected order
  const mv = (I, id, t, w) => win.evaluate(([I, id, t, w]) => NyxUI.boardMove(I, id, t, w), [I, id, t, w]);
  const md = (I, id, t, w, fh) => win.evaluate(([I, id, t, w, fh]) => NyxUI.menuDrop(I, id, t, w, fh), [I, id, t, w, fh]);
  async function xdrag(a, b, shot) {
    const [ax, ay] = S(a), [bx, by] = S(b);
    X('mousemove', ax, ay); await sleep(150); X('mousedown', 1); await sleep(150);
    for (let i = 1; i <= 14; i++) { X('mousemove', Math.round(ax + (bx - ax) * i / 14), Math.round(ay + (by - ay) * i / 14)); await sleep(45); }
    await sleep(250); if (shot && SHOTS) await win.screenshot({ path: path.join(SHOTS, shot) });
    X('mouseup', 1); await sleep(600);
  }
  const xclick = async (p, btn = 1) => { const [x, y] = S(p); X('mousemove', x, y); await sleep(100); X('click', btn); await sleep(450); };
  const open = async () => { await win.evaluate(() => Panels.closeMenu()); await sleep(100); await xclick(await pt('#tabs-more')); };
  const row = (id) => `#ctxmenu .tm-row[data-board="${id}"]`;
  // 1) inside the menu
  await open(); let h = await hid(); let I = await ids(); let fh = await fH(); await ev();
  let exp = await md(I, h.at(-1), h[0], 'before', fh);
  await xdrag(await pt(row(h.at(-1)) + ' .mi-name', 0.3), await pt(row(h[0]), 0.4, 0.15), 'x-01-menu-reorder.png');
  ok((await ids()).join() === exp.join(), 'real pointer · «+N ▾»: last row → above the first', { events: await ev() });
  // 2) menu → bar
  await open(); h = await hid(); I = await ids(); await ev();
  exp = await mv(I, h[0], I[1], 'before');
  await xdrag(await pt(row(h[0]) + ' .mi-name', 0.3), await pt(`#tabs .tab[data-board="${I[1]}"]`, 0.15), 'x-02-menu-to-bar.png');
  const g2 = await ids();
  ok(g2.join() === exp.join() && g2[1] === h[0], 'real pointer · menu → bar: the board becomes the 2nd tab', { events: await ev(), first3: g2.slice(0, 3), want: h[0] });
  // 3) bar → «+N ▾»
  await win.evaluate(() => Panels.closeMenu()); I = await ids(); await ev();
  await xdrag(await pt(`#tabs .tab[data-board="${I[2]}"] .tab-name`), await pt('#tabs-more'), 'x-03-bar-to-more.png');
  ok((await ids()).at(-1) === I[2], 'real pointer · bar → «+N ▾»: to the end', { events: await ev() });
  // 4) manage
  await open(); await xclick(await pt('#ctxmenu .tm-manage')); await sleep(300); I = await ids(); await ev();
  exp = await mv(I, I[0], I[2], 'after');
  await xdrag(await pt(`#drawer-body .bm-row[data-board="${I[0]}"] .bm-grip`), await pt(`#drawer-body .bm-row[data-board="${I[2]}"]`, 0.5, 0.85), 'x-04-manage.png');
  ok((await ids()).join() === exp.join(), 'real pointer · «Διαχείριση πινάκων»: 1st → after the 3rd (⋮⋮)', { events: await ev() });
  await win.evaluate(() => Panels.closeDrawer()); await sleep(300);
  // 5) × and 6) right-click
  await open(); h = await hid(); const gone = h[0];
  await xclick(await pt(row(gone) + ' .tm-x'));
  ok(await win.evaluate((id) => window.__del.includes(id) && !Store.state.boards.some((b) => b.id === id), gone), 'real pointer · × on a «+N ▾» row deletes (App.deleteBoard)');
  await open(); h = await hid(); await xclick(await pt(row(h[0]) + ' .mi-name'), 3);
  const labs = await win.evaluate(() => [...document.querySelectorAll('#ctxmenu .mi')].map((x) => x.textContent.trim()));
  ok(labs.includes('Μετονομασία') && labs.includes('Διπλότυπο') && labs.includes('Διαγραφή'), 'real pointer · right-click on a «+N ▾» row = the tab menu', labs);
  await app.close().catch(() => {});
  console.log(`\nv2.6.12.2 real-pointer (${ver}): ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
