'use strict';
// MCP board tools (Nyx 2.6.5.2). Used by the mcp-server plugin via PluginOps.
// Mutations go through Store.change(fn, 'MCP: <tool>') so Ctrl+Z works. No artificial caps.
(function (root) {
  const fill = (s, vars) => { if (vars) for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(b == null ? '' : String(b)); return s; };
  const tr = (k, fallback, vars) => {
    try { if (typeof t === 'function') { const s = t(k, vars); if (s && s !== k) return s; } } catch (e) {}
    return fill(fallback, vars);
  };
  const labelOf = (name) => 'MCP: ' + name;
  const idOf = (it) => it && it.id;
  const titleOf = (it) => {
    try { if (typeof Features !== 'undefined' && Features.itemTitle) return Features.itemTitle(it); } catch (e) {}
    return String(it.title || it.name || (typeof plainText === 'function' ? plainText(it.html || '') : String(it.html || '').replace(/<[^>]+>/g, ' ')) || it.type || '');
  };
  const textOf = (it) => {
    try { if (typeof Search !== 'undefined' && Search.text) return Search.text(it); } catch (e) {}
    return [it.html, it.title, it.name, it.caption, it.url, it.reminder && it.reminder.msg].filter(Boolean).join(' ');
  };
  const colorMap = { 'κιτρινο': '#ffe66d', 'πορτοκαλι': '#ffb86b', 'ροζ': '#ff8fab', 'μωβ': '#c3a6ff', 'μπλε': '#8fd3ff', 'γαλαζιο': '#8fd3ff', 'πρασινο': '#9ef0c4', 'ασπρο': '#f5f5f5', 'λευκο': '#f5f5f5', 'σκουρο': '#2b2f3a', 'μαυρο': '#2b2f3a', 'κοκκινο': '#ff4d6d', yellow: '#ffe66d', orange: '#ffb86b', pink: '#ff8fab', purple: '#c3a6ff', blue: '#8fd3ff', green: '#9ef0c4', white: '#f5f5f5', dark: '#2b2f3a', red: '#ff4d6d' };
  const colorOf = (c, def) => {
    if (!c) return def;
    if (/^#/.test(c)) return c;
    try { if (typeof norm === 'function') return colorMap[norm(c)] || def; } catch (e) {}
    return colorMap[String(c).toLowerCase()] || def;
  };
  const nrm = (s) => (typeof norm === 'function' ? norm(s) : String(s || '').toLowerCase());
  const newId = () => (typeof uid === 'function' ? uid() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const htmlOf = (text) => {
    text = String(text == null ? '' : text);
    try { if (typeof Cmd !== 'undefined' && Cmd.html) return Cmd.html(text); } catch (e) {}
    const e = (typeof esc === 'function') ? esc : (s) => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    return /<\w/.test(text) && typeof sanitize === 'function' ? sanitize(text) : e(text).replace(/\n/g, '<br>');
  };
  const palette = () => (typeof PALETTE !== 'undefined' ? PALETTE : ['#7c8cff', '#ffd23f', '#ff5d8f', '#9ef0c4', '#ffb86b', '#c3a6ff']);
  const sticky0 = () => (typeof STICKY !== 'undefined' ? STICKY[0] : '#ffe66d');

  function boards() { return Store.state.boards || []; }
  function allCards() {
    const out = [];
    for (const b of boards()) for (const i of b.items || []) out.push({ item: i, board: b });
    return out;
  }
  function boardOf(it) {
    for (const b of boards()) if ((b.items || []).includes(it) || (b.items || []).some(x => x.id === it.id)) return b;
    return null;
  }
  function findBoard(ref) {
    if (!ref) return null;
    const s = String(ref);
    return boards().find(b => b.id === s || b.id.startsWith(s) || nrm(b.name) === nrm(s) || nrm(b.name).includes(nrm(s))) || null;
  }
  function findItems(args) {
    const all = allCards().map(x => x.item);
    let out = [];
    const ids = [];
    if (Array.isArray(args.ids)) ids.push(...args.ids);
    if (args.id) ids.push(args.id);
    if (ids.length) out = all.filter(i => ids.some(id => i.id === String(id) || i.id.startsWith(String(id))));
    if (!out.length && args.query && typeof Search !== 'undefined' && Search.lexical) out = Search.lexical(args.query, all);
    else if (!out.length && args.query) {
      const q = nrm(args.query);
      out = all.filter(i => nrm(titleOf(i) + ' ' + textOf(i)).includes(q));
    }
    if (args.type) out = out.filter(i => i.type === args.type || (args.type === 'note' && ['sticky', 'text'].includes(i.type)));
    if (args.tag) out = out.filter(i => (i.tags || []).some(t => nrm(t) === nrm(args.tag)));
    return out;
  }
  function notFound() { return { ok: false, error: tr('mcp.not_found', 'No matching card was found.') }; }
  function remount(items) {
    if (typeof Items === 'undefined' || !Items.mount) return;
    for (const i of items) {
      try { if (Items.nodes && Items.nodes.has && !Items.nodes.has(i.id)) { /* may be on another board */ } Items.mount(i); } catch (e) {}
    }
    try { if (typeof Canvas !== 'undefined') { Canvas.drawSel?.(); Canvas.refresh?.(); } } catch (e) {}
    try { if (typeof Minimap !== 'undefined') Minimap.drawSoon?.(); } catch (e) {}
    try { if (typeof Panels !== 'undefined') { Panels.tabs?.(); Panels.stylebar?.(); Panels.refreshDrawer?.(); } } catch (e) {}
  }
  function unmount(ids) {
    if (typeof Items === 'undefined' || !Items.unmount) return;
    for (const id of ids) { try { Items.unmount(id); } catch (e) {} }
  }
  function refreshUi() {
    try { if (typeof Canvas !== 'undefined') { Canvas.sel?.clear?.(); Canvas.refresh?.(); } } catch (e) {}
    try { if (typeof Panels !== 'undefined') { Panels.tabs?.(); Panels.refreshDrawer?.(); } } catch (e) {}
    try { if (typeof App !== 'undefined') App.updateBadge?.(); } catch (e) {}
  }
  function applyColor(it, color) {
    const k = { sticky: 'paper', shape: 'stroke', frame: 'color', countdown: 'color', text: 'color', reminder: 'color' }[it.type];
    if (k) it[k] = colorOf(color, it[k]);
    else it.color = colorOf(color, it.color);
  }
  // v2.6.10 — card look for create_card / update_card: size, font, colours, shape and style. Every value is checked
  // against a range or an allow-list; a bad value is an error that names the allowed values (never silently changed).
  const STYLE_LIMITS = { w: [40, 3000], h: [30, 3000], font_size: [8, 160] };
  const FONT_LIST = () => (typeof FONTS !== 'undefined' ? FONTS.map(f => f[0]) : ['Inter', 'Playpen Sans', 'Mansalva', 'Mynerve', 'Comic Relief', 'Caveat', 'Permanent Marker', 'Comfortaa', 'Arima', 'Noto Serif', 'Roboto Slab', 'Ubuntu', 'JetBrains Mono', 'Tektur', 'Handjet', 'Press Start 2P', 'Dela Gothic One', 'Orbitron']);
  const SHAPE_LIST = ['rect', 'ellipse', 'diamond', 'triangle', 'star', 'heart'];
  const STYLE_LIST = ['classic', 'lined', 'grid', 'dotted', 'kraft', 'index', 'torn', 'polaroid', 'pin', 'glass'];
  const ALIGN_LIST = ['left', 'center', 'right'];
  const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const STYLE_KEYS = ['w', 'h', 'font', 'font_size', 'text_color', 'fill', 'shape', 'style', 'align'];
  function colorStrict(c, field) {
    const s = String(c).trim();
    if (HEX.test(s)) return s.toLowerCase();
    const k = nrm(s); if (colorMap[k]) return colorMap[k];
    throw new Error(tr('v2610.mcp_bad_color', '{f}: «{v}» is not a colour. Use #rgb / #rrggbb or one of: {list}.', { f: field, v: s, list: Object.keys(colorMap).join(', ') }));
  }
  function styleOf(a) {
    const out = {}; const errs = [];
    const num = (k) => { if (a[k] == null) return; const v = Number(a[k]); const [lo, hi] = STYLE_LIMITS[k]; if (!Number.isFinite(v) || v < lo || v > hi) errs.push(tr('v2610.mcp_range', '{f} must be a number from {lo} to {hi} (got {v}).', { f: k, lo, hi, v: a[k] })); else out[k] = Math.round(v); };
    num('w'); num('h'); num('font_size');
    const pick = (k, list, map) => { if (a[k] == null) return; const v = String(a[k]).trim(); const hit = list.find(x => x.toLowerCase() === v.toLowerCase()); if (!hit) errs.push(tr('v2610.mcp_enum', '{f} must be one of: {list} (got «{v}»).', { f: k, list: list.join(', '), v })); else out[k] = map ? map(hit) : hit; };
    pick('font', FONT_LIST()); pick('shape', SHAPE_LIST); pick('style', STYLE_LIST, (v) => (v === 'classic' ? '' : v)); pick('align', ALIGN_LIST);
    for (const k of ['color', 'text_color', 'fill']) { if (a[k] == null || a[k] === '') continue; if (k === 'fill' && /^(none|transparent)$/i.test(String(a[k]).trim())) { out.fill = 'transparent'; continue; } try { out[k] = colorStrict(a[k], k); } catch (e) { errs.push(e.message); } }
    if (errs.length) throw new Error(errs.join(' '));
    return out;
  }
  // which fields a card type can take (anything else is reported back as «ignored», never applied silently)
  function applyStyle(it, st) {
    const ignored = [];
    const textual = ['sticky', 'text', 'shape', 'reminder'].includes(it.type);
    const sized = !['arrow', 'line', 'ink'].includes(it.type);
    if (st.w != null) { if (sized) it.w = st.w; else ignored.push('w'); }
    if (st.h != null) { if (sized) it.h = st.h; else ignored.push('h'); }
    if (st.font != null) { if (textual) it.font = st.font; else ignored.push('font'); }
    if (st.font_size != null) { if (textual) it.size = st.font_size; else ignored.push('font_size'); }
    if (st.align != null) { if (textual) it.align = st.align; else ignored.push('align'); }
    if (st.color != null) applyColor(it, st.color);
    if (st.text_color != null) { if (textual) it.color = st.text_color; else ignored.push('text_color'); }
    if (st.fill != null) { if (it.type === 'shape') it.fill = st.fill; else if (it.type === 'text') it.bg = st.fill; else ignored.push('fill'); }
    if (st.shape != null) { if (it.type === 'shape') it.shape = st.shape; else ignored.push('shape'); }
    if (st.style != null) { if (it.type === 'sticky') it.paperKind = st.style; else ignored.push('style'); }
    return ignored;
  }
  function setTags(it, tags) {
    it.tags = [...new Set((tags || []).map(t => String(t).replace(/^#/, '')).filter(Boolean))];
  }
  function addTags(it, tags) {
    it.tags = [...new Set([...(it.tags || []), ...(tags || []).map(t => String(t).replace(/^#/, ''))])].filter(Boolean);
  }
  function freeSpot(w, hgt) {
    try { if (typeof Cmd !== 'undefined' && Cmd.freeSpot) return Cmd.freeSpot(w, hgt); } catch (e) {}
    try { if (typeof Canvas !== 'undefined' && Canvas.center) return Canvas.center(); } catch (e) {}
    const items = Store.items();
    return { x: 80 + (items.length % 6) * 280, y: 80 + Math.floor(items.length / 6) * 220 };
  }
  function layoutGrid(items, x0, y0, gap, cols) {
    cols = cols || Math.max(1, Math.ceil(Math.sqrt(items.length)));
    let x = x0, y = y0, rowH = 0, c = 0, maxX = x0;
    for (const i of items) {
      const ih = (typeof Canvas !== 'undefined' && i.type === 'text' && Canvas.itemH) ? Canvas.itemH(i) : (i.h || 120);
      i.x = x; i.y = y; x += (i.w || 200) + gap; rowH = Math.max(rowH, ih); maxX = Math.max(maxX, x);
      if (++c >= cols) { c = 0; x = x0; y += rowH + gap; rowH = 0; }
    }
    return { w: Math.max(0, maxX - x0 - gap), h: Math.max(0, (c ? y + rowH : y - gap) - y0) };
  }
  function cardCenter(it) { return { x: it.x + (it.w || 200) / 2, y: it.y + (it.h || 120) / 2 }; }

  // ISO date-time. If no zone is given, interpret as Europe/Athens (user's zone).
  function parseWhen(s, opt) {
    s = String(s || '').trim();
    if (!s) throw new Error(tr('mcp.bad_date', 'A date and time are required (ISO 8601, e.g. 2026-11-15T09:00:00 or 2026-11-15T09:00:00+02:00).'));
    if (/Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)) {
      const d = new Date(s);
      if (isNaN(+d)) throw new Error(tr('mcp.bad_date_val', 'Invalid ISO date: {v}', { v: s }).replace('{v}', s));
      return d.toISOString();
    }
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/);
    if (!m) throw new Error(tr('mcp.bad_date_val', 'Invalid ISO date: {v}', { v: s }).replace('{v}', s));
    const y = +m[1], mo = +m[2], d = +m[3], h = m[4] != null ? +m[4] : (opt && opt.defaultHour != null ? opt.defaultHour : 9), mi = m[5] != null ? +m[5] : 0, sec = m[6] != null ? +m[6] : 0;
    const naive = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    for (const off of ['+02:00', '+03:00']) {
      const dt = new Date(naive + off);
      if (isNaN(+dt)) continue;
      const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(dt).replace(' ', 'T');
      if (fmt === naive) return dt.toISOString();
    }
    const fallback = new Date(naive + '+02:00');
    if (isNaN(+fallback)) throw new Error(tr('mcp.bad_date_val', 'Invalid ISO date: {v}', { v: s }).replace('{v}', s));
    return fallback.toISOString();
  }
  function parseRange(a) {
    const from = a.from || a.start || a.after || null;
    const to = a.to || a.end || a.before || null;
    let t0 = from ? +new Date(parseWhen(from, { defaultHour: 0 })) : null;
    let t1 = to ? +new Date(parseWhen(to, { defaultHour: 23 })) : null;
    if (to && !/[T ]\d{2}:/.test(String(to))) t1 = +new Date(parseWhen(String(to).slice(0, 10) + 'T23:59:59', { defaultHour: 23 }));
    if (from && t0 != null && isNaN(t0)) throw new Error(tr('mcp.bad_date_val', 'Invalid ISO date: {v}', { v: from }).replace('{v}', from));
    if (to && t1 != null && isNaN(t1)) throw new Error(tr('mcp.bad_date_val', 'Invalid ISO date: {v}', { v: to }).replace('{v}', to));
    return { from: t0, to: t1 };
  }
  function inRange(ms, r) {
    if (isNaN(ms)) return false;
    if (r.from != null && ms < r.from) return false;
    if (r.to != null && ms > r.to) return false;
    return true;
  }
  function dmy(iso) {
    const d = new Date(iso);
    if (isNaN(+d)) return '';
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const g = (t) => (parts.find(p => p.type === t) || {}).value;
    return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')} (Europe/Athens)`;
  }
  function ymdAthens(ms) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
    const g = (t) => (parts.find(p => p.type === t) || {}).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  }

  const DELETE_TIMEOUT_MS = 5 * 60 * 1000;
  function limitsOf(opts) {
    const L = (opts && opts.limits) || {};
    const mb = L.maxImageMb != null ? +L.maxImageMb : 30;
    const min = L.deleteConfirmMin != null ? +L.deleteConfirmMin : 5;
    const bytes = L.maxImageBytes != null ? +L.maxImageBytes : Math.round((Number.isFinite(mb) && mb > 0 ? mb : 30) * 1048576);
    const ms = L.deleteConfirmMs != null ? +L.deleteConfirmMs : Math.round((Number.isFinite(min) && min > 0 ? min : 5) * 60 * 1000);
    return { maxImageMb: Number.isFinite(mb) && mb > 0 ? mb : 30, maxImageBytes: bytes, deleteConfirmMin: Number.isFinite(min) && min > 0 ? min : 5, deleteConfirmMs: ms };
  }
  function fmtMb(mb) { return Number.isInteger(mb) ? String(mb) : String(Math.round(mb * 10) / 10); }

  const McpBoard = {
    DELETE_TIMEOUT_MS,
    limitsOf,
    parseWhen,
    styleOf, STYLE_LIMITS, SHAPE_LIST, STYLE_LIST, ALIGN_LIST, FONT_LIST,
    // Optional test hook: async (items) => 'ok'|'declined'|'timeout'
    _confirm: null,
    _importLocal: null,
    _importUrl: null,

    handles(name) { return !!this.T[name]; },

    async run(name, args, opts) {
      const T = this.T[name]; if (!T) throw new Error(tr('mcp.unknown', 'Unknown tool {v}').replace('{v}', name));
      return await T.call(this, args || {}, opts || {});
    },

    async confirmDelete(items, timeoutMs) {
      if (typeof this._confirm === 'function') return await this._confirm(items);
      timeoutMs = timeoutMs == null ? DELETE_TIMEOUT_MS : timeoutMs;
      if (typeof Panels === 'undefined' || !Panels.modal) return 'declined';
      const minutes = Math.round(timeoutMs / 60000);
      return new Promise((res) => {
        let done = false;
        const finish = (v) => { if (done) return; done = true; clearTimeout(tm); res(v); };
        const tm = setTimeout(() => { try { const c = typeof $ === 'function' ? $('#modal-close') : document.getElementById('modal-close'); c && c.click(); } catch (e) {} finish('timeout'); }, timeoutMs);
        const list = items.map(i => titleOf(i) || i.id);
        const note = tr('mcp.del_note', 'This will delete {n} card(s). The action can be undone with Ctrl+Z. If you do not answer within {m} minutes, the request is cancelled.', { n: items.length, m: minutes })
          .replace('{n}', items.length).replace('{m}', minutes);
        Panels.modal('⚠️ ' + tr('mcp.del_title', 'Delete cards via MCP'), (typeof h === 'function'
          ? h('div', {}, h('p', {}, note), h('ul', { class: 'confirm-list' }, ...list.slice(0, 40).map(x => h('li', {}, x)), list.length > 40 ? h('li', {}, '… +' + (list.length - 40)) : null))
          : note), {
          okLabel: (typeof t === 'function' ? t('panels.054') : 'Delete'),
          ok: () => finish('ok'),
          onClose: () => { if (!done) finish('declined'); },
        });
      });
    },

    mutate(name, fn, opts) {
      if (opts && opts.batch) return fn();
      return Store.change(fn, labelOf(name));
    },

    T: {
      async search_cards(a) {
        if (!a.query) throw new Error(tr('mcp.need_query', 'query is required.'));
        const pool = a.all_boards === false ? Store.items() : allCards().map(x => x.item);
        let r;
        if (typeof Search !== 'undefined' && Search.lexical) r = Search.lexical(a.query, pool);
        else { const q = nrm(a.query); r = pool.filter(i => nrm(titleOf(i) + ' ' + textOf(i)).includes(q)); }
        return { count: r.length, cards: r.map(i => brief(i)) };
      },
      async read_cards(a) {
        const its = findItems(a);
        return { cards: its.map(i => ({ ...brief(i), text: textOf(i) })) };
      },
      async board_snapshot() {
        const b = Store.board();
        return {
          board: b.name, id: b.id,
          items: (b.items || []).filter(i => i.type !== 'ink').map(i => ({
            id: i.id, type: i.type, x: Math.round(i.x || 0), y: Math.round(i.y || 0),
            w: Math.round(i.w || 200), h: Math.round(i.h || 120),
            title: titleOf(i), text: textOf(i), url: i.url || '', color: i.paper || i.color || '',
            tags: i.tags || [], src: i.file || i.src || '',
            ...(i.type === 'arrow' ? { x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2, from: i.from || '', to: i.to || '' } : {}),
          })),
        };
      },
      async list_boards() {
        return {
          active: Store.state.active,
          boards: boards().map(b => ({
            id: b.id, name: b.name, emoji: b.emoji || '', color: b.color || '',
            items: (b.items || []).length,
            reminders: (b.items || []).filter(i => i.reminder && i.reminder.on).length,
          })),
        };
      },
      async list_reminders(a) {
        const r = (a.from || a.to) ? parseRange(a) : { from: null, to: null };
        const out = [];
        for (const { item: i, board: b } of allCards()) {
          const rem = i.reminder; if (!rem || !rem.at) continue;
          const ms = +new Date(rem.at); if (!inRange(ms, r)) continue;
          out.push({
            id: i.id, board: b.name, board_id: b.id, on: !!rem.on, done: !!rem.done,
            at: rem.at, at_local: dmy(rem.at), repeat: rem.repeat || 'none',
            text: rem.msg || titleOf(i), type: i.type,
          });
        }
        out.sort((p, q) => +new Date(p.at) - +new Date(q.at));
        return { count: out.length, reminders: out };
      },
      async get_agenda(a) {
        const r = (a.from || a.to) ? parseRange(a) : { from: null, to: null };
        const notes = [];
        for (const x of (Store.state.agenda || [])) {
          const ms = +new Date((x.day || '') + 'T12:00:00+02:00');
          if (r.from != null || r.to != null) {
            const dayStart = +new Date(parseWhen((x.day || '') + 'T00:00:00', { defaultHour: 0 }));
            const dayEnd = +new Date(parseWhen((x.day || '') + 'T23:59:59', { defaultHour: 23 }));
            if (r.to != null && dayStart > r.to) continue;
            if (r.from != null && dayEnd < r.from) continue;
          }
          notes.push({ id: x.id, day: x.day, day_local: x.day ? `${String(x.day).slice(8, 10)}/${String(x.day).slice(5, 7)}/${String(x.day).slice(0, 4)}` : '', text: x.text || '', done: !!x.done, voice: !!x.file, at: x.at });
        }
        const rem = (await this.T.list_reminders.call(this, a)).reminders;
        notes.sort((p, q) => String(p.day).localeCompare(q.day) || (p.at || 0) - (q.at || 0));
        return { count: notes.length, agenda: notes, reminders: rem, zone: 'Europe/Athens' };
      },
      async summarize_board(a) {
        const b = a.board ? findBoard(a.board) : Store.board();
        if (!b) throw new Error(tr('mcp.no_board', 'Board not found: {v}').replace('{v}', a.board || ''));
        const items = (b.items || []).filter(i => !['ink'].includes(i.type));
        const lines = [`# ${b.emoji || ''} ${b.name}`.trim(), '', tr('mcp.sum_count', '{n} items').replace('{n}', items.length), ''];
        const byType = {};
        for (const i of items) (byType[i.type] ||= 0), byType[i.type]++;
        lines.push(Object.entries(byType).map(([k, n]) => `${k}: ${n}`).join(', '), '');
        const sorted = items.filter(i => i.type !== 'arrow' && i.type !== 'line').sort((p, q) => (p.y - q.y) || (p.x - q.x));
        for (const i of sorted) {
          const tags = (i.tags || []).length ? ' #' + i.tags.join(' #') : '';
          const body = textOf(i).replace(/\s+/g, ' ').trim();
          lines.push(`- [${i.type}] ${titleOf(i) || i.id}${tags}${body && body !== titleOf(i) ? ' — ' + body : ''}`);
        }
        const arrows = items.filter(i => i.type === 'arrow' && (i.from || i.to));
        if (arrows.length) {
          lines.push('', tr('mcp.sum_links', 'Links:'));
          for (const ar of arrows) lines.push(`- ${ar.from || '?'} → ${ar.to || '?'}`);
        }
        return { ok: true, board: b.name, id: b.id, text: lines.join('\n'), items: items.length };
      },

      async update_card(a, opts) {
        const its = findItems(a);
        if (!its.length) return notFound();
        if (a.text == null && a.append == null && a.title == null && a.color == null && !a.tags && !a.add_tags && !a.remove_tags && !STYLE_KEYS.some(k => a[k] != null)) {
          throw new Error(tr('v2610.mcp_nothing_to_update', 'Provide at least one of: text, color, tags, title, append, add_tags, remove_tags, w, h, font, font_size, text_color, fill, shape, style, align.'));
        }
        const st = styleOf(a); const ignored = {};
        this.mutate('update_card', () => {
          for (const it of its) {
            if (a.text != null) it.html = htmlOf(a.text);
            if (a.append) it.html = (it.html || '') + '<br>' + htmlOf(a.append);
            if (a.title != null) it.title = a.title;
            const ig = applyStyle(it, st); if (ig.length) ignored[it.id] = ig;
            if (a.tags) setTags(it, a.tags);
            if (a.add_tags) addTags(it, a.add_tags);
            if (a.remove_tags) it.tags = (it.tags || []).filter(t => !a.remove_tags.some(r => nrm(r) === nrm(t)));
          }
        }, opts);
        remount(its);
        return { ok: true, updated: its.length, ids: its.map(idOf), ...(Object.keys(st).length ? { style: st } : {}), ...(Object.keys(ignored).length ? { ignored, note: tr('v2610.mcp_ignored', 'Some fields do not apply to that card type and were not used.') } : {}) };
      },
      async add_tags(a, opts) {
        const tags = a.tags || a.add_tags || [];
        if (!tags.length) throw new Error(tr('mcp.need_tags', 'tags is required.'));
        const its = findItems(a);
        if (!its.length) return notFound();
        this.mutate('add_tags', () => { for (const it of its) addTags(it, tags); }, opts);
        remount(its);
        return { ok: true, updated: its.length, ids: its.map(idOf), tags: tags.map(t => String(t).replace(/^#/, '')) };
      },
      async move_card(a, opts) {
        const its = findItems(a);
        if (!its.length) return notFound();
        if (a.board == null && a.to_board == null && a.x == null && a.y == null && a.dx == null && a.dy == null) {
          throw new Error(tr('mcp.need_move', 'Provide a target board and/or position (x, y).'));
        }
        const destName = a.board || a.to_board;
        let dest = destName ? findBoard(destName) : null;
        if (destName && !dest) throw new Error(tr('mcp.no_board', 'Board not found: {v}').replace('{v}', destName));
        this.mutate('move_card', () => {
          for (const it of its) {
            if (dest) {
              const src = boardOf(it);
              if (src && src !== dest) {
                src.items = src.items.filter(i => i.id !== it.id);
                it.z = undefined;
                Store.addItem(it, dest);
              }
            }
            if (a.x != null) it.x = +a.x;
            if (a.y != null) it.y = +a.y;
            if (a.dx) it.x = (it.x || 0) + +a.dx;
            if (a.dy) it.y = (it.y || 0) + +a.dy;
          }
        }, opts);
        const stillHere = its.filter(i => boardOf(i) && boardOf(i).id === Store.state.active);
        const left = its.filter(i => !stillHere.includes(i));
        unmount(left.map(i => i.id));
        remount(stillHere);
        refreshUi();
        return { ok: true, moved: its.length, ids: its.map(idOf), ...(dest ? { board: dest.name, board_id: dest.id } : {}) };
      },
      async create_reminder(a, opts) {
        if (!a.at && !a.date) throw new Error(tr('mcp.need_at', 'at (ISO date and time) is required.'));
        const at = parseWhen(a.at || a.date);
        const text = a.text || a.title || a.msg || tr('mcp.reminder', 'Reminder');
        const dest = a.board ? findBoard(a.board) : Store.board();
        if (!dest) throw new Error(tr('mcp.no_board', 'Board not found: {v}').replace('{v}', a.board || ''));
        const p = freeSpot(320, 120);
        let it;
        const payload = {
          type: 'reminder', w: 320, h: 120, html: (typeof esc === 'function' ? esc(text) : String(text)), size: 18,
          reminder: { on: true, at, repeat: a.repeat || 'none', msg: text, sound: a.sound || 'chime' },
          tags: Array.isArray(a.tags) ? a.tags.map(t => String(t).replace(/^#/, '')) : [],
        };
        this.mutate('create_reminder', () => {
          const x = a.x != null ? +a.x : p.x - 160, y = a.y != null ? +a.y : p.y - 60;
          it = Store.addItem({ ...payload, x, y }, dest);
        }, opts);
        if (dest.id === Store.state.active) remount([it]);
        try { if (typeof App !== 'undefined') App.updateBadge?.(); } catch (e) {}
        try { if (typeof Panels !== 'undefined') Panels.refreshDrawer?.(); } catch (e) {}
        return { ok: true, id: it.id, at, at_local: dmy(at), board: dest.name, board_id: dest.id };
      },
      async create_board(a, opts) {
        if (!a.name || !String(a.name).trim()) throw new Error(tr('mcp.need_name', 'name is required.'));
        const pal = palette();
        let b;
        this.mutate('create_board', () => {
          b = { id: newId(), name: String(a.name).trim(), emoji: a.emoji || '✨', color: a.color || pal[(boards().length) % pal.length], view: { x: 0, y: 0, z: 1 }, items: [] };
          Store.state.boards.push(b);
        }, opts);
        try { if (typeof Panels !== 'undefined') Panels.tabs?.(); } catch (e) {}
        if (a.switch === true && typeof App !== 'undefined' && App.switchBoard) App.switchBoard(b.id);
        return { ok: true, id: b.id, name: b.name, switched: a.switch === true };
      },
      async create_card(a, opts) {
        const kind = a.kind || 'note';
        const text = a.text || a.title || '';
        const st = styleOf(a); let ignored = [];
        const p = freeSpot(st.w || 230, st.h || 200);
        let it;
        this.mutate('create_card', () => {
          const base = { x: (a.x != null ? +a.x : p.x - 115), y: (a.y != null ? +a.y : p.y - 100), tags: Array.isArray(a.tags) ? a.tags.map(t => String(t).replace(/^#/, '')) : [] };
          if (kind === 'reminder') {
            const at = parseWhen(a.date || a.at || new Date(Date.now() + 3600e3).toISOString());
            it = Store.addItem({ ...base, type: 'reminder', w: 320, h: 120, html: htmlOf(text), size: 18, reminder: { on: true, at, repeat: a.repeat || 'none', msg: text } });
          } else if (kind === 'frame') {
            it = Store.addItem({ ...base, type: 'frame', w: 640, h: 420, title: a.title || text || 'Frame', color: colorOf(a.color, '#7c8cff'), z: 0 });
          } else if (kind === 'text' || kind === 'code' || kind === 'heading') {
            it = Store.addItem({ ...base, type: 'text', w: kind === 'heading' ? 520 : 360, h: kind === 'heading' ? 60 : 80, html: kind === 'code' ? `<pre><code>${(typeof esc === 'function' ? esc(text) : text)}</code></pre>` : htmlOf(text), size: kind === 'heading' ? 34 : 16 });
          } else if (kind === 'link') {
            it = Store.addItem({ ...base, type: 'link', w: 340, h: 280, url: a.url || text, title: a.title || a.url || text });
          } else if (kind === 'shape') {
            it = Store.addItem({ ...base, type: 'shape', w: 220, h: 160, shape: 'rect', html: htmlOf(text), stroke: '#7c8cff', fill: 'transparent', sw: 2.5, font: 'Inter', size: 18 });
          } else {
            it = Store.addItem({ ...base, type: 'sticky', w: 230, h: 200, html: htmlOf(text), paper: colorOf(a.color, sticky0()), font: 'Playpen Sans', size: 20 });
          }
          ignored = applyStyle(it, st);
          if (a.x == null && (st.w || st.h)) { it.x = p.x - (it.w || 230) / 2; it.y = (a.y != null ? +a.y : p.y - (it.h || 200) / 2); }
        }, opts);
        remount([it]);
        return { ok: true, id: it.id, kind, w: it.w, h: it.h, ...(Object.keys(st).length ? { style: st } : {}), ...(ignored.length ? { ignored, note: tr('v2610.mcp_ignored', 'Some fields do not apply to that card type and were not used.') } : {}) };
      },
      async link_cards(a, opts) {
        const from = findItems({ id: a.from || a.from_id, ids: a.from ? [a.from] : undefined })[0];
        const to = findItems({ id: a.to || a.to_id, ids: a.to ? [a.to] : undefined })[0];
        if (!from || !to) return notFound();
        if (from.id === to.id) throw new Error(tr('mcp.link_self', 'Cannot link a card to itself.'));
        const bf = boardOf(from), bt = boardOf(to);
        if (!bf || !bt) return notFound();
        if (bf.id !== bt.id) throw new Error(tr('mcp.link_boards', 'Both cards must be on the same board to be linked.'));
        const c1 = cardCenter(from), c2 = cardCenter(to);
        let ar;
        this.mutate('link_cards', () => {
          ar = Store.addItem({
            type: 'arrow', x: 0, y: 0, w: 0, h: 0,
            x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y,
            from: from.id, to: to.id,
            stroke: colorOf(a.color, '#7c8cff'), sw: 3, curve: 0.15,
            title: a.title || a.label || '',
          }, bf);
        }, opts);
        if (bf.id === Store.state.active) remount([ar]);
        return { ok: true, id: ar.id, from: from.id, to: to.id };
      },
      async group_cards(a, opts) {
        const its = findItems(a).filter(i => i.type !== 'frame' && i.type !== 'arrow' && i.type !== 'line' && i.type !== 'ink');
        if (!its.length) return notFound();
        const b0 = boardOf(its[0]);
        if (its.some(i => boardOf(i) !== b0)) throw new Error(tr('mcp.group_boards', 'All cards must be on the same board to be grouped.'));
        const g = newId(); const pad = 36;
        const p = freeSpot(800, 500);
        let fr;
        this.mutate('group_cards', () => {
          const sz = layoutGrid(its, p.x - 360, p.y - 200, 28);
          its.forEach(i => { i.group = g; });
          fr = Store.addItem({
            type: 'frame', x: p.x - 360 - pad, y: p.y - 200 - pad - 30,
            w: sz.w + pad * 2, h: sz.h + pad * 2 + 30,
            title: a.title || a.query || tr('mcp.group', 'Group'),
            color: colorOf(a.color, '#7c8cff'), z: 0,
          }, b0);
        }, opts);
        if (b0.id === Store.state.active) { remount([fr, ...its]); try { if (typeof Canvas !== 'undefined') Canvas.select?.(its.map(i => i.id)); } catch (e) {} }
        return { ok: true, grouped: its.length, ids: its.map(idOf), frame: fr.id, title: fr.title };
      },
      async organize_board(a, opts) {
        const by = a.by || 'type';
        if (!['type', 'tag', 'date'].includes(by)) throw new Error(tr('mcp.bad_by', 'by must be type, tag, or date.'));
        const b = a.board ? findBoard(a.board) : Store.board();
        if (!b) throw new Error(tr('mcp.no_board', 'Board not found: {v}').replace('{v}', a.board || ''));
        const its = (b.items || []).filter(i => !['frame', 'arrow', 'line', 'ink'].includes(i.type) && !i.locked);
        if (!its.length) return { ok: false, error: tr('mcp.empty_board', 'Nothing to organize on this board.') };
        const key = (i) => {
          if (by === 'tag') return (i.tags && i.tags[0]) || '—';
          if (by === 'date') {
            const src = (i.reminder && i.reminder.at) || i.target || i.created;
            return src ? ymdAthens(+new Date(src)) : '—';
          }
          return i.type || 'other';
        };
        const groups = {};
        for (const i of its) (groups[key(i)] ||= []).push(i);
        let origin;
        try { origin = (typeof Canvas !== 'undefined' && Canvas.center) ? Canvas.center() : { x: 0, y: 0 }; } catch (e) { origin = { x: 0, y: 0 }; }
        let x = 0;
        this.mutate('organize_board', () => {
          for (const list of Object.values(groups)) {
            list.sort((p, q) => (p.y - q.y) || (p.x - q.x));
            const cols = Math.min(2, list.length);
            const sz = layoutGrid(list, origin.x - 600 + x, origin.y - 300, 24, cols);
            x += sz.w + 90;
          }
        }, opts);
        if (b.id === Store.state.active) remount(its);
        return { ok: true, by, groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), ids: its.map(idOf) };
      },
      async add_image(a, opts) {
        const src = a.path || a.file || a.url || a.src;
        if (!src) throw new Error(tr('mcp.need_image', 'Provide a local path or an http(s) URL.'));
        const isUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(String(src));
        if (isUrl) {
          let u;
          try { u = new URL(String(src)); } catch (e) { throw new Error(tr('mcp.bad_url', 'Invalid URL.')); }
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(tr('mcp.url_scheme', 'Only http(s) URLs are allowed (no file://). The limit is {mb} MB, images only, public addresses.').replace('{mb}', fmtMb(limitsOf(opts).maxImageMb)));
        } else {
          const p = String(src);
          if (/^file:/i.test(p) || p.includes('\0') || /^[\\/]{2}/.test(p)) throw new Error(tr('mcp.bad_path', 'Invalid local path. file:// and network paths are not allowed.'));
        }
        const dest = a.board ? findBoard(a.board) : Store.board();
        if (!dest) throw new Error(tr('mcp.no_board', 'Board not found: {v}').replace('{v}', a.board || ''));
        const spot = freeSpot(480, 360);
        const at = { x: a.x != null ? +a.x : spot.x, y: a.y != null ? +a.y : spot.y };
        let media;
        const lim = limitsOf(opts);
        const io = { maxBytes: lim.maxImageBytes, hint: 'mcp' };
        if (isUrl) {
          if (typeof this._importUrl === 'function') media = await this._importUrl(String(src), io);
          else if (typeof API !== 'undefined' && API.download) media = await API.download(String(src), 'mcp', io);
          else if (typeof API !== 'undefined' && API.inv) media = await API.inv('web:dropImage', String(src), io);
          else throw new Error(tr('mcp.no_download', 'URL download is not available here.'));
        } else {
          if (typeof this._importLocal === 'function') media = await this._importLocal(String(src), io);
          else if (typeof API !== 'undefined' && API.importUserImage) media = await API.importUserImage(String(src), io);
          else if (typeof API !== 'undefined' && API.inv) media = await API.inv('media:importUserImage', String(src), io);
          else throw new Error(tr('mcp.no_import', 'Local image import is not available here.'));
        }
        if (!media || !media.file) throw new Error(tr('mcp.import_failed', 'The image could not be imported.'));
        let it;
        const w = a.w || 480, h = a.h || 360;
        this.mutate('add_image', () => {
          it = Store.addItem({
            type: 'image', file: media.file, name: a.title || media.name || 'image',
            w, h, x: at.x - w / 2, y: at.y - h / 2,
            caption: a.caption || '', tags: Array.isArray(a.tags) ? a.tags.map(t => String(t).replace(/^#/, '')) : [],
            source: isUrl ? String(src) : '',
          }, dest);
        }, opts);
        if (dest.id === Store.state.active) remount([it]);
        return { ok: true, id: it.id, file: media.file, board: dest.name };
      },
      async delete_cards(a, opts) {
        const its = findItems(a);
        if (!its.length) return notFound();
        const lim = limitsOf(opts);
        const ans = await this.confirmDelete(its, a.timeout_ms != null ? a.timeout_ms : lim.deleteConfirmMs);
        if (ans === 'declined') return { ok: false, declined: true, error: tr('mcp.del_declined', 'Deletion was declined in Nyx.') };
        if (ans === 'timeout') return { ok: false, timeout: true, error: tr('mcp.del_timeout', 'Deletion timed out waiting for confirmation in Nyx ({m} minutes).').replace('{m}', fmtMb(lim.deleteConfirmMin)) };
        if (ans !== 'ok') return { ok: false, error: tr('mcp.del_declined', 'Deletion was declined in Nyx.') };
        const ids = its.map(i => i.id);
        const byBoard = new Map();
        this.mutate('delete_cards', () => {
          for (const it of its) {
            const b = boardOf(it); if (!b) continue;
            b.items = b.items.filter(i => i.id !== it.id);
            byBoard.set(b.id, b);
          }
        }, opts);
        unmount(ids);
        refreshUi();
        return { ok: true, deleted: ids.length, ids };
      },
      async batch(a, opts) {
        const actions = a.actions || a.calls || [];
        if (!Array.isArray(actions) || !actions.length) throw new Error(tr('mcp.need_actions', 'actions must be a non-empty array of { tool, arguments }.'));
        // validate all first (schema is enforced by the plugin; here we check tools exist and preconditions)
        const prepared = [];
        for (let i = 0; i < actions.length; i++) {
          const step = actions[i] || {};
          const name = step.tool || step.name;
          const args = step.arguments || step.args || {};
          if (!name) throw new Error(tr('mcp.batch_no_tool', 'Action {i} is missing a tool name.').replace('{i}', i));
          if (name === 'batch') throw new Error(tr('mcp.batch_nested', 'Nested batch is not allowed.'));
          if (!this.T[name]) throw new Error(tr('mcp.unknown', 'Unknown tool {v}').replace('{v}', name));
          prepared.push({ name, args, i });
        }
        // Pre-check deletes: one confirmation for every delete in the batch.
        const delSteps = prepared.filter(s => s.name === 'delete_cards');
        if (delSteps.length) {
          const victims = [];
          for (const s of delSteps) {
            const its = findItems(s.args);
            if (!its.length) throw new Error(tr('mcp.batch_del_missing', 'delete_cards in the batch did not match any card (action {i}).').replace('{i}', s.i));
            victims.push(...its);
          }
          const lim = limitsOf(opts);
          const ans = await this.confirmDelete(victims, a.timeout_ms != null ? a.timeout_ms : lim.deleteConfirmMs);
          if (ans === 'declined') return { ok: false, declined: true, error: tr('mcp.del_declined', 'Deletion was declined in Nyx.') };
          if (ans === 'timeout') return { ok: false, timeout: true, error: tr('mcp.del_timeout', 'Deletion timed out waiting for confirmation in Nyx ({m} minutes).').replace('{m}', fmtMb(lim.deleteConfirmMin)) };
          for (const s of delSteps) s.args = { ...s.args, _confirmed: true };
        }
        const snap = Store.snap();
        Store.begin();
        const results = [];
        try {
          for (const s of prepared) {
            const callArgs = s.name === 'delete_cards' && s.args._confirmed
              ? { ...s.args, timeout_ms: undefined }
              : s.args;
            // skip confirm inside delete when already confirmed
            const prev = this._confirm;
            if (s.name === 'delete_cards' && s.args._confirmed) this._confirm = async () => 'ok';
            try { results.push({ tool: s.name, result: await this.T[s.name].call(this, callArgs, { batch: true, limits: limitsOf(opts) }) }); }
            finally { this._confirm = prev; }
            const last = results[results.length - 1].result;
            if (last && last.ok === false) throw new Error(last.error || last.declined || last.timeout || ('action failed: ' + s.name));
          }
          Store.commit(labelOf('batch'));
        } catch (e) {
          Store.pending = null;
          // v2.6.9.3: the rollback undoes only what this batch changed (by id), after a visible confirmation that says
          // how many subscriptions and cards change. Declined → the partial changes stay (one undo entry).
          // v2.6.10: no answer in the confirmation time → NOTHING happens (kept_timeout): the partial changes stay as they
          // are, as one undo entry, and the result says so. Cards are never removed without an explicit OK.
          const plan = Store.restorePlan(snap, { subs: false }); // MCP has no subscription tools: subscriptions are never rolled back
          const sum = plan.sum; const n = sum.cards.add + sum.cards.remove + sum.cards.change + sum.subs.add + sum.subs.remove + sum.subs.change + (sum.boards.add + sum.boards.remove + sum.boards.change);
          let how = 'none';
          if (n > 0) {
            const ms = limitsOf(opts).deleteConfirmMs;
            const ans = await Promise.race([
              Features.confirmChanges(tr('v2693.mcp_rollback_q', 'Batch failed — roll back its changes?'), sum, tr('v2693.rollback', 'Roll back'), String(e.message || e)).then((ok) => ok ? 'ok' : 'declined'),
              new Promise((r) => setTimeout(() => r('timeout'), ms > 0 ? ms : 120000)),
            ]);
            if (ans === 'timeout') { try { if ($('[data-restore-confirm]')) $('#modal-close').click(); } catch (err) {} try { toast('ℹ️ ' + tr('v2610.mcp_kept_timeout_toast', 'MCP batch failed and there was no answer: nothing was rolled back or deleted. Ctrl+Z undoes it.'), { ms: 12000, action: { label: t('undo'), fn: () => App.undo() } }); } catch (err) {} }
            if (ans === 'declined' || ans === 'timeout') { const ch = NyxUndo.diff(Store.picOf(snap), JSON.parse(Store.pic())); ch.subs = []; Store.undoStack.push({ ch, label: labelOf('batch') }); Store.redoStack = []; how = ans === 'timeout' ? 'kept_timeout' : 'kept'; }
            else { Store.applyCh(plan.ch, 'undo'); how = 'rolled_back'; }
          }
          const ms0 = limitsOf(opts).deleteConfirmMs;
          const note = how === 'kept_timeout' ? tr('v2610.mcp_kept_timeout', 'No answer in Nyx within {m}: nothing was rolled back and nothing was deleted. The changes made before the error are kept as they are; the user can undo them in Nyx with Ctrl+Z.', { m: ms0 >= 60000 ? fmtMb(Math.round(ms0 / 600) / 100) + ' ' + tr('v2610.unit_min', 'minutes') : fmtMb(Math.round(ms0 / 100) / 10) + ' ' + tr('v2610.unit_sec', 'seconds') })
            : how === 'kept' ? tr('v2610.mcp_kept', 'The user chose to keep the changes made before the error (undo in Nyx with Ctrl+Z).')
            : how === 'rolled_back' ? tr('v2610.mcp_rolled_back', 'The user confirmed: the changes made before the error were rolled back.')
            : tr('v2610.mcp_none', 'Nothing had changed before the error.');
          Store.save();
          refreshUi();
          try { if (typeof Canvas !== 'undefined') Canvas.refresh?.(); } catch (err) {}
          return { ok: false, rolled_back: how === 'rolled_back' || how === 'none', rollback: how, note, changed: { cards: sum.cards, subs: { add: sum.subs.add, remove: sum.subs.remove, change: sum.subs.change } }, error: String(e.message || e), results };
        }
        refreshUi();
        try { if (typeof Canvas !== 'undefined') Canvas.refresh?.(); } catch (e) {}
        return { ok: true, count: results.length, results };
      },
    },
  };

  function brief(it) {
    const b = boardOf(it);
    return {
      id: it.id, type: it.type, title: titleOf(it),
      ...(it.tags && it.tags.length ? { tags: it.tags } : {}),
      ...(b ? { board: b.name, board_id: b.id } : {}),
      ...(it.reminder && it.reminder.at ? { reminder: it.reminder.at } : {}),
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = McpBoard;
  root.McpBoard = McpBoard;
})(typeof window !== 'undefined' ? window : globalThis);
