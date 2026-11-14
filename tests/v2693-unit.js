'use strict';
// v2.6.9.3 unit tests: change-based undo (never a whole subscription list), protected subscriptions, MCP-style
// restore by changes, «only subscriptions» merge, save-time drop warning, subscriptions summary by code.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = path.join(__dirname, '..');
const U = require('../app/js/v26/undo.js');
const C = require('../app/js/v26/calc.js');
const el = require('../app/locales/el.json');
const en = require('../app/locales/en.json');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 800) : '')); c ? passes++ : fails++; };
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

function loadStore() {
  const toasts = [], snaps = [];
  const sb = { console, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, Map, Set, Promise, setTimeout, clearTimeout,
    t: (k, v) => { let s = el[k] || k; for (const [a, b] of Object.entries(v || {})) s = s.split('{' + a + '}').join(String(b)); return s; },
    uid: (() => { let n = 0; return () => 'u' + (++n); })(), toast: (m) => toasts.push(m), structuredClone: (x) => JSON.parse(JSON.stringify(x)),
    API: { save: async () => {}, inv: async (ch, label) => { if (ch === 'snap:create') { snaps.push(label); return 'snap-x-' + label + '.json'; } } },
    document: { body: { classList: { add() {}, remove() {} } } }, localStorage: { getItem: () => null, setItem() {} } };
  sb.window = sb; sb.addEventListener = () => {}; sb.window.addEventListener = () => {};
  vm.createContext(sb);
  vm.runInContext(read('app/js/v26/undo.js') + '\n' + read('app/js/store.js') + '\nthis.Store = Store;', sb);
  const S = sb.Store;
  S.state = { v: 1, boards: [{ id: 'b1', name: 'Α', items: [], view: { x: 0, y: 0, z: 1 } }, { id: 'b2', name: 'Β', items: [], view: { x: 0, y: 0, z: 1 } }], active: 'b1', subs: [{ id: 's0', name: 'Netflix', price: 13.99, cycle: 'monthly', next: '2026-11-20' }], agenda: [], settings: {} };
  S.savedSubIds = ['s0']; S.rememberSubNames();
  return { S, toasts, snaps, sb };
}
const card = (S, n) => S.change(() => S.addItem({ type: 'sticky', html: 'κάρτα ' + n, x: n * 10, y: 0, w: 200, h: 120 }));
const sub = (S, n) => S.change(() => { S.state.subs.push({ id: 'sub' + n, name: 'Συνδρομή ' + n, price: 5 + n, cycle: 'monthly', next: '2026-11-2' + (n % 9) }); });

(async () => {
  // ---- 1) 7 subs + 7 cards interleaved, 14× undo: Ctrl+Z asks before touching a subscription ----
  {
    const { S } = loadStore();
    for (let i = 1; i <= 7; i++) { sub(S, i); card(S, i); }
    ok(S.state.subs.length === 8 && S.undoStack.length === 14, '7 subs + 7 cards → 14 undo entries', { subs: S.state.subs.length, st: S.undoStack.length });
    ok(S.undoStack.every((e) => e.ch && !('snap' in e)), 'entries keep only the changes (no whole-state copy)');
    const e0 = S.undoStack[S.undoStack.length - 1]; ok(e0.ch.items.length === 1 && e0.ch.subs.length === 0, 'a card action holds one card change and no subscription list', e0.ch);
    const e1 = S.undoStack[S.undoStack.length - 2]; ok(e1.ch.subs.length === 1 && e1.ch.subs[0].id === 'sub7' && e1.ch.items.length === 0, 'a subscription action holds only that subscription', e1.ch);
    // what App.history does: peek → if subscriptions would change, a confirmation (here: declined) → nothing applied
    let asked = 0, applied = 0;
    for (let k = 0; k < 14; k++) { const p = S.peekUndo(); if (p && p.subsTouched > 0) { asked++; break; } if (S.undo()) applied++; }
    ok(applied === 1 && asked === 1 && S.state.subs.length === 8, '14× Ctrl+Z (declined): 1 card undone, then the confirmation stops it — 8 subscriptions remain', { applied, asked, subs: S.state.subs.length });
    const p = S.peekUndo(); ok(p.subs.remove === 1 && p.subs.names[0] === 'Συνδρομή 7' && p.cards.remove === 0, 'the confirmation counts: 1 subscription (named), 0 cards', p);
    S.undo(); ok(S.state.subs.length === 7 && !S.state.subs.some((s) => s.id === 'sub7') && S.state.subs.some((s) => s.id === 's0'), 'confirmed: only that ONE subscription goes, the others stay', S.state.subs.map((s) => s.id));
    S.redo(); ok(S.state.subs.length === 8 && S.state.subs[S.state.subs.length - 1].id === 'sub7', 'redo puts it back');
  }
  // ---- 2) 7 subs first, then 7 cards: 7 card undos, subscriptions untouched ----
  {
    const { S } = loadStore();
    for (let i = 1; i <= 7; i++) sub(S, i); for (let i = 1; i <= 7; i++) card(S, i);
    let applied = 0; for (let k = 0; k < 14; k++) { const p = S.peekUndo(); if (p && p.subsTouched > 0) break; if (S.undo()) applied++; }
    ok(applied === 7 && S.state.subs.length === 8 && S.state.boards[0].items.length === 0, 'cards undone one by one (7), all 8 subscriptions remain', { applied, subs: S.state.subs.length });
  }
  // ---- 3) the 2.6.9.1 loss: subscription added outside the history, then undo of an older card ----
  {
    const { S } = loadStore();
    card(S, 1); S.state.subs.push({ id: 'late', name: 'Hostinger', price: 89, cycle: 'yearly', next: '2027-03-05' });
    S.undo(); ok(S.state.subs.length === 2 && S.state.subs.some((s) => s.id === 'late') && S.state.boards[0].items.length === 0, 'undo of a card never touches subscriptions added later (was: state.subs = s.subs)', S.state.subs.map((s) => s.id));
    const legacy = read('app/js/store.js'); ok(!/state\.subs\s*=\s*s\.subs/.test(legacy) && !/this\.state\.subs\s*=/.test(legacy), 'store.js has no whole-list subscription assignment');
    ok(!/Store\.state\.subs\s*=\s*s\.subs/.test(read('app/js/v25/agent.js')), 'agent undo has no whole-list subscription assignment');
    ok(!/Store\.state\.subs\s*=\s*Store\.state\.subs\.filter/.test(read('app/js/features.js')), 'subscription delete removes one entry (no list replace)');
  }
  // ---- 4) protected subscription: changed after the action → skipped, reported ----
  {
    const { S } = loadStore();
    S.change(() => { S.state.subs[0].price = 15.99; });
    S.state.subs[0].price = 17.99; // changed later outside the history
    const p = S.peekUndo(); ok(p.subs.skip === 1 && p.subsTouched === 0, 'a subscription changed later is not overwritten (counted as skipped)', p.subs);
    S.undo(); ok(S.state.subs[0].price === 17.99 && S.lastApply.skippedSubs.length === 1, 'undo keeps the later value 17,99', S.state.subs[0]);
  }
  // ---- 5) restore by changes (MCP batch rollback / agent undo): only what the batch changed ----
  {
    const { S } = loadStore();
    card(S, 1); const keep = S.state.boards[0].items[0];
    const snap = S.snap();
    S.state.boards[0].items[0].html = 'αλλαγή batch'; S.addItem({ type: 'sticky', html: 'νέα batch', x: 0, y: 0, w: 200, h: 120 });
    S.state.subs.push({ id: 'during', name: 'Cosmote', price: 22.61, cycle: 'monthly', next: '2026-11-28' }); // e.g. added by you meanwhile
    const plan = S.restorePlan(snap);
    ok(plan.sum.cards.change === 1 && plan.sum.cards.remove === 1 && plan.sum.subs.remove === 1, 'restore plan counts cards and subscriptions (shown in the confirmation)', plan.sum);
    S.restore(snap);
    ok(keep && S.state.boards[0].items.length === 1 && S.state.boards[0].items[0].html === 'κάρτα 1', 'cards back to the picture (edit undone, new card removed)', S.state.boards[0].items);
    ok(S.state.subs.length === 1, 'without the subs option a full picture restore also counts/reverts subscriptions (shown first)');
    card(S, 2); const snap2 = S.snap(); S.addItem({ type: 'sticky', html: 'batch', x: 0, y: 0, w: 200, h: 120 }); S.state.subs.push({ id: 'during2', name: 'Cosmote', price: 22.61 });
    const plan2 = S.restorePlan(snap2, { subs: false }); S.restore(snap2, { subs: false });
    ok(plan2.sum.subs.remove === 0 && S.state.subs.some((s) => s.id === 'during2') && S.state.boards[0].items.length === 2, 'MCP rollback (subs:false): the batch card goes, a subscription added meanwhile stays', { sum: plan2.sum.subs, subs: S.state.subs.map((s) => s.id) });
    ok(S.state.boards[1].items.length === 0 && S.state.boards.length === 2, 'other boards untouched');
  }
  // ---- 6) board removal / re-add through undo ----
  {
    const { S } = loadStore();
    card(S, 1);
    S.change(() => { S.state.boards.splice(0, 1); S.state.active = 'b2'; });
    ok(S.state.boards.length === 1, 'board deleted');
    S.undo(); ok(S.state.boards.length === 2 && S.state.boards[0].id === 'b1' && S.state.boards[0].items.length === 1 && S.state.active === 'b1', 'undo brings the board back with its card, in its place', S.state.boards.map((b) => [b.id, b.items.length]));
    S.change(() => { S.state.boards.push({ id: 'b3', name: 'Γ', items: [] }); });
    S.state.boards[2].items.push({ id: 'x9', type: 'sticky' }); // a card added there outside the history
    S.undo(); ok(S.state.boards.some((b) => b.id === 'b3') && S.lastApply.keptBoards[0] === 'b3', 'a new board that holds other cards now is not deleted by undo', S.lastApply);
  }
  // ---- 7) only subscriptions merge ----
  {
    const cur = [{ id: 'a', name: 'Netflix', price: 13.99 }, { id: 'b', name: 'Cosmote', price: 22.61 }];
    const src = [{ id: 'a', name: 'Netflix', price: 13.99 }, { id: 'b', name: 'Cosmote', price: 20 }, { id: 'c', name: 'Hostinger', price: 89 }, { id: 'd', name: 'claude', price: 18 }];
    const m = U.subsMerge(cur, src);
    ok(m.add.map((x) => x.id).join() === 'c,d' && m.differ.length === 1 && m.differ[0].id === 'b' && m.same.join() === 'a', 'by id: 2 missing added, 1 different listed for choice, 1 identical skipped', m);
  }
  // ---- 8) save-time warning when one save drops ≥ 2 subscriptions ----
  {
    const { S, toasts, snaps } = loadStore();
    sub(S, 1); sub(S, 2); await S.save(true);
    S.state.subs.splice(1, 2); await S.save(true);
    ok(snaps.includes('pre-subs-drop') && toasts.some((m) => /αφαιρεί 2 συνδρομές: Συνδρομή 1, Συνδρομή 2/.test(m)), 'save that drops 2 subscriptions → snapshot «pre-subs-drop» + visible warning with names', { toasts, snaps });
    const n = toasts.length; S.state.subs.splice(0, 1); await S.save(true);
    ok(toasts.length === n, 'dropping 1 (a normal delete) does not warn');
  }
  // ---- 9) subscriptions summary (code, not the LLM) ----
  {
    const now = new Date('2026-11-14T15:00:00Z');
    const r = C.subsSummary([{ id: 'm', name: 'Netflix', price: 13.99, cycle: 'monthly', next: '2026-11-20' }, { id: 'y', name: 'Hostinger', price: 89, cycle: 'yearly', next: '2027-03-05' }], { now });
    ok(r.total === 13.99 && r.totalText === '13,99 €' && r.charges.length === 1, '1 monthly + 1 yearly in March: «Αυτόν τον μήνα» = only the monthly (13,99 €)', r);
    ok(r.avgText === '21,41 €' && r.yearText === '256,88 €' && r.active === 2, 'μέσος/μήνα 21,41 € (= 256,88 / 12 στρογγυλεμένο στο λεπτό), τον χρόνο 256,88 €, ενεργές 2', { avg: r.avgText, year: r.yearText });
    const up = r.upcoming; ok(up[0].id === 'm' && up[0].dm === '20/11' && up[0].days === 6 && up[0].inMonth && up[1].id === 'y' && !up[1].inMonth && up[1].monthName === 'Μάρτιος', '«Επόμενες χρεώσεις»: Netflix 20/11 (σε 6 μέρες), Hostinger Μάρτιος — όχι αυτόν τον μήνα', up);
    const r2 = C.subsSummary([{ id: 'm', name: 'A', price: '59,80', cycle: 'monthly', next: '2026-12-03' }, { id: 'n', name: 'B', price: 36.6, cycle: 'monthly', next: '2026-11-25' }, { id: 'y', name: 'C', price: 120, cycle: 'yearly', next: '2026-11-02' }], { now });
    ok(r2.totalText === '216,40 €' && r2.paidText === '179,80 €' && r2.dueText === '36,60 €' && Math.abs(r2.pct - 179.8 / 216.4) < 1e-9, 'paid = before today or already moved past (A on 03/11, C yearly on 02/11), remaining = B 36,60 € (exact cents)', { t: r2.totalText, p: r2.paidText, d: r2.dueText });
    const w = C.subsSummary([{ id: 'w', name: 'W', price: 2, cycle: 'weekly', next: '2026-11-20' }], { now });
    ok(w.charges.length === 4 && w.total === 8 && w.paid === 4, 'weekly: 4 charges in November (06, 13 paid · 20, 27 due)', w.charges);
    const q = C.subsSummary([{ id: 'q', name: 'Q', price: 30, cycle: 'quarterly', next: '2027-01-31' }], { now: new Date('2026-10-14T10:00:00Z') });
    ok(q.charges.length === 1 && q.charges[0].date === '2026-10-31', 'quarterly: only in its months (31/10 from 31/01)', q.charges);
    const e = C.subsSummary([{ id: 'x', name: 'X', price: 5, cycle: 'monthly', next: '' }, { id: 'o', name: 'Off', price: 9, active: false, next: '2026-11-20' }], { now });
    ok(e.total === 0 && e.noDate[0] === 'X' && e.active === 1 && e.avgText === '5,00 €', 'no date → not in the month (listed); inactive not counted');
    const fe = read('app/js/features.js'); ok(/NyxCalc\.subsSummary/.test(fe) && /data-subx-month/.test(fe), 'drawer and canvas card use NyxCalc.subsSummary');
  }
  // ---- 10) wiring ----
  const as = read('app/js/v2/assistant.js');
  ok(!/return App\.undo\(\); \} e\.stopPropagation\(\);/.test(as) && /Ctrl\+Z here is the text field's own undo only/.test(as), 'Ctrl+Z in the assistant field never calls the canvas undo');
  ok(/Store\.change\(\(\) => \{ Store\.state\.subs\.push\(s\); \}/.test(as), 'add_subscription from the assistant has an undo entry');
  ok(/Features\.confirmChanges\(/.test(read('app/js/v25/agent.js')) && /Features\.confirmChanges\(/.test(read('app/js/v2/mcp-board.js')) && /Features\.restoreLines\(/.test(read('app/js/v2/extras.js')) && /Features\.confirmChanges\(/.test(read('app/js/app.js')), 'visible confirmation: Ctrl+Z (subs), assistant undo-all, MCP rollback, snapshot restore');
  ok(/snapCounts/.test(read('main/v2.js')) && /data-act': 'snap-subs-only'/.test(read('app/js/v2/extras.js')) && /import-subs-only/.test(read('app/js/features.js')), 'snapshot list shows subscription counts; «Μόνο συνδρομές» from snapshot and backup');
  ok(/js\/v26\/undo\.js/.test(read('app/index.html')), 'undo.js loaded right after store.js');
  const ks = Object.keys(el).filter((k) => k.startsWith('v2693.'));
  ok(ks.length >= 40 && ks.every((k) => en[k]), 'el/en strings', ks.length);
  const pkg = require('../package.json');
  ok(pkg.version === '2.6.9.3' && pkg.devDependencies.electron === '45.2.3', 'version 2.6.9.3, Electron 45.2.3', pkg.version);
  const CH = require('../CHANGELOG.json'); ok(Object.keys(CH)[0] === '2.6.9.3' && CH['2.6.9.3'].el.length === 3 && CH['2.6.9.3'].en.length === 3, 'CHANGELOG 2.6.9.3 first, 3 items');
  console.log(`\nv2.6.9.3 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
