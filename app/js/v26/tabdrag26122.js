// v2.6.12.2 — dragging board tabs with POINTER events (pointerdown / pointermove / pointerup + setPointerCapture).
// Why not HTML5 drag & drop (2.6.12.1): a native drag runs through the operating system's drag loop (OLE on Windows,
// XDND on Linux). With a real mouse the «+N ▾» rows did not move on the owner's Windows PC, and on Linux a real X pointer
// showed the drop never arriving on a bar tab (dragstart → dragend, no drop). Playwright's mouse emulates the drag inside
// Chromium, so the old tests passed anyway. Pointer events never enter that loop: the same code path for every mouse,
// pen and touch, on every OS, and buttons inside a row don't matter.
// Sources (attribute data-drag): bar tabs ('bar'), «+N ▾» rows ('menu' — the WHOLE row: emoji, name, count),
// «Διαχείριση πινάκων» rows ('manage' — the row or its ⋮⋮ handle; not the name field or its buttons).
// Targets: a «+N ▾» row (NyxUI.menuDrop), a bar tab or a manage row (before / after), the «+N ▾» button (to the end; holding
// over it 450 ms opens the menu). A press that moves < 5 px stays a click. The menu is never closed by the press or the drag
// start; Esc cancels. The order is saved by BoardTabs.applyOrder (the same path as 2.6.12.1 and the keyboard Alt+↑/↓).
// v2.6.13: holding the pointer near the left / right edge of the tab bar scrolls the bar (TabStrip.start, the same window the
// mouse wheel moves), faster the closer to the edge (NyxAutoScroll.speed), so a tab can be dropped between tabs that were
// hidden. It stops when the pointer leaves the edge, at the end of the bar, on release and on Esc.
const TabDrag = {
  d: null,
  NOT: '.tm-x,.tab-x,input,textarea,select,[contenteditable],.bm-more,.bm-del',
  init() {
    if (this._init) return; this._init = true;
    this._down = (e) => this.down(e); this._move = (e) => this.move(e); this._up = (e) => this.up(e);
    this._cancel = () => this.end(false); this._key = (e) => { if (e.key === 'Escape' && this.d && this.d.on) { e.preventDefault(); e.stopPropagation(); this.end(false); } };
    document.addEventListener('pointerdown', this._down, true);
    window.__nyxTabDrag26122 = true;
  },
  down(e) {
    if (this.d || e.button !== 0 || !e.isPrimary) return;
    const el = e.target.closest && e.target.closest('[data-drag]'); if (!el || !el.dataset.board) return;
    if (e.target.closest(this.NOT)) return;
    if (el.dataset.drag === 'menu' && !el.closest('#ctxmenu')) return;
    this.d = { el, id: el.dataset.board, kind: el.dataset.drag, x0: e.clientX, y0: e.clientY, pid: e.pointerId, on: false, target: null };
    addEventListener('pointermove', this._move, true); addEventListener('pointerup', this._up, true);
    addEventListener('pointercancel', this._cancel, true); addEventListener('blur', this._cancel); addEventListener('keydown', this._key, true);
  },
  start(e) {
    const d = this.d; d.on = true;
    try { d.el.setPointerCapture(d.pid); } catch (_) { /* the window events still arrive */ }
    const r = d.el.getBoundingClientRect(); d.dx = d.x0 - r.left; d.dy = d.y0 - r.top;
    const g = d.el.cloneNode(true); g.removeAttribute('id'); g.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    g.classList.remove('dragging', 'on'); g.classList.add('tab-ghost', 'tab-ghost-' + d.kind); g.setAttribute('aria-hidden', 'true');
    Object.assign(g.style, { width: r.width + 'px', height: r.height + 'px' });
    document.body.append(g); d.ghost = g;
    const tb = $('#tabs'); if (tb) { const b = tb.getBoundingClientRect(); d.bar = { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; } // v2.6.13: the edges as the drag began (tab widths change while scrolling)
    d.el.classList.add('dragging'); document.body.classList.add('tab-dragging');
    getSelection && getSelection().removeAllRanges();
    this.place(e);
  },
  place(e) { const d = this.d; d.ghost.style.transform = `translate(${Math.round(e.clientX - d.dx)}px,${Math.round(e.clientY - d.dy)}px)`; },
  move(e) {
    const d = this.d; if (!d || e.pointerId !== d.pid) return;
    if (!d.on) { if (!NyxUI.dragStarted(e.clientX - d.x0, e.clientY - d.y0)) return; this.start(e); }
    e.preventDefault(); this.place(e); this.hit(e.clientX, e.clientY); this.auto(e.clientX, e.clientY);
  },
  // ---- v2.6.13 auto-scroll ----
  auto(x, y) {
    const d = this.d; if (!d || !d.on) return; d.px = x; d.py = y;
    const T = $('#tabs'); let v = 0;
    if (T && typeof TabStrip !== 'undefined' && TabStrip.mode === 'overflow' && typeof NyxAutoScroll !== 'undefined') {
      v = NyxAutoScroll.speed(x, y, d.bar || T.getBoundingClientRect());
      const over = v && document.elementFromPoint(x, y); if (over && over.closest('#ctxmenu, #drawer, .drawer, .tab-ghost')) v = 0; // the open «+N ▾» menu / a drawer lies over the bar's edge: never scroll from there
      if (v < 0 && !((TabStrip.start || 0) > 0)) v = 0;
      if (v > 0 && !((TabStrip.start || 0) < TabStrip.maxStart)) v = 0;
    }
    if (!v) d.since = 0; else if (!d.since || Math.sign(v) !== Math.sign(d.v || 0)) d.since = performance.now();
    d.v = v; if (T && !v) T.classList.remove('as-left', 'as-right');
    if (v && !this._as) { d.acc = 0; d.t = 0; this._as = requestAnimationFrame((ts) => this.tick(ts)); }
  },
  tick(ts) {
    this._as = 0; const d = this.d; if (!d || !d.on || !d.v) return;
    if (performance.now() - (d.since || 0) < NyxAutoScroll.DWELL) { d.t = 0; this._as = requestAnimationFrame((t2) => this.tick(t2)); return; } // dwell first
    const T = $('#tabs'); if (T) { T.classList.toggle('as-left', d.v < 0); T.classList.toggle('as-right', d.v > 0); }
    const dt = d.t ? ts - d.t : 16; d.t = ts;
    const r = NyxAutoScroll.step(d.acc, d.v, dt); d.acc = r.acc;
    if (r.n) {
      const st = TabStrip.start || 0; const ns = Math.min(Math.max(0, st + r.n), TabStrip.maxStart);
      if (ns !== st) { TabStrip.start = ns; TabStrip.layout({ follow: false }); d.scrolled = (d.scrolled || 0) + (ns - st); this.hit(d.px, d.py); }
      this.auto(d.px, d.py); // the end of the bar reached → stops
    }
    if (this.d && this.d.v && !this._as) this._as = requestAnimationFrame((t2) => this.tick(t2));
  },
  stopAuto() {
    if (this._as) cancelAnimationFrame(this._as); this._as = 0;
    const T = $('#tabs'); if (T) T.classList.remove('as-left', 'as-right');
  },
  clear() {
    document.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    document.querySelectorAll('#tabs .tab.dragover').forEach((x) => x.classList.remove('dragover'));
  },
  spring(on) {
    const more = $('#tabs-more'); if (!more) return;
    more.classList.toggle('dragover', !!on);
    if (!on) { clearTimeout(this._spring); this._spring = 0; return; }
    const m = $('#ctxmenu');
    if (!this._spring && (m.hidden || m.dataset.menu !== 'tabs-more')) this._spring = setTimeout(() => { this._spring = 0; if (this.d && this.d.on && more.classList.contains('dragover')) BoardTabs.openMore(); }, 450);
  },
  hit(x, y) {
    const d = this.d; this.clear(); d.target = null;
    const el = document.elementFromPoint(x, y); if (!el) return this.spring(false);
    const more = el.closest('#tabs-more');
    if (more && !more.hidden) { if (d.v) return this.spring(false); this.spring(true); d.target = { kind: 'more' }; return; } // v2.6.13: not while the bar auto-scrolls
    this.spring(false);
    let t = el.closest('#ctxmenu[data-menu=tabs-more] .tm-row'); let kind = 'menu'; let axis = 'y';
    if (!t) { t = el.closest('#tabs .tab'); kind = 'bar'; axis = 'x'; if (t && t.hidden) t = null; }
    if (!t) { t = el.closest('#drawer-body .bm-row'); kind = 'manage'; axis = 'y'; }
    if (!t || !t.dataset.board || t.dataset.board === d.id) return;
    const where = NyxUI.dropWhere(t.getBoundingClientRect(), { x, y }, axis);
    t.classList.add(where === 'after' ? 'drop-after' : 'drop-before'); if (kind === 'bar') t.classList.add('dragover');
    d.target = { kind, board: t.dataset.board, where };
  },
  up(e) {
    const d = this.d; if (!d || e.pointerId !== d.pid) return;
    if (!d.on) return this.end(false); // a click: the row's / tab's own click handler does the rest
    e.preventDefault();
    // the click that follows this pointerup must not switch board / open anything
    const eat = (ev) => { ev.preventDefault(); ev.stopPropagation(); }; addEventListener('click', eat, true); setTimeout(() => removeEventListener('click', eat, true), 60);
    this.hit(e.clientX, e.clientY); this.end(true);
  },
  end(apply) {
    const d = this.d; if (!d) return; this.d = null; this.stopAuto();
    removeEventListener('pointermove', this._move, true); removeEventListener('pointerup', this._up, true);
    removeEventListener('pointercancel', this._cancel, true); removeEventListener('blur', this._cancel); removeEventListener('keydown', this._key, true);
    try { if (d.el.hasPointerCapture && d.el.hasPointerCapture(d.pid)) d.el.releasePointerCapture(d.pid); } catch (_) { /* gone */ }
    d.ghost && d.ghost.remove(); d.el.classList.remove('dragging'); document.body.classList.remove('tab-dragging');
    this.clear(); this.spring(false);
    if (!apply || !d.on || !d.target) { this.last = { id: d.id, from: d.kind, to: null, moved: false, scrolled: d.scrolled || 0, cancelled: !apply }; return; }
    const S = Store.state; const hid = (typeof TabStrip !== 'undefined' && TabStrip._hidden) || [];
    const t = Object.assign({ firstHidden: hid.length ? S.boards.indexOf(hid[0]) : S.boards.length }, d.target);
    const order = NyxUI.dropPlan(BoardTabs.ids(), d.id, t);
    if (t.kind === 'bar' || t.kind === 'more') Panels.closeMenu();
    const moved = BoardTabs.applyOrder(order);
    if (t.kind === 'menu') BoardTabs.reopen(d.id); // the menu stays open, with the new order
    this.last = { id: d.id, from: d.kind, to: t.kind, moved, scrolled: d.scrolled || 0 };
  },
};
