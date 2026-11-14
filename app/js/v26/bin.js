'use strict';
// v2.6.10 — Κάδος (recycle bin) for deleted cards and subscriptions.
// Every card / subscription that leaves the state (delete, undo of an add, a deleted board, an MCP rollback) lands
// here with its board, position and time. Restoring puts it back at the same place on the same board (one undo step).
// Nothing is ever removed from the bin by itself: items older than KEEP_DAYS are only *marked*; they go away only
// after an explicit OK («Οριστική διαγραφή»). The bin lives in state.bin (an extra optional field: older versions keep
// it untouched, no migration). Pure core functions are exported for the unit tests; the UI part needs the renderer.
(function (root) {
  const KEEP_DAYS = 30; // shown in the UI; expiry never deletes by itself
  const DAY = 86400000;
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const strip = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  // strokes of the pen / eraser and empty text boxes are not «items» a person would look for in a bin
  function binnable(v) {
    if (!v || !v.type) return false;
    if (v.type === 'ink') return false;
    if (['text', 'sticky', 'shape'].includes(v.type) && !strip(v.html) && !v.title && !(v.reminder && v.reminder.on)) return false;
    return true;
  }
  function liveIds(state) {
    const cards = new Set(), subs = new Set();
    for (const b of (state && state.boards) || []) for (const i of b.items || []) if (i && i.id != null) cards.add(String(i.id));
    for (const s of (state && state.subs) || []) if (s && s.id != null) subs.add(String(s.id));
    return { cards, subs };
  }
  let seq = 0;
  const bidOf = (now) => 'bin' + now.toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
  function add(state, entry) {
    state.bin ||= [];
    // the same id deleted again (e.g. undo/redo): keep only the newest picture
    const i = state.bin.findIndex((e) => e.kind === entry.kind && e.id === entry.id);
    if (i >= 0) state.bin.splice(i, 1);
    state.bin.push(entry);
    return entry;
  }
  function cardEntry(v, board, i, now, name) {
    return { bid: bidOf(now), kind: 'card', id: String(v.id), at: now, name: name || '', board: board ? { id: board.id, name: board.name || '', emoji: board.emoji || '', color: board.color || '' } : null, i: i == null ? null : i, v: clone(v) };
  }
  function subEntry(v, i, now) { return { bid: bidOf(now), kind: 'sub', id: String(v.id), at: now, name: v.name || '', board: null, i: i == null ? null : i, v: clone(v) }; }

  // ch: a NyxUndo change set; dir: 'redo' (= the action as done: from → to) or 'undo' (to → from)
  function track(state, ch, dir, opts) {
    if (!ch) return { added: 0, dropped: 0 };
    const back = dir === 'undo'; const now = (opts && opts.now) || Date.now(); const titleOf = (opts && opts.titleOf) || ((v) => strip(v.html) || v.title || v.name || v.type);
    const live = liveIds(state); let added = 0, dropped = 0;
    const boardMeta = (id) => { const b = (state.boards || []).find((x) => x.id === id); if (b) return b; const bc = (ch.boards || []).find((x) => x.id === id); const m = bc && (back ? bc.to || bc.from : bc.from || bc.to); return m ? { id, ...m } : { id, name: '' }; };
    for (const c of ch.items || []) {
      const want = back ? c.from : c.to, had = back ? c.to : c.from;
      if (had && !want && !live.cards.has(c.id)) { if (binnable(had.v)) { add(state, cardEntry(had.v, boardMeta(had.b), had.i, now, String(titleOf(had.v) || '').slice(0, 120))); added++; } }
    }
    for (const c of ch.subs || []) {
      const want = back ? c.from : c.to, had = back ? c.to : c.from;
      if (had && !want && !live.subs.has(c.id)) { add(state, subEntry(had, c.i, now)); added++; }
    }
    dropped = prune(state);
    return { added, dropped };
  }
  // a bin entry whose card / subscription is alive again (restored, undone, moved back) is not «deleted» any more
  function prune(state) {
    if (!state || !Array.isArray(state.bin) || !state.bin.length) return 0;
    const live = liveIds(state); const before = state.bin.length;
    state.bin = state.bin.filter((e) => !(e.kind === 'card' ? live.cards.has(e.id) : live.subs.has(e.id)));
    return before - state.bin.length;
  }
  function old(state, now, days) { const lim = (now || Date.now()) - (days == null ? KEEP_DAYS : days) * DAY; return ((state && state.bin) || []).filter((e) => e.at < lim); }

  // plan a restore: which entries can go straight back and which need a board choice (their board is gone)
  function plan(state, bids) {
    const set = new Set(bids); const live = liveIds(state); const out = { ready: [], noBoard: [], exists: [] };
    for (const e of (state.bin || []).filter((x) => set.has(x.bid))) {
      if (e.kind === 'card' ? live.cards.has(e.id) : live.subs.has(e.id)) { out.exists.push(e); continue; }
      if (e.kind === 'card' && !(state.boards || []).some((b) => e.board && b.id === e.board.id)) out.noBoard.push(e);
      else out.ready.push(e);
    }
    return out;
  }
  // put entries back (call inside Store.change so it is one undo step). choice: { [oldBoardId]: 'recreate' | <boardId> }
  function restore(state, bids, choice) {
    const p = plan(state, bids); const done = []; const made = {};
    const put = (e, boardId) => {
      const b = state.boards.find((x) => x.id === boardId); if (!b) return false;
      b.items ||= []; const v = clone(e.v); const at = e.board && e.board.id === boardId && e.i != null ? Math.min(e.i, b.items.length) : b.items.length;
      b.items.splice(at, 0, v); return true;
    };
    for (const e of p.ready) {
      if (e.kind === 'sub') { state.subs ||= []; state.subs.splice(e.i == null ? state.subs.length : Math.min(e.i, state.subs.length), 0, clone(e.v)); done.push(e); continue; }
      if (put(e, e.board.id)) done.push(e);
    }
    for (const e of p.noBoard) {
      const ob = e.board || { id: 'gone', name: '' }; const how = choice && choice[ob.id];
      if (!how) continue; // asked, not answered: stays in the bin
      let target = how;
      if (how === 'recreate') {
        if (!made[ob.id]) { const nb = { id: ob.id, name: ob.name || 'Board', emoji: ob.emoji || '♻️', color: ob.color || '#7c8cff', view: { x: 0, y: 0, z: 1 }, items: [] }; state.boards.push(nb); made[ob.id] = nb.id; }
        target = made[ob.id];
      }
      if (put(e, target)) done.push(e);
    }
    const gone = new Set(done.map((e) => e.bid)); state.bin = (state.bin || []).filter((e) => !gone.has(e.bid));
    return { restored: done, waiting: p.noBoard.filter((e) => !gone.has(e.bid)), exists: p.exists, boardsMade: Object.values(made) };
  }
  // only ever called after an explicit OK in the UI
  function purge(state, bids) { const set = new Set(bids); const before = (state.bin || []).length; state.bin = (state.bin || []).filter((e) => !set.has(e.bid)); return before - state.bin.length; }

  // a whole-state replace (snapshot «Επαναφορά», backup «Αντικατάσταση όλων»): the current bin is kept and what the
  // replace takes away from the current state goes into it too (diff: NyxUndo.diff(capture(cur), capture(next)))
  function carryOver(cur, next, ch, opts) {
    const seen = new Set(); next.bin = [...((cur && cur.bin) || []), ...((next && next.bin) || [])].filter((e) => e && e.bid && !seen.has(e.bid) && seen.add(e.bid));
    return track(next, ch, 'redo', opts);
  }
  const core = { KEEP_DAYS, carryOver, binnable, track, prune, old, plan, restore, purge, add, cardEntry, subEntry };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  root.NyxBin = core;
})(typeof window !== 'undefined' ? window : globalThis);
