// v2.6.12.2 — pure helpers (no DOM) for dragging board tabs with POINTER events (tabdrag26122.js); unit-tested in
// tests/v26122-unit.js, the renderer gets them on window.NyxUI (after ui26121.js).
//  - dragStarted: a press becomes a drag only after the pointer moved a few pixels (a plain click stays a click)
//  - dropPlan:    the new board order for a drop target; the same rules as 2.6.12.1 (NyxUI.boardMove / NyxUI.menuDrop)
(function (root) {
  const U = (typeof module !== 'undefined' && module.exports) ? require('./ui26121.js') : (root && root.NyxUI) || {};
  function dragStarted(dx, dy, threshold) {
    const t = threshold == null ? 5 : threshold;
    return Math.hypot(+dx || 0, +dy || 0) >= t;
  }
  // target: { kind: 'menu' | 'manage' | 'bar' | 'more', board, where, firstHidden }
  //  menu   — a «+N ▾» row: a board from the bar lands IN the menu (menuDrop)
  //  manage — a row of «Διαχείριση πινάκων»; bar — a tab of the bar: a plain move before / after it
  //  more   — the «+N ▾» button itself: to the end
  function dropPlan(ids, id, target) {
    const list = Array.isArray(ids) ? ids.slice() : [];
    if (!target || list.indexOf(id) < 0) return list;
    if (target.kind === 'more') return U.boardMove(list, id, null, 'end');
    if (target.board == null || target.board === id) return list;
    const where = target.where === 'after' ? 'after' : 'before';
    if (target.kind === 'menu') return U.menuDrop(list, id, target.board, where, target.firstHidden == null ? list.length : target.firstHidden);
    if (target.kind === 'manage' || target.kind === 'bar') return U.boardMove(list, id, target.board, where);
    return list;
  }
  const api = { dragStarted, dropPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NyxUI = Object.assign(root.NyxUI || {}, api);
})(typeof window !== 'undefined' ? window : null);
