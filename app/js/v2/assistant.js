'use strict';
// Assistant: Greek voice/text commands → tool calling (OpenAI tools) with JSON / <tool_call> fallbacks and an offline intent parser.
// v2.2: main now returns specific connection messages (ai.010–015, ai.019) → recognise them (any UI language) to fall back to the offline parser.
function netDown(msg) {
  msg = String(msg || '');
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|not responding|timed out|Timeout|δεν απαντά/i.test(msg)) return true; // i18n-ignore
  for (const k of ['ai.001', 'ai.010', 'ai.011', 'ai.012', 'ai.013', 'ai.015', 'ai.019']) for (const L of [I18N.el, I18N[LANG]]) {
    const s = L && L[k]; if (!s) continue;
    const frag = s.split(/\{v\d\}/).map(x => x.trim()).sort((a, b) => b.length - a.length)[0];
    if (frag && frag.length >= 6 && msg.includes(frag)) return true;
  }
  return false;
}
function md(s) {
  let x = esc(String(s || '')).replace(/```([\s\S]*?)```/g, (m, c) => `<pre><code>${c.replace(/^\w*\n/, '')}</code></pre>`);
  x = x.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>').replace(/^\s*[-*•] (.*)$/gm, '<li>$1</li>').replace(/^\s*\d+[.)] (.*)$/gm, '<li>$1</li>');
  x = x.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '$1</ul>').replace(/(^|[^>])(<li>)/g, '$1<ul>$2').replace(/<\/li>\n/g, '</li>');
  return x.replace(/\n/g, '<br>').replace(/<\/(h\d|ul|pre)><br>/g, '</$1>');
}
const COLORS_GR = { 'κιτρινο': '#ffe66d', 'πορτοκαλι': '#ffb86b', 'ροζ': '#ff8fab', 'μωβ': '#c3a6ff', 'μπλε': '#8fd3ff', 'γαλαζιο': '#8fd3ff', 'πρασινο': '#9ef0c4', 'ασπρο': '#f5f5f5', 'λευκο': '#f5f5f5', 'σκουρο': '#2b2f3a', 'μαυρο': '#2b2f3a', 'κοκκινο': '#ff4d6d', yellow: '#ffe66d', orange: '#ffb86b', pink: '#ff8fab', purple: '#c3a6ff', blue: '#8fd3ff', green: '#9ef0c4', white: '#f5f5f5', dark: '#2b2f3a', red: '#ff4d6d' };
const colorOf = (c, def) => !c ? def : /^#/.test(c) ? c : (COLORS_GR[norm(c)] || def);
const GR_DAYS = [t('assistant.001'), t('assistant.002'), t('assistant.003'), t('assistant.004'), t('assistant.005'), t('assistant.006'), t('assistant.007')];

const Cmd = {
  // ---------- helpers ----------
  items() { return Store.items(); },
  find(args, opts = {}) {
    const all = opts.all ? allItems() : this.items();
    let out = [];
    if (Array.isArray(args.ids) && args.ids.length) out = all.filter(i => args.ids.some(id => i.id === id || i.id.startsWith(String(id))));
    else if (args.id) out = all.filter(i => i.id === args.id || i.id.startsWith(String(args.id)));
    if (!out.length && args.query) out = Search.lexical(args.query, all);
    if (!out.length && (args.selection || opts.selection)) out = Canvas.selItems();
    if (args.type) out = out.filter(i => i.type === args.type || (args.type === 'note' && ['sticky', 'text'].includes(i.type)));
    if (args.tag) out = out.filter(i => (i.tags || []).some(t => norm(t) === norm(args.tag)));
    return out.filter(i => i.type !== 'arrow' || args.include_arrows);
  },
  brief(it) { return { id: it.id.slice(0, 8), type: it.type, title: Features.itemTitle(it).slice(0, 80), ...(it.tags?.length ? { tags: it.tags } : {}), ...(BoardOf.get(it) && BoardOf.get(it).id !== Store.state.active ? { board: BoardOf.get(it).name } : {}) }; },
  freeSpot(w, hgt, near) {
    const c = near || Canvas.center(); const items = this.items(); const hit = (x, y) => items.some(i => i.type !== 'frame' && x < i.x + i.w + 24 && x + w + 24 > i.x && y < i.y + (i.h || 40) + 24 && y + hgt + 24 > i.y);
    for (let r = 0; r < 40; r++) for (let a = 0; a < Math.max(1, r * 6); a++) { const ang = a / Math.max(1, r * 6) * Math.PI * 2; const x = c.x - w / 2 + Math.cos(ang) * r * 70, y = c.y - hgt / 2 + Math.sin(ang) * r * 55; if (!hit(x, y)) return { x: x + w / 2, y: y + hgt / 2 }; }
    return c;
  },
  html(text) { return /<\w/.test(text) ? sanitize(text) : md(text); },
  async confirm(title, list, okLabel, force) {
    if (!force && !Store.state.settings.ai.assistant.confirm) return true;
    return new Promise((res) => { let done = false; Panels.modal('⚠️ ' + esc(title), h('div', {}, h('p', {}, t('assistant.008')), h('ul', { class: 'confirm-list' }, ...list.slice(0, 12).map(x => h('li', {}, x)), list.length > 12 ? h('li', {}, t('assistant.009', { v0: list.length - 12 })) : null)), { okLabel: okLabel || t('assistant.010'), ok: () => { done = true; res(true); }, onClose: () => { if (!done) res(false); } }); });
  },
  layoutGrid(items, x0, y0, gap = 28, cols) {
    cols ||= Math.max(1, Math.ceil(Math.sqrt(items.length))); let x = x0, y = y0, rowH = 0, c = 0; let maxX = x0;
    for (const i of items) { const ih = i.type === 'text' ? Canvas.itemH(i) : i.h; i.x = x; i.y = y; x += i.w + gap; rowH = Math.max(rowH, ih); maxX = Math.max(maxX, x); if (++c >= cols) { c = 0; x = x0; y += rowH + gap; rowH = 0; } }
    return { w: maxX - x0 - gap, h: (c ? y + rowH : y - gap) - y0 };
  },
  remount(items) { items.forEach(i => Items.mount(i)); Canvas.drawSel(); Minimap.drawSoon(); Panels.tabs(); },
  // ---------- tools ----------
  T: {
    create_card: { d: t('assistant.011'), p: { kind: { type: 'string', enum: ['note', 'text', 'checklist', 'heading', 'link', 'countdown', 'reminder', 'frame', 'code'] }, text: { type: 'string', description: t('assistant.012') }, title: { type: 'string' }, url: { type: 'string' }, date: { type: 'string', description: t('assistant.013') }, repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'] }, color: { type: 'string', description: t('assistant.014') }, tags: { type: 'array', items: { type: 'string' } }, near_id: { type: 'string' } }, req: ['kind'],
      async run(a) {
        const kind = a.kind || 'note';
        if (a.date && (kind === 'reminder' || kind === 'countdown')) { const at = NyxCalc.toInstant(a.date, { now: new Date() }); if (!at) return { ok: false, error: t('v269.date_unknown', { v0: a.date }) }; a = { ...a, date: at.toISOString() }; }
        const near = a.near_id ? Cmd.find({ id: a.near_id })[0] : null; const nearPt = near ? { x: near.x + near.w + 160, y: near.y + 80 } : null;
        const text = a.text || a.title || ''; let it;
        const P = (w, hh) => Cmd.freeSpot(w, hh, nearPt);
        if (kind === 'link' || (a.url && kind !== 'reminder')) { const p = P(340, 280); it = await Features.addLinkUrl(a.url || text, p); }
        else if (kind === 'countdown') { const p = P(340, 170); it = Features.addAt({ type: 'countdown', w: 340, h: 170, title: a.title || text || 'Countdown', emoji: '⏳', target: new Date(a.date || Date.now() + 864e5).toISOString(), color: colorOf(a.color, '#7c8cff') }, p.x, p.y); }
        else if (kind === 'reminder') { const at = new Date(a.date || Date.now() + 3600e3); const p = P(320, 120); it = Features.addAt({ type: 'reminder', w: 320, h: 120, html: esc(text || a.title || t('features.007') + ' · ' + fmtDate(at)), size: 18, reminder: { on: true, at: at.toISOString(), repeat: a.repeat || 'none', msg: text || a.title || '' } }, p.x, p.y); }
        else if (kind === 'frame') { const p = P(640, 420); it = Features.addAt({ type: 'frame', w: 640, h: 420, title: a.title || text || t('items.007'), color: colorOf(a.color, '#7c8cff'), z: 0 }, p.x, p.y); }
        else if (kind === 'heading') { const p = P(520, 60); it = Features.addAt({ type: 'text', w: 520, h: 60, html: esc(text), font: 'Dela Gothic One', size: 34 }, p.x, p.y); }
        else if (kind === 'text' || kind === 'code') { const html = kind === 'code' ? `<pre><code>${esc(text)}</code></pre>` : Cmd.html(text); const w = Math.min(560, 260 + text.length * 1.2); const p = P(w, 120); it = Features.addAt({ type: 'text', w, h: 60, html, size: 16, bg: 'var(--card)', font: kind === 'code' ? 'JetBrains Mono' : 'Inter' }, p.x, p.y); }
        else { const lines = kind === 'checklist' ? String(text).split(/\n|;|,(?![^(]*\))/).map(s => s.replace(/^[-*•☐\s]+/, '').trim()).filter(Boolean).map(s => '☐ ' + esc(s)).join('<br>') : Cmd.html(text); const len = plainText(lines).length; const sz = len > 220 ? 15 : len > 110 ? 17 : 20; const w = len > 220 ? 300 : 230; const p = P(w, w); it = Features.addAt({ type: 'sticky', w, h: Math.max(200, Math.min(420, 120 + len * 0.9)), html: (a.title && kind !== 'checklist' ? `<b>${esc(a.title)}</b><br>` : a.title ? `<b>${esc(a.title)}</b><br>` : '') + lines, paper: colorOf(a.color, STICKY[0]), font: 'Playpen Sans', size: sz }, p.x, p.y); }
        if (it && a.tags?.length) { it.tags = [...new Set(a.tags.map(t => String(t).replace(/^#/, '')))]; Items.mount(it); Store.save(); }
        Automations.fire('card', it);
        return { ok: true, id: it.id.slice(0, 8), kind };
      } },
    create_cards: { d: t('assistant.015'), p: { cards: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, text: { type: 'string' }, title: { type: 'string' }, color: { type: 'string' }, url: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } }, frame_title: { type: 'string' } }, req: ['cards'],
      async run(a) { const made = []; for (const c of (a.cards || []).slice(0, 40)) { const r = await Cmd.T.create_card.run({ kind: 'note', ...c }); made.push(Cmd.find({ id: r.id })[0]); } if (a.frame_title && made.length) Cmd.T.group_cards.run({ ids: made.map(m => m.id), title: a.frame_title }); return { ok: true, created: made.length }; } },
    update_card: { d: t('assistant.016'), p: { id: { type: 'string' }, query: { type: 'string' }, text: { type: 'string' }, append: { type: 'string' }, title: { type: 'string' }, color: { type: 'string' }, add_tags: { type: 'array', items: { type: 'string' } }, remove_tags: { type: 'array', items: { type: 'string' } } },
      async run(a) { const its = Cmd.find(a).slice(0, a.id ? 1 : 20); if (!its.length) return { ok: false, error: t('assistant.017') };
        Store.change(() => { for (const it of its) { if (a.text != null && 'html' in it || (a.text != null && ['text', 'sticky', 'shape', 'reminder'].includes(it.type))) it.html = Cmd.html(a.text); if (a.append) it.html = (it.html || '') + '<br>' + Cmd.html(a.append); if (a.title != null) it.title = a.title; if (a.color) { const k = { sticky: 'paper', shape: 'stroke', frame: 'color', countdown: 'color', text: 'color' }[it.type]; if (k) it[k] = colorOf(a.color, it[k]); } if (a.add_tags) it.tags = [...new Set([...(it.tags || []), ...a.add_tags.map(t => String(t).replace(/^#/, ''))])]; if (a.remove_tags) it.tags = (it.tags || []).filter(t => !a.remove_tags.some(r => norm(r) === norm(t))); } });
        Cmd.remount(its); return { ok: true, updated: its.length }; } },
    delete_cards: { d: t('assistant.018'), p: { ids: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, type: { type: 'string' }, tag: { type: 'string' } },
      async run(a) { const its = Cmd.find(a); if (!its.length) return { ok: false, error: t('assistant.019') }; if (!(await Cmd.confirm(t('assistant.020', { length: its.length }), its.map(i => Features.itemTitle(i)), t('panels.054')))) return { ok: false, cancelled: true, note: t('assistant.021') };
        const ids = its.map(i => i.id); Store.change(() => Store.removeItems(ids)); ids.forEach(id => Items.unmount(id)); Canvas.sel.clear(); Canvas.refresh(); Panels.tabs(); toast(`🗑️ ${ids.length}`, { action: { label: t('undo'), fn: () => App.undo() } }); return { ok: true, deleted: ids.length }; } },
    move_cards: { d: t('assistant.022'), p: { ids: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, to_board: { type: 'string' }, near_id: { type: 'string' }, dx: { type: 'number' }, dy: { type: 'number' } },
      async run(a) { const its = Cmd.find(a); if (!its.length) return { ok: false, error: t('assistant.019') };
        if (a.to_board) { let b = Store.state.boards.find(b => norm(b.name).includes(norm(a.to_board))); if (!b) { if (!(await Cmd.confirm(t('assistant.023', { to_board: a.to_board, length: its.length }), its.map(i => Features.itemTitle(i))))) return { ok: false, cancelled: true }; b = { id: uid(), name: a.to_board, emoji: '📁', color: PALETTE[6], view: null, items: [] }; Store.state.boards.push(b); } else if (!(await Cmd.confirm(t('assistant.024', { length: its.length, name: b.name }), its.map(i => Features.itemTitle(i))))) return { ok: false, cancelled: true };
          Canvas.select(its.map(i => i.id)); Actions.moveTo(b); Panels.tabs(); return { ok: true, moved: its.length, board: b.name }; }
        const near = a.near_id ? Cmd.find({ id: a.near_id })[0] : null; Store.change(() => { if (near) Cmd.layoutGrid(its, near.x + near.w + 40, near.y); else for (const i of its) { i.x += a.dx || 0; i.y += a.dy || 0; } }); Cmd.remount(its); return { ok: true, moved: its.length }; } },
    group_cards: { d: t('assistant.025'), p: { ids: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, tag: { type: 'string' }, type: { type: 'string' }, title: { type: 'string' }, color: { type: 'string' } },
      async run(a) { const its = Cmd.find(a).filter(i => i.type !== 'frame'); if (!its.length) return { ok: false, error: t('assistant.019') }; const g = uid(); const pad = 36; const c = Cmd.freeSpot(800, 500); let fr;
        Store.change(() => { const sz = Cmd.layoutGrid(its, c.x - 360, c.y - 200); its.forEach(i => { i.group = g; }); fr = Store.addItem({ type: 'frame', x: c.x - 360 - pad, y: c.y - 200 - pad - 30, w: sz.w + pad * 2, h: sz.h + pad * 2 + 30, title: a.title || a.query || t('assistant.026'), color: colorOf(a.color, '#7c8cff'), z: 0 }); });
        Items.mount(fr); Cmd.remount(its); Canvas.select(its.map(i => i.id)); setTimeout(() => Canvas.fit?.(), 50); return { ok: true, grouped: its.length, frame: fr.id.slice(0, 8) }; } },
    tidy_board: { d: t('assistant.027'), p: { by: { type: 'string', enum: ['type', 'tag', 'grid'] } },
      async run(a) { const by = a.by || 'type'; const its = Cmd.items().filter(i => !['frame', 'arrow', 'line', 'ink'].includes(i.type) && !i.locked); if (!its.length) return { ok: false, error: t('assistant.028') };
        const key = (i) => by === 'tag' ? (i.tags?.[0] || '—') : by === 'grid' ? 'all' : ({ sticky: t('assistant.029'), text: t('assistant.030'), image: t('assistant.031'), video: t('assistant.032'), audio: t('assistant.033'), link: t('assistant.034'), web: t('assistant.035') })[i.type] || t('assistant.036');
        const groups = {}; for (const i of its) (groups[key(i)] ||= []).push(i); let x = 0; const c = Canvas.center();
        Store.change(() => { for (const [k, list] of Object.entries(groups)) { list.sort((p, q) => (p.y - q.y) || (p.x - q.x)); const cols = by === 'grid' ? Math.ceil(Math.sqrt(list.length)) : Math.min(2, list.length); const sz = Cmd.layoutGrid(list, c.x - 600 + x, c.y - 300, 24, cols); x += sz.w + 90; } });
        Cmd.remount(its); Canvas.fit(); toast(t('assistant.037'), { action: { label: t('undo'), fn: () => App.undo() } }); return { ok: true, groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])) }; } },
    search_cards: { d: t('assistant.038'), p: { query: { type: 'string' }, all_boards: { type: 'boolean' } }, req: ['query'],
      async run(a) { const r = Search.lexical(a.query, a.all_boards ? allItems() : Cmd.items()); return { count: r.length, cards: r.slice(0, 25).map(i => Cmd.brief(i)) }; } },
    read_cards: { d: t('assistant.039'), p: { ids: { type: 'array', items: { type: 'string' } }, query: { type: 'string' }, selection: { type: 'boolean' } },
      async run(a) { const its = Cmd.find(a).slice(0, 40); return { cards: its.map(i => ({ ...Cmd.brief(i), text: Search.text(i).slice(0, 2500) })) }; } },
    show_card: { d: t('assistant.040'), p: { id: { type: 'string' }, query: { type: 'string' } },
      async run(a) { const all = Store.state.boards.flatMap(b => b.items); let it = Cmd.find({ ...a, ids: a.id ? [a.id] : undefined }, { all: true })[0]; if (!it) return { ok: false, error: t('assistant.041') }; Canvas.focusItem(it.id); return { ok: true, title: Features.itemTitle(it) }; } },
    summarize: { d: t('assistant.042'), p: { scope: { type: 'string', enum: ['board', 'selection', 'query'] }, query: { type: 'string' }, style: { type: 'string', description: t('assistant.043') } },
      async run(a) { const its = a.scope === 'selection' ? Canvas.selItems() : a.scope === 'query' || a.query ? Cmd.find({ query: a.query }) : Cmd.items(); const txt = its.map(i => '• ' + Search.text(i)).filter(s => s.length > 3).join('\n').slice(0, 12000); if (!txt) return { ok: false, error: t('assistant.044') };
        const s = await AI.text('summarize', t('assistant.045', { v0: a.style || t('assistant.046'), txt }), t('assistant.047'));
        await Cmd.T.create_card.run({ kind: 'text', text: t('assistant.048') + s }); return { ok: true, summary: s.slice(0, 600) }; } },
    create_board: { d: t('assistant.049'), p: { name: { type: 'string' }, emoji: { type: 'string' } }, req: ['name'],
      async run(a) { const b = { id: uid(), name: a.name, emoji: a.emoji || '✨', color: PALETTE[4 + Store.state.boards.length % 10], view: null, items: [] }; Store.state.boards.push(b); Store.save(); App.switchBoard(b.id); return { ok: true }; } },
    open_board: { d: t('assistant.050'), p: { name: { type: 'string' } }, req: ['name'],
      async run(a) { const b = Store.state.boards.find(b => norm(b.name).includes(norm(a.name))); if (!b) return { ok: false, error: t('assistant.051') + a.name, boards: Store.state.boards.map(b => b.name) }; App.switchBoard(b.id); return { ok: true }; } },
    add_subscription: { d: t('assistant.052'), p: { name: { type: 'string' }, price: { type: 'number' }, currency: { type: 'string' }, cycle: { type: 'string', enum: ['weekly', 'monthly', 'quarterly', 'yearly'] }, next: { type: 'string', description: t('assistant.053') } }, req: ['name'],
      async run(a) { if (a.next && !/^\d{4}-\d{2}-\d{2}$/.test(String(a.next))) { const r = NyxCalc.resolveDate(a.next, { now: new Date() }); if (!r.ok) return { ok: false, error: t('v269.date_unknown', { v0: a.next }) }; a = { ...a, next: r.date }; } const s = { id: uid(), name: a.name, price: a.price || 0, currency: a.currency || 'EUR', cycle: a.cycle || 'monthly', next: a.next || '', active: true, remindDays: 2, color: PALETTE[8] }; Store.state.subs.push(s); Store.save(); Features.refreshSubsCards(); return { ok: true }; } },
    set_theme: { d: t('assistant.054'), p: { name: { type: 'string', description: t('assistant.055') + (typeof THEMES !== 'undefined' ? THEMES.map(t => t.name).join(', ') : '') } }, req: ['name'],
      async run(a) { const th = THEMES.find(t => norm(t.name).includes(norm(a.name)) || norm(t.id).includes(norm(a.name))); if (!th) return { ok: false, themes: THEMES.map(t => t.name) }; Store.state.settings.theme = th.id; Theme.apply(Store.state.settings); Store.save(); return { ok: true, theme: th.name }; } },
    open_url: { d: t('assistant.056'), p: { url: { type: 'string' }, where: { type: 'string', enum: ['browser', 'canvas', 'external'] } }, req: ['url'],
      async run(a) { let u = a.url.trim(); if (!/^https?:/.test(u)) u = 'https://' + u; if (a.where === 'canvas') { await Features.addLinkUrl(u); } else if (a.where === 'external') API.openExternal(u); else Browser.open(u); return { ok: true }; } },
    web_search: { d: t('assistant.057'), p: { query: { type: 'string' } }, req: ['query'],
      async run(a) { Browser.open(Store.state.settings.browser.search.replace('%s', encodeURIComponent(a.query))); return { ok: true }; } },
    // v2.6.9: dates and amounts are computed by Nyx, not by the model (read-only tools, never touch the canvas)
    date_calc: { d: t('v269.tool_date'), p: { expr: { type: 'string', description: t('v269.tool_date_expr') }, base: { type: 'string', description: t('v269.tool_date_base') } }, req: ['expr'],
      async run(a) { return NyxCalc.dateTool(a, { now: new Date() }); } },
    money_calc: { d: t('v269.tool_money'), p: { op: { type: 'string', enum: ['split', 'sum', 'percent', 'arith'] }, total: { type: 'string', description: t('v269.tool_money_total') }, parts: { type: 'number' }, weights: { type: 'array', items: { type: 'number' } }, names: { type: 'array', items: { type: 'string' } }, items: { type: 'array', items: { type: 'string' } }, percent: { type: 'number' }, expr: { type: 'string', description: t('v269.tool_money_expr') }, currency: { type: 'string' } }, req: ['op'],
      async run(a) { return NyxCalc.money(a, { lang: LANG === 'en' ? 'en' : 'el' }); } },
    open_panel: { d: t('assistant.058'), p: { panel: { type: 'string', enum: ['subs', 'reminders', 'store', 'tools', 'ai', 'browser', 'settings', 'themes', 'automations', 'history'] } }, req: ['panel'],
      async run(a) { ({ subs: () => Panels.subs(), reminders: () => Panels.reminders(), store: () => PluginStore.open(), tools: () => Hub.tools(), ai: () => Hub.open(), browser: () => Browser.show(), settings: () => Panels.settings(), themes: () => Panels.themes(), automations: () => PluginStore.open('auto'), history: () => Extras.snapshots() })[a.panel]?.(); return { ok: true }; } },
    run_plugin: { d: t('assistant.059'), p: { plugin: { type: 'string' }, action: { type: 'string' }, args: { type: 'object' } }, req: ['plugin', 'action'],
      async run(a) { const r = await API.inv('plugins:action', a.plugin, a.action, a.args || {}); if (r && typeof r === 'object' && (r.show || r.toastKey)) { PluginStore.showResult(r); return { ok: true, shown_to_user: true }; } return r; } },
  },
  tools() { return Object.entries(this.T).map(([name, t]) => ({ type: 'function', function: { name, description: t.d, parameters: { type: 'object', properties: t.p, required: t.req || [] } } })); },
  WRITE: new Set(['create_card', 'create_cards', 'update_card', 'delete_cards', 'move_cards', 'group_cards', 'tidy_board', 'create_board', 'place_attachments', 'summarize']),
  wantsWrite(text) {
    const n = norm(String(text || ''));
    if (this._forceCanvas) return true;
    if (!n) return false;
    return /(στον\s+καμβα|στην\s+πινακιδα|στον\s+πινακα)/.test(n)
      || /((φτιαξε|δημιουργησε|γραψε|βαλε|κανε|σημειωσε|προσθεσε|μαζεψε|τακτοποιησε|ομαδοποιησε|σβησε|διαγραψε|μετακινησε).{0,60}(καρτ|σημειω|χαρτακ|post.?it|sticky|λιστα|πλαισιο|υπενθυμ|καμβα|πινακ))/.test(n)
      || /((create|add|put|make|write|place|move|delete|remove|group|tidy).{0,60}(card|note|sticky|canvas|board|frame|reminder))/.test(n)
      || /^(φτιαξε|δημιουργησε|σημειωσε|γραψε|βαλε)\s+/.test(n);
  },
  async exec(name, args) {
    const T = this.T[name]; if (!T) return { ok: false, error: t('assistant.060') + name };
    try { if (typeof args === 'string') args = JSON.parse(args || '{}'); } catch (e) { args = {}; }
    args = args || {};
    const writes = this.WRITE.has(name) || (name === 'open_url' && args.where === 'canvas');
    if (writes && !this._forceCanvas && !this.wantsWrite(this._lastUser || '')) {
      return { ok: false, blocked: true, error: t('v2681.canvas_blocked') };
    }
    if (writes && !this._forceCanvas && Store.state.settings.ai.assistant && Store.state.settings.ai.assistant.canvasConfirm !== false) {
      const title = t('v2681.canvas_confirm_title', { tool: name });
      if (!(await this.confirm(title, [name + (args.title || args.text || args.name ? ': ' + String(args.title || args.text || args.name).slice(0, 80) : '')], t('assistant.010'), true))) {
        return { ok: false, cancelled: true, note: t('assistant.021') };
      }
    }
    try { return await T.run(args); } catch (e) { console.error(e); return { ok: false, error: String(e.message || e) }; }
  },
  async toCanvas(m, kind) {
    this._forceCanvas = true;
    try {
      const r = await this.T.create_card.run({ kind: kind || 'text', text: m.content || '' });
      toast(t('v2681.to_canvas_done'), { action: { label: t('undo'), fn: () => App.undo() } });
      return r;
    } finally { this._forceCanvas = false; }
  },
};

// Offline fallback (no model reachable): Greek intents, accent/case-insensitive (all regexes run on norm(text)).
// v2.3: polite prefixes («θέλω να γράψεις…», «μπορείς να…», «σε παρακαλώ»), note/σημείωμα/χαρτάκι/post-it, «υπενθύμισέ με…»,
// «άνοιξε συνδρομές/ρυθμίσεις…», bare «γράψε X», «σημείωσε X».
const LocalIntent = {
  NOUN: '(σημειωση|σημειωσεις|σημειωμα|σημειωματακι|note|notes|χαρτακι|χαρτι|post-?it|sticky|καρτα|καρτουλα|λιστα|checklist|κειμενο|τιτλο|επικεφαλιδα|υπενθυμιση)', // i18n-ignore
  VERB: { γραψεις: 'γραψε', φτιαξεις: 'φτιαξε', δειξεις: 'δειξε', σβησεις: 'σβησε', βαλεις: 'βαλε', κανεις: 'κανε', ανοιξεις: 'ανοιξε', βρεις: 'βρες', ψαξεις: 'ψαξε', διαγραψεις: 'διαγραψε', προσθεσεις: 'προσθεσε', δημιουργησεις: 'δημιουργησε', σημειωσεις: 'σημειωσε', υπενθυμισεις: 'υπενθυμισε', μαζεψεις: 'μαζεψε', τακτοποιησεις: 'τακτοποιησε' }, // i18n-ignore
  // returns [normalized, original] with polite prefixes removed (same length mapping: norm() keeps 1 char per precomposed letter)
  clean(s) {
    let o = s.trim().replace(/[.!;?]+$/, ''); let n = norm(o);
    const cut = (re) => { const m = n.match(re); if (m) { o = o.slice(m[0].length); n = n.slice(m[0].length); return true; } return false; };
    for (let i = 0; i < 4; i++) { if (!(cut(/^\s*(?:(?:σε\s+)?παρακαλω|please|ρε|ε+|λοιπον|γεια)[\s,]+/) || cut(/^\s*(?:θελω|θα\s+ηθελα|μπορεις|μπορειτε|μπορεις\s+σε\s+παρακαλω|γινεται|ελα)\s+(?:να\s+)?(?:μου\s+)?/))) break; }
    const v = n.match(/^\s*([α-ω]+)/); if (v && this.VERB[v[1]]) { const rep = this.VERB[v[1]]; o = rep + o.slice(v[0].length); n = rep + n.slice(v[0].length); }
    return [n.trim(), o.trim()];
  },
  when(n) {
    const d = new Date(); let m; let set = false;
    if ((m = n.match(/σε\s+(\d+|ενα|μια|μιση)\s*(λεπτ\w*|ωρ\w*|μερ\w*|min\w*|hour\w*|day\w*)/))) { const k = { ενα: 1, μια: 1, μιση: 0.5 }[m[1]] ?? +m[1]; const u = /^λ|^m/.test(m[2]) ? 60e3 : /^ω|^h/.test(m[2]) ? 3600e3 : 864e5; return new Date(Date.now() + k * u); }
    if (/αυριο|tomorrow/.test(n)) { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); set = true; }
    if (/αποψε|tonight/.test(n)) { d.setHours(21, 0, 0, 0); set = true; }
    if ((m = n.match(/(?:στις|at)\s+(\d{1,2})(?:[:.](\d{2}))?/))) { d.setHours(+m[1], +(m[2] || 0), 0, 0); if (!/αυριο|tomorrow/.test(n) && d < new Date()) d.setDate(d.getDate() + 1); set = true; }
    return set ? d : new Date(Date.now() + 3600e3);
  },
  stripWhen(s) { return s.replace(/\s*(?:σε\s+(?:\d+|ένα|ενα|μία|μια|μισή|μιση)\s*\S+|αύριο|αυριο|απόψε|αποψε|(?:στις|at)\s+\d{1,2}(?:[:.]\d{2})?)\s*/gi, ' ').trim().replace(/^(?:για|να)\s+(?:(?:το|τα|την|τη|τον|τις)\s+)?/i, '').trim(); },
  parse(text) {
    const [n, s] = this.clean(text); if (!n) return null; let m;
    const tail = (k) => s.slice(s.length - k.length).trim();
    const kindOf = (w) => /λιστα|checklist/.test(w) ? 'checklist' : /κειμενο/.test(w) ? 'text' : /τιτλο|επικεφαλιδα/.test(w) ? 'heading' : /υπενθυμιση/.test(w) ? 'reminder' : 'note'; // i18n-ignore
    // reminders: «υπενθύμισέ μου/με (να) X αύριο στις 9», «βάλε υπενθύμιση για X»
    if ((m = n.match(/^(?:υπενθυμισε|θυμισε)\s+(?:μου|με|μας)?\s*(?:να\s+|οτι\s+|για\s+(?:το\s+|τα\s+|την\s+)?)?(.*)$/)) || (m = n.match(/^(?:βαλε|φτιαξε|κανε|προσθεσε)\s+(?:μια\s+|μου\s+)*υπενθυμιση\s*(?:για\s+(?:το\s+|τα\s+|την\s+)?|να\s+|:)?\s*(.*)$/))) {
      const txt = this.stripWhen(tail(m[1])); return [{ tool: 'create_card', args: { kind: 'reminder', text: txt || t('features.007'), date: this.when(n).toISOString() } }];
    }
    // panels
    const PAN = [[/συνδρομ/, 'subs'], [/υπενθυμισ/, 'reminders'], [/ρυθμισ|settings/, 'settings'], [/θεματ|themes/, 'themes'], [/browser|φυλλομετρητ|περιηγητ/, 'browser'], [/μοντελ|ai\b|hub/, 'ai'], [/εργαλει|tools/, 'tools'], [/ιστορικ|history/, 'history'], [/καταστημα|store|plugin/, 'store'], [/αυτοματισμ/, 'automations']]; // i18n-ignore
    if ((m = n.match(/^(?:ανοιξε|δειξε|παμε)\s+(?:μου\s+)?(?:τις?\s+|τα\s+|το\s+|τον\s+|στα?\s+|στις\s+|στον\s+)?(.+)$/))) { const pnl = PAN.find(([re]) => re.test(m[1]) && m[1].split(/\s+/).length <= 3); if (pnl) return [{ tool: 'open_panel', args: { panel: pnl[1] } }]; }
    // create: «γράψε/φτιάξε (μου) (μια) σημείωση/note/σημείωμα (για|με|:) X», «σημείωσε X», bare «γράψε X»
    const CRE = '(?:φτιαξε|φτιαχνε|γραψε|γραφε|δημιουργησε|βαλε|κανε|προσθεσε|προσθεσε|σημειωσε|κρατα|add|write|make|create)'; // i18n-ignore
    if ((m = n.match(new RegExp('^' + CRE + '\\s+(?:μου\\s+|μας\\s+)?(?:μια\\s+|ενα\\s+|μιαν\\s+|καινουρι[αο]\\s+|νε[αο]\\s+|a\\s+|new\\s+)*' + this.NOUN + '\\s*(?:για\\s+(?:το\\s+|τα\\s+|την\\s+|τη\\s+|τις\\s+|τον\\s+)?|με\\s+(?:το\\s+|τα\\s+)?|που\\s+(?:να\\s+)?(?:λεει|γραφει)\\s+|οτι\\s+|about\\s+|:|-)?\\s*(.*)$')))) { // i18n-ignore
      const kind = kindOf(m[1]); const txt = tail(m[2]); if (kind === 'reminder') return [{ tool: 'create_card', args: { kind, text: this.stripWhen(txt) || t('features.007'), date: this.when(n).toISOString() } }];
      return [{ tool: 'create_card', args: { kind, text: txt } }];
    }
    if ((m = n.match(/^(?:σημειωσε|κρατα\s+σημειωση|γραψε|note)\s*(?:μου\s+)?(?:οτι\s+|:)?\s*(.+)$/)) && !/^(?:στο|στη|στον)\s/.test(m[1])) return [{ tool: 'create_card', args: { kind: 'note', text: tail(m[1]) } }];
    if ((m = n.match(/^(?:σβησε|διεγραψε|διαγραψε|πεταξε|delete|remove)\s+(?:μου\s+)?(?:ολες\s+|ολα\s+)?(?:τις|τα|την|το|τη|τον)?\s*(?:σημειωσεις|σημειωση|σημειωμα|σημειωματα|notes?|καρτες|καρτα|χαρτακια|χαρτακι)?\s*(?:για|με|που\s+λενε|που\s+γραφουν|που\s+λεει|about)?\s*(.+)$/))) return [{ tool: 'delete_cards', args: { query: m[1] } }];
    if ((m = n.match(/^(?:μαζεψε|ομαδοποιησε|συγκεντρωσε|group)\s+(?:ολες\s+|ολα\s+)?(?:τις|τα|την|το)?\s*(?:σημειωσεις|καρτες|notes)?\s*(?:για|με)?\s*(.+)$/))) return [{ tool: 'group_cards', args: { query: m[1], title: tail(m[1]) } }];
    if (/^(?:τακτοποιησε|συμμαζεψε|συμαζεψε|καθαρισε|οργανωσε|tidy)/.test(n)) return [{ tool: 'tidy_board', args: { by: /tag|ετικετ/.test(n) ? 'tag' : 'type' } }]; // i18n-ignore
    if ((m = n.match(/^(?:δειξε|βρες|ψαξε|που\s+ειναι|show|find)\s+(?:μου\s+)?(?:την|το|τις|τα|τη|τον)?\s*(?:σημειωση|σημειωμα|note|καρτα)?\s*(?:για|με)?\s*(.+)$/))) return [{ tool: 'show_card', args: { query: m[1] } }];
    if ((m = s.match(/^(?:άνοιξε|ανοιξε|open)\s+(\S+\.\S+)$/i))) return [{ tool: 'open_url', args: { url: m[1], where: 'browser' } }];
    if ((m = n.match(/^(?:ανοιξε|παμε)\s+(?:στον?\s+)?(?:πινακα\s+|καμβα\s+)?(.+)$/))) return [{ tool: 'open_board', args: { name: m[1] } }];
    if ((m = n.match(/^(?:θεμα|βαλε\s+θεμα|αλλαξε\s+θεμα\s+(?:σε)?)\s*(.+)$/))) return [{ tool: 'set_theme', args: { name: m[1].trim() } }];
    return null;
  },
};

const Assistant = {
  busy: false, el: null, _cancelled: false,
  init() {
    const el = this.el = h('div', { id: 'assistant', class: 'assistant', hidden: true },
      h('div', { class: 'as-head' }, h('span', { class: 'as-logo', html: iconSvg('sparkles', 18) }), h('b', {}, t('assistant.061')), h('span', { class: 'as-model chip', id: 'as-model' }, '…'), h('span', { class: 'as-limit muted small', id: 'as-limit', title: t('v265.limit_tip') }, ''), h('div', { class: 'grow' }),
        h('button', { class: 'ib as-think', id: 'as-think', title: t('v265.think_tip'), onclick: () => this.toggleThink() }, t('v265.think')),
        h('button', { class: 'chip as-think-cap', id: 'as-think-cap', type: 'button', title: t('v269.think_cap_tip'), onclick: () => this.editThinkCap() }, ''),
        h('button', { class: 'ib', title: t('assistant.062'), html: iconSvg('settings-2', 16), onclick: () => Hub.open() }), h('button', { class: 'ib', title: t('assistant.063'), html: iconSvg('eraser', 16), onclick: () => { Store.state.chat = []; Store.save(); this.render(); } }), h('button', { class: 'ib', title: t('assistant.064'), html: iconSvg('x', 16), onclick: () => this.hide() })),
      h('div', { class: 'as-msgs', id: 'as-msgs' }),
      h('div', { class: 'as-sugg', id: 'as-sugg' }, ...[t('assistant.065'), t('assistant.066'), t('assistant.067'), t('assistant.068'), t('assistant.069')].map(s => h('button', { class: 'chip', onclick: () => this.send(s) }, s))),
      h('div', { class: 'as-input' }, h('button', { class: 'ib mic', id: 'as-mic', title: t('assistant.070'), html: iconSvg('mic', 18), onclick: () => this.mic() }),
        h('textarea', { id: 'as-q', rows: 1, placeholder: t('assistant.071'), onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.stopPropagation(); if (e.target.value) return; e.preventDefault(); return App.undo(); } e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } if (e.key === 'Escape') this.hide(); }, oninput: (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; } }),
        h('button', { class: 'ib send', id: 'as-send', title: t('assistant.072'), html: iconSvg('send', 18), onclick: () => this.onSendClick() })));
    el.append(h('div', { class: 'as-rs', title: t('v24.as_resize') }));
    document.body.append(el); this.render(); this.syncThink();
    API?.onAssistantOpen?.(() => this.show(true));
    this.initFrame();
  },
  // ---------- v2.4: the assistant is a movable/resizable window that never overlaps an open side panel ----------
  initFrame() {
    const el = this.el; const head = el.querySelector('.as-head');
    const S = () => Store.state.settings;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button,input,select,.chip')) return; e.preventDefault();
      const r = el.getBoundingClientRect(); const ox = e.clientX - r.left, oy = e.clientY - r.top; el.classList.add('as-drag'); head.setPointerCapture(e.pointerId);
      const mv = (ev) => { const R = this.rect(); S().asRect = { ...R, x: ev.clientX - ox, y: ev.clientY - oy }; this.layout(); };
      const up = () => { el.classList.remove('as-drag'); head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); this.layout(); Store.save(); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
    });
    head.addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; delete S().asRect; Store.save(); this.layout(); });
    const rs = el.querySelector('.as-rs');
    rs.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); rs.setPointerCapture(e.pointerId); el.classList.add('as-drag');
      const r = el.getBoundingClientRect(); const right = r.right, bottom = r.bottom;
      const mv = (ev) => { const w = right - ev.clientX, hh = bottom - ev.clientY; S().asRect = { x: right - w, y: bottom - hh, w, h: hh }; this.layout(); };
      const up = () => { el.classList.remove('as-drag'); rs.removeEventListener('pointermove', mv); rs.removeEventListener('pointerup', up); this.layout(); Store.save(); };
      rs.addEventListener('pointermove', mv); rs.addEventListener('pointerup', up);
    });
    addEventListener('resize', () => this.layout());
    new MutationObserver(() => this.layoutSoon()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const d = $('#drawer'); if (d) { new MutationObserver(() => this.layoutSoon()).observe(d, { attributes: true, attributeFilter: ['hidden', 'data-kind'] }); }
  },
  layoutSoon() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this.layout(); }); },
  rect() { const r = this.el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; },
  // the free canvas area (between dock, title bar and any open side panel); shrinks or stacks the side panel when there is no room
  area() {
    const W = innerWidth, H = innerHeight; const tb = $('#titlebar')?.getBoundingClientRect().bottom || 44; const dk = $('#dock')?.getBoundingClientRect();
    const a = { l: Math.max(8, (dk && dk.width && dk.left < 200 ? dk.right : 0) + 10), t: tb + 8, r: W - 12, b: H - 12 };
    const d = $('#drawer'); const open = d && !d.hidden && document.body.classList.contains('drawer-open');
    if (d) { if (d.style.width) d.style.width = ''; if (d.style.bottom) d.style.bottom = ''; if (d.classList.contains('as-stacked')) d.classList.remove('as-stacked'); }
    if (!open || this.el.hidden) return a;
    const MINA = 300; const dw = d.getBoundingClientRect().width || 420;
    if (a.r - dw - 12 - a.l >= MINA) { a.r = W - 12 - dw - 12; return a; }
    const ndw = Math.max(300, a.r - a.l - MINA - 12);
    if (a.r - a.l - ndw - 12 >= 260) { d.style.width = ndw + 'px'; a.r = W - 12 - ndw - 12; return a; }
    // very narrow window: the side panel takes the top half, the assistant the bottom half — still no overlap
    const mid = Math.round((a.t + a.b) / 2); d.style.bottom = (H - mid + 6) + 'px'; if (!d.classList.contains('as-stacked')) d.classList.add('as-stacked'); a.t = mid + 6; return a;
  },
  layout() {
    const el = this.el; if (!el || this._lay) return; this._lay = true;
    try {
      const a = this.area(); if (el.hidden) return;
      const R = Store.state.settings.asRect; const AW = a.r - a.l, AH = a.b - a.t;
      const w = Math.round(Math.min(AW, Math.max(Math.min(280, AW), R?.w || 440))), hh = Math.round(Math.min(AH, Math.max(Math.min(240, AH), R?.h || 640)));
      let x = R ? R.x : a.r - w, y = R ? R.y : a.b - hh;
      x = Math.round(Math.min(Math.max(x, a.l), a.r - w)); y = Math.round(Math.min(Math.max(y, a.t), a.b - hh));
      Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px', right: 'auto', bottom: 'auto' });
    } finally { this._lay = false; }
  },
  toggle() { this.el.hidden ? this.show() : this.hide(); },
  async show(voice) { this.el.hidden = false; this.layout(); requestAnimationFrame(() => this.el.classList.add('in')); $('#as-q').focus(); $('#btn-assistant')?.classList.add('on'); this.updModel(); if (voice === true) this.mic(); },
  hide() { this._hid = Date.now(); this.el.classList.remove('in'); $('#btn-assistant')?.classList.remove('on'); setTimeout(() => { if (!this.el.classList.contains('in')) { this.el.hidden = true; this.layout(); } }, 180); },
  toggleThink() { const A = Store.state.settings.ai.assistant; A.thinking = !A.thinking; Store.save(); this.syncThink(); },
  syncThink() {
    const b = $('#as-think'); if (!b) return; const A = Store.state.settings.ai.assistant; const on = !!A.thinking; b.classList.toggle('on', on); b.title = t('v265.think_tip'); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    // v2.6.9: the thinking cap is always visible next to the button and editable with one click
    const c = $('#as-think-cap'); if (!c) return; const cap = Math.max(0, Math.floor(+A.thinkingBudget || 0));
    c.textContent = cap ? t('v269.think_cap_chip', { v0: cap }) : t('v269.think_cap_none');
    c.classList.toggle('off', !on); c.setAttribute('data-cap', String(cap));
  },
  editThinkCap() {
    const A = Store.state.settings.ai.assistant;
    const inp = h('input', { class: 'inp', type: 'number', min: 0, step: 256, id: 'as-think-cap-inp', value: String(Math.max(0, Math.floor(+A.thinkingBudget || 0))) });
    Panels.modal(esc(t('v269.think_cap_title')), h('div', {}, inp, h('p', { class: 'muted small' }, t('v269.think_cap_help'))), {
      ok: () => { const v = Math.max(0, Math.floor(+inp.value || 0)); A.thinkingBudget = v; Store.save(); this.syncThink(); const hf = document.querySelector('#hub-think-budget'); if (hf) hf.value = v || ''; },
    });
    setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) {} }, 30);
  },
  showLimit(prep, timings) {
    const el = $('#as-limit'); if (!el) return;
    const tm = timings || (prep && prep.timings) || AI.lastTimings || null;
    if (!prep && !tm) { el.textContent = ''; return; }
    const parts = [];
    if (prep) {
      const cap = prep.max_tokens != null ? prep.max_tokens : '—';
      const ctx = prep.n_ctx != null ? prep.n_ctx : '—';
      parts.push(t('v265.limit_chip', { v0: cap, v1: ctx }));
    }
    if (tm && (tm.prompt_n != null || tm.prompt_ms != null)) {
      const pn = tm.prompt_n != null ? tm.prompt_n : (prep && prep.promptTokens != null ? prep.promptTokens : '—');
      const pms = tm.prompt_ms != null ? Math.round(tm.prompt_ms) : '—';
      const cache = tm.cache_n != null ? tm.cache_n : tm.cached_n;
      parts.push(t('v266.prompt_chip', { v0: pn, v1: pms, v2: cache != null ? cache : '—' }));
      if (tm.predicted_n != null || tm.predicted_ms != null) parts.push(t('v266.gen_chip', { v0: tm.predicted_n != null ? tm.predicted_n : '—', v1: tm.predicted_ms != null ? Math.round(tm.predicted_ms) : '—' }));
      const sp = NyxLimits.speedOf(tm); if (sp != null) parts.push(t('v269.speed_chip', { v0: Math.round(sp) }));
      const mt = NyxLimits.mtpOf(tm); if (mt.state === 'on') parts.push(t('v269.mtp_on')); else if (mt.state === 'off') parts.push(t('v269.mtp_off'));
    } else if (prep && prep.promptTokens != null) {
      parts.push(t('v266.prompt_est', { v0: prep.promptTokens, v1: prep.tokSrc || '' }));
    }
    el.textContent = parts.filter(Boolean).join(' · ');
    el.title = t('v266.limit_tip') + (prep && prep.reason ? ' · ' + prep.reason : '') + (prep && prep.clamped ? ' · ' + t('v265.clamped') : '');
  },
  async updModel() { try { const el = $('#as-model'); if (!el) return; const r = AI.task('commands'); const p = (AI.last.commands && AI.prov(AI.last.commands)?.enabled && r.auto ? AI.prov(AI.last.commands) : r.p);
    el.textContent = p ? p.name + (r.m && p === r.p ? ' · ' + r.m.split(/[\\/]/).pop().slice(0, 28) : t('assistant.073')) : '⚠️ ' + t('v23.offline_only'); el.classList.toggle('bad', !p); el.title = t('assistant.062'); el.onclick = () => Hub.open(); this.syncThink(); if (AI.lastPrep || AI.lastTimings) this.showLimit(AI.lastPrep, AI.lastTimings); } catch (e) {} },

  render() {
    const box = $('#as-msgs'); if (!box) return; box.innerHTML = '';
    const chat = Store.state.chat || [];
    if (!chat.length) box.append(h('div', { class: 'as-empty' }, h('div', { class: 'big', html: iconSvg('sparkles', 34) }), h('p', {}, t('assistant.074')), h('p', { class: 'muted small' }, t('assistant.075'))));
    for (const m of chat.slice(-60)) box.append(this.msgEl(m));
    box.scrollTop = 1e9;
  },
  msgEl(m) {
    const el = h('div', { class: 'as-msg r-' + m.role + (m.error ? ' err' : '') });
    if (m.role === 'user') el.append(h('div', { class: 'bubble' }, m.content), ...(m.voice ? [h('span', { class: 'vtag', html: iconSvg('mic', 12) })] : []));
    else {
      if (m.notices?.length) el.append(...m.notices.map(n => h('div', { class: 'as-notice ' + (n.kind || '') }, n.text)));
      if (m.reasoning && Store.state.settings.ai.assistant.thinking) el.append(h('details', { class: 'as-reason' }, h('summary', {}, t('v265.reason_sum')), h('div', { class: 'small muted' }, m.reasoning)));
      const emptied = !!(m.emptyAfterClean || (!String(m.content || '').trim() && m.rawContent));
      if (emptied) {
        if (!(m.notices || []).some(n => n.text === t('v265.empty_after_clean'))) el.append(h('div', { class: 'as-notice warn' }, t('v265.empty_after_clean')));
        el.append(h('details', { class: 'as-raw' }, h('summary', {}, t('v265.view_raw')), h('pre', { class: 'as-raw-body small' }, String(m.rawContent || ''))));
      } else {
        el.append(h('div', { class: 'bubble', html: md(m.content || (m.actions?.length ? '' : '…')) }));
      }
      if (m.truncated) el.append(h('div', { class: 'as-notice warn' }, t('v265.still_cut')));
      if (m.error) el.append(h('div', { class: 'as-fix' }, h('button', { class: 'btn sm primary', onclick: () => Hub.open() }, iconSvg('brain', 14), t('v23.open_ai'))));
      if (m.actions?.length) el.append(h('div', { class: 'as-acts' }, ...m.actions.map(a => h('span', { class: 'chip ' + (a.ok === false ? 'bad' : 'ok'), title: JSON.stringify(a.args || {}) }, (a.ok === false ? '✗ ' : '✓ ') + this.actLabel(a)))));
      if (m.content) el.append(h('div', { class: 'as-tools' }, h('button', { class: 'btn sm to-canvas', type: 'button', title: t('assistant.076'), onclick: () => Cmd.toCanvas(m, 'text') }, iconSvg('square-plus', 15), t('v2681.to_canvas')), h('button', { class: 'ib', title: t('assistant.077'), html: iconSvg('sticky-note', 15), onclick: () => Cmd.toCanvas(m, 'note') }), h('button', { class: 'ib', title: t('assistant.078'), html: iconSvg('volume-2', 15), onclick: () => Speech.speak(m.content) }), h('button', { class: 'ib', title: t('assistant.079'), html: iconSvg('copy', 15), onclick: () => { navigator.clipboard.writeText(m.content); toast('📋'); } }), m.model ? h('span', { class: 'muted small' }, m.model.split('/').pop()) : null));
    }
    return el;
  },
  actLabel(a) { const L = { create_card: t('assistant.080'), create_cards: t('assistant.081'), update_card: t('assistant.082'), delete_cards: t('assistant.083'), move_cards: t('assistant.084'), group_cards: t('assistant.085'), tidy_board: t('assistant.086'), search_cards: t('assistant.087'), read_cards: t('assistant.088'), show_card: t('assistant.089'), summarize: t('assistant.090'), create_board: t('assistant.091'), open_board: t('assistant.092'), add_subscription: t('assistant.093'), set_theme: t('assistant.094'), open_url: t('assistant.095'), web_search: 'web', open_panel: t('assistant.096'), run_plugin: 'plugin', date_calc: t('v269.act_date'), money_calc: t('v269.act_money') }; return (L[a.tool] || a.tool) + (a.cancelled ? t('assistant.097') : '') + (a.args?.text ? ': ' + String(a.args.text).slice(0, 30) : a.args?.query ? ': ' + a.args.query : a.args?.title ? ': ' + a.args.title : ''); },
  push(m) { (Store.state.chat ||= []).push({ at: Date.now(), ...m }); if (Store.state.chat.length > 300) Store.state.chat.splice(0, Store.state.chat.length - 300); Store.save(); this.render(); },
  async mic() {
    const b = $('#as-mic');
    if (Speech.active) { b.classList.remove('rec'); b.classList.add('busy'); try { const blob = await Speech.stop(); const r = await Speech.transcribeBlob(blob); b.classList.remove('busy'); const txt = (r.text || '').trim(); if (!txt) return toast(t('assistant.098')); if (Store.state.settings.ai.stt.autoSend) this.send(txt, true); else { $('#as-q').value = txt; $('#as-q').focus(); } } catch (e) { b.classList.remove('busy'); toast('⚠️ Whisper: ' + e.message + t('assistant.099'), { kind: 'err', ms: 7000 }); } return; }
    try { await Speech.start(); b.classList.add('rec'); toast(t('assistant.100'), { ms: 1800 }); } catch (e) { toast(t('assistant.101') + e.message, { kind: 'err' }); }
  },
  context() {
    // kept for compatibility; the 2.6.6 system prompt uses boardHeader/boardBody + a date suffix instead
    const now = NyxPrompt.formatNow(new Date(), NyxPrompt.TZ, LANG === 'en' ? 'en-GB' : 'el-GR');
    const b = Store.board(); const items = Cmd.items();
    return NyxPrompt.boardBody(b, items, Store.state.boards.filter(x => x.id !== b.id), this.boardLabels()) + '\n' + now.text;
  },
  boardLabels() {
    return { now: t('v266.now'), active: t('v266.active_board'), useTools: t('v266.use_tools'), count: t('v266.card_count'), others: t('v266.other_boards'), cards: t('v266.cards'), unnamed: '—', summaryHead: t('v266.summary_head'), assistant: t('v266.role_as'), user: t('v266.role_user') };
  },
  system(json, opts) {
    opts = opts || {};
    const A = Store.state.settings.ai.assistant;
    const instructions = t('v266.sys_instructions');
    const extra = A.extra || '';
    let toolsText = '';
    if (json) toolsText = t('assistant.105') + NyxPrompt.stableToolsText(Object.entries(Cmd.T).map(([n, x]) => ({ name: n, description: x.d, parameters: x.p })));
    const now = NyxPrompt.dateLine(opts.now || new Date(), NyxPrompt.TZ, LANG === 'en' ? 'en-GB' : 'el-GR', this.boardLabels());
    return NyxPrompt.buildSystem({ instructions, extra, toolsText, now, labels: this.boardLabels() });
  },
  turnMessages(text, opts) {
    opts = opts || {};
    const A = Store.state.settings.ai.assistant;
    const json = !!opts.json;
    const instructions = t('v266.sys_instructions');
    const extra = A.extra || '';
    const toolsText = json ? (t('assistant.105') + NyxPrompt.stableToolsText(Object.entries(Cmd.T).map(([n, x]) => ({ name: n, description: x.d, parameters: x.p })))) : '';
    const b = Store.board();
    const others = Store.state.boards.filter(x => x.id !== b.id);
    const labels = this.boardLabels();
    const header = NyxPrompt.boardHeader(b, labels);
    const body = opts.includeBoard ? NyxPrompt.boardBody(b, Cmd.items(), others, labels) : '';
    const now = NyxPrompt.dateLine(opts.now || new Date(), NyxPrompt.TZ, LANG === 'en' ? 'en-GB' : 'el-GR', labels);
    const prior = opts.prior || [];
    return NyxPrompt.wireMessages(NyxPrompt.assembleMessages({
      instructions, extra, toolsText, history: prior, user: text,
      boardHeader: header, boardBody: body, includeBoard: !!opts.includeBoard, now, labels,
    }));
  },
  // v2.6.9: true only when the «Chat» task has its own model (different from «Commands») and the message is plain talk:
  // no canvas command, no board question, no offline intent, no date/amount to compute (those need Nyx's tools).
  chatRoute(text) {
    const T = Store.state.settings.ai.tasks || {}; const c = T.chat || {}, k = T.commands || {};
    if (!c.m || (c.m === k.m && (c.p || '') === (k.p || ''))) return false;
    if (Cmd.wantsWrite(text) || NyxPrompt.needsBoard(text, { toolsCalled: [] })) return false;
    try { if (LocalIntent.parse(text)) return false; } catch (e) {}
    return !NyxCalc.needsCalc(text);
  },
  onSendClick() { if (this.busy) this.cancel(); else this.send(); },
  setSending(on) {
    const b = $('#as-send'); if (!b) return;
    b.classList.toggle('stop', !!on);
    b.title = on ? t('v268.stop') : t('assistant.072');
    b.innerHTML = iconSvg(on ? 'square' : 'send', 18);
  },
  cancel() {
    this._cancelled = true;
    try { AI.abort(); } catch (e) {}
  },
  paintLive(el, raw, reasoning) {
    if (!el) return;
    const lim = (typeof NyxLimits !== 'undefined') ? NyxLimits : { extractThink: (s, r) => ({ text: s, reasoning: r || '' }) };
    const ex = lim.extractThink(raw || '', reasoning || '');
    const think = ex.reasoning ? h('div', { class: 'as-think muted small' }, ex.reasoning) : null;
    const body = h('div', { class: 'md' }); body.innerHTML = md(ex.text || '…');
    el.innerHTML = '';
    el.append(h('div', { class: 'bubble live' }, think, body, h('span', { class: 'as-caret', 'aria-hidden': 'true' })));
  },
  history(opts) {
    opts = opts || {};
    const chat = (Store.state.chat || []).filter(m => m.content && m.role !== 'notice' && !m.error).map(m => ({ role: m.role, content: String(m.content) }));
    const A = Store.state.settings.ai.assistant || {};
    const pct = A.historyPct == null ? NyxPrompt.DEFAULT_HISTORY_PCT : +A.historyPct;
    const nCtx = +(opts.nCtx != null ? opts.nCtx : (AI.lastPrep && AI.lastPrep.n_ctx));
    const cache = Store.state.chatDigest || null;
    const tr = NyxPrompt.trimHistory(chat, {
      nCtx, percent: pct, cache, labels: this.boardLabels(),
      summarize: (dropped, prev) => {
        if (prev && prev.text && prev.key) return NyxPrompt.extractiveSummary(dropped, this.boardLabels());
        return NyxPrompt.extractiveSummary(dropped, this.boardLabels());
      },
    });
    this._histTrim = tr;
    if (tr.cacheKey && tr.summary) { Store.state.chatDigest = { key: tr.cacheKey, text: tr.summary }; }
    return tr.messages;
  },
  async send(text, voice) {
    const q = $('#as-q'); text = (text ?? q.value).trim(); if (!text || this.busy) return; q.value = ''; q.style.height = 'auto';
    if (this.el.hidden) this.show();
    Cmd._lastUser = text; this.push({ role: 'user', content: text, voice: !!voice }); this.busy = true; this._cancelled = false; this.el.classList.add('busy'); this.setSending(true);
    const live = h('div', { class: 'as-msg r-assistant thinking streaming', 'data-live': '1' }, h('div', { class: 'bubble' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')))); $('#as-msgs').append(live); $('#as-msgs').scrollTop = 1e9;
    const notices = [];
    const onNotice = (kind, msg) => {
      notices.push({ kind, text: msg });
      const exists = [...$('#as-msgs').querySelectorAll('.as-notice')].find((n) => n.textContent === msg);
      if (exists) return;
      const n = h('div', { class: 'as-notice ' + (kind || '') }, msg); live.before(n); $('#as-msgs').scrollTop = 1e9;
    };
    const onDelta = (ev) => {
      if (!ev) return;
      if (ev.type === 'delta') { this.paintLive(live, ev.raw || ev.text || '', ev.reasoning || ''); $('#as-msgs').scrollTop = 1e9; }
    };
    // v2.6.9: real VRAM measurement in parallel (never delays the send); one visible notice per new state
    API.inv('perf:snapshot').then((snap) => { const w = NyxLimits.vramWarn(snap); const txt = Hub.vramText ? Hub.vramText(w) : ''; const key = w.state + ':' + (w.gvs || []).map(x => x.pid).join(','); if (txt && key !== this._vramKey && document.contains(live)) { this._vramKey = key; onNotice('warn', '⚠️ ' + txt); } else if (!txt) this._vramKey = ''; }).catch(() => {});
    let res;
    try { res = await this.run(text, onNotice, onDelta); } catch (e) { res = { content: '⚠️ ' + cleanErr(e), error: true }; }
    if (this._cancelled && res && !res.error) { res = { ...res, cancelled: true, content: (res.content || '') }; }
    if (this._cancelled && res && res.error && /ακυρ|cancel|abort/i.test(String(res.content || ''))) res = { content: (live.querySelector('.md') && live.querySelector('.md').textContent) || t('v268.cancelled'), cancelled: true };
    live.remove(); this.busy = false; this.setSending(false); this.el.classList.remove('busy'); this.updModel();
    this.push({ role: 'assistant', ...res, notices: (res && res.notices) || notices }); Automations.fire('assistant', res);
    if (res.content && !res.error && !res.cancelled && Store.state.settings.ai.assistant && Store.state.settings.ai.tts.speak) Speech.speak(res.content);
    return res;
  },
  async run(text, onNotice, onDelta) {
    const A = Store.state.settings.ai.assistant; const actions = []; let model = '';
    const includeBoard = NyxPrompt.needsBoard(text, { toolsCalled: [] });
    const doActs = async (list) => { const out = []; for (const a of list) { const r = await Cmd.exec(a.tool, a.args); actions.push({ tool: a.tool, args: typeof a.args === 'string' ? JSON.parse(a.args || '{}') : a.args, ok: r?.ok !== false, cancelled: r?.cancelled }); out.push({ tool: a.tool, result: r }); } return out; };
    const offline = async (why) => { const acts = LocalIntent.parse(text); if (!acts) throw new Error(why + t('assistant.106')); await doActs(acts); return { content: t('assistant.107', { why }), actions, model: 'local' }; };
    let pm; try { pm = await AI.pickModel('commands'); model = pm.m; } catch (e) { if (e && e.code === 'NOMODEL') return { content: '⚠️ ' + cleanErr(e), error: true }; return offline(e.message); }
    let nCtx = AI.lastPrep && AI.lastPrep.n_ctx;
    try { const c = await API.inv('ai:context', pm.p, { model: pm.m, probe: true, timeout: 800 }); if (c && c.n_ctx) nCtx = c.n_ctx; } catch (e) {}
    const hist = this.history({ nCtx });
    if (this._histTrim && this._histTrim.trimmed && onNotice) onNotice('info', t('v266.hist_trimmed', { v0: A.historyPct ?? 25, v1: this._histTrim.dropped || 0 }));
    // if current message is already in hist as last, drop it; system+hist+user added below
    // v2.6.9.1: with an attachment `text` is «question + attachment context», so the stored question was sent twice (user, user)
    const prior = hist.filter((m, i) => !(i === hist.length - 1 && m.role === 'user' && (m.content === text || (m.content && String(text).startsWith(m.content)))));
    // v2.6.9: model per task — a plain conversation goes to the «Chat» model when the user picked a different one there
    if (A.mode !== 'json' && this.chatRoute(text)) {
      let cm = null; try { cm = await AI.pickModel('chat'); } catch (e) { cm = null; }
      if (cm) {
        if (onNotice) onNotice('info', t('v269.route_chat', { v0: String(cm.m).split(/[\\/]/).pop() }));
        const r = await AI.chatTurn(cm.p, { model: cm.m, messages: this.turnMessages(text, { json: false, includeBoard, prior }), temperature: A.temperature }, onNotice, onDelta);
        this.showLimit(r._prep, r._timings || r.timings);
        const m = r.message || {}; const content = stripThink(m.content || '', m.reasoning_content || r.reasoning);
        const emptied = !!(r.emptyAfterClean || (!String(content || '').trim() && r.rawContent));
        return { content, reasoning: r.reasoning || '', actions, model: r.model || cm.m, via: 'chat', task: 'chat', truncated: !!r.truncated, continued: r.continued || 0, emptyAfterClean: emptied, rawContent: emptied ? r.rawContent : undefined };
      }
    }
    const tryJson = async () => {
      const r = await AI.chat('commands', this.turnMessages(text, { json: true, includeBoard, prior }), { temperature: A.temperature, onNotice, onDelta });
      this.showLimit(r._prep || AI.lastPrep, r._timings || r.timings);
      const raw = stripThink(r.message.content || '', r.message?.reasoning_content || r.reasoning); const j = parseJsonLoose(raw);
      const emptied = !!(r.emptyAfterClean || (!String(raw || '').trim() && (r.rawContent || r.message.content)));
      if (!j) return { content: raw, actions, model: r.model, truncated: !!r.truncated, continued: r.continued || 0, reasoning: r.reasoning || '', emptyAfterClean: emptied, rawContent: emptied ? (r.rawContent || r.message.content || '') : undefined };
      const res = await doActs((j.actions || []).filter(a => a && a.tool));
      let say = j.say || '';
      const needs = res.filter(x => ['search_cards', 'read_cards', 'date_calc', 'money_calc'].includes(x.tool));
      if (needs.length) { const r2 = await AI.chat('commands', [{ role: 'system', content: this.system(true, { includeBoard: true }) }, { role: 'user', content: text }, { role: 'assistant', content: raw }, { role: 'user', content: t('assistant.108') + JSON.stringify(needs) + t('assistant.109') }], { temperature: A.temperature, onNotice }); const j2 = parseJsonLoose(stripThink(r2.message.content, r2.message?.reasoning_content || r2.reasoning)); if (j2) { await doActs((j2.actions || []).filter(a => a && a.tool)); say = j2.say || say; } }
      return { content: say, actions, model: r.model, via: 'json', truncated: !!r.truncated, continued: r.continued || 0, reasoning: r.reasoning || '' };
    };
    if (A.mode === 'json') { try { return await tryJson(); } catch (e) { if (netDown(e.message)) return offline(t('assistant.110')); throw e; } } // i18n-ignore
    const msgs = this.turnMessages(text, { json: false, includeBoard, prior });
    const tools = Cmd.tools();
    for (let round = 0; round < (A.maxRounds || 6); round++) {
      let r;
      try { r = await AI.chatTurn(pm.p, { model: pm.m, messages: msgs, tools, tool_choice: 'auto', temperature: A.temperature }, onNotice, onDelta); }
      catch (e) {
        const em = String(e.message || e); if (netDown(em)) return offline(t('assistant.110'));
        // v2.6.9: the model cannot do tool calls (router 500 «peg-native format») → remember it for the Hub warning, say so, use JSON
        if (NyxLimits.isToolFormatError(em)) { NyxLimits.noteTools(pm.m, false, em); if (onNotice) onNotice('warn', t('v269.tools_unsupported', { v0: String(pm.m).split(/[\\/]/).pop(), v1: em.slice(0, 160) })); try { Hub.refreshTasks?.(); } catch (x) {} return await tryJson(); }
        // v2.6.9.1: a template error (router 500 «Jinja Exception …») is not fixed by resending as JSON — stop and show it (red)
        if (/jinja|chat template|template (?:error|exception)|system message must be/i.test(em)) throw e; // i18n-ignore
        if (A.mode === 'auto' && round === 0) return await tryJson(); throw e;
      } // i18n-ignore
      model = r.model || model; const m = r.message || {};
      let calls = m.tool_calls || [];
      // Hermes/Qwen style <tool_call>{...}</tool_call> in content
      if (!calls.length && /<tool_call>/.test(m.content || '')) { calls = [...m.content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)].map((x, i) => { const j = parseJsonLoose(x[1]) || {}; return { id: 'tc' + round + i, type: 'function', function: { name: j.name, arguments: JSON.stringify(j.arguments || j.args || {}) } }; }).filter(c => c.function.name); m.content = m.content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim(); }
      // JSON actions in plain content (model ignored tools)
      if (!calls.length && round === 0 && A.mode === 'auto') { const j = parseJsonLoose(m.content || ''); if (j?.actions?.length) { await doActs(j.actions.filter(a => a.tool)); return { content: j.say || '', actions, model, via: 'json' }; } }
      if (!calls.length) {
        this.showLimit(r._prep, r._timings || r.timings);
        const content = stripThink(m.content || '', m.reasoning_content || r.reasoning);
        const emptied = !!(r.emptyAfterClean || (!String(content || '').trim() && r.rawContent));
        return { content, reasoning: r.reasoning || '', actions, model, via: round ? 'tools' : 'chat', truncated: !!r.truncated, continued: r.continued || 0, emptyAfterClean: emptied, rawContent: emptied ? r.rawContent : undefined };
      }
      msgs.push({ role: 'assistant', content: m.content || '', tool_calls: calls });
      for (const c of calls) { const args = c.function?.arguments; const r2 = await Cmd.exec(c.function.name, args); let pa = {}; try { pa = typeof args === 'string' ? JSON.parse(args || '{}') : args || {}; } catch (e) {} actions.push({ tool: c.function.name, args: pa, ok: r2?.ok !== false, cancelled: r2?.cancelled }); msgs.push({ role: 'tool', tool_call_id: c.id, name: c.function.name, content: JSON.stringify(r2).slice(0, 6000) }); }
    }
    return { content: '', actions, model, via: 'tools' };
  },
};
