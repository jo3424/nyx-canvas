// v2.6.12.1 — pure helpers (no DOM) for the board tabs in «+N ▾» and «Διαχείριση πινάκων»; unit-tested in
// tests/v26121-unit.js, the renderer gets them on window.NyxUI.
//  - boardMove:  the new board order after a drag (or Alt+↑/↓). Only the ORDER changes: the same ids, none lost or added.
//  - menuDrop:   a drop on a «+N ▾» row; a board dragged from the bar lands IN the menu (the first menu board fills its slot)
//  - dropWhere:  'before' / 'after' from the pointer position on a row (vertical list) or a tab (horizontal bar)
//  - tabMenuKey: what a key does on a focused row of the «+N ▾» menu / the manage list (never while typing in a field)
(function (root) {
  // ids: current order; id: the board that moves; target: the board it is dropped on (null = 'end'); where: before|after|end
  function boardMove(ids, id, target, where) {
    const list = Array.isArray(ids) ? ids.slice() : [];
    const from = list.indexOf(id);
    if (from < 0) return list;
    if (where !== 'end' && (target == null || target === id || list.indexOf(target) < 0)) return list;
    list.splice(from, 1);
    if (where === 'end') list.push(id);
    else { const at = list.indexOf(target); list.splice(where === 'after' ? at + 1 : at, 0, id); }
    return list;
  }
  // a drop on a row of the «+N ▾» menu. firstHidden: index of the first board in the menu. A board that comes from the BAR
  // must end up IN the menu at that row's place: its empty bar slot is filled by the first menu board (the first-tabs rule),
  // so the slot is counted before the removal. A board already in the menu: a plain boardMove.
  function menuDrop(ids, id, target, where, firstHidden) {
    const list = Array.isArray(ids) ? ids.slice() : []; const from = list.indexOf(id); const at = list.indexOf(target);
    if (from < 0 || at < 0 || id === target) return list;
    if (!(from < (firstHidden | 0))) return boardMove(list, id, target, where);
    const slot = at + (where === 'after' ? 1 : 0); // in the order BEFORE the removal
    list.splice(from, 1); list.splice(Math.min(slot, list.length), 0, id); return list;
  }
  // one step up / down (keyboard): -1 or +1, clamped; unchanged at the ends
  function boardStep(ids, id, dir) {
    const list = Array.isArray(ids) ? ids.slice() : []; const i = list.indexOf(id); const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return list;
    list.splice(i, 1); list.splice(j, 0, id); return list;
  }
  // rect: {left, top, width, height}; pos: {x, y}; axis 'y' (menu / list rows) or 'x' (bar tabs)
  function dropWhere(rect, pos, axis) {
    if (!rect || !pos) return 'before';
    return axis === 'x' ? (pos.x > rect.left + rect.width / 2 ? 'after' : 'before') : (pos.y > rect.top + rect.height / 2 ? 'after' : 'before');
  }
  // e: {key, altKey, shiftKey, ctrlKey, metaKey}; typing: focus is in a text field → only Escape counts
  function tabMenuKey(e, typing) {
    if (!e) return null;
    if (typing) return e.key === 'Escape' ? 'close' : null;
    if (e.ctrlKey || e.metaKey) return null;
    if (e.altKey && e.key === 'ArrowUp') return 'move-up';
    if (e.altKey && e.key === 'ArrowDown') return 'move-down';
    if (e.altKey) return null;
    if (e.key === 'ArrowDown') return 'next';
    if (e.key === 'ArrowUp') return 'prev';
    if (e.key === 'Home') return 'first';
    if (e.key === 'End') return 'last';
    if (e.key === 'Delete' || e.key === 'Backspace') return 'delete';
    if (e.key === 'F2') return 'rename';
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) return 'menu';
    if (e.key === 'Enter' || e.key === ' ') return 'open';
    if (e.key === 'Escape') return 'close';
    return null;
  }
  const api = { boardMove, menuDrop, boardStep, dropWhere, tabMenuKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NyxUI = Object.assign(root.NyxUI || {}, api);
})(typeof window !== 'undefined' ? window : null);
