'use strict';
const App = {
  async init() {
    await Store.load();
    const S = Store.state.settings; if ((S.lang || 'el') !== LANG) { setNyxLang(S.lang || 'el'); if (!sessionStorage.getItem('nyx.langReload')) { sessionStorage.setItem('nyx.langReload', '1'); location.reload(); return; } } sessionStorage.removeItem('nyx.langReload'); document.documentElement.lang = LANG;
    Theme.apply(S);
    hydrateIcons(); hydrateText();
    $('#btn-add-tab').innerHTML = iconSvg('plus', 16);
    Tools.buildDock(); Canvas.init(); Panels.tabs();
    if (Store.state.firstRun) this.welcome();
    Canvas.renderBoard(); Tools.pick('select');
    Features.initDrop(); this.wire(); this.keys(); this.ipc();
    $('#corner').classList.toggle('nomap', S.minimap === false);
    this.updateBadge(); setInterval(() => this.updateBadge(), 30000);
    setTimeout(() => Features.refreshAllShows(), 4000); setInterval(() => Features.refreshAllShows(), 3600e3);
    document.body.classList.add('ready');
    window.__nyxReady = true;
  },
  wire() {
    $('#btn-add-tab').onclick = () => this.newBoard();
    $('#btn-search').onclick = () => Panels.palette();
    $('#btn-reminders').onclick = () => Panels.reminders();
    $('#btn-subs').onclick = () => Panels.subs();
    $('#btn-theme').onclick = () => Panels.themes();
    $('#btn-settings').onclick = () => Panels.settings();
    $('#btn-widget').onclick = () => API ? API.toggleWidget() : toast('Widget: Windows app only');
    $('#drawer-close').onclick = () => Panels.closeDrawer();
    $('#z-in').onclick = () => Canvas.zoomAt(1.25);
    $('#z-out').onclick = () => Canvas.zoomAt(0.8);
    $('#z-val').onclick = () => Canvas.zoomTo(1);
    $('#z-fit').onclick = () => Canvas.fit();
    $('#z-map').onclick = () => { const S = Store.state.settings; S.minimap = S.minimap === false; $('#corner').classList.toggle('nomap', !S.minimap); Store.save(); Minimap.drawSoon(); };
    $('#palette').addEventListener('pointerdown', (e) => { if (e.target.id === 'palette') Panels.closePalette(); });
  },
  keys() {
    addEventListener('keydown', (e) => {
      const tg = e.target; const typing = tg.closest?.('input,textarea,select,[contenteditable=true]');
      if (e.key === 'F11') { e.preventDefault(); API?.toggleFullscreen(); return; }
      const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      // v2.3: while the browser is on top, its shortcuts win and canvas keys (Delete, tools, Ctrl+T new board…) don't fire behind it
      if (typeof Browser !== 'undefined' && Browser.isOn?.() && $('#modal').hidden) {
        if ((c && ['t', 'w', 'l', 'tab', 'r'].includes(k)) || k === 'f5' || (e.altKey && ['arrowleft', 'arrowright'].includes(k))) { e.preventDefault(); Browser.key({ k, shift: e.shiftKey, alt: e.altKey }); return; }
        if (e.key === 'Escape' && !typing) { e.preventDefault(); Browser.minimize(); return; }
        if (!(c && k === 'k')) return;
      }
      if (c && k === 'k') { e.preventDefault(); return Panels.palette(); }
      if (typing) return;
      if (typeof LogCopy !== 'undefined' && LogCopy.key && LogCopy.key(e)) return;
      if (e.key === ' ' && !e.repeat) { Canvas.spaceDown = true; document.body.classList.add('panning'); e.preventDefault(); return; }
      if (e.key === 'Escape') { if (!$('#modal').hidden) return; if (!$('#ctxmenu').hidden) return Panels.closeMenu(); if (!$('#drawer').hidden) return Panels.closeDrawer(); if (Voice.rec) { Voice.cancelled = true; return Voice.stop(); } Canvas.deselect(); Tools.pick('select'); return; }
      if (c) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); return this.undo(); }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); return this.redo(); }
        if (k === 'c') { e.preventDefault(); return Clip.copy(); }
        if (k === 'x') { e.preventDefault(); return Clip.copy(true); }
        if (k === 'd') { e.preventDefault(); return Actions.duplicate(); }
        if (k === 'a') { e.preventDefault(); return Canvas.select(Store.items().map(i => i.id)); }
        if (k === 'g') { e.preventDefault(); return e.shiftKey ? Actions.ungroup() : Actions.group(); }
        if (k === 'l') { e.preventDefault(); return Actions.toggleLock(); }
        if (k === 'e') { e.preventDefault(); return Panels.library(); }
        if (k === 't') { e.preventDefault(); return this.newBoard(); }
        if (k === 'r' && e.shiftKey) { e.preventDefault(); return Voice.toggle(); }
        if (k === '0') { e.preventDefault(); return Canvas.zoomTo(1); }
        if (k === '=' || k === '+') { e.preventDefault(); return Canvas.zoomAt(1.25); }
        if (k === '-') { e.preventDefault(); return Canvas.zoomAt(0.8); }
        if (e.key === 'Tab') { e.preventDefault(); const B = Store.state.boards; const i = B.findIndex(b => b.id === Store.state.active); return this.switchBoard(B[(i + (e.shiftKey ? -1 : 1) + B.length) % B.length].id); }
        if (/^[1-9]$/.test(k)) { const b = Store.state.boards[+k - 1]; if (b) { e.preventDefault(); this.switchBoard(b.id); } return; }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return Actions.del(); }
      if (e.key === 'Enter' && Canvas.sel.size === 1) { const it = Canvas.selItems()[0]; if (['text', 'sticky', 'shape', 'reminder'].includes(it.type)) { e.preventDefault(); return Canvas.edit(it.id); } }
      if (e.key.startsWith('Arrow') && Canvas.sel.size) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; return Actions.nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0); }
      if (e.key === ']') return Actions.zorder(1); if (e.key === '[') return Actions.zorder(-1);
      if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) return Canvas.fit();
      if (e.key === '+' || e.key === '=') return Canvas.zoomAt(1.2); if (e.key === '-') return Canvas.zoomAt(1 / 1.2);
      const map = { v: 'select', h: 'hand', p: 'pen', m: 'marker', i: 'highlighter', e: 'eraser', t: 'text', n: 'sticky', r: 'shape', a: 'arrow', l: 'line', f: 'frame' };
      if (map[k] && !e.altKey) { Tools.pick(map[k]); }
    });
    addEventListener('keyup', (e) => { if (e.key === ' ') { Canvas.spaceDown = false; document.body.classList.remove('panning'); } });
    addEventListener('blur', () => { Canvas.spaceDown = false; document.body.classList.remove('panning'); });
  },
  ipc() {
    if (!API) return;
    API.onReminder((p) => Features.onReminder(p));
    API.onSubFire((p) => Features.onSubFire(p));
    API.onTracker((r) => Features.onTracker(r));
    API.onFocusItem((id) => Canvas.focusItem(id));
    API.onQuickNote((text) => Agenda.op({ op: 'add', day: ymd(Date.now()), text })); // v2.3: quick notes go to today's agenda, not a paper on the canvas
    API.onAgendaOp?.((o) => Agenda.op(o));
    API.onWidgetState((s) => document.body.classList.toggle('widget-open', !!s?.open));
    API.onState?.(() => {});
  },
  undo() { if (Canvas.editing) return; if (Store.undo()) { Canvas.refresh(); Panels.refreshDrawer(); Features.refreshSubsCards(); Panels.tabs(); Panels.stylebar(); } },
  redo() { if (Canvas.editing) return; if (Store.redo()) { Canvas.refresh(); Panels.refreshDrawer(); Features.refreshSubsCards(); Panels.tabs(); Panels.stylebar(); } },
  switchBoard(id) {
    if (Store.state.active === id) return; if (Canvas.editing) Canvas.endEdit();
    Store.state.active = id; Store.save(); Panels.tabs(); Canvas.renderBoard(); Panels.stylebar(); Minimap.drawSoon(); Panels.refreshDrawer?.();
    $('#viewport').classList.remove('switching'); void $('#viewport').offsetWidth; $('#viewport').classList.add('switching');
  },
  newBoard() {
    const emos = ['🪐', '✨', '🚀', '🎧', '📚', '🧠', '🎮', '🛒', '💼', '🌿', '🔥', '🎨'];
    const base = LANG === 'el' ? t('app.001') : 'New board '; let n = Store.state.boards.length + 1; while (Store.state.boards.some(x => x.name === base + n)) n++;
    const b = { id: uid(), name: base + n, emoji: emos[Store.state.boards.length % emos.length], color: PALETTE[4 + Store.state.boards.length % 10], view: null, items: [] };
    Store.state.boards.push(b); Store.save(); this.switchBoard(b.id); setTimeout(() => Panels.renameBoard(b), 60);
  },
  duplicateBoard(b) { const c = structuredClone(b); c.id = uid(); c.name += ' (2)'; c.items.forEach(i => { i.id = uid(); if (i.reminder) i.reminder.on = false; }); const idx = Store.state.boards.indexOf(b); Store.state.boards.splice(idx + 1, 0, c); Store.save(); this.switchBoard(c.id); },
  deleteBoard(b) {
    if (Store.state.boards.length < 2) return toast(LANG === 'el' ? t('app.002') : 'Need at least one board');
    const go = () => { if (Canvas.editing) Canvas.endEdit(); const i = Store.state.boards.indexOf(b); if (i < 0) return; Store.state.boards.splice(i, 1); const tr = { b, i }; if (Store.state.active === b.id) { Store.state.active = Store.state.boards[Math.max(0, i - 1)].id; Canvas.renderBoard(); Panels.stylebar(); Minimap.drawSoon(); } Store.save(); Panels.tabs(); toast(`🗑️ ${b.name}`, { action: { label: t('undo'), fn: () => { if (Store.state.boards.includes(tr.b)) return; Store.state.boards.splice(Math.min(tr.i, Store.state.boards.length), 0, tr.b); Store.save(); this.switchBoard(tr.b.id); Panels.tabs(); } }, ms: 8000 }); };
    if (!b.items.length) return go();
    Panels.modal('🗑️ ' + esc(b.name), h('p', {}, LANG === 'el' ? t('app.003', { length: b.items.length }) : `Delete board with ${b.items.length} items?`), { okLabel: t('del'), ok: go });
  },
  setLang(l) { Store.state.settings.lang = l; setNyxLang(l); nyxAPI.setLang?.(l); Store.save(true); setTimeout(() => location.reload(), 150); },
  updateBadge() {
    let n = 0; const soon = Date.now() + 24 * 3600e3;
    for (const b of Store.state.boards) for (const it of b.items) if (it.reminder?.on && new Date(it.reminder.at) < soon) n++;
    for (const s of Store.state.subs) { if (s.active === false || !s.next) continue; const d = Subs.daysTo(s.next); if (d != null && d <= (s.remindDays ?? 2)) n++; }
    const bd = $('#rem-badge'); bd.hidden = !n; bd.textContent = n > 9 ? '9+' : n;
  },
  welcome() {
    const S = Store.state; S.firstRun = false; const b = S.boards[0]; if (b.items.length) return;
    const el = LANG === 'el'; const now = Date.now();
    const add = (o) => b.items.push({ id: uid(), r: 0, z: b.items.length + 1, created: now, ...o });
    add({ type: 'frame', x: -620, y: -330, w: 1240, h: 700, title: el ? t('app.004') : '✨ Welcome to Nyx', color: '#7c8cff', z: 0 });
    add({ type: 'text', x: -570, y: -270, w: 560, h: 80, html: el ? t('app.005') : '<b>Your infinite canvas</b>', font: 'Dela Gothic One', size: 34, color: '' });
    add({ type: 'text', x: -570, y: -175, w: 520, h: 150, html: el ? t('app.006') : '🖱️ Wheel = zoom · Space/middle = pan<br>✍️ Double-click anywhere = write<br>📂 Drop images, video, audio here<br>⌨️ Ctrl K = command palette · Ctrl E = emoji/stickers', font: 'Inter', size: 17, color: '' });
    add({ type: 'sticky', x: 40, y: -280, w: 250, h: 220, html: el ? t('app.007') : 'Sticky note 💛', paper: STICKY[0], font: 'Playpen Sans', size: 20, r: -3 });
    add({ type: 'sticky', x: 320, y: -250, w: 250, h: 220, html: el ? t('app.008') : 'Try themes 🎨 top-right', paper: STICKY[3], font: 'Mynerve', size: 21, r: 2.5 });
    add({ type: 'countdown', x: 40, y: 0, w: 340, h: 170, title: el ? t('app.009') : 'New Year', emoji: '🎆', target: new Date(new Date().getFullYear() + 1, 0, 1).toISOString(), color: '#f472b6' });
    add({ type: 'sticker', x: 420, y: 10, w: 140, h: 140, hex: '1f680', r: 8 });
    add({ type: 'reaction', x: -560, y: 30, w: 220, h: 90, text: el ? t('app.010') : 'AWESOME!', variant: 1, color: '#facc15', r: -6 });
    add({ type: 'icon', x: -300, y: 40, w: 90, h: 90, pack: 'lucide', name: 'sparkles', color: '#a78bfa', sw: 1.6, glow: true });
    add({ type: 'arrow', x1: -190, y1: 120, x2: 20, y2: 80, stroke: '#7c8cff', sw: 3, curve: 0.25, x: 0, y: 0, w: 0, h: 0 });
    const a = b.items[b.items.length - 1]; Arrow.fit(a);
    add({ type: 'emoji', x: -150, y: 170, w: 90, h: 90, char: '🌙' });
    Store.save();
  }
};
window.addEventListener('error', (e) => console.error('[nyx]', e.message));
document.addEventListener('DOMContentLoaded', () => App.init().catch(e => { console.error(e); document.body.append(h('pre', { class: 'fatal' }, String(e.stack || e))); }));
