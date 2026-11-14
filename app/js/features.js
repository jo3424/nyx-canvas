'use strict';
// Actions, clipboard, import/drop, media, reminders, countdowns, shows, trackers, subscriptions, voice, backup
const Actions = {
  del() { let ids = [...Canvas.sel]; if (!ids.length) return; ids = ids.concat(Canvas.kids(new Set(ids)).map(k => k.id)); // v2.3: attached text goes with its note (undo restores both)
    Store.change(() => Store.removeItems(ids)); ids.forEach(id => Items.unmount(id)); Canvas.sel.clear(); Canvas.refresh(); Panels.stylebar(); toast(`🗑️ ${t('deleted')} (${ids.length})`, { action: { label: t('undo'), fn: () => App.undo() } }); },
  duplicate() { const items = Canvas.selItems(); if (!items.length) return; const copies = Clip.clone(items, 30, 30); Canvas.select(copies.map(c => c.id)); },
  zorder(dir) { const items = Canvas.selItems(); Store.change(() => { let z = dir > 0 ? Store.maxZ() : Store.minZ(); items.sort((a, b) => (a.z || 0) - (b.z || 0)); (dir > 0 ? items : items.reverse()).forEach(i => { if (i.type === 'frame') return; z += dir; i.z = z; }); }); items.forEach(i => Items.mount(i)); Canvas.kids(new Set(items.map(i => i.id))).forEach(k => { const n = Items.el(k); if (n) Items.place(n, k); }); },
  toggleLock() { const items = Canvas.selItems(); const v = !items.every(i => i.locked); Store.change(() => items.forEach(i => { i.locked = v; })); items.forEach(i => Items.mount(i)); Canvas.drawSel(); Panels.stylebar(); toast((v ? '🔒 ' + t('locked') : '🔓 ' + t('unlocked'))); },
  togglePin() { const items = Canvas.selItems(); const v = !items.every(i => i.pinned); Store.change(() => items.forEach(i => { i.pinned = v; })); items.forEach(i => Items.mount(i)); Panels.stylebar(); toast(v ? '📌 ' + t('pin') : t('unpin')); },
  group() { const items = Canvas.selItems(); if (items.length < 2) return; const g = uid(); Store.change(() => items.forEach(i => { i.group = g; })); toast('🔗 ' + t('group')); },
  ungroup() { const items = Canvas.selItems(); Store.change(() => items.forEach(i => { delete i.group; })); toast(t('ungroup')); },
  moveTo(board) { const items = Canvas.selItems(); const ids = items.map(i => i.id); Store.change(() => { Store.removeItems(ids); }); for (const it of items) { it.z = undefined; Store.addItem(it, board); } Store.save(); ids.forEach(id => Items.unmount(id)); Canvas.sel.clear(); Canvas.refresh(); Panels.tabs(); toast(`→ ${board.emoji || ''} ${board.name}`, { action: { label: t('open'), fn: () => { App.switchBoard(board.id); Canvas.fit(Store.items().filter(i => ids.includes(i.id))); } } }); },
  nudge(dx, dy) { let items = Canvas.selItems().filter(i => !i.locked); if (!items.length) return; items = items.concat(Canvas.kids(new Set(items.map(i => i.id)))); Store.change(() => items.forEach(i => { i.x += dx; i.y += dy; if (i.x1 != null) { i.x1 += dx; i.x2 += dx; i.y1 += dy; i.y2 += dy; } })); items.forEach(i => Items.place(Items.el(i), i)); Canvas.drawSel(); },
};

const Clip = {
  data: null, text: '',
  clone(items, dx, dy, at) {
    const bb = bounds(items); const gmap = {};
    if (at) { dx = at.x - (bb.x + bb.w / 2); dy = at.y - (bb.y + bb.h / 2); }
    const out = Store.change(() => items.map(src => { const c = structuredClone(src); c.id = uid(); c.x += dx; c.y += dy; delete c.z; c.pinned = false; if (c.x1 != null) { c.x1 += dx; c.x2 += dx; c.y1 += dy; c.y2 += dy; } if (c.group) c.group = gmap[c.group] ||= uid(); if (c.reminder) c.reminder = { ...c.reminder, on: false }; return Store.addItem(c); }));
    out.forEach(i => Items.mount(i)); Minimap.drawSoon(); Canvas.emptyHint(); return out;
  },
  copy(cut) {
    const items = Canvas.selItems(); if (!items.length) return;
    this.data = structuredClone(items); this.text = items.map(i => Features.searchText(i)).filter(Boolean).join('\n') || '[nyx]';
    navigator.clipboard.writeText(this.text).catch(() => {});
    if (cut) Actions.del(); else toast('📋 ' + t('copied') + ` (${items.length})`);
  },
  async paste(at, e) {
    at ||= Features.mouseWorld || Canvas.center();
    const dt = e?.clipboardData;
    if (dt && dt.files && dt.files.length) return Features.importFiles([...dt.files], at);
    let txt = dt ? dt.getData('text/plain') : await navigator.clipboard.readText().catch(() => '');
    if (this.data && (txt === this.text || (!txt && !dt))) { const c = this.clone(this.data, 0, 0, at); Canvas.select(c.map(i => i.id)); return; }
    if (!dt && API) { const png = await API.readClipboardImage(); if (png) { const r = await API.importBuffer('clipboard.png', png); return Features.addMedia(r, at.x, at.y); } }
    const html = dt?.getData('text/html');
    if (txt && /^https?:\/\/\S+$/i.test(txt.trim())) return Features.addLinkUrl(txt.trim(), at);
    if (txt || html) { const it = Features.addAt({ type: 'text', w: 360, h: 40, html: html ? sanitize(html).slice(0, 50000) : esc(txt).replace(/\n/g, '<br>'), font: 'Inter', size: 18 }, at.x, at.y); return it; }
  }
};

const Library = {
  async ensurePack(p) { if (!p || NYX_DATA[p]) return; await loadScript(`assets/data/${p}.js`); }
};

const Features = {
  mouseWorld: null,
  addAt(payload, x, y, edit) {
    const it = Store.change(() => Store.addItem({ w: 200, h: 120, ...payload, x: x - (payload.w || 200) / 2, y: y - (payload.h || 120) / 2 }));
    Items.mount(it); Canvas.select([it.id]); Minimap.drawSoon(); Canvas.emptyHint(); Panels.tabs();
    if (edit) setTimeout(() => Canvas.edit(it.id), 30);
    return it;
  },
  addAtCenter(payload, edit) { const c = Canvas.center(); const jitter = () => (Math.random() - 0.5) * 60; return this.addAt(payload, c.x + jitter(), c.y + jitter(), edit); },
  itemTitle(it) {
    const s = { text: plainText(it.html), sticky: plainText(it.html), shape: plainText(it.html), reminder: plainText(it.html), image: it.caption || it.name, video: it.name, audio: it.title || it.name, link: it.title || it.url, file: it.name, emoji: it.char, sticker: '🌟 sticker', icon: '✦ ' + it.name, frame: it.title, countdown: (it.emoji || '⏳') + ' ' + it.title, show: it.title, subs: '💳 ' + t('subs'), tracker: '🔎 ' + (it.keyword || '') + ' @ ' + hostOf(it.url), ink: '✏️ ' + t('t_pen'), reaction: it.text, arrow: '→', line: '—' }[it.type];
    return (s || it.type).toString().slice(0, 90) || it.type;
  },
  searchText(it) { return [plainText(it.html), it.title, it.name, it.caption, it.url, it.keyword, it.char, it.text, it.desc, (it.snippets || []).join(' '), it.reminder?.msg].filter(Boolean).join(' '); },
  // ---------- import ----------
  kindOf(name, mime) { mime ||= ''; if (/^image\//.test(mime) || /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(name)) return 'image'; if (/^video\//.test(mime) || /\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(name)) return 'video'; if (/^audio\//.test(mime) || /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba)$/i.test(name)) return 'audio'; if (/\.(txt|md|csv|json|log)$/i.test(name)) return 'text'; return 'file'; },
  async importFiles(files, at) {
    if (!files.length) return; let i = 0; const cols = Math.ceil(Math.sqrt(files.length)); const placed = [];
    toast(`⬇️ ${files.length} …`, { ms: 1200 });
    for (const f of files) {
      const x = at.x + (i % cols) * 360, y = at.y + Math.floor(i / cols) * 300; i++;
      try {
        const kind = this.kindOf(f.name, f.type);
        if (kind === 'text' && f.size < 200000) { const txt = await f.text(); placed.push(this.addAt({ type: 'text', w: 420, h: 60, html: esc(txt).replace(/\n/g, '<br>'), font: /\.md$/.test(f.name) ? 'Inter' : 'JetBrains Mono', size: 15, bg: 'var(--card)' }, x, y)); continue; }
        const p = API?.pathForFile(f); let r;
        if (p) r = await API.importPath(p); else if (API) r = await API.importBuffer(f.name || 'file', new Uint8Array(await f.arrayBuffer())); else r = { file: URL.createObjectURL(f), name: f.name, mime: f.type, size: f.size };
        placed.push(await this.addMedia(r, x, y));
      } catch (e) { console.error(e); toast('⚠️ ' + f.name + ': ' + e.message, { kind: 'err' }); }
    }
    if (placed.length > 1) Canvas.select(placed.filter(Boolean).map(p => p.id));
  },
  async importPaths(paths, at) {
    let i = 0; const cols = Math.ceil(Math.sqrt(paths.length)); const out = [];
    for (const p of paths) { const x = at.x + (i % cols) * 360, y = at.y + Math.floor(i / cols) * 300; i++; try { out.push(await this.addMedia(await API.importPath(p), x, y)); } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); } }
    return out;
  },
  measureImg(src) { return new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: 400, h: 300 }); im.src = src; }); },
  measureVideo(src) { return new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => res({ w: v.videoWidth || 640, h: v.videoHeight || 360 }); v.onerror = () => res({ w: 640, h: 360 }); v.src = src; setTimeout(() => res({ w: 640, h: 360 }), 4000); }); },
  async addMedia(r, x, y) {
    const kind = this.kindOf(r.name || r.file, r.mime);
    if (kind === 'image') {
      let info = API ? await API.thumb(r.file) : null; if (!info) info = await this.measureImg(Store.media(r.file));
      const sc = Math.min(1, 480 / Math.max(info.w, info.h)); return this.addAt({ type: 'image', file: r.file, thumb: info.thumb || undefined, name: r.name, w: Math.max(40, info.w * sc), h: Math.max(40, info.h * sc) }, x, y);
    }
    if (kind === 'video') { const m = await this.measureVideo(Store.media(r.file)); const w = Math.min(560, m.w); return this.addAt({ type: 'video', file: r.file, name: r.name, w, h: w * m.h / m.w + 30 }, x, y); }
    if (kind === 'audio') return this.addAt({ type: 'audio', file: r.file, name: r.name, w: 340, h: 110 }, x, y);
    return this.addAt({ type: 'file', file: r.file, name: r.name, size: r.size, w: 300, h: 76 }, x, y);
  },
  async pickAndAdd(kind, at) { if (!API) return; const paths = await API.pickFiles(kind); if (paths.length) this.importPaths(paths, at || Canvas.center()); },
  async importMemes(folder) {
    if (!API) return; const paths = folder ? await API.pickFolderImages() : await API.pickFiles('image'); if (!paths.length) return;
    let n = 0;
    for (const p of paths) { try { const r = await API.importPath(p); const info = (await API.thumb(r.file)) || await this.measureImg(Store.media(r.file)); const sc = Math.min(1, 380 / Math.max(info.w, info.h)); Store.state.library.memes.push({ file: r.file, thumb: info.thumb || undefined, name: r.name.replace(/\.[^.]+$/, ''), w: Math.round(info.w * sc), h: Math.round(info.h * sc) }); n++; } catch (e) { console.error(e); } }
    Store.save(); toast(`🖼️ +${n} memes`);
  },
  // drop / paste / drag-out wiring lives in js/v26/dnd.js since v2.6.1 (it replaces this method before App.init runs)
  initDrop() { DnD.init(); },
  // ---------- links ----------
  addLink(at) { const f = form([['url', 'URL', 'url', '', { placeholder: t('link_ph') }]]); Panels.modal('🔗 ' + t('ins_link'), f.el, { ok: () => { const u = f.val().url.trim(); if (!/^https?:\/\//.test(u)) return false; this.addLinkUrl(u, at); } }); },
  async addLinkUrl(url, at) {
    at ||= Canvas.center(); const it = this.addAt({ type: 'link', url, title: hostOf(url), w: 340, h: 280 }, at.x, at.y);
    if (API) { const info = await API.linkInfo(url).catch(() => null); if (info) { Object.assign(it, { title: info.title || hostOf(url), desc: info.desc || '', image: info.image || '' }); if (!info.image) it.h = 130; Items.mount(it); Store.save(); Canvas.drawSel(); } }
    return it;
  },
  // ---------- frame ----------
  renameFrame(it) { const f = form([['title', LANG === 'el' ? t('features.001') : 'Frame title', 'text', it.title]]); Panels.modal('🖼️ ' + t('ins_frame'), f.el, { ok: () => { Store.change(() => { it.title = f.val().title; }); Items.mount(it); } }); },
  // ---------- card actions ----------
  cardAction(act, it) {
    if (act === 'open-link') { API?.openExternal(it.url); if (it.changed) { it.changed = false; Items.mount(it); Store.save(); } }
    if (act === 'open-file') API?.openMedia(it.file);
    if (act === 'check-tracker') this.checkTracker(it, true);
    if (act === 'refresh-show') this.refreshShow(it, true);
    if (act === 'open-subs') Panels.subs();
  },
  editItem(it) {
    if (it.type === 'countdown') return this.newCountdown(null, it);
    if (it.type === 'tracker') return this.newTracker(null, it);
    if (it.type === 'show') return this.editShow(it);
    if (it.type === 'subs') return Panels.subs();
    if (it.type === 'link') { const f = form([['url', 'URL', 'url', it.url], ['title', LANG === 'el' ? t('features.002') : 'Title', 'text', it.title], ['desc', LANG === 'el' ? t('features.003') : 'Description', 'textarea', it.desc]]); Panels.modal('🔗', f.el, { ok: () => { const v = f.val(); Store.change(() => Object.assign(it, v)); Items.mount(it); } }); }
    if (it.type === 'file') API?.openMedia(it.file);
  },
  // ---------- reminders ----------
  // v2.3: one modal — a real title is required for new reminder cards (no more generic «Υπενθύμιση» cards); cancel creates nothing
  reminderModal(it, opts = {}) {
    const isNew = !it; const base = isNew ? { type: 'reminder' } : it;
    const r = base.reminder || { on: true, at: toLocalInput(Date.now() + 3600e3), repeat: 'none', sound: 'chime', msg: '' };
    const fields = [['at', t('rem_when'), 'datetime-local', toLocalInput(r.at)], ['repeat', t('rem_repeat'), 'select', r.repeat || 'none', ['none', 'daily', 'weekly', 'monthly', 'yearly'].map(k => [k, t('rep_' + k)])], ['sound', t('rem_sound'), 'select', r.sound || 'chime', [...Object.entries(SOUNDS), ['none', '🔇']]]];
    const needTitle = isNew || base.type === 'reminder';
    fields.unshift(needTitle ? ['msg', t('v23.rem_title'), 'text', r.msg || (isNew ? (opts.text || '') : plainText(base.html)), { placeholder: t('features.008') }] : ['msg', t('rem_msg'), 'text', r.msg || '', { placeholder: this.itemTitle(base) }]);
    const f = form(fields);
    const q = (label, fn) => h('button', { class: 'chip', onclick: () => { f.inputs.at.value = toLocalInput(fn()); } }, label);
    const tm = (hh, add = 0) => { const d = new Date(); d.setDate(d.getDate() + add); d.setHours(hh, 0, 0, 0); return d; };
    f.el.children[0].after(h('div', { class: 'chips' }, q('+10′', () => Date.now() + 600e3), q('+30′', () => Date.now() + 1800e3), q('+1h', () => Date.now() + 3600e3), q('+3h', () => Date.now() + 3 * 3600e3), q((LANG === 'el' ? t('features.004') : 'Tonight') + ' 21:00', () => tm(21)), q((LANG === 'el' ? t('features.005') : 'Tomorrow') + ' 09:00', () => tm(9, 1)), q('+1 ' + (LANG === 'el' ? t('features.006') : 'wk'), () => Date.now() + 7 * 864e5)));
    const test = h('button', { class: 'btn ghost', onclick: () => playSound(f.inputs.sound.value) }, iconSvg('volume-2', 15), ' ' + t('rem_test'));
    f.inputs.sound.onchange = () => playSound(f.inputs.sound.value);
    const extra = [test]; if (!isNew && it.reminder?.on) extra.push(h('button', { class: 'btn ghost danger', onclick: () => { Store.change(() => { it.reminder.on = false; }); Items.mount(it); Panels.refreshDrawer(); App.updateBadge(); $('#modal-close').click(); } }, t('rem_off')));
    setTimeout(() => f.inputs.msg?.focus(), 60);
    Panels.modal('⏰ ' + (isNew ? t('ins_reminder') : t('rem_set')), f.el, { extra, ok: () => {
      const v = f.val(); const msg = (v.msg || '').trim();
      if (!v.at) { f.inputs.at.classList.add('bad'); return false; }
      if (needTitle && !msg) { f.inputs.msg.classList.add('bad'); f.inputs.msg.focus(); toast(t('v23.rem_need_title'), { kind: 'err', ms: 3500 }); return false; }
      const rem = { on: true, at: new Date(v.at).toISOString(), repeat: v.repeat, sound: v.sound, msg };
      if (isNew) { const at = opts.at || Canvas.center(); it = this.addAt({ type: 'reminder', w: 320, h: 96, html: esc(msg), font: 'Inter', size: 18, reminder: rem }, at.x, at.y); }
      else Store.change(() => { it.reminder = rem; if (it.type === 'reminder' && msg) it.html = esc(msg); });
      Items.mount(it); Panels.stylebar(); Panels.refreshDrawer(); App.updateBadge(); toast('⏰ ' + msg.slice(0, 40) + (msg ? ' · ' : '') + fmtDate(it.reminder.at));
    } });
  },
  newReminderCard(at, text) { return this.reminderModal(null, { at, text }); },
  // v2.3: remove a reminder (× in the list). Reminder cards are deleted; other items just lose their alarm. Undo restores.
  removeReminder(it, boardId) {
    const b = Store.state.boards.find(x => x.id === boardId) || Store.find(it.id)?.board; if (!b) return;
    const idx = b.items.indexOf(it), wasCard = it.type === 'reminder', prev = it.reminder;
    if (wasCard) { b.items.splice(idx, 1); if (b.id === Store.state.active) Items.unmount?.(it.id); }
    else { delete it.reminder; if (b.id === Store.state.active) Items.mount(it); }
    Store.save(); Panels.refreshDrawer(); App.updateBadge();
    toast(t('v23.rem_removed', { v0: (prev?.msg || this.itemTitle(it)).slice(0, 40) }), { ms: 6000, action: { label: t('undo'), fn: () => { if (wasCard) b.items.splice(Math.min(idx, b.items.length), 0, it); else it.reminder = prev; Store.save(); if (b.id === Store.state.active) Items.mount(it); Panels.refreshDrawer(); App.updateBadge(); } } });
  },
  nextOccurrence(at, rep) { const d = new Date(at); const now = Date.now(); let guard = 0; while (d.getTime() <= now && guard++ < 5000) { if (rep === 'daily') d.setDate(d.getDate() + 1); else if (rep === 'weekly') d.setDate(d.getDate() + 7); else if (rep === 'monthly') d.setMonth(d.getMonth() + 1); else if (rep === 'yearly') d.setFullYear(d.getFullYear() + 1); else break; } return d.toISOString(); },
  onReminder(p) {
    const f = Store.find(p.id); if (!f) return;
    const it = f.item; const r = it.reminder; if (!r || r.at !== p.at) return;
    playSound(p.sound || r.sound || 'chime');
    toast(p.title, { icon: 'bell-ring', kind: 'alarm', ms: 15000, action: { label: LANG === 'el' ? t('features.009') : 'Show', fn: () => Canvas.focusItem(it.id) } });
    if (r.repeat && r.repeat !== 'none') r.at = this.nextOccurrence(r.at, r.repeat); else { r.on = false; r.done = true; }
    Store.save(); if (Store.state.active === f.board.id) { Items.mount(it); const n = Items.el(it); n?.classList.add('ringing'); setTimeout(() => n?.classList.remove('ringing'), 6000); }
    App.updateBadge(); Panels.refreshDrawer();
  },
  onSubFire(p) {
    const s = Store.state.subs.find(x => x.id === p.id); if (!s) return; playSound(p.sound || 'soft');
    toast(`💳 ${s.name}: ${Subs.money(s.price, s.currency)} · ${relDays(s.next)}`, { ms: 12000, kind: 'alarm', action: { label: t('subs'), fn: () => Panels.subs() } });
    Store.state.firedSubs = [...(Store.state.firedSubs || []).slice(-200), p.key]; Store.save();
  },
  // ---------- countdown ----------
  newCountdown(at, it) {
    const def = it || { title: '', target: toLocalInput(Date.now() + 7 * 864e5), emoji: '🎉', color: '' };
    const f = form([['title', t('cd_title'), 'text', def.title, { placeholder: LANG === 'el' ? t('features.010') : 'e.g. Holidays' }], ['target', t('cd_target'), 'datetime-local', toLocalInput(def.target)], ['emoji', 'Emoji', 'text', def.emoji || '⏳'], ['notify', LANG === 'el' ? t('features.011') : 'Notify with sound when it arrives', 'checkbox', it ? it.reminder?.on : true]]);
    const sw = h('div', { class: 'sw-row' }, ...PALETTE.slice(4).map(c => h('button', { class: 'sw' + (def.color === c ? ' on' : ''), style: { '--c': c }, onclick: (e) => { def.color = c; $$('.sw', sw).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }))); f.el.append(sw);
    Panels.modal('⏳ ' + t('ins_countdown'), f.el, { ok: () => {
      const v = f.val(); if (!v.target) return false; const iso = new Date(v.target).toISOString();
      const rem = v.notify ? { on: true, at: iso, repeat: 'none', sound: 'space', msg: `${v.emoji} ${v.title}` } : (it?.reminder ? { ...it.reminder, on: false } : undefined);
      if (it) { Store.change(() => Object.assign(it, { title: v.title, target: iso, emoji: v.emoji, color: def.color, reminder: rem })); Items.mount(it); }
      else { at ||= Canvas.center(); this.addAt({ type: 'countdown', title: v.title || 'Countdown', target: iso, emoji: v.emoji, color: def.color, w: 340, h: 170, reminder: rem }, at.x, at.y); }
      App.updateBadge();
    } });
  },
  // ---------- series / movies ----------
  showSearch(at) {
    at ||= Canvas.center(); let mode = 'tv';
    const q = h('input', { class: 'inp', placeholder: LANG === 'el' ? t('features.012') : 'Series name…' });
    const res = h('div', { class: 'show-results' }); const notify = h('input', { type: 'checkbox', class: 'toggle', checked: true });
    const seg = h('div', { class: 'seg' }, h('button', { class: 'on', onclick: (e) => setMode('tv', e) }, '📺 ' + t('show_tv')), h('button', { onclick: (e) => setMode('movie', e) }, '🎬 ' + t('show_movie')));
    const note = h('p', { class: 'muted small' });
    const setMode = (m, e) => { mode = m; $$('button', seg).forEach(b => b.classList.toggle('on', b === e.currentTarget)); res.innerHTML = ''; note.textContent = m === 'tv' ? t('features.013') : (Store.state.settings.tmdbKey ? t('features.014') : t('features.015')); if (m === 'movie' && !Store.state.settings.tmdbKey) manualMovie(); };
    const manualMovie = () => { const f = form([['title', LANG === 'el' ? t('features.016') : 'Movie', 'text', q.value], ['date', LANG === 'el' ? t('features.017') : 'Release date', 'datetime-local', toLocalInput(Date.now() + 30 * 864e5)]]); res.innerHTML = ''; res.append(f.el, h('button', { class: 'btn primary', onclick: () => { const v = f.val(); if (!v.title) return; const iso = new Date(v.date).toISOString(); this.addAt({ type: 'show', kind: 'movie', source: 'manual', title: v.title, target: iso, w: 380, h: 200, reminder: notify.checked ? { on: true, at: iso, repeat: 'none', sound: 'space', msg: '🎬 ' + v.title } : undefined }, at.x, at.y); close(); } }, t('add'))); };
    const search = debounce(async () => {
      const term = q.value.trim(); if (!term || !API) return; res.innerHTML = '<div class="loading"></div>';
      try {
        if (mode === 'tv') {
          const r = await API.fetch('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(term), { accept: 'application/json' }); const list = JSON.parse(r.text);
          res.innerHTML = ''; if (!list.length) res.append(h('div', { class: 'empty small' }, t('no_results')));
          for (const { show: s } of list.slice(0, 12)) res.append(h('button', { class: 'show-row', onclick: () => { this.addTvShow(s.id, at, notify.checked); close(); } }, s.image?.medium ? h('img', { src: rimg(s.image.medium) }) : h('div', { class: 'ph', html: iconSvg('tv', 22) }), h('div', {}, h('b', {}, s.name), h('div', { class: 'muted small' }, [s.premiered?.slice(0, 4), s.network?.name || s.webChannel?.name, s.status].filter(Boolean).join(' · ')))));
        } else if (Store.state.settings.tmdbKey) {
          const r = await API.fetch(`https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(Store.state.settings.tmdbKey)}&language=el-GR&query=${encodeURIComponent(term)}`, { accept: 'application/json' }); const list = JSON.parse(r.text).results || [];
          res.innerHTML = ''; if (!list.length) res.append(h('div', { class: 'empty small' }, t('no_results')));
          for (const m of list.slice(0, 12)) res.append(h('button', { class: 'show-row', onclick: async () => { close(); let poster; if (m.poster_path) { try { poster = (await API.download('https://image.tmdb.org/t/p/w342' + m.poster_path, 'poster')).file; } catch (e) {} } const iso = m.release_date ? new Date(m.release_date + 'T20:00:00').toISOString() : ''; this.addAt({ type: 'show', kind: 'movie', source: 'tmdb', tmdbId: m.id, title: m.title, poster, target: iso, w: 380, h: 200, reminder: notify.checked && iso && new Date(iso) > Date.now() ? { on: true, at: iso, repeat: 'none', sound: 'space', msg: '🎬 ' + m.title } : undefined }, at.x, at.y); } }, m.poster_path ? h('img', { src: 'https://image.tmdb.org/t/p/w92' + m.poster_path }) : h('div', { class: 'ph', html: iconSvg('clapperboard', 22) }), h('div', {}, h('b', {}, m.title), h('div', { class: 'muted small' }, m.release_date || '—'))));
        } else manualMovie();
      } catch (e) { res.innerHTML = ''; res.append(h('div', { class: 'empty small err' }, '⚠️ ' + e.message)); }
    }, 350);
    q.oninput = search;
    const body = h('div', { class: 'form' }, seg, q, h('label', { class: 'chk' }, notify, h('span', {}, LANG === 'el' ? t('features.018') : 'Notify when it airs')), note, res);
    setMode('tv', { currentTarget: seg.firstChild });
    const close = Panels.modal('📺 ' + t('ins_show'), body, { wide: true });
  },
  async tvmazeShow(id) { const r = await API.fetch(`https://api.tvmaze.com/shows/${id}?embed[]=nextepisode&embed[]=previousepisode`, { accept: 'application/json' }); return JSON.parse(r.text); },
  async addTvShow(id, at, notify) {
    try {
      const s = await this.tvmazeShow(id); let poster;
      const img = s.image?.medium || s.image?.original; if (img) { try { poster = (await API.download(img, 'poster')).file; } catch (e) {} }
      const nx = s._embedded?.nextepisode; const prev = s._embedded?.previousepisode;
      const it = this.addAt({ type: 'show', kind: 'tv', source: 'tvmaze', tvmazeId: s.id, title: s.name, poster, network: s.network?.name || s.webChannel?.name || '', status: s.status, url: s.officialSite || s.url, next: nx ? { season: nx.season, number: nx.number, name: nx.name, airstamp: nx.airstamp } : null, prev: prev ? { season: prev.season, number: prev.number, airstamp: prev.airstamp } : null, notify, updated: Date.now(), w: 400, h: 200, reminder: notify && nx?.airstamp ? { on: true, at: nx.airstamp, repeat: 'none', sound: 'space', msg: `📺 ${s.name} S${pad(nx.season)}E${pad(nx.number)}` } : undefined }, at.x, at.y);
      toast(nx ? `📺 ${s.name}: ${fmtDate(nx.airstamp)}` : `📺 ${s.name}: ${t('show_none')}`);
      return it;
    } catch (e) { toast('⚠️ TVmaze: ' + e.message, { kind: 'err' }); }
  },
  async refreshShow(it, manual) {
    if (it.source !== 'tvmaze' || !API) return;
    try {
      const s = await this.tvmazeShow(it.tvmazeId); const nx = s._embedded?.nextepisode;
      it.next = nx ? { season: nx.season, number: nx.number, name: nx.name, airstamp: nx.airstamp } : null; it.status = s.status; it.updated = Date.now();
      if (it.notify && nx?.airstamp && (!it.reminder || it.reminder.at !== nx.airstamp)) it.reminder = { on: true, at: nx.airstamp, repeat: 'none', sound: 'space', msg: `📺 ${s.name} S${pad(nx.season)}E${pad(nx.number)}` };
      Store.save(); if (Items.nodes.has(it.id)) Items.mount(it); if (manual) toast('📺 ✓ ' + it.title);
    } catch (e) { if (manual) toast('⚠️ ' + e.message, { kind: 'err' }); }
  },
  refreshAllShows() { for (const b of Store.state.boards) for (const it of b.items) if (it.type === 'show' && it.source === 'tvmaze' && Date.now() - (it.updated || 0) > 6 * 3600e3) this.refreshShow(it); },
  editShow(it) {
    if (it.source === 'tvmaze') { const f = form([['notify', LANG === 'el' ? t('features.019') : 'Notify on new episode', 'checkbox', it.notify]]); return Panels.modal('📺 ' + esc(it.title), f.el, { extra: [h('button', { class: 'btn ghost', onclick: () => this.refreshShow(it, true) }, iconSvg('refresh-cw', 15), ' TVmaze'), it.url ? h('button', { class: 'btn ghost', onclick: () => API?.openExternal(it.url) }, iconSvg('external-link', 15)) : null].filter(Boolean), ok: () => { Store.change(() => { it.notify = f.val().notify; if (!it.notify && it.reminder) it.reminder.on = false; }); this.refreshShow(it); } }); }
    const f = form([['title', LANG === 'el' ? t('features.002') : 'Title', 'text', it.title], ['date', LANG === 'el' ? t('features.020') : 'Date', 'datetime-local', it.target ? toLocalInput(it.target) : '']]);
    Panels.modal('🎬', f.el, { ok: () => { const v = f.val(); Store.change(() => { it.title = v.title; it.target = v.date ? new Date(v.date).toISOString() : ''; if (it.reminder) it.reminder.at = it.target; }); Items.mount(it); } });
  },
  // ---------- trackers ----------
  newTracker(at, it) {
    const f = form([['url', t('tr_url'), 'url', it?.url || at?.url || '', { placeholder: 'https://…' }], ['keyword', t('tr_kw'), 'text', it?.keyword || '', { placeholder: LANG === 'el' ? t('features.021') : 'e.g. John Smith' }], ['interval', t('tr_every'), 'number', it?.interval || 60, { min: 5, step: 5 }]]);
    f.el.append(h('p', { class: 'muted small' }, LANG === 'el' ? t('features.022') : 'Checks the page periodically and notifies on change. JS-only or login pages can’t be read.'));
    const sessBox = h('input', { type: 'checkbox', class: 'toggle', checked: (it ? it.session : at?.session) ? true : null }); f.el.append(h('label', { class: 'chk' }, sessBox, h('span', {}, t('features.023'))));
    Panels.modal('🔎 ' + t('ins_tracker'), f.el, { ok: () => {
      const v = f.val(); if (!/^https?:\/\//.test(v.url)) return false; v.interval = Math.max(5, +v.interval || 60); v.session = sessBox.checked;
      let item = it; if (it) { Store.change(() => Object.assign(it, v, { hash: '' })); Items.mount(it); } else { at ||= Canvas.center(); item = this.addAt({ type: 'tracker', ...v, w: 360, h: 230 }, at.x, at.y); }
      this.checkTracker(item, true);
    } });
  },
  async checkTracker(it, manual) {
    if (!API) return; const n = Items.el(it); n?.classList.add('busy');
    const res = await API.checkTracker({ url: it.url, keyword: it.keyword, session: it.session, selector: it.selector }); this.onTracker({ id: it.id, ...res }, manual); n?.classList.remove('busy');
  },
  onTracker(r, manual) {
    const f = Store.find(r.id); if (!f) return; const it = f.item;
    if (r.ok === false && r.error) { it.error = r.error; it.checkedAt = r.checkedAt; }
    else { const changed = !!it.hash && it.hash !== r.hash; Object.assign(it, { count: r.count, snippets: r.snippets, hash: r.hash, checkedAt: r.checkedAt, pageTitle: r.title, error: r.ok ? '' : 'HTTP ' + r.status }); if (changed) { it.changed = true; if (!manual) playSound('pop'); } }
    Store.save(); if (Items.nodes.has(it.id)) Items.mount(it); if (manual) toast(`🔎 ${it.count ?? 0} ${t('tr_mentions')}`);
  },
  // v2.6.9.3: one visible confirmation for every restore (undo that touches subscriptions, assistant «undo all»,
  // snapshot restore, MCP rollback): how many subscriptions and cards change, with the subscription names.
  restoreLines(sum) {
    const S = sum.subs, C = sum.cards, B = sum.boards || { add: 0, remove: 0, change: 0 };
    const L = [t('v2693.c_subs', { rem: S.remove, chg: S.change, add: S.add }) + (S.names.length ? ' — ' + S.names.slice(0, 8).join(', ') + (S.names.length > 8 ? '…' : '') : ''),
      t('v2693.c_cards', { rem: C.remove, chg: C.change, add: C.add })];
    if (B.add || B.remove || B.change) L.push(t('v2693.c_boards', { rem: B.remove, chg: B.change, add: B.add }));
    if (S.skip) L.push(t('v2693.c_skip', { n: S.skip }));
    return L;
  },
  confirmChanges(title, sum, okLabel, note) {
    return new Promise((res) => {
      let done = false;
      const body = h('div', { 'data-restore-confirm': '1', 'data-subs-rem': String(sum.subs.remove), 'data-subs-chg': String(sum.subs.change), 'data-cards': String(sum.cards.add + sum.cards.remove + sum.cards.change) },
        h('ul', { class: 'confirm-list' }, ...this.restoreLines(sum).map(x => h('li', {}, x))), note ? h('p', { class: 'muted small' }, note) : null);
      Panels.modal('⚠️ ' + esc(title), body, { okLabel: okLabel || t('undo'), ok: () => { done = true; res(true); }, onClose: () => { if (!done) res(false); } });
    });
  },
  refreshSubsCards() { for (const it of Store.items()) if (it.type === 'subs') { Items.el(it) && (Items.el(it)._sig = '', Items.mount(it)); } },
  // ---------- backup ----------
  async exportBackup() { if (!API) return; await Store.save(true); const out = await API.exportBackup(Store.serialize()); if (out) toast('💾 ✓ ' + out, { ms: 5000 }); },
  async importBackup() {
    if (!API) return; const text = await API.importBackup(); if (!text) return;
    const s = JSON.parse(text);
    const body = h('div', {}, h('p', {}, LANG === 'el' ? t('features.024', { v0: s.boards?.length || 0, v1: s.subs?.length || 0 }) : `${s.boards?.length || 0} boards, ${s.subs?.length || 0} subscriptions.`));
    Panels.modal('📥 ' + t('set_import'), body, { extra: [h('button', { class: 'btn ghost', 'data-act': 'import-subs-only', onclick: () => { $('#modal-close').click(); setTimeout(() => Subs.importOnly(s.subs || [], t('v2693.src_backup')), 200); } }, t('v2693.only_subs', { n: (s.subs || []).length })), h('button', { class: 'btn ghost', onclick: () => { for (const b of s.boards || []) { b.id = uid(); b.name += ' (backup)'; Store.state.boards.push(b); } Store.save(); Panels.tabs(); $('#modal-close').click(); toast('✓'); } }, LANG === 'el' ? t('features.025') : 'Add as new boards')], okLabel: LANG === 'el' ? t('features.026') : 'Replace all', ok: async () => {
      // v2.6.9.3: «Replace all» says first how many subscriptions and cards change
      const sum = NyxUndo.summary(Store.state, NyxUndo.diff(NyxUndo.capture(s), JSON.parse(Store.pic())), 'undo');
      setTimeout(async () => { if (!await Features.confirmChanges(t('features.026'), sum, t('features.026'))) return; await Store.save(true); try { await API.inv('snap:create', t('extras.068')); } catch (e) {} Store.state = s; await Store.save(true); location.reload(); }, 200);
    } });
  },
};

// ---------- subscriptions ----------
const Subs = {
  money(v, cur) { const n = Number(v) || 0; try { return new Intl.NumberFormat(LANG === 'el' ? 'el-GR' : 'en-GB', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 2 }).format(n); } catch (e) { return n.toFixed(2) + ' ' + (cur || '€'); } },
  monthly(s) { return (Number(s.price) || 0) * (CYCLE_FACTOR[s.cycle || 'monthly'] || 1); },
  totals() {
    const act = Store.state.subs.filter(s => s.active !== false); const curs = {}; act.forEach(s => curs[s.currency || 'EUR'] = (curs[s.currency || 'EUR'] || 0) + 1);
    const cur = Object.entries(curs).sort((a, b) => b[1] - a[1])[0]?.[0] || 'EUR'; const same = act.filter(s => (s.currency || 'EUR') === cur);
    const month = same.reduce((a, s) => a + this.monthly(s), 0); const cm = {}; same.forEach(s => { const c = s.category || '—'; cm[c] ||= [c, 0, s.color || '#888']; cm[c][1] += this.monthly(s); });
    return { month, cur, cats: Object.values(cm).sort((a, b) => b[1] - a[1]) };
  },
  daysTo(d) { if (!d) return null; return Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5); },
  sorted() { return Store.state.subs.slice().sort((a, b) => (a.active === false) - (b.active === false) || (a.next || '9') .localeCompare(b.next || '9')); },
  addCycle(d, c) { const x = new Date(d + 'T00:00:00'); if (c === 'weekly') x.setDate(x.getDate() + 7); else if (c === 'quarterly') x.setMonth(x.getMonth() + 3); else if (c === 'yearly') x.setFullYear(x.getFullYear() + 1); else x.setMonth(x.getMonth() + 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; },
  edit(s, preset) {
    const isNew = !s; s ||= { id: uid(), name: preset?.[0] || '', url: preset?.[1] || '', color: preset?.[2] || '#7c8cff', icon: preset?.[3] || '💳', category: preset?.[4] || '', price: '', currency: 'EUR', cycle: 'monthly', next: new Date(Date.now() + 864e5 * 30).toISOString().slice(0, 10), remindDays: 2, active: true, notes: '' };
    const f = form([['name', t('sub_name'), 'text', s.name], ['icon', 'Emoji', 'text', s.icon], ['price', t('sub_price'), 'number', s.price, { step: '0.01', min: 0 }], ['currency', LANG === 'el' ? t('features.027') : 'Currency', 'select', s.currency, [['EUR', '€ EUR'], ['USD', '$ USD'], ['GBP', '£ GBP']]], ['cycle', t('sub_cycle'), 'select', s.cycle, ['weekly', 'monthly', 'quarterly', 'yearly'].map(k => [k, t('cyc_' + k)])], ['next', t('sub_next'), 'date', s.next], ['remindDays', t('sub_remind'), 'number', s.remindDays ?? 2, { min: 0, max: 30 }], ['category', LANG === 'el' ? t('features.028') : 'Category', 'text', s.category], ['url', t('sub_url'), 'url', s.url], ['notes', t('sub_notes'), 'textarea', s.notes], ['active', LANG === 'el' ? t('features.029') : 'Active', 'checkbox', s.active !== false]]);
    f.el.classList.add('grid2');
    let color = s.color; const sw = h('div', { class: 'sw-row span2' }, ...['#e50914', '#1db954', '#ff0033', '#113ccf', '#10a37f', '#d97757', '#107c10', '#0070d1', '#7b2cff', '#ffb020', '#7c8cff', '#f472b6'].map(c => h('button', { class: 'sw' + (c === color ? ' on' : ''), style: { '--c': c }, onclick: (e) => { color = c; $$('.sw', sw).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
    f.el.append(sw);
    if (isNew) f.el.prepend(h('div', { class: 'preset-grid span2' }, ...SUB_PRESETS.map(p => h('button', { class: 'preset', style: { '--pc': p[2] }, onclick: () => { f.inputs.name.value = p[0]; f.inputs.url.value = p[1]; f.inputs.icon.value = p[3]; f.inputs.category.value = p[4]; color = p[2]; f.inputs.price.focus(); } }, h('span', {}, p[3]), p[0]))));
    const extra = isNew ? [] : [h('button', { class: 'btn ghost danger', onclick: () => { Store.change(() => { const i = Store.state.subs.findIndex(x => x.id === s.id); if (i >= 0) Store.state.subs.splice(i, 1); }, t('v2693.lbl_del_sub', { v0: s.name })); $('#modal-close').click(); Panels.refreshDrawer(); Features.refreshSubsCards(); } }, iconSvg('trash-2', 15), ' ' + t('del'))];
    Panels.modal('💳 ' + (isNew ? t('sub_add') : esc(s.name)), f.el, { wide: true, extra, ok: () => {
      const v = f.val(); if (!v.name.trim()) return false;
      Store.change(() => { Object.assign(s, { ...v, name: v.name.trim(), price: +v.price || 0, remindDays: +v.remindDays || 0, color }); if (isNew) Store.state.subs.push(s); });
      Panels.refreshDrawer(); Features.refreshSubsCards();
    } });
  },
  toCanvas() { Features.addAtCenter({ type: 'subs', w: 380, h: 460 }); },
  summary() { return NyxCalc.subsSummary(Store.state.subs || [], { lang: LANG === 'en' ? 'en' : 'el' }); },
  when(u) { return u.days === 0 ? t('v2693.today') : u.days === 1 ? t('v2693.tomorrow') : u.days <= 7 ? t('v2693.in_days', { n: u.days }) : u.dm; },
  heroEl() {
    const S = this.summary();
    const up = S.upcoming;
    return h('div', { class: 'subx', 'data-subx': '1' },
      h('div', { class: 'subx-head' }, h('b', {}, '💳 ' + t('subs')), h('span', { class: 'muted' }, S.month.name + ' ' + S.month.y)),
      h('div', { class: 'subx-hero' },
        h('div', { class: 'subx-lab' }, t('v2693.this_month')),
        h('div', { class: 'subx-big', 'data-subx-month': String(S.total) }, S.totalText),
        h('div', { class: 'muted' }, t('v2693.paid'), ' ', h('span', { class: 'subx-paid', 'data-subx-paid': String(S.paid) }, S.paidText), ' · ' + t('v2693.left') + ' ', h('span', { class: 'subx-due', 'data-subx-due': String(S.due) }, S.dueText), ' ' + t('v2693.until', { v0: S.month.lastDM })),
        h('div', { class: 'subx-bar' }, h('i', { style: { width: Math.round(S.pct * 100) + '%' } })),
        h('div', { class: 'subx-row3' },
          h('div', { class: 'subx-k' }, h('span', { class: 'subx-lab' }, t('v2693.avg_month')), h('b', { 'data-subx-avg': String(S.avg) }, S.avgText)),
          h('div', { class: 'subx-k' }, h('span', { class: 'subx-lab' }, t('v2693.per_year')), h('b', { 'data-subx-year': String(S.year) }, S.yearText)),
          h('div', { class: 'subx-k' }, h('span', { class: 'subx-lab' }, t('v2693.active')), h('b', { 'data-subx-active': String(S.active) }, String(S.active)))),
        S.otherCur ? h('div', { class: 'muted small' }, t('v2693.other_cur', { n: S.otherCur, cur: S.cur })) : null),
      up.length ? h('div', { class: 'subx-list', 'data-subx-upcoming': String(up.length) }, h('div', { class: 'subx-lab' }, t('v2693.upcoming')),
        ...up.map(u => h('div', { class: 'subx-it', 'data-subx-it': u.id, style: { '--pc': u.color || 'var(--accent)' } },
          h('div', { class: 'subx-dot' }, u.icon || (u.name || '?')[0]),
          h('div', { class: 'subx-n' }, u.name, h('div', { class: 'subx-d muted' }, t('cyc_' + u.cycle) + (u.cycle === 'yearly' || u.cycle === 'quarterly' ? ' · ' + u.monthName : ''))),
          h('div', { class: 'subx-amt' }, u.text, h('div', { class: 'subx-d ' + (u.inMonth ? 'subx-due' : 'muted') }, u.inMonth ? this.when(u) : t('v2693.not_this_month') + ' · ' + u.dm))))) : null,
      S.noDate.length ? h('div', { class: 'muted small' }, t('v2693.no_date', { v0: S.noDate.join(', ') })) : null);
  },
  // v2.6.9.3: bring back ONLY subscriptions from a backup or snapshot. Matched by id: missing ones are added, identical
  // ones skipped, different ones listed so you choose which version stays. Boards, cards and settings are not touched.
  importOnly(src, from) {
    const m = NyxUndo.subsMerge(Store.state.subs, src);
    const pick = new Map();
    const row = (x) => { const cb = h('input', { type: 'checkbox', 'data-differ': x.id, onchange: (e) => pick.set(x.id, e.target.checked) });
      return h('label', { class: 'subs-differ' }, cb, h('span', {}, h('b', {}, x.cur.name || x.id), ' — ' + t('v2693.differ_now', { v0: this.money(x.cur.price, x.cur.currency), v1: t('cyc_' + (x.cur.cycle || 'monthly')), v2: x.cur.next ? fmtDM(x.cur.next) : '—' }) + ' · ' + t('v2693.differ_src', { v0: this.money(x.src.price, x.src.currency), v1: t('cyc_' + (x.src.cycle || 'monthly')), v2: x.src.next ? fmtDM(x.src.next) : '—' }))); };
    const body = h('div', { 'data-subs-import': '1', 'data-add': String(m.add.length), 'data-differ': String(m.differ.length) },
      h('p', {}, t('v2693.imp_head', { v0: from || '', add: m.add.length, differ: m.differ.length, same: m.same.length })),
      m.add.length ? h('ul', { class: 'confirm-list' }, ...m.add.map(x => h('li', {}, '＋ ' + (x.name || x.id) + ' · ' + this.money(x.price, x.currency) + ' · ' + t('cyc_' + (x.cycle || 'monthly'))))) : null,
      m.differ.length ? h('div', {}, h('p', { class: 'muted small' }, t('v2693.imp_differ_help')), ...m.differ.map(row)) : null,
      h('p', { class: 'muted small' }, t('v2693.imp_boards_safe')));
    return new Promise((res) => {
      let done = false;
      Panels.modal('📥 ' + t('v2693.imp_title'), body, { okLabel: t('v2693.imp_ok'), ok: () => {
        const take = m.differ.filter(x => pick.get(x.id));
        if (!m.add.length && !take.length) { done = true; res({ added: 0, replaced: 0 }); return; }
        Store.change(() => {
          for (const x of m.add) Store.state.subs.push(x);
          for (const x of take) { const i = Store.state.subs.findIndex(y => String(y.id) === x.id); if (i >= 0) Store.state.subs[i] = x.src; }
        }, t('v2693.lbl_import_subs'));
        Panels.refreshDrawer(); Features.refreshSubsCards();
        toast('✓ ' + t('v2693.imp_done', { add: m.add.length, rep: take.length }), { ms: 6000 });
        done = true; res({ added: m.add.length, replaced: take.length });
      }, onClose: () => { if (!done) res(null); } });
    });
  },
  cardHtml() {
    // v2.6.9.3: the canvas card shows the same summary as the drawer (amounts from NyxCalc.subsSummary)
    if (typeof NyxCalc !== 'undefined' && NyxCalc.subsSummary) {
      const S = this.summary(); const up = S.upcoming.slice(0, 6);
      return `<div class="card subs-card subx-card"><div class="sc-head"><span>${iconSvg('credit-card', 18)} ${t('subs')} · ${esc(S.month.name)}</span><button class="live mini act" data-act="open-subs">${iconSvg('settings-2', 13)}</button></div>
        <div class="subx-lab">${t('v2693.this_month')}</div><div class="sc-total"><b data-subx-month="${S.total}">${S.totalText}</b><span>${t('v2693.paid')} ${S.paidText} · ${t('v2693.left')} ${S.dueText}</span></div>
        <div class="subx-bar"><i style="width:${Math.round(S.pct * 100)}%"></i></div>
        <div class="subx-mini muted">${t('v2693.avg_month')} ${S.avgText} · ${t('v2693.per_year')} ${S.yearText} · ${t('v2693.active')} ${S.active}</div>
        <div class="sc-list">${up.map(u => `<div class="sc-row ${u.inMonth && u.days <= 7 ? 'soon' : ''}" style="--pc:${esc(u.color || '#888')}"><span class="sc-ico">${esc(u.icon || '💳')}</span><span class="sc-name">${esc(u.name)}</span><span class="sc-next">${u.inMonth ? esc(this.when(u)) : esc(t('v2693.not_this_month')) + ' · ' + u.dm}</span><span class="sc-price">${u.text}</span></div>`).join('') || `<div class="muted small">${t('sub_empty')}</div>`}</div></div>`;
    }
    const tot = this.totals(); const list = this.sorted().filter(s => s.active !== false).slice(0, 6);
    return `<div class="card subs-card"><div class="sc-head"><span>${iconSvg('credit-card', 18)} ${t('subs')}</span><button class="live mini act" data-act="open-subs">${iconSvg('settings-2', 13)}</button></div><div class="sc-total"><b>${this.money(tot.month, tot.cur)}</b><span>${t('sub_month')} · ${this.money(tot.month * 12, tot.cur)} ${t('sub_year')}</span></div>
      <div class="sc-list">${list.map(s => { const d = this.daysTo(s.next); return `<div class="sc-row ${d != null && d <= (s.remindDays ?? 2) ? 'soon' : ''}" style="--pc:${esc(s.color || '#888')}"><span class="sc-ico">${esc(s.icon || '💳')}</span><span class="sc-name">${esc(s.name)}</span><span class="sc-next">${s.next ? fmtDM(s.next) + ' · ' + relDays(s.next) : ''}</span><span class="sc-price">${this.money(s.price, s.currency)}</span></div>`; }).join('') || `<div class="muted small">${t('sub_empty')}</div>`}</div></div>`;
  }
};

// ---------- voice memos ----------
const Voice = {
  rec: null, chunks: [], stream: null, t0: 0, timer: 0, cancelled: false,
  async toggle() { if (this.rec) return this.stop(); return this.start(); },
  async start() {
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast('🎙️ ' + t('mic_err'), { kind: 'err' }); return; }
    this.chunks = []; this.cancelled = false;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : {});
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => this.finish();
    this.rec.start(250); this.t0 = Date.now();
    const bar = $('#recbar'); bar.hidden = false; $('#rec-stop').textContent = t('rec_stop'); $('#rec-cancel').textContent = t('rec_cancel');
    $('#rec-stop').onclick = () => this.stop(); $('#rec-cancel').onclick = () => { this.cancelled = true; this.stop(); };
    const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 256; ac.createMediaStreamSource(this.stream).connect(an); this.ac = ac;
    const cv = $('#rec-wave'); const ctx = cv.getContext('2d'); const buf = new Uint8Array(an.frequencyBinCount); const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent');
    const draw = () => { if (!this.rec) return; an.getByteTimeDomainData(buf); ctx.clearRect(0, 0, cv.width, cv.height); ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i < buf.length; i++) { const x = i / buf.length * cv.width, y = buf[i] / 255 * cv.height; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); const s = Math.floor((Date.now() - this.t0) / 1000); $('#rec-time').textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`; requestAnimationFrame(draw); };
    draw(); $$('[data-tool=voice]').forEach(b => b.classList.add('rec'));
  },
  stop() { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); },
  async finish() {
    const dur = Math.round((Date.now() - this.t0) / 1000);
    this.stream?.getTracks().forEach(tr => tr.stop()); this.ac?.close(); this.rec = null; $('#recbar').hidden = true; $$('[data-tool=voice]').forEach(b => b.classList.remove('rec'));
    if (this.cancelled || !this.chunks.length) return;
    const blob = new Blob(this.chunks, { type: 'audio/webm' }); const d = new Date();
    const name = `voice-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.webm`;
    let r; if (API) r = await API.importBuffer(name, new Uint8Array(await blob.arrayBuffer())); else r = { file: URL.createObjectURL(blob), name };
    const vit = Features.addAtCenter({ type: 'audio', voice: true, file: r.file, name, title: `🎙️ ${t('voice_memo')} · ${Math.floor(dur / 60)}:${pad(dur % 60)}`, w: 340, h: 110 });
    if (window.Media2) Media2.afterVoice(vit, blob);
    toast('🎙️ ✓');
  }
};

// v2.3: Agenda — notes attached to a calendar day (from the widget calendar, quick note, voice memo, or the reminders drawer).
// They live in Store.state.agenda, NOT as papers on the canvas; one click sends a note to the canvas if wanted.
const Agenda = {
  list() { return Store.state.agenda ||= []; },
  get(id) { return this.list().find(x => x.id === id); },
  day(d) { return this.list().filter(x => x.day === d).sort((a, b) => a.at - b.at); },
  refresh() { if (Panels.drawerKind === 'reminders' && !document.activeElement?.closest?.('#drawer input:not([type=checkbox]),#drawer textarea')) Panels.refreshDrawer(); },
  add(day, text, extra = {}) {
    text = String(text || '').trim(); if (!text && !extra.file) return null; if (!/^\d{4}-\d\d-\d\d$/.test(day || '')) day = ymd(Date.now());
    const x = { id: uid(), day, text, at: Date.now(), done: false, ...extra }; Store.change(() => { this.list().push(x); }); this.refresh(); return x;
  },
  toggle(id) { const x = this.get(id); if (!x) return; Store.change(() => { x.done = !x.done; }); this.refresh(); },
  edit(id, text) { const x = this.get(id); if (!x) return; Store.change(() => { x.text = String(text || '').trim(); }); this.refresh(); },
  remove(id) {
    const L = this.list(); const i = L.findIndex(x => x.id === id); if (i < 0) return; const [x] = Store.change(() => L.splice(i, 1)); this.refresh();
    toast('🗑️ ' + (x.text || '🎙️').slice(0, 40), { ms: 7000, action: { label: t('undo'), fn: () => { if (this.get(x.id)) return; Store.change(() => { this.list().splice(Math.min(i, this.list().length), 0, x); }); this.refresh(); } } });
  },
  toCanvas(id) {
    const x = this.get(id); if (!x) return;
    if (x.file) Features.addAtCenter({ type: 'audio', voice: true, file: x.file, name: x.file, title: '🎙️ ' + (x.text || t('voice_memo')).slice(0, 40), w: 340, h: 110 });
    else Features.addAtCenter({ type: 'sticky', w: 240, h: 200, html: `<b>${esc(fmtDay(x.day))}</b><br>` + esc(x.text).replace(/\n/g, '<br>'), paper: STICKY[0], font: 'Playpen Sans', size: 18 });
    toast('📋 → ' + Store.board().name);
  },
  async transcribe(x) {
    if (!x?.file || Store.state.settings.ai?.stt?.voiceMemos === false) return;
    try { const r = await Speech.transcribeMedia(x.file); if (r?.text) { Store.change(() => { x.text = r.text.trim(); }); this.refresh(); } } catch (e) { console.warn('agenda stt', e.message); }
  },
  op(o) {
    if (!o) return;
    if (o.op === 'add') { const x = this.add(o.day, o.text, o.file ? { file: o.file, voice: true, dur: o.dur || 0 } : {}); if (x?.file) this.transcribe(x); if (x) toast('📅 ' + fmtDay(x.day) + ' · ' + (x.text || '🎙️').slice(0, 40), { ms: 3500, action: { label: t('v23.ag_to_canvas'), fn: () => this.toCanvas(x.id) } }); return x; }
    if (o.op === 'toggle') return this.toggle(o.id);
    if (o.op === 'del') return this.remove(o.id);
    if (o.op === 'edit') return this.edit(o.id, o.text);
    if (o.op === 'canvas') { this.toCanvas(o.id); return; }
  },
  // drawer section (reminders drawer): add for any date + upcoming / recent days
  section() {
    const wrap = h('div', { class: 'agenda' });
    const date = dmyInput('date', this._lastDay || ymd(Date.now()), { title: t('v23.ag_date') }); const txt = h('input', { class: 'inp grow', placeholder: t('v23.ag_ph') });
    const add = () => { const d = date.value; if (!d) { date.classList.add('bad'); return; } if (this.add(d, txt.value)) { this._lastDay = d; txt.value = ''; if (Panels.drawerKind === 'reminders') Panels.refreshDrawer(); setTimeout(() => $('#drawer .agenda .inp.grow')?.focus(), 30); } };
    txt.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') add(); };
    wrap.append(h('h4', {}, '📅 ' + t('v23.agenda')), h('div', { class: 'ag-add' }, date._wrap, txt, h('button', { class: 'btn sm primary', onclick: add }, iconSvg('plus', 14))));
    const today = ymd(Date.now()); const from = ymd(Date.now() - 7 * 864e5);
    const days = [...new Set(this.list().map(x => x.day))].filter(d => d >= from).sort();
    if (!days.length) wrap.append(h('div', { class: 'muted small ag-empty' }, t('v23.ag_none')));
    for (const d of days) {
      wrap.append(h('div', { class: 'ag-day' + (d === today ? ' today' : d < today ? ' past' : '') }, fmtDay(d) + (d === today ? ' · ' + t('v23.today') : '')));
      for (const x of this.day(d)) wrap.append(h('div', { class: 'ag-row' + (x.done ? ' done' : '') },
        h('input', { type: 'checkbox', checked: x.done ? true : null, onchange: () => this.toggle(x.id) }),
        h('div', { class: 'ag-txt' }, x.text || (x.file ? '🎙️ ' + t('voice_memo') : ''), x.file ? h('audio', { src: Store.media(x.file), controls: '', preload: 'none' }) : null),
        h('button', { class: 'icon-btn', title: t('v23.ag_to_canvas'), html: iconSvg('square-arrow-out-up-right', 15), onclick: () => this.toCanvas(x.id) }),
        h('button', { class: 'icon-btn rem-x', title: t('del'), html: iconSvg('x', 15), onclick: () => this.remove(x.id) })));
    }
    return wrap;
  }
};
