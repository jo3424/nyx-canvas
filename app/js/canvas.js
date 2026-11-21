'use strict';
// Infinite canvas: view, pan/zoom (smooth), starfield parallax, culling, LOD, selection, minimap, guides
const Canvas = {
  view: { x: 0, y: 0, z: 1 }, target: null, sel: new Set(), raf: 0, vp: null, world: null, dragging: null, spaceDown: false, editing: null,
  MINZ: 0.05, MAXZ: 8,
  init() {
    this.vp = $('#viewport'); this.world = $('#world');
    Stars.init();
    this.vp.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.vp.addEventListener('pointerdown', (e) => this.onDown(e));
    this.vp.addEventListener('dblclick', (e) => this.onDbl(e));
    this.vp.addEventListener('contextmenu', (e) => { e.preventDefault(); Panels.ctx(e); });
    addEventListener('resize', () => { Stars.resize(); this.applyView(); if (this._autoFit && Date.now() < this._autoFit) this.fit(null, false, 40); });
    this.vp.addEventListener('pointerdown', () => { this._autoFit = 0; }, true); this.vp.addEventListener('wheel', () => { this._autoFit = 0; }, { capture: true, passive: true });
    this.vp.addEventListener('click', (e) => {
      const b = e.target.closest('.act'); if (!b) return;
      const id = e.target.closest('.item')?.dataset.id; const it = id && Store.get(id); if (!it) return;
      e.stopPropagation(); Features.cardAction(b.dataset.act, it);
    });
    $('#minimap').addEventListener('pointerdown', (e) => Minimap.down(e));
    setInterval(() => this.tickCountdowns(), 1000);
  },
  // ---------- view ----------
  s2w(sx, sy) { const r = this.vp.getBoundingClientRect(); return { x: (sx - r.left - this.view.x) / this.view.z, y: (sy - r.top - this.view.y) / this.view.z }; },
  w2s(wx, wy) { return { x: wx * this.view.z + this.view.x, y: wy * this.view.z + this.view.y }; },
  center() { const r = this.vp.getBoundingClientRect(); return this.s2w(r.left + r.width / 2, r.top + r.height / 2); },
  applyView() {
    const v = this.view;
    this.world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
    document.documentElement.style.setProperty('--z', v.z);
    $('#z-val').textContent = Math.round(v.z * 100) + '%';
    Stars.draw(); this.drawSel(); this.cullSoon(); Minimap.drawSoon();
    const b = Store.board(); b.view = { x: Math.round(v.x), y: Math.round(v.y), z: +v.z.toFixed(4) }; Store.save();
  },
  setView(v, animate) {
    if (!animate || document.body.classList.contains('no-anim')) { this.target = null; Object.assign(this.view, v); this.applyView(); return; }
    this.target = { ...v };
    this.vp.classList.add('moving');
    if (!this.raf) { const step = () => {
      const T = this.target; if (!T) { this.raf = 0; return; }
      const k = 0.22; const v2 = this.view;
      v2.z += (T.z - v2.z) * k; v2.x += (T.x - v2.x) * k; v2.y += (T.y - v2.y) * k;
      if (Math.abs(T.z - v2.z) < 0.0005 && Math.abs(T.x - v2.x) < 0.3 && Math.abs(T.y - v2.y) < 0.3) { Object.assign(v2, T); this.target = null; this.vp.classList.remove('moving'); }
      this.applyView(); this.raf = requestAnimationFrame(step);
    }; this.raf = requestAnimationFrame(step); }
  },
  zoomAt(factor, sx, sy, animate = true) {
    const base = this.target || this.view; const r = this.vp.getBoundingClientRect();
    sx ??= r.left + r.width / 2; sy ??= r.top + r.height / 2;
    const z = clamp(base.z * factor, this.MINZ, this.MAXZ); const px = sx - r.left, py = sy - r.top;
    const wx = (px - base.x) / base.z, wy = (py - base.y) / base.z;
    this.setView({ z, x: px - wx * z, y: py - wy * z }, animate);
  },
  zoomTo(z) { this.zoomAt(z / (this.target || this.view).z); },
  onWheel(e) {
    e.preventDefault();
    if (this.editing && e.target.closest('[contenteditable=true]') && !e.ctrlKey) return;
    const S = Store.state.settings; const speed = S.zoomSpeed || 1;
    const isPinch = e.ctrlKey; const mode = S.wheel || 'zoom';
    const touchpadPan = !e.ctrlKey && (Math.abs(e.deltaX) > 0 && e.deltaMode === 0 && Math.abs(e.deltaY) < 50 && !Number.isInteger(e.deltaY));
    if (isPinch || (mode === 'zoom' && !e.shiftKey && !touchpadPan)) {
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const f = Math.exp(-dy * 0.0016 * speed * (isPinch ? 2.2 : 1));
      this.zoomAt(f, e.clientX, e.clientY, !isPinch);
    } else {
      this.target = null;
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      this.view.x -= dx; this.view.y -= dy; this.applyView();
    }
  },
  fit(items, animate = true, pad = 90) {
    items ||= Store.items(); const r = this.vp.getBoundingClientRect();
    if (!items.length) { this.setView({ x: r.width / 2, y: r.height / 2, z: 1 }, animate); return; }
    const bb = bounds(items);
    const z = clamp(Math.min((r.width - pad * 2) / Math.max(bb.w, 1), (r.height - pad * 2 - 40) / Math.max(bb.h, 1)), this.MINZ, items.length === 1 ? 1.6 : 2);
    this.setView({ z, x: r.width / 2 - (bb.x + bb.w / 2) * z, y: r.height / 2 + 20 - (bb.y + bb.h / 2) * z }, animate);
  },
  focusItem(id) {
    const f = Store.find(id); if (!f) return;
    if (Store.state.active !== f.board.id) App.switchBoard(f.board.id);
    this.fit([f.item]); this.select([id]);
    const n = Items.el(f.item); if (n) { n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash'); }
  },
  // ---------- board render ----------
  renderBoard() {
    Items.clear(); this.sel.clear();
    const b = Store.board(); for (const it of b.items) Items.mount(it);
    Object.assign(this.view, b.view || { x: 0, y: 0, z: 1 });
    if (!b.view || (b.view.x === 0 && b.view.y === 0 && b.view.z === 1)) { const r = this.vp.getBoundingClientRect(); if (b.items.length) { this.applyView(); this.fit(null, false, 40); this._autoFit = Date.now() + 5000; this.drawSel(); return; } this.view.x = r.width / 2; this.view.y = r.height / 2; }
    this.applyView(); this.emptyHint(); this.drawSel();
  },
  refresh(ids) { // re-render specific or all items after state change
    const b = Store.board(); const present = new Set(b.items.map(i => i.id));
    for (const id of [...Items.nodes.keys()]) if (!present.has(id)) Items.unmount(id);
    for (const it of b.items) if (!ids || ids.includes(it.id)) Items.mount(it);
    for (const id of [...this.sel]) if (!present.has(id)) this.sel.delete(id);
    this.drawSel(); Minimap.drawSoon(); this.emptyHint(); this.cullSoon();
  },
  emptyHint() {
    let e = $('#empty-hint'); const empty = !Store.items().length;
    if (empty && !e) { e = h('div', { id: 'empty-hint' }, h('div', { class: 'eh-moon' }, '🌙'), h('b', {}, Store.board().name), h('span', {}, t('empty_board'))); $('#viewport').append(e); }
    else if (!empty && e) e.remove();
  },
  // ---------- culling + LOD ----------
  cullSoon() { if (this._cull) return; this._cull = requestAnimationFrame(() => { this._cull = 0; this.cull(); }); },
  cull() {
    const r = this.vp.getBoundingClientRect(); const z = this.view.z; const m = 300 / z;
    const x0 = -this.view.x / z - m, y0 = -this.view.y / z - m, x1 = x0 + r.width / z + 2 * m, y1 = y0 + r.height / z + 2 * m;
    for (const it of Store.items()) {
      const n = Items.el(it); if (!n) continue;
      const vis = it.x < x1 && it.x + it.w > x0 && it.y < y1 && it.y + (it.h || 50) > y0;
      if (n._vis !== vis) { n._vis = vis; n.style.display = vis ? '' : 'none'; if (!vis) n.querySelectorAll('video').forEach(v => !v.paused && v.pause()); }
      if (vis && it.type === 'image') Items.render(n, it);
    }
    document.body.classList.toggle('far', z < 0.35);
  },
  lodFor(it) { return it.thumb && it.w * this.view.z < 420 ? 'thumb' : 'full'; },
  tickCountdowns(root) {
    for (const e of (root || document).querySelectorAll('[data-cd]')) {
      if (!root && e.closest('.item')?.style.display === 'none') continue;
      const c = fmtCountdown(new Date(e.dataset.cd) - Date.now());
      const html = c ? (c.d > 0 ? `<span><b>${c.d}</b><i>${LANG === 'el' ? t('canvas.001') : 'days'}</i></span><span><b>${pad(c.hh)}</b><i>${LANG === 'el' ? t('canvas.002') : 'hrs'}</i></span><span><b>${pad(c.mm)}</b><i>${LANG === 'el' ? t('canvas.003') : 'min'}</i></span>` : `<span><b>${pad(c.hh)}</b><i>${LANG === 'el' ? t('canvas.002') : 'hrs'}</i></span><span><b>${pad(c.mm)}</b><i>${LANG === 'el' ? t('canvas.003') : 'min'}</i></span><span><b>${pad(c.ss)}</b><i>${LANG === 'el' ? t('canvas.004') : 'sec'}</i></span>`) : `<span class="done">${t('cd_done')}</span>`;
      if (e._h !== html) { e._h = html; e.innerHTML = html; }
    }
  },
  // ---------- selection ----------
  expandGroups(ids) { const out = new Set(ids); const items = Store.items(); for (const id of ids) { const it = items.find(i => i.id === id); if (it?.group) items.filter(i => i.group === it.group).forEach(i => out.add(i.id)); } return [...out]; },
  select(ids, add) {
    if (!add) this.sel.clear();
    for (const id of this.expandGroups(ids)) this.sel.add(id);
    this.drawSel(); Panels.stylebar();
  },
  toggleSel(id) { const ids = this.expandGroups([id]); if (this.sel.has(id)) ids.forEach(i => this.sel.delete(i)); else ids.forEach(i => this.sel.add(i)); this.drawSel(); Panels.stylebar(); },
  deselect() { if (!this.sel.size) return; this.sel.clear(); this.drawSel(); Panels.stylebar(); },
  selItems() { return Store.items().filter(i => this.sel.has(i.id)); },
  drawSel() {
    const L = $('#sel-layer'); if (!L) return;
    for (const n of Items.nodes.values()) n.classList.remove('selected');
    const items = this.selItems();
    if (!items.length) { L.innerHTML = ''; L.hidden = true; return; }
    L.hidden = false;
    items.forEach(i => Items.el(i)?.classList.add('selected'));
    const single = items.length === 1 ? items[0] : null; const locked = items.every(i => i.locked);
    let html = '';
    if (single && (single.type === 'arrow' || single.type === 'line')) {
      const a = this.w2s(single.x1, single.y1), b = this.w2s(single.x2, single.y2);
      html = locked ? '' : `<div class="hdl pt" data-h="p1" style="left:${a.x}px;top:${a.y}px"></div><div class="hdl pt" data-h="p2" style="left:${b.x}px;top:${b.y}px"></div>`;
    } else {
      const bb = single ? { x: single.x, y: single.y, w: single.w, h: this.itemH(single) } : bounds(items);
      const p = this.w2s(bb.x, bb.y); const w = bb.w * this.view.z, hh = bb.h * this.view.z;
      const rot = single?.r || 0;
      const hs = locked ? '' : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(k => `<div class="hdl" data-h="${k}"></div>`).join('') + (single || items.length > 1 ? '<div class="hdl rot" data-h="rot"></div>' : '');
      html = `<div class="selbox ${locked ? 'locked' : ''} ${items.length > 1 ? 'multi' : ''}" style="transform:translate(${p.x}px,${p.y}px) rotate(${rot}deg);width:${w}px;height:${hh}px">${hs}${items.length > 1 ? `<span class="selcount">${items.length}</span>` : ''}</div>`;
    }
    L.innerHTML = html;
    Panels.positionStylebar();
  },
  itemH(it) { if (it.type === 'text') { const n = Items.el(it); if (n && n.offsetHeight) { it.h = n.offsetHeight; } } return it.h; },
  // ---------- pointer ----------
  onDown(e) {
    if (e.button === 1 || (e.button === 0 && (this.spaceDown || Tools.cur === 'hand'))) return this.startPan(e);
    if (e.button !== 0) return;
    if (this.editing && e.target.closest('[contenteditable=true]')) return;
    if (this.editing) this.endEdit();
    $('#viewport').focus({ preventScroll: true });
    const hdl = e.target.closest('.hdl');
    if (hdl) return this.startHandle(e, hdl.dataset.h);
    if (Tools.cur !== 'select' && Tools.cur !== 'hand') return Tools.down(e);
    const live = e.target.closest('.live');
    const node = e.target.closest('.item');
    if (node) {
      const id = node.dataset.id; const it = Store.get(id); if (!it) return;
      if (e.shiftKey || e.ctrlKey) { this.toggleSel(id); return; }
      if (!this.sel.has(id)) this.select([id]);
      // v2.7.1.1: a widget moves from ANY point (rows, buttons, days too): under 4 px it stays a click, from 4 px it is a move
      // (the click is then swallowed). Inputs / scrollbars keep working; a locked widget does not move.
      if (live && !(it.type === 'widget' && this.widgetDragOk(e))) return; // let native controls work
      if (this.selItems().some(i => i.locked)) return;
      if (it.type === 'widget') return this.startMove(e, 4, !!live);
      return this.startMove(e);
    }
    if (!e.shiftKey) this.deselect();
    this.startMarquee(e);
  },
  widgetDragOk(e) {
    const tg = e.target; if (!tg || !tg.closest) return false;
    if (tg.closest('input,textarea,select,option,[contenteditable=""],[contenteditable="true"],.wg-nodrag')) return false;
    for (let el = tg; el && el.classList && !el.classList.contains('item'); el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) { const r = el.getBoundingClientRect(); if (e.clientX >= r.left + el.clientLeft + el.clientWidth) return false; } // on its scrollbar
    }
    return true;
  },
  // after a real move that started on a button / row: the click that follows must not run its action
  eatClick() { const until = performance.now() + 500; const f = (ev) => { removeEventListener('click', f, true); if (performance.now() < until) { ev.stopPropagation(); ev.preventDefault(); } }; addEventListener('click', f, true); setTimeout(() => removeEventListener('click', f, true), 60); },
  track(e, move, up, late) {
    const id = e.pointerId; if (!late) try { this.vp.setPointerCapture(id); } catch (_) {}
    const mv = (ev) => { if (ev.pointerId === id) move(ev); };
    const fin = (ev) => { if (ev.pointerId !== id) return; removeEventListener('pointermove', mv); removeEventListener('pointerup', fin); removeEventListener('pointercancel', fin); this.vp.classList.remove('moving'); up && up(ev); };
    addEventListener('pointermove', mv); addEventListener('pointerup', fin); addEventListener('pointercancel', fin);
  },
  startPan(e) {
    e.preventDefault(); this.target = null; const sx = e.clientX, sy = e.clientY, vx = this.view.x, vy = this.view.y; this.vp.classList.add('panning', 'moving');
    let last = { t: performance.now(), x: sx, y: sy }, vel = { x: 0, y: 0 };
    this.track(e, (ev) => { this.view.x = vx + ev.clientX - sx; this.view.y = vy + ev.clientY - sy; const now = performance.now(), dt = Math.max(1, now - last.t); vel = { x: (ev.clientX - last.x) / dt, y: (ev.clientY - last.y) / dt }; last = { t: now, x: ev.clientX, y: ev.clientY }; this.applyView(); },
      () => { this.vp.classList.remove('panning'); if (performance.now() - last.t < 60 && Math.hypot(vel.x, vel.y) > 0.3 && !document.body.classList.contains('no-anim')) { const glide = () => { vel.x *= .92; vel.y *= .92; this.view.x += vel.x * 16; this.view.y += vel.y * 16; this.applyView(); if (Math.hypot(vel.x, vel.y) > 0.02 && !this.target) requestAnimationFrame(glide); }; requestAnimationFrame(glide); } });
  },
  startMarquee(e) {
    const m = $('#marquee'); const r = this.vp.getBoundingClientRect(); const sx = e.clientX, sy = e.clientY; const base = new Set(e.shiftKey ? this.sel : []);
    let moved = false;
    this.track(e, (ev) => {
      moved = true; const x = Math.min(sx, ev.clientX) - r.left, y = Math.min(sy, ev.clientY) - r.top, w = Math.abs(ev.clientX - sx), hh = Math.abs(ev.clientY - sy);
      m.hidden = false; Object.assign(m.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
      const a = this.s2w(Math.min(sx, ev.clientX), Math.min(sy, ev.clientY)), b = this.s2w(Math.max(sx, ev.clientX), Math.max(sy, ev.clientY));
      const hit = Store.items().filter(i => i.type === 'frame' ? (i.x >= a.x && i.y >= a.y && i.x + i.w <= b.x && i.y + i.h <= b.y) : (i.x < b.x && i.x + i.w > a.x && i.y < b.y && i.y + (i.h || 40) > a.y)).map(i => i.id);
      this.sel = new Set([...base, ...this.expandGroups(hit)]); this.drawSel();
    }, () => { m.hidden = true; if (moved) Panels.stylebar(); });
  },
  // ---------- v2.3: text attached to a note/shape/image (it.parent) follows it on move/resize/delete ----------
  HOSTS: ['sticky', 'shape', 'image', 'reminder', 'video', 'link'],
  hostAt(x, y, excludeIds = new Set()) { const its = Store.items(); let best = null, bz = -Infinity; its.forEach((h, idx) => { if (!this.HOSTS.includes(h.type) || excludeIds.has(h.id)) return; const hh = h.h || 40; if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + hh) { const z = (h.z || 0) * 1e5 + idx; if (z > bz) { bz = z; best = h; } } }); return best; },
  // v2.4: anything with .parent (text, ink, highlighter, shapes, arrows) is attached; nested attachments follow too
  ATTACHABLE: ['text', 'ink', 'shape', 'arrow', 'line', 'emoji', 'sticker', 'icon'],
  kids(ids) {
    const set = new Set(ids instanceof Set ? ids : ids); const all = Store.items(); const out = []; const seen = new Set(set);
    const idx = new Map(all.map((it, i) => [it.id, i]));
    for (let depth = 0; depth < 4; depth++) {
      const before = out.length;
      for (const c of all) {
        if (seen.has(c.id)) continue;
        if (c.parent) { if (set.has(c.parent)) { out.push(c); seen.add(c.id); } continue; }
        if (c.parent === null || c.type !== 'text' || depth) continue; // explicitly detached / legacy rule only for text
        // legacy text written on top of a note before v2.3: fully inside & above it → treat as attached
        const ch = c.h || 34; for (const pid of set) { const p = Store.get(pid); if (!p || !this.HOSTS.includes(p.type)) continue; if (c.x >= p.x - 2 && c.y >= p.y - 2 && c.x + c.w <= p.x + p.w + 2 && c.y + ch <= p.y + (p.h || 40) + 2 && ((c.z || 0) * 1e5 + idx.get(c.id)) > ((p.z || 0) * 1e5 + idx.get(p.id))) { c.parent = p.id; out.push(c); seen.add(c.id); break; } }
      }
      if (out.length === before) break;
      for (const k of out) set.add(k.id);
    }
    return out;
  },
  // the host under a point that an item may attach to (never itself or one of its own attachments)
  hostFor(c) { const ex = new Set([c.id, ...this.kids(new Set([c.id])).map(k => k.id)]); const cx = c.x1 != null ? (c.x1 + c.x2) / 2 : c.x + c.w / 2, cy = c.y1 != null ? (c.y1 + c.y2) / 2 : c.y + (c.h || 34) / 2; return this.hostAt(cx, cy, ex); },
  reattach(items) { for (const c of items) { if (!this.ATTACHABLE.includes(c.type)) continue; if (c.type !== 'text' && !c.parent) continue; const host = this.hostFor(c); if (host) c.parent = host.id; else if (c.parent) c.parent = null; Items.mount(c); } },
  startMove(e, thr = 3, late = false) {
    const start = this.s2w(e.clientX, e.clientY); let items = this.selItems();
    // frames carry their contents
    const extra = []; for (const f of items.filter(i => i.type === 'frame')) for (const it of Store.items()) if (it.type !== 'frame' && !this.sel.has(it.id) && it.x >= f.x && it.y >= f.y && it.x + it.w <= f.x + f.w && it.y + it.h <= f.y + f.h) extra.push(it);
    items = items.concat(extra).filter(i => !i.locked);
    const kids = this.kids(new Set(items.map(i => i.id))); items = items.concat(kids); // attached text follows even when it is locked
    const orig = items.map(i => ({ i, x: i.x, y: i.y, x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2 }));
    const bb0 = bounds(this.selItems()); let started = false;
    const sx = e.clientX, sy = e.clientY;
    this.track(e, (ev) => {
      if (!started) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < thr) return; started = true; Store.begin(); this.vp.classList.add('moving', 'dragging'); Panels.hideStylebar(); if (late) { try { this.vp.setPointerCapture(e.pointerId); } catch (_) {} try { getSelection().removeAllRanges(); } catch (_) {} } }
      const p = this.s2w(ev.clientX, ev.clientY); let dx = p.x - start.x, dy = p.y - start.y;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (Store.state.settings.snap && !ev.altKey) { const s = Guides.snap({ x: bb0.x + dx, y: bb0.y + dy, w: bb0.w, h: bb0.h }, new Set(items.map(i => i.id))); dx += s.dx; dy += s.dy; } else Guides.clear();
      for (const o of orig) { o.i.x = o.x + dx; o.i.y = o.y + dy; if (o.x1 != null) { o.i.x1 = o.x1 + dx; o.i.y1 = o.y1 + dy; o.i.x2 = o.x2 + dx; o.i.y2 = o.y2 + dy; } Items.place(Items.el(o.i), o.i); }
      this.drawSel();
    }, () => { Guides.clear(); this.vp.classList.remove('dragging'); if (started && late) this.eatClick(); if (started) { const moved = new Set(items.map(i => i.id)); this.reattach(this.selItems().filter(i => this.ATTACHABLE.includes(i.type) && !(i.parent && moved.has(i.parent)))); Store.commit(); Minimap.drawSoon(); Panels.stylebar(); } }, late);
  },
  startHandle(e, k) {
    e.stopPropagation(); const items = this.selItems().filter(i => !i.locked); if (!items.length) return;
    Store.begin(); Panels.hideStylebar(); this.vp.classList.add('moving');
    const single = items.length === 1 ? items[0] : null;
    if (k === 'p1' || k === 'p2') {
      const it = single; this.track(e, (ev) => { const p = this.s2w(ev.clientX, ev.clientY); if (ev.shiftKey) { const ox = k === 'p1' ? it.x2 : it.x1, oy = k === 'p1' ? it.y2 : it.y1; const a = Math.round(Math.atan2(p.y - oy, p.x - ox) / (Math.PI / 12)) * Math.PI / 12, L = Math.hypot(p.x - ox, p.y - oy); p.x = ox + Math.cos(a) * L; p.y = oy + Math.sin(a) * L; } it[k === 'p1' ? 'x1' : 'x2'] = p.x; it[k === 'p1' ? 'y1' : 'y2'] = p.y; Arrow.fit(it); Items.mount(it); this.drawSel(); }, () => { Store.commit(); Panels.stylebar(); });
      return;
    }
    if (k === 'rot') {
      const bb = single ? { x: single.x, y: single.y, w: single.w, h: single.h } : bounds(items); const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
      const orig = items.concat(this.kids(new Set(items.map(i => i.id)))).map(i => ({ i, r: i.r || 0, x: i.x, y: i.y, x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2 }));
      const a0 = Math.atan2(this.s2w(e.clientX, e.clientY).y - cy, this.s2w(e.clientX, e.clientY).x - cx);
      this.track(e, (ev) => {
        const p = this.s2w(ev.clientX, ev.clientY); let da = (Math.atan2(p.y - cy, p.x - cx) - a0) * 180 / Math.PI;
        if (ev.shiftKey || single) { const base = (orig[0].r + da); const snapped = ev.shiftKey ? Math.round(base / 15) * 15 : (Math.abs(base % 90) < 3 || Math.abs(base % 90) > 87 ? Math.round(base / 90) * 90 : base); da = snapped - orig[0].r; }
        const rad = da * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
        for (const o of orig) {
          if (o.x1 != null) { const rp = (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];[o.i.x1, o.i.y1] = rp(o.x1, o.y1);[o.i.x2, o.i.y2] = rp(o.x2, o.y2); Arrow.fit(o.i); Items.mount(o.i); continue; }
          o.i.r = ((o.r + da) % 360 + 360) % 360; if (o.i.r > 180) o.i.r -= 360;
          if (!single || o.i !== single) { const ix = o.x + o.i.w / 2, iy = o.y + o.i.h / 2; o.i.x = cx + (ix - cx) * c - (iy - cy) * s - o.i.w / 2; o.i.y = cy + (ix - cx) * s + (iy - cy) * c - o.i.h / 2; }
          Items.place(Items.el(o.i), o.i);
        }
        this.drawSel();
      }, () => { Store.commit(); Panels.stylebar(); });
      return;
    }
    // resize
    const bb = single ? { x: single.x, y: single.y, w: single.w, h: this.itemH(single) } : bounds(items);
    const orig = items.map(i => ({ i, x: i.x, y: i.y, w: i.w, h: i.h, size: i.size, x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2 }));
    const kidO = this.kids(new Set(items.map(i => i.id))).map(i => ({ i, x: i.x, y: i.y, w: i.w, h: i.h, x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2 }));
    const keepAR = single ? ['image', 'emoji', 'sticker', 'icon', 'reaction', 'video'].includes(single.type) : true;
    const rad = (single?.r || 0) * Math.PI / 180;
    const startW = this.s2w(e.clientX, e.clientY);
    this.track(e, (ev) => {
      const p = this.s2w(ev.clientX, ev.clientY); let dx = p.x - startW.x, dy = p.y - startW.y;
      if (rad) { const c = Math.cos(-rad), s = Math.sin(-rad); [dx, dy] = [dx * c - dy * s, dx * s + dy * c]; }
      let { x, y, w, h: hh } = bb;
      if (k.includes('e')) w = bb.w + dx; if (k.includes('w')) { w = bb.w - dx; }
      if (k.includes('s')) hh = bb.h + dy; if (k.includes('n')) { hh = bb.h - dy; }
      const corner = k.length === 2;
      if ((keepAR !== ev.shiftKey) && corner) { const sc = Math.max(w / bb.w, hh / bb.h); w = bb.w * sc; hh = bb.h * sc; }
      w = Math.max(16, w); hh = Math.max(12, hh);
      if (k.includes('w')) x = bb.x + bb.w - w; if (k.includes('n')) y = bb.y + bb.h - hh;
      if (rad && single) { // keep opposite corner fixed in rotated space
        const ocx = bb.x + bb.w / 2, ocy = bb.y + bb.h / 2; const ncxL = x + w / 2 - ocx, ncyL = y + hh / 2 - ocy;
        const c = Math.cos(rad), s = Math.sin(rad); const ncx = ocx + ncxL * c - ncyL * s, ncy = ocy + ncxL * s + ncyL * c; x = ncx - w / 2; y = ncy - hh / 2;
      }
      const sx = w / bb.w, sy = hh / bb.h;
      for (const o of orig) {
        const it = o.i;
        if (o.x1 != null) { it.x1 = x + (o.x1 - bb.x) * sx; it.y1 = y + (o.y1 - bb.y) * sy; it.x2 = x + (o.x2 - bb.x) * sx; it.y2 = y + (o.y2 - bb.y) * sy; Arrow.fit(it); Items.mount(it); continue; }
        it.x = x + (o.x - bb.x) * sx; it.y = y + (o.y - bb.y) * sy; it.w = Math.max(8, o.w * sx); it.h = Math.max(8, o.h * sy);
        if (it.type === 'text') { if (corner || !single) it.size = Math.max(6, Math.round((o.size || 18) * sx)); }
        if (['text', 'shape', 'emoji', 'sticky'].includes(it.type) && corner && it.type !== 'text' && it.type !== 'emoji') { /* keep font */ }
        Items.mount(it);
      }
      for (const o of kidO) { if (o.x1 != null) { o.i.x1 = x + (o.x1 - bb.x) * sx; o.i.y1 = y + (o.y1 - bb.y) * sy; o.i.x2 = x + (o.x2 - bb.x) * sx; o.i.y2 = y + (o.y2 - bb.y) * sy; Arrow.fit(o.i); Items.mount(o.i); continue; } o.i.x = x + (o.x - bb.x) * sx; o.i.y = y + (o.y - bb.y) * sy; if (o.i.type === 'text') o.i.w = Math.min(o.w, Math.max(40, x + w - o.i.x)); else { o.i.w = Math.max(4, o.w * sx); o.i.h = Math.max(4, o.h * sy); } Items.place(Items.el(o.i), o.i); }
      this.drawSel();
    }, () => { Store.commit(); Minimap.drawSoon(); Panels.stylebar(); });
  },
  onDbl(e) {
    if (Tools.cur !== 'select') return;
    const node = e.target.closest('.item');
    if (!node) { const p = this.s2w(e.clientX, e.clientY); Tools.createText(p.x, p.y); return; }
    const it = Store.get(node.dataset.id); if (!it || it.locked) return;
    if (e.target.closest('.frame-title')) return Features.renameFrame(it);
    if (['text', 'sticky', 'shape', 'reminder'].includes(it.type)) return this.edit(it.id);
    if (it.type === 'image') return Panels.lightbox(it);
    if (['countdown', 'show', 'tracker', 'link', 'subs', 'file'].includes(it.type)) return Features.editItem(it);
  },
  // ---------- text editing ----------
  edit(id, selectAll = true) {
    const it = Store.get(id); const n = Items.el(it); if (!n) return;
    const tx = n.querySelector('.txt'); if (!tx) return;
    this.select([id]); Store.begin();
    this.editing = id; n.classList.add('editing'); tx.contentEditable = 'true'; tx.spellcheck = false; tx.focus();
    const range = document.createRange(); range.selectNodeContents(tx); if (!selectAll) range.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    tx.oninput = () => { if (it.type === 'text') this.drawSel(); };
    tx.onkeydown = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); this.endEdit(); } ev.stopPropagation(); };
    tx.onblur = () => setTimeout(() => { if (this.editing === id && !document.activeElement?.closest('#stylebar')) this.endEdit(); }, 120);
    Panels.stylebar();
  },
  caretAt(cx, cy) { const tx = this.editing && Items.el(Store.get(this.editing))?.querySelector('.txt'); if (!tx) return; let r = document.caretRangeFromPoint?.(cx, cy); if (!r || !tx.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(tx); r.collapse(false); } const s = getSelection(); s.removeAllRanges(); s.addRange(r); },
  endEdit() {
    const id = this.editing; if (!id) return; this.editing = null;
    const it = Store.get(id); const n = it && Items.el(it); if (!n) { Store.commit(); return; }
    const tx = n.querySelector('.txt'); tx.contentEditable = 'false'; n.classList.remove('editing'); tx.onblur = tx.oninput = tx.onkeydown = null;
    it.html = sanitize(tx.innerHTML).replace(/^(<br>)+$/, '');
    if (it.type === 'text' && !plainText(it.html)) { Store.removeItems([id]); Items.unmount(id); this.sel.delete(id); }
    else { n._sig = ''; Items.mount(it); if (it.type === 'text') it.h = n.offsetHeight; }
    getSelection().removeAllRanges(); Store.commit(); this.drawSel(); Panels.stylebar(); Minimap.drawSoon();
  },
};

function bounds(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of items) { const hh = i.h || 40; x0 = Math.min(x0, i.x); y0 = Math.min(y0, i.y); x1 = Math.max(x1, i.x + i.w); y1 = Math.max(y1, i.y + hh); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Smart alignment guides
const Guides = {
  snap(bb, skip) {
    const z = Canvas.view.z, th = 6 / z; const g = $('#guides');
    const xs = [bb.x, bb.x + bb.w / 2, bb.x + bb.w], ys = [bb.y, bb.y + bb.h / 2, bb.y + bb.h];
    let bx = null, by = null;
    const r = Canvas.vp.getBoundingClientRect(); const vx0 = -Canvas.view.x / z, vy0 = -Canvas.view.y / z, vx1 = vx0 + r.width / z, vy1 = vy0 + r.height / z;
    for (const it of Store.items()) {
      if (skip.has(it.id) || it.type === 'ink' || it.x > vx1 || it.x + it.w < vx0 || it.y > vy1 || it.y + it.h < vy0) continue;
      const txs = [it.x, it.x + it.w / 2, it.x + it.w], tys = [it.y, it.y + it.h / 2, it.y + it.h];
      for (const a of xs) for (const b of txs) { const d = b - a; if (Math.abs(d) < th && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, at: b }; }
      for (const a of ys) for (const b of tys) { const d = b - a; if (Math.abs(d) < th && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, at: b }; }
    }
    let html = '';
    if (bx) { const s = Canvas.w2s(bx.at, 0).x; html += `<div class="guide v" style="left:${s}px"></div>`; }
    if (by) { const s = Canvas.w2s(0, by.at).y; html += `<div class="guide h" style="top:${s}px"></div>`; }
    g.innerHTML = html;
    return { dx: bx ? bx.d : 0, dy: by ? by.d : 0 };
  },
  clear() { $('#guides').innerHTML = ''; }
};

// Starfield / nebula / grid parallax background (the "3D depth")
const Stars = {
  cv: null, ctx: null, layers: [], t: 0, raf: 0, dpr: 1,
  init() {
    this.cv = $('#stars'); this.ctx = this.cv.getContext('2d'); this.resize();
    const rnd = mulberry(7);
    this.layers = [0.04, 0.1, 0.22, 0.4].map((depth, li) => ({ depth, stars: Array.from({ length: [520, 300, 140, 50][li] }, () => ({ x: rnd() * 2400, y: rnd() * 2400, r: (0.35 + rnd() * [0.6, 0.9, 1.2, 1.6][li]), a: 0.25 + rnd() * 0.75, tw: rnd() * 6.28, c: Math.floor(rnd() * 4) })) }));
    this.blobs = Array.from({ length: 5 }, (_, i) => ({ x: rnd() * 3000 - 500, y: rnd() * 2000 - 300, r: 500 + rnd() * 700, c: i }));
    // v2.7.1.1 «Ελαφρύ Nyx»: no endless 30 fps loop any more. The background twinkles (same drawing, same speed) at 15 fps while
    // you use Nyx, and holds a still frame 15 s after the last mouse / keyboard input. Nothing is drawn while Nyx is minimized /
    // in the tray / behind other windows, or with «Ελαφριά εμφάνιση» on. Pan / zoom still redraw at once (applyView → draw).
    const wake = () => this.wake();
    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) addEventListener(ev, wake, { capture: true, passive: true });
    addEventListener('nyx-theme', () => { this.draw(); this.wake(); });
    if (window.NyxLite) NyxLite.onChange(() => this.wake());
    if (!this.animOn()) document.body.classList.add('bg-still');
    this.wake();
  },
  IDLE_MS: 15000, FPS: 15, tm: 0, activeUntil: 0,
  animOn() { const th = Theme.current; return !!th && !!this.ctx && !document.body.classList.contains('no-anim') && (th.fx.stars > 0 || !!th.fx.kind) && !(window.NyxLite && (NyxLite.lite || NyxLite.offscreen)); },
  wake() { this.activeUntil = performance.now() + this.IDLE_MS; if (!this.tm && this.animOn()) { document.body.classList.remove('bg-still'); this.next(); } },
  next() {
    this.tm = setTimeout(() => requestAnimationFrame(() => {
      this.tm = 0; if (!this.animOn()) { document.body.classList.add('bg-still'); return; }
      if (!Canvas.vp.classList.contains('moving')) { this.t = performance.now() * 0.06; this.draw(true); }
      if (performance.now() < this.activeUntil) this.next(); else document.body.classList.add('bg-still');
    }), Math.round(1000 / this.FPS));
  },
  resize() { this.dpr = Math.min(devicePixelRatio || 1, 2); this.cv.width = innerWidth * this.dpr; this.cv.height = innerHeight * this.dpr; this.cv.style.width = innerWidth + 'px'; this.cv.style.height = innerHeight + 'px'; },
  draw() {
    const th = Theme.current; if (!th || !this.ctx) return;
    const { ctx, dpr } = this; const W = innerWidth, H = innerHeight; const v = Canvas.view; const fx = th.fx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g0 = ctx.createLinearGradient(0, 0, 0, H); g0.addColorStop(0, th.vars.bg); g0.addColorStop(1, th.vars.bg2); ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H);
    const zl = Math.log2(v.z);
    // nebula blobs (deep parallax)
    (fx.nebula || []).forEach((col, i) => { const b = this.blobs[i % this.blobs.length]; const d = 0.03 + i * 0.015; const x = mod(b.x + v.x * d, W + 1200) - 600, y = mod(b.y + v.y * d, H + 1200) - 600; const r = b.r * (1 + zl * 0.06); const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); });
    // grid at depth 1 (true canvas plane)
    if (fx.grid && fx.grid !== 'none') {
      let step = 40 * v.z; while (step < 18) step *= 4; while (step > 160) step /= 4;
      const ox = mod(v.x, step), oy = mod(v.y, step); ctx.fillStyle = ctx.strokeStyle = fx.gridColor;
      if (fx.grid === 'dots') { const r = clamp(v.z, 0.6, 1.4); for (let x = ox; x < W; x += step) for (let y = oy; y < H; y += step) { ctx.fillRect(x - r / 2, y - r / 2, r, r); } }
      else { ctx.lineWidth = 1; ctx.beginPath(); for (let x = ox; x < W; x += step) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, H); } for (let y = oy; y < H; y += step) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(W, Math.round(y) + .5); } ctx.stroke(); }
    }
    if (fx.kind) this.scene(fx, W, H, v);
    // stars: multiple depth layers => parallax + zoom spread
    if (fx.stars > 0) {
      const cols = fx.starColors; const T = this.t / 60;
      for (const L of this.layers) {
        const spread = Math.pow(v.z, L.depth * 0.9); const tile = 2400 * spread; const n = Math.floor(L.stars.length * fx.stars);
        const ox = v.x * L.depth, oy = v.y * L.depth;
        for (let i = 0; i < n; i++) {
          const s = L.stars[i]; let x = mod(s.x * spread + ox, tile), y = mod(s.y * spread + oy, tile);
          for (let tx = x; tx < W; tx += tile) for (let ty = y; ty < H; ty += tile) {
            const a = s.a * (0.65 + 0.35 * Math.sin(T * (0.6 + s.c * 0.3) + s.tw));
            ctx.globalAlpha = a; ctx.fillStyle = cols[s.c % cols.length]; const r = s.r * (0.8 + L.depth * 1.2);
            if (r > 1.3) { ctx.beginPath(); ctx.arc(tx, ty, r, 0, 6.283); ctx.fill(); if (L.depth > 0.3) { ctx.globalAlpha = a * 0.15; ctx.beginPath(); ctx.arc(tx, ty, r * 3.5, 0, 6.283); ctx.fill(); } }
            else ctx.fillRect(tx, ty, r, r);
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  }
};
// v2.3: animated scenes for the non-space themes (cheap 2D particles, ~30 fps, paused when hidden/moving/no-anim)
// v2.6: '#rgb' / '#rrggbb' + 2-digit alpha → always a valid colour ('#000' + '55' used to give '#00055' → exception every frame)
const withAlpha = (c, aa) => { const s = String(c || '').trim(); const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s); if (m3) return '#' + m3[1] + m3[1] + m3[2] + m3[2] + m3[3] + m3[3] + aa; if (/^#[0-9a-f]{6}$/i.test(s)) return s + aa; return s || 'transparent'; };
// v2.6: save/restore in try/finally — one bad frame must not leave the canvas state (alpha, transforms) broken
Stars.scene = function (fx, W, H, v) { this.ctx.save(); try { return this.sceneBody(fx, W, H, v); } finally { this.ctx.restore(); this.ctx.globalAlpha = 1; } };
Stars.sceneBody = function (fx, W, H, v) {
  const { ctx } = this; const T = this.t / 60; const kind = fx.kind; const cols = fx.starColors;
  if (this._kind !== kind || !this.parts) { const r = mulberry(kind.length * 977 + 3); this._kind = kind; const N = { desk: 70, bokeh: 26, ocean: 60, forest: 46, retro: 9, sakura: 46, rain: 220 }[kind] || 40; this.parts = Array.from({ length: N }, () => ({ x: r(), y: r(), s: r(), p: r() * 6.283, c: Math.floor(r() * 4) })); }
  const px = (p, d) => mod(p.x * W + v.x * d, W + 80) - 40, py = (p, d) => mod(p.y * H + v.y * d, H + 80) - 40;
  if (kind === 'desk') {
    ctx.globalAlpha = .07; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; const o = mod(v.y * .25, 46);
    for (let y = -46 + o; y < H + 46; y += 23) { ctx.beginPath(); for (let x = 0; x <= W; x += 40) ctx.lineTo(x, y + Math.sin(x / 180 + y * .05) * 6 + Math.sin(x / 47 + y) * 1.5); ctx.stroke(); }
    const g = ctx.createRadialGradient(W * .78, -H * .1, 0, W * .78, -H * .1, H * 1.1); g.addColorStop(0, 'rgba(255,220,160,.22)'); g.addColorStop(1, 'transparent'); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const p of this.parts) { const x = mod(p.x * W + Math.sin(T * .3 + p.p) * 30 + T * 6 * p.s, W), y = mod(p.y * H - T * (4 + p.s * 8), H); ctx.globalAlpha = .25 + .35 * Math.abs(Math.sin(T + p.p)); ctx.fillStyle = cols[0]; ctx.beginPath(); ctx.arc(x, y, .6 + p.s * 1.6, 0, 6.283); ctx.fill(); }
  } else if (kind === 'bokeh') {
    for (const p of this.parts) { const x = mod(p.x * W + Math.sin(T * .15 + p.p) * 60 + v.x * .05, W + 200) - 100, y = mod(p.y * H + Math.cos(T * .12 + p.p) * 50 + v.y * .05, H + 200) - 100, r = 30 + p.s * 90; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, withAlpha(cols[p.c % cols.length], '55')); g.addColorStop(.7, withAlpha(cols[p.c % cols.length], '22')); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  } else if (kind === 'ocean') {
    for (let i = 0; i < 6; i++) { const x = W * (i / 6) + Math.sin(T * .2 + i) * 80 + mod(v.x * .03, W / 6); ctx.globalAlpha = .06 + .03 * Math.sin(T * .5 + i * 2); ctx.fillStyle = '#bff3ff'; ctx.beginPath(); ctx.moveTo(x - 30, 0); ctx.lineTo(x + 40, 0); ctx.lineTo(x + 260, H); ctx.lineTo(x + 90, H); ctx.fill(); }
    ctx.strokeStyle = '#d9fbff'; ctx.lineWidth = 1;
    for (const p of this.parts) { const r = 1.5 + p.s * 5; const y = mod(p.y * H - T * (14 + p.s * 30) + v.y * .08, H + 40) - 20; const x = mod(p.x * W + Math.sin(T * 1.4 + p.p) * 8 + v.x * .08, W); ctx.globalAlpha = .25 + p.s * .35; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke(); ctx.globalAlpha *= .6; ctx.beginPath(); ctx.arc(x - r * .35, y - r * .35, r * .25, 0, 6.283); ctx.fillStyle = '#fff'; ctx.fill(); }
  } else if (kind === 'forest') {
    ctx.globalAlpha = .35; ctx.fillStyle = '#03090500'; for (let i = 0; i < 9; i++) { const x = mod(i * 173 + v.x * (.05 + (i % 3) * .03), W + 200) - 100, w = 30 + (i % 3) * 22; ctx.fillStyle = 'rgba(2,8,4,.55)'; ctx.fillRect(x, 0, w, H); }
    for (const p of this.parts) {
      if (p.c === 0) { const x = mod(p.x * W + Math.sin(T * .4 + p.p) * 40 + T * 10, W), y = mod(p.y * H + T * (16 + p.s * 18), H + 30) - 15; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(T + p.p) * 1.2); ctx.globalAlpha = .55; ctx.fillStyle = p.s > .5 ? '#7fae4c' : '#c98f3d'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 3.2, 0, 0, 6.283); ctx.fill(); ctx.restore(); continue; }
      const x = mod(p.x * W + Math.sin(T * .5 + p.p) * 50 + v.x * .1, W), y = mod(p.y * H + Math.cos(T * .37 + p.p * 2) * 40 + v.y * .1, H); const a = Math.max(0, Math.sin(T * (1 + p.s) + p.p)); const g = ctx.createRadialGradient(x, y, 0, x, y, 14); g.addColorStop(0, cols[p.c % cols.length]); g.addColorStop(1, 'transparent'); ctx.globalAlpha = a * .9; ctx.fillStyle = g; ctx.fillRect(x - 14, y - 14, 28, 28);
    }
  } else if (kind === 'retro') {
    ctx.imageSmoothingEnabled = false;
    for (const p of this.parts) { const s = 6 + Math.round(p.s * 4); const x = Math.round((mod(p.x * W + T * (8 + p.s * 10) + v.x * .04, W + 300) - 150) / s) * s, y = Math.round((p.y * H * .8 + v.y * .03) / s) * s; ctx.globalAlpha = .85; ctx.fillStyle = '#ffffff'; const m = [[0,1,1,0,0,0,0,0],[1,1,1,1,1,1,0,0],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0]]; m.forEach((row, j) => row.forEach((on, i) => { if (on) ctx.fillRect(x + i * s, y + j * s, s, s); })); }
  } else if (kind === 'sakura') {
    for (const p of this.parts) { const x = mod(p.x * W + Math.sin(T * .6 + p.p) * 50 + T * (12 + p.s * 14) + v.x * .06, W + 40) - 20, y = mod(p.y * H + T * (18 + p.s * 22) + v.y * .06, H + 40) - 20; ctx.save(); ctx.translate(x, y); ctx.rotate(T * (.5 + p.s) + p.p); ctx.scale(1, .55 + .45 * Math.sin(T * 2 + p.p)); ctx.globalAlpha = .75; ctx.fillStyle = cols[p.c % cols.length]; const r = 4 + p.s * 5; ctx.beginPath(); ctx.moveTo(0, -r); ctx.bezierCurveTo(r, -r, r, r * .6, 0, r); ctx.bezierCurveTo(-r, r * .6, -r, -r, 0, -r); ctx.fill(); ctx.restore(); }
  } else if (kind === 'rain') {
    const g = ctx.createLinearGradient(0, H * .55, 0, H); g.addColorStop(0, 'transparent'); g.addColorStop(1, 'rgba(255,42,109,.16)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = .9; for (let i = 0; i < 14; i++) { const w = 30 + (i * 37) % 70, hh = H * (.18 + ((i * 53) % 40) / 100), x = mod(i * 97 + v.x * .04, W + 100) - 50; ctx.fillStyle = 'rgba(6,6,18,.85)'; ctx.fillRect(x, H - hh, w, hh); for (let k = 0; k < 6; k++) { if ((i + k) % 3) continue; ctx.fillStyle = k % 2 ? 'rgba(0,240,255,.5)' : 'rgba(255,42,109,.5)'; ctx.fillRect(x + 6 + (k * 7) % (w - 10), H - hh + 10 + k * 14, 3, 5); } }
    ctx.lineWidth = 1; ctx.strokeStyle = cols[0];
    for (const p of this.parts) { const len = 10 + p.s * 22; const x = mod(p.x * W - T * 40 + v.x * .05, W + 40), y = mod(p.y * H + T * (420 + p.s * 300), H + len) - len; ctx.globalAlpha = .15 + p.s * .35; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len * .12, y + len); ctx.stroke(); }
  }
};
function mod(a, n) { return ((a % n) + n) % n; }
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Minimap
const Minimap = {
  _t: 0,
  drawSoon() { if (this._t) return; this._t = requestAnimationFrame(() => { this._t = 0; this.draw(); }); },
  geom() {
    const cv = $('#minimap'); const W = cv.width, H = cv.height; const r = Canvas.vp.getBoundingClientRect(); const z = Canvas.view.z;
    const vw = { x: -Canvas.view.x / z, y: -Canvas.view.y / z, w: r.width / z, h: r.height / z };
    const items = Store.items(); const bb = items.length ? bounds(items) : vw;
    const x0 = Math.min(bb.x, vw.x), y0 = Math.min(bb.y, vw.y), x1 = Math.max(bb.x + bb.w, vw.x + vw.w), y1 = Math.max(bb.y + bb.h, vw.y + vw.h);
    const pad = 8; const s = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (y1 - y0 || 1));
    const ox = pad + ((W - pad * 2) - (x1 - x0) * s) / 2 - x0 * s, oy = pad + ((H - pad * 2) - (y1 - y0) * s) / 2 - y0 * s;
    return { cv, W, H, s, ox, oy, vw };
  },
  draw() {
    if ($('#corner').classList.contains('nomap')) return;
    const { cv, W, H, s, ox, oy, vw } = this.geom(); const ctx = cv.getContext('2d'); const cs = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, W, H);
    const acc = cs.getPropertyValue('--accent').trim() || '#88f';
    for (const it of Store.items()) {
      ctx.globalAlpha = it.type === 'frame' ? 0.25 : 0.75;
      ctx.fillStyle = it.type === 'sticky' ? (it.paper || '#ffe66d') : it.type === 'ink' ? (it.color || '#fff') : it.type === 'frame' ? acc : it.type === 'image' || it.type === 'video' ? '#8fa0c8' : (it.color && it.type !== 'text' ? it.color : '#c8cbe0');
      if (it.type === 'frame') { ctx.strokeStyle = acc; ctx.strokeRect(ox + it.x * s, oy + it.y * s, Math.max(2, it.w * s), Math.max(2, it.h * s)); }
      else ctx.fillRect(ox + it.x * s, oy + it.y * s, Math.max(1.5, it.w * s), Math.max(1.5, (it.h || 30) * s));
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fillRect(ox + vw.x * s, oy + vw.y * s, vw.w * s, vw.h * s); ctx.strokeRect(ox + vw.x * s + .5, oy + vw.y * s + .5, vw.w * s, vw.h * s);
  },
  down(e) {
    e.preventDefault(); const cv = $('#minimap');
    const go = (ev) => { const g = this.geom(); const rr = cv.getBoundingClientRect(); const mx = (ev.clientX - rr.left) * (cv.width / rr.width), my = (ev.clientY - rr.top) * (cv.height / rr.height); const wx = (mx - g.ox) / g.s, wy = (my - g.oy) / g.s; const r = Canvas.vp.getBoundingClientRect(); const z = Canvas.view.z; Canvas.target = null; Canvas.view.x = r.width / 2 - wx * z; Canvas.view.y = r.height / 2 - wy * z; Canvas.applyView(); };
    go(e); cv.setPointerCapture(e.pointerId);
    const mv = (ev) => go(ev); const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
  }
};
