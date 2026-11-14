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
    this.state = s; this.savedSubIds = (s.subs || []).map(x => String(x.id)); this.rememberSubNames();
  },
  serialize() { return JSON.stringify(this.state); },
  // gen: bumped on every change; a save only clears `dirty` if nothing changed while it was writing.
  // Saves are chained so two writes never overlap (the main process also orders them).
  gen: 0, saving: Promise.resolve(),
  save(now) {
    clearTimeout(this.saveTimer);
    this.gen++; this.dirty = true; document.body.classList.add('unsaved');
    const run = () => (this.saving = this.saving.catch(() => {}).then(async () => {
      const gen = this.gen; await this.subsGuard(); const text = this.serialize();
      try { if (API) await API.save(text); else localStorage.setItem('nyx-state', text); if (gen === this.gen) { this.dirty = false; document.body.classList.remove('unsaved'); } }
      catch (e) { console.error('save failed', e); toast('⚠️ ' + t('v26.save_failed', { err: e.message }), { kind: 'err' }); }
    }));
    if (now) return run();
    this.saveTimer = setTimeout(run, 350);
  },
  // v2.6.9.3: one save that drops SUBS_DROP_WARN or more subscriptions → a labelled snapshot of the previous file first
  // and a visible warning with the names (the save itself still happens: nothing is blocked or hidden).
  SUBS_DROP_WARN: 2, savedSubIds: null,
  async subsGuard() {
    const ids = (this.state.subs || []).map(s => String(s.id));
    const prev = this.savedSubIds; this.savedSubIds = ids;
    const gone = prev ? NyxUndo.subsDropped(prev, this.state.subs) : [];
    const names = gone.map(id => (this._subNames && this._subNames[id]) || id);
    this.rememberSubNames(true);
    if (gone.length < this.SUBS_DROP_WARN) return;
    let snap = '';
    try { if (API?.inv) snap = await API.inv('snap:create', 'pre-subs-drop') || ''; } catch (e) {}
    try { toast('⚠️ ' + t('v2693.subs_drop_warn', { v0: gone.length, v1: names.join(', '), v2: snap ? t('v2693.subs_drop_snap') : '' }), { kind: 'err', ms: 15000 }); } catch (e) {}
    this.lastSubsDrop = { n: gone.length, names, snap, at: Date.now() };
  },
  rememberSubNames(merge) { if (!merge || !this._subNames) this._subNames = {}; for (const s of this.state.subs || []) this._subNames[String(s.id)] = s.name; },
  // v2.2: synchronous flush (beforeunload, hide-to-tray, quit) so a pending debounced save is never lost
  flushSync() {
    if (!this.dirty || !this.state) return false;
    clearTimeout(this.saveTimer);
    try { const gen = this.gen; const text = this.serialize(); if (API?.saveSync) { const r = API.saveSync(text); if (r?.ok && gen === this.gen) { this.dirty = false; document.body.classList.remove('unsaved'); return true; } } else if (!API) { localStorage.setItem('nyx-state', text); this.dirty = false; return true; } } catch (e) { console.error('flush failed', e); }
    return false;
  },
  // ---- history (v2.6.9.3): change-based. Each entry keeps only what ONE action changed ({ ch, label }, see
  // js/v26/undo.js); undo/redo apply those changes to the current state and never replace a whole list.
  // snap()/restore() stay for callers that need a before-picture (MCP batch): restore() also works by changes now.
  snap() {
    return JSON.stringify({
      v: 2, b: this.state.active, items: this.items(), subs: this.state.subs, agenda: this.state.agenda || [],
      boards: this.state.boards.map(b => ({ id: b.id, name: b.name, emoji: b.emoji, color: b.color, view: b.view, items: b.items })),
    });
  },
  pic() { return JSON.stringify(NyxUndo.capture(this.state)); },
  entryLabel(e) { return (e && typeof e === 'object' && e.label) ? e.label : ''; },
  lastUndoLabel() { return this.entryLabel(this.undoStack[this.undoStack.length - 1]); },
  begin() { if (!this.pending) this.pending = this.pic(); },
  commit(label) {
    if (!this.pending) { this.save(); return; }
    const now = this.pic();
    if (now !== this.pending) {
      const ch = NyxUndo.diff(JSON.parse(this.pending), JSON.parse(now));
      if (!NyxUndo.empty(ch)) { this.undoStack.push({ ch, label: label || '' }); if (this.undoStack.length > 150) this.undoStack.shift(); this.redoStack = []; }
    }
    this.pending = null; this.save();
  },
  change(fn, label) { this.begin(); const r = fn(); this.commit(label); return r; },
  // a snap() text (or a parsed one) → the picture NyxUndo compares against the current state
  picOf(snapText) {
    const s = typeof snapText === 'string' ? JSON.parse(snapText) : snapText;
    if (s && s.v === 2 && Array.isArray(s.boards)) return { active: s.b, boards: s.boards, subs: Array.isArray(s.subs) ? s.subs : null, agenda: Array.isArray(s.agenda) ? s.agenda : null };
    const cur = NyxUndo.capture(JSON.parse(JSON.stringify(this.state)));
    return { ...cur, boards: cur.boards.map(b => b.id === s.b ? { ...b, items: s.items || [] } : b), subs: Array.isArray(s.subs) ? s.subs : null };
  },
  // what going back to an older picture would change (for the visible confirmation)
  // opts.subs === false: leave subscriptions out (e.g. an MCP batch, which has no subscription tools)
  restorePlan(snapText, opts) { const ch = NyxUndo.diff(this.picOf(snapText), JSON.parse(this.pic())); if (opts && opts.subs === false) ch.subs = []; return { ch, sum: NyxUndo.summary(this.state, ch, 'undo') }; },
  restore(snapText, opts) { const { ch } = this.restorePlan(snapText, opts); return NyxUndo.apply(this.state, ch, 'undo'); },
  peekUndo() { const e = this.undoStack[this.undoStack.length - 1]; return e && e.ch ? NyxUndo.summary(this.state, e.ch, 'undo') : null; },
  peekRedo() { const e = this.redoStack[this.redoStack.length - 1]; return e && e.ch ? NyxUndo.summary(this.state, e.ch, 'redo') : null; },
  lastApply: null,
  undo() {
    const e = this.undoStack.pop(); if (!e) return false;
    if (!e.ch) { this.lastApply = null; return this.undo(); } // pre-2.6.9.3 entry shape: never restored wholesale
    this.lastApply = NyxUndo.apply(this.state, e.ch, 'undo'); this.redoStack.push(e); this.save(); return true;
  },
  redo() {
    const e = this.redoStack.pop(); if (!e) return false;
    this.lastApply = NyxUndo.apply(this.state, e.ch, 'redo'); this.undoStack.push(e); this.save(); return true;
  },

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
