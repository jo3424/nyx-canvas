'use strict';
// State, persistence, undo/redo
const DEFAULT_SETTINGS = { theme: 'midnight', custom: {}, lang: 'el', wheel: 'zoom', zoomSpeed: 1, closeToTray: true, anim: true, snap: true, tmdbKey: '', minimap: true, widget: { open: false, opacity: 0.94, onTop: true }, penColor: '#ffffff', penSize: 4, markerColor: '#ffd23f', hlColor: '#ffe14d', shapeKind: 'rect', recentEmoji: [], recentLib: [] };

const Store = {
  state: null, mediaBase: '', saveTimer: null, undoStack: [], redoStack: [], pending: null, dirty: false, info: {},
  board() { return this.state.boards.find(b => b.id === this.state.active) || this.state.boards[0]; },
  items() { return this.board().items; },
  find(id) { for (const b of this.state.boards) { const it = b.items.find(i => i.id === id); if (it) return { item: it, board: b }; } return null; },
  get(id) { return this.items().find(i => i.id === id); },
  maxZ() { return this.items().reduce((m, i) => Math.max(m, i.z || 0), 0); },
  minZ() { return this.items().reduce((m, i) => Math.min(m, i.z || 0), 0); },

  fresh() {
    const b1 = { id: uid(), name: t('store.001'), emoji: '🌙', color: '#7c8cff', view: { x: 0, y: 0, z: 1 }, items: [] };
    return { v: 1, boards: [b1, { id: uid(), name: t('store.002'), emoji: '💡', color: '#ffd23f', view: { x: 0, y: 0, z: 1 }, items: [] }, { id: uid(), name: t('store.003'), emoji: '🎬', color: '#ff5d8f', view: { x: 0, y: 0, z: 1 }, items: [] }], active: b1.id, subs: [], library: { memes: [] }, settings: structuredClone(DEFAULT_SETTINGS), firedSubs: [], created: new Date().toISOString(), firstRun: true };
  },
  async load() {
    let text = null;
    if (API) { const r = await API.load(); text = r.text; this.mediaBase = r.mediaBase; this.info = r; }
    else { text = localStorage.getItem('nyx-state'); this.mediaBase = ''; }
    window.MEDIA_BASE = this.mediaBase;
    let s = null; try { s = text ? JSON.parse(text) : null; } catch (e) { console.error('state parse', e); }
    if (!s || !Array.isArray(s.boards) || !s.boards.length) s = this.fresh();
    s.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(s.settings || {}) };
    s.settings.widget = { ...DEFAULT_SETTINGS.widget, ...(s.settings.widget || {}) };
    s.subs ||= []; s.library ||= { memes: [] }; s.library.memes ||= []; s.firedSubs ||= [];
    for (const b of s.boards) { b.items ||= []; b.view ||= { x: 0, y: 0, z: 1 }; }
    this.state = s;
  },
  serialize() { return JSON.stringify(this.state); },
  // gen: bumped on every change; a save only clears `dirty` if nothing changed while it was writing.
  // Saves are chained so two writes never overlap (the main process also orders them).
  gen: 0, saving: Promise.resolve(),
  save(now) {
    clearTimeout(this.saveTimer);
    this.gen++; this.dirty = true; document.body.classList.add('unsaved');
    const run = () => (this.saving = this.saving.catch(() => {}).then(async () => {
      const gen = this.gen; const text = this.serialize();
      try { if (API) await API.save(text); else localStorage.setItem('nyx-state', text); if (gen === this.gen) { this.dirty = false; document.body.classList.remove('unsaved'); } }
      catch (e) { console.error('save failed', e); toast('⚠️ ' + t('v26.save_failed', { err: e.message }), { kind: 'err' }); }
    }));
    if (now) return run();
    this.saveTimer = setTimeout(run, 350);
  },
  // v2.2: synchronous flush (beforeunload, hide-to-tray, quit) so a pending debounced save is never lost
  flushSync() {
    if (!this.dirty || !this.state) return false;
    clearTimeout(this.saveTimer);
    try { const gen = this.gen; const text = this.serialize(); if (API?.saveSync) { const r = API.saveSync(text); if (r?.ok && gen === this.gen) { this.dirty = false; document.body.classList.remove('unsaved'); return true; } } else if (!API) { localStorage.setItem('nyx-state', text); this.dirty = false; return true; } } catch (e) { console.error('flush failed', e); }
    return false;
  },
  // ---- history: v2 snapshots cover every board + agenda + subs (needed for MCP cross-board moves, create_board, reminders).
  // Stack entries are { snap, label }; older string-only entries are still accepted.
  snap() {
    return JSON.stringify({
      v: 2, b: this.state.active, items: this.items(), subs: this.state.subs, agenda: this.state.agenda || [],
      boards: this.state.boards.map(b => ({ id: b.id, name: b.name, emoji: b.emoji, color: b.color, view: b.view, items: b.items })),
    });
  },
  entrySnap(e) { return (e && typeof e === 'object' && typeof e.snap === 'string') ? e.snap : e; },
  entryLabel(e) { return (e && typeof e === 'object' && e.label) ? e.label : ''; },
  lastUndoLabel() { return this.entryLabel(this.undoStack[this.undoStack.length - 1]); },
  begin() { if (!this.pending) this.pending = this.snap(); },
  commit(label) {
    if (!this.pending) { this.save(); return; }
    const now = this.snap();
    if (now !== this.pending) { this.undoStack.push({ snap: this.pending, label: label || '' }); if (this.undoStack.length > 150) this.undoStack.shift(); this.redoStack = []; }
    this.pending = null; this.save();
  },
  change(fn, label) { this.begin(); const r = fn(); this.commit(label); return r; },
  restore(snapText) {
    const s = JSON.parse(this.entrySnap(snapText));
    if (s.v === 2 && Array.isArray(s.boards)) {
      const cur = new Map(this.state.boards.map(b => [b.id, b]));
      this.state.boards = s.boards.map(sb => {
        const b = cur.get(sb.id) || { id: sb.id, name: sb.name, emoji: sb.emoji, color: sb.color, view: sb.view || { x: 0, y: 0, z: 1 }, items: [] };
        b.name = sb.name; b.emoji = sb.emoji; b.color = sb.color; if (sb.view) b.view = sb.view; b.items = sb.items || [];
        return b;
      });
      this.state.subs = s.subs;
      if (s.agenda) this.state.agenda = s.agenda;
      if (s.b) this.state.active = s.b;
      return;
    }
    const b = this.state.boards.find(x => x.id === s.b); if (!b) return;
    b.items = s.items; this.state.subs = s.subs;
    if (this.state.active !== s.b) this.state.active = s.b;
  },
  undo() { if (!this.undoStack.length) return false; this.redoStack.push({ snap: this.snap(), label: this.lastUndoLabel() }); this.restore(this.undoStack.pop()); this.save(); return true; },
  redo() { if (!this.redoStack.length) return false; this.undoStack.push({ snap: this.snap(), label: this.entryLabel(this.redoStack[this.redoStack.length - 1]) }); this.restore(this.redoStack.pop()); this.save(); return true; },

  addItem(it, board) {
    const b = board || this.board();
    it.id ||= uid(); it.z ??= (b.items.reduce((m, i) => Math.max(m, i.z || 0), 0) + 1); it.r ||= 0; it.created ||= Date.now();
    b.items.push(it); return it;
  },
  removeItems(ids) { const set = new Set(ids); const b = this.board(); b.items = b.items.filter(i => !set.has(i.id)); },
  media(file) { return file ? (/^(https?:|data:|blob:)/.test(file) ? file : this.mediaBase + encodeURIComponent(file)) : ''; },
};

window.addEventListener('beforeunload', () => { try { Store.flushSync(); } catch (e) {} });
if (window.nyxAPI?.onFlush) window.nyxAPI.onFlush(() => { try { Store.flushSync(); } catch (e) {} });
