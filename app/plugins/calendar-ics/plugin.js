function parse(txt) {
  const lines = txt.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); const evs = []; let e = null;
  const dt = (v, p) => { const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v); if (!m) return null; if (!m[4]) return { d: new Date(+m[1], m[2] - 1, +m[3]), allDay: true }; return { d: m[7] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]), allDay: false }; };
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') e = {}; else if (l === 'END:VEVENT') { if (e && e.start) evs.push(e); e = null; }
    else if (e) { const i = l.indexOf(':'); if (i < 0) continue; const k = l.slice(0, i).split(';')[0]; const v = l.slice(i + 1).replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';');
      if (k === 'SUMMARY') e.title = v; else if (k === 'LOCATION') e.loc = v; else if (k === 'DTSTART') { const r = dt(v); if (r) { e.start = r.d; e.allDay = r.allDay; } } else if (k === 'RRULE') e.rrule = v; else if (k === 'URL') e.url = v; }
  }
  return evs;
}
async function upcoming(nyx, days) {
  const urls = String(nyx.config.urls || '').split(/\s+/).filter(u => /^(https?|webcal):/.test(u)); if (!urls.length) throw new Error('Βάλε σύνδεσμο .ics στις ρυθμίσεις');
  let all = []; for (const u of urls) { try { const r = await nyx.fetch(u.replace(/^webcal:/, 'https:')); all = all.concat(parse(await r.text())); } catch (e) { nyx.log('ics', u, e.message); } }
  const now = Date.now() - 3600e3, end = Date.now() + days * 864e5;
  return all.filter(e => +e.start >= now && +e.start <= end).sort((a, b) => a.start - b.start);
}
const fmt = (e) => e.start.toLocaleString('el-GR', e.allDay ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
module.exports = {
  parse,
  cards: { agenda: { async refresh(cfg, nyx) { const evs = await upcoming(nyx, +nyx.config.days || 14); return { title: '📅 Ατζέντα', rows: evs.slice(0, 25).map(e => ({ label: e.title || '(χωρίς τίτλο)', value: fmt(e), sub: [e.loc, e.rrule ? '↻ επαναλαμβανόμενο' : ''].filter(Boolean).join(' · '), url: e.url })), text: evs.length ? '' : 'Τίποτα τις επόμενες μέρες 🎉' }; } } },
  actions: { async import(a, nyx) { const evs = (await upcoming(nyx, 7)).filter(e => !e.allDay); for (const e of evs.slice(0, 30)) await nyx.board.addCard({ kind: 'reminder', text: e.title + (e.loc ? ' @ ' + e.loc : ''), date: new Date(+e.start - 15 * 60e3).toISOString() }); return evs.length + ' υπενθυμίσεις (15′ πριν)'; } },
};
