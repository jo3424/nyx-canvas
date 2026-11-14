'use strict';
// v2.6.10 UI (Electron, Chromium sandbox on): Ctrl+Z / Ctrl+Y with real keys (Latin and Greek layout) after a click on
// the empty canvas, undo of move / edit / delete, Ctrl+Z in a text field untouched, subscriptions confirmation kept;
// Bin: delete 3 cards (2 boards) → restore 1, then 2 with checkboxes, each at its board and position; deleted board;
// old items only marked; purge only after OK; bin survives a restart. Links in cards → Nyx browser tab, Ctrl+click /
// menu → system browser, no drag / edit. MCP: look fields, errors, kept_timeout.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2610-'));
let fails = 0, passes = 0;
const T0 = Date.now(); const ok = (c, m, x) => { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true || window.__nyxV25Ready === true, null, { timeout: 30000 });
  await win.waitForTimeout(500);
  // the system browser is never really opened by the test: record the calls in the main process
  await app.evaluate(({ shell }) => { global.__ext = []; shell.openExternal = async (u) => { global.__ext.push(u); }; });
  return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
async function closeModal(win) { await win.evaluate(() => { if (!document.querySelector('#modal').hidden) document.querySelector('#modal-close').click(); }); await sleep(300); }
const empty = (win) => win.evaluate(() => { const r = document.querySelector('#viewport').getBoundingClientRect(); for (let y = r.top + 120; y < r.bottom - 150; y += 37) for (let x = r.left + 80; x < r.right - 260; x += 41) { const e = document.elementFromPoint(x, y); if (e && (e.id === 'viewport' || e.id === 'world' || e.classList.contains('grid')) && !e.closest('.item')) return { x, y }; } return null; });
const rect = (win, id, sel) => win.evaluate(([id, sel]) => { const n = document.querySelector(`.item[data-id="${id}"]`); const e = sel ? n && n.querySelector(sel) : n; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, w: r.width, h: r.height }; }, [id, sel]);
const has = (win, id) => win.evaluate((id) => Store.state.boards.some((b) => b.items.some((i) => i.id === id)), id);
const item = (win, id) => win.evaluate((id) => { for (const b of Store.state.boards) { const i = b.items.find((x) => x.id === id); if (i) return { board: b.id, x: i.x, y: i.y, html: i.html, idx: b.items.indexOf(i) }; } return null; }, id);
async function greekKey(win, cdp, key, code, vk) { for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, modifiers: 2, key, code, windowsVirtualKeyCode: vk }); await sleep(300); }

(async () => {
  let { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(String(ver).startsWith('2.6.10'), 'app version 2.6.10', ver);
  await win.evaluate(() => {
    Store.state.subs = [{ id: 'keep0', name: 'Netflix', price: 13.99, currency: 'EUR', cycle: 'monthly', next: '2026-11-20', active: true, remindDays: 2, color: '#e50914', icon: '🎬' }];
    for (const b of Store.state.boards) b.items = [];
    if (Store.state.boards.length < 2) Store.state.boards.push({ id: 'bB', name: 'Δεύτερος', emoji: '📁', items: [], view: { x: 0, y: 0, z: 1 } });
    Store.state.bin = []; Store.undoStack.length = 0; Store.redoStack.length = 0; Store.save(true); Canvas.renderBoard(); App.renderTabs?.(); Panels.tabs?.();
    try { Assistant.hide(); } catch (e) {}
  });
  const cdp = await win.context().newCDPSession(win);

  // ---- 1) the bug: new card → click on empty canvas → Ctrl+Z → gone; Ctrl+Y → back ----
  for (const layout of ['latin', 'greek']) {
    const id = await win.evaluate(() => Features.addAtCenter({ type: 'sticky', html: 'κάρτα Ctrl+Z', w: 220, h: 140 }).id);
    await sleep(300);
    const p = await empty(win); await win.mouse.click(p.x, p.y); await sleep(250);
    const focus = await win.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    if (layout === 'latin') await win.keyboard.press('Control+z'); else await greekKey(win, cdp, 'ζ', 'KeyZ', 90);
    await sleep(300);
    const gone = !(await has(win, id));
    ok(gone, `${layout}: card → click on empty canvas → Ctrl+Z → the card is gone`, { focus });
    if (layout === 'latin') await win.keyboard.press('Control+y'); else await greekKey(win, cdp, 'υ', 'KeyY', 89);
    await sleep(300);
    ok(await has(win, id), `${layout}: Ctrl+Y → the card is back`);
    await win.evaluate((id) => { Store.change(() => Store.removeItems([id])); Store.state.bin = []; Store.undoStack.length = 0; Store.redoStack.length = 0; Canvas.renderBoard(); }, id);
  }
  // focus on a toolbar button, and a card left in edit mode: Ctrl+Z still works
  {
    const id = await win.evaluate(() => Features.addAtCenter({ type: 'sticky', html: 'εστίαση', w: 220, h: 140 }).id); await sleep(200);
    await win.evaluate(() => document.querySelector('#z-bin').focus());
    await win.keyboard.press('Control+z'); await sleep(300);
    ok(!(await has(win, id)), 'focus on a button (the bin) → Ctrl+Z still undoes the card');
    await win.keyboard.press('Control+y'); await sleep(300);
    await win.evaluate((id) => { Canvas.edit(id); document.querySelector(`.item[data-id="${id}"] .txt`).blur(); }, id); await sleep(200);
    const p = await empty(win); await win.evaluate(() => document.querySelector('#viewport').focus());
    await win.keyboard.press('Control+z'); await sleep(300);
    ok(!(await has(win, id)), 'card left in edit mode (focus on the canvas) → Ctrl+Z ends the edit and undoes');
    await win.keyboard.press('Control+y'); await sleep(300);
    await win.evaluate((id) => { Store.change(() => Store.removeItems([id])); Store.state.bin = []; Store.undoStack.length = 0; Store.redoStack.length = 0; Canvas.renderBoard(); }, id);
  }
  // ---- 2) move / edit / delete undo with real input ----
  {
    const id = await win.evaluate(() => Features.addAtCenter({ type: 'sticky', html: 'μετακίνηση', w: 220, h: 140 }).id); await sleep(300);
    await win.evaluate(() => { Store.undoStack.length = 0; Canvas.select([]); });
    const p = await empty(win); await win.mouse.click(p.x, p.y);
    const before = await item(win, id); const r = await rect(win, id);
    await win.mouse.move(r.x, r.t + 20); await win.mouse.down(); await win.mouse.move(r.x + 60, r.t + 60, { steps: 6 }); await win.mouse.move(r.x + 160, r.t + 120, { steps: 6 }); await win.mouse.up(); await sleep(300);
    const moved = await item(win, id);
    const p2 = await empty(win); await win.mouse.click(p2.x, p2.y); await win.keyboard.press('Control+z'); await sleep(300);
    const back = await item(win, id);
    ok(moved.x !== before.x && back.x === before.x && back.y === before.y, 'drag a card → click empty → Ctrl+Z → back to its old position', { before, moved, back });
    await win.keyboard.press('Control+y'); await sleep(300); const re = await item(win, id);
    ok(re.x === moved.x && re.y === moved.y, 'Ctrl+Y → moved again');
    // edit: double click, type, click away, Ctrl+Z (a fresh card, nothing selected)
    const eid = await win.evaluate(() => { Canvas.select([]); const c = Store.change(() => Store.addItem({ type: 'sticky', html: 'κείμενο', x: -420, y: -200, w: 220, h: 160 })); Canvas.renderBoard(); return c.id; }); await sleep(300);
    const r2 = await rect(win, eid); await win.mouse.click(r2.x, r2.y); await sleep(150); await win.keyboard.press('Enter'); await sleep(250);
    const edOn = await win.evaluate(() => Canvas.editing);
    await win.keyboard.press('Control+End'); await win.keyboard.insertText(' ΝΕΟ'); await sleep(100);
    const p3 = await empty(win); await win.mouse.click(p3.x, p3.y); await sleep(250);
    const edited = await item(win, eid);
    await win.keyboard.press('Control+z'); await sleep(300); const unEdited = await item(win, eid);
    ok(edOn === eid && /ΝΕΟ/.test(edited.html) && unEdited.html === 'κείμενο', 'edit text (select + Enter, type) → click empty → Ctrl+Z → old text', { edOn, eid, edited: edited.html, unEdited: unEdited.html });
    await win.keyboard.press('Control+y'); await sleep(300); ok(/ΝΕΟ/.test((await item(win, eid)).html), 'Ctrl+Y → edit back');
    await win.evaluate((eid) => { Store.change(() => Store.removeItems([eid])); Store.state.bin = []; Canvas.renderBoard(); }, eid);
    // delete with the key, then Ctrl+Z
    const r3 = await rect(win, id); await win.mouse.click(r3.x, r3.t + 10); await sleep(150); await win.keyboard.press('Delete'); await sleep(300);
    const del = !(await has(win, id)); const toastUndo = await win.evaluate(() => [...document.querySelectorAll('.toast')].some((x) => /Αναίρεση|Undo/i.test(x.textContent)));
    ok(del && toastUndo, 'Delete key → card deleted, the «Αναίρεση» toast is shown', { del, toastUndo });
    ok(await win.evaluate((id) => (Store.state.bin || []).some((e) => e.id === id), id), '… and it is in the bin');
    const p4 = await empty(win); await win.mouse.click(p4.x, p4.y); await win.keyboard.press('Control+z'); await sleep(300);
    ok(await has(win, id) && await win.evaluate((id) => !(Store.state.bin || []).some((e) => e.id === id), id), 'Ctrl+Z → card back, out of the bin');
    // typing in a text field: Ctrl+Z belongs to the field
    const n0 = await win.evaluate(() => Store.undoStack.length);
    await win.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; i.style.cssText = 'position:fixed;left:200px;top:200px;z-index:99999'; document.body.append(i); i.focus(); });
    await win.keyboard.type('abc'); await win.keyboard.press('Control+z'); await sleep(250);
    ok(await has(win, id) && (await win.evaluate(() => Store.undoStack.length)) === n0, 'Ctrl+Z while typing in a text field → the canvas is not touched');
    await win.evaluate(() => document.querySelector('#tmp-in').remove());
    await win.evaluate((id) => { Store.change(() => Store.removeItems([id])); Store.state.bin = []; Store.undoStack.length = 0; Store.redoStack.length = 0; Canvas.renderBoard(); }, id);
  }
  // ---- 3) the 2.6.9.3 subscription confirmation is kept ----
  {
    await win.evaluate(() => Store.change(() => { Store.state.subs.push({ id: 'sX', name: 'Spotify', price: 10.99, currency: 'EUR', cycle: 'monthly', next: '2026-11-25', active: true }); }));
    const p = await empty(win); await win.mouse.click(p.x, p.y); await win.keyboard.press('Control+z'); await sleep(400);
    const c = await win.evaluate(() => ({ modal: !document.querySelector('#modal').hidden, subs: Store.state.subs.length }));
    ok(c.modal && c.subs === 2, 'Ctrl+Z of a subscription → the confirmation asks first (unchanged)', c);
    await closeModal(win);
    ok((await win.evaluate(() => Store.state.subs.length)) === 2, 'declined → the subscription stays');
    await win.evaluate(() => { Store.undoStack.length = 0; Store.redoStack.length = 0; });
  }
  // ---- 4) Bin: delete 3 cards (2 boards) → restore 1 → the other 2 with checkboxes ----
  const ids = await win.evaluate(() => {
    const A = Store.state.boards[0], Bb = Store.state.boards[1];
    const a1 = Store.change(() => Store.addItem({ type: 'sticky', html: 'Κάδος Α1', x: 120, y: 90, w: 200, h: 120, color: '#ffe066' }, A));
    const a2 = Store.change(() => Store.addItem({ type: 'sticky', html: 'Κάδος Α2', x: 380, y: -60, w: 200, h: 120 }, A));
    const b1 = Store.change(() => Store.addItem({ type: 'text', html: 'Κάδος Β1', x: -240, y: 40, w: 260, h: 60 }, Bb));
    Canvas.renderBoard(); return { a1: a1.id, a2: a2.id, b1: b1.id, A: A.id, B: Bb.id };
  });
  const orig = { a1: await item(win, ids.a1), a2: await item(win, ids.a2), b1: await item(win, ids.b1) };
  // delete the two on the visible board with the Delete key, the third from its own board
  await win.evaluate(() => Canvas.select([]));
  for (const k of ['a1', 'a2']) { const r = await rect(win, ids[k]); await win.mouse.click(r.x, r.t + 10); await sleep(120); await win.keyboard.press('Delete'); await sleep(250); }
  await win.evaluate((b) => App.switchBoard(b), ids.B); await sleep(400);
  { const r = await rect(win, ids.b1); await win.mouse.click(r.x, r.y); await sleep(120); await win.keyboard.press('Delete'); await sleep(250); }
  await win.evaluate((a) => App.switchBoard(a), ids.A); await sleep(400);
  const badge = await win.evaluate(() => ({ n: document.querySelector('#z-bin').dataset.count, txt: document.querySelector('#z-bin .bin-n').textContent, hidden: document.querySelector('#z-bin .bin-n').hidden }));
  ok(badge.n === '3' && badge.txt === '3' && !badge.hidden, 'delete 3 cards → the bin button shows 3', badge);
  await win.click('#z-bin'); await sleep(400);
  const bName = await win.evaluate((b) => Store.state.boards.find((x) => x.id === b).name, ids.B);
  const rows = await win.evaluate(() => [...document.querySelectorAll('[data-bin-row]')].map((r) => ({ bid: r.dataset.binRow, t: r.textContent })));
  const rule = await win.evaluate(() => (document.querySelector('[data-bin-rule]') || {}).textContent || '');
  ok(rows.length === 3 && rows.some((r) => /Κάδος Β1/.test(r.t) && r.t.includes(bName)) && rows.every((r) => /\d\d\/\d\d \d\d:\d\d/.test(r.t)), 'the bin lists name, board and time (DD/MM HH:MM)', rows);
  ok(/30/.test(rule) && /OK/.test(rule), 'the rule is visible: kept ≥30 days, nothing deleted without OK', rule);
  const bidOf = (name) => rows.find((r) => r.t.includes(name)).bid;
  await win.click(`[data-bin-restore="${bidOf('Κάδος Α2')}"]`); await sleep(400);
  const ra2 = await item(win, ids.a2);
  ok(ra2 && ra2.board === ids.A && ra2.x === orig.a2.x && ra2.y === orig.a2.y, 'restore one (Α2) → same board, same position', { ra2, o: orig.a2 });
  ok((await win.evaluate(() => document.querySelectorAll('[data-bin-row]').length)) === 2 && (await win.evaluate(() => document.querySelector('#z-bin').dataset.count)) === '2', 'bin now 2 (list and counter)');
  await win.click(`[data-bin-cb="${bidOf('Κάδος Α1')}"]`); await win.click(`[data-bin-cb="${bidOf('Κάδος Β1')}"]`);
  await win.click('[data-act="bin-restore-sel"]'); await sleep(400);
  const ra1 = await item(win, ids.a1), rb1 = await item(win, ids.b1);
  ok(ra1 && ra1.board === ids.A && ra1.x === orig.a1.x && ra1.y === orig.a1.y && rb1 && rb1.board === ids.B && rb1.x === orig.b1.x && rb1.y === orig.b1.y, 'the other 2 via checkboxes → each on its own board and position', { ra1, rb1, orig });
  ok((await win.evaluate(() => !!document.querySelector('[data-bin-empty]'))) && (await win.evaluate(() => document.querySelector('#z-bin .bin-n').hidden)), 'bin empty, counter hidden');
  await win.evaluate(() => Panels.closeDrawer?.());
  // ---- 5) the board is gone → the bin says so and asks ----
  {
    const r = await win.evaluate(() => {
      Store.state.boards.push({ id: 'bGone', name: 'Παλιός', emoji: '🧪', items: [], view: { x: 0, y: 0, z: 1 } });
      const c = Store.change(() => Store.addItem({ type: 'sticky', html: 'στον Παλιό', x: 333, y: 44, w: 200, h: 120 }, Store.state.boards.find((b) => b.id === 'bGone')));
      Store.save(true); return c.id;
    });
    await win.evaluate(() => App.deleteBoard(Store.state.boards.find((b) => b.id === 'bGone'))); await sleep(300);
    await win.evaluate(() => document.querySelector('#modal .btn.primary').click()); await sleep(400);
    ok(await win.evaluate(() => !Store.state.boards.some((b) => b.id === 'bGone') && Store.state.bin.some((e) => e.board && e.board.id === 'bGone')), 'deleted board → its card is in the bin');
    await win.click('#z-bin'); await sleep(300);
    const row = await win.evaluate(() => document.querySelector('[data-bin-row]').textContent);
    ok(/Παλιός/.test(row) && /δεν υπάρχει|no longer/i.test(row), 'the row says the board no longer exists', row);
    await win.click('[data-bin-restore]'); await sleep(400);
    const ask = await win.evaluate(() => ({ ask: !!document.querySelector('#modal:not([hidden]) [data-bin-ask]'), opts: [...document.querySelectorAll('[data-bin-board] option')].map((o) => o.value) }));
    ok(ask.ask && ask.opts[0] === 'recreate' && ask.opts.length >= 3, 'restore → a question: recreate the board or pick another', ask);
    await win.evaluate(() => document.querySelector('#modal .btn.primary').click()); await sleep(400);
    const nb = await win.evaluate((id) => { const b = Store.state.boards.find((x) => x.id === 'bGone'); return b && { name: b.name, it: b.items.find((i) => i.id === id) }; }, r);
    ok(nb && nb.name === 'Παλιός' && nb.it && nb.it.x === 333 && nb.it.y === 44, '«recreate» → board «Παλιός» again, card at its position', nb);
    await win.evaluate(() => Panels.closeDrawer?.());
  }
  // ---- 6) old items only marked; purge only after OK; a subscription in the bin ----
  {
    await win.evaluate(() => {
      const now = Date.now();
      Store.state.bin = [{ bid: 'old-1', kind: 'card', id: 'oldc', at: now - 40 * 86400000, name: 'πολύ παλιά', board: { id: Store.state.boards[0].id, name: Store.state.boards[0].name }, i: 0, v: { id: 'oldc', type: 'sticky', html: 'πολύ παλιά', x: 10, y: 10, w: 200, h: 120 } }];
      Store.change(() => { Store.state.subs = Store.state.subs.filter((s) => s.id !== 'sX'); });
      Store.save(true); Bin.badge();
    });
    const b = await win.evaluate(() => ({ n: document.querySelector('#z-bin').dataset.count, old: document.querySelector('#z-bin').dataset.old, cls: document.querySelector('#z-bin .bin-n').classList.contains('old') }));
    ok(b.n === '2' && b.old === '1' && b.cls, 'an item older than 30 days is marked on the button (not deleted)', b);
    await win.click('#z-bin'); await sleep(300);
    const d = await win.evaluate(() => ({ note: (document.querySelector('[data-bin-old]') || {}).textContent || '', sub: !!document.querySelector('[data-bin-row][data-kind="sub"]') }));
    ok(/30/.test(d.note) && d.sub, 'the drawer says so (and lists the deleted subscription)', d);
    await win.click('[data-act="bin-purge-old"]'); await sleep(300);
    ok(await win.evaluate(() => !!document.querySelector('#modal:not([hidden]) [data-bin-purge-q]')), 'permanent delete → asks for OK');
    await closeModal(win);
    ok((await win.evaluate(() => Store.state.bin.length)) === 2, 'cancelled → nothing deleted');
    await win.click('[data-act="bin-purge-old"]'); await sleep(300); await win.evaluate(() => document.querySelector('#modal .btn.primary').click()); await sleep(300);
    ok(await win.evaluate(() => Store.state.bin.length === 1 && Store.state.bin[0].kind === 'sub'), 'OK → only the old one is deleted');
    await win.evaluate(() => Panels.closeDrawer?.()); await win.evaluate(() => Store.save(true)); await sleep(600);
  }
  // ---- 7) restart: the bin is still there ----
  const cardsBefore = await win.evaluate(() => Store.state.boards.reduce((a, b) => a + b.items.length, 0));
  await quit(app); ({ app, win } = await launch());
  {
    const b = await win.evaluate(() => ({ before: 0, n: (Store.state.bin || []).length, name: Store.state.bin && Store.state.bin[0] && Store.state.bin[0].name, badge: document.querySelector('#z-bin').dataset.count, cards: Store.state.boards.reduce((a, b) => a + b.items.length, 0) }));
    ok(b.n === 1 && b.name === 'Spotify' && b.badge === '1' && b.cards === cardsBefore, 'after a restart: bin kept (1 subscription), cards unchanged', b);
    await win.evaluate(() => { const e = Store.state.bin[0]; return Bin.restore([e.bid]); }); await sleep(300);
    ok(await win.evaluate(() => Store.state.subs.some((s) => s.id === 'sX') && !Store.state.bin.length), 'the subscription is restored from the bin');
  }
  // ---- 8) links in cards ----
  {
    const id = await win.evaluate(() => {
      for (const b of Store.state.boards) b.items = []; Store.undoStack.length = 0; Canvas.renderBoard();
      return Store.change(() => Store.addItem({ type: 'sticky', html: 'Σημείωση<br>Πηγές: <a href="http://127.0.0.1:9/pigi">Πηγή 1</a><br>δες http://127.0.0.1:9/apli εδώ<br>mail <a href="javascript:alert(1)">κακό</a>', x: -150, y: -100, w: 380, h: 220 })).id;
    });
    await win.evaluate(() => Canvas.renderBoard()); await sleep(300);
    const before = await item(win, id); const tabs0 = await win.evaluate(() => Browser.tabs.length);
    const a = await rect(win, id, 'a[href^="http"]');
    await win.mouse.click(a.x, a.y); await sleep(600);
    const st = await win.evaluate(() => ({ tabs: Browser.tabs.length, last: Links.last, url: Browser.cur && Browser.cur.wv && Browser.cur.wv.getAttribute('src'), part: Browser.cur && Browser.cur.wv && Browser.cur.wv.getAttribute('partition'), editing: Canvas.editing, sel: [...Canvas.sel] }));
    const after = await item(win, id);
    ok(st.tabs === tabs0 + 1 && st.last && st.last.where === 'nyx' && /\/pigi$/.test(st.last.url) && st.part === 'persist:nyxweb', 'click on «Πηγή 1» → a new tab in the Nyx browser (persist:nyxweb)', st);
    ok(!st.editing && after.x === before.x && after.y === before.y, 'no edit, no move', { st, before, after });
    ok((await app.evaluate(() => global.__ext.length)) === 0, 'nothing sent to the system browser');
    await win.evaluate(() => { try { Browser.hide ? Browser.hide() : Browser.close?.(); } catch (e) {} }); await sleep(300);
    // a plain URL in the text
    const u = await win.evaluate((id) => { const tx = document.querySelector(`.item[data-id="${id}"] .txt`); const w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.textContent.indexOf('http://127.0.0.1:9/apli'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i + 4); r.setEnd(n, i + 12); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } } return null; }, id);
    await win.mouse.click(u.x, u.y); await sleep(600);
    const st2 = await win.evaluate(() => ({ tabs: Browser.tabs.length, last: Links.last, editing: Canvas.editing }));
    ok(st2.tabs === tabs0 + 2 && /\/apli$/.test(st2.last.url) && st2.last.where === 'nyx' && !st2.editing, 'click on a plain URL written in a note → Nyx tab', st2);
    await win.evaluate(() => { try { Browser.hide ? Browser.hide() : 0; } catch (e) {} }); await sleep(300);
    // drag starting on the link: no card drag, no tab
    await win.mouse.move(a.x, a.y); await win.mouse.down(); await win.mouse.move(a.x + 80, a.y + 50, { steps: 6 }); await win.mouse.up(); await sleep(300);
    const after2 = await item(win, id);
    ok(after2.x === before.x && (await win.evaluate(() => Browser.tabs.length)) === tabs0 + 2, 'dragging from a link moves nothing and opens nothing');
    // double click on a link: no edit
    await win.mouse.dblclick(a.x, a.y); await sleep(500);
    ok(!(await win.evaluate(() => Canvas.editing)), 'double click on a link does not open the edit');
    await win.evaluate(() => { try { Browser.hide ? Browser.hide() : 0; } catch (e) {} }); await sleep(300);
    // Ctrl+click → system browser
    await win.keyboard.down('Control'); await win.mouse.click(a.x, a.y); await win.keyboard.up('Control'); await sleep(500);
    const ext = await app.evaluate(() => global.__ext.slice());
    ok(ext.length === 1 && /\/pigi$/.test(ext[0]) && (await win.evaluate(() => Links.last.where)) === 'external', 'Ctrl+click → «normal browser» (shell.openExternal)', ext);
    // context menu
    await win.mouse.click(a.x, a.y, { button: 'right' }); await sleep(300);
    const menu = await win.evaluate(() => [...document.querySelectorAll('#ctxmenu > *')].map((b) => b.textContent.trim()).filter(Boolean));
    ok(menu.some((x) => /Άνοιγμα στον κανονικό browser/.test(x)) && menu.some((x) => /καρτέλα του Nyx/i.test(x)), 'right click → «Άνοιγμα στον κανονικό browser» / Nyx browser', menu);
    await win.evaluate(() => { const b = [...document.querySelectorAll('#ctxmenu > *')].find((x) => /κανονικό browser/.test(x.textContent)); b && b.click(); }); await sleep(300);
    ok((await app.evaluate(() => global.__ext.length)) === 2 && (await win.evaluate(() => Links.last.where)) === 'external', 'menu → system browser');
    // javascript: link does nothing
    const bad = await rect(win, id, 'a[href^="javascript"]'); const t0 = await win.evaluate(() => Browser.tabs.length); const x0 = await app.evaluate(() => global.__ext.length);
    if (bad) { await win.mouse.click(bad.x, bad.y); await sleep(400); }
    ok(!bad || ((await win.evaluate(() => Browser.tabs.length)) === t0 && (await app.evaluate(() => global.__ext.length)) === x0), 'a non-http(s) link opens nothing', { bad: !!bad });
    // while editing, a link is plain text
    await win.evaluate((id) => Canvas.edit(id), id); await sleep(200);
    const ea = await rect(win, id, 'a[href^="http"]'); const t1 = await win.evaluate(() => Browser.tabs.length);
    if (ea) { await win.mouse.click(ea.x, ea.y); await sleep(400); }
    ok((await win.evaluate(() => Browser.tabs.length)) === t1 && (await win.evaluate(() => Canvas.editing)) === id, 'while editing the card, a click on the link only places the caret');
    await win.evaluate(() => Canvas.endEdit()); await win.evaluate(() => { try { Browser.hide ? Browser.hide() : 0; } catch (e) {} });
  }
  // ---- 9) MCP: look fields, errors, kept_timeout ----
  {
    const r = await win.evaluate(async () => {
      const c = await McpBoard.run('create_card', { kind: 'note', text: 'Hermes', w: 420, h: 260, font: 'Caveat', font_size: 30, color: 'blue', text_color: '#112233', style: 'lined', align: 'center' });
      const it = JSON.parse(JSON.stringify(Store.get(c.id)));
      const s = await McpBoard.run('create_card', { kind: 'shape', text: 'αστέρι', shape: 'star', fill: '#ffcc00', color: '#ff0000', w: 300, h: 300 });
      const sh = Store.get(s.id); const n = Store.items().length;
      let e1 = null; try { await McpBoard.run('create_card', { kind: 'note', text: 'x', w: 9000 }); } catch (e) { e1 = e.message; }
      let e2 = null; try { await McpBoard.run('update_card', { id: c.id, font: 'Comic Sans' }); } catch (e) { e2 = e.message; }
      const n2 = Store.items().length;
      const u = await McpBoard.run('update_card', { id: c.id, w: 500, font_size: 18 });
      const itc = JSON.parse(JSON.stringify(it));
      return { c, it0: itc, it: { w: it.w, h: it.h, font: it.font, size: it.size, color: it.color, tc: it.textColor || it.tc || it.fg, paper: it.paperKind, align: it.align }, sh: { type: sh.type, shape: sh.shape, fill: sh.fill, w: sh.w }, e1, e2, n, n2, u, it2: { w: Store.get(c.id).w, size: Store.get(c.id).size } };
    });
    ok(r.it.w === 420 && r.it.h === 260 && r.it.font === 'Caveat' && r.it.size === 30 && r.it.paper === 'lined' && r.it.align === 'center' && r.it.color === '#112233' && r.it0.paper === '#8fd3ff', 'create_card with w/h/font/font_size/color/text_color/style/align', r.it);
    ok(r.sh.type === 'shape' && r.sh.shape === 'star' && r.sh.fill === '#ffcc00' && r.sh.w === 300, 'create_card kind shape (star, fill)', r.sh);
    ok(/\bw\b.*40.*3000.*9000/.test(r.e1 || '') && /font.*Inter.*Caveat.*Comic Sans/.test(r.e2 || ''), 'out of range / not allowed → clear error', { e1: r.e1, e2: r.e2 });
    ok(r.n === r.n2 && r.it2.w === 500 && r.it2.size === 18, 'errors change nothing; update_card w/font_size applied', r);
    // kept_timeout: a batch fails, the rollback question gets no answer
    const k = await win.evaluate(async () => {
      const n0 = Store.items().length;
      const res = await McpBoard.run('batch', { actions: [{ tool: 'create_card', args: { kind: 'note', text: 'batch νέα' } }, { tool: 'update_card', args: { id: 'nope-404', text: 'x' } }] }, { limits: { deleteConfirmMs: 700 } });
      await new Promise((r) => setTimeout(r, 450));
      return { res, n0, n1: Store.items().length, modal: !document.querySelector('#modal').hidden, still: Store.items().some((i) => (i.html || '').includes('batch νέα')), top: Store.undoStack.length };
    });
    ok(k.res && k.res.ok === false && k.res.rollback === 'kept_timeout' && k.res.rolled_back === false && /απάντηση|no answer/i.test(k.res.note || '') && /0\.7 (δευτερόλεπτα|seconds)/.test(k.res.note || ''), 'batch fails + no answer → rollback: kept_timeout, the response says so', k.res);
    ok(k.still && k.n1 === k.n0 + 1 && !k.modal, '… nothing changed (the new card stays), the question is closed', k);
    // explicit OK → rolled_back
    const o = await win.evaluate(async () => {
      const p = McpBoard.run('batch', { actions: [{ tool: 'create_card', args: { kind: 'note', text: 'batch δεύτερη' } }, { tool: 'update_card', args: { id: 'nope-404', text: 'x' } }] }, { limits: { deleteConfirmMs: 20000 } });
      for (let i = 0; i < 40 && !document.querySelector('#modal:not([hidden]) [data-restore-confirm]'); i++) await new Promise((r) => setTimeout(r, 50));
      const q = !!document.querySelector('#modal:not([hidden]) [data-restore-confirm]'); document.querySelector('#modal .btn.primary').click();
      const res = await p; return { q, res, gone: !Store.items().some((i) => (i.html || '').includes('batch δεύτερη')) };
    });
    ok(o.q && o.res.rollback === 'rolled_back' && o.gone, 'with an explicit OK → rolled_back (the only way cards are removed)', o);
    const d = await win.evaluate(async () => { const n0 = Store.items().length; let r; try { r = await McpBoard.run('delete_cards', { ids: [Store.items()[0].id] }, { limits: { deleteConfirmMs: 500 } }); } catch (e) { r = { err: e.message }; } return { r, n0, n1: Store.items().length }; });
    ok(d.n1 === d.n0, 'delete_cards with no answer → nothing deleted', d);
    await closeModal(win);
  }
  await quit(app);
  console.log(`\nv2.6.10 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
