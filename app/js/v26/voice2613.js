// v2.6.13 «φωνή ster» — pure helpers (no DOM, no IPC) for the answer voice; unit-tested in tests/v2613-unit.js,
// the renderer gets them on window.NyxVoice.
//  - splitSentences: one piece per sentence; never splits 19,90 / 19.90 / 16.11.2026 / 09:45 or abbreviations
//    (κ.λπ., π.χ., κ.ά., δηλ., βλ., σελ., e.g., etc. …); a dot followed by a lowercase word is not a sentence end.
//  - pipeline: sentence N plays while N+1 is synthesised; synth calls run ONE at a time (never in parallel) and at most
//    one sentence ahead of what is playing; cancel stops everything; a dead engine ends the answer (no retry, no switch).
(function (root) {
  // i18n-ignore — abbreviations are language data, not UI text
  const ABBR = new Set(['κ.λπ', 'κ.λ.π', 'κλπ', 'κτλ', 'κ.τ.λ', 'π.χ', 'κ.ά', 'κ.α', 'κ.ο.κ', 'δηλ', 'βλ', 'σελ', 'σσ', 'αρ', 'κ', 'κα', 'δρ', 'τηλ', 'οδ', 'χλμ', 'εκ', 'λ', 'π.χ', 'μ.χ', 'π.μ', 'μ.μ', 'ό.π', 'ο.π', 'κυρ', 'αγ', 'αι', 'περ', 'τόμ', 'εκδ', 'π.δ', 'ν', 'άρθρ', 'παρ', 'e.g', 'i.e', 'etc', 'mr', 'mrs', 'ms', 'dr', 'no', 'vs', 'st', 'p.m', 'a.m', 'approx', 'fig', 'cf']); // i18n-ignore
  const TERM = '.!?;\u037e\u2026';
  const isDigit = (c) => c >= '0' && c <= '9';
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\u00a0';
  const isLower = (c) => !!c && c !== c.toUpperCase() && c === c.toLowerCase();
  const CLOSE = '"\'»”’)]';
  function splitPara(p, out) {
    let start = 0; const n = p.length;
    for (let i = 0; i < n; i++) {
      const c = p[i]; if (TERM.indexOf(c) < 0) continue;
      let j = i; while (j + 1 < n && TERM.indexOf(p[j + 1]) >= 0) j++;      // ?!  …  ...
      let k = j + 1; while (k < n && CLOSE.indexOf(p[k]) >= 0) k++;          // closing quotes / brackets stay with the sentence
      if (k < n && !isSpace(p[k])) { i = j; continue; }                      // 19.90, 1.5, κ.λπ (inner dots), www.x
      if (c === '.' && j === i) {
        let w = i - 1; while (w >= 0 && !isSpace(p[w]) && '(«"\''.indexOf(p[w]) < 0) w--;
        const word = p.slice(w + 1, i).toLowerCase();
        if (ABBR.has(word) || /^\p{L}$/u.test(word)) { i = j; continue; }   // abbreviation or an initial (Γ. Παπαδόπουλος)
      }
      let m = k; while (m < n && isSpace(p[m])) m++;
      if (m < n && (isLower(p[m]) || ',;:'.indexOf(p[m]) >= 0) && c !== '?' && c !== '!' && c !== ';' && c !== '\u037e') { i = j; continue; } // «… κ.λπ. και» / «3 κ. μ.»
      const s = p.slice(start, k).trim(); if (s) out.push(s); start = k; i = k - 1;
    }
    const s = p.slice(start).trim(); if (s) out.push(s);
  }
  function splitSentences(text, maxLen) {
    const max = maxLen || 400; const out = [];
    for (const para of String(text || '').replace(/\r/g, '').split(/\n+/)) splitPara(para.replace(/[ \t\u00a0]+/g, ' ').trim(), out);
    // tiny pieces («Ναι.» stays; a lone «.» or «—» joins the previous one); very long ones are cut at a comma / space
    const merged = [];
    for (const s of out) { if (merged.length && !/[\p{L}\p{N}]/u.test(s)) merged[merged.length - 1] += ' ' + s; else merged.push(s); }
    const res = [];
    for (let s of merged) {
      while (s.length > max) { let cut = s.lastIndexOf(', ', max); if (cut < max * 0.4) cut = s.lastIndexOf(' ', max); if (cut < max * 0.4) cut = max; res.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim(); }
      if (s) res.push(s);
    }
    return res;
  }
  // parts: sentences · synth(i, text) → Promise<{ok, file, code}> · play(file, i) → Promise (resolves when it ends)
  // isCancelled() · onError(i, result). Returns { played, errors: [{i, code}], skipped }.
  async function pipeline(parts, o) {
    const n = parts.length; const res = new Array(n); const wait = new Array(n);
    for (let i = 0; i < n; i++) res[i] = new Promise((r) => { wait[i] = r; });
    let playing = -1; let gate = null; const bump = () => { const g = gate; gate = null; g && g(); };
    let stop = false; const out = { played: 0, errors: [], skipped: 0 };
    const producer = (async () => {
      for (let i = 0; i < n; i++) {
        while (!stop && !o.isCancelled() && i > playing + 1) await new Promise((r) => { gate = r; }); // at most one sentence ahead
        if (stop || o.isCancelled()) { for (let k = i; k < n; k++) wait[k]({ ok: false, code: 'cancelled' }); return; }
        let r; try { r = await o.synth(i, parts[i]); } catch (e) { r = { ok: false, code: 'error', error: String(e && e.message || e) }; }
        wait[i](r || { ok: false, code: 'error' });
        if (r && r.code === 'engine_down') { stop = true; for (let k = i + 1; k < n; k++) wait[k]({ ok: false, code: 'engine_down', skipped: true }); return; }
      }
    })();
    for (let i = 0; i < n; i++) {
      const r = await res[i];
      if (o.isCancelled()) break;
      if (!r.ok) {
        if (r.code === 'cancelled') break;
        out.errors.push({ i, code: r.code }); o.onError && o.onError(i, r);
        if (r.code === 'engine_down') { out.skipped = n - i - 1; break; }
        playing = i; bump(); continue;
      }
      playing = i; bump();
      try { await o.play(r.file, i); out.played++; } catch (e) { out.errors.push({ i, code: 'play' }); }
    }
    stop = true; bump(); await producer.catch(() => {});
    return out;
  }
  const api = { splitSentences, pipeline, ABBR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NyxVoice = api;
})(typeof window !== 'undefined' ? window : null);
