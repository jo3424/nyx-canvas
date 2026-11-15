'use strict';
// v2.6.12.1 UI (Electron, Chromium sandbox on) — only the board tabs in «+N ▾»:
//  1) fill the bar, 3 new tabs (real «+» clicks) → the 3 are in «+N ▾», the first tabs stay (rule kept)
//  2) every menu row has × ; right-click a row = the SAME menu as the bar tab (same labels, swatches, order)
//  3) × / right-click «Διαγραφή» / Delete call App.deleteBoard (the bar's own function — spied): empty board goes at once;
//     a board with items asks «Διαγραφή πίνακα με N στοιχεία;», its cards go to the Bin, «Αναίρεση» brings it back
//  4) real mouse drags: inside the menu, menu → bar, bar → «+N ▾» (end), bar → hover «+N ▾» → drop on a row
//  5) «Διαχείριση πινάκων»: all boards, rename, reorder (drag + Alt+↑/↓), ⋯ = the tab menu, delete with the same confirm
//  6) keyboard in the menu (↑/↓, F2, Shift+F10, Alt+↑/↓, Delete), small window 1024×700, screenshots
//  7) regressions: Ctrl+Z/Y, Bin, subscriptions, MCP, settings, ctx 32768 / --models-max 1, order kept after restart
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v26121-'));
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
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const setSize = async (app, w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]); await sleep(600); };
const shot = (win, name) => win.screenshot({ path: path.join(SHOTS, name) }).then(() => path.join(SHOTS, name)).catch(() => '');
const vis = (win) => win.evaluate(() => {
  const ids = Store.state.boards.map((b) => b.id); const T = document.querySelector('#tabs'); const more = document.querySelector('#tabs-more');
  const v = [...T.querySelectorAll('.tab')].filter((x) => !x.hidden);
  return { vis: v.map((x) => ids.indexOf(x.dataset.board)), hid: (TabStrip._hidden || []).map((b) => ids.indexOf(b.id)), hidIds: (TabStrip._hidden || []).map((b) => b.id), ids, n: ids.length, active: ids.indexOf(Store.state.active),
    moreShown: !more.hidden, tops: [...new Set(v.map((x) => Math.round(x.getBoundingClientRect().top)))].length };
});
const firstRule = (v) => v.vis.every((x, i) => x === i) && v.hid.every((x, i) => x === v.vis.length + i) && v.vis.length + v.hid.length === v.n;
const center = (win, sel) => win.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, h: r.height, left: r.left, w: r.width }; }, sel);
const openMenu = async (win) => { await win.evaluate(() => Panels.closeMenu()); await sleep(80); await win.click('#tabs-more'); await sleep(250); };
const menuState = (win) => win.evaluate(() => { const m = document.querySelector('#ctxmenu'); return { open: !m.hidden, kind: m.dataset.menu || '', rows: [...m.querySelectorAll('.tm-row')].map((r) => ({ id: r.dataset.board, x: !!r.querySelector('.tm-x'), drag: r.getAttribute('draggable') })), manageLast: !!(m.lastElementChild && m.lastElementChild.classList.contains('tm-manage')), labels: [...m.querySelectorAll('.mi')].map((x) => x.textContent.trim()) }; });
const ctxSig = (win) => win.evaluate(() => { const m = document.querySelector('#ctxmenu'); return { open: !m.hidden, kind: m.dataset.menu || '', labels: [...m.querySelectorAll('.mi')].map((x) => x.textContent.trim()), danger: [...m.querySelectorAll('.mi.danger')].map((x) => x.textContent.trim()), sw: [...m.querySelectorAll('.sw')].map((x) => x.style.getPropertyValue('--c')) }; });
// a real mouse drag (Chromium drag & drop); hold = pause over a point first (spring-open «+N ▾»)
async function drag(win, from, to, opts = {}) {
  await win.mouse.move(from.x, from.y); await win.mouse.down(); await win.mouse.move(from.x + 6, from.y + 4, { steps: 3 });
  if (opts.via) { await win.mouse.move(opts.via.x, opts.via.y, { steps: 8 }); await sleep(opts.hold || 700); if (opts.shotAt) await shot(win, opts.shotAt); if (opts.then) to = await opts.then(); }
  await win.mouse.move(to.x, to.y, { steps: 10 }); await sleep(150);
  if (opts.shot) await shot(win, opts.shot);
  await win.mouse.up(); await sleep(350);
}

(async () => {
  let { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(String(ver) === '2.6.12.1', 'app version 2.6.12.1', ver);
  ok(await win.evaluate(() => window.__nyxTabs26121 === true && typeof BoardTabs === 'object' && typeof NyxUI.boardMove === 'function'), 'tabs26121 loaded');
  const before = await win.evaluate(() => {
    const A = Store.state.settings.ai; Object.assign(A.servers.llama, { ctx: 32768, extra: '--models-max 1' });
    Store.state.subs = [{ id: 's1', name: 'Netflix', price: 13.99, currency: 'EUR', cycle: 'monthly', next: '2026-11-20', active: true, color: '#e50914', icon: '🎬' }];
    Store.save(true); return { settingsKeys: Object.keys(JSON.parse(JSON.stringify(Store.state.settings))).sort(), subs: JSON.stringify(Store.state.subs) };
  });
  // spy on the bar's delete: every path must end here
  await win.evaluate(() => { window.__del = []; const o = App.deleteBoard; App.deleteBoard = function (b) { window.__del.push(b.id); return o.call(this, b); }; });

  // ---- 1) overflow rule ----
  const nFit = await win.evaluate(() => {
    const B = Store.state.boards; let i = 0;
    while (i < 60) { B.push({ id: 'f' + i, name: 'Πίνακας ' + (B.length + 1), emoji: '📁', color: '#7c8cff', view: null, items: [] }); Panels.tabs(); i++; if (!document.querySelector('#tabs-more').hidden) { B.pop(); Panels.tabs(); break; } }
    App.switchBoard(B[0].id); Store.save(true); return B.length;
  });
  const newIds = [];
  for (let k = 0; k < 3; k++) { await win.click('#btn-add-tab'); await sleep(450); await win.keyboard.press('Escape'); await sleep(150); newIds.push(await win.evaluate(() => Store.state.active)); }
  let v1 = await vis(win);
  ok(v1.n === nFit + 3 && newIds.every((id) => v1.hidIds.includes(id)) && firstRule(v1) && v1.tops === 1, `bar full (${nFit}) + 3 new tabs → the 3 in «+N ▾», the first tabs stay`, v1);
  // two boards with items for the delete tests (cards: sticky + text → binnable)
  await win.evaluate((ids) => {
    const B = Store.state.boards; const mk = (b, n) => { for (let i = 0; i < n; i++) b.items.push({ id: 'it' + b.id + i, type: 'sticky', x: i * 220, y: 0, w: 200, h: 140, html: 'κάρτα ' + i, paper: '#fff6a9', z: i + 1, created: Date.now() }); };
    mk(B.find((b) => b.id === ids[0]), 2); B.find((b) => b.id === ids[0]).name = 'Με υλικό'; mk(B.find((b) => b.id === ids[1]), 3); B.find((b) => b.id === ids[1]).name = 'Τρία στοιχεία';
    B.find((b) => b.id === ids[2]).name = 'Άδειος'; App.switchBoard(B[0].id); Store.save(true); Panels.tabs();
  }, newIds);

  // ---- 2) rows: × + right-click = the tab's menu ----
  await openMenu(win);
  let ms = await menuState(win);
  ok(ms.open && ms.kind === 'tabs-more' && ms.rows.length === v1.hid.length && ms.rows.every((r) => r.x && r.drag === 'true'), 'every «+N ▾» row has × and is draggable', ms);
  ok(ms.manageLast && /Διαχείριση πινάκων/.test(ms.labels[ms.labels.length - 1]), '«Διαχείριση πινάκων» is the last entry of the menu', ms.labels.slice(-2));
  await shot(win, 'v26121-menu-x.png');
  const rowSel = (id) => `#ctxmenu .tm-row[data-board="${id}"]`;
  let c = await center(win, rowSel(newIds[0]));
  await win.mouse.click(c.x, c.y, { button: 'right' }); await sleep(250);
  const fromRow = await ctxSig(win);
  await shot(win, 'v26121-row-rightclick.png');
  await win.keyboard.press('Escape'); await sleep(150);
  // the bar tab's own menu for the SAME board: bring it into the bar first? — no: compare with a visible tab's menu and the board's own colour rows
  const tc = await center(win, `#tabs .tab[data-board="${v1.ids[1]}"]`);
  await win.mouse.click(tc.x, tc.y, { button: 'right' }); await sleep(250);
  const fromTab = await ctxSig(win);
  await shot(win, 'v26121-tab-rightclick.png');
  await win.keyboard.press('Escape'); await sleep(150);
  ok(fromRow.open && fromRow.kind === '' && JSON.stringify(fromRow.labels) === JSON.stringify(fromTab.labels) && JSON.stringify(fromRow.sw) === JSON.stringify(fromTab.sw) && fromRow.danger.length === 1,
    'right-click on a menu row = the bar tab\'s menu (same entries, same order, same colours, no «+N» styling)', { fromRow, fromTab });
  ok(await win.evaluate(() => /Panels\.tabMenuRows|this\.tabMenuRows/.test(String(Panels.tabs)) && /tabMenuRows/.test(String(BoardTabs.ctxFor))), 'bar and menu build the right-click menu from ONE function (Panels.tabMenuRows)');
  // colour from the row menu
  await openMenu(win); c = await center(win, rowSel(newIds[2])); await win.mouse.click(c.x, c.y, { button: 'right' }); await sleep(200);
  const col = await win.evaluate((id) => { const sw = document.querySelectorAll('#ctxmenu .sw'); const want = sw[2].style.getPropertyValue('--c'); sw[2].click(); return { want, got: Store.state.boards.find((b) => b.id === id).color }; }, newIds[2]);
  ok(col.got === col.want, 'colour from the row\'s right-click menu changes that board', col);

  // ---- 3) delete: × on an empty board ----
  await win.evaluate(() => { window.__del.length = 0; }); const binA = await win.evaluate(() => (Store.state.bin || []).length);
  await openMenu(win); c = await center(win, rowSel(newIds[2]) + ' .tm-x'); await win.mouse.click(c.x, c.y); await sleep(300);
  let d = await win.evaluate((id) => ({ gone: !Store.state.boards.some((b) => b.id === id), modal: !document.querySelector('#modal').hidden, del: window.__del.slice(), bin: (Store.state.bin || []).length, menu: !document.querySelector('#ctxmenu').hidden && document.querySelector('#ctxmenu').dataset.menu, toast: [...document.querySelectorAll('.toast')].map((x) => x.textContent).join('|') }), newIds[2]);
  ok(d.gone && !d.modal && d.del.join() === newIds[2] && d.bin === binA, '× on an EMPTY board: deleted at once through App.deleteBoard, no question, nothing in the Bin', d);
  ok(d.menu === 'tabs-more', 'the menu stays open after deleting an empty board', d);
  await win.evaluate(() => Panels.closeMenu());
  const und = await win.evaluate(async (id) => { const b = [...document.querySelectorAll('.toast button')].find((x) => /Αναίρεση|Undo/.test(x.textContent)); if (b) b.click(); await new Promise((r) => setTimeout(r, 300)); return { clicked: !!b, back: Store.state.boards.findIndex((x) => x.id === id) }; }, newIds[2]);
  ok(und.clicked && und.back === v1.ids.indexOf(newIds[2]), 'its «Αναίρεση» brings the empty board back in the same place', und);
  await win.evaluate(() => { App.switchBoard(Store.state.boards[0].id); document.querySelectorAll('.toast').forEach((x) => x.remove()); }); await sleep(200);

  // ---- 3b) × on a board with items → confirm → Bin → undo ----
  await win.evaluate(() => { window.__del.length = 0; }); const binB = await win.evaluate(() => (Store.state.bin || []).length);
  await openMenu(win); c = await center(win, rowSel(newIds[0]) + ' .tm-x'); await win.mouse.click(c.x, c.y); await sleep(350);
  d = await win.evaluate((id) => ({ kept: Store.state.boards.some((b) => b.id === id), modal: !document.querySelector('#modal').hidden, text: document.querySelector('#modal-body p') && document.querySelector('#modal-body p').textContent, del: window.__del.slice() }), newIds[0]);
  ok(d.kept && d.modal && d.text === 'Διαγραφή πίνακα με 2 στοιχεία;' && d.del.join() === newIds[0], '× on a board WITH items asks «Διαγραφή πίνακα με 2 στοιχεία;» (App.deleteBoard)', d);
  await shot(win, 'v26121-confirm.png');
  await win.click('#modal .btn.primary'); await sleep(350);
  d = await win.evaluate((id) => ({ gone: !Store.state.boards.some((b) => b.id === id), bin: (Store.state.bin || []).length, inBin: (Store.state.bin || []).filter((e) => JSON.stringify(e).includes('it' + id)).length }), newIds[0]);
  ok(d.gone && d.bin === binB + 2 && d.inBin === 2, 'confirmed: board deleted, its 2 cards are in the Bin', d);
  const und2 = await win.evaluate(async (id) => { const b = [...document.querySelectorAll('.toast button')].find((x) => /Αναίρεση|Undo/.test(x.textContent)); if (b) b.click(); await new Promise((r) => setTimeout(r, 300)); const B = Store.state.boards.find((x) => x.id === id); return { clicked: !!b, items: B ? B.items.length : -1 }; }, newIds[0]);
  ok(und2.clicked && und2.items === 2, '«Αναίρεση» brings the board back with its 2 cards', und2);
  await win.evaluate(() => { App.switchBoard(Store.state.boards[0].id); document.querySelectorAll('.toast').forEach((x) => x.remove()); }); await sleep(200);
  // right-click «Διαγραφή» on a row → same question; Cancel keeps it
  await win.evaluate(() => { window.__del.length = 0; });
  await openMenu(win); c = await center(win, rowSel(newIds[1])); await win.mouse.click(c.x, c.y, { button: 'right' }); await sleep(200);
  await win.click('#ctxmenu .mi.danger'); await sleep(300);
  d = await win.evaluate((id) => ({ modal: !document.querySelector('#modal').hidden, text: document.querySelector('#modal-body p') && document.querySelector('#modal-body p').textContent, del: window.__del.slice() }), newIds[1]);
  ok(d.modal && d.text === 'Διαγραφή πίνακα με 3 στοιχεία;' && d.del.join() === newIds[1], 'right-click «Διαγραφή» on a row: the same App.deleteBoard and the same question', d);
  await win.click('#modal .btn.ghost'); await sleep(300);
  ok(await win.evaluate((id) => Store.state.boards.find((b) => b.id === id).items.length === 3, newIds[1]), 'Cancel keeps the board and its 3 cards');
  // Delete key on a focused row (empty board) → same path
  await win.evaluate(() => { window.__del.length = 0; });
  await openMenu(win); await win.evaluate((id) => document.querySelector(`#ctxmenu .mi[data-board="${id}"]`).focus(), newIds[2]); await win.keyboard.press('Delete'); await sleep(300);
  d = await win.evaluate((id) => ({ gone: !Store.state.boards.some((b) => b.id === id), del: window.__del.slice(), items: Store.state.boards.reduce((n, b) => n + b.items.length, 0) }), newIds[2]);
  ok(d.gone && d.del.join() === newIds[2], 'Delete key on a focused row: same App.deleteBoard (empty → at once)', d);
  await win.evaluate(async () => { const b = [...document.querySelectorAll('.toast button')].find((x) => /Αναίρεση|Undo/.test(x.textContent)); if (b) b.click(); await new Promise((r) => setTimeout(r, 250)); Panels.closeMenu(); App.switchBoard(Store.state.boards[0].id); document.querySelectorAll('.toast').forEach((x) => x.remove()); });
  await sleep(200);
  ok(await win.evaluate(() => !/deleteBoard\s*\(|boards\.splice/.test(String(BoardTabs.row) + String(BoardTabs.renderManage)) && /App\.deleteBoard\(b\)/.test(String(BoardTabs.del))), 'no second delete path: the menu / list only call BoardTabs.del → App.deleteBoard');

  // ---- 4) drags ----
  let v = await vis(win); const k = v.vis.length;
  // 4a) inside the menu: the last hidden row onto the first hidden row (upper half) → it goes before it
  await openMenu(win);
  const hidNow = (await vis(win)).hidIds; const A = hidNow[hidNow.length - 1], Bt = hidNow[0];
  let a = await center(win, rowSel(A)), b = await center(win, rowSel(Bt));
  await drag(win, { x: a.x - 40, y: a.y }, { x: b.x - 40, y: b.top + 4 }, { shot: 'v26121-drag-in-menu.png' });
  v = await vis(win); ms = await menuState(win);
  ok(v.hidIds[0] === A && v.hidIds[1] === Bt && firstRule(v), 'drag inside the menu: the board moved before the target, order saved in boards', { hid: v.hidIds, A, Bt });
  ok(ms.open && ms.kind === 'tabs-more' && ms.rows[0].id === A, 'the menu stays open and shows the new order', ms.rows.map((r) => r.id));
  // 4b) menu → bar: a hidden board onto the 2nd bar tab → it is at index 1 and in the bar; the last bar tab overflows
  const lastBar = v.ids[k - 1]; const mv = v.hidIds[1];
  a = await center(win, rowSel(mv)); b = await center(win, `#tabs .tab[data-board="${v.ids[1]}"]`);
  await drag(win, { x: a.x - 40, y: a.y }, { x: b.left + 8, y: b.y }, { shot: 'v26121-drag-menu-to-bar.png' });
  v = await vis(win);
  ok(v.ids[1] === mv && v.vis.includes(1) && v.hidIds.includes(lastBar) && firstRule(v) && v.vis.length === k, 'drag menu → bar: the board is now 2nd in the bar, the last bar tab moved into «+N ▾» (first-tabs rule)', { ids: v.ids.slice(0, k + 1), vis: v.vis, mv, lastBar });
  ok(await win.evaluate(() => document.querySelector('#ctxmenu').hidden), 'after a drop on the bar the menu is closed');
  // 4c) bar → «+N ▾»: the 3rd bar tab onto the button → to the end
  const toEnd = v.ids[2]; a = await center(win, `#tabs .tab[data-board="${toEnd}"]`); b = await center(win, '#tabs-more');
  await drag(win, a, b);
  v = await vis(win);
  ok(v.ids[v.n - 1] === toEnd && v.hidIds.includes(toEnd) && firstRule(v), 'drag bar → «+N ▾»: the board goes to the end, into the menu', { last: v.ids[v.n - 1], toEnd });
  // 4d) bar → hover «+N ▾» (menu opens) → drop on a row (before the first hidden one)
  const toRow = v.ids[1]; const target = v.hidIds[0];
  a = await center(win, `#tabs .tab[data-board="${toRow}"]`); b = await center(win, '#tabs-more');
  await drag(win, a, null, { via: b, hold: 800, then: async () => {  const r = await center(win, rowSel(target)); return r ? { x: r.x - 40, y: r.top + 4 } : b; }, shot: 'v26121-drag-bar-to-menu.png' });
  v = await vis(win);
  const idxT = v.ids.indexOf(target);
  ok(v.hidIds[0] === toRow && v.ids[idxT + 1] === toRow && v.vis.includes(idxT) && firstRule(v), 'drag bar → hold on «+N ▾» opens the menu → drop above the first row: the board is now FIRST in the menu, that row\'s board fills the bar slot', { toRow, target, ids: v.ids.slice(k - 2, k + 4), hid: v.hidIds.slice(0, 2) });
  await win.evaluate(() => Panels.closeMenu());
  // keyboard: Alt+↓ on a row moves it one place
  await openMenu(win); const kid = (await vis(win)).hidIds[0];
  await win.evaluate((id) => document.querySelector(`#ctxmenu .mi[data-board="${id}"]`).focus(), kid); await win.keyboard.press('Alt+ArrowDown'); await sleep(300);
  v = await vis(win); const kf = await win.evaluate(() => document.activeElement && document.activeElement.dataset.board);
  ok(v.hidIds[1] === kid && kf === kid, 'Alt+↓ on a menu row moves the board one place, focus stays on it', { hid: v.hidIds.slice(0, 3), kid, kf });
  await win.keyboard.press('F2'); await sleep(300);
  const f2 = await win.evaluate(() => !document.querySelector('#modal').hidden && !!document.querySelector('#modal-body input'));
  await win.keyboard.press('Escape'); await sleep(200);
  ok(f2, 'F2 on a menu row opens rename (the tab\'s own rename dialog)');
  await openMenu(win); await win.evaluate((id) => document.querySelector(`#ctxmenu .mi[data-board="${id}"]`).focus(), kid); await win.keyboard.press('Shift+F10'); await sleep(250);
  const sf = await ctxSig(win);
  ok(JSON.stringify(sf.labels) === JSON.stringify(fromTab.labels), 'Shift+F10 on a menu row opens the tab\'s menu', sf.labels);
  await win.keyboard.press('Escape'); await sleep(150);

  // ---- 5) «Διαχείριση πινάκων» ----
  await openMenu(win); await win.click('#ctxmenu .tm-manage'); await sleep(450);
  let mg = await win.evaluate(() => ({ kind: document.querySelector('#drawer').dataset.kind, open: !document.querySelector('#drawer').hidden, rows: [...document.querySelectorAll('#drawer-body .bm-row')].map((r) => r.dataset.board), ids: Store.state.boards.map((b) => b.id), title: document.querySelector('#drawer-title').textContent }));
  ok(mg.open && mg.kind === 'boards' && mg.rows.join() === mg.ids.join() && /Διαχείριση πινάκων/.test(mg.title), '«Διαχείριση πινάκων»: a list of ALL boards in their order', { n: mg.rows.length, nb: mg.ids.length });
  await shot(win, 'v26121-manage.png');
  // rename inline
  const rn = mg.ids[3];
  await win.click(`#drawer-body .bm-row[data-board="${rn}"] .bm-name`, { clickCount: 3 }); await win.keyboard.type('Μετονομασμένος'); await win.keyboard.press('Enter'); await sleep(300);
  let r1 = await win.evaluate((id) => ({ name: Store.state.boards.find((b) => b.id === id).name, tab: document.querySelector(`#tabs .tab[data-board="${id}"] .tab-name`).textContent }), rn);
  ok(r1.name === 'Μετονομασμένος' && r1.tab === 'Μετονομασμένος', 'rename in the list: board and its tab renamed', r1);
  const keepName = await win.evaluate((id) => { const i = document.querySelector(`#drawer-body .bm-row[data-board="${id}"] .bm-name`); i.focus(); i.value = '   '; i.dispatchEvent(new Event('change')); return Store.state.boards.find((b) => b.id === id).name; }, rn);
  ok(keepName === 'Μετονομασμένος', 'an empty name is not saved (the old name stays)', keepName);
  // reorder by dragging the grip: row 0 below row 2
  mg = await win.evaluate(() => Store.state.boards.map((b) => b.id));
  a = await center(win, `#drawer-body .bm-row[data-board="${mg[0]}"] .bm-grip`); b = await center(win, `#drawer-body .bm-row[data-board="${mg[2]}"]`);
  await drag(win, a, { x: b.x, y: b.top + b.h - 4 }, { shot: 'v26121-manage-drag.png' });
  let o2 = await win.evaluate(() => ({ ids: Store.state.boards.map((b) => b.id), rows: [...document.querySelectorAll('#drawer-body .bm-row')].map((r) => r.dataset.board), tabs: [...document.querySelectorAll('#tabs .tab')].map((x) => x.dataset.board) }));
  ok(o2.ids[2] === mg[0] && o2.ids[0] === mg[1] && o2.rows.join() === o2.ids.join() && o2.tabs.join() === o2.ids.join(), 'drag in the list: board 1 is now 3rd — list, boards and bar agree', { was: mg.slice(0, 3), now: o2.ids.slice(0, 3) });
  // Alt+↑ brings it back to 2nd
  await win.evaluate((id) => document.querySelector(`#drawer-body .bm-row[data-board="${id}"]`).focus(), mg[0]); await win.keyboard.press('Alt+ArrowUp'); await sleep(300);
  o2 = await win.evaluate(() => ({ ids: Store.state.boards.map((b) => b.id), f: document.activeElement && document.activeElement.dataset.board }));
  ok(o2.ids[1] === mg[0] && o2.f === mg[0], 'Alt+↑ in the list moves it up one place, focus kept', { now: o2.ids.slice(0, 3), f: o2.f });
  // ⋯ = the tab menu
  await win.click(`#drawer-body .bm-row[data-board="${mg[1]}"] .bm-more`); await sleep(250);
  const dots = await ctxSig(win); await win.keyboard.press('Escape'); await sleep(150);
  ok(JSON.stringify(dots.labels) === JSON.stringify(fromTab.labels), '⋯ in the list opens the same tab menu', dots.labels);
  if (await win.evaluate(() => document.querySelector('#drawer').hidden)) { await openMenu(win); await win.click('#ctxmenu .tm-manage'); await sleep(400); }
  // delete from the list: board with 3 items → the same question → Bin
  await win.evaluate(() => { window.__del.length = 0; }); const binC = await win.evaluate(() => (Store.state.bin || []).length);
  await win.click(`#drawer-body .bm-row[data-board="${newIds[1]}"] .bm-del`); await sleep(300);
  d = await win.evaluate(() => ({ modal: !document.querySelector('#modal').hidden, text: document.querySelector('#modal-body p') && document.querySelector('#modal-body p').textContent, del: window.__del.slice() }));
  ok(d.modal && d.text === 'Διαγραφή πίνακα με 3 στοιχεία;' && d.del.join() === newIds[1], 'delete in the list: App.deleteBoard + «Διαγραφή πίνακα με 3 στοιχεία;»', d);
  await win.click('#modal .btn.primary'); await sleep(400);
  d = await win.evaluate((id) => ({ gone: !Store.state.boards.some((b) => b.id === id), bin: (Store.state.bin || []).length, rows: document.querySelectorAll('#drawer-body .bm-row').length, n: Store.state.boards.length }), newIds[1]);
  ok(d.gone && d.bin === binC + 3 && d.rows === d.n, 'confirmed: gone from the list and the bar, its 3 cards in the Bin', d);
  await shot(win, 'v26121-manage-after.png');
  const und3 = await win.evaluate(async (id) => { const b = [...document.querySelectorAll('.toast button')].find((x) => /Αναίρεση|Undo/.test(x.textContent)); if (b) b.click(); await new Promise((r) => setTimeout(r, 300)); const B = Store.state.boards.find((x) => x.id === id); return { clicked: !!b, items: B ? B.items.length : -1, row: !!document.querySelector(`#drawer-body .bm-row[data-board="${id}"]`) }; }, newIds[1]);
  ok(und3.clicked && und3.items === 3 && und3.row, '«Αναίρεση» brings it back (list updated too)', und3);
  await win.evaluate(() => { Panels.closeDrawer(); App.switchBoard(Store.state.boards[0].id); document.querySelectorAll('.toast').forEach((x) => x.remove()); }); await sleep(300);
  v = await vis(win);
  ok(firstRule(v) && v.tops === 1, 'after all of it: the first tabs are in the bar, the last in «+N ▾», one line', v);

  // ---- 6) small window ----
  await setSize(app, 1024, 700);
  await openMenu(win);
  const sm = await win.evaluate(() => { const m = document.querySelector('#ctxmenu').getBoundingClientRect(); return { l: Math.round(m.left), r: Math.round(m.right), b: Math.round(m.bottom), W: innerWidth, H: innerHeight, x: [...document.querySelectorAll('#ctxmenu .tm-x')].every((x) => { const r = x.getBoundingClientRect(); return r.width >= 18 && r.right <= innerWidth; }) }; });
  ok(sm.l >= 0 && sm.r <= sm.W && sm.b <= sm.H && sm.x, '1024×700: menu (with every ×) inside the window', sm);
  await shot(win, 'v26121-small-menu-x.png');
  c = await center(win, rowSel((await vis(win)).hidIds[0])); await win.mouse.click(c.x, c.y, { button: 'right' }); await sleep(250);
  const smc = await win.evaluate(() => { const m = document.querySelector('#ctxmenu').getBoundingClientRect(); return { r: Math.round(m.right), b: Math.round(m.bottom), W: innerWidth, H: innerHeight }; });
  ok(smc.r <= smc.W && smc.b <= smc.H, '1024×700: the right-click menu inside the window', smc);
  await shot(win, 'v26121-small-row-rightclick.png'); await win.keyboard.press('Escape'); await sleep(150);
  { const t1 = await center(win, '#tabs .tab:not([hidden]):nth-child(1)'); await win.mouse.click(t1.x, t1.y, { button: 'right' }); await sleep(250); await shot(win, 'v26121-small-tab-rightclick.png'); await win.keyboard.press('Escape'); await sleep(150); }
  await openMenu(win); const hs = (await vis(win)).hidIds; a = await center(win, rowSel(hs[hs.length - 1])); b = await center(win, rowSel(hs[0]));
  await drag(win, { x: a.x - 30, y: a.y }, { x: b.x - 30, y: b.top + 4 }, { shot: 'v26121-small-drag-in-menu.png' });
  ok((await vis(win)).hidIds[0] === hs[hs.length - 1], '1024×700: drag inside the menu works');
  await openMenu(win); await win.click('#ctxmenu .tm-manage'); await sleep(450);
  const smm = await win.evaluate(() => { const r = document.querySelector('#drawer-body .bm-row'); const rr = r.getBoundingClientRect(); const del = r.querySelector('.bm-del').getBoundingClientRect(); const nm = r.querySelector('.bm-name').getBoundingClientRect(); return { right: Math.round(del.right), W: innerWidth, name: Math.round(nm.width) }; });
  ok(smm.right <= smm.W && smm.name >= 90, '1024×700: «Διαχείριση πινάκων» rows fit (name field ≥ 90 px, delete visible)', smm);
  await shot(win, 'v26121-small-manage.png');
  await win.evaluate(() => Panels.closeDrawer()); await setSize(app, 1440, 900);

  // ---- 7) regressions ----
  await win.evaluate(() => { Tools.pick('select'); Store.undoStack.length = 0; }); const rid = await win.evaluate(() => Features.addAtCenter({ type: 'sticky', html: 'αναίρεση', w: 200, h: 140 }).id); await sleep(200);
  await win.evaluate(() => document.querySelector('#viewport').focus()); await win.keyboard.press('Control+z'); await sleep(300);
  const goneZ = await win.evaluate((id) => !Store.state.boards.some((b) => b.items.some((i) => i.id === id)), rid);
  await win.keyboard.press('Control+y'); await sleep(300);
  const backY = await win.evaluate((id) => Store.state.boards.some((b) => b.items.some((i) => i.id === id)), rid);
  ok(goneZ && backY, 'Ctrl+Z removes the new card, Ctrl+Y brings it back');
  const bin0 = await win.evaluate(() => (Store.state.bin || []).length);
  await win.evaluate((id) => { Canvas.sel.clear(); Canvas.sel.add(id); Canvas.refresh && Canvas.refresh(); document.querySelector('#viewport').focus(); }, rid); await win.keyboard.press('Delete'); await sleep(300);
  const bin1 = await win.evaluate((id) => ({ n: (Store.state.bin || []).length, gone: !Store.items().some((i) => i.id === id) }), rid);
  ok(bin1.n === bin0 + 1 && bin1.gone, 'Bin: a deleted card still goes to the Bin', { bin0, bin1 });
  const mcp = await win.evaluate(async () => { const list = await API.inv('plugins:list').catch(() => null); const arr = Array.isArray(list) ? list : (list && list.plugins) || []; return arr.some((p) => /mcp/i.test(p.id || p.name || '')); });
  ok(mcp, 'MCP plugin still installed');
  const after = await win.evaluate(() => { const s = JSON.parse(JSON.stringify(Store.state.settings)); return { settingsKeys: Object.keys(s).sort(), subs: JSON.stringify(Store.state.subs), ctx: s.ai.servers.llama.ctx, extra: s.ai.servers.llama.extra }; });
  ok(after.subs === before.subs, 'subscriptions unchanged');
  ok(before.settingsKeys.every((k) => after.settingsKeys.includes(k)), 'no existing setting removed');
  ok(after.ctx === 32768 && /--models-max 1/.test(after.extra), 'router settings untouched (ctx 32768, --models-max 1)', after);
  const order = await win.evaluate(() => Store.state.boards.map((b) => b.id + ':' + b.name + ':' + b.items.length).join('|'));
  await win.evaluate(() => Store.save(true)); await sleep(300); await quit(app);
  ({ app, win } = await launch()); await sleep(500);
  const order2 = await win.evaluate(() => Store.state.boards.map((b) => b.id + ':' + b.name + ':' + b.items.length).join('|'));
  const rs = await vis(win);
  ok(order2 === order, 'after restart: the same boards, names, cards and ORDER', { a: order.slice(0, 200), b: order2.slice(0, 200) });
  ok(firstRule(rs) && rs.tops === 1, 'after restart: first tabs in the bar, the rest in «+N ▾»', rs);
  await quit(app);
  console.log(`\nv2.6.12.1 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
