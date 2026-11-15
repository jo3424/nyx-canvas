'use strict';
// v2.6.12.1 — the board tabs that sit in «+N ▾» get what a bar tab has (appearance / order only; no new delete path):
//  - every row: × and right-click with the SAME menu as the tab (Panels.tabMenuRows: rename, duplicate, colour, delete);
//    × / Delete / the menu's «Διαγραφή» all call App.deleteBoard — the bar's own delete: an empty board goes at once, a
//    board with items asks «Διαγραφή πίνακα με N στοιχεία;», its cards go to the Bin, the toast's «Αναίρεση» brings it back
//  - drag: reorder inside the menu, menu → bar, bar → menu (drop on «+N ▾» = to the end, or on a row once it opens).
//    v2.6.12.2: with pointer events (tabdrag26122.js) instead of HTML5 drag & drop — see ΑΛΛΑΓΕΣ-v2.6.12.2 for why.
//    Only Store.state.boards' ORDER changes (the same board objects); the first tabs stay in the bar, the last overflow.
//  - «Διαχείριση πινάκων» at the end of the menu: every board in one list (drag / Alt+↑↓, rename, ⋯ menu, delete)
//  - keys on a row: ↑/↓ Home/End, Enter, Delete, F2 rename, Shift+F10 / ContextMenu = the tab's menu, Alt+↑/↓ = move
// Pure helpers: ui26121.js (NyxUI.boardMove / boardStep / dropWhere / tabMenuKey), unit-tested in tests/v26121-unit.js.
const BoardTabs = {
  _spring: 0,
  ids() { return Store.state.boards.map((b) => b.id); },
  board(id) { return Store.state.boards.find((b) => b.id === id) || null; },
  // reorder in place (the same objects, nothing added or removed) → save → re-render
  applyOrder(order) {
    const S = Store.state; const cur = this.ids();
    if (!Array.isArray(order) || order.length !== cur.length || order.join('\u0001') === cur.join('\u0001')) return false;
    if (order.some((id) => !cur.includes(id))) return false;
    const pos = new Map(order.map((id, i) => [id, i]));
    S.boards.sort((a, b) => pos.get(a.id) - pos.get(b.id));
    Store.save(); Panels.tabs(); return true;
  },
  move(id, target, where) { return this.applyOrder(NyxUI.boardMove(this.ids(), id, target, where)); },
  step(id, dir) { return this.applyOrder(NyxUI.boardStep(this.ids(), id, dir)); },
  // the bar's delete, unchanged; afterwards the «+N ▾» menu (or the manage list) is shown again when it still makes sense
  del(b, from) {
    Panels.closeMenu(); App.deleteBoard(b);
    if (Store.state.boards.includes(b)) return; // asked first (board with items) — the modal decides
    if (from === 'menu') this.reopen();
  },
  reopen(focusId) {
    const more = $('#tabs-more'); if (!more || more.hidden) { $('#tabs .tab.on:not([hidden])')?.focus(); return; }
    TabStrip.openMore(); if (focusId) $(`#ctxmenu .mi[data-board="${CSS.escape(focusId)}"]`)?.focus();
  },
  ctxFor(b, x, y) { Panels.menu(x, y, Panels.tabMenuRows(b)); $('#ctxmenu .mi')?.focus(); },
  clearDrop(root) { (root || document).querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); },
  // v2.6.12.2: dragging is done with pointer events (TabDrag, tabdrag26122.js) — no HTML5 drag & drop any more.
  // Drop on a «+N ▾» row: a board that comes from the bar lands IN the menu (NyxUI.menuDrop); other lists: a plain move.
  dropOnRow(id, b, w, menu) {
    if (!id || id === b.id) return false;
    if (menu) { const hid = TabStrip._hidden || []; const fh = hid.length ? Store.state.boards.indexOf(hid[0]) : Store.state.boards.length; return this.applyOrder(NyxUI.menuDrop(this.ids(), id, b.id, w, fh)); }
    return this.move(id, b.id, w);
  },
  // ---------- «+N ▾» ----------
  row(b, act) {
    const many = Store.state.boards.length > 1;
    const mi = h('button', { class: 'mi tm-item' + (b.id === act ? ' on' : ''), role: 'menuitem', title: b.name, 'data-board': b.id, 'aria-current': b.id === act ? 'page' : null, tabindex: '-1',
      onclick: () => { Panels.closeMenu(); App.switchBoard(b.id); setTimeout(() => ($('#tabs .tab.on:not([hidden])') || $('#tabs-more'))?.focus(), 30); } },
    h('span', { class: 'mi-emo' }, b.emoji || '•'), h('span', { class: 'mi-name' }, b.name), h('kbd', {}, String(b.items.length)));
    const x = many ? h('button', { class: 'tm-x', tabindex: '-1', title: t('del'), 'aria-label': t('del') + ' · ' + b.name, 'data-del': b.id, html: iconSvg('x', 12),
      onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); this.del(b, 'menu'); } }) : null;
    // v2.6.12.2: the WHOLE row drags (emoji, name, count) with pointer events; draggable=false so Chromium never starts
    // a native drag; the button inside keeps click / Enter / focus
    const r = h('div', { class: 'tm-row', 'data-board': b.id, 'data-drag': 'menu', draggable: 'false', style: { '--tc': b.color || 'var(--accent)' } }, mi, x);
    r.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); this.ctxFor(b, e.clientX, e.clientY); };
    return r;
  },
  openMore() {
    const more = $('#tabs-more'); if (!more || more.hidden) return;
    const r = more.getBoundingClientRect(); const act = Store.state.active; const hidden = TabStrip._hidden || [];
    const manage = h('button', { class: 'mi tm-manage', role: 'menuitem', tabindex: '-1', html: `${iconSvg('list-ordered', 15)}<span>${esc(t('v26121.manage'))}</span>`,
      onclick: () => { Panels.closeMenu(); this.manage(); } });
    Panels.menu(r.right, r.bottom + 4, [...hidden.map((b) => ['', '', null, this.row(b, act)]), '-', ['', '', null, manage]]);
    const m = $('#ctxmenu'); m.dataset.menu = 'tabs-more'; m.setAttribute('role', 'menu');
    const mr = m.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(r.right - mr.width, innerWidth - mr.width - 8)) + 'px'; // right-aligned under «+N ▾»
    more.setAttribute('aria-expanded', 'true');
    const obs = new MutationObserver(() => { if (m.hidden || m.dataset.menu !== 'tabs-more') { more.setAttribute('aria-expanded', 'false'); obs.disconnect(); } });
    obs.observe(m, { attributes: true, attributeFilter: ['hidden', 'data-menu'] });
    (m.querySelector('.mi.on') || m.querySelector('.mi'))?.focus();
  },
  menuKey(e) {
    const m = $('#ctxmenu'); if (m.dataset.menu !== 'tabs-more') return;
    const a = NyxUI.tabMenuKey(e, false); if (!a || a === 'close') return;
    const items = [...m.querySelectorAll('.mi')]; const k = items.indexOf(document.activeElement);
    const id = document.activeElement && document.activeElement.dataset.board; const b = id && this.board(id);
    const go = (i) => { e.preventDefault(); e.stopPropagation(); items[(i + items.length) % items.length]?.focus(); };
    if (a === 'next') return go(k + 1);
    if (a === 'prev') return go(k - 1);
    if (a === 'first') return go(0);
    if (a === 'last') return go(items.length - 1);
    if (a === 'open') return; // native button click
    if (!b) return; e.preventDefault(); e.stopPropagation();
    if (a === 'delete') return this.del(b, 'menu');
    if (a === 'rename') { Panels.closeMenu(); return Panels.renameBoard(b); }
    if (a === 'menu') { const rr = document.activeElement.getBoundingClientRect(); return this.ctxFor(b, rr.left + 24, rr.bottom - 4); }
    if (a === 'move-up' || a === 'move-down') { if (this.step(b.id, a === 'move-up' ? -1 : 1)) this.reopen(b.id); }
  },
  // ---------- «Διαχείριση πινάκων» ----------
  manage() { Panels.openDrawer('boards', '📋 ' + esc(t('v26121.manage')), (body) => this.renderManage(body)); },
  renderManage(body) {
    body = body || $('#drawer-body'); if (!body || Panels.drawerKind !== 'boards') return;
    const keep = document.activeElement && body.contains(document.activeElement) ? document.activeElement.closest('[data-board]')?.dataset.board : null;
    body.innerHTML = ''; const S = Store.state; const many = S.boards.length > 1;
    body.append(h('p', { class: 'muted small bm-hint' }, t('v26121.manage_hint', { v0: S.boards.length })));
    const ul = h('div', { class: 'bm-list', role: 'list', 'aria-label': t('v26121.manage') });
    S.boards.forEach((b, i) => {
      const name = h('input', { class: 'bm-name', type: 'text', value: b.name, 'aria-label': t('rename') + ' · ' + b.name, spellcheck: 'false' });
      const commit = () => { const v = name.value.trim(); if (!v) { name.value = b.name; return; } if (v === b.name) return; b.name = v; Store.save(); Panels.tabs(); };
      name.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(); name.blur(); } if (e.key === 'Escape') { e.preventDefault(); name.value = b.name; name.blur(); } };
      name.onchange = commit; name.onblur = commit;
      const grip = h('span', { class: 'bm-grip', title: t('v26121.drag'), html: iconSvg('grip-vertical', 15) });
      const row = h('div', { class: 'bm-row' + (b.id === S.active ? ' on' : ''), role: 'listitem', tabindex: '0', 'data-board': b.id, 'data-drag': 'manage', draggable: 'false', style: { '--tc': b.color || 'var(--accent)' }, 'aria-label': b.name + ' · ' + t('v26121.items', { v0: b.items.length }) },
        grip, h('button', { class: 'bm-emo', title: t('v26121.open'), onclick: () => App.switchBoard(b.id) }, b.emoji || '•'), name,
        h('span', { class: 'bm-count muted small' }, t('v26121.items', { v0: b.items.length })),
        h('button', { class: 'icon-btn bm-more', title: t('v26121.menu'), 'aria-label': t('v26121.menu') + ' · ' + b.name, html: iconSvg('ellipsis', 15),
          onclick: (e) => { const rr = e.currentTarget.getBoundingClientRect(); this.ctxFor(b, rr.left, rr.bottom + 2); } }),
        many ? h('button', { class: 'icon-btn bm-del danger', title: t('del'), 'aria-label': t('del') + ' · ' + b.name, 'data-del': b.id, html: iconSvg('trash-2', 15), onclick: () => this.del(b, 'manage') }) : null);
      row.oncontextmenu = (e) => { if (e.target === name) return; e.preventDefault(); this.ctxFor(b, e.clientX, e.clientY); };
      row.onkeydown = (e) => {
        if (e.target !== row) return; const a = NyxUI.tabMenuKey(e, false); if (!a) return;
        const rows = [...ul.querySelectorAll('.bm-row')]; const go = (j) => { e.preventDefault(); e.stopPropagation(); rows[Math.max(0, Math.min(rows.length - 1, j))]?.focus(); };
        if (a === 'next') return go(i + 1); if (a === 'prev') return go(i - 1); if (a === 'first') return go(0); if (a === 'last') return go(rows.length - 1);
        if (a === 'close') return;
        e.preventDefault(); e.stopPropagation();
        if (a === 'open') return App.switchBoard(b.id);
        if (a === 'rename') return name.focus();
        if (a === 'delete') return many && this.del(b, 'manage');
        if (a === 'menu') { const rr = row.getBoundingClientRect(); return this.ctxFor(b, rr.left + 40, rr.bottom - 4); }
        if (a === 'move-up' || a === 'move-down') { this.step(b.id, a === 'move-up' ? -1 : 1); $(`#drawer-body .bm-row[data-board="${CSS.escape(b.id)}"]`)?.focus(); }
      };
      ul.append(row);
    });
    body.append(ul);
    if (keep) $(`#drawer-body .bm-row[data-board="${CSS.escape(keep)}"]`)?.focus();
  },
  init() { // called by bootLook2611 right after TabStrip.init()
    if (this._init) return; this._init = true;
    $('#ctxmenu').addEventListener('keydown', (e) => this.menuKey(e), true);
    if (typeof TabDrag !== 'undefined') TabDrag.init(); // v2.6.12.2: pointer-event dragging (bar, «+N ▾», «Διαχείριση πινάκων»)
    window.__nyxTabs26121 = true;
  },
};
