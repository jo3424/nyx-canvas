'use strict';
// v2.6.9 — dates and amounts are computed by Nyx code, never by the model.
// The model passes the phrase («σε 45 μέρες», «Τρίτη 17/11», «μοίρασε 1640€ σε 3») and Nyx does the arithmetic:
// calendar math on the Europe/Athens wall date (no DST drift), exact cents (largest-remainder split, sum always matches).
// Nothing is guessed silently: an unknown phrase returns ok:false with the reason, a wrong weekday or an assumed year is
// reported in notes. Pure functions only: the renderer uses window.NyxCalc, the unit tests require() this file.
(function (root) {
  const TZ = 'Europe/Athens';
  const WD_EL = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
  const WD_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // normalised (no accents, final sigma → σ) stems → weekday index
  const WD_STEM = [[/^κυριακ/, 0], [/^δευτερ/, 1], [/^τριτ/, 2], [/^τεταρτ/, 3], [/^πεμπτ/, 4], [/^παρασκευ/, 5], [/^σαββατ/, 6],
    [/^sun/, 0], [/^mon/, 1], [/^tue/, 2], [/^wed/, 3], [/^thu/, 4], [/^fri/, 5], [/^sat/, 6]];
  const MONTH_STEM = [[/^ιαν/, 1], [/^φεβ/, 2], [/^μαρ/, 3], [/^απρ/, 4], [/^μαι|^μαη/, 5], [/^ιουν/, 6], [/^ιουλ/, 7], [/^αυγ/, 8], [/^σεπ/, 9], [/^οκτ/, 10], [/^νοε/, 11], [/^δεκ/, 12],
    [/^jan/, 1], [/^feb/, 2], [/^mar/, 3], [/^apr/, 4], [/^may/, 5], [/^jun/, 6], [/^jul/, 7], [/^aug/, 8], [/^sep/, 9], [/^oct/, 10], [/^nov/, 11], [/^dec/, 12]];
  const NUM_WORD = { ενα: 1, ενασ: 1, μια: 1, μιαν: 1, δυο: 2, τρεισ: 3, τρια: 3, τεσσερισ: 4, τεσσερα: 4, πεντε: 5, εξι: 6, επτα: 7, εφτα: 7, οκτω: 8, οχτω: 8, εννια: 9, εννεα: 9, δεκα: 10, εντεκα: 11, δωδεκα: 12, δεκαπεντε: 15, εικοσι: 20, τριαντα: 30, σαραντα: 40, πενηντα: 50, εξηντα: 60, ενενηντα: 90, εκατο: 100,
    one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30 };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ς/g, 'σ').replace(/\s+/g, ' ').trim();
  const pad = (n) => String(n).padStart(2, '0');

  // ---- calendar helpers (pure Y-M-D math in UTC so a DST change never moves a date) ----
  function wallNow(now, tz) {
    const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    const g = (k) => +((parts.find((p) => p.type === k) || {}).value || 0);
    return { y: g('year'), m: g('month'), d: g('day'), hh: g('hour') % 24, mm: g('minute') };
  }
  const ymd = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const fromUTC = (dt) => ({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
  function addDays(c, n) { const dt = ymd(c.y, c.m, c.d); dt.setUTCDate(dt.getUTCDate() + n); return fromUTC(dt); }
  function addMonths(c, n) {
    const tot = c.y * 12 + (c.m - 1) + n; const y = Math.floor(tot / 12), m = tot % 12 + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { y, m, d: Math.min(c.d, last), clampedFrom: c.d > last ? c.d : null };
  }
  const weekday = (c) => ymd(c.y, c.m, c.d).getUTCDay();
  const dayDiff = (a, b) => Math.round((ymd(b.y, b.m, b.d) - ymd(a.y, a.m, a.d)) / 864e5);
  const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  // wall time in tz → real instant (two passes handle the DST offset)
  function zonedInstant(c, hh, mm, tz) {
    let guess = Date.UTC(c.y, c.m - 1, c.d, hh, mm);
    for (let i = 0; i < 2; i++) {
      const w = wallNow(new Date(guess), tz);
      const diff = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm) - Date.UTC(c.y, c.m - 1, c.d, hh, mm);
      guess -= diff;
    }
    return new Date(guess);
  }
  function numOf(tok) { if (tok == null) return null; if (/^\d+([.,]\d+)?$/.test(tok)) return +String(tok).replace(',', '.'); const w = NUM_WORD[tok]; return w != null ? w : null; }
  function unitOf(u) {
    u = String(u || '');
    if (/^(μερ|ημερ|day|d$)/.test(u)) return 'day';
    if (/^(εβδομαδ|βδομαδ|week|w$)/.test(u)) return 'week';
    if (/^(μην|month)/.test(u)) return 'month';
    if (/^(χρον|ετ|year|y$)/.test(u)) return 'year';
    if (/^(ωρ|hour|h$)/.test(u)) return 'hour';
    if (/^(λεπτ|min)/.test(u)) return 'minute';
    return null;
  }

  // ---- date phrases ----
  function resolveDate(expr, opts) {
    opts = opts || {};
    const tz = opts.tz || TZ;
    const nowW = wallNow(opts.now, tz);
    let base = { y: nowW.y, m: nowW.m, d: nowW.d };
    if (opts.base && /^\d{4}-\d{2}-\d{2}/.test(String(opts.base))) { const [y, m, d] = String(opts.base).slice(0, 10).split('-').map(Number); if (validDate(y, m, d)) base = { y, m, d }; }
    const today = { y: nowW.y, m: nowW.m, d: nowW.d };
    const input = String(expr == null ? '' : expr);
    const n = norm(input);
    const notes = [];
    if (!n) return { ok: false, input, error: 'empty' };
    let day = null, time = null, wantWd = null, relHours = null;

    // ISO first (model may still send one)
    let m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (m) {
      if (!validDate(+m[1], +m[2], +m[3])) return { ok: false, input, error: 'invalid_date' };
      day = { y: +m[1], m: +m[2], d: +m[3] }; if (m[4] != null) time = { hh: +m[4], mm: +m[5] };
    }
    // relative: «σε 45 μέρες», «μετά από 2 εβδομάδες», «in 3 months», «45 μέρες από σήμερα», «πριν 3 μέρες», «3 μέρες πριν»
    if (!day) {
      const R = /(?:^|\s)(σε|μετα απο|μετα|in|after|πριν απο|πριν)?\s*(\d+(?:[.,]\d+)?|[a-zα-ω]+)\s+(μερ\w*|ημερ\w*|εβδομαδ\w*|βδομαδ\w*|μην\w*|χρον\w*|ετ\w*|ωρ\w*|λεπτ\w*|days?|weeks?|months?|years?|hours?|min\w*)(\s+(?:πριν|νωριτερα|ago|before))?/;
      m = n.match(R);
      if (m && numOf(m[2]) != null && unitOf(m[3])) {
        const k = numOf(m[2]); const u = unitOf(m[3]);
        const sign = (/^πριν/.test(m[1] || '') || m[4]) ? -1 : 1;
        if (u === 'hour' || u === 'minute') {
          relHours = sign * k * (u === 'hour' ? 1 : 1 / 60);
        } else if (!Number.isInteger(k)) {
          return { ok: false, input, error: 'fractional_' + u };
        } else if (u === 'day') day = addDays(base, sign * k);
        else if (u === 'week') day = addDays(base, sign * k * 7);
        else { const r = addMonths(base, sign * k * (u === 'year' ? 12 : 1)); day = { y: r.y, m: r.m, d: r.d }; if (r.clampedFrom) notes.push('month_end:' + r.clampedFrom); }
      }
    }
    if (!day && relHours == null) {
      if (/(^|\s)μεθαυριο($|\s)|day after tomorrow/.test(n)) day = addDays(base, 2);
      else if (/(^|\s)αυριο($|\s)|tomorrow/.test(n)) day = addDays(base, 1);
      else if (/(^|\s)(σημερα|αποψε)($|\s)|today|tonight/.test(n)) day = { ...base };
      else if (/(^|\s)(χθεσ|εχθεσ)($|\s)|yesterday/.test(n)) day = addDays(base, -1);
    }
    // explicit day/month(/year): 17/11, 17-11-2026, 17.11.26, «17 Νοεμβρίου»
    let explicit = null;
    m = n.match(/(?:^|[^\d])(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?![\d:])/);
    if (m && !(m[0].includes('.') && !m[3] && /\d\.\d{1,2}$/.test(m[0]) && /στισ|at/.test(n))) explicit = { d: +m[1], m: +m[2], y: m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null };
    if (!explicit) {
      const mm2 = n.match(/(?:^|\s)(\d{1,2})\s+([a-zα-ω]{3,})(?:\s+(\d{4}))?/);
      if (mm2) { const mo = MONTH_STEM.find(([re]) => re.test(mm2[2])); if (mo) explicit = { d: +mm2[1], m: mo[1], y: mm2[3] ? +mm2[3] : null }; }
    }
    if (explicit && !day) {
      let y = explicit.y;
      if (y == null) {
        y = today.y;
        if (validDate(y, explicit.m, explicit.d) && dayDiff(today, { y, m: explicit.m, d: explicit.d }) < 0) { y += 1; notes.push('year_next'); }
        else notes.push('year_current');
      }
      if (!validDate(y, explicit.m, explicit.d)) return { ok: false, input, error: 'invalid_date' };
      day = { y, m: explicit.m, d: explicit.d };
    }
    // weekday: alone → next such day (after today); with an explicit date → checked, never silently trusted
    for (const w of n.split(/[\s,]+/)) { const hit = WD_STEM.find(([re]) => re.test(w)); if (hit && w.length >= 3) { wantWd = hit[1]; break; } }
    if (wantWd != null) {
      if (day) {
        const real = weekday(day);
        if (real !== wantWd) notes.push('weekday_mismatch:' + WD_EL[wantWd] + '→' + WD_EL[real]);
      } else {
        let k = (wantWd - weekday(base) + 7) % 7; if (k === 0) k = 7;
        if (/επομενη|αλλη|next/.test(n) && k < 7 && /(την|τη)?\s*(επομενη|αλλη)\s+εβδομαδα|next week/.test(n)) k += 7;
        day = addDays(base, k);
      }
    }
    // time: «στις 9», «στις 9:30», «9μμ», «at 17:00»
    if (!time) {
      m = n.match(/(?:στισ|at|ωρα)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(πμ|μμ|am|pm|το πρωι|το απογευμα|το βραδυ)?/) || n.match(/(?:^|\s)(\d{1,2})[:](\d{2})\s*(πμ|μμ|am|pm)?(?:$|\s)/) || n.match(/(?:^|\s)(\d{1,2})\s*(πμ|μμ|am|pm)(?:$|\s)/);
      if (m) {
        let hh = +m[1]; const mm = m[2] && /^\d+$/.test(m[2]) ? +m[2] : 0; const ap = (m[3] || (m[2] && !/^\d+$/.test(m[2]) ? m[2] : '')) || '';
        if (/μμ|pm|απογευμα|βραδυ/.test(ap) && hh < 12) hh += 12;
        if (/πμ|am|πρωι/.test(ap) && hh === 12) hh = 0;
        if (hh > 23 || mm > 59) return { ok: false, input, error: 'invalid_time' };
        time = { hh, mm };
      }
    }
    if (relHours != null) {
      const at = new Date((opts.now instanceof Date ? opts.now.getTime() : (opts.now != null ? +new Date(opts.now) : Date.now())) + relHours * 3600e3);
      const w = wallNow(at, tz);
      return finish({ y: w.y, m: w.m, d: w.d }, { hh: w.hh, mm: w.mm }, at);
    }
    if (!day && time) { day = { ...base }; const nowMin = nowW.hh * 60 + nowW.mm; if (time.hh * 60 + time.mm <= nowMin && !opts.base) { day = addDays(base, 1); notes.push('time_passed_next_day'); } }
    if (!day) return { ok: false, input, error: 'not_understood' };
    return finish(day, time, null);

    function finish(dd, tt, at) {
      const wd = weekday(dd);
      const inst = at || (tt ? zonedInstant(dd, tt.hh, tt.mm, tz) : null);
      return {
        ok: true, input,
        date: dd.y + '-' + pad(dd.m) + '-' + pad(dd.d),
        dmy: pad(dd.d) + '/' + pad(dd.m) + '/' + dd.y,
        weekday: wd, weekday_el: WD_EL[wd], weekday_en: WD_EN[wd],
        time: tt ? pad(tt.hh) + ':' + pad(tt.mm) : null,
        iso: inst ? inst.toISOString() : null,
        days_from_today: dayDiff(today, dd),
        tz, notes,
      };
    }
  }
  // instant for a card date: ISO stays as is; a phrase is resolved; a date without time → 09:00 Athens. null = not understood.
  function toInstant(expr, opts) {
    const s = String(expr == null ? '' : expr).trim(); if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
    const r = resolveDate(s, opts); if (!r.ok) return null;
    if (r.iso) return new Date(r.iso);
    const [y, m, d] = r.date.split('-').map(Number);
    return zonedInstant({ y, m, d }, 9, 0, (opts && opts.tz) || TZ);
  }

  // ---- amounts: integer cents only ----
  function parseAmount(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
    let s = String(v == null ? '' : v).replace(/[€$£\s]|eur(o|ω)?s?|ευρω/gi, '').replace(/[\u00a0\u202f]/g, '');
    if (!s) return null;
    const neg = /^-/.test(s); s = s.replace(/^[-+]/, '');
    if (!/^[\d.,]+$/.test(s)) return null;
    const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
    let intPart = s, frac = '';
    const dec = lastC > lastD ? ',' : '.';
    const di = Math.max(lastC, lastD);
    if (di >= 0) {
      const after = s.slice(di + 1);
      const sepCount = s.split(dec).length - 1;
      // «1.640» / «1,640» with exactly 3 digits after a single separator = thousands; «12,5» / «12.50» = decimals
      if (after.length === 3 && sepCount === 1 && !(lastC >= 0 && lastD >= 0)) { intPart = s.replace(/[.,]/g, ''); frac = ''; }
      else { intPart = s.slice(0, di).replace(/[.,]/g, ''); frac = after; }
    }
    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || frac.length > 2) return frac.length > 2 ? null : null;
    const c = (+(intPart || '0')) * 100 + (+(frac.padEnd(2, '0') || '0'));
    return neg ? -c : c;
  }
  function fmtMoney(cents, lang, cur) {
    const sign = cents < 0 ? '-' : ''; const a = Math.abs(Math.round(cents));
    const e = Math.floor(a / 100), c = a % 100;
    const thou = lang === 'en' ? ',' : '.', dec = lang === 'en' ? '.' : ',';
    const s = String(e).replace(/\B(?=(\d{3})+(?!\d))/g, thou) + dec + pad(c);
    const sym = cur === 'USD' ? '$' : cur === 'GBP' ? '£' : '€';
    return lang === 'en' ? sign + sym + s : sign + s + ' ' + sym;
  }
  // largest remainder: Σ parts == total, to the cent
  function splitCents(total, weights) {
    const W = weights.reduce((a, b) => a + b, 0);
    if (!(W > 0)) return null;
    const raw = weights.map((w) => total * w / W);
    const base = raw.map((x) => Math.floor(x));
    let left = total - base.reduce((a, b) => a + b, 0);
    const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let k = 0; left > 0; k = (k + 1) % order.length, left--) base[order[k][1]]++;
    return base;
  }
  // safe arithmetic (no eval): + - * / ( ) and %, decimal comma or point
  function arith(expr) {
    const src = String(expr || '').replace(/[€$£\s]/g, '').replace(/×|x/gi, '*').replace(/÷|:/g, '/');
    let i = 0;
    const num = () => { const m = src.slice(i).match(/^\d+(?:[.,]\d+)?/); if (!m) throw new Error('syntax'); i += m[0].length; return +m[0].replace(',', '.'); };
    const atom = () => {
      if (src[i] === '(') { i++; const v = add(); if (src[i] !== ')') throw new Error('syntax'); i++; return v; }
      if (src[i] === '-') { i++; return -atom(); }
      if (src[i] === '+') { i++; return atom(); }
      let v = num(); if (src[i] === '%') { i++; v = v / 100; } return v;
    };
    const mul = () => { let v = atom(); while (src[i] === '*' || src[i] === '/') { const op = src[i++]; const r = atom(); if (op === '/' && r === 0) throw new Error('div0'); v = op === '*' ? v * r : v / r; } return v; };
    const add = () => { let v = mul(); while (src[i] === '+' || src[i] === '-') { const op = src[i++]; const r = mul(); v = op === '+' ? v + r : v - r; } return v; };
    const v = add(); if (i !== src.length) throw new Error('syntax');
    return v;
  }
  function money(a, opts) {
    a = a || {}; const lang = (opts && opts.lang) || 'el'; const cur = a.currency || 'EUR';
    const F = (c) => fmtMoney(c, lang, cur);
    const op = String(a.op || (a.expr ? 'arith' : a.items ? 'sum' : a.percent != null ? 'percent' : 'split'));
    if (op === 'arith') {
      try { const v = arith(a.expr); const c = Math.round(v * 100); return { ok: true, op, expr: String(a.expr), value: c / 100, text: F(c) }; }
      catch (e) { return { ok: false, op, error: e.message === 'div0' ? 'division_by_zero' : 'not_understood', expr: String(a.expr || '') }; }
    }
    if (op === 'sum') {
      const list = (a.items || []).map((x) => (x && typeof x === 'object') ? { name: x.name || '', c: parseAmount(x.amount) } : { name: '', c: parseAmount(x) });
      const bad = list.filter((x) => x.c == null); if (bad.length || !list.length) return { ok: false, op, error: 'bad_amount' };
      const tot = list.reduce((s, x) => s + x.c, 0);
      return { ok: true, op, total: tot / 100, text: F(tot), items: list.map((x) => ({ name: x.name, amount: x.c / 100, text: F(x.c) })) };
    }
    const total = parseAmount(a.total);
    if (total == null) return { ok: false, op, error: 'bad_total' };
    if (op === 'percent') {
      const p = +String(a.percent).replace(',', '.').replace('%', ''); if (!Number.isFinite(p)) return { ok: false, op, error: 'bad_percent' };
      const part = Math.round(total * p / 100);
      return { ok: true, op, total: total / 100, percent: p, amount: part / 100, text: F(part), plus: F(total + part), minus: F(total - part) };
    }
    // split
    const names = Array.isArray(a.names) ? a.names.map(String) : [];
    let weights = Array.isArray(a.weights) && a.weights.length ? a.weights.map((w) => +String(w).replace(',', '.')) : null;
    const parts = Math.floor(+a.parts || (weights ? weights.length : names.length) || 0);
    if (!weights) weights = parts > 0 ? Array(parts).fill(1) : null;
    if (!weights || weights.some((w) => !(w >= 0)) || !weights.length) return { ok: false, op, error: 'bad_parts' };
    const sc = splitCents(total, weights); if (!sc) return { ok: false, op, error: 'bad_parts' };
    return { ok: true, op: 'split', total: total / 100, text: F(total), parts: sc.map((c, i) => ({ name: names[i] || String(i + 1), amount: c / 100, text: F(c) })), check: F(sc.reduce((x, y) => x + y, 0)) };
  }
  // v2.6.9.3 — subscriptions: every amount and date here is computed by code (cents, Europe/Athens wall dates).
  // «this month» = the charges that fall INSIDE the current calendar month (a yearly one only in its own month;
  // a weekly one 4–5 times); paid = before today, or before `next` (you already moved it to the next period).
  const MONTH_NOM_EL = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];
  const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const PER_YEAR = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };
  const STEP_M = { monthly: 1, quarterly: 3, yearly: 12 };
  const cmpD = (a, b) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
  const isoD = (c) => `${c.y}-${pad(c.m)}-${pad(c.d)}`;
  function parseIso(v) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '')); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  function occurrence(base, cycle, k) { if (cycle === 'weekly') return addDays(base, 7 * k); const st = STEP_M[cycle] || 1; const r = addMonths(base, st * k); return { y: r.y, m: r.m, d: r.d }; }
  // charges of one subscription inside [from, to]
  function occurrencesIn(base, cycle, from, to) {
    const out = [];
    if (cycle === 'weekly') { let k = Math.ceil(dayDiff(base, from) / 7); for (let o = occurrence(base, cycle, k); cmpD(o, to) <= 0; o = occurrence(base, cycle, ++k)) if (cmpD(o, from) >= 0) out.push(o); return out; }
    const st = STEP_M[cycle] || 1; const md = (from.y * 12 + from.m) - (base.y * 12 + base.m);
    for (let mm = md; mm <= (to.y * 12 + to.m) - (base.y * 12 + base.m); mm++) { if (((mm % st) + st) % st) continue; const o = occurrence(base, cycle, mm / st); if (cmpD(o, from) >= 0 && cmpD(o, to) <= 0) out.push(o); }
    return out;
  }
  function nextFrom(base, cycle, today) {
    if (cmpD(base, today) >= 0) return base;
    if (cycle === 'weekly') return occurrence(base, cycle, Math.ceil(dayDiff(base, today) / 7));
    const st = STEP_M[cycle] || 1; let k = Math.floor(((today.y * 12 + today.m) - (base.y * 12 + base.m)) / st); let o = occurrence(base, cycle, k);
    while (cmpD(o, today) < 0) o = occurrence(base, cycle, ++k);
    return o;
  }
  function subsSummary(subs, opts) {
    opts = opts || {}; const lang = opts.lang === 'en' ? 'en' : 'el';
    const w = wallNow(opts.now, opts.tz); const today = { y: w.y, m: w.m, d: w.d };
    const first = { y: w.y, m: w.m, d: 1 }; const last = { y: w.y, m: w.m, d: new Date(Date.UTC(w.y, w.m, 0)).getUTCDate() };
    const act = (subs || []).filter((s) => s && s.active !== false);
    const counts = {}; for (const s of act) { const c = s.currency || 'EUR'; counts[c] = (counts[c] || 0) + 1; }
    const cur = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'EUR';
    const F = (c) => fmtMoney(c, lang, cur);
    const same = act.filter((s) => (s.currency || 'EUR') === cur);
    let yearC = 0, totalC = 0, paidC = 0; const upcoming = [], noDate = [], charges = [];
    for (const s of same) {
      const cyc = PER_YEAR[s.cycle] ? s.cycle : 'monthly'; const c = parseAmount(s.price == null || s.price === '' ? 0 : s.price);
      if (c == null) continue;
      yearC += c * PER_YEAR[cyc];
      const base = parseIso(s.next); if (!base) { noDate.push(s.name || s.id); continue; }
      for (const o of occurrencesIn(base, cyc, first, last)) {
        const paid = cmpD(o, base) < 0 || cmpD(o, today) < 0; totalC += c; if (paid) paidC += c;
        charges.push({ id: s.id, name: s.name || '', date: isoD(o), amount: c / 100, text: F(c), paid });
      }
      const nx = nextFrom(base, cyc, today); const inMonth = nx.y === w.y && nx.m === w.m;
      upcoming.push({ id: s.id, name: s.name || '', icon: s.icon || '', color: s.color || '', cycle: cyc, amount: c / 100, text: F(c), date: isoD(nx), dm: `${pad(nx.d)}/${pad(nx.m)}`, days: dayDiff(today, nx), inMonth, monthName: (lang === 'en' ? MONTH_EN : MONTH_NOM_EL)[nx.m - 1] });
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    charges.sort((a, b) => a.date.localeCompare(b.date));
    const avgC = Math.round(yearC / 12);
    return { ok: true, cur, month: { y: w.y, m: w.m, name: (lang === 'en' ? MONTH_EN : MONTH_NOM_EL)[w.m - 1], lastDM: `${pad(last.d)}/${pad(last.m)}` }, today: isoD(today),
      total: totalC / 100, totalText: F(totalC), paid: paidC / 100, paidText: F(paidC), due: (totalC - paidC) / 100, dueText: F(totalC - paidC), pct: totalC ? paidC / totalC : 0,
      avg: avgC / 100, avgText: F(avgC), year: yearC / 100, yearText: F(yearC), active: act.length, otherCur: act.length - same.length, noDate, charges, upcoming };
  }
  // the tool result the model must quote (it never does the arithmetic itself)
  function dateTool(args, opts) {
    const r = resolveDate(args && (args.expr || args.text || args.date), { ...(opts || {}), base: args && args.base });
    return r;
  }
  // does the message ask for a date or an amount? (then it needs Nyx's tools, not a plain chat model)
  function needsCalc(text) {
    const n = norm(text);
    if (/[€$£%]|\d\s*(ευρω|eur)/.test(n)) return true;
    if (/(μοιρασ|υπολογισ|ποσοστ|αθροισ|ποσο κανει|ποσα|ποσεσ μερεσ|ημερομην|ποτε|ποια μερα|τι μερα|αυριο|μεθαυριο|εβδομαδ|σε \d+|\d{1,2}\/\d{1,2}|split|how much|what day|which day|tomorrow|in \d+ (day|week|month))/.test(n)) return true;
    return n.split(/[\s,]+/).some((w) => w.length >= 4 && (WD_STEM.some(([re]) => re.test(w)) || MONTH_STEM.some(([re]) => re.test(w) && w.length >= 5)));
  }
  const api = { needsCalc, TZ, WD_EL, WD_EN, norm, wallNow, addDays, addMonths, resolveDate, toInstant, zonedInstant, parseAmount, fmtMoney, splitCents, arith, money, dateTool, subsSummary, occurrencesIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NyxCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
