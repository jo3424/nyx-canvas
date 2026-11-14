'use strict';
// v2.6.9.3 — change-based undo. An undo entry keeps only WHAT one action changed (per card, per board, per
// subscription, per agenda note, keyed by id), never a copy of a whole list. Undo/redo apply those changes to the
// CURRENT state, so anything changed later by something else stays as it is (no more «state.subs = s.subs»).
// Subscriptions are protected: a subscription that was changed after the action is skipped and reported, never
// overwritten. Pure functions: the renderer uses window.NyxUndo, the unit tests require() this file.
(function (root) {
  const J = (v) => (v === undefined ? undefined : JSON.stringify(v));
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const BOARD_META = ['name', 'emoji', 'color', 'view', 'daily'];

  // a light, comparable picture of what an action can touch (strings are compared, objects are copied when stored)
  function capture(state) {
    const s = state || {};
    return {
      active: s.active,
      boards: (s.boards || []).map((b) => { const m = { id: b.id }; for (const k of BOARD_META) if (b[k] !== undefined) m[k] = b[k]; m.items = (b.items || []).map((i) => i); return m; }),
      subs: Array.isArray(s.subs) ? s.subs : null,
      agenda: Array.isArray(s.agenda) ? s.agenda : null,
    };
  }
  function keyed(list) { const m = new Map(); (list || []).forEach((x, i) => { if (x && x.id != null) m.set(String(x.id), { i, v: x, j: J(x) }); }); return m; }
  function listDiff(a, b) {
    const A = keyed(a), B = keyed(b), out = [];
    for (const [id, x] of A) { const y = B.get(id); if (!y) out.push({ id, from: clone(x.v), to: null, i: x.i }); else if (y.j !== x.j) out.push({ id, from: clone(x.v), to: clone(y.v), i: y.i }); }
    for (const [id, y] of B) if (!A.has(id)) out.push({ id, from: null, to: clone(y.v), i: y.i });
    return out;
  }
  function meta(b) { const m = {}; for (const k of BOARD_META) if (b[k] !== undefined) m[k] = b[k]; return m; }

  // before / after: capture() results (or parsed snapshots with the same shape)
  function diff(before, after) {
    const ch = { boards: [], items: [], subs: [], agenda: [], active: null, agendaWhole: null };
    const bA = new Map((before.boards || []).map((b, i) => [b.id, { b, i }])), bB = new Map((after.boards || []).map((b, i) => [b.id, { b, i }]));
    for (const [id, x] of bA) { const y = bB.get(id); if (!y) ch.boards.push({ id, from: { ...clone(meta(x.b)), i: x.i }, to: null }); else if (J(meta(x.b)) !== J(meta(y.b))) ch.boards.push({ id, from: clone(meta(x.b)), to: clone(meta(y.b)) }); }
    for (const [id, y] of bB) if (!bA.has(id)) ch.boards.push({ id, from: null, to: { ...clone(meta(y.b)), i: y.i } });
    // cards: keyed by id across all boards (a move between boards is one change)
    const iA = new Map(), iB = new Map();
    for (const b of before.boards || []) (b.items || []).forEach((it, i) => it && iA.set(String(it.id), { b: b.id, i, v: it, j: J(it) }));
    for (const b of after.boards || []) (b.items || []).forEach((it, i) => it && iB.set(String(it.id), { b: b.id, i, v: it, j: J(it) }));
    for (const [id, x] of iA) { const y = iB.get(id); if (!y) ch.items.push({ id, from: { b: x.b, i: x.i, v: clone(x.v) }, to: null }); else if (y.j !== x.j || y.b !== x.b) ch.items.push({ id, from: { b: x.b, i: x.i, v: clone(x.v) }, to: { b: y.b, i: y.i, v: clone(y.v) } }); }
    for (const [id, y] of iB) if (!iA.has(id)) ch.items.push({ id, from: null, to: { b: y.b, i: y.i, v: clone(y.v) } });
    if (before.subs && after.subs) ch.subs = listDiff(before.subs, after.subs);
    else if (!before.subs && after.subs) ch.subs = listDiff([], after.subs);
    if (before.agenda && after.agenda) ch.agenda = listDiff(before.agenda, after.agenda);
    else if (!before.agenda && after.agenda && after.agenda.length) ch.agenda = listDiff([], after.agenda);
    if (before.active !== after.active && after.active !== undefined) ch.active = { from: before.active, to: after.active };
    return ch;
  }
  function empty(ch) { return !ch || (!ch.boards.length && !ch.items.length && !ch.subs.length && !ch.agenda.length && !ch.active); }

  // what applying `ch` in direction dir ('undo' = back to `from`, 'redo' = forward to `to`) would do to `state`
  function summary(state, ch, dir) {
    const back = dir !== 'redo';
    const r = { subs: { add: 0, remove: 0, change: 0, skip: 0, names: [] }, cards: { add: 0, remove: 0, change: 0 }, boards: { add: 0, remove: 0, change: 0 }, agenda: 0 };
    const curSubs = keyed(state.subs || []);
    for (const c of ch.subs || []) {
      const want = back ? c.from : c.to, had = back ? c.to : c.from; const cur = curSubs.get(c.id);
      if (!subSafe(cur, had, want)) { r.subs.skip++; continue; }
      if (want && !cur) r.subs.add++; else if (!want && cur) { r.subs.remove++; r.subs.names.push(cur.v.name || c.id); } else if (want && cur && J(want) !== cur.j) { r.subs.change++; r.subs.names.push(want.name || c.id); }
    }
    for (const c of ch.items || []) { const want = back ? c.from : c.to, had = back ? c.to : c.from; if (want && !had) r.cards.add++; else if (!want && had) r.cards.remove++; else r.cards.change++; }
    for (const c of ch.boards || []) { const want = back ? c.from : c.to, had = back ? c.to : c.from; if (want && !had) r.boards.add++; else if (!want && had) r.boards.remove++; else r.boards.change++; }
    r.agenda = (ch.agenda || []).length;
    r.subsTouched = r.subs.remove + r.subs.change;
    return r;
  }
  // a subscription is only touched when it is still exactly as the action left it
  function subSafe(cur, had, want) { if (had) return !!cur && cur.j === J(had); return !cur || (!!want && cur.j === J(want)); }

  function applyList(list, changes, back, safe) {
    const skipped = [];
    for (const c of changes) {
      const want = back ? c.from : c.to, had = back ? c.to : c.from;
      const idx = list.findIndex((x) => x && String(x.id) === c.id);
      const cur = idx >= 0 ? { v: list[idx], j: J(list[idx]) } : null;
      if (safe && had && (!cur || cur.j !== J(had))) { skipped.push(c.id); continue; }
      if (safe && !had && cur && want && cur.j !== J(want)) { skipped.push(c.id); continue; }
      if (!want) { if (idx >= 0) list.splice(idx, 1); continue; }
      if (idx >= 0) list[idx] = clone(want); else list.splice(Math.min(c.i == null ? list.length : c.i, list.length), 0, clone(want));
    }
    return skipped;
  }
  // apply in place on the live state; returns { skippedSubs: [...ids], keptBoards: [...ids] }
  function apply(state, ch, dir) {
    const back = dir !== 'redo'; const res = { skippedSubs: [], keptBoards: [] };
    state.boards ||= [];
    // 1) boards that must exist (metadata first, so cards can land in them)
    for (const c of ch.boards) {
      const want = back ? c.from : c.to; if (!want) continue;
      let b = state.boards.find((x) => x.id === c.id);
      const m = { ...want }; const at = m.i; delete m.i;
      if (!b) { b = { id: c.id, items: [], view: { x: 0, y: 0, z: 1 } }; state.boards.splice(Math.min(at == null ? state.boards.length : at, state.boards.length), 0, b); }
      for (const k of BOARD_META) if (k in m) b[k] = clone(m[k]); else if (k !== 'view') delete b[k];
    }
    // 2) cards
    const findItem = (id) => { for (const b of state.boards) { const i = (b.items || []).findIndex((x) => x && String(x.id) === id); if (i >= 0) return { b, i }; } return null; };
    for (const c of ch.items) {
      const want = back ? c.from : c.to; const at = findItem(c.id);
      if (!want) { if (at) at.b.items.splice(at.i, 1); continue; }
      const tb = state.boards.find((x) => x.id === want.b); if (!tb) continue;
      tb.items ||= [];
      if (at && at.b === tb) { at.b.items[at.i] = clone(want.v); continue; }
      if (at) at.b.items.splice(at.i, 1);
      tb.items.splice(Math.min(want.i == null ? tb.items.length : want.i, tb.items.length), 0, clone(want.v));
    }
    // 3) boards that must go — only when nothing else lives in them now
    for (const c of ch.boards) {
      const want = back ? c.from : c.to; if (want) continue;
      const i = state.boards.findIndex((x) => x.id === c.id); if (i < 0) continue;
      if ((state.boards[i].items || []).length || state.boards.length < 2) { res.keptBoards.push(c.id); continue; }
      state.boards.splice(i, 1);
    }
    // 4) subscriptions (protected) and agenda notes
    if (ch.subs.length) { state.subs ||= []; res.skippedSubs = applyList(state.subs, ch.subs, back, true); }
    if (ch.agenda.length) { state.agenda ||= []; applyList(state.agenda, ch.agenda, back, false); }
    if (ch.active) { const a = back ? ch.active.from : ch.active.to; if (a && state.boards.some((b) => b.id === a)) state.active = a; }
    if (!state.boards.some((b) => b.id === state.active) && state.boards[0]) state.active = state.boards[0].id;
    return res;
  }

  // «only subscriptions» from a backup / snapshot: missing ones are added, identical ones skipped, different ones listed
  function subsMerge(current, source) {
    const C = keyed(current || []); const add = [], differ = [], same = [];
    for (const s of source || []) { if (!s || s.id == null) continue; const c = C.get(String(s.id)); if (!c) add.push(clone(s)); else if (c.j !== J(s)) differ.push({ id: String(s.id), cur: clone(c.v), src: clone(s) }); else same.push(String(s.id)); }
    return { add, differ, same };
  }
  // how many subscriptions disappear between two saves (for the save-time warning)
  function subsDropped(prevIds, subs) { const now = new Set((subs || []).map((s) => String(s && s.id))); return (prevIds || []).filter((id) => !now.has(id)); }
  function cardCount(state) { return (state && state.boards || []).reduce((a, b) => a + ((b && b.items) || []).length, 0); }

  const api = { capture, diff, empty, summary, apply, subsMerge, subsDropped, cardCount, listDiff };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NyxUndo = api;
})(typeof window !== 'undefined' ? window : globalThis);
