'use strict';
// v2.7.0 — data for the canvas widgets (mockups 08 / 09 / 12 / 13). Pure functions over the state: no DOM, no network,
// no writes. Everything comes from data that is already in nyx.json (cards with reminders, countdowns, series cards,
// subscriptions, tags). Exported for the unit tests; in the renderer it is window.NyxWidgetData.
(function (root) {
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseDay = (s) => { if (s instanceof Date) return s; if (typeof s === 'number') return new Date(s); s = String(s || ''); const m = s.match(/^(\d{4})-(\d\d)-(\d\d)$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s); };
  const strip = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
  const dayDiff = (at, now) => Math.round((startOfDay(at) - startOfDay(now)) / DAY);
  // the kinds of widget that exist in 2.7.0 (the gallery lists the later ones as «coming», they cannot be added)
  const KINDS = ['today', 'subs', 'reminders', 'calendar', 'tag'];
  const SIZES = { s: { w: 240, h: 240 }, m: { w: 320, h: 300 }, l: { w: 440, h: 380 } };
  const SIZE_OF = { calendar: { s: { w: 240, h: 256 }, m: { w: 300, h: 330 }, l: { w: 400, h: 380 } }, subs: { s: { w: 260, h: 190 }, m: { w: 320, h: 330 }, l: { w: 420, h: 400 } } };
  const sizeFor = (kind, size) => ({ ...((SIZE_OF[kind] || SIZES)[size] || (SIZE_OF[kind] || SIZES).m) });
  function titleOf(it) { return strip(it.reminder && it.reminder.msg) || it.title || strip(it.html) || it.name || it.type || ''; }

  // every dated thing → [{ at, day, kind, id, emo, title, board, color }]
  function events(state, opts) {
    const out = []; const o = opts || {};
    const push = (when, x) => { const d = parseDay(when); if (isNaN(d)) return; out.push({ ...x, at: +d, day: ymd(d) }); };
    for (const b of (state && state.boards) || []) for (const it of b.items || []) {
      if (!it) continue;
      if (it.reminder && it.reminder.on && it.reminder.at) push(it.reminder.at, { kind: 'reminder', id: it.id, emo: '⏰', title: titleOf(it).slice(0, 80), board: b.name || '', color: it.color || '', repeat: it.reminder.repeat || 'none', birthday: /🎂|γενέθλ|birthday/i.test(titleOf(it)) });
      if (it.type === 'countdown' && it.target) push(it.target, { kind: 'countdown', id: it.id, emo: it.emoji || '⏳', title: it.title || '', board: b.name || '', color: it.color || '' });
      if (it.type === 'show' && it.next && it.next.airstamp) push(it.next.airstamp, { kind: 'show', id: it.id, emo: '📺', title: it.title || '', board: b.name || '', color: '' });
    }
    // subscriptions: the next charge per subscription (NyxCalc.subsSummary().upcoming when given — it rolls past dates forward)
    if (o.subsUpcoming) { for (const u of o.subsUpcoming) if (u && u.date) push(u.date, { kind: 'sub', id: u.id, emo: u.icon || '💳', title: u.name || '', board: '', color: u.color || '', amount: u.text || '' }); }
    else { for (const s of (state && state.subs) || []) if (s && s.active !== false && s.next) push(s.next, { kind: 'sub', id: s.id, emo: s.icon || '💳', title: s.name || '', board: '', color: s.color || '' }); }
    return out.sort((a, b) => a.at - b.at);
  }
  // «σε 2 ώρες», «αύριο», «4 μέρες» → keys the renderer translates; soon = within 3 hours
  function rel(at, now) {
    const ms = at - now; const dd = dayDiff(at, now);
    if (ms < 0 && dd === 0) return { k: 'past_today', n: 0, soon: false };
    if (ms < 0) return { k: 'past', n: -dd, soon: false };
    if (dd === 0) { const hrs = Math.round(ms / 3600000); return hrs < 1 ? { k: 'in_min', n: Math.max(1, Math.round(ms / 60000)), soon: true } : { k: 'in_h', n: hrs, soon: hrs <= 3 }; }
    if (dd === 1) return { k: 'tomorrow', n: 1, soon: false };
    return { k: 'days', n: dd, soon: false };
  }
  // «Υπενθυμίσεις»: the next reminders (an hour back included, like the window), plus how many more this week
  function reminders(state, now, limit) {
    now = now || Date.now(); limit = limit || 3;
    const all = events(state).filter((e) => e.kind === 'reminder' && e.at > now - 3600000);
    const shown = all.slice(0, limit).map((e) => ({ ...e, rel: rel(e.at, now) }));
    const weekEnd = startOfDay(now) + 7 * DAY;
    const more = all.slice(limit).filter((e) => e.at < weekEnd).length;
    return { items: shown, more, total: all.length };
  }
  // «Σήμερα»: everything dated today (reminders, countdowns, episodes, charges) + how many tomorrow
  function today(state, now, opts) {
    now = now || Date.now(); const ev = events(state, opts); const d0 = ymd(now); const d1 = ymd(startOfDay(now) + DAY + 3600000);
    return { day: d0, items: ev.filter((e) => e.day === d0).map((e) => ({ ...e, rel: rel(e.at, now) })), tomorrow: ev.filter((e) => e.day === d1).length, next: ev.find((e) => e.day > d0) || null };
  }
  // «Ημερολόγιο»: month grid, Monday first, 6 rows; days with something get dots (by kind); today marked
  function calendar(state, year, month, now, opts) {
    now = now || Date.now(); const ev = events(state, opts); const byDay = {};
    for (const e of ev) (byDay[e.day] ||= []).push(e);
    const first = new Date(year, month - 1, 1); const lead = (first.getDay() + 6) % 7; const start = new Date(year, month - 1, 1 - lead);
    const weeks = []; const todayKey = ymd(now);
    for (let w = 0; w < 6; w++) { const row = []; for (let i = 0; i < 7; i++) { const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i); const k = ymd(d); const list = byDay[k] || []; row.push({ day: k, d: d.getDate(), inMonth: d.getMonth() === month - 1, today: k === todayKey, kinds: [...new Set(list.map((e) => e.kind))], n: list.length }); } weeks.push(row); }
    const upcoming = ev.filter((e) => e.day >= todayKey).slice(0, 3);
    return { year, month, weeks, upcoming };
  }
  // «#tag»: the cards with that tag on every board (newest board order kept), and every tag with its count (for the picker)
  const normTag = (s) => String(s || '').replace(/^#/, '').trim().toLowerCase();
  function tagged(state, tag, limit) {
    const want = normTag(tag); const out = [];
    if (!want) return { tag: '', items: [], total: 0 };
    for (const b of (state && state.boards) || []) for (const it of b.items || []) if (it && Array.isArray(it.tags) && it.tags.some((t) => normTag(t) === want)) out.push({ id: it.id, type: it.type, title: (titleOf(it) || it.type).slice(0, 80), board: b.name || '', boardId: b.id, emoji: b.emoji || '' });
    return { tag: want, items: out.slice(0, limit || 50), total: out.length };
  }
  function allTags(state) {
    const c = {}; for (const b of (state && state.boards) || []) for (const it of b.items || []) for (const t of (it && it.tags) || []) { const k = normTag(t); if (k) c[k] = (c[k] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, n]) => ({ tag, n }));
  }
  // a new widget card (the canvas item). Only new fields: type 'widget', wkind, wsize, wcollapsed, wtag, title.
  function newItem(kind, size, extra) {
    if (!KINDS.includes(kind)) throw new Error('unknown widget kind: ' + kind);
    const sz = ['s', 'm', 'l'].includes(size) ? size : 'm'; const g = sizeFor(kind, sz);
    return { type: 'widget', wkind: kind, wsize: sz, w: g.w, h: g.h, ...(extra || {}) };
  }
  const api = { KINDS, SIZES, sizeFor, events, rel, reminders, today, calendar, tagged, allTags, newItem, ymd, normTag, titleOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NyxWidgetData = api;
})(typeof window !== 'undefined' ? window : globalThis);
