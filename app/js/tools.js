'use strict';
// Creation tools: pen / marker / highlighter / eraser / text / sticky / shapes / arrow / line / frame
const TOOL_DEFS = [
  ['select', 'mouse-pointer-2', 'V'], ['hand', 'hand', 'H'], '|',
  ['pen', 'pen-tool', 'P'], ['marker', 'brush', 'M'], ['highlighter', 'highlighter', 'I'], ['eraser', 'eraser', 'E'], '|',
  ['text', 'type', 'T'], ['sticky', 'sticky-note', 'N'], ['shape', 'shapes', 'R'], ['frame', 'frame', 'F'], '|',
  // v2.6.11.1: arrow (A) and line (L) live inside the shapes flyout (items 7 and 8) — same tools, same keys, no own dock buttons
  ['library', 'smile-plus', ''], ['insert', 'plus', ''], ['voice', 'mic', ''],
];
const SHAPES = [['rect', 'square'], ['ellipse', 'circle'], ['diamond', 'diamond'], ['triangle', 'triangle'], ['star', 'star'], ['heart', 'heart']];
const SHAPE_LINES = [['arrow', 'move-up-right'], ['line', 'minus']]; // v2.6.11.1: in the shapes flyout after the 6 shapes
const Tools = {
  cur: 'select', live: null,
  buildDock() {
    const d = $('#dock'); d.innerHTML = '';
    for (const def of TOOL_DEFS) {
      if (def === '|') { d.append(h('div', { class: 'sep' })); continue; }
      const [id, ic] = def;
      d.append(h('button', { class: 'tool', 'data-tool': id, 'data-tip': id === 'library' ? 'v26111.lib_tip' : 't_' + id, html: iconSvg(ic, 20), onclick: (e) => this.pick(id, e) }));
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
  // v2.6.11.1: the dock button that owns a tool (arrow/line → the shapes button)
  dockOf(id) { return id === 'arrow' || id === 'line' ? 'shape' : id; },
  mark() { const d = this.dockOf(this.cur); $$('#dock .tool').forEach(b => b.classList.toggle('on', b.dataset.tool === d)); },
  // v2.6.11: the tool options are a flyout that touches its dock button and stays inside the window (look2611.js →
  // Flyout.place). Same choices and settings as before; only the look changed. Items 1–9 (and 0 for the 10th paper kind, since 2.6.11.1) carry their key in the tooltip
  // (data-fk) and Flyout.key() picks them only while the flyout is open and nobody is typing.
  opts() {
    if (this._picker) this.closePicker(); // v2.6.12: a rebuild (other tool) closes the palette
    const o = $('#toolopts'); const S = Store.state.settings; o.innerHTML = '';
    const cur = this.cur; let fk = 0;
    const num = (el, ten) => { if (fk < 9 || (ten && fk === 9)) { fk++; const k = String(fk % 10); el.dataset.fk = k; el.setAttribute('aria-keyshortcuts', k); } return el; }; // v2.6.11.1: ten → the 10th item gets «0» (note paper kinds only)
    const sec = (cls, ...kids) => h('div', { class: 'fo-sec ' + (cls || '') }, ...kids);
    const head = () => h('div', { class: 'fo-head', 'aria-hidden': 'true', html: iconSvg(({ pen: 'pen-tool', marker: 'brush', highlighter: 'highlighter', eraser: 'eraser', text: 'type', sticky: 'sticky-note', shape: 'shapes', arrow: 'shapes', line: 'shapes' })[cur] || 'circle', 15) });
    o.classList.add('flyout'); o.dataset.flyout = cur; o.setAttribute('role', 'toolbar'); o.setAttribute('aria-label', t('t_' + this.dockOf(cur)));
    if (['pen', 'marker', 'highlighter'].includes(cur)) this.penOpts(o, head, sec, num);
    else if (cur === 'shape' || cur === 'arrow' || cur === 'line') {
      // v2.6.11.1: 6 shapes + arrow + line (keys 1–8 while the flyout is open; R / A / L as before)
      const shapeBtns = SHAPES.map(([k, ic]) => num(h('button', { class: 'ob' + (cur === 'shape' && (S.shapeKind || 'rect') === k ? ' on' : ''), 'data-shape': k, 'data-tip': 'v2611.sh_' + k, 'aria-label': t('v2611.sh_' + k), html: iconSvg(ic, 18), onclick: () => { S.shapeKind = k; Store.save(); if (this.cur !== 'shape') this.pick('shape'); else this.opts(); } })));
      const lineBtns = SHAPE_LINES.map(([id, ic]) => num(h('button', { class: 'ob' + (cur === id ? ' on' : ''), 'data-shape-tool': id, 'data-tip': 't_' + id, 'aria-label': t('t_' + id), html: iconSvg(ic, 18), onclick: () => { if (this.cur !== id) this.pick(id); } })));
      o.append(head(), sec('fo-col', ...shapeBtns, h('div', { class: 'fo-mini-sep', 'aria-hidden': 'true' }), ...lineBtns));
    } else if (cur === 'eraser') {
      o.append(head(), h('span', { class: 'hint' }, LANG === 'el' ? t('tools.001') : 'Drag over drawings to erase'));
    } else if (cur === 'text' || cur === 'sticky') {
      o.append(head());
      if (cur === 'text') o.append(h('span', { class: 'hint' }, LANG === 'el' ? t('tools.002') : 'Click on the canvas to write'));
      if (cur === 'sticky') {
        o.append(sec('fo-grid', ...STICKY.map(c => h('button', { class: 'sw' + ((S.stickyColor || STICKY[0]) === c ? ' on' : ''), style: { '--c': c }, 'data-tip': c.toUpperCase(), 'aria-label': c.toUpperCase(), onclick: () => { S.stickyColor = c; Store.save(); this.opts(); } }))));
        o.append(h('div', { class: 'sep' }));
        // v2.6.12 (mockup 04): icons only — the «Είδος χαρτιού» label moved into each tooltip («Είδος χαρτιού: Γυαλί [0]»)
        const pk = sec('fo-grid fo-paper', ...PAPER_KINDS.map(([k, ic]) => num(h('button', { class: 'ob' + ((S.stickyKind || '') === k ? ' on' : ''), 'data-tip': 'v23.pk_' + (k || 'classic'), 'data-tip-pre': 'v23.paper_kind', 'aria-label': t('v23.paper_kind') + ': ' + t('v23.pk_' + (k || 'classic')), 'data-pk': k || 'classic', onclick: () => { S.stickyKind = k; Store.save(); this.opts(); } }, iconSvg(ic, 18)), true)));
        pk.setAttribute('role', 'group'); pk.setAttribute('aria-label', t('v23.paper_kind')); pk.setAttribute('aria-description', t('v2671.paper_hint'));
        o.append(pk);
      }
    }
    o.hidden = !o.childElementCount;
    if (!o.hidden && typeof Flyout !== 'undefined') Flyout.place();
  },
  // v2.6.11.1: pen / marker / highlighter flyout as in mockup 03 — colours (1–9), 4 sizes, hex + eyedropper, opacity %,
  // thickness 1–40 px, 4 recent colours (additive setting recentColors[tool]). The highlighter keeps its own colours and 38 %.
  // v2.6.12: every change is applied IN PLACE (no this.opts()): until 2.6.11.1 the colour input's 'input' event went
  // setColor → this.opts(), which rebuilt the flyout and detached the active <input type=color> — Chromium closes the
  // colour chooser of a detached input, so the palette closed after every shade. The rainbow button now opens the Nyx
  // palette (saturation/value square + hue slider) inside the flyout; it stays open for consecutive changes until Esc,
  // its × or a click outside. Live changes set the colour; the recent list is updated once, when a change is finished.
  penOpts(o, head, sec, num) {
    const S = Store.state.settings; const cur = this.cur;
    const key = cur === 'pen' ? 'penColor' : cur === 'marker' ? 'markerColor' : 'hlColor';
    const colors = cur === 'highlighter' ? ['#ffe14d', '#9be15d', '#4fd1ff', '#ff8fab', '#c3a6ff', '#ffb86b'] : PALETTE;
    const sizeKey = cur + 'Size'; const sizes = cur === 'pen' ? [2, 4, 7, 12] : cur === 'marker' ? [8, 14, 22] : [16, 26, 38];
    S[sizeKey] ||= sizes[1];
    const opKey = cur + 'Opacity';
    const curHex = () => NyxUI.toHex(S[key]) || NyxUI.toHex(colors[0]);
    const isOn = (c) => NyxUI.toHex(c) === curHex();
    let saveT = 0;
    // opts.recent === false → live change (palette drag): colour set + saved (debounced), recent list untouched
    const setColor = (c, opts = {}) => {
      const hx = NyxUI.toHex(c); if (!hx) return false;
      const fromPalette = colors.find(x => NyxUI.toHex(x) === hx);
      S[key] = fromPalette || hx;
      if (opts.recent !== false) { S.recentColors = { ...(S.recentColors || {}), [cur]: NyxUI.pushRecent((S.recentColors || {})[cur], hx) }; clearTimeout(saveT); Store.save(); }
      else { clearTimeout(saveT); saveT = setTimeout(() => Store.save(), 250); }
      refresh(opts); return true;
    };
    const swatches = colors.map(c => num(h('button', { class: 'sw' + (isOn(c) ? ' on' : ''), style: { '--c': c }, 'data-c': NyxUI.toHex(c), 'data-tip': c.toUpperCase(), 'aria-label': c.toUpperCase(), onclick: () => setColor(c) })));
    const rainbow = h('button', { class: 'sw custom', type: 'button', 'data-picker': '', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-tip': 'v2612.palette', 'aria-label': t('v2612.palette'), html: iconSvg('pipette', 14), onclick: () => (this._picker ? this.closePicker() : this.openPicker(o, rainbow, curHex, setColor)) });
    o.append(head(), sec('fo-grid', ...swatches, rainbow));
    // sizes: the dots are <i> (styles.css colours `.szb i`; until 2.6.11 they were <span> and stayed invisible)
    const dots = sizes.map(sz => h('button', { class: 'szb' + (S[sizeKey] === sz ? ' on' : ''), 'data-size': String(sz), 'data-tip': sz + ' px', 'aria-label': sz + ' px', onclick: () => { S[sizeKey] = sz; Store.save(); dots.forEach(d => d.classList.toggle('on', +d.dataset.size === sz)); const px = o.querySelector('.fo-px'); if (px) px.value = String(sz); } }, h('i', { style: { width: Math.min(22, sz + 2) + 'px', height: Math.min(22, sz + 2) + 'px' } })));
    o.append(h('div', { class: 'sep' }), sec('fo-col fo-sizes', ...dots));
    // hex + eyedropper
    const hex = h('input', { class: 'fo-inp fo-hex', type: 'text', value: curHex(), maxlength: '9', spellcheck: 'false', autocomplete: 'off', 'aria-label': t('v26111.hex'), 'data-tip': 'v26111.hex' });
    const applyHex = () => { if (!setColor(hex.value)) { hex.classList.add('bad'); toast(t('v26111.hex_bad'), { kind: 'err', ms: 3500 }); hex.value = curHex(); setTimeout(() => hex.classList.remove('bad'), 1200); } };
    hex.addEventListener('change', applyHex);
    hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyHex(); } else if (e.key === 'Escape') { hex.value = curHex(); hex.blur(); } });
    const drop = h('button', { class: 'fo-drop', type: 'button', 'data-eyedrop': '', 'data-tip': 'v26111.drop_tip', 'aria-label': t('v26111.drop_tip'), html: iconSvg('pipette', 13), onclick: () => this.eyedrop(setColor) });
    // opacity % and thickness px
    const field = (cls, val, min, max, unit, label, onset) => {
      const inp = h('input', { class: 'fo-inp ' + cls, type: 'number', min: String(min), max: String(max), step: '1', value: String(val), 'aria-label': t(label), 'data-tip': label });
      inp.addEventListener('change', () => { const n = NyxUI.clampInt(inp.value, min, max, val); inp.value = String(n); onset(n); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.dispatchEvent(new Event('change')); inp.blur(); } });
      return h('label', { class: 'fo-field' }, inp, h('span', { class: 'fo-unit' }, unit));
    };
    const opNow = Math.round(NyxUI.inkOpacity(cur, S[opKey]) * 100);
    const opF = field('fo-op', opNow, 1, 100, '%', 'v26111.opacity', (n) => { S[opKey] = n; Store.save(); });
    const pxF = field('fo-px', NyxUI.clampInt(S[sizeKey], NyxUI.PEN_PX_MIN, NyxUI.PEN_PX_MAX, sizes[1]), NyxUI.PEN_PX_MIN, NyxUI.PEN_PX_MAX, 'px', 'v26111.px', (n) => { S[sizeKey] = n; Store.save(); dots.forEach(d => d.classList.toggle('on', +d.dataset.size === n)); });
    o.append(sec('fo-fields', h('div', { class: 'fo-field fo-hexrow' }, drop, hex), opF, pxF));
    const recSec = sec('fo-grid fo-recent');
    const fillRecent = () => {
      const rec = ((S.recentColors || {})[cur] || []).map(NyxUI.toHex).filter(Boolean).slice(0, NyxUI.RECENT_MAX);
      recSec.replaceChildren(...rec.map(c => h('button', { class: 'sw recent' + (isOn(c) ? ' on' : ''), style: { '--c': c }, 'data-recent': c, 'data-tip': c, 'aria-label': t('v26111.recent') + ' ' + c, onclick: () => setColor(c) })));
      const was = recSec.hidden; recSec.hidden = !rec.length;
      // the flyout was placed for its old height; re-place it when the recent row appears (in-place updates do not rebuild it)
      if (was !== recSec.hidden && recSec.isConnected && typeof Flyout !== 'undefined' && Flyout.isOpen()) Flyout.place();
    };
    fillRecent(); o.append(recSec);
    // in-place refresh: swatch rings, hex (unless the user is typing in it), the rainbow's preview, the recent row
    const refresh = (opts = {}) => {
      const hx = curHex();
      swatches.forEach(b => b.classList.toggle('on', b.dataset.c === hx));
      if (document.activeElement !== hex) hex.value = hx;
      hex.classList.remove('bad'); rainbow.style.setProperty('--pick', hx);
      if (opts.recent !== false) fillRecent(); else recSec.querySelectorAll('.sw.recent').forEach(b => b.classList.toggle('on', b.dataset.recent === hx));
      if (this._picker && !opts.fromPicker) this._picker.sync(hx);
    };
    rainbow.style.setProperty('--pick', curHex());
  },
  // the Nyx palette: saturation/value square + hue slider + preview, next to the flyout (fixed position, inside the window)
  openPicker(o, btn, curHex, setColor) {
    this.closePicker();
    let hsv = NyxUI.hexToHsv(curHex()) || { h: 0, s: 0, v: 1 };
    const sv = h('div', { class: 'pk-sv', role: 'slider', tabindex: '0', 'aria-label': t('v2612.palette_sv') }, h('i', { class: 'pk-thumb' }));
    const hue = h('input', { class: 'pk-hue', type: 'range', min: '0', max: '360', step: '1', value: String(Math.round(hsv.h)), 'aria-label': t('v2612.palette_hue') });
    const prev = h('span', { class: 'pk-prev' }); const val = h('span', { class: 'pk-val' });
    const close = h('button', { class: 'pk-x', type: 'button', 'aria-label': t('close'), html: iconSvg('x', 13), onclick: () => this.closePicker() });
    const box = h('div', { class: 'fo-picker', role: 'dialog', 'aria-label': t('v2612.palette') }, h('div', { class: 'pk-top' }, h('span', { class: 'pk-title' }, t('v2612.palette')), close), sv, hue, h('div', { class: 'pk-row' }, prev, val));
    const paint = () => {
      const hx = NyxUI.hsvToHex(hsv.h, hsv.s, hsv.v);
      sv.style.setProperty('--hue', NyxUI.hsvToHex(hsv.h, 1, 1)); sv.firstChild.style.left = (hsv.s * 100) + '%'; sv.firstChild.style.top = ((1 - hsv.v) * 100) + '%';
      prev.style.background = hx; val.textContent = hx; return hx;
    };
    const live = (final) => { const hx = paint(); setColor(hx, { recent: final ? undefined : false, fromPicker: true }); };
    const fromPoint = (e) => { const r = sv.getBoundingClientRect(); hsv.s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); hsv.v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)); };
    sv.addEventListener('pointerdown', (e) => { e.preventDefault(); sv.setPointerCapture(e.pointerId); fromPoint(e); live(false); sv.focus(); });
    sv.addEventListener('pointermove', (e) => { if (!sv.hasPointerCapture(e.pointerId)) return; fromPoint(e); live(false); });
    sv.addEventListener('pointerup', (e) => { if (sv.hasPointerCapture(e.pointerId)) { sv.releasePointerCapture(e.pointerId); live(true); } });
    sv.addEventListener('keydown', (e) => {
      const st = e.shiftKey ? 0.1 : 0.02; const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
      if (!d) return; e.preventDefault(); e.stopPropagation(); hsv.s = Math.min(1, Math.max(0, hsv.s + d[0])); hsv.v = Math.min(1, Math.max(0, hsv.v + d[1])); live(true);
    });
    hue.addEventListener('input', () => { hsv.h = +hue.value; live(false); });
    hue.addEventListener('change', () => { hsv.h = +hue.value; live(true); });
    document.body.append(box);
    const place = () => { const fr = o.getBoundingClientRect(); const bw = box.offsetWidth, bh = box.offsetHeight; const br = btn.getBoundingClientRect(); let left = fr.right + 6; if (left + bw > innerWidth - 8) left = Math.max(8, fr.left - 6 - bw); const top = Math.min(Math.max(($('#titlebar')?.getBoundingClientRect().bottom || 0) + 8, br.top + br.height / 2 - bh / 2), innerHeight - 8 - bh); box.style.left = Math.round(left) + 'px'; box.style.top = Math.round(top) + 'px'; };
    const outside = (e) => { if (!box.contains(e.target) && !o.contains(e.target)) this.closePicker(); };
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closePicker(); btn.focus?.(); } };
    setTimeout(() => { if (this._picker && this._picker.box === box) { addEventListener('pointerdown', outside, true); addEventListener('keydown', esc, true); } }, 0);
    addEventListener('resize', place);
    btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open');
    this._picker = { box, btn, sync: (hx) => { const n = NyxUI.hexToHsv(hx); if (n) { hsv = n; hue.value = String(Math.round(n.h)); paint(); } }, off: () => { removeEventListener('pointerdown', outside, true); removeEventListener('keydown', esc, true); removeEventListener('resize', place); } };
    paint(); place();
    return box;
  },
  closePicker() {
    const p = this._picker; if (!p) return; this._picker = null;
    p.off(); p.box.remove(); if (p.btn.isConnected) { p.btn.setAttribute('aria-expanded', 'false'); p.btn.classList.remove('open'); }
  },
  // eyedropper: the browser's EyeDropper first (no permission, works inside the Nyx window); if it is missing, fails,
  // returns no colour or is cancelled → click on a card / stroke on the canvas to take its colour (read only)
  async eyedrop(apply) {
    if (typeof EyeDropper === 'function') {
      try { const r = await new EyeDropper().open(); const hx = NyxUI.toHex(r && r.sRGBHex); if (hx) { apply(hx); return 'eyedropper'; } } catch (e) { /* cancelled or failed → fallback */ }
    }
    this.pickFromCanvas(apply); return 'fallback';
  },
  pickFromCanvas(apply) {
    if (this._pick) this._pick.done();
    toast(t('v26111.drop_fallback'), { ms: 6000 });
    document.body.dataset.colorPick = '1';
    const done = () => { delete document.body.dataset.colorPick; removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); this._pick = null; };
    const down = (e) => {
      if (e.target.closest?.('#toolopts')) { done(); return; } // a click in the flyout ends the pick and works normally
      if (e.target.closest?.('#titlebar, #dock, #drawer, #modal, #ctxmenu')) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      let c = null;
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) { const n = el.closest?.('.item'); const it = n && Store.get(n.dataset.id); if (it) { c = NyxUI.itemColor(it); if (c) break; } }
      done();
      if (c) apply(c); else toast(t('v26111.drop_none'), { ms: 3500 });
    };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); toast(t('v26111.drop_cancel'), { ms: 2500 }); } };
    this._pick = { done };
    setTimeout(() => { if (this._pick && this._pick.done === done) { addEventListener('pointerdown', down, true); addEventListener('keydown', key, true); } }, 0);
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
    const op = NyxUI.inkOpacity(kind, S[kind + 'Opacity']); // v2.6.11.1: opacity % from the pen flyout (highlighter default 38 %)
    path.setAttribute('fill', color); path.setAttribute('opacity', op); svg.append(path);
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
      const item = Store.change(() => Store.addItem({ type: 'ink', kind, x: x0, y: y0, w: x1 - x0, h: y1 - y0, ow: x1 - x0, oh: y1 - y0, pts: rel, color, size, realPressure: real, opacity: op, z: host ? Store.maxZ() + 1 : kind === 'highlighter' ? Store.minZ() - 1 : undefined, ...(host ? { parent: host.id } : {}) }));
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
