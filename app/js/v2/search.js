'use strict';
// Universal search (Ctrl+K): cards on all boards (+ tags, captions, OCR, transcripts, page text), chat, commands; semantic re-rank via embeddings.
const Search = {
  index: {}, // id -> { h, v, src }
  text(it) {
    return [Features.searchText(it), (it.tags || []).map(t => '#' + t).join(' '), it.aiCaption, it.ocr, it.transcript?.text, it.pageText, it.notes, (it.highlights || []).map(x => x.label).join(' '), it.plugin && JSON.stringify(it.data || {}).slice(0, 2000), it.summary].filter(Boolean).join(' \n');
  },
  lexical(q, items) {
    const Q = expandQuery(q); if (!Q.length) return [];
    const tagQ = q.trim().startsWith('#') ? norm(q.trim().slice(1)) : null;
    const scored = [];
    for (const it of items) { if (tagQ) { if ((it.tags || []).some(t => norm(t).startsWith(tagQ))) scored.push([it, 2]); continue; } const hay = norm(this.text(it)); if (!hay) continue; if (matchQ(Q, hay)) { let s = 0; for (const g of Q) s += g.some(a => norm(Features.itemTitle(it)).includes(a)) ? 2 : 1; scored.push([it, s]); } }
    return scored.sort((a, b) => b[1] - a[1]).map(x => x[0]);
  },
  hash(s) { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x; },
  embedding: false,
  async ensureIndex() {
    const items = allItems(); const need = []; const useModel = !!AI.task('embed').m;
    for (const it of items) { const tx = this.text(it).slice(0, 2000); if (tx.length < 3) continue; const hh = this.hash(tx) + (useModel ? 'm' : 'l'); const e = this.index[it.id]; if (!e || e.h !== hh) need.push([it, tx, hh]); }
    if (!need.length) return;
    if (useModel) { for (let i = 0; i < need.length; i += 32) { const chunk = need.slice(i, i + 32); const vs = await AI.embed(chunk.map(c => c[1])); if (!vs) { return this.local(need.slice(i)); } chunk.forEach((c, j) => { this.index[c[0].id] = { h: c[2], v: vs[j], src: 'm' }; }); } }
    else this.local(need);
  },
  local(need) { for (const [it, tx, hh] of need) this.index[it.id] = { h: hh.replace(/m$/, 'l'), v: LocalEmb.vec(tx), src: 'l' }; },
  async semantic(q, k = 12) {
    await this.ensureIndex(); const anyModel = Object.values(this.index).some(e => e.src === 'm');
    let qv; if (anyModel) { const r = await AI.embed([q]); qv = r?.[0]; } if (!qv) qv = LocalEmb.vec(q);
    const out = []; for (const it of allItems()) { const e = this.index[it.id]; if (!e || e.v.length !== qv.length) continue; out.push([it, cosine(qv, e.v)]); }
    return out.sort((a, b) => b[1] - a[1]).slice(0, k).filter(x => x[1] > (anyModel ? 0.35 : 0.12));
  },
  // ---------------- palette ----------------
  filters: [['all', t('pluginsui.030'), 'search'], ['card', t('search.001'), 'sticky-note'], ['image', t('assistant.031'), 'image'], ['video', t('assistant.032'), 'film'], ['audio', t('search.002'), 'mic'], ['web', t('assistant.035'), 'globe'], ['chat', t('core.001'), 'message-circle'], ['cmd', t('search.003'), 'terminal']],
  filter: 'all',
  open(initial) {
    const P = $('#palette'); const q = $('#pal-q'); const list = $('#pal-list');
    P.hidden = false; q.value = initial || ''; q.placeholder = t('search.004'); q.focus();
    let bar = $('#pal-filters'); if (!bar) { bar = h('div', { id: 'pal-filters', class: 'pal-filters' }); list.before(bar); }
    bar.innerHTML = ''; for (const [k, l, ic] of this.filters) bar.append(h('button', { class: 'chip' + (this.filter === k ? ' on' : ''), 'data-f': k, html: iconSvg(ic, 13) + ' ' + l, onclick: () => { this.filter = k; $$('#pal-filters .chip').forEach(c => c.classList.toggle('on', c.dataset.f === k)); render(); q.focus(); } }));
    let idx = 0, results = [], semTok = 0;
    const cmds = () => [
      ['sparkles', t('pluginsui.007'), 'Ctrl+Space', () => Assistant.show()], ['brain', t('search.005'), '', () => Hub.open()], ['globe', 'Browser', 'Ctrl+B', () => Browser.show()], ['store', 'Plugin Store', '', () => PluginStore.open()], ['workflow', t('pluginsui.025'), '', () => PluginStore.open('auto')], ['wrench', t('boot.003'), '', () => Hub.tools()],
      ['calendar-days', t('search.006'), 'Ctrl+Shift+D', () => Extras.dailyNote()], ['layout-template', t('search.007'), '', () => Extras.templates()], ['presentation', t('search.008'), 'F5', () => Extras.present()], ['history', t('search.009'), '', () => Extras.snapshots()], ['tags', t('search.010'), '', () => Extras.tagFilter()], ['file-text', t('search.011'), '', () => Extras.importPdf()], ['scan-text', t('search.012'), '', () => Extras.ocrSelected()],
      ['lock', t('search.013'), '', () => Extras.lockBoard()], ['monitor-up', t('search.014'), '', () => Extras.deskSticky()], ['app-window', t('search.015'), '', () => API.inv('viewer:open', Store.state.active)], ['zap', t('search.016'), 'Ctrl+Alt+Q', () => API.inv('capture:open')], ['file-down', t('search.017'), '', () => Extras.exportMd()],
      ['plus-square', t('new_board'), 'Ctrl+T', () => App.newBoard()], ['type', t('t_text'), 'T', () => { const c = Canvas.center(); Tools.createText(c.x, c.y); }], ['sticky-note', t('t_sticky'), 'N', () => Features.addAtCenter({ type: 'sticky', w: 220, h: 220, paper: '#ffe66d', font: 'Playpen Sans', size: 20, html: '' }, true)],
      ['smile-plus', t('t_library'), 'Ctrl+E', () => Panels.library()], ['image', t('ins_image'), '', () => Features.pickAndAdd('image')], ['video', t('ins_video'), '', () => Features.pickAndAdd('video')], ['music', t('ins_audio'), '', () => Features.pickAndAdd('audio')], ['link', t('ins_link'), '', () => Features.addLink()],
      ['timer', t('ins_countdown'), '', () => Features.newCountdown()], ['tv', t('ins_show'), '', () => Features.showSearch()], ['radar', t('ins_tracker'), '', () => Features.newTracker()], ['alarm-clock', t('ins_reminder'), '', () => Features.newReminderCard()], ['mic', t('ins_voice'), 'Ctrl+Shift+R', () => Voice.toggle()],
      ['credit-card', t('subs'), '', () => Panels.subs()], ['bell', t('reminders'), '', () => Panels.reminders()], ['palette', t('themes'), '', () => Panels.themes()], ['settings-2', t('settings'), '', () => Panels.settings()], ['app-window', t('widget'), 'Ctrl+Alt+N', () => API?.toggleWidget()],
      ['maximize', t('zoom_fit'), 'Shift+1', () => Canvas.fit()], ['download', t('set_export'), '', () => Features.exportBackup()],
      ...THEMES.map(th => ['palette', t('panels.032') + th.name, '', () => { Store.state.settings.theme = th.id; Theme.apply(Store.state.settings); Store.save(); }]),
      ...PluginStore.commands(),
    ];
    const kindOf = (it) => ['image'].includes(it.type) ? 'image' : it.type === 'video' ? 'video' : it.type === 'audio' ? 'audio' : ['web', 'link', 'tracker'].includes(it.type) ? 'web' : 'card';
    const snippet = (it, Q) => { const tx = this.text(it).replace(/\s+/g, ' '); const n = norm(tx); for (const g of Q) for (const a of g) { const i = n.indexOf(a); if (i >= 0) return (i > 30 ? '…' : '') + tx.slice(Math.max(0, i - 30), i + 70); } return ''; };
    const draw = () => {
      list.innerHTML = ''; if (!results.length) list.append(h('div', { class: 'empty small' }, t('no_results')));
      results.forEach((r, i) => list.append(h('div', { class: 'pal-row' + (i === idx ? ' on' : '') + (r.sem ? ' sem' : ''), 'data-i': i, onclick: () => go(i), onpointermove: () => mark(i) },
        r.thumb ? h('img', { class: 'pthumb', src: r.thumb }) : h('span', { class: 'pi', html: iconSvg(r.icon, 17) }), h('span', { class: 'pt' }, h('span', {}, r.title), r.snip ? h('small', { class: 'psnip' }, r.snip) : null), r.sub ? h('span', { class: 'ps' }, r.sub) : null)));
    };
    const render = () => {
      const raw = q.value.trim(); const Q = expandQuery(raw); const F = this.filter; results = [];
      if (raw && F !== 'cmd') results.push({ kind: 'ask', icon: 'sparkles', title: t('search.018') + raw + '»', sub: 'Enter+Shift', run: () => { Assistant.show(); Assistant.send(raw); } });
      if (Q.length && F !== 'cmd' && F !== 'chat') {
        for (const it of this.lexical(raw, allItems())) { const k = kindOf(it); if (F !== 'all' && F !== k) continue; const b = BoardOf.get(it); results.push({ kind: 'item', icon: TYPE_ICON[it.type] || 'square', thumb: it.type === 'image' ? Store.media(it.thumb || it.file) : it.thumbFile ? Store.media(it.thumbFile) : null, title: Features.itemTitle(it), snip: snippet(it, Q), sub: `${b?.emoji || ''} ${b?.name || ''}`, run: () => Canvas.focusItem(it.id) }); if (results.length > 60) break; }
        if (F === 'all') { for (const b of Store.state.boards) if (matchQ(Q, norm(b.name))) results.push({ kind: 'board', icon: 'layout-grid', title: (b.emoji || '') + ' ' + b.name, sub: t('assistant.092'), run: () => App.switchBoard(b.id) });
          for (const s of Store.state.subs) if (matchQ(Q, norm(s.name + ' ' + (s.notes || '') + ' ' + (s.category || '')))) results.push({ kind: 'sub', icon: 'credit-card', title: s.name, sub: Subs.money(s.price, s.currency), run: () => Subs.edit(s) }); }
      }
      if (Q.length && (F === 'all' || F === 'chat')) for (const m of (Store.state.chat || []).slice().reverse()) { if (m.content && matchQ(Q, norm(m.content))) { results.push({ kind: 'chat', icon: m.role === 'user' ? 'user' : 'sparkles', title: String(m.content).slice(0, 90), snip: new Date(m.at).toLocaleString('el-GR'), sub: t('search.019'), run: () => Assistant.show() }); } if (results.length > 90) break; }
      if (F === 'all' || F === 'cmd') for (const c of cmds()) if (!Q.length || matchQ(Q, norm(c[1]))) results.push({ kind: 'cmd', icon: c[0], title: c[1], sub: c[2], run: c[3] });
      if (raw && /^https?:\/\//.test(raw)) results.unshift({ kind: 'cmd', icon: 'globe', title: t('search.020') + raw, run: () => Browser.open(raw) }, { kind: 'cmd', icon: 'link', title: t('panels.033') + raw, run: () => Features.addLinkUrl(raw) });
      else if (raw && F === 'all') results.push({ kind: 'cmd', icon: 'globe', title: t('search.021') + raw + '»', run: () => Browser.open(Store.state.settings.browser.search.replace('%s', encodeURIComponent(raw))) });
      if (!raw) results = results.filter(r => r.kind === 'cmd');
      results = results.slice(0, 120); idx = raw && results[0]?.kind === 'ask' && results.length > 1 ? 1 : 0; draw();
      // semantic additions
      const tok = ++semTok; if (raw.length > 2 && F !== 'cmd' && F !== 'chat') setTimeout(async () => { if (tok !== semTok) return; try { const sem = await this.semantic(raw, 10); if (tok !== semTok) return; const have = new Set(results.filter(r => r.kind === 'item').map(r => r.title)); let added = 0; for (const [it, sc] of sem) { const k = kindOf(it); if (F !== 'all' && F !== k) continue; const title = Features.itemTitle(it); if (have.has(title)) continue; const b = BoardOf.get(it); results.splice(Math.min(results.length, 1 + results.filter(r => r.kind === 'item').length + added), 0, { kind: 'item', sem: true, icon: TYPE_ICON[it.type] || 'square', thumb: it.type === 'image' ? Store.media(it.thumb || it.file) : null, title, snip: t('search.022') + Math.round(sc * 100) + '%', sub: `${b?.emoji || ''} ${b?.name || ''}`, run: () => Canvas.focusItem(it.id) }); added++; } if (added) draw(); } catch (e) { console.warn(e); } }, 260);
    };
    const mark = (i) => { idx = i; $$('.pal-row', list).forEach((r, j) => r.classList.toggle('on', j === i)); $$('.pal-row', list)[i]?.scrollIntoView({ block: 'nearest' }); };
    const go = (i) => { const r = results[i]; Panels.closePalette(); r && r.run(); };
    q.oninput = render; render();
    q.onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); mark(Math.min(results.length - 1, idx + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); mark(Math.max(0, idx - 1)); } else if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey && q.value.trim()) { Panels.closePalette(); Assistant.show(); Assistant.send(q.value.trim()); } else go(idx); } else if (e.key === 'Escape') Panels.closePalette(); else if (e.key === 'Tab') { e.preventDefault(); const ks = this.filters.map(f => f[0]); this.filter = ks[(ks.indexOf(this.filter) + (e.shiftKey ? -1 : 1) + ks.length) % ks.length]; $$('#pal-filters .chip').forEach(c => c.classList.toggle('on', c.dataset.f === this.filter)); render(); } e.stopPropagation(); };
  },
};
Panels.palette = function () { Search.open(); };

// ---------------- Vision: auto tag + caption ----------------
const Vision = {
  queue: Promise.resolve(),
  tag(it, manual) {
    this.queue = this.queue.then(async () => {
      if (manual) toast(t('search.023'), { ms: 1500 });
      try {
        const raw = await AI.vision(it.file, t('search.024'));
        const j = parseJsonLoose(raw) || { caption: raw.slice(0, 200), tags: [] };
        Store.change(() => { it.aiCaption = j.caption || ''; if (j.text) it.ocr = String(j.text).slice(0, 4000); it.tags = [...new Set([...(it.tags || []), ...(j.tags || []).map(t => String(t).replace(/^#/, '').toLowerCase().trim()).filter(Boolean)])].slice(0, 12); });
        Items.el(it) && (Items.el(it)._sig = '', Items.mount(it)); if (manual) toast('🏷️ ' + (it.tags || []).join(', '));
        Automations.fire('card', it);
      } catch (e) { if (manual) toast('⚠️ Vision: ' + e.message, { kind: 'err', ms: 6000 }); else console.warn('vision', e.message); }
    });
    return this.queue;
  },
};
const _addMedia = Features.addMedia.bind(Features);
Features.addMedia = async function (r, x, y) {
  const it = await _addMedia(r, x, y);
  try { if (it?.type === 'image' && Store.state.settings.ai.autoTag) Vision.tag(it); if (it) Automations.fire('card', it); } catch (e) {}
  return it;
};
