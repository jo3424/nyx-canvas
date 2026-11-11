'use strict';
// Creation tools: pen / marker / highlighter / eraser / text / sticky / shapes / arrow / line / frame
const TOOL_DEFS = [
  ['select', 'mouse-pointer-2', 'V'], ['hand', 'hand', 'H'], '|',
  ['pen', 'pen-tool', 'P'], ['marker', 'brush', 'M'], ['highlighter', 'highlighter', 'I'], ['eraser', 'eraser', 'E'], '|',
  ['text', 'type', 'T'], ['sticky', 'sticky-note', 'N'], ['shape', 'shapes', 'R'], ['arrow', 'move-up-right', 'A'], ['line', 'minus', 'L'], ['frame', 'frame', 'F'], '|',
  ['library', 'smile-plus', ''], ['insert', 'plus', ''], ['voice', 'mic', ''],
];
const SHAPES = [['rect', 'square'], ['ellipse', 'circle'], ['diamond', 'diamond'], ['triangle', 'triangle'], ['star', 'star'], ['heart', 'heart']];
const Tools = {
  cur: 'select', live: null,
  buildDock() {
    const d = $('#dock'); d.innerHTML = '';
    for (const def of TOOL_DEFS) {
      if (def === '|') { d.append(h('div', { class: 'sep' })); continue; }
      const [id, ic] = def;
      d.append(h('button', { class: 'tool', 'data-tool': id, 'data-tip': 't_' + id, html: iconSvg(ic, 20), onclick: (e) => this.pick(id, e) }));
    }
    this.mark();
  },
  pick(id, e) {
    if (id === 'library') return Panels.library();
    if (id === 'insert') return Panels.insertMenu(e?.currentTarget || $('[data-tool=insert]'));
    if (id === 'voice') return Voice.toggle();
    if (Canvas.editing) Canvas.endEdit();
    this.cur = id; this.mark(); this.opts();
    document.body.dataset.tool = id;
    if (!['select', 'hand'].includes(id)) Canvas.deselect();
  },
  mark() { $$('#dock .tool').forEach(b => b.classList.toggle('on', b.dataset.tool === this.cur)); },
  opts() {
    const o = $('#toolopts'); const S = Store.state.settings; o.innerHTML = '';
    const cur = this.cur;
    if (['pen', 'marker', 'highlighter'].includes(cur)) {
      const key = cur === 'pen' ? 'penColor' : cur === 'marker' ? 'markerColor' : 'hlColor';
      const colors = cur === 'highlighter' ? ['#ffe14d', '#9be15d', '#4fd1ff', '#ff8fab', '#c3a6ff', '#ffb86b'] : PALETTE;
      o.append(...colors.map(c => h('button', { class: 'sw' + (S[key] === c ? ' on' : ''), style: { '--c': c }, onclick: () => { S[key] = c; Store.save(); this.opts(); } })));
      o.append(colorInput(S[key], (c) => { S[key] = c; Store.save(); }));
      o.append(h('div', { class: 'sep' }));
      const sizeKey = cur + 'Size'; const sizes = cur === 'pen' ? [2, 4, 7, 12] : cur === 'marker' ? [8, 14, 22] : [16, 26, 38];
      S[sizeKey] ||= sizes[1];
      o.append(...sizes.map(sz => h('button', { class: 'szb' + (S[sizeKey] === sz ? ' on' : ''), onclick: () => { S[sizeKey] = sz; Store.save(); this.opts(); } }, h('span', { style: { width: Math.min(22, sz + 2) + 'px', height: Math.min(22, sz + 2) + 'px' } }))));
    } else if (cur === 'shape') {
      o.append(...SHAPES.map(([k, ic]) => h('button', { class: 'ob' + (S.shapeKind === k ? ' on' : ''), html: iconSvg(ic, 18), onclick: () => { S.shapeKind = k; Store.save(); this.opts(); } })));
    } else if (cur === 'eraser') {
      o.append(h('span', { class: 'hint' }, LANG === 'el' ? t('tools.001') : 'Drag over drawings to erase'));
    } else if (cur === 'text' || cur === 'sticky') {
      o.append(h('span', { class: 'hint' }, LANG === 'el' ? t('tools.002') : 'Click on the canvas to write'));
      if (cur === 'sticky') {
        o.append(...STICKY.map(c => h('button', { class: 'sw' + ((S.stickyColor || STICKY[0]) === c ? ' on' : ''), style: { '--c': c }, onclick: () => { S.stickyColor = c; Store.save(); this.opts(); } })));
        o.append(h('div', { class: 'sep' }));
        o.append(h('span', { class: 'hint' }, t('v23.paper_kind')));
        o.append(...PAPER_KINDS.map(([k, ic]) => h('button', { class: 'ob' + ((S.stickyKind || '') === k ? ' on' : ''), title: t('v23.pk_' + (k || 'classic')), 'data-pk': k || 'classic', onclick: () => { S.stickyKind = k; Store.save(); this.opts(); } }, iconSvg(ic, 18))));
        o.append(h('span', { class: 'hint' }, t('v2671.paper_hint')));
      }
    }
    o.hidden = !o.childElementCount;
  },
  down(e) {
    const p = Canvas.s2w(e.clientX, e.clientY); const cur = this.cur; const S = Store.state.settings;
    if (['pen', 'marker', 'highlighter'].includes(cur)) return this.drawInk(e, p);
    if (cur === 'eraser') return this.erase(e);
    if (cur === 'text' || cur === 'sticky') e.preventDefault();
    if (cur === 'text') {
      // v2.3: clicking a note/shape/reminder/text with the Text tool writes inside it (caret where you clicked) instead of selecting it;
      // clicking an image/video/link card writes text that is attached to it and moves with it
      const node = e.target.closest('.item'); const it0 = node && Store.get(node.dataset.id);
      if (it0 && ['text', 'sticky', 'shape', 'reminder'].includes(it0.type) && node.querySelector('.txt')) {
        if (it0.locked) { toast('🔒 ' + t('locked')); return; }
        if (!e.shiftKey) this.pick('select'); Canvas.edit(it0.id, false); Canvas.caretAt(e.clientX, e.clientY); return;
      }
      // pick 'select' BEFORE creating: pick() ends any edit, which would delete the fresh empty text box
      if (!e.shiftKey) this.pick('select');
      const host = it0 && Canvas.HOSTS.includes(it0.type) ? it0 : null; const tx = this.createText(p.x, p.y); if (host) { tx.parent = host.id; Store.save(); } return;
    }
    if (cur === 'sticky') { const it = Store.change(() => Store.addItem(stickyDefaults({ x: p.x - 110, y: p.y - 110 }))); Items.mount(it); this.pick('select'); Canvas.edit(it.id); Minimap.drawSoon(); Canvas.emptyHint(); return; }
    if (['shape', 'frame'].includes(cur)) return this.dragRect(e, p, cur);
    if (['arrow', 'line'].includes(cur)) return this.dragArrow(e, p, cur);
  },
  // the note/card under the pointer when a drawing tool starts (elementsFromPoint, so it also works under other strokes)
  hostUnder(e, p) {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) { const n = el.closest?.('.item'); const it = n && Store.get(n.dataset.id); if (it && Canvas.HOSTS.includes(it.type)) return it; }
    return p ? Canvas.hostAt(p.x, p.y) : null;
  },
  createText(x, y, html = '') {
    const it = Store.change(() => Store.addItem({ type: 'text', x, y: y - 14, w: 260, h: 34, html, font: Store.state.settings.textFont || 'Inter', size: 22 }));
    Items.mount(it); Canvas.emptyHint(); if (!html) Canvas.edit(it.id); return it;
  },
  drawInk(e, p0) {
    const S = Store.state.settings; const kind = this.cur;
    const color = kind === 'pen' ? S.penColor : kind === 'marker' ? S.markerColor : S.hlColor;
    const size = S[kind + 'Size'] || ({ pen: 4, marker: 14, highlighter: 26 })[kind];
    const pts = [[p0.x, p0.y, e.pressure || 0.5]]; const real = e.pointerType === 'pen';
    const svg = $('#live-ink'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', color); path.setAttribute('opacity', kind === 'highlighter' ? .38 : 1); svg.append(path);
    const it = { kind, size, realPressure: real };
    const redraw = () => { const d = Ink.path({ ...it, pts }); path.setAttribute('d', d); };
    Canvas.track(e, (ev) => {
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const ce of evs) { const p = Canvas.s2w(ce.clientX, ce.clientY); if (ev.shiftKey && pts.length) { pts.length = 1; } pts.push([p.x, p.y, ce.pressure || 0.5]); }
      redraw();
    }, () => {
      path.remove();
      if (pts.length === 1) pts.push([p0.x + 0.5, p0.y + 0.5, 0.5]);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const pd = size * 1.5; x0 -= pd; y0 -= pd; x1 += pd; y1 += pd;
      const rel = pts.map(([x, y, pr]) => [+(x - x0).toFixed(1), +(y - y0).toFixed(1), +pr.toFixed(2)]);
      // v2.4: a stroke that starts on a note/card/image (or anything under it) is drawn ON it and attached, so it follows move/resize;
      // on the bare canvas the highlighter still goes under everything, like a real marker on paper
      const host = this.hostUnder(e, p0);
      const item = Store.change(() => Store.addItem({ type: 'ink', kind, x: x0, y: y0, w: x1 - x0, h: y1 - y0, ow: x1 - x0, oh: y1 - y0, pts: rel, color, size, realPressure: real, opacity: kind === 'highlighter' ? .38 : 1, z: host ? Store.maxZ() + 1 : kind === 'highlighter' ? Store.minZ() - 1 : undefined, ...(host ? { parent: host.id } : {}) }));
      Items.mount(item); Minimap.drawSoon(); Canvas.emptyHint();
    });
    redraw();
  },
  erase(e) {
    Store.begin(); const hit = new Set();
    const at = (ev) => {
      for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
        const n = el.closest?.('.item'); if (!n) continue; const it = Store.get(n.dataset.id);
        if (it && !it.locked && ['ink', 'arrow', 'line', 'shape', 'emoji', 'sticker', 'icon'].includes(it.type) && !hit.has(it.id)) { hit.add(it.id); n.classList.add('erasing'); }
      }
    };
    at(e);
    Canvas.track(e, at, () => { if (hit.size) { Store.removeItems([...hit]); hit.forEach(id => Items.unmount(id)); for (const k of Store.items()) if (k.parent && hit.has(k.parent)) { delete k.parent; Items.place(Items.el(k), k); } } Store.commit(); Minimap.drawSoon(); Canvas.emptyHint(); });
  },
  dragRect(e, p0, kind) {
    const S = Store.state.settings; let it = null; const host0 = kind === 'shape' ? this.hostUnder(e, p0) : null;
    Canvas.track(e, (ev) => {
      const p = Canvas.s2w(ev.clientX, ev.clientY); let w = p.x - p0.x, hh = p.y - p0.y; if (ev.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; }
      const box = { x: Math.min(p0.x, p0.x + w), y: Math.min(p0.y, p0.y + hh), w: Math.max(4, Math.abs(w)), h: Math.max(4, Math.abs(hh)) };
      if (!it) { Store.begin(); it = Store.addItem(kind === 'frame' ? { type: 'frame', ...box, title: (LANG === 'el' ? t('tools.003') : 'Frame ') + (Store.items().filter(i => i.type === 'frame').length + 1), color: S.frameColor || '' } : { type: 'shape', shape: S.shapeKind || 'rect', ...box, stroke: S.shapeStroke || '', fill: S.shapeFill || '', sw: 2.5, html: '', size: 20, font: 'Inter' }); }
      Object.assign(it, box); Items.mount(it);
    }, () => {
      if (!it) { Store.begin(); it = Store.addItem(kind === 'frame' ? { type: 'frame', x: p0.x - 300, y: p0.y - 200, w: 600, h: 400, title: LANG === 'el' ? t('items.007') : 'Frame' } : { type: 'shape', shape: S.shapeKind || 'rect', x: p0.x - 80, y: p0.y - 55, w: 160, h: 110, sw: 2.5, html: '', size: 20 }); Items.mount(it); }
      if (kind === 'frame') it.z = 0;
      if (host0 && host0.id !== it.id) { it.parent = host0.id; Items.mount(it); }
      Store.commit(); Canvas.select([it.id]); this.pick('select'); Minimap.drawSoon(); Canvas.emptyHint();
    });
  },
  dragArrow(e, p0, kind) {
    let it = null; const S = Store.state.settings; const host0 = this.hostUnder(e, p0);
    Canvas.track(e, (ev) => {
      let p = Canvas.s2w(ev.clientX, ev.clientY);
      if (ev.shiftKey) { const a = Math.round(Math.atan2(p.y - p0.y, p.x - p0.x) / (Math.PI / 12)) * Math.PI / 12, L = Math.hypot(p.x - p0.x, p.y - p0.y); p = { x: p0.x + Math.cos(a) * L, y: p0.y + Math.sin(a) * L }; }
      if (!it) { if (Math.hypot(p.x - p0.x, p.y - p0.y) < 4) return; Store.begin(); it = Store.addItem({ type: kind, x1: p0.x, y1: p0.y, x2: p.x, y2: p.y, stroke: S.arrowColor || '', sw: 3, x: 0, y: 0, w: 1, h: 1 }); }
      it.x2 = p.x; it.y2 = p.y; Arrow.fit(it); Items.mount(it);
    }, () => { if (it) { if (host0) { it.parent = host0.id; Items.mount(it); } Store.commit(); Canvas.select([it.id]); Minimap.drawSoon(); Canvas.emptyHint(); } this.pick('select'); });
  },
};
function colorInput(val, cb) {
  const w = h('label', { class: 'sw custom', title: LANG === 'el' ? t('tools.004') : 'Custom color', html: iconSvg('pipette', 14) });
  const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(val || '') ? val : '#ffffff' });
  inp.addEventListener('input', () => cb(inp.value)); w.append(inp); return w;
}
