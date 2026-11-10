'use strict';
// Nyx v2.6.6 — system prompt + history trim. Works in the renderer (script tag) and in Node tests (module.exports).
// Order: stable prefix (instructions → tools → board) then date/time at the END (Europe/Athens, minute precision).
const NyxPrompt = {
  TZ: 'Europe/Athens',
  DEFAULT_HISTORY_PCT: 25,
  BOARD_RE: /π[ίι]νακ|καμβ[άα]|κ[άα]ρτ|σημε[ίι]ω|υπενθυμ|θυμ[ίι]σ|board|canvas|card|sticky|note|reminder|frame|ετικ[έε]τ|\btags?\b|ομαδοπ|τακτοπο|σβ[ήη]σ|διαγρ[άα]|μετακ[ίι]ν|group|tidy|organize/i, // i18n-ignore (intent keywords, not UI)
  GREET_RE: /^\s*(γεια[άα]?(?:\s+σας|\s+σου)?|γειασας|καλημ[έε]ρα|καλησπ[έε]ρα|καλην[ύυ]χτα|hi|hello|hey|hey there|good\s+(morning|evening|night)|sup)\s*[!.…]*\s*$/i, // i18n-ignore (intent keywords, not UI)
  BOARD_TOOLS: { search_cards: 1, read_cards: 1, show_card: 1, update_card: 1, delete_cards: 1, move_cards: 1, move_card: 1, group_cards: 1, tidy_board: 1, organize_board: 1, create_card: 1, create_cards: 1, create_board: 1, open_board: 1, create_reminder: 1, list_reminders: 1, get_agenda: 1, list_boards: 1, add_tags: 1, link_cards: 1, add_image: 1, summarize_board: 1, summarize: 1, board_snapshot: 1 },

  pad(n) { return String(n).padStart(2, '0'); },
  parts(date, tz) {
    const d = date instanceof Date ? date : new Date(date);
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz || this.TZ, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const o = {};
    for (const p of fmt.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
    return o;
  },
  formatNow(date, tz, locale) {
    const p = this.parts(date, tz);
    const loc = locale || 'el-GR';
    let weekday = p.weekday || '';
    try {
      weekday = new Intl.DateTimeFormat(loc, { timeZone: tz || this.TZ, weekday: 'long' }).format(date instanceof Date ? date : new Date(date));
    } catch (e) {}
    const day = `${this.pad(p.day)}/${this.pad(p.month)}/${p.year}`;
    const hm = `${p.hour}:${p.minute}`;
    const zone = tz || this.TZ;
    return { weekday, day, hm, zone, isoMinute: `${p.year}-${this.pad(p.month)}-${this.pad(p.day)}T${p.hour}:${p.minute}`, text: `${weekday} ${day} ${hm} (${zone})` };
  },
  dateLine(date, tz, locale, labels) {
    const f = this.formatNow(date, tz, locale);
    const L = labels || {};
    const now = L.now || 'Now';
    return `${now}: ${f.text}`;
  },

  needsBoard(text, opts) {
    opts = opts || {};
    if (opts.force) return true;
    if (opts.toolsCalled && opts.toolsCalled.some((n) => this.BOARD_TOOLS[n])) return true;
    const s = String(text || '');
    if (!s.trim()) return false;
    if (this.GREET_RE.test(s)) return false;
    return this.BOARD_RE.test(s);
  },

  cardTitle(it) {
    if (!it) return '';
    const raw = it.title || it.name || it.text || it.html || it.caption || '';
    return String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  },
  serializeCards(items) {
    return (items || [])
      .filter((i) => i && i.type !== 'arrow' && i.type !== 'ink' && i.type !== 'line')
      .map((i) => {
        const o = { id: String(i.id || '').slice(0, 8), type: i.type || '' };
        const title = this.cardTitle(i);
        if (title) o.title = title;
        if (Array.isArray(i.tags) && i.tags.length) o.tags = [...i.tags].map(String).sort();
        return o;
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  },
  boardHeader(board, labels) {
    const L = labels || {};
    const name = (board && board.name) || L.unnamed || '—';
    const hint = L.useTools || 'Use tools to read or change cards when needed.';
    return (L.active || 'Active board') + ': «' + name + '». ' + hint;
  },
  boardBody(board, items, others, labels) {
    const L = labels || {};
    const cards = this.serializeCards(items);
    const other = (others || []).map((b) => b && b.name).filter(Boolean).sort().join(', ') || '—';
    const lines = [
      this.boardHeader(board, L),
      (L.count || 'Cards') + ': ' + cards.length + '. ' + (L.others || 'Other boards') + ': ' + other + '.',
      (L.cards || 'Cards') + ': ' + JSON.stringify(cards),
    ];
    return lines.join('\n');
  },

  stableToolsText(tools) {
    const list = (tools || []).map((t) => {
      if (t && t.function) return { name: t.function.name, description: t.function.description || '', parameters: t.function.parameters || {} };
      if (t && t.name) return { name: t.name, description: t.d || t.description || '', parameters: t.p || t.parameters || t.params || {} };
      return null;
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    return list.map((t) => {
      const keys = t.parameters && t.parameters.properties ? Object.keys(t.parameters.properties).sort() : Object.keys(t.parameters || {}).sort();
      return `- ${t.name}(${keys.join(', ')}): ${t.description}`;
    }).join('\n');
  },
  stableTools(tools) {
    const copy = (tools || []).slice().sort((a, b) => {
      const na = (a.function && a.function.name) || a.name || '';
      const nb = (b.function && b.function.name) || b.name || '';
      return na.localeCompare(nb);
    });
    return JSON.parse(JSON.stringify(copy));
  },

  buildSystem({ instructions, extra, toolsText, boardHeader, boardBody, now, labels }) {
    const chunks = [];
    const inst = String(instructions || '').trim();
    if (inst) chunks.push(inst);
    const ex = String(extra || '').trim();
    if (ex) chunks.push(ex);
    if (toolsText) chunks.push(String(toolsText).trim());
    if (boardBody) chunks.push(String(boardBody).trim());
    else if (boardHeader) chunks.push(String(boardHeader).trim());
    const prefix = chunks.join('\n\n');
    const date = now || this.dateLine(new Date(), this.TZ, 'el-GR', labels);
    return prefix + (prefix ? '\n\n' : '') + date;
  },

  estimateTokens(messages, tools) {
    const text = this.requestText(messages, tools);
    return Math.max(1, Math.ceil(String(text).length / 2));
  },
  requestText(messages, tools) {
    const msg = (messages || []).map((m) => {
      const c = m && m.content;
      if (typeof c === 'string') return (m.role || '') + '\n' + c;
      if (Array.isArray(c)) return (m.role || '') + '\n' + c.map((p) => p && (p.text || p.content) || '').join('\n');
      return (m.role || '') + '\n' + (c == null ? '' : JSON.stringify(c));
    }).join('\n');
    if (!tools || !tools.length) return msg;
    return msg + '\n' + JSON.stringify(this.stableTools(tools));
  },

  hashMessages(messages) {
    const s = (messages || []).map((m) => (m.role || '') + ':' + String(m.content || '')).join('\n');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  },
  extractiveSummary(messages, labels) {
    const L = labels || {};
    const head = L.summaryHead || 'Earlier conversation (summary):';
    const lines = (messages || []).map((m) => {
      const role = m.role === 'assistant' ? (L.assistant || 'assistant') : (L.user || 'user');
      return '- ' + role + ': ' + String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    }).filter((l) => l.length > 4);
    return head + '\n' + lines.join('\n');
  },
  // Keep a suffix of history whose tokens are ≤ percent of nCtx. Older messages become a summary (cached, incremental).
  trimHistory(messages, opts) {
    opts = opts || {};
    const all = (messages || []).filter((m) => m && m.content && m.role !== 'notice' && !m.error).map((m) => ({ role: m.role, content: String(m.content) }));
    const nCtx = +opts.nCtx || 0;
    const pct = opts.percent == null ? this.DEFAULT_HISTORY_PCT : Math.max(0, Math.min(100, +opts.percent));
    const estimate = opts.estimate || ((ms) => this.estimateTokens(ms));
    if (!all.length) return { messages: [], summary: '', trimmed: false, reason: 'empty' };
    if (!nCtx) return { messages: all, summary: '', trimmed: false, reason: 'unknown_ctx' };
    const budget = Math.max(0, Math.floor(nCtx * pct / 100));
    const current = all[all.length - 1];
    const older = all.slice(0, -1);
    const fit = [];
    let used = estimate([current]);
    if (used > budget) return { messages: [current], summary: '', trimmed: !!older.length, reason: 'current_exceeds', budget, used };
    for (let i = older.length - 1; i >= 0; i--) {
      const cand = [older[i], ...fit];
      const u = estimate([...cand, current]);
      if (u > budget) {
        const dropped = older.slice(0, i + 1);
        let summary = '';
        const cache = opts.cache || null;
        const key = this.hashMessages(dropped);
        if (cache && cache.key === key && cache.text) summary = cache.text;
        else if (typeof opts.summarize === 'function') summary = opts.summarize(dropped, cache);
        else summary = this.extractiveSummary(dropped, opts.labels);
        const out = [];
        if (summary) out.push({ role: 'system', content: summary, digest: true });
        out.push(...fit, current);
        return { messages: out, summary, trimmed: true, reason: 'trimmed', budget, used: estimate(out), dropped: dropped.length, cacheKey: key };
      }
      fit.unshift(older[i]);
      used = u;
    }
    return { messages: [...fit, current], summary: '', trimmed: false, reason: 'fits', budget, used };
  },
};

if (typeof module === 'object' && module.exports) module.exports = NyxPrompt;
