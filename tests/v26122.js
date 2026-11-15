'use strict';
// v2.6.12.2 UI (Electron, Chromium sandbox on) — dragging board tabs with a mouse (Playwright mouse.down / move / up:
// real Input.dispatchMouseEvent → pointer events; NO dispatchEvent, NO synthetic DragEvent). Only the tab dragging:
//  1) «+N ▾»: reorder inside the menu grabbing the EMOJI, the NAME and the COUNT (= the whole row); the menu stays open
//     on pointerdown, during the drag and after the drop; the drop does not switch board
//  2) menu → bar (before / after a tab), bar → «+N ▾» (to the end), bar → hold over «+N ▾» → drop on a menu row, bar → bar
//  3) «Διαχείριση πινάκων»: drag by the row and by the ⋮⋮ handle; the name field still types / renames
//  4) a press without movement = click (opens the board); × and right-click on the rows; × never starts a drag;
//     Esc cancels; drop outside = nothing; Alt+↑/↓ still works; App.deleteBoard is the only delete
//  5) small window 1024×700; screenshots taken MID-DRAG; order kept after restart; cards untouched
// The OS-level drag loop that broke 2.6.12.1 on the owner's PC is checked with a REAL X pointer in tests/v26122-xpointer.js.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v26122-'));
const SHOTS = process.env.NYX_SHOTS || path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0, passes = 0;
const T0 = Date.now(); const ok = (c, m, x) => { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(w = 1440, hh = 900) {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const x = BrowserWindow.getAllWindows()[0]; x.setSize(w, h); x.center(); }, [w, hh]);
  await win.waitForFunction(() => (window.__nyxV2Ready === true || window.__nyxV25Ready === true) && window.__nyxLook2611 === true, null, { timeout: 30000 });
  await win.waitForTimeout(500);
  return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (_) {} }
const setSize = async (app, w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]); await sleep(600); };
const shot = (win, name) => win.screenshot({ path: path.join(SHOTS, name) }).then(() => path.join(SHOTS, name)).catch(() => '');
const ids = (win) => win.evaluate(() => Store.state.boards.map((b) => b.id));
const hid = (win) => win.evaluate(() => (TabStrip._hidden || []).map((b) => b.id));
const firstHidden = (win) => win.evaluate(() => { const h = TabStrip._hidden || []; return h.length ? Store.state.boards.indexOf(h[0]) : Store.state.boards.length; });
const plan = (win, id, target) => win.evaluate(([id, t]) => NyxUI.dropPlan(Store.state.boards.map((b) => b.id), id, t), [id, target]);
const box = (win, sel) => win.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; }, sel);
const row = (id) => `#ctxmenu .tm-row[data-board="${id}"]`;
const tab = (id) => `#tabs .tab[data-board="${id}"]`;
const menuOpen = (win) => win.evaluate(() => { const m = document.querySelector('#ctxmenu'); return !m.hidden && m.dataset.menu === 'tabs-more'; });
const openMenu = async (win) => { await win.evaluate(() => Panels.closeMenu()); await sleep(80); await win.click('#tabs-more'); await sleep(250); };
const midState = (win) => win.evaluate(() => ({ menu: (() => { const m = document.querySelector('#ctxmenu'); return !m.hidden && m.dataset.menu === 'tabs-more'; })(), ghost: !!document.querySelector('.tab-ghost'), dragging: !!document.querySelector('.dragging'),
  body: document.body.classList.contains('tab-dragging'), ind: [...document.querySelectorAll('.drop-before,.drop-after,#tabs-more.dragover')].map((x) => (x.dataset.board || x.id) + ':' + (x.classList.contains('drop-after') ? 'after' : x.classList.contains('drop-before') ? 'before' : 'over')) }));
// mouse drag: press at `from`, move in steps to `to` (optionally through `via` with a pause), mid() runs before release
async function drag(win, from, to, o = {}) {
  await win.mouse.move(from.x, from.y); await win.mouse.down(); await sleep(60);
  if (o.atDown) await o.atDown();
  await win.mouse.move(from.x + 8, from.y + 3, { steps: 4 }); await sleep(60);
  if (o.atStart) await o.atStart();
  if (o.via) { await win.mouse.move(o.via.x, o.via.y, { steps: 10 }); await sleep(o.hold || 0); if (o.then) to = await o.then(); }
  await win.mouse.move(to.x, to.y, { steps: 12 }); await sleep(120);
  let mid = null; if (o.mid) mid = await o.mid();
  if (o.key) { await win.keyboard.press(o.key); await sleep(100); }
  await win.mouse.up(); await sleep(350);
  return mid;
}

(async () => {
  let { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(String(ver) === '2.6.12.2', 'app version 2.6.12.2', ver);
  ok(await win.evaluate(() => window.__nyxTabDrag26122 === true && typeof TabDrag === 'object' && typeof NyxUI.dropPlan === 'function'), 'tabdrag26122 loaded (pointer events)');
  await win.evaluate(() => document.querySelectorAll('#toasts > *, .toast').forEach((t) => t.remove()));
  await win.evaluate(() => { window.__del = []; const o = App.deleteBoard; App.deleteBoard = function (b) { window.__del.push(b.id); return o.call(this, b); }; });
  // fill: the bar + 6 in «+N ▾»; 2 boards with cards
  await win.evaluate(() => {
    const B = Store.state.boards; const EM = ['🧠', '🎮', '🛒', '📚', '🎵', '🌿', '🚀', '🎨'];
    let i = 0; while (i < 60) { B.push({ id: 'f' + i, name: 'Πίνακας ' + (B.length + 1), emoji: EM[i % EM.length], color: '#7c8cff', view: null, items: [] }); Panels.tabs(); i++; if ((TabStrip._hidden || []).length >= 6) break; }
    const mk = (b, n) => { for (let k = 0; k < n; k++) b.items.push({ id: 'it' + b.id + k, type: 'sticky', x: k * 220, y: 0, w: 200, h: 140, html: 'κάρτα ' + k, paper: '#fff6a9', z: k + 1, created: Date.now() }); };
    mk(B[1], 2); mk(B.at(-1), 3); App.switchBoard(B[0].id); Store.save(true); Panels.tabs();
  });
  const cards0 = await win.evaluate(() => Store.state.boards.map((b) => b.id + ':' + b.items.length).sort().join());
  const active0 = await win.evaluate(() => Store.state.active);
  ok((await hid(win)).length >= 6, '«+N ▾» holds ≥ 6 boards', (await hid(win)).length);
  ok(await win.evaluate(() => [...document.querySelectorAll('#tabs .tab')].every((t) => t.getAttribute('draggable') === 'false')), 'bar tabs: no native drag (draggable=false)');

  // ---- 1) inside the menu, grabbing emoji / name / count ----
  await openMenu(win); let h = await hid(win); let fh = await firstHidden(win);
  ok(await win.evaluate(() => [...document.querySelectorAll('#ctxmenu .tm-row')].every((r) => r.dataset.drag === 'menu' && r.getAttribute('draggable') === 'false')), 'every «+N ▾» row is a pointer-drag handle (whole row)');
  let src = await box(win, row(h.at(-1)) + ' .mi-emo'), dst = await box(win, row(h[0]));
  let exp = await plan(win, h.at(-1), { kind: 'menu', board: h[0], where: 'before', firstHidden: fh });
  let downOpen = null, startOpen = null;
  let mid = await drag(win, src, { x: dst.x, y: dst.top + 4 }, { atDown: async () => { downOpen = await menuOpen(win); }, atStart: async () => { startOpen = await menuOpen(win); }, mid: async () => { const s = await midState(win); await shot(win, 'v26122-normal-01-menu-reorder-MIDDRAG.png'); return s; } });
  ok(downOpen === true && startOpen === true, 'the menu stays open on pointerdown and at drag start', { downOpen, startOpen });
  ok(mid.menu && mid.ghost && mid.dragging && mid.body && mid.ind.includes(h[0] + ':before'), 'mid-drag: menu open, floating copy, source dimmed, «before» line on the target row', mid);
  ok((await ids(win)).join() === exp.join(), 'grab by the EMOJI: last menu row → above the first', { got: await ids(win), exp });
  ok(await menuOpen(win), 'after the drop the menu is open again with the new order');
  ok(await win.evaluate((id) => document.querySelector('#ctxmenu .tm-row')?.dataset.board === id, h.at(-1)), 'the moved board is the first menu row');
  ok(await win.evaluate((a) => Store.state.active === a, active0), 'the drop did not switch board');
  ok(await win.evaluate(() => !document.querySelector('.tab-ghost') && !document.querySelector('.dragging') && !document.body.classList.contains('tab-dragging')), 'nothing left behind after the drop');
  h = await hid(win); fh = await firstHidden(win);
  src = await box(win, row(h[0]) + ' .mi-name'); dst = await box(win, row(h.at(-1)));
  exp = await plan(win, h[0], { kind: 'menu', board: h.at(-1), where: 'after', firstHidden: fh });
  await drag(win, src, { x: dst.x, y: dst.bottom - 3 });
  ok((await ids(win)).join() === exp.join(), 'grab by the NAME: first menu row → after the last', { got: await ids(win), exp });
  h = await hid(win); fh = await firstHidden(win);
  src = await box(win, row(h[2]) + ' kbd'); dst = await box(win, row(h[0]));
  exp = await plan(win, h[2], { kind: 'menu', board: h[0], where: 'before', firstHidden: fh });
  await drag(win, src, { x: dst.x, y: dst.top + 3 });
  ok((await ids(win)).join() === exp.join(), 'grab by the COUNT: 3rd row → first', { got: await ids(win), exp });

  // ---- 2) menu → bar ----
  await openMenu(win); h = await hid(win); let I = await ids(win);
  src = await box(win, row(h[1]) + ' .mi-name'); dst = await box(win, tab(I[1]));
  exp = await plan(win, h[1], { kind: 'bar', board: I[1], where: 'before' });
  mid = await drag(win, src, { x: dst.left + 6, y: dst.y }, { mid: async () => { const s = await midState(win); await shot(win, 'v26122-normal-02-menu-to-bar-MIDDRAG.png'); return s; } });
  ok(mid.ghost && mid.ind.includes(I[1] + ':before'), 'mid-drag over the bar: «before» mark on the tab', mid);
  ok((await ids(win)).join() === exp.join() && (await ids(win))[1] === h[1], 'menu → bar: the board is now the 2nd tab', { got: (await ids(win)).slice(0, 4), exp: exp.slice(0, 4) });
  ok(await win.evaluate((id) => { const t = document.querySelector(`#tabs .tab[data-board="${id}"]`); return t && !t.hidden; }, h[1]), 'menu → bar: it is visible in the bar');
  ok(!(await menuOpen(win)), 'menu → bar: the menu closes after the drop');
  await openMenu(win); h = await hid(win); I = await ids(win);
  src = await box(win, row(h[0]) + ' .mi-emo'); dst = await box(win, tab(I[0]));
  exp = await plan(win, h[0], { kind: 'bar', board: I[0], where: 'after' });
  await drag(win, src, { x: dst.right - 6, y: dst.y });
  ok((await ids(win)).join() === exp.join() && (await ids(win))[1] === h[0], 'menu → bar: after the first tab', { got: (await ids(win)).slice(0, 4) });

  // ---- bar → «+N ▾» (end), bar → hold «+N ▾» → menu row, bar → bar ----
  await win.evaluate(() => Panels.closeMenu()); I = await ids(win);
  src = await box(win, tab(I[2]) + ' .tab-name'); dst = await box(win, '#tabs-more');
  mid = await drag(win, src, dst, { mid: async () => midState(win) });
  ok(mid.ind.includes('tabs-more:over'), 'bar → «+N ▾»: the button lights up', mid);
  ok((await ids(win)).at(-1) === I[2], 'bar → «+N ▾»: to the end (now in the menu)', (await ids(win)).slice(-3));
  await win.evaluate(() => Panels.closeMenu()); I = await ids(win); h = await hid(win);
  src = await box(win, tab(I[3]) + ' .tab-name'); dst = await box(win, '#tabs-more');
  let target = h[2];
  mid = await drag(win, src, null, { via: dst, hold: 750, then: async () => { const b = await box(win, row(target)); return b ? { x: b.x, y: b.top + 4 } : dst; },
    mid: async () => { const s = await midState(win); await shot(win, 'v26122-normal-03-bar-to-menu-MIDDRAG.png'); return s; } });
  ok(mid.menu && mid.ind.includes(target + ':before'), 'bar → hold «+N ▾» 450 ms → the menu opens; mark on the row', mid);
  const now = await ids(win); const hNow = await hid(win);
  ok(hNow.includes(I[3]) && now.indexOf(I[3]) === now.indexOf(target) - 1, 'bar → menu row: lands IN the menu, before that row', { now, hNow, moved: I[3], target });
  await win.evaluate(() => Panels.closeMenu()); I = await ids(win);
  src = await box(win, tab(I[0]) + ' .tab-name'); dst = await box(win, tab(I[2]));
  exp = await plan(win, I[0], { kind: 'bar', board: I[2], where: 'after' });
  await drag(win, src, { x: dst.right - 5, y: dst.y });
  ok((await ids(win)).join() === exp.join(), 'bar → bar: first tab after the third', (await ids(win)).slice(0, 4));

  // ---- 3) «Διαχείριση πινάκων» ----
  await openMenu(win); await win.click('#ctxmenu .tm-manage'); await sleep(450);
  I = await ids(win);
  ok(await win.evaluate(() => [...document.querySelectorAll('#drawer-body .bm-row')].every((r) => r.dataset.drag === 'manage' && !r.querySelector('[draggable=true]'))), 'manage rows: pointer-drag (no native drag)');
  src = await box(win, `#drawer-body .bm-row[data-board="${I[0]}"] .bm-grip`); dst = await box(win, `#drawer-body .bm-row[data-board="${I[2]}"]`);
  exp = await plan(win, I[0], { kind: 'manage', board: I[2], where: 'after' });
  mid = await drag(win, src, { x: dst.x, y: dst.bottom - 4 }, { mid: async () => { const s = await midState(win); await shot(win, 'v26122-normal-04-manage-MIDDRAG.png'); return s; } });
  ok(mid.ghost && mid.ind.includes(I[2] + ':after'), 'manage mid-drag: floating row + «after» line', mid);
  ok((await ids(win)).join() === exp.join(), 'manage: drag by ⋮⋮ (1st → after 3rd)', (await ids(win)).slice(0, 4));
  I = await ids(win);
  src = await box(win, `#drawer-body .bm-row[data-board="${I[4]}"] .bm-count`); dst = await box(win, `#drawer-body .bm-row[data-board="${I[1]}"]`);
  exp = await plan(win, I[4], { kind: 'manage', board: I[1], where: 'before' });
  await drag(win, src, { x: dst.x, y: dst.top + 4 });
  ok((await ids(win)).join() === exp.join(), 'manage: drag by the row itself (5th → before 2nd)', (await ids(win)).slice(0, 6));
  I = await ids(win);
  const nm = await box(win, `#drawer-body .bm-row[data-board="${I[3]}"] .bm-name`);
  await win.mouse.move(nm.left + 10, nm.y); await win.mouse.down(); await win.mouse.move(nm.left + 60, nm.y, { steps: 6 }); await win.mouse.up(); await sleep(200);
  ok((await ids(win)).join() === I.join() && !(await win.evaluate(() => !!document.querySelector('.tab-ghost'))), 'manage: pressing in the name field selects text, never drags');
  await win.click(`#drawer-body .bm-row[data-board="${I[3]}"] .bm-name`, { clickCount: 3 }); await win.keyboard.type('Μετονομάστηκε'); await win.keyboard.press('Enter'); await sleep(200);
  ok(await win.evaluate((id) => Store.state.boards.find((b) => b.id === id).name === 'Μετονομάστηκε', I[3]), 'manage: rename still works');
  await win.evaluate(() => Panels.closeDrawer()); await sleep(300);

  // ---- 4) click / × / right-click / Esc / outside / keys ----
  await openMenu(win); h = await hid(win);
  const c = await box(win, row(h[1]) + ' .mi-name');
  await win.mouse.move(c.x, c.y); await win.mouse.down(); await win.mouse.move(c.x + 2, c.y + 1); await win.mouse.up(); await sleep(400);
  ok(await win.evaluate((id) => Store.state.active === id, h[1]), 'a press that moves < 5 px is a click: opens that board');
  ok(!(await menuOpen(win)), 'click on a row closes the menu (as before)');
  await win.evaluate((a) => App.switchBoard(a), active0); await sleep(200);
  await openMenu(win); h = await hid(win);
  const empty = await win.evaluate((h) => h.find((id) => Store.state.boards.find((b) => b.id === id).items.length === 0), h);
  const xb = await box(win, row(empty) + ' .tm-x'); await win.evaluate(() => { window.__del.length = 0; });
  await win.mouse.move(xb.x, xb.y); await win.mouse.down(); await win.mouse.move(xb.x - 30, xb.y + 2, { steps: 5 });
  const xs = await midState(win); await win.mouse.up(); await sleep(300);
  ok(!xs.ghost && (await ids(win)).includes(empty), 'pressing × and moving never starts a drag');
  await win.click(row(empty) + ' .tm-x').catch(() => {}); await sleep(350);
  ok(await win.evaluate((id) => window.__del.includes(id) && !Store.state.boards.some((b) => b.id === id), empty), '× on a row: App.deleteBoard, the empty board is gone');
  ok(await menuOpen(win), 'after × the menu is shown again');
  h = await hid(win); await win.click(row(h[0]) + ' .mi-name', { button: 'right' }); await sleep(250);
  const labs = await win.evaluate(() => [...document.querySelectorAll('#ctxmenu .mi')].map((x) => x.textContent.trim()));
  ok(labs.join('|') === 'Μετονομασία|Διπλότυπο|Διαγραφή' || (labs.includes('Μετονομασία') && labs.includes('Διαγραφή')), 'right-click on a row: the tab menu', labs);
  await win.keyboard.press('Escape'); await win.evaluate(() => Panels.closeMenu());
  await openMenu(win); h = await hid(win); I = await ids(win);
  src = await box(win, row(h.at(-1)) + ' .mi-name'); dst = await box(win, row(h[0]));
  mid = await drag(win, src, { x: dst.x, y: dst.top + 3 }, { mid: () => midState(win), key: 'Escape' });
  ok(mid.ghost && (await ids(win)).join() === I.join() && !(await win.evaluate(() => !!document.querySelector('.tab-ghost'))), 'Esc during the drag cancels (order unchanged, nothing left)');
  await openMenu(win); h = await hid(win); I = await ids(win);
  src = await box(win, row(h[1]) + ' .mi-name');
  const canvas = await win.evaluate(() => ({ x: innerWidth / 2, y: innerHeight - 120 }));
  await drag(win, src, canvas);
  ok((await ids(win)).join() === I.join(), 'drop on the canvas (no target): nothing changes');
  ok(await menuOpen(win), '… and the menu is still open');
  await openMenu(win); h = await hid(win); I = await ids(win);
  await win.focus(row(h[0]) + ' .mi'); await win.keyboard.press('Alt+ArrowDown'); await sleep(250);
  ok((await ids(win)).join() === (await win.evaluate(([I, id]) => NyxUI.boardStep(I, id, 1), [I, h[0]])).join(), 'Alt+↓ in the menu still moves the board');
  await win.evaluate(() => Panels.closeMenu());

  // ---- 5) small window ----
  await setSize(app, 1024, 700); await win.evaluate(() => Panels.tabs()); await sleep(300);
  await openMenu(win); h = await hid(win); fh = await firstHidden(win);
  src = await box(win, row(h.at(-1)) + ' .mi-emo'); dst = await box(win, row(h[0]));
  exp = await plan(win, h.at(-1), { kind: 'menu', board: h[0], where: 'before', firstHidden: fh });
  mid = await drag(win, src, { x: dst.x, y: dst.top + 4 }, { mid: async () => { const s = await midState(win); await shot(win, 'v26122-small-01-menu-reorder-MIDDRAG.png'); return s; } });
  ok(mid.ghost && mid.menu && (await ids(win)).join() === exp.join(), '1024×700: reorder inside the menu', mid);
  await openMenu(win); h = await hid(win); I = await ids(win);
  src = await box(win, row(h[0]) + ' .mi-name'); dst = await box(win, tab(I[1]));
  mid = await drag(win, src, { x: dst.left + 6, y: dst.y }, { mid: async () => { const s = await midState(win); await shot(win, 'v26122-small-02-menu-to-bar-MIDDRAG.png'); return s; } });
  ok((await ids(win))[1] === h[0], '1024×700: menu → bar', (await ids(win)).slice(0, 3));
  await win.evaluate(() => Panels.closeMenu()); I = await ids(win);
  src = await box(win, tab(I[1]) + ' .tab-name'); dst = await box(win, '#tabs-more'); target = (await hid(win))[1];
  mid = await drag(win, src, null, { via: dst, hold: 750, then: async () => { const b = await box(win, row(target)); return b ? { x: b.x, y: b.top + 4 } : dst; }, mid: async () => { const s = await midState(win); await shot(win, 'v26122-small-03-bar-to-menu-MIDDRAG.png'); return s; } });
  ok((await hid(win)).includes(I[1]), '1024×700: bar → menu row', mid);
  await setSize(app, 1440, 900);

  // ---- cards untouched, order kept after restart ----
  ok((await win.evaluate(() => Store.state.boards.map((b) => b.id + ':' + b.items.length).sort().join())) === cards0.replace(new RegExp('(^|,)' + empty + ':0'), ''), 'no card moved, lost or added by dragging');
  const order = (await ids(win)).join();
  await win.evaluate(() => Store.save(true)); await sleep(300); await quit(app);
  ({ app, win } = await launch()); await sleep(400);
  ok((await ids(win)).join() === order, 'after restart: the same order');
  await quit(app);
  console.log(`\nv2.6.12.2 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
