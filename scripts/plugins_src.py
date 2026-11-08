import json, os
P = {}
def add(id, manifest, js=None):
    P[id] = (dict(id=id, version='1.0.0', author='Nyx', **manifest), js)

# ---------------- telegram ----------------
add('telegram', dict(name='Telegram bot', icon='send', category='Επικοινωνία', permissions=['net','board','assistant','notify'],
  description='Στείλε σημειώσεις/εντολές στο Nyx από το κινητό μέσω του δικού σου Telegram bot. Απαντά ο βοηθός.',
  long='1. Στο Telegram μίλα στον **@BotFather** → `/newbot` → πάρε το token.\n2. Βάλε το token εδώ και στείλε `/start` στο bot σου: θα σου απαντήσει με το chat id σου.\n3. Βάλε το chat id στο «Επιτρεπτά chat ids». Μόνο αυτά εξυπηρετούνται.\n\nΚείμενο → σημείωση στον καμβά. `/ask …` (ή λειτουργία «βοηθός») → εντολή στον βοηθό και απάντηση πίσω.',
  verified=False, homepage='https://core.telegram.org/bots',
  config=[dict(key='token',label='Bot token',type='password',required=True),
          dict(key='chatId',label='Επιτρεπτά chat ids (κόμμα)',type='text'),
          dict(key='mode',label='Απλό μήνυμα =',type='select',options=[['note','Σημείωση στον καμβά'],['assistant','Εντολή στον βοηθό']],default='note')],
  actions=[dict(id='send',label='Αποστολή',icon='send',args=[dict(key='text',label='Μήνυμα',type='textarea')]),dict(id='test',label='Δοκιμή σύνδεσης',icon='plug')]),
r'''
let off = 0, busy = false, iv = null;
async function api(nyx, method, body) {
  const t = nyx.config.token; if (!t) throw new Error('Βάλε το bot token στις ρυθμίσεις');
  const r = await nyx.fetch('https://api.telegram.org/bot' + t + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json(); if (!j.ok) throw new Error(j.description || 'Telegram error'); return j.result;
}
const allowed = (nyx) => String(nyx.config.chatId || '').split(',').map(s => s.trim()).filter(Boolean);
async function poll(nyx) {
  if (busy || !nyx.config.token) return; busy = true;
  try {
    const ups = await api(nyx, 'getUpdates', { offset: off, timeout: 0, allowed_updates: ['message'] });
    for (const u of ups) {
      off = u.update_id + 1; nyx.storage.set('off', off);
      const m = u.message; if (!m || !m.text) continue;
      const ok = allowed(nyx);
      if (!ok.includes(String(m.chat.id))) { nyx.log('αγνοήθηκε chat', m.chat.id); if (!ok.length) await api(nyx, 'sendMessage', { chat_id: m.chat.id, text: 'Το chat id σου: ' + m.chat.id + '\nΒάλ\' το στις ρυθμίσεις του plugin στο Nyx.' }); continue; }
      const t = m.text.trim(); let reply;
      if (/^\/start/.test(t)) reply = '👋 Nyx εδώ. Γράψε σημείωση ή /ask <εντολή>.';
      else if (/^\/(ask|nyx)\b/i.test(t) || nyx.config.mode === 'assistant') { const r = await nyx.assistant(t.replace(/^\/(ask|nyx)\s*/i, '')); reply = (r && r.content) || '✓'; }
      else { await nyx.board.addCard({ kind: 'note', text: t, tags: ['telegram'] }); reply = '📌 Αποθηκεύτηκε στο Nyx'; nyx.notify('Telegram', t.slice(0, 80)); }
      await api(nyx, 'sendMessage', { chat_id: m.chat.id, text: String(reply).slice(0, 4000), reply_to_message_id: m.message_id });
    }
  } catch (e) { nyx.log('poll:', e.message); } finally { busy = false; }
}
module.exports = {
  activate(nyx) { off = nyx.storage.get('off', 0); iv = setInterval(() => poll(nyx), 4000); poll(nyx); },
  deactivate() { clearInterval(iv); },
  actions: {
    async send(a, nyx) { const id = allowed(nyx)[0]; if (!id) throw new Error('Βάλε chat id'); await api(nyx, 'sendMessage', { chat_id: id, text: String(a.text || '').slice(0, 4000) }); return 'Στάλθηκε ✓'; },
    async test(a, nyx) { const me = await api(nyx, 'getMe'); return 'OK: @' + me.username; },
  },
};
''')

# ---------------- calendar ics ----------------
add('calendar-ics', dict(name='Ημερολόγιο (ICS)', icon='calendar-days', category='Παραγωγικότητα', permissions=['net','board'],
  description='Δείχνει τα επόμενα γεγονότα από Google/Outlook/iCloud ημερολόγιο μέσω μυστικού συνδέσμου .ics. Εισαγωγή ως υπενθυμίσεις.',
  long='Google Calendar → Ρυθμίσεις ημερολογίου → «Μυστική διεύθυνση σε μορφή iCal». Outlook → Κοινή χρήση → Δημοσίευση → ICS.\nΤα επαναλαμβανόμενα (RRULE) δείχνουν μόνο την πρώτη εμφάνιση.',
  config=[dict(key='urls',label='Σύνδεσμοι .ics (ένας ανά γραμμή)',type='textarea',required=True),dict(key='days',label='Ημέρες μπροστά',type='number',default=14)],
  cards=[dict(type='agenda',name='Ατζέντα',w=340,h=320,every=30)],
  actions=[dict(id='import',label='Εισαγωγή ως υπενθυμίσεις (7 ημ.)',icon='bell-plus')]),
r'''
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
''')

# ---------------- rss ----------------
add('rss', dict(name='RSS / Atom', icon='rss', category='Ειδήσεις', permissions=['net','notify'],
  description='Κάρτα με τα τελευταία άρθρα από RSS/Atom feeds (blogs, subreddits, YouTube κανάλια, GitHub releases). Ειδοποίηση για νέα.',
  long='Παραδείγματα: `https://www.reddit.com/r/LocalLLaMA/.rss`, `https://github.com/ggml-org/llama.cpp/releases.atom`, YouTube: `https://www.youtube.com/feeds/videos.xml?channel_id=…`',
  config=[dict(key='feeds',label='Feeds (ένα ανά γραμμή)',type='textarea',default='https://www.reddit.com/r/LocalLLaMA/.rss\nhttps://github.com/ggml-org/llama.cpp/releases.atom'),dict(key='notify',label='Ειδοποίηση για νέα άρθρα',type='checkbox',default=False)],
  cards=[dict(type='feed',name='Feed',w=360,h=380,every=30)]),
r'''
const dec = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
function parse(xml) {
  const items = []; const feedTitle = dec((/<title[^>]*>([\s\S]*?)<\/title>/.exec(xml) || [])[1]);
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)) { const x = m[0];
    const t = dec((/<title[^>]*>([\s\S]*?)<\/title>/.exec(x) || [])[1]);
    const link = (/<link[^>]*href="([^"]+)"/.exec(x) || [])[1] || dec((/<link>([\s\S]*?)<\/link>/.exec(x) || [])[1]);
    const d = dec((/<(pubDate|updated|published|dc:date)>([\s\S]*?)<\/\1>/.exec(x) || [])[2]);
    items.push({ title: t, url: link, date: d ? new Date(d) : null, feed: feedTitle }); }
  return { title: feedTitle, items };
}
module.exports = {
  parse,
  cards: { feed: { async refresh(cfg, nyx) {
    const feeds = String(nyx.config.feeds || '').split(/\s+/).filter(u => /^https?:/.test(u)); if (!feeds.length) throw new Error('Πρόσθεσε feeds στις ρυθμίσεις');
    let all = []; for (const f of feeds) { try { const r = await nyx.fetch(f, { headers: { 'User-Agent': 'NyxCanvas/2 RSS' } }); all = all.concat(parse(await r.text()).items); } catch (e) { nyx.log(f, e.message); } }
    all.sort((a, b) => (b.date || 0) - (a.date || 0));
    const seen = nyx.storage.get('seen', []); const fresh = all.filter(i => i.url && !seen.includes(i.url));
    if (seen.length && fresh.length && nyx.config.notify) nyx.notify('RSS: ' + fresh.length + ' νέα', fresh[0].title);
    nyx.storage.set('seen', all.slice(0, 300).map(i => i.url));
    return { title: '📰 ' + (feeds.length === 1 && all[0] ? all[0].feed : 'Feeds'), rows: all.slice(0, 30).map(i => ({ label: i.title, url: i.url, sub: (i.feed ? i.feed + ' · ' : '') + (i.date && !isNaN(i.date) ? i.date.toLocaleString('el-GR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') })) };
  } } },
};
''')

# ---------------- clipboard inbox ----------------
add('clipboard-inbox', dict(name='Clipboard Inbox', icon='clipboard-list', category='Παραγωγικότητα', permissions=['clipboard','board','widget'],
  description='Ιστορικό προχείρου με αυτόματες κατηγορίες (σύνδεσμοι, κώδικας, email, τηλέφωνα, χρώματα, αριθμοί, κείμενο) και καθάρισμα tracking παραμέτρων (utm, fbclid, gclid, si…) από links.',
  long='Εμπνευσμένο από το «Copy Haste». Κρατά τα τελευταία 300 τοπικά (όχι κωδικούς: αγνοεί ό,τι μοιάζει με token/κωδικό). Αν ενεργοποιήσεις «Γράψε πίσω καθαρό link», όταν αντιγράφεις link με tracking το πρόχειρο αντικαθίσταται με την καθαρή εκδοχή.',
  config=[dict(key='strip',label='Γράψε πίσω καθαρό link στο πρόχειρο',type='checkbox',default=True),dict(key='ignore',label='Αγνόησε κείμενα που περιέχουν (κόμμα)',type='text',default='password,κωδικός')],
  cards=[dict(type='inbox',name='Πρόχειρο',w=360,h=400,every=1)],
  actions=[dict(id='toBoard',label='Τα 10 τελευταία στον καμβά',icon='layout-grid'),dict(id='clear',label='Καθάρισμα ιστορικού',icon='eraser'),dict(id='clean',label='Καθάρισε link',icon='link',hidden=True,args=[dict(key='url',label='URL')])]),
r'''
const TRACK = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|si|ref_src|ref_url|_hsenc|_hsmi|mkt_tok|yclid|vero_id|oly_anon_id|oly_enc_id|rb_clickid|s_cid|spm|scm|share_id|feature|pp|ttclid|twclid|li_fat_id|epik|__s)$/i;
function cleanUrl(u) { try { const x = new URL(u); let n = 0; for (const k of [...x.searchParams.keys()]) if (TRACK.test(k) && !(k === 'feature' && !/youtu/.test(x.host)) && !(k === 'si' && !/youtu|spotify/.test(x.host)) && !(k === 'pp' && !/youtu/.test(x.host))) { x.searchParams.delete(k); n++; } return n ? x.toString().replace(/\?$/, '') : u; } catch (e) { return u; } }
function cat(t) {
  const s = t.trim();
  if (/^https?:\/\/\S+$/i.test(s)) return 'link';
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(s)) return 'email';
  if (/^\+?[\d\s()-]{8,18}$/.test(s) && (s.match(/\d/g) || []).length >= 8) return 'phone';
  if (/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(s)) return 'color';
  if (/^-?[\d.,\s€$%]+$/.test(s)) return 'number';
  if (/[{};]\s*$|^\s*(const|let|var|function|def|class|import|from|#include|public|SELECT|<\w+)/m.test(s) || /=>|\)\s*\{/.test(s)) return 'code';
  return 'text';
}
const ICON = { link: '🔗', email: '✉️', phone: '📞', color: '🎨', number: '🔢', code: '💻', text: '📝' };
let iv, last = '';
const secretish = (s, nyx) => /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[bp]-|AKIA[0-9A-Z]{16}|eyJ[\w-]{20,}\.)/.test(s) || String(nyx.config.ignore || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).some(w => s.toLowerCase().includes(w));
let busy = false;
async function tick(nyx) {
  if (busy) return; busy = true;
  try { await tick2(nyx); } catch (e) { nyx.log('σφάλμα: ' + (e && e.message)); } finally { busy = false; }
}
async function tick2(nyx) {
  let t; try { t = await nyx.clipboard.readText(); } catch (e) { return; } if (typeof t !== 'string' || !t || t === last || t.length > 20000) return; last = t;
  if (secretish(t, nyx)) { nyx.log('αγνοήθηκε (μοιάζει με κωδικό/token)'); return; }
  let c = cat(t), v = t.trim(), stripped = false;
  if (c === 'link') { const cl = cleanUrl(v); if (cl !== v) { stripped = true; v = cl; if (nyx.config.strip) { last = cl; await nyx.clipboard.writeText(cl); } } }
  const h = nyx.storage.get('h', []).filter(x => x.v !== v); h.unshift({ v, c, at: Date.now(), stripped }); nyx.storage.set('h', h.slice(0, 300));
  try { nyx.setShared('clip', ICON[c] + ' ' + (stripped ? 'καθαρό link' : v.slice(0, 28))); } catch (e) {}
}
module.exports = {
  cleanUrl, cat,
  async activate(nyx) { try { last = (await nyx.clipboard.readText()) || ''; } catch (e) {} iv = setInterval(() => tick(nyx), 1200); },
  deactivate() { clearInterval(iv); },
  cards: { inbox: { async refresh(cfg, nyx) { const h = nyx.storage.get('h', []); const counts = {}; h.forEach(x => counts[x.c] = (counts[x.c] || 0) + 1);
    return { title: '📋 Clipboard Inbox', text: Object.entries(counts).map(([k, n]) => ICON[k] + ' ' + n).join('  ') || 'Αντίγραψε κάτι…', rows: h.slice(0, 25).map(x => ({ icon: ICON[x.c], label: x.v.slice(0, 140), url: x.c === 'link' ? x.v : undefined, sub: new Date(x.at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }) + (x.stripped ? ' · 🧹 καθαρίστηκε tracking' : '') })), footer: h.length + ' στοιχεία' }; } } },
  actions: {
    async toBoard(a, nyx) { const h = nyx.storage.get('h', []).slice(0, 10); for (const x of h.reverse()) await nyx.board.addCard(x.c === 'link' ? { kind: 'link', url: x.v } : x.c === 'code' ? { kind: 'code', text: x.v } : { kind: 'note', text: x.v, tags: ['clip-' + x.c] }); return h.length + ' κάρτες'; },
    async list(a, nyx) { return nyx.storage.get('h', []).slice(0, +(a && a.n) || 50); },
    async clear(a, nyx) { nyx.storage.set('h', []); return 'Καθαρίστηκε'; },
    async clean(a) { return cleanUrl(String(a.url || '')); },
  },
};
''')

# ---------------- weather ----------------
add('weather', dict(name='Καιρός', icon='cloud-sun', category='Widgets', permissions=['net','widget'],
  description='Καιρός τώρα + 5 ημέρες από Open-Meteo (δωρεάν, χωρίς κλειδί). Δείχνει τη θερμοκρασία στο pill του widget.',
  homepage='https://open-meteo.com', license='CC-BY 4.0 data',
  config=[dict(key='city',label='Πόλη',type='text',default='Αθήνα')],
  cards=[dict(type='now',name='Καιρός',w=320,h=300,every=30)]),
r'''
const W = { 0: ['☀️', 'Αίθριος'], 1: ['🌤️', 'Κυρίως αίθριος'], 2: ['⛅', 'Λίγα σύννεφα'], 3: ['☁️', 'Συννεφιά'], 45: ['🌫️', 'Ομίχλη'], 48: ['🌫️', 'Ομίχλη'], 51: ['🌦️', 'Ψιχάλα'], 53: ['🌦️', 'Ψιχάλα'], 55: ['🌦️', 'Ψιχάλα'], 61: ['🌧️', 'Βροχή'], 63: ['🌧️', 'Βροχή'], 65: ['🌧️', 'Δυνατή βροχή'], 71: ['🌨️', 'Χιόνι'], 73: ['🌨️', 'Χιόνι'], 75: ['❄️', 'Πολύ χιόνι'], 80: ['🌦️', 'Μπόρες'], 81: ['🌧️', 'Μπόρες'], 82: ['⛈️', 'Ισχυρές μπόρες'], 95: ['⛈️', 'Καταιγίδα'], 96: ['⛈️', 'Καταιγίδα/χαλάζι'], 99: ['⛈️', 'Καταιγίδα/χαλάζι'] };
const w = (c) => W[c] || ['🌡️', ''];
module.exports = { cards: { now: { async refresh(cfg, nyx) {
  const city = nyx.config.city || 'Αθήνα'; let geo = nyx.storage.get('geo');
  if (!geo || geo.q !== city) { const g = await (await nyx.fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=el&name=' + encodeURIComponent(city))).json(); const r = g.results && g.results[0]; if (!r) throw new Error('Δεν βρέθηκε η πόλη ' + city); geo = { q: city, lat: r.latitude, lon: r.longitude, name: r.name }; nyx.storage.set('geo', geo); }
  const j = await (await nyx.fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=6`)).json();
  const c = j.current; const [ic, tx] = w(c.weather_code);
  try { nyx.setShared('weather', ic + ' ' + Math.round(c.temperature_2m) + '° ' + geo.name); } catch (e) {}
  const D = j.daily; const rows = D.time.slice(1).map((d, i) => ({ icon: w(D.weather_code[i + 1])[0], label: new Date(d).toLocaleDateString('el-GR', { weekday: 'long' }), value: Math.round(D.temperature_2m_min[i + 1]) + '° / ' + Math.round(D.temperature_2m_max[i + 1]) + '°', sub: D.precipitation_probability_max[i + 1] != null ? '☔ ' + D.precipitation_probability_max[i + 1] + '%' : '' }));
  return { title: ic + ' ' + geo.name + ' · ' + Math.round(c.temperature_2m) + '°C', text: `${tx} · αίσθηση ${Math.round(c.apparent_temperature)}° · 💧${c.relative_humidity_2m}% · 💨${Math.round(c.wind_speed_10m)} km/h`, rows, footer: 'Open-Meteo' };
} } } };
''')

# ---------------- markets ----------------
add('markets', dict(name='Crypto & αγορές', icon='chart-candlestick', category='Widgets', permissions=['net','widget'],
  description='Τιμές crypto (CoinGecko, χωρίς κλειδί) σε €, με μεταβολή 24ώρου. Προαιρετικά στο pill του widget.',
  homepage='https://www.coingecko.com/en/api',
  config=[dict(key='ids',label='CoinGecko ids (κόμμα)',type='text',default='bitcoin,ethereum,solana'),dict(key='vs',label='Νόμισμα',type='select',options=['eur','usd'],default='eur'),dict(key='pill',label='Πρώτο στο widget pill',type='checkbox',default=False)],
  cards=[dict(type='prices',name='Τιμές',w=300,h=260,every=10)]),
r'''
module.exports = { cards: { prices: { async refresh(cfg, nyx) {
  const ids = String(nyx.config.ids || 'bitcoin').replace(/\s/g, ''); const vs = nyx.config.vs || 'eur';
  const j = await (await nyx.fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${vs}&include_24hr_change=true`)).json();
  const sym = vs === 'eur' ? '€' : '$';
  const rows = Object.entries(j).map(([k, v]) => { const ch = v[vs + '_24h_change']; return { label: k, value: sym + Number(v[vs]).toLocaleString('el-GR', { maximumFractionDigits: v[vs] < 10 ? 4 : 0 }), sub: ch != null ? (ch >= 0 ? '▲ ' : '▼ ') + ch.toFixed(2) + '% 24ω' : '', color: ch >= 0 ? '#4ade80' : '#ff6b81' }; });
  if (nyx.config.pill && rows[0]) try { nyx.setShared('markets', '₿ ' + rows[0].value + ' ' + (rows[0].sub.split(' ')[1] || '')); } catch (e) {}
  return { title: '📈 Αγορές', rows, footer: 'CoinGecko' };
} } } };
''')

# ---------------- currency ----------------
add('currency', dict(name='Ισοτιμίες', icon='euro', category='Widgets', permissions=['net'],
  description='Ισοτιμίες ΕΚΤ (Frankfurter, δωρεάν) και γρήγορη μετατροπή ποσών.',
  homepage='https://frankfurter.dev',
  config=[dict(key='base',label='Βάση',type='text',default='EUR'),dict(key='to',label='Νομίσματα',type='text',default='USD,GBP,CHF,TRY,JPY')],
  cards=[dict(type='rates',name='Ισοτιμίες',w=280,h=260,every=180)],
  actions=[dict(id='convert',label='Μετατροπή',icon='arrow-left-right',args=[dict(key='amount',label='Ποσό',type='number',default=100),dict(key='from',label='Από',default='EUR'),dict(key='to',label='Σε',default='USD')])]),
r'''
async function get(nyx, from, to) {
  for (const base of ['https://api.frankfurter.dev/v1/latest', 'https://api.frankfurter.app/latest']) { try { const r = await nyx.fetch(`${base}?base=${from}&symbols=${to}`); if (r.ok) return await r.json(); } catch (e) { nyx.log(base, e.message); } }
  throw new Error('Δεν απαντά το Frankfurter');
}
module.exports = {
  cards: { rates: { async refresh(cfg, nyx) { const b = (nyx.config.base || 'EUR').toUpperCase(); const j = await get(nyx, b, String(nyx.config.to || 'USD').toUpperCase().replace(/\s/g, '')); return { title: '💱 1 ' + b, rows: Object.entries(j.rates).map(([k, v]) => ({ label: k, value: v.toLocaleString('el-GR', { maximumFractionDigits: 4 }) })), footer: 'ΕΚΤ · ' + j.date }; } } },
  actions: { async convert(a, nyx) { const f = String(a.from || 'EUR').toUpperCase(), t = String(a.to || 'USD').toUpperCase(); const j = await get(nyx, f, t); const v = (+a.amount || 0) * j.rates[t]; return `${a.amount} ${f} = ${v.toLocaleString('el-GR', { maximumFractionDigits: 2 })} ${t}`; } },
};
''')

# ---------------- github releases ----------------
add('github-releases', dict(name='GitHub releases', icon='github', category='Dev', permissions=['net','notify'],
  description='Παρακολουθεί νέες εκδόσεις των εργαλείων σου (llama.cpp, whisper.cpp, LM Studio, ComfyUI κ.ά.) και σε ειδοποιεί.',
  config=[dict(key='repos',label='Repos (owner/repo, ένα ανά γραμμή)',type='textarea',default='ggml-org/llama.cpp\nggml-org/whisper.cpp\nlmstudio-ai/lms\nheygen-com/hyperframes\nlightpanda-io/browser'),dict(key='token',label='GitHub token (προαιρετικό, για όριο κλήσεων)',type='password')],
  cards=[dict(type='rel',name='Releases',w=360,h=340,every=120)]),
r'''
module.exports = { cards: { rel: { async refresh(cfg, nyx) {
  const repos = String(nyx.config.repos || '').split(/\s+/).filter(r => /^[\w.-]+\/[\w.-]+$/.test(r)).slice(0, 20); const seen = nyx.storage.get('seen', {}); const rows = [];
  const H = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'NyxCanvas' }; if (nyx.config.token) H.Authorization = 'Bearer ' + nyx.config.token;
  for (const r of repos) { try { const res = await nyx.fetch(`https://api.github.com/repos/${r}/releases?per_page=1`, { headers: H }); const j = await res.json(); const x = Array.isArray(j) ? j[0] : null; if (!x) { rows.push({ label: r, value: '—', sub: j && j.message ? j.message : 'χωρίς releases' }); continue; }
    const isNew = seen[r] && seen[r] !== x.tag_name; if (isNew) nyx.notify('Νέα έκδοση ' + r, x.tag_name); seen[r] = x.tag_name;
    rows.push({ icon: isNew ? '🆕' : '📦', label: r, value: x.tag_name, url: x.html_url, sub: new Date(x.published_at).toLocaleDateString('el-GR') + (x.prerelease ? ' · pre' : '') }); } catch (e) { rows.push({ label: r, value: '⚠️', sub: e.message }); } }
  nyx.storage.set('seen', seen); return { title: '🐙 Releases', rows };
} } } };
''')

# ---------------- hf trending ----------------
add('hf-trending', dict(name='Hugging Face trending', icon='flame', category='AI', permissions=['net'],
  description='Τα μοντέλα που ανεβαίνουν στο Hugging Face (π.χ. μόνο GGUF για LM Studio/llama.cpp).',
  homepage='https://huggingface.co/models?sort=trending',
  config=[dict(key='filter',label='Φίλτρο (library/tag)',type='text',default='gguf'),dict(key='search',label='Αναζήτηση (π.χ. qwen)',type='text')],
  cards=[dict(type='models',name='Trending',w=360,h=380,every=180)]),
r'''
module.exports = { cards: { models: { async refresh(cfg, nyx) {
  let u = 'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=20'; if (nyx.config.filter) u += '&filter=' + encodeURIComponent(nyx.config.filter); if (nyx.config.search) u += '&search=' + encodeURIComponent(nyx.config.search);
  const j = await (await nyx.fetch(u)).json(); if (!Array.isArray(j)) throw new Error(j.error || 'HF error');
  const k = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0);
  return { title: '🤗 Trending' + (nyx.config.filter ? ' · ' + nyx.config.filter : ''), rows: j.map(m => ({ label: m.id || m.modelId, url: 'https://huggingface.co/' + (m.id || m.modelId), value: '♥ ' + k(m.likes), sub: [m.pipeline_tag, '⬇ ' + k(m.downloads)].filter(Boolean).join(' · ') })) };
} } } };
''')

# ---------------- eortologio ----------------
add('eortologio', dict(name='Εορτολόγιο & αργίες', icon='party-popper', category='Widgets', permissions=['widget'],
  description='Ποιοι γιορτάζουν σήμερα/αύριο (κύριες ονομαστικές, και κινητές του Πάσχα) και οι επόμενες επίσημες αργίες. Εντελώς offline.',
  long='Περιλαμβάνει τις πιο συχνές ονομαστικές εορτές (όχι πλήρες εορτολόγιο). Το Πάσχα υπολογίζεται (Ορθόδοξο). Ο Άγιος Γεώργιος μεταφέρεται τη Δευτέρα του Πάσχα όταν πέφτει πριν.',
  cards=[dict(type='today',name='Γιορτές',w=320,h=300,every=360)]),
r'''
const N = { '01-01': 'Βασίλειος, Βασιλική', '01-06': 'Φώτιος, Φωτεινή(Φώτης), Θεοφάνης, Θεοφανία, Ιορδάνης', '01-07': 'Ιωάννης, Ιωάννα', '01-11': 'Θεοδόσιος', '01-17': 'Αντώνιος, Αντωνία', '01-18': 'Αθανάσιος, Αθανασία', '01-20': 'Ευθύμιος, Ευθυμία', '01-25': 'Γρηγόριος', '02-01': 'Τρύφων', '02-10': 'Χαράλαμπος', '02-11': 'Βλάσιος', '02-26': 'Φωτεινή', '03-09': 'Σαράντα Μάρτυρες', '03-25': 'Ευάγγελος, Ευαγγελία', '04-01': 'Μαρία Αιγυπτία', '05-05': 'Ειρήνη', '05-21': 'Κωνσταντίνος, Ελένη', '06-11': 'Βαρθολομαίος, Βαρνάβας', '06-24': 'Ιωάννης Πρόδρομος (γενέθλιο)', '06-29': 'Πέτρος, Παύλος', '06-30': 'Απόστολος', '07-07': 'Κυριακή', '07-17': 'Μαρίνα', '07-20': 'Ηλίας', '07-22': 'Μαγδαληνή', '07-25': 'Άννα', '07-26': 'Παρασκευή, Παρασκευάς', '07-27': 'Παντελεήμων, Παντελής', '08-06': 'Σωτήριος, Σωτηρία', '08-15': 'Μαρία, Παναγιώτης, Δέσποινα, Μάριος', '08-29': 'Ιωάννης', '08-30': 'Αλέξανδρος', '09-08': 'Μαρία (Γενέθλιο Θεοτόκου)', '09-14': 'Σταύρος, Σταυρούλα', '09-17': 'Σοφία, Πίστη, Ελπίδα, Αγάπη', '09-20': 'Ευστάθιος', '10-03': 'Διονύσιος', '10-18': 'Λουκάς', '10-26': 'Δημήτριος, Δήμητρα', '11-08': 'Μιχαήλ, Γαβριήλ, Άγγελος, Αγγελική, Ραφαήλ', '11-09': 'Νεκτάριος', '11-11': 'Μηνάς, Βίκτωρ', '11-13': 'Χρυσόστομος', '11-14': 'Φίλιππος', '11-16': 'Ματθαίος', '11-25': 'Αικατερίνη', '11-30': 'Ανδρέας', '12-04': 'Βαρβάρα', '12-05': 'Σάββας', '12-06': 'Νικόλαος, Νικολέτα', '12-09': 'Άννα', '12-12': 'Σπυρίδων', '12-15': 'Ελευθέριος, Ελευθερία', '12-17': 'Διονύσιος (Αιγίνης)', '12-25': 'Χρήστος, Χριστίνα, Εμμανουήλ', '12-26': 'Εμμανουήλ', '12-27': 'Στέφανος, Στεφανία' };
function easter(y) { const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7, m = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1; const j = new Date(y, m - 1, day); j.setDate(j.getDate() + 13); return j; }
const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const key = (d) => String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function names(d) {
  const y = d.getFullYear(), E = easter(y), k = key(d); let out = N[k] ? [N[k]] : [];
  const geo = new Date(y, 3, 23); const geoDay = geo < E ? add(E, 1) : geo;
  if (k === '04-23') out = []; if (key(geoDay) === k) out.push('Γεώργιος, Γεωργία');
  if (key(E) === k) out.push('Αναστάσιος, Αναστασία, Λάμπρος'); if (key(add(E, 7)) === k) out.push('Θωμάς, Θωμαΐς'); if (key(add(E, 50)) === k) out.push('Τριαντάφυλλος (Αγ. Πνεύματος)'); if (key(add(E, 5)) === k) out.push('Ζωή (Ζωοδόχου Πηγής)');
  return out.join(', ');
}
function holidays(y) { const E = easter(y); return [[new Date(y, 0, 1), 'Πρωτοχρονιά'], [new Date(y, 0, 6), 'Θεοφάνεια'], [add(E, -48), 'Καθαρά Δευτέρα'], [new Date(y, 2, 25), '25η Μαρτίου'], [add(E, -2), 'Μεγάλη Παρασκευή'], [E, 'Πάσχα'], [add(E, 1), 'Δευτέρα του Πάσχα'], [new Date(y, 4, 1), 'Πρωτομαγιά'], [add(E, 50), 'Αγίου Πνεύματος'], [new Date(y, 7, 15), 'Δεκαπενταύγουστος'], [new Date(y, 9, 28), '28η Οκτωβρίου'], [new Date(y, 11, 25), 'Χριστούγεννα'], [new Date(y, 11, 26), 'Σύναξη Θεοτόκου']]; }
module.exports = { easter, names, holidays, cards: { today: { async refresh(cfg, nyx) {
  const t = new Date(); t.setHours(0, 0, 0, 0); const tm = add(t, 1); const n0 = names(t), n1 = names(tm);
  try { nyx.setShared('names', n0 ? '🎉 ' + n0.split(',')[0] : null); } catch (e) {}
  const hs = [...holidays(t.getFullYear()), ...holidays(t.getFullYear() + 1)].filter(([d]) => d >= t).slice(0, 5);
  return { title: '🎉 Εορτολόγιο', rows: [{ label: 'Σήμερα', value: '', sub: n0 || '—' }, { label: 'Αύριο', value: '', sub: n1 || '—' }, ...hs.map(([d, l]) => ({ icon: '🏖️', label: l, value: d.toLocaleDateString('el-GR', { weekday: 'short', day: 'numeric', month: 'short' }), sub: Math.round((d - t) / 864e5) + ' ημέρες' }))] };
} } } };
''')

# ---------------- jsoncanvas ----------------
add('jsoncanvas', dict(name='JSON Canvas (Obsidian)', icon='file-json', category='Εισαγωγή/Εξαγωγή', permissions=['board','files'],
  description='Εξαγωγή του πίνακα σε .canvas (ανοιχτό format του Obsidian) και εισαγωγή .canvas αρχείων ως νέο πίνακα.',
  homepage='https://jsoncanvas.org', license='MIT (spec)',
  actions=[dict(id='export',label='Εξαγωγή .canvas',icon='download'),dict(id='import',label='Εισαγωγή .canvas',icon='upload')]),
r'''
function toCanvas(snap) {
  const nodes = [], edges = []; const boxes = [];
  for (const i of snap.items) {
    if (i.type === 'arrow' || i.type === 'line') continue;
    const n = { id: i.id, x: i.x, y: i.y, width: Math.max(40, i.w), height: Math.max(40, i.h) };
    if (/^#[0-9a-f]{6}$/i.test(i.color || '')) n.color = i.color;
    if (i.type === 'frame') Object.assign(n, { type: 'group', label: i.title });
    else if ((i.type === 'link' || i.type === 'web') && i.url) Object.assign(n, { type: 'link', url: i.url });
    else Object.assign(n, { type: 'text', text: (i.type === 'image' || i.type === 'video' || i.type === 'audio' ? '![[' + (i.title || 'media') + ']]\n' : '') + (i.text || i.title || '') + (i.tags && i.tags.length ? '\n\n' + i.tags.map(t => '#' + t).join(' ') : '') });
    nodes.push(n); if (n.type !== 'group') boxes.push(n);
  }
  const hit = (x, y) => boxes.find(b => x >= b.x - 30 && x <= b.x + b.width + 30 && y >= b.y - 30 && y <= b.y + b.height + 30);
  for (const a of snap.items.filter(i => i.type === 'arrow')) { const f = hit(a.x1, a.y1), t = hit(a.x2, a.y2); if (f && t && f !== t) edges.push({ id: a.id, fromNode: f.id, toNode: t.id, toEnd: 'arrow' }); }
  return { nodes, edges };
}
module.exports = { toCanvas, actions: {
  async export(a, nyx) { const s = await nyx.board.snapshot(); const p = await nyx.saveFile((s.board || 'nyx').replace(/[\\/:*?"<>|]/g, '_') + '.canvas', JSON.stringify(toCanvas(s), null, 1)); return p ? 'Αποθηκεύτηκε: ' + p : 'Ακυρώθηκε'; },
  async import(a, nyx) { const f = await nyx.openFile([{ name: 'JSON Canvas', extensions: ['canvas', 'json'] }]); if (!f) return 'Ακυρώθηκε'; const r = await nyx.board.importJson(f.text); return `Νέος πίνακας: ${r.nodes} κάρτες, ${r.edges} βέλη`; },
} };
''')

# ---------------- markdown export ----------------
add('markdown-export', dict(name='Markdown export', icon='file-text', category='Εισαγωγή/Εξαγωγή', permissions=['board','files'],
  description='Εξάγει τον πίνακα σε Markdown: ένα αρχείο ή φάκελο με ένα .md ανά κάρτα (με front-matter, tags) — έτοιμο για Obsidian/Logseq.',
  actions=[dict(id='one',label='Ένα αρχείο .md',icon='file-down'),dict(id='folder',label='Φάκελος (.md ανά κάρτα)',icon='folder-down')]),
r'''
const safe = (s) => String(s || 'κάρτα').replace(/[\\/:*?"<>|#\n\r]/g, ' ').trim().slice(0, 60) || 'κάρτα';
const body = (i) => (i.type === 'link' || i.type === 'web') && i.url ? `[${i.title || i.url}](${i.url})` : (i.text || i.title || '');
module.exports = { actions: {
  async one(a, nyx) { const s = await nyx.board.snapshot(); const its = s.items.filter(i => !['arrow', 'line', 'frame'].includes(i.type)).sort((a, b) => a.y - b.y || a.x - b.x);
    const md = `# ${s.board}\n\n` + its.map(i => `## ${safe(i.title)}\n\n${body(i)}${i.tags.length ? '\n\n' + i.tags.map(t => '#' + t).join(' ') : ''}`).join('\n\n---\n\n') + '\n';
    const p = await nyx.saveFile(safe(s.board) + '.md', md); return p ? 'Αποθηκεύτηκε ✓' : 'Ακυρώθηκε'; },
  async folder(a, nyx) { const s = await nyx.board.snapshot(); const used = {}; const files = s.items.filter(i => !['arrow', 'line', 'frame'].includes(i.type)).map(i => { let n = safe(i.title); if (used[n]) n += ' ' + (++used[n]); else used[n] = 1;
      return { name: n + '.md', content: `---\nnyx_id: ${i.id}\ntype: ${i.type}\ntags: [${i.tags.join(', ')}]\n---\n\n${body(i)}\n` }; });
    const d = await nyx.saveToFolder(files); return d ? files.length + ' αρχεία → ' + d : 'Ακυρώθηκε'; },
} };
''')

# ---------------- hermes ----------------
add('hermes', dict(name='Hermes Agent', icon='bot', category='AI', permissions=['net'], verified=False,
  description='Στέλνει εργασίες στο Hermes Agent (Nous Research) μέσω του OpenAI-συμβατού API του, και φέρνει την απάντηση ως κάρτα.',
  long='Ενεργοποίησε το API server του Hermes (π.χ. `API_SERVER_ENABLED=true`, θύρα 8642) και βάλε τη διεύθυνση εδώ. **Μη επαληθευμένο**: δεν δοκιμάστηκε με πραγματικό Hermes — αν το endpoint διαφέρει, άλλαξε το URL.',
  homepage='https://github.com/NousResearch/hermes-agent',
  config=[dict(key='url',label='Base URL',type='text',default='http://127.0.0.1:8642/v1'),dict(key='key',label='API key (αν χρειάζεται)',type='password'),dict(key='model',label='Model',type='text',default='hermes-agent')],
  actions=[dict(id='ask',label='Ρώτα τον Hermes',icon='send',args=[dict(key='prompt',label='Εργασία',type='textarea')]),dict(id='ping',label='Έλεγχος',icon='plug')]),
r'''
async function call(nyx, prompt) {
  const base = String(nyx.config.url || '').replace(/\/$/, ''); const H = { 'Content-Type': 'application/json' }; if (nyx.config.key) H.Authorization = 'Bearer ' + nyx.config.key;
  const r = await nyx.fetch(base + '/chat/completions', { method: 'POST', headers: H, body: JSON.stringify({ model: nyx.config.model || 'hermes-agent', messages: [{ role: 'user', content: prompt }], stream: false }) });
  if (!r.ok) throw new Error('Hermes HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200)); const j = await r.json(); return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : JSON.stringify(j).slice(0, 2000);
}
module.exports = { actions: {
  async ask(a, nyx) { const t = await call(nyx, String(a.prompt || '')); return { card: { kind: 'text', text: '**Hermes:** ' + t, tags: ['hermes'] } }; },
  async ping(a, nyx) { const base = String(nyx.config.url || '').replace(/\/$/, ''); const r = await nyx.fetch(base + '/models'); return 'HTTP ' + r.status; },
} };
''')

# ---------------- mcp server ----------------
add('mcp-server', dict(name='Nyx MCP server', icon='server', category='AI', permissions=['server','board'],
  description='Εκθέτει τον καμβά ως MCP server (HTTP, μόνο 127.0.0.1, με token) για LM Studio, Claude Desktop, Cursor κ.λπ.: αναζήτηση, ανάγνωση, δημιουργία καρτών.',
  long='Μετά την ενεργοποίηση πάτα «Ρυθμίσεις σύνδεσης» για να πάρεις το JSON για `mcp.json` (LM Studio → Program → Install → Edit mcp.json). Κάθε αίτημα χωρίς σωστό `Authorization: Bearer <token>` απορρίπτεται, όπως και αιτήματα από ιστοσελίδες (Origin).',
  config=[dict(key='port',label='Θύρα',type='number',default=7801),dict(key='write',label='Επέτρεψε δημιουργία καρτών',type='checkbox',default=True)],
  actions=[dict(id='info',label='Ρυθμίσεις σύνδεσης',icon='plug'),dict(id='rotate',label='Νέο token',icon='key-round')]),
r'''
const TOOLS = [
  { name: 'search_cards', description: 'Search Nyx canvas cards (text, tags, captions, transcripts).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, all_boards: { type: 'boolean' } }, required: ['query'] } },
  { name: 'read_cards', description: 'Read full text of cards by ids or query.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, query: { type: 'string' } } } },
  { name: 'board_snapshot', description: 'List all cards on the active board with positions.', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_card', description: 'Create a card. kind: note|text|checklist|heading|link|reminder|code.', inputSchema: { type: 'object', properties: { kind: { type: 'string' }, text: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' }, date: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['kind'] } },
];
let token = '';
const rpc = (id, result) => ({ status: 200, body: { jsonrpc: '2.0', id, result } });
const rerr = (id, code, message, status) => ({ status: status || 200, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } });
async function handle(req, nyx) {
  const origin = req.headers.origin; if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return rerr(null, -32001, 'Forbidden origin', 403);
  if ((req.headers.authorization || '') !== 'Bearer ' + token) return rerr(null, -32001, 'Unauthorized', 401);
  if (!/^\/mcp\/?(\?.*)?$/.test(req.url)) return { status: 404, body: { error: 'use /mcp' } };
  if (req.method === 'GET') return { status: 405, body: { error: 'SSE not supported; use POST' } };
  let m; try { m = JSON.parse(req.body || '{}'); } catch (e) { return rerr(null, -32700, 'Parse error', 400); }
  if (Array.isArray(m)) return rerr(null, -32600, 'Batch not supported', 400);
  if (m.id === undefined) return { status: 202, body: '' };
  if (m.method === 'initialize') return rpc(m.id, { protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'nyx-canvas', version: '2.0.0' } });
  if (m.method === 'ping') return rpc(m.id, {});
  if (m.method === 'tools/list') return rpc(m.id, { tools: TOOLS.filter(t => t.name !== 'create_card' || nyx.config.write) });
  if (m.method === 'tools/call') {
    const n = m.params && m.params.name, a = (m.params && m.params.arguments) || {}; let r;
    try {
      if (n === 'search_cards') r = await nyx.board.search({ all_boards: true, ...a }); else if (n === 'read_cards') r = await nyx.board.read(a); else if (n === 'board_snapshot') r = await nyx.board.snapshot();
      else if (n === 'create_card' && nyx.config.write) r = await nyx.board.addCard(a); else return rerr(m.id, -32602, 'Unknown tool ' + n);
      nyx.log('tool', n); return rpc(m.id, { content: [{ type: 'text', text: JSON.stringify(r) }] });
    } catch (e) { return rpc(m.id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true }); }
  }
  return rerr(m.id, -32601, 'Method not found');
}
module.exports = {
  activate(nyx) { token = nyx.secret.get('token'); if (!token) { token = nyx.randomId(24); nyx.secret.set('token', token); } nyx.serve(+nyx.config.port || 7801, (req) => handle(req, nyx)); },
  actions: {
    async info(a, nyx) { const url = 'http://127.0.0.1:' + (+nyx.config.port || 7801) + '/mcp'; return { card: { kind: 'code', text: JSON.stringify({ mcpServers: { nyx: { url, headers: { Authorization: 'Bearer ' + token } } } }, null, 2), tags: ['mcp'] } }; },
    async rotate(a, nyx) { token = nyx.randomId(24); nyx.secret.set('token', token); return 'Νέο token ✓ (ενημέρωσε το mcp.json)'; },
  },
};
''')

# ---------------- hyperframes ----------------
add('hyperframes-mp4', dict(name='Canvas → MP4 (HyperFrames)', icon='clapperboard', category='Βίντεο', permissions=['board','files','exec'], verified=False,
  requires=dict(text='Node.js 22+, FFmpeg και HyperFrames CLI (`npx hyperframes`, HeyGen, Apache-2.0).', url='https://github.com/heygen-com/hyperframes'),
  homepage='https://github.com/heygen-com/hyperframes', license='Apache-2.0',
  description='Μετατρέπει τον πίνακα σε σενάριο βίντεο (storyboard + κείμενα + εικόνες) μέσα σε project HyperFrames και κάνει render σε MP4 τοπικά.',
  long='Ροή: **Νέο project** → διαλέγεις φάκελο, το Nyx γράφει `NYX-STORYBOARD.md` (σκηνές από τις κάρτες) και τρέχει `npx hyperframes init`. Μετά άνοιξε τον φάκελο στο Cursor/Claude Code και πες «Using /hyperframes, make the video from NYX-STORYBOARD.md». **Render** τρέχει `npx hyperframes render` στον φάκελο.\n\n⚠️ Μη επαληθευμένο: δεν δοκιμάστηκε με πραγματικό HyperFrames σε Windows. Χρειάζεται άδεια εκτέλεσης εντολών.',
  config=[dict(key='dir',label='Φάκελος project (συμπληρώνεται αυτόματα)',type='text'),dict(key='secs',label='Δευτερόλεπτα ανά σκηνή',type='number',default=3)],
  actions=[dict(id='project',label='Νέο project από τον πίνακα',icon='folder-plus'),dict(id='preview',label='Preview',icon='eye'),dict(id='render',label='Render MP4',icon='film')]),
r'''
function storyboard(s, secs) {
  const its = s.items.filter(i => !['arrow', 'line', 'ink'].includes(i.type)).sort((a, b) => a.y - b.y || a.x - b.x);
  let t = 0; const sc = its.map((i, n) => { const st = t; t += secs; return `## Σκηνή ${n + 1} · ${st}s–${t}s · ${i.type}\n\n**${i.title || ''}**\n\n${(i.text || '').slice(0, 600)}${i.src ? '\n\nΑρχείο μέσων: `' + i.src + '`' : ''}${i.url ? '\n\nURL: ' + i.url : ''}`; });
  return `# ${s.board} — storyboard από Nyx Canvas\n\nΣυνολική διάρκεια ≈ ${t}s, 1080×1920 (short) εκτός αν ζητηθεί αλλιώς.\nΚάθε σκηνή = μία κάρτα του καμβά, με τη σειρά που φαίνονται (πάνω→κάτω).\n\n` + sc.join('\n\n---\n\n') + '\n';
}
const q = (p) => '"' + String(p).replace(/"/g, '') + '"';
module.exports = { storyboard, actions: {
  async project(a, nyx) {
    const s = await nyx.board.snapshot(); const d = await nyx.saveToFolder([{ name: 'NYX-STORYBOARD.md', content: storyboard(s, +nyx.config.secs || 3) }]); if (!d) return 'Ακυρώθηκε';
    const proj = d + (nyx.platform === 'win32' ? '\\' : '/') + 'nyx-video'; nyx.storage.set('dir', proj);
    let out = ''; try { out = await nyx.exec('npx -y hyperframes init nyx-video', { cwd: d, timeout: 900000 }); } catch (e) { out = '⚠️ ' + e.message; }
    nyx.log(String(out).slice(-1500)); return { card: { kind: 'text', text: `🎬 Project: ${proj}\n\nΆνοιξε τον φάκελο στο Cursor/Claude Code και ζήτα: «Using /hyperframes, make the video from ../NYX-STORYBOARD.md». Μετά πάτα Render.\n\n${String(out).slice(-400)}`, tags: ['hyperframes'] } };
  },
  async preview(a, nyx) { const d = nyx.config.dir || nyx.storage.get('dir'); if (!d) throw new Error('Συμπλήρωσε τον φάκελο project στις ρυθμίσεις'); nyx.exec('npx hyperframes preview', { cwd: d }).catch(e => nyx.log(e.message)); return 'Ξεκίνησε το preview'; },
  async render(a, nyx) { const d = nyx.config.dir || nyx.storage.get('dir'); if (!d) throw new Error('Συμπλήρωσε τον φάκελο project στις ρυθμίσεις'); const out = await nyx.exec('npx hyperframes render', { cwd: d, timeout: 1800000 }); nyx.log(String(out).slice(-2000)); return 'Render ✓ — δες τον φάκελο ' + d; },
} };
''')

# ---------------- webhooks ----------------
add('webhooks', dict(name='Webhooks', icon='webhook', category='Αυτοματισμοί', permissions=['server','board','net'],
  description='Εισερχόμενα: POST σε http://127.0.0.1:7802/note με token → κάρτα (για iOS Shortcuts μέσω Tailscale, n8n, scripts). Εξερχόμενα: POST σε δικό σου URL όταν προστίθεται κάρτα.',
  long='`curl -H "Authorization: Bearer TOKEN" -d "{\\"text\\":\\"γεια\\"}" http://127.0.0.1:7802/note`',
  config=[dict(key='port',label='Θύρα',type='number',default=7802),dict(key='out',label='Εξερχόμενο URL (προαιρετικό)',type='text')],
  actions=[dict(id='info',label='Token & παράδειγμα',icon='key-round')]),
r'''
let token = '';
module.exports = {
  activate(nyx) {
    token = nyx.secret.get('token'); if (!token) { token = nyx.randomId(20); nyx.secret.set('token', token); }
    nyx.serve(+nyx.config.port || 7802, async (req) => {
      if (req.headers.origin) return { status: 403, body: { error: 'forbidden' } };
      if ((req.headers.authorization || '') !== 'Bearer ' + token) return { status: 401, body: { error: 'unauthorized' } };
      if (req.method !== 'POST') return { status: 405, body: { error: 'POST only' } };
      let b = {}; try { b = JSON.parse(req.body || '{}'); } catch (e) { b = { text: req.body }; }
      if (/^\/note/.test(req.url)) { const r = await nyx.board.addCard({ kind: b.kind || (b.url ? 'link' : 'note'), text: String(b.text || ''), url: b.url, tags: ['webhook', ...(b.tags || [])] }); return { body: r }; }
      return { status: 404, body: { error: 'use /note' } };
    });
    nyx.on('card', async (c) => { const u = nyx.config.out; if (!u || !/^https?:/.test(u)) return; try { await nyx.fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'card', card: c }) }); } catch (e) { nyx.log('out', e.message); } });
  },
  actions: { async info(a, nyx) { return { card: { kind: 'code', text: `curl -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d "{\\"text\\":\\"Γεια από webhook\\"}" http://127.0.0.1:${+nyx.config.port || 7802}/note`, tags: ['webhook'] } }; } },
};
''')

# ---------------- status pill ----------------
add('status-pill', dict(name='Status pill / Focus', icon='pill', category='Widgets', permissions=['widget','notify'],
  description='Βάζει δικό σου status με αντίστροφη μέτρηση στο «νησάκι» του widget (π.χ. «Deep work · έως 11:30»), με ειδοποίηση στο τέλος.',
  actions=[dict(id='set',label='Νέο status',icon='play',args=[dict(key='text',label='Κείμενο',default='🎯 Deep work'),dict(key='min',label='Λεπτά',type='number',default=50)]),dict(id='clear',label='Καθάρισμα',icon='x')]),
r'''
let tm = null;
module.exports = {
  deactivate(nyx) { clearTimeout(tm); },
  actions: {
    async set(a, nyx) { clearTimeout(tm); const min = Math.max(1, +a.min || 25); const end = new Date(Date.now() + min * 60e3); const t = String(a.text || 'Focus').slice(0, 40);
      nyx.setShared('focus', t + ' · έως ' + end.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }));
      tm = setTimeout(() => { nyx.setShared('focus', null); nyx.notify('Τέλος: ' + t, min + ' λεπτά ✓'); }, min * 60e3); return 'Status στο widget ✓'; },
    async clear(a, nyx) { clearTimeout(tm); nyx.setShared('focus', null); return 'OK'; },
  },
};
''')

# ---------------- pomodoro (renderer card) ----------------
add('pomodoro', dict(name='Pomodoro', icon='timer', category='Παραγωγικότητα', permissions=[], rendererCard='pomodoro',
  description='Κάρτα Pomodoro (25/5) πάνω στον καμβά, με μέτρηση στο pill του widget και ειδοποίηση.',
  cards=[dict(type='pomodoro',name='Pomodoro',w=240,h=220)]), None)

# ---------------- translate (local LLM via assistant) ----------------
add('quick-translate', dict(name='Μετάφραση με AI', icon='languages', category='AI', permissions=['assistant'],
  description='Μεταφράζει κείμενο (ή επιλεγμένες κάρτες) σε όποια γλώσσα θες με το δικό σου μοντέλο (LM Studio/cloud) και το βάζει σε νέα κάρτα.',
  actions=[dict(id='tr',label='Μετάφραση',icon='languages',args=[dict(key='text',label='Κείμενο (κενό = επιλεγμένες κάρτες)',type='textarea'),dict(key='lang',label='Σε',default='Αγγλικά')])]),
r'''
module.exports = { actions: { async tr(a, nyx) { const src = String(a.text || '').trim(); const r = await nyx.assistant(src ? `Μετάφρασε σε ${a.lang || 'Αγγλικά'} το παρακάτω και φτιάξε κάρτα κειμένου με τη μετάφραση:\n\n${src}` : `Διάβασε τις επιλεγμένες κάρτες και φτιάξε νέα κάρτα κειμένου με τη μετάφρασή τους σε ${a.lang || 'Αγγλικά'}.`); return (r && r.content || '✓').slice(0, 200); } } };
''')

if __name__ == '__main__':
    import sys
    base = sys.argv[1]
    for id, (m, js) in P.items():
        d = os.path.join(base, id); os.makedirs(d, exist_ok=True)
        json.dump(m, open(os.path.join(d, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)
        if js: open(os.path.join(d, 'plugin.js'), 'w').write(js.lstrip())
    print(len(P), 'plugins')
