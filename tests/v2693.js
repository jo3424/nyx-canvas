'use strict';
// v2.6.9.3 UI (Electron, Chromium sandbox on): real keyboard Ctrl+Z (global and in the assistant field) after
// 7 subscriptions + 7 cards, the confirmation, «only subscriptions» from a snapshot with boards unchanged,
// snapshot subscription counts, the subscriptions redesign (monthly vs yearly in another month), save-time warning.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2693-'));
let fails = 0, passes = 0;
const T0 = Date.now(); const ok = (c, m, x) => { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true || window.__nyxV25Ready === true, null, { timeout: 30000 });
  await win.waitForTimeout(500);
  return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const counts = (win) => win.evaluate(() => ({ subs: Store.state.subs.length, cards: Store.state.boards.reduce((a, b) => a + b.items.length, 0), modal: !document.querySelector('#modal').hidden, confirm: !!document.querySelector('[data-restore-confirm]') && !document.querySelector('#modal').hidden, stack: Store.undoStack.length }));
async function closeModal(win) { await win.evaluate(() => { if (!document.querySelector('#modal').hidden) document.querySelector('#modal-close').click(); }); await sleep(300); }

(async () => {
  const { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(['2.6.9.3', '2.6.10', '2.6.10.1', '2.6.11', '2.6.11.1', '2.6.12', '2.6.12.1', '2.6.12.2', '2.6.13', '2.6.13.1', '2.7.0', '2.7.1'].includes(String(ver)), 'app version 2.6.9.3', ver);
  // start: 1 subscription (as on your PC: Netflix), an empty board
  await win.evaluate(() => {
    Store.state.subs = [{ id: 'keep0', name: 'Netflix', price: 13.99, currency: 'EUR', cycle: 'monthly', next: '2026-11-20', active: true, remindDays: 2, color: '#e50914', icon: '🎬' }];
    for (const b of Store.state.boards) b.items = [];
    Store.undoStack.length = 0; Store.redoStack.length = 0; Store.save(true);
    try { Assistant.hide(); } catch (e) {}
  });
  // 7 subscriptions (the same path as the subscription form) interleaved with 7 cards (the same path as «new note»)
  await win.evaluate(() => {
    for (let i = 1; i <= 7; i++) {
      const s = { id: 'sub' + i, name: ['Hostinger', 'Cosmote', 'claude', 'Spotify', 'YouTube', 'iCloud', 'Disney+'][i - 1], price: 5 + i, currency: 'EUR', cycle: 'monthly', next: '2026-11-2' + i, active: true, remindDays: 2, color: '#7c8cff', icon: '💳' };
      Store.change(() => { Store.state.subs.push(s); });
      Features.addAtCenter({ type: 'sticky', html: 'κάρτα ' + i, w: 200, h: 120 });
    }
  });
  let c0 = await counts(win);
  ok(c0.subs === 8 && c0.cards === 7 && c0.stack === 14, '7 subscriptions + 7 cards → 8 subs, 7 cards, 14 undo steps', c0);

  // A) 14× real Ctrl+Z inside the EMPTY assistant field → nothing on the canvas or in subscriptions changes
  await win.evaluate(() => { Assistant.show(); const q = document.querySelector('#as-q'); q.value = ''; q.focus(); });
  await sleep(300);
  for (let i = 0; i < 14; i++) { await win.keyboard.press('Control+z'); await sleep(40); }
  await sleep(300);
  let c1 = await counts(win);
  ok(c1.subs === 8 && c1.cards === 7 && c1.stack === 14 && !c1.modal, '14× Ctrl+Z in the assistant field: 8 subs, 7 cards, nothing undone, no dialog', c1);

  // B) 14× real Ctrl+Z on the canvas → 1 card undone, then the confirmation stops at the first subscription
  await win.evaluate(() => { Assistant.hide(); document.activeElement && document.activeElement.blur(); Canvas.deselect?.(); document.querySelector('#viewport').focus(); });
  await sleep(200);
  for (let i = 0; i < 14; i++) { await win.keyboard.press('Control+z'); await sleep(60); }
  await sleep(400);
  let c2 = await counts(win);
  const txt = await win.evaluate(() => document.querySelector('[data-restore-confirm]')?.innerText || '');
  ok(c2.subs === 8 && c2.cards === 6 && c2.confirm, '14× global Ctrl+Z: 1 card undone, then a visible confirmation — all 8 subscriptions still there', c2);
  ok(/Συνδρομές: αφαιρούνται 1, αλλάζουν 0, προστίθενται 0 — Disney\+/.test(txt) && /Κάρτες: αφαιρούνται 0, αλλάζουν 0, προστίθενται 0/.test(txt), 'the confirmation states how many subscriptions (named) and cards change', txt);
  await closeModal(win); // declined
  for (let i = 0; i < 6; i++) { await win.keyboard.press('Control+z'); await sleep(60); if ((await counts(win)).confirm) await closeModal(win); }
  let c3 = await counts(win);
  ok(c3.subs === 8 && c3.cards === 6, 'declined each time: subscriptions never removed silently (8)', c3);
  // accept once → only that one subscription goes
  await win.keyboard.press('Control+z'); await sleep(300);
  await win.evaluate(() => document.querySelector('#modal .btn.primary')?.click()); await sleep(300);
  let c4 = await counts(win);
  const ids = await win.evaluate(() => Store.state.subs.map((s) => s.id));
  ok(c4.subs === 7 && !ids.includes('sub7') && ids.includes('keep0') && ids.includes('sub1'), 'confirmed: only Disney+ (the last added) removed; the other 7 stay', ids);
  await win.keyboard.press('Control+y'); await sleep(300);
  if ((await counts(win)).confirm) { await win.evaluate(() => document.querySelector('#modal .btn.primary')?.click()); await sleep(300); }
  ok((await counts(win)).subs === 8, 'Ctrl+Y brings it back (with the same confirmation)');

  // C) assistant add_subscription has its own undo entry (no silent loss on the next Ctrl+Z)
  const n0 = await win.evaluate(() => Store.undoStack.length);
  await win.evaluate(async () => { await Cmd.T.add_subscription.run({ name: 'Nova', price: 9.9, cycle: 'monthly', next: '2026-11-30' }); });
  const lab = await win.evaluate(() => Store.lastUndoLabel());
  ok((await win.evaluate(() => Store.undoStack.length)) === n0 + 1 && /Nova/.test(lab), 'assistant add_subscription → one undo entry «Συνδρομή: Nova»', lab);
  await win.evaluate(() => Features.addAtCenter({ type: 'sticky', html: 'μετά τη Nova', w: 200, h: 120 }));
  await win.keyboard.press('Control+z'); await sleep(300);
  ok((await counts(win)).subs === 9 && !(await counts(win)).confirm, 'the next Ctrl+Z undoes the card only; Nova stays', await counts(win));

  // D) snapshot with 3 subs → lose 2 → «Μόνο συνδρομές» brings them back, boards identical; list shows counts
  await win.evaluate(async () => {
    Store.change(() => { Store.state.subs.splice(0, Store.state.subs.length, { id: 'h', name: 'Hostinger', price: 89, currency: 'EUR', cycle: 'yearly', next: '2027-03-05', active: true }, { id: 'c', name: 'Cosmote', price: 22.61, currency: 'EUR', cycle: 'monthly', next: '2026-11-28', active: true }, { id: 'cl', name: 'claude', price: 18, currency: 'EUR', cycle: 'monthly', next: '2026-11-25', active: true }); });
    await Store.save(true); await API.inv('snap:create', 'three-subs');
  });
  await sleep(1100);
  await win.evaluate(async () => { Store.change(() => { Store.state.subs.splice(0, 2); }); await Store.save(true); });
  await sleep(500);
  const warn = await win.evaluate(() => ({ drop: Store.lastSubsDrop, toasts: [...document.querySelectorAll('.toast')].map((x) => x.innerText).join(' | ') }));
  ok(warn.drop && warn.drop.n === 2 && /pre-subs-drop/.test(warn.drop.snap || '') && /αφαιρεί 2 συνδρομές: Hostinger, Cosmote/.test(warn.toasts), 'save that drops 2 subscriptions → visible warning with names + snapshot «pre-subs-drop»', warn);
  await win.evaluate(() => { for (const b of Store.state.boards) b.items.push({ id: 'z' + b.id, type: 'sticky', html: 'σταθερή', x: 0, y: 0, w: 100, h: 80, z: 1 }); Store.save(); });
  const boardsBefore = await win.evaluate(() => JSON.stringify(Store.state.boards));
  await win.evaluate(() => { void Extras.snapshots(); }); await sleep(1200);
  const list = await win.evaluate(() => [...document.querySelectorAll('[data-snap]')].map((e) => ({ name: e.getAttribute('data-snap'), subs: e.getAttribute('data-subs'), txt: e.innerText })));
  const three = list.find((x) => /three-subs/.test(x.name));
  ok(three && three.subs === '3' && /3 συνδρομές/.test(three.txt) && list.some((x) => /pre-subs-drop/.test(x.name) && x.subs === '3'), 'Ιστορικό: each snapshot shows its subscription count (three-subs = 3, pre-subs-drop = 3)', list);
  await win.evaluate((n) => document.querySelector(`[data-snap="${n}"] [data-act=snap-subs-only]`).click(), three.name); await sleep(900);
  const imp = await win.evaluate(() => { const b = document.querySelector('[data-subs-import]'); return b ? { add: b.getAttribute('data-add'), differ: b.getAttribute('data-differ'), txt: b.innerText } : null; });
  ok(imp && imp.add === '2' && imp.differ === '0' && /Hostinger/.test(imp.txt) && /Cosmote/.test(imp.txt), '«Μόνο συνδρομές» shows the 2 missing (Hostinger, Cosmote)', imp);
  await win.evaluate(() => document.querySelector('#modal .btn.primary').click()); await sleep(400);
  const after = await win.evaluate(() => ({ subs: Store.state.subs.map((s) => s.name).sort(), boards: JSON.stringify(Store.state.boards) }));
  ok(after.subs.join() === 'Cosmote,Hostinger,claude', 'subscriptions back: Hostinger, Cosmote, claude', after.subs);
  ok(after.boards === boardsBefore, 'boards and cards identical (byte for byte) after the import');
  // a differing one is listed for choice, not overwritten
  await win.evaluate(() => { Store.change(() => { Store.state.subs.find((s) => s.id === 'c').price = 25; }); });
  await win.evaluate((n) => { Panels.drawerKind = null; void Extras.restoreSubs({ name: n }); }, three.name);
  await sleep(700);
  const imp2 = await win.evaluate(() => { const b = document.querySelector('[data-subs-import]'); return b ? { add: b.getAttribute('data-add'), differ: b.getAttribute('data-differ'), cb: document.querySelectorAll('[data-differ="c"]').length } : null; });
  ok(imp2 && imp2.add === '0' && imp2.differ === '1' && imp2.cb === 1, 'a subscription that differs (Cosmote 25 € vs 22,61 €) is listed with a checkbox', imp2);
  await win.evaluate(() => document.querySelector('#modal .btn.primary').click()); await sleep(300);
  ok((await win.evaluate(() => Store.state.subs.find((s) => s.id === 'c').price)) === 25, 'not ticked → the current value stays');
  // full snapshot restore confirmation shows the counts
  await win.evaluate((n) => { void Extras.restore({ name: n }); }, three.name); await sleep(800);
  const rc = await win.evaluate(() => document.querySelector('[data-restore-confirm]')?.innerText || '');
  ok(/Συνδρομές: αφαιρούνται \d+, αλλάζουν \d+/.test(rc) && /Κάρτες: αφαιρούνται \d+/.test(rc), 'snapshot «Επαναφορά» confirmation states subscriptions and cards', rc);
  await closeModal(win);

  // E) redesign: 1 monthly this month + 1 yearly in another month
  const mm = await win.evaluate(() => { const w = NyxCalc.wallNow(); const p = (n) => String(n).padStart(2, '0'); const last = new Date(Date.UTC(w.y, w.m, 0)).getUTCDate(); const dm = Math.min(last, Math.max(w.d, 28)); const ym = w.m === 3 ? 4 : 3; const yy = ym > w.m ? w.y : w.y + 1;
    Store.change(() => { Store.state.subs.splice(0, Store.state.subs.length, { id: 'm1', name: 'Μηνιαία', price: 13.99, currency: 'EUR', cycle: 'monthly', next: `${w.y}-${p(w.m)}-${p(dm)}`, active: true, icon: 'M' }, { id: 'y1', name: 'Ετήσια', price: 89, currency: 'EUR', cycle: 'yearly', next: `${yy}-${p(ym)}-05`, active: true, icon: 'Y' }); });
    Panels.drawerKind = null; Panels.subs(); return true; });
  await sleep(600);
  const sx = await win.evaluate(() => { const g = (a) => document.querySelector(`[${a}]`)?.getAttribute(a); const rows = [...document.querySelectorAll('[data-subx-it]')].map((e) => ({ id: e.getAttribute('data-subx-it'), txt: e.innerText })); return { month: g('data-subx-month'), avg: g('data-subx-avg'), year: g('data-subx-year'), active: g('data-subx-active'), hero: document.querySelector('.subx-hero')?.textContent, rows }; });
  ok(sx.month === '13.99' && /Αυτόν τον μήνα/i.test(sx.hero) && /13,99 €/.test(sx.hero), '«Αυτόν τον μήνα» = only the monthly (13,99 €), the yearly in another month is not counted', sx);
  ok(sx.year === '256.88' && sx.avg === '21.41' && sx.active === '2', 'μέσος/μήνα 21,41 € · τον χρόνο 256,88 € · ενεργές 2', sx);
  ok(sx.rows.length === 2 && sx.rows[0].id === 'm1' && /όχι αυτόν τον μήνα/.test(sx.rows[1].txt) && /ετήσια/i.test(sx.rows[1].txt), '«Επόμενες χρεώσεις»: monthly first with its date, yearly marked «όχι αυτόν τον μήνα»', sx.rows);
  // calendar (widget) still gets the subscriptions with their next date
  const wst = await win.evaluate(() => Store.state.subs.filter((s) => s.next).length);
  ok(wst === 2, 'subscription data unchanged in shape (next date kept) → widget calendar keeps working', wst);
  // canvas card uses the same summary
  await win.evaluate(() => { Subs.toCanvas(); }); await sleep(500);
  const cardTxt = await win.evaluate(() => document.querySelector('.subx-card')?.innerText || '');
  ok(/Αυτόν τον μήνα/i.test(cardTxt) && /13,99 €/.test(cardTxt) && /όχι αυτόν τον μήνα/.test(cardTxt), 'canvas card shows the same «Αυτόν τον μήνα» and upcoming charges', cardTxt);

  // F) existing data loads unchanged after a restart
  await win.evaluate(() => Store.save(true)); await sleep(400);
  const before = await win.evaluate(() => JSON.stringify({ subs: Store.state.subs, boards: Store.state.boards.map((b) => ({ id: b.id, n: b.items.length })) }));
  await quit(app);
  const r2 = await launch();
  const after2 = await r2.win.evaluate(() => JSON.stringify({ subs: Store.state.subs, boards: Store.state.boards.map((b) => ({ id: b.id, n: b.items.length })) }));
  ok(after2 === before, 'after restart: subscriptions and boards load exactly as saved (no migration)');
  await quit(r2.app);
  console.log(`\nv2.6.9.3 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
