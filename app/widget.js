'use strict';
// v2.3 mini-dashboard widget: quick note / voice memo for any day, pinned cards, upcoming reminders · countdowns · episodes,
// a clickable calendar whose days open a day panel (events + agenda notes), subscriptions. Writes go to the main window via API.agenda().
let ST = null, base = '';
const W = {
  mo: 0, sel: null, flash: null, rec: null,
  today() { return ymd(Date.now()); },
  async init() {
    const r = await API.load(); base = r.mediaBase; this.sel = this.today(); this.set(r.text);
    hydrateIcons();
    API.onState((text) => this.set(text));
    API.onReminder((p) => { this.flash = p.id; this.render(); setTimeout(() => { this.flash = null; this.render(); }, 8000); });
    API.onClickThrough((on) => { document.body.classList.toggle('ghost', on); $('#w-ghost').classList.toggle('on', on); });
    $('#w-close').onclick = () => API.closeWidget();
    $('#w-open').onclick = () => API.showMain();
    $('#w-ghost').onclick = () => API.widgetClickThrough(true);
    $('#w-top').onclick = async () => { this.onTop = !this.onTop; await API.widgetOnTop(this.onTop); $('#w-top').classList.toggle('on', this.onTop); };
    const q = $('#w-q');
    const send = () => { const v = q.value.trim(); if (!v) return; API.agenda({ op: 'add', day: this.sel, text: v }); q.value = ''; this.flashNote('✓ ' + fmtDay(this.sel)); };
    q.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    $('#w-send').onclick = send; $('#w-mic').onclick = () => this.voice();
    $('#w-day').onclick = () => { this.sel = this.today(); this.mo = 0; this.render(); };
    $('#w-cprev').onclick = () => { this.mo--; this.cal(); }; $('#w-cnext').onclick = () => { this.mo++; this.cal(); };
    $('#w-ctoday').onclick = () => { this.mo = 0; this.sel = this.today(); this.render(); };
    setInterval(() => this.tick(), 1000); this.tick();
    window.__wReady = true;
  },
  flashNote(msg) { const q = $('#w-q'); q.placeholder = msg; clearTimeout(this._ph); this._ph = setTimeout(() => this.dayChip(), 1800); },
  set(text) {
    try { ST = JSON.parse(text); } catch (e) { return; }
    const S = ST.settings || {}; window.LANG = S.lang || 'el';
    Theme.apply({ ...S }); document.documentElement.style.setProperty('--wop', S.widget?.opacity ?? .94);
    this.onTop = S.widget?.onTop !== false; $('#w-top').classList.toggle('on', this.onTop);
    this.render();
  },
  // every dated thing, keyed by YYYY-MM-DD → [{emo,t,at?,id?,kind}]
  events() {
    const ev = {}; const add = (when, x) => { const d = parseDay(when); if (isNaN(d)) return; (ev[ymd(d)] ||= []).push({ ...x, at: +d }); };
    for (const b of ST.boards || []) for (const it of b.items || []) {
      if (it.reminder?.on && it.reminder.at) add(it.reminder.at, { id: it.id, emo: '⏰', t: (it.reminder.msg || plainText(it.html || '') || it.title || '').slice(0, 60) });
      if (it.type === 'countdown' && it.target) add(it.target, { id: it.id, emo: it.emoji || '⏳', t: it.title || '' });
      if (it.type === 'show' && it.next?.airstamp) add(it.next.airstamp, { id: it.id, emo: '📺', t: it.title });
    }
    for (const s of ST.subs || []) if (s.active !== false && s.next) add(s.next, { emo: s.icon || '💳', t: s.name + (s.price ? ` · ${(+s.price).toFixed(2)} €` : ''), sub: true });
    return ev;
  },
  upcoming() {
    const out = []; const now = Date.now();
    for (const b of ST.boards || []) for (const it of b.items || []) {
      const title = it.reminder?.msg || it.title || plainText(it.html || '') || it.type;
      if (it.type === 'countdown' && it.target) out.push({ id: it.id, at: +new Date(it.target), emo: it.emoji || '⏳', t: it.title, s: b.name, c: it.color });
      else if (it.type === 'show' && (it.next?.airstamp || it.target)) { const at = +new Date(it.next?.airstamp || it.target); out.push({ id: it.id, at, emo: it.kind === 'movie' ? '🎬' : '📺', t: it.title, s: it.next ? `S${pad(it.next.season)}E${pad(it.next.number)}` : b.name }); }
      else if (it.reminder?.on && it.reminder.at) out.push({ id: it.id, at: +new Date(it.reminder.at), emo: '⏰', t: title.slice(0, 80), s: b.name + (it.reminder.repeat && it.reminder.repeat !== 'none' ? ' · ↻' : '') });
    }
    return out.filter(x => x.at > now - 3600e3).sort((a, b) => a.at - b.at).slice(0, 6);
  },
  when(at) { const d = new Date(at); return fmtDay(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); },
  render() {
    if (!ST) return;
    // pinned first: this is what «Καρφίτσωμα στο widget» is for // i18n-ignore
    const P = $('#w-pins'); P.innerHTML = ''; let n = 0;
    for (const b of ST.boards || []) for (const it of b.items || []) if (it.pinned && n++ < 12) {
      const go = () => API.showMain(it.id);
      if (it.type === 'image' && (it.thumb || it.file)) P.append(h('div', { class: 'w-pin img', title: b.name, onclick: go }, h('img', { src: base + encodeURIComponent(it.thumb || it.file) })));
      else P.append(h('div', { class: 'w-pin ' + (it.type === 'sticky' ? 'sticky' : ''), title: b.name, style: it.type === 'sticky' ? { background: it.paper || '#ffe66d' } : {}, onclick: go }, (it.char || '') + (plainText(it.html || '') || it.title || it.name || it.text || it.type)));
    }
    if (!n) P.innerHTML = `<div class="w-empty" style="grid-column:1/-1">${esc(t('widget.005'))}</div>`;
    const up = this.upcoming(); const U = $('#w-up'); U.innerHTML = '';
    if (!up.length) U.innerHTML = `<div class="w-empty">${esc(t('widget.003'))}</div>`;
    for (const x of up) U.append(h('div', { class: 'w-row' + (this.flash === x.id ? ' now' : ''), style: x.c ? { '--rc': x.c } : {}, onclick: () => API.showMain(x.id) }, h('span', { class: 'w-emo' }, x.emo), h('div', { class: 'w-main' }, h('div', { class: 'w-t' }, x.t || '—'), h('div', { class: 'w-s' }, this.when(x.at) + ' · ' + x.s)), h('span', { class: 'w-cd', 'data-at': x.at })));
    const subs = (ST.subs || []).filter(s => s.active !== false); const S = $('#w-subs'); S.innerHTML = '';
    const fac = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }; const tot = subs.reduce((a, s) => a + (+s.price || 0) * (fac[s.cycle] || 1), 0);
    $('#w-subtotal').textContent = subs.length ? tot.toFixed(2) + ' €/' + t('widget.004') : '';
    subs.filter(s => s.next).sort((a, b) => a.next.localeCompare(b.next)).slice(0, 4).forEach(s => S.append(h('div', { class: 'w-row', style: { '--rc': s.color || '#888' }, onclick: () => API.showMain() }, h('span', { class: 'w-emo' }, s.icon || '💳'), h('div', { class: 'w-main' }, h('div', { class: 'w-t' }, s.name), h('div', { class: 'w-s' }, fmtDM(s.next) + ' · ' + relDays(s.next))), h('span', { class: 'w-cd' }, (+s.price || 0).toFixed(2) + ' €'))));
    if (!subs.length) S.innerHTML = `<div class="w-empty">—</div>`;
    this.pill(); this.cal(); this.dayChip(); this.tick();
  },
  dayChip() { const isT = this.sel === this.today(); const b = $('#w-day'); b.textContent = isT ? '📅 ' + t('v23.today') : '📅 ' + fmtDM(this.sel); b.classList.toggle('other', !isT); $('#w-q').placeholder = t('v23.w_note_ph') + (isT ? '' : ' · ' + fmtDay(this.sel)); },
  pill() {
    const sh = ST.shared || {}; const now = Date.now(); const P = $('#w-pill');
    const xs = Object.entries(sh).filter(([k, v]) => v && v.v != null && now - (v.at || 0) < 6 * 3600e3).slice(0, 6);
    P.hidden = !xs.length; P.innerHTML = '';
    for (const [k, v] of xs) P.append(h('span', { class: 'w-pchip', title: k + (v.by ? ' · ' + v.by : '') }, String(v.v).slice(0, 48)));
  },
  cal() {
    const d0 = new Date(); const m = new Date(d0.getFullYear(), d0.getMonth() + this.mo, 1); const C = $('#w-cal'); C.innerHTML = '';
    $('#w-month').textContent = m.toLocaleDateString(LANG === 'el' ? 'el-GR' : 'en-GB', { month: 'long', year: 'numeric' });
    const ev = this.events(); const ag = {}; for (const a of ST.agenda || []) (ag[a.day] ||= []).push(a);
    [t('widget.006'), t('widget.007'), t('widget.007'), t('widget.008'), t('widget.008'), t('widget.009'), t('widget.010')].forEach(x => C.append(h('b', {}, x)));
    const off = (m.getDay() + 6) % 7; for (let i = 0; i < off; i++) C.append(h('span', {}));
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate(); const today = this.today();
    for (let i = 1; i <= days; i++) {
      const k = ymd(new Date(m.getFullYear(), m.getMonth(), i)); const e = ev[k] || [], a = ag[k] || [];
      C.append(h('button', { class: 'd' + (k === today ? ' today' : '') + (k === this.sel ? ' sel' : '') + (e.length ? ' has' : '') + (a.length ? ' note' : ''), 'data-day': k, title: [...e.map(x => x.emo + ' ' + x.t), ...a.map(x => '📝 ' + (x.text || '🎙️'))].join('\n'), onclick: () => { this.sel = k; this.cal(); this.dayChip(); $('#w-q').focus(); } }, String(i)));
    }
    this.dayPanel(ev[this.sel] || [], (ag[this.sel] || []).sort((x, y) => x.at - y.at));
  },
  dayPanel(ev, ag) {
    const D = $('#w-dayp'); D.innerHTML = '';
    D.append(h('div', { class: 'w-dayh' }, h('b', {}, fmtDay(this.sel)), h('span', {}, relDays(this.sel))));
    for (const x of ev.sort((a, b) => a.at - b.at)) D.append(h('div', { class: 'w-ev', onclick: () => x.id ? API.showMain(x.id) : API.showMain() }, h('span', {}, x.emo), h('span', { class: 'w-t' }, x.t), x.sub ? null : h('i', {}, pad(new Date(x.at).getHours()) + ':' + pad(new Date(x.at).getMinutes()))));
    for (const a of ag) D.append(h('div', { class: 'w-ag' + (a.done ? ' done' : ''), 'data-id': a.id },
      h('input', { type: 'checkbox', checked: a.done ? true : null, onchange: () => API.agenda({ op: 'toggle', id: a.id }) }),
      h('div', { class: 'w-agt' }, a.text || '🎙️ ' + t('voice_memo'), a.file ? h('audio', { src: base + encodeURIComponent(a.file), controls: '', preload: 'none' }) : null),
      h('button', { class: 'w-agb', title: t('v23.ag_to_canvas'), html: iconSvg('square-arrow-out-up-right', 13), onclick: () => API.agenda({ op: 'canvas', id: a.id }) }),
      h('button', { class: 'w-agb', title: t('del'), html: iconSvg('x', 13), onclick: () => API.agenda({ op: 'del', id: a.id }) })));
    if (!ev.length && !ag.length) D.append(h('div', { class: 'w-empty' }, t('v23.w_day_empty')));
  },
  // voice memo → saved to media, attached to the selected day (main window transcribes it if STT is set up)
  async voice() {
    const b = $('#w-mic');
    if (this.rec) { this.rec.stop(); return; }
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { this.flashNote('🎙️ ' + t('mic_err')); return; }
    const chunks = []; const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {}); this.rec = rec; const t0 = Date.now(); const day = this.sel;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      clearInterval(this._rt); stream.getTracks().forEach(x => x.stop()); this.rec = null; b.classList.remove('rec'); b.innerHTML = iconSvg('mic', 15);
      if (!chunks.length) return; const dur = Math.round((Date.now() - t0) / 1000); const d = new Date();
      const name = `voice-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.webm`;
      const r = await API.importBuffer(name, new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer()));
      await API.agenda({ op: 'add', day, text: '', file: r.file, dur }); this.flashNote('🎙️ ✓ ' + fmtDay(day));
    };
    rec.start(250); b.classList.add('rec');
    const tick = () => { const s = Math.floor((Date.now() - t0) / 1000); b.textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`; }; tick(); this._rt = setInterval(tick, 500);
  },
  tick() {
    const d = new Date(); $('#w-clock').textContent = d.toLocaleTimeString(LANG === 'el' ? 'el-GR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
    if (this._day !== this.today()) { const was = this._day; this._day = this.today(); if (was && this.sel === was) { this.sel = this._day; this.render(); } }
    document.querySelectorAll('.w-cd[data-at]').forEach(e => { const c = fmtCountdown(+e.dataset.at - Date.now()); e.textContent = c ? c.text : t('widget.011'); });
  }
};
document.addEventListener('DOMContentLoaded', () => W.init().catch(e => console.error(e)));
