'use strict';
// Extras: tags, wiki-links/backlinks, card actions, drag-out, templates, daily note, presentation, snapshots, PDF, OCR, locked boards, desktop stickies, quick capture, pomodoro, export.
const MEDIA_T = ['image', 'video', 'audio', 'file'];
// ---------- render decorations ----------
const _render = Items.render.bind(Items);
Items.render = function (n, it) {
  const before = n._sig; _render(n, it); if (n._sig === before && n.childElementCount) return;
  const tx = n.querySelector('.txt');
  if (tx && ['text', 'sticky', 'reminder'].includes(it.type) && !tx.isContentEditable && /\[\[|\[\d+:\d\d\]/.test(tx.innerHTML)) decorate(tx, it);
  if (it.tags?.length && !['ink', 'arrow', 'line', 'emoji', 'icon', 'sticker', 'reaction'].includes(it.type)) n.insertAdjacentHTML('beforeend', `<div class="tagrow">${it.tags.slice(0, 6).map(t => `<span class="tg live" data-tag="${esc(t)}">#${esc(t)}</span>`).join('')}</div>`);
  if (it.aiCaption && it.type === 'image' && !it.caption) n.insertAdjacentHTML('beforeend', t('extras.001', { v0: esc(it.aiCaption) }));
  if (MEDIA_T.includes(it.type) && it.file && !V2.viewer) n.insertAdjacentHTML('beforeend', t('extras.002', { v0: iconSvg('hand-grab', 13) }));
};
function decorate(root, it) {
  const walk = (node) => { for (const c of [...node.childNodes]) { if (c.nodeType === 3) { const s = c.nodeValue; if (!/\[\[[^\]]+\]\]|\[\d+:\d\d\]/.test(s)) continue; const frag = document.createElement('template'); frag.innerHTML = esc(s).replace(/\[\[([^\]]+)\]\]/g, (m, x) => `<span class="wl live" data-wl="${x}">${x}</span>`).replace(/\[(\d+):(\d\d)\]/g, (m, a, b) => it.ref ? `<span class="ts live" data-ref="${esc(it.ref)}" data-t="${+a * 60 + +b}">[${a}:${b}]</span>` : m); c.replaceWith(frag.content); } else if (c.nodeType === 1 && !['A', 'CODE', 'PRE'].includes(c.tagName)) walk(c); } };
  walk(root);
}
// drag-out handler: moved to js/v26/dnd.js (v2.6.1: all card types, real file names, edge drag)
document.addEventListener('click', (e) => {
  const wl = e.target.closest('.wl[data-wl]'); if (wl) { e.stopPropagation(); return Extras.openWiki(wl.dataset.wl); }
  const tg = e.target.closest('.tg[data-tag]'); if (tg) { e.stopPropagation(); return Extras.setTagFilter(tg.dataset.tag); }
}, true);

// ---------- card actions ----------
const _cardAction = Features.cardAction.bind(Features);
Features.cardAction = function (act, it, ev) {
  if (act === 'web-live') { Store.change(() => { it.live = !it.live; }); return Items.mount(it); }
  if (act === 'web-refresh') return refreshWebSnap(it);
  if (act === 'web-open') return Browser.open(it.url);
  if (act === 'plugin-refresh') return PluginStore.refreshCard(it, true);
  if (act === 'plugin-url') { const u = window.event?.target?.closest('[data-url]')?.dataset.url; return u && Browser.open(u); }
  if (act === 'transcribe') return Media2.transcribe(it);
  if (act?.startsWith('pomo-')) return Pomodoro.act(act.slice(5), it);
  if (act === 'unlock-board') return Extras.unlock(Store.board());
  return _cardAction(act, it);
};
const _searchText = Features.searchText.bind(Features);
Features.searchText = function (it) { let s = _searchText(it) || ''; if (it.type === 'web') s += ' ' + (it.title || '') + ' ' + (it.url || ''); if (it.type === 'plugin') s += ' ' + (it.title || '') + ' ' + (it.data?.title || ''); if (it.pdfText) s += ' ' + it.pdfText.slice(0, 20000); return s; };
const _itemTitle = Features.itemTitle.bind(Features);
Features.itemTitle = function (it) { if (it.type === 'web') return it.title || hostOf(it.url); if (it.type === 'plugin') return it.data?.title || it.title || it.plugin; if (it.type === 'pomodoro') return 'Pomodoro'; return _itemTitle(it); };

// ---------- context menu additions ----------
const V2Ctx = {
  item(rows, items, I) {
    const it = items[0], one = items.length === 1;
    const add = [];
    if (one && it.type === 'image') add.push([I('scan-eye'), t('extras.003'), () => Vision.tag(it, true)], [I('scan-text'), t('extras.004'), () => Extras.ocr(it)]);
    if (one && ['video', 'audio'].includes(it.type)) add.push([I('file-text'), it.transcript ? t('extras.005') : t('extras.006'), () => it.transcript ? Media2.transcriptCard(it) : Media2.transcribe(it)]);
    if (one && it.type === 'file' && /\.pdf$/i.test(it.file || it.name || '')) add.push([I('file-text'), t('extras.007'), () => Extras.pdfPages(it)]);
    if (one && it.type === 'web') add.push([I(it.live ? 'image' : 'radio'), it.live ? t('extras.008') : t('browser.032'), () => Features.cardAction('web-live', it)], [I('globe'), t('extras.009'), () => Browser.open(it.url)]);
    if (one && it.type === 'tracker') add.push([I(it.session ? 'log-out' : 'log-in'), it.session ? t('extras.010') : t('extras.011'), () => { Store.change(() => { it.session = !it.session; }); Features.checkTracker(it, true); }]);
    if (one && ['link'].includes(it.type)) add.push([I('globe'), t('extras.012'), () => Browser.open(it.url)]);
    add.push([I('tags'), 'Tags…', () => Extras.editTags(items)]);
    if (one) add.push([I('link-2'), t('extras.013'), () => Extras.backlinks(it)]);
    if (one && ['sticky', 'text'].includes(it.type)) add.push([I('monitor-up'), t('extras.014'), () => Extras.deskSticky(it)]);
    if (one && it.file && MEDIA_T.includes(it.type)) add.push([I('download'), t('extras.015'), () => API.inv('file:saveAs', it.file, it.name)], [I('folder-open'), t('extras.016'), () => API.inv('file:reveal', it.file)]);
    if (one && ['text', 'sticky'].includes(it.type)) add.push([I('file-down'), t('extras.017'), () => API.inv('file:saveText', (Features.itemTitle(it).slice(0, 40) || 'note').replace(/[\\/:*?"<>|]/g, '_') + '.md', htmlToMd(it.html || ''))]);
    add.push([I('sparkles'), t('extras.018'), () => { Assistant.show(); const q = $('#as-q'); q.value = t('extras.019', { v0: items.map(i => i.id.slice(0, 8)).join(', ') }); q.focus(); }]);
    if (items.length > 1) add.push([I('layout-template'), t('extras.020'), () => Extras.saveTemplate(items)]);
    rows.push('-', ...add);
  },
};

// ---------- Extras ----------
const Extras = {
  tagFilter() {
    const counts = {}; for (const it of Store.items()) for (const t of it.tags || []) counts[t] = (counts[t] || 0) + 1;
    const tags = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const box = h('div', { class: 'tagpick' }, tags.length ? null : h('p', { class: 'muted' }, t('extras.021')),
      ...tags.map(([t, c]) => h('button', { class: 'chip' + (this.tf === t ? ' on' : ''), onclick: () => { this.setTagFilter(this.tf === t ? null : t); $('#modal-close').click(); } }, '#' + t, h('small', {}, ' ' + c))));
    Panels.modal(t('extras.022'), box, {});
  },
  tf: null,
  setTagFilter(t) {
    this.tf = t || null; document.body.classList.toggle('tagfilter', !!t);
    for (const it of Store.items()) Items.el(it)?.classList.toggle('tf-hit', !!t && (it.tags || []).some(x => norm(x) === norm(t)));
    let chip = $('#tf-chip'); if (!t) { chip?.remove(); return; }
    if (!chip) { chip = h('button', { id: 'tf-chip', class: 'tf-chip', onclick: () => this.setTagFilter(null) }); document.body.append(chip); }
    chip.innerHTML = `#${esc(t)} ${iconSvg('x', 13)}`;
    const hits = Store.items().filter(i => (i.tags || []).some(x => norm(x) === norm(t))); if (hits.length) Canvas.fit(hits);
  },
  editTags(items) {
    const cur = [...new Set(items.flatMap(i => i.tags || []))];
    const all = [...new Set(allItems().flatMap(i => i.tags || []))].filter(t => !cur.includes(t)).slice(0, 30);
    const inp = h('input', { class: 'inp', value: cur.join(', '), placeholder: t('extras.023'), onkeydown: (e) => e.stopPropagation() });
    const box = h('div', {}, inp, all.length ? h('div', { class: 'chips', style: { marginTop: '10px' } }, ...all.map(t => h('button', { class: 'chip', onclick: () => { inp.value = (inp.value ? inp.value.replace(/,\s*$/, '') + ', ' : '') + t; } }, '#' + t))) : null);
    Panels.modal('🏷️ Tags', box, { ok: () => { const tags = [...new Set(inp.value.split(/[,#\n]/).map(s => s.trim().toLowerCase()).filter(Boolean))]; Store.change(() => items.forEach(i => { i.tags = tags; })); items.forEach(i => Items.mount(i)); items.forEach(i => Automations.fire('card', i)); } });
    setTimeout(() => inp.focus(), 50);
  },
  findByTitle(title) { const n = norm(title); const all = allItems(); return all.find(i => norm(Features.itemTitle(i)) === n) || all.find(i => norm(Features.itemTitle(i)).startsWith(n)) || all.find(i => norm(Search.text(i)).includes(n)); },
  openWiki(title) { const it = this.findByTitle(title); if (it) return Canvas.focusItem(it.id); Panels.modal('🔗 [[' + title + ']]', h('p', {}, t('extras.024')), { okLabel: t('extras.025'), ok: () => Cmd.T.create_card.run({ kind: 'note', title, text: '' }) }); },
  backlinksOf(it) { const tt = norm(Features.itemTitle(it)).slice(0, 60); return allItems().filter(i => i !== it && (i.html || '').includes('[[') && [...(i.html || '').matchAll(/\[\[([^\]]+)\]\]/g)].some(m => norm(m[1]) === tt || tt.startsWith(norm(m[1])))); },
  backlinks(it) {
    const L = this.backlinksOf(it);
    const box = h('div', { class: 'blist' }, L.length ? null : h('p', { class: 'muted' }, t('extras.026') + Features.itemTitle(it).slice(0, 30) + t('extras.027')), ...L.map(i => h('button', { class: 'pal-row', onclick: () => { $('#modal-close').click(); Canvas.focusItem(i.id); } }, h('span', { html: iconSvg(TYPE_ICON[i.type] || 'square', 16) }), h('span', {}, Features.itemTitle(i)), h('small', { class: 'muted' }, BoardOf.get(i)?.name || ''))));
    Panels.modal('🔗 Backlinks: ' + Features.itemTitle(it).slice(0, 40), box, {}); return L;
  },
  // ----- templates -----
  TPL: [
    ['Kanban', 'columns-3', () => { const c = Canvas.center(); [t('extras.028'), t('extras.029'), t('extras.030')].forEach((t, i) => Features.addAt({ type: 'frame', w: 360, h: 640, title: t, color: ['#7c8cff', '#ffb020', '#22c55e'][i], z: 0 }, c.x - 560 + i * 400, c.y - 320)); }],
    [t('extras.031'), 'calendar-range', () => { const c = Canvas.center(); const d0 = new Date(); d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7)); for (let i = 0; i < 7; i++) { const d = new Date(d0); d.setDate(d0.getDate() + i); Features.addAt({ type: 'sticky', w: 220, h: 260, paper: STICKY[i % STICKY.length], font: 'Playpen Sans', size: 17, html: `<b>${GR_DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}</b><br>☐ ` }, c.x - 820 + i * 240, c.y - 130); } }],
    ['Brainstorm', 'lightbulb', () => { const c = Canvas.center(); Features.addAt({ type: 'text', w: 420, h: 60, html: t('extras.032'), font: 'Dela Gothic One', size: 30 }, c.x - 210, c.y - 30); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; Features.addAt({ type: 'sticky', w: 190, h: 190, paper: STICKY[i % STICKY.length], font: 'Playpen Sans', size: 18, html: t('extras.033') + (i + 1) }, c.x + Math.cos(a) * 380 - 95, c.y + Math.sin(a) * 300 - 95); } }],
    ['Shorts storyboard', 'clapperboard', () => { const c = Canvas.center(); [['🎣 Hook (0-3″)', '#ff3d6e'], [t('extras.034'), '#7c8cff'], [t('extras.035'), '#ffb020'], ['👉 CTA', '#22c55e']].forEach(([t, col], i) => { Features.addAt({ type: 'frame', w: 300, h: 520, title: t, color: col, z: 0 }, c.x - 640 + i * 330, c.y - 260); Features.addAt({ type: 'sticky', w: 240, h: 200, paper: STICKY[i], font: 'Playpen Sans', size: 16, html: tr('extras.036') }, c.x - 610 + i * 330, c.y - 190); }); }],
    [t('extras.037'), 'plane', () => { const c = Canvas.center(); Features.addAt({ type: 'frame', w: 900, h: 560, title: t('extras.038'), color: '#22d3ee', z: 0 }, c.x - 450, c.y - 280); Features.addAt({ type: 'sticky', w: 260, h: 300, paper: STICKY[0], font: 'Playpen Sans', size: 17, html: t('extras.039') }, c.x - 420, c.y - 220); Features.addAt({ type: 'sticky', w: 260, h: 300, paper: STICKY[2], font: 'Playpen Sans', size: 17, html: t('extras.040') }, c.x - 130, c.y - 220); Features.addAt({ type: 'countdown', w: 300, h: 170, title: t('extras.041'), emoji: '✈️', target: new Date(Date.now() + 14 * 864e5).toISOString(), color: '#22d3ee' }, c.x + 160, c.y - 220); }],
    [t('extras.042'), 'users', () => { const c = Canvas.center(); Features.addAt({ type: 'text', w: 520, h: 60, html: t('extras.043', { v0: new Date().toLocaleDateString('el-GR') }), size: 16, bg: 'var(--card)' }, c.x - 260, c.y - 150); }],
    ['Habit tracker', 'flame', () => { const c = Canvas.center(); Features.addAt({ type: 'text', w: 560, h: 60, html: t('extras.044') + [t('extras.045'), t('extras.046'), t('extras.047'), t('extras.048')].map(x => x + ' — ☐☐☐☐☐☐☐').join('<br>'), size: 17, bg: 'var(--card)', font: 'JetBrains Mono' }, c.x - 280, c.y - 100); }],
  ],
  templates() {
    const user = Store.state.templates || [];
    const box = h('div', { class: 'tplgrid' }, ...this.TPL.map(([n, ic, fn]) => h('button', { class: 'tpl', onclick: () => { $('#modal-close').click(); Store.change(() => {}); fn(); toast('📐 ' + n); } }, h('span', { html: iconSvg(ic, 26) }), n)),
      ...user.map((t, i) => h('div', { class: 'tpl user' }, h('button', { class: 'tpl-in', onclick: () => { $('#modal-close').click(); this.insertTemplate(t); } }, h('span', { html: iconSvg('layout-template', 26) }), t.name), h('button', { class: 'ib x2', title: tr('panels.054'), html: iconSvg('x', 12), onclick: () => { user.splice(i, 1); Store.save(); $('#modal-close').click(); this.templates(); } }))));
    Panels.modal(t('extras.049'), h('div', {}, box, h('p', { class: 'muted small' }, t('extras.050'))), { wide: true });
  },
  saveTemplate(items) { const f = form([['name', t('extras.051'), 'text', '']]); Panels.modal(t('extras.052'), f.el, { ok: () => { const bb = { x: Math.min(...items.map(i => i.x)), y: Math.min(...items.map(i => i.y)) }; (Store.state.templates ||= []).push({ name: f.val().name || t('extras.053'), items: items.map(i => ({ ...JSON.parse(JSON.stringify(i)), x: i.x - bb.x, y: i.y - bb.y })) }); Store.save(); toast('📐 ✓'); } }); },
  insertTemplate(t) { const c = Canvas.center(); const ids = []; const gmap = {}; Store.change(() => { for (const src of t.items) { const it = { ...JSON.parse(JSON.stringify(src)), id: uid(), x: c.x - 300 + src.x, y: c.y - 200 + src.y, created: Date.now() }; if (it.group) it.group = gmap[it.group] ||= uid(); Store.addItem(it); ids.push(it.id); } }); ids.forEach(id => Items.mount(Store.get(id))); Canvas.select(ids); },
  // ----- daily note -----
  dailyNote() {
    let b = Store.state.boards.find(b => b.daily) || Store.state.boards.find(b => norm(b.name) === norm(t('extras.054')));
    if (!b) { b = { id: uid(), name: t('extras.054'), emoji: '📓', color: PALETTE[3], view: null, items: [], daily: true }; Store.state.boards.push(b); }
    if (Store.state.active !== b.id) App.switchBoard(b.id);
    const d = new Date(); const key = d.toISOString().slice(0, 10);
    let it = b.items.find(i => i.daily === key);
    if (!it) {
      const n = b.items.filter(i => i.daily).length; const col = n % 7, row = Math.floor(n / 7);
      const rem = allItems().filter(i => i.reminder?.on && new Date(i.reminder.at).toDateString() === d.toDateString()).map(i => '⏰ ' + new Date(i.reminder.at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }) + ' ' + esc(Features.itemTitle(i).slice(0, 40)));
      const subs = (Store.state.subs || []).filter(s => s.active && s.next === key).map(s => '💳 ' + esc(s.name));
      it = Features.addAt({ type: 'sticky', daily: key, w: 300, h: 340, paper: STICKY[col % STICKY.length], font: 'Playpen Sans', size: 17, html: `<b>${GR_DAYS[d.getDay()]} ${d.toLocaleDateString('el-GR')}</b><br>${[...rem, ...subs].join('<br>')}${rem.length + subs.length ? '<br>' : ''}☐ <br>📝 `, tags: [t('extras.055')] }, col * 330, row * 380);
    }
    Canvas.focusItem(it.id); setTimeout(() => Canvas.edit?.(it.id), 400);
  },
  // ----- presentation -----
  present() {
    const frames = Store.items().filter(i => i.type === 'frame').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (Math.round(a.y / 300) - Math.round(b.y / 300)) || a.x - b.x);
    const slides = frames.length ? frames.map(f => [f]) : [Store.items()]; let i = 0;
    document.body.classList.add('presenting'); Panels.closeDrawer(); const hud = h('div', { class: 'pres-hud' }); document.body.append(hud);
    const go = () => { const f = slides[i]; Canvas.fit(f.length === 1 && f[0].type === 'frame' ? [f[0]] : f); hud.textContent = `${i + 1} / ${slides.length}${frames.length ? ' · ' + (frames[i].title || '') : ''}  ·  ← →  ·  Esc`; };
    const key = (e) => { if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { i = Math.min(slides.length - 1, i + 1); go(); } else if (['ArrowLeft', 'PageUp'].includes(e.key)) { i = Math.max(0, i - 1); go(); } else if (e.key === 'Escape') { end(); } else return; e.preventDefault(); e.stopPropagation(); };
    const end = () => { document.body.classList.remove('presenting'); hud.remove(); removeEventListener('keydown', key, true); if (document.fullscreenElement) document.exitFullscreen?.(); };
    addEventListener('keydown', key, true); document.documentElement.requestFullscreen?.().catch(() => {}); setTimeout(go, 150);
    if (!frames.length) toast(t('extras.056'), { ms: 4000 });
  },
  // ----- snapshots / history -----
  async snapshots() {
    Panels.openDrawer('history', t('extras.057'), async (body) => {
      body.append(h('div', { class: 'row gap' }, h('button', { class: 'btn primary sm', onclick: async () => { const f = form([['label', t('extras.058'), 'text', '']]); Panels.modal(t('extras.059'), f.el, { ok: async () => { await Store.save(true); await API.inv('snap:create', f.val().label || t('extras.060')); Panels.drawerKind = null; this.snapshots(); } }); } }, iconSvg('camera', 14), t('extras.061')), h('span', { class: 'muted small' }, t('extras.062'))));
      const list = await API.inv('snap:list');
      if (!list.length) body.append(h('p', { class: 'muted' }, t('extras.063')));
      // v2.6.9.3: subscriptions / cards per snapshot + «Μόνο συνδρομές» (boards untouched)
      for (const s of list) body.append(h('div', { class: 'snap', 'data-snap': s.name, 'data-subs': s.subs == null ? '' : String(s.subs) }, h('span', { html: iconSvg('history', 16) }), h('div', { class: 'grow' }, h('b', {}, snapLabel(s.name)), h('div', { class: 'muted small' }, snapDate(s.name) + ' · ' + (s.subs == null ? '' : t('v2693.snap_counts', { subs: s.subs, cards: s.cards }) + ' · ') + Math.round(s.size / 1024) + ' KB')),
        h('button', { class: 'btn sm ghost', 'data-act': 'snap-subs-only', title: t('v2693.only_subs_tip'), onclick: () => this.restoreSubs(s) }, t('v2693.only_subs_short')),
        h('button', { class: 'btn sm', onclick: () => this.restore(s) }, t('extras.064'))));
    });
  },
  async restore(s) {
    const txt = await API.inv('snap:read', s.name); let st; try { st = JSON.parse(txt); } catch (e) { return toast(t('extras.065'), { kind: 'err' }); }
    const n = st.boards?.reduce((a, b) => a + b.items.length, 0);
    // v2.6.9.3: the confirmation also says how many subscriptions and cards change (the full restore is still offered)
    const sum = NyxUndo.summary(Store.state, NyxUndo.diff(NyxUndo.capture(st), JSON.parse(Store.pic())), 'undo');
    const body = h('div', { 'data-restore-confirm': '1', 'data-subs-rem': String(sum.subs.remove), 'data-subs-chg': String(sum.subs.change) }, h('p', {}, t('extras.067', { v0: snapLabel(s.name), v1: snapDate(s.name), v2: st.boards?.length, n })), h('ul', { class: 'confirm-list' }, ...Features.restoreLines(sum).map(x => h('li', {}, x))), h('p', { class: 'muted small' }, t('v2693.full_restore_note')));
    Panels.modal(t('extras.066'), body, { okLabel: t('extras.064'), extra: [h('button', { class: 'btn ghost', onclick: () => { $('#modal-close').click(); setTimeout(() => this.restoreSubs(s, st), 200); } }, t('v2693.only_subs', { n: (st.subs || []).length }))], ok: async () => { await Store.save(true); await API.inv('snap:create', t('extras.068')); Store.state = V2.migrate(st); await Store.save(true); location.reload(); } });
  },
  async restoreSubs(s, st) {
    if (!st) { const txt = await API.inv('snap:read', s.name); try { st = JSON.parse(txt); } catch (e) { return toast(t('extras.065'), { kind: 'err' }); } }
    return Subs.importOnly(st.subs || [], snapLabel(s.name) + ' · ' + snapDate(s.name));
  },
  // ----- PDF -----
  async pdfjs() { if (!this._pdf) { this._pdf = await import('../../vendor/pdfjs/pdf.min.mjs'); this._pdf.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', document.baseURI.replace(/[^/]*$/, '') + 'js/v2/').href; } return this._pdf; },
  async pdfDoc(it) { const lib = await this.pdfjs(); const buf = await API.inv('file:readMedia', it.file); return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise; },
  async pdfText(it) { try { const doc = await this.pdfDoc(it); let out = ''; for (let p = 1; p <= Math.min(doc.numPages, 200); p++) { const tc = await (await doc.getPage(p)).getTextContent(); out += tc.items.map(x => x.str).join(' ') + '\n'; if (out.length > 200000) break; } Store.change(() => { it.pdfText = out.slice(0, 200000); it.pages = doc.numPages; }); Items.mount(it); return out; } catch (e) { console.warn('pdf', e); } },
  async pdfPages(it, max = 30) {
    try { toast(t('extras.069')); const doc = await this.pdfDoc(it); const ids = []; const n = Math.min(doc.numPages, max); const W = 560;
      for (let p = 1; p <= n; p++) { const page = await doc.getPage(p); const vp0 = page.getViewport({ scale: 1 }); const sc = 1400 / vp0.width; const vp = page.getViewport({ scale: sc }); const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88)); const r = await API.importBuffer(t('extras.070', { v0: (it.name || 'pdf').replace(/\.pdf$/i, ''), p }), new Uint8Array(await blob.arrayBuffer()));
        const hh = W * vp.height / vp.width; const x = it.x + it.w + 40 + ((p - 1) % 5) * (W + 30), y = it.y + Math.floor((p - 1) / 5) * (hh + 40);
        const im = Features.addAt({ type: 'image', file: r.file, name: r.name, w: W, h: hh, caption: t('extras.071', { v0: it.name || 'PDF', p }), source: it.id }, x, y); ids.push(im.id); }
      if (doc.numPages > max) toast(t('extras.072', { max, numPages: doc.numPages })); else toast(t('extras.073')); Canvas.fit(ids.map(id => Store.get(id)));
    } catch (e) { toast('⚠️ PDF: ' + e.message, { kind: 'err' }); }
  },
  importPdf() { Features.pickAndAdd('file'); },
  // ----- OCR -----
  async ocr(it) {
    const mode = Store.state.settings.ai.ocr || 'auto'; let text = '', via = '';
    if (mode !== 'vision' && /win/i.test(V2.info.platform || '')) { try { text = await API.inv('sys:ocr', it.file, 'el'); via = 'Windows OCR'; } catch (e) { console.warn('winocr', e.message); } }
    if (!text?.trim()) { try { toast(t('extras.074')); text = await AI.vision(it.file, t('extras.075')); via = 'AI vision'; } catch (e) { return toast('⚠️ OCR: ' + e.message, { kind: 'err', ms: 7000 }); } }
    text = stripThink(text || '').trim(); if (!text) return toast(t('extras.076'));
    Store.change(() => { it.ocr = text.slice(0, 20000); }); delete Search.index[it.id];
    const p = { x: it.x + it.w + 30, y: it.y }; Features.addAt({ type: 'text', w: 420, h: 60, html: esc(text).replace(/\n/g, '<br>'), size: 15, bg: 'var(--card)', source: it.id, tags: ['ocr'] }, p.x, p.y); toast('🔍 ✓ ' + via);
  },
  async ocrSelected() { const it = Canvas.selItems().find(i => i.type === 'image'); if (!it) return toast(t('extras.077')); this.ocr(it); },
  // ----- locked boards (AES-GCM, PBKDF2 250k) -----
  async key(pw, salt) { const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); },
  b64: (u8) => btoa(String.fromCharCode(...new Uint8Array(u8))), u8: (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0)),
  lockBoard() {
    const b = Store.board(); if (b.enc) return toast(t('extras.078'));
    const f = form([['p1', t('extras.079'), 'password', ''], ['p2', t('extras.080'), 'password', '']]); f.el.append(h('p', { class: 'muted small' }, t('extras.081')));
    Panels.modal(t('extras.082') + b.name + '»', f.el, { okLabel: t('panels.056'), ok: () => { const v = f.val(); if (!v.p1 || v.p1 !== v.p2) { toast(t('extras.083'), { kind: 'err' }); return false; } this.encrypt(b, v.p1); } });
  },
  async encrypt(b, pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)); const k = await this.key(pw, salt);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(b.items)));
    Store.undoStack.length = 0; Store.redoStack.length = 0; b.enc = { v: 1, salt: this.b64(salt), iv: this.b64(iv), data: this.b64(data), n: b.items.length }; b.items = []; Store.save(true); App.switchBoard(b.id); toast('🔒 ' + b.name);
  },
  async unlock(b) {
    const f = form([['p', t('extras.079'), 'password', '']]);
    Panels.modal('🔓 «' + b.name + '»', f.el, { okLabel: t('extras.084'), ok: async () => { try { const k = await this.key(f.val().p, this.u8(b.enc.salt)); const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.u8(b.enc.iv) }, k, this.u8(b.enc.data)); b.items = JSON.parse(new TextDecoder().decode(pt)); delete b.enc; Store.save(true); App.switchBoard(b.id); toast(t('extras.085')); } catch (e) { toast(t('extras.086'), { kind: 'err' }); } } });
    setTimeout(() => $('#modal input')?.focus(), 60);
  },
  lockOverlay() { $('#lock-ov')?.remove(); const b = Store.board(); if (!b.enc) return; document.body.append(h('div', { id: 'lock-ov', class: 'lock-ov' }, h('div', { class: 'lock-box' }, h('div', { html: iconSvg('lock', 46) }), h('h2', {}, b.name), h('p', { class: 'muted' }, t('extras.087', { n: b.enc.n })), h('button', { class: 'btn primary', onclick: () => this.unlock(b) }, t('extras.084'))))); },
  // ----- desktop stickies -----
  // v2.6: from Ctrl+K there is no item argument → use the selected note/text card, or explain what to select
  deskSticky(it) { if (!it) it = Canvas.selItems().find(i => ['sticky', 'text'].includes(i.type)); if (!it || !['sticky', 'text'].includes(it.type)) { toast(t('v26.desk_pick')); return false; } Store.change(() => { it.desk = { ...(it.desk || {}), on: true }; }); API.inv('sticky:open', { id: it.id, desk: it.desk }); },
  // ----- export -----
  exportMd() { const b = Store.board(); const md2 = `# ${b.emoji || ''} ${b.name}\n\n` + Store.items().filter(i => !['ink', 'arrow', 'line'].includes(i.type)).sort((p, q) => p.y - q.y || p.x - q.x).map(i => i.type === 'frame' ? `\n## ${i.title || ''}\n` : ['text', 'sticky', 'reminder'].includes(i.type) ? htmlToMd(i.html || '') + (i.tags?.length ? '\n' + i.tags.map(t => '#' + t).join(' ') : '') : i.url ? `- [${Features.itemTitle(i)}](${i.url})` : `- ${TYPE_ICON[i.type] ? '' : ''}${Features.itemTitle(i)}${i.file ? ` (${i.file})` : ''}`).join('\n\n'); API.inv('file:saveText', b.name.replace(/[\\/:*?"<>|]/g, '_') + '.md', md2); },
};
function snapLabel(n) { const l = n.replace(/^snap-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-?/, '').replace(/\.json$/, '').replace(/_/g, ' '); return l === 'auto' ? t('extras.088') : l || 'snapshot'; }
function snapDate(n) { const m = n.match(/(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)/); return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`).toLocaleString('el-GR') : ''; }
function htmlToMd(html) { return plainText(String(html).replace(/<b>|<\/b>|<strong>|<\/strong>/g, '**').replace(/<i>|<\/i>|<em>|<\/em>/g, '_').replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, '[$2]($1)').replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|div|li|h\d)>/g, '\n').replace(/<li>/g, '- ')).replace(/\n{3,}/g, '\n\n').trim(); }
// ----- sticky/capture/board-switch wiring -----
API?.onStickyBounds?.(({ id, bounds }) => { const f = Store.find(id); if (f) { f.item.desk = { ...(f.item.desk || {}), bounds }; Store.save(); } });
API?.onStickyClosed?.((id) => { const f = Store.find(id); if (f?.item.desk) { f.item.desk.on = false; Store.save(); } });
API?.onStickyUpdate?.(({ id, html }) => { const f = Store.find(id); if (f && html != null) { Store.change(() => { f.item.html = sanitize(html); }); if (Items.nodes.has(id)) Items.mount(f.item); } });
API?.onCapture?.(async (p) => {
  const text = String(p.text || '').trim(); if (!text) return;
  if (p.mode === 'assistant' || /^[/!]/.test(text)) return Assistant.ask(text.replace(/^[/!]\s*/, ''), t('extras.089'));
  if (/^https?:\/\/\S+$/.test(text)) return Features.addLinkUrl(text);
  let b = Store.state.boards.find(b => b.inbox); if (!b) { b = { id: uid(), name: t('extras.090'), emoji: '📥', color: PALETTE[2], view: null, items: [], inbox: true }; Store.state.boards.push(b); Panels.tabs(); }
  const n = b.items.length; const it = { id: uid(), type: 'sticky', x: (n % 6) * 250, y: Math.floor(n / 6) * 250, w: 220, h: 220, paper: STICKY[n % STICKY.length], font: 'Playpen Sans', size: 18, html: esc(text).replace(/\n/g, '<br>'), created: Date.now(), z: n + 1, tags: (text.match(/#[\p{L}\p{N}_-]+/gu) || []).map(t => t.slice(1).toLowerCase()) };
  b.items.push(it); Store.save(); if (b.id === Store.state.active) Items.mount(it); toast(t('extras.091') + text.slice(0, 40)); Automations.fire('card', it);
});
const _switchBoard = App.switchBoard.bind(App);
App.switchBoard = function (id) { const r = _switchBoard(id); Extras.lockOverlay(); if (Extras.tf) Extras.setTagFilter(null); return r; };

// ---------- Pomodoro (renderer card) ----------
const Pomodoro = {
  act(a, it) { const now = Date.now(); Store.change(() => { const p = it.pomo ||= { mode: 'work', left: (it.work || 25) * 60e3, run: false, done: 0 };
    if (a === 'toggle') { if (p.run) { p.left = Math.max(0, p.end - now); p.run = false; } else { p.end = now + p.left; p.run = true; } }
    if (a === 'reset') { p.mode = 'work'; p.left = (it.work || 25) * 60e3; p.run = false; }
    if (a === 'skip') this.next(it); }); Items.mount(it); this.pill(it); },
  next(it) { const p = it.pomo; if (p.mode === 'work') { p.done++; p.mode = 'break'; p.left = ((p.done % 4 === 0 ? it.long : it.brk) || (p.done % 4 === 0 ? 15 : 5)) * 60e3; } else { p.mode = 'work'; p.left = (it.work || 25) * 60e3; } p.run = false; },
  tick() { const now = Date.now(); for (const it of allItems()) { const p = it.pomo; if (!p?.run) continue; const left = p.end - now; if (left <= 0) { const was = p.mode; this.next(it); Store.save(); API?.notify('🍅 Pomodoro', was === 'work' ? t('extras.092') : t('extras.093')); playSound?.('pop'); if (Items.nodes.has(it.id)) Items.mount(it); this.pill(it); continue; } const n = Items.el(it)?.querySelector('.pomo-t'); if (n) n.textContent = fmtTime(left / 1000); } },
  pill(it) { const p = it.pomo; Store.state.shared ||= {}; if (p?.run) Store.state.shared.pomodoro = { v: (p.mode === 'work' ? '🍅 ' : '☕ ') + t('extras.094') + new Date(p.end).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }), by: 'pomodoro', at: Date.now() }; else delete Store.state.shared.pomodoro; Store.save(); },
};
Items.R.pomodoro = function (n, it) { const p = it.pomo || { mode: 'work', left: (it.work || 25) * 60e3, run: false, done: 0 }; const left = p.run ? p.end - Date.now() : p.left;
  n.innerHTML = t('extras.095', { mode: p.mode, v1: p.mode === 'work' ? t('extras.096') : t('extras.097'), v2: p.done || 0, v3: fmtTime(left / 1000), v4: iconSvg(p.run ? 'pause' : 'play', 18), v5: iconSvg('rotate-ccw', 16), v6: iconSvg('skip-forward', 16) }); };
setInterval(() => Pomodoro.tick(), 1000);

// ---------------- JSON Canvas (Obsidian) import ----------------
const V2Import = {
  async jsonCanvas(src, name) {
    const j = typeof src === 'string' ? JSON.parse(src) : src; if (!j || !Array.isArray(j.nodes)) throw new Error(t('extras.098'));
    const COL = { 1: '#ff6b6b', 2: '#ffa94d', 3: '#ffd43b', 4: '#69db7c', 5: '#4dabf7', 6: '#b197fc' };
    const b = { id: uid(), name: name || 'JSON Canvas', emoji: '🗺️', color: PALETTE[6], view: null, items: [] };
    const map = {}; let z = 1;
    for (const n of j.nodes) {
      const base = { id: uid(), x: +n.x || 0, y: +n.y || 0, w: Math.max(60, +n.width || 250), h: Math.max(40, +n.height || 160), z: n.type === 'group' ? 0 : z++, rot: 0 };
      const col = n.color ? (COL[n.color] || n.color) : null; let it;
      if (n.type === 'group') it = { ...base, type: 'frame', title: n.label || t('assistant.026'), color: col || '#7c8cff' };
      else if (n.type === 'link') it = { ...base, type: 'link', url: n.url, title: hostOf(n.url) };
      else if (n.type === 'file') it = { ...base, type: 'text', html: '📄 ' + esc(n.file || ''), size: 16, bg: 'var(--card)', font: 'Inter' };
      else it = { ...base, type: 'sticky', html: Cmd.html(n.text || ''), paper: col || STICKY[0], font: 'Playpen Sans', size: 16 };
      map[n.id] = it; b.items.push(it);
    }
    for (const e of j.edges || []) { const a = map[e.fromNode], c = map[e.toNode]; if (!a || !c) continue; b.items.push({ id: uid(), type: 'arrow', x: 0, y: 0, w: 0, h: 0, z: z++, x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: c.x + c.w / 2, y2: c.y + c.h / 2, stroke: e.color ? (COL[e.color] || e.color) : '#7c8cff', sw: 3, curve: 0.15 }); }
    Store.state.boards.push(b); Store.save(); App.switchBoard?.(b.id);
    return { ok: true, board: b.name, nodes: j.nodes.length, edges: (j.edges || []).length };
  },
};
window.V2Import = V2Import;
