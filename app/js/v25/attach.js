'use strict';
// v2.6.8.1 — upload is text extraction only (OCR only when a PDF has no text layer).
// No LLM on upload. Summarize only when the file does not fit real n_ctx minus prompt and history.
// Image / audio / video / large text: fast stage immediately, heavy stage in the background (progress + cancel).
// Sending never waits for the heavy stage. Results are cached per file hash. Caps are computed, visible, editable.
const Att = {
  list: [], last: [], seq: 0, busy: 0, cache: new Map(),
  _nCtx: 0, _nCtxSource: 'unset', _promptTokens: 0,
  ICON: { image: 'image', audio: 'audio-lines', video: 'film', pdf: 'file-text', docx: 'file-text', xlsx: 'sheet', pptx: 'presentation', odt: 'file-text', csv: 'sheet', text: 'file-text', code: 'file-code', zip: 'file-archive', unknown: 'file-question-mark' },
  fmt(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B'; },
  tok(s) { return Math.ceil(String(s || '').length / 4); },
  ms(t0, t1) { return Math.max(0, (t1 == null ? Date.now() : t1) - t0); },
  sec(ms) { return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s'; },
  nCtx() {
    const live = this._nCtx || +(AI && AI.lastPrep && AI.lastPrep.n_ctx) || 0;
    if (live) return live;
    const ctx = +(Store.state.settings.ai.servers && Store.state.settings.ai.servers.llama && Store.state.settings.ai.servers.llama.ctx);
    return (ctx && ctx > 0) ? ctx : 32768;
  },
  nCtxSource() {
    if (this._nCtx) return this._nCtxSource || 'props_or_probe';
    if (AI && AI.lastPrep && AI.lastPrep.n_ctx) return AI.lastPrep.ctxSrc || 'last_prep';
    const ctx = +(Store.state.settings.ai.servers && Store.state.settings.ai.servers.llama && Store.state.settings.ai.servers.llama.ctx);
    return (ctx && ctx > 0) ? 'settings_ctx' : 'default_32768';
  },
  budget() {
    const As = (Store.state.settings.ai && Store.state.settings.ai.assistant) || {};
    const nCtx = this.nCtx();
    const reserve = (As.attachReserve != null && As.attachReserve !== '' && Number.isFinite(+As.attachReserve)) ? Math.max(0, +As.attachReserve) : 2048;
    const histPct = As.historyPct == null ? 25 : +As.historyPct;
    const histTok = this._promptTokens || Math.floor(nCtx * (Number.isFinite(histPct) ? histPct : 25) / 100);
    const cap = Math.max(256, nCtx - histTok - reserve);
    return { nCtx, reserve, histTok, cap, source: this.nCtxSource() };
  },
  async refreshNctx() {
    try {
      const A = Store.state.settings.ai;
      const p = (A.providers || []).find(x => x.id === 'llama') || { id: 'llama', base: 'http://127.0.0.1:8080/v1', kind: 'local' };
      const mid = (A.tasks && (A.tasks.commands?.m || A.tasks.chat?.m)) || '';
      // Probe only: never call /props?model= from upload (that can start or wait for a load).
      const c = await API.inv('ai:context', p, { model: mid || undefined, probe: true, timeout: 800 });
      if (c && c.n_ctx) { this._nCtx = c.n_ctx; this._nCtxSource = c.source || 'probe'; }
    } catch (e) {}
    return this.nCtx();
  },
  hashOf(e, info) {
    if (e.hash) return e.hash;
    if (info && info.hash) return info.hash;
    return [e.path || e.media || '', e.name || '', e.size || 0, (info && info.mtime) || e.mtime || ''].join('|');
  },
  fromCache(hash) { return hash ? this.cache.get(hash) : null; },
  toCache(e) {
    if (!e.hash) return;
    this.cache.set(e.hash, {
      hash: e.hash, text: e.text, summary: e.summary, kind: e.kind, note: e.note,
      pages: e.pages, frames: e.frames, via: e.via, stages: e.stages && e.stages.map(s => ({ ...s })),
    });
  },
  init() {
    const as = $('#assistant'); if (!as || $('#as-att')) return;
    const inp = as.querySelector('.as-input');
    const tray = h('div', { class: 'as-att', id: 'as-att', hidden: true }); inp.before(tray);
    const clip = h('button', { class: 'ib', id: 'as-clip', title: t('v25.at_add'), html: iconSvg('paperclip', 18), onclick: () => this.pick() });
    inp.querySelector('#as-mic').after(clip);
    let depth = 0;
    as.addEventListener('dragenter', (e) => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; e.preventDefault(); depth++; as.classList.add('as-drop'); });
    as.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; as.classList.remove('as-drop'); } });
    as.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; } });
    as.addEventListener('drop', (e) => { const fs = [...(e.dataTransfer?.files || [])]; if (!fs.length) return; e.preventDefault(); e.stopPropagation(); depth = 0; as.classList.remove('as-drop'); this.addFiles(fs); });
  },
  async pick() { const ps = await API.inv('att:pick'); if (ps?.length) this.add(ps); },
  async addFiles(files) {
    const paths = [];
    for (const f of files) {
      const p = API.pathForFile(f);
      if (p) { paths.push(p); continue; }
      try {
        let u8;
        if (f.stream && f.size > 4 * 1024 * 1024) {
          const reader = f.stream().getReader();
          const chunks = []; let n = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); n += value.byteLength;
            if (n % (8 * 1024 * 1024) < (value.byteLength || 0)) await new Promise((r) => setTimeout(r, 0));
          }
          u8 = new Uint8Array(n); let o = 0; for (const c of chunks) { u8.set(c, o); o += c.byteLength; }
        } else u8 = new Uint8Array(await f.arrayBuffer());
        const r = await API.importBuffer(f.name, u8);
        paths.push({ media: r.file, name: f.name, size: f.size });
      } catch (e) { toast('⚠️ ' + f.name + ': ' + e.message, { kind: 'err' }); }
    }
    this.add(paths);
  },
  add(paths) {
    this.refreshNctx();
    for (const p of paths) {
      const e = typeof p === 'string' ? { path: p, name: p.split(/[\\/]/).pop() } : { ...p };
      Object.assign(e, { id: 'a' + (++this.seq), state: 'wait', pct: 0, kind: e.kind || '', stages: [], tokensSent: 0, cancelHeavy: false });
      this.list.push(e);
      e.fastReady = this.fast(e).catch(err => { e.state = 'bad'; e.error = cleanErr(err); }).finally(() => this.chips());
    }
    this.chips(); Assistant.show?.();
  },
  remove(id) {
    const e = this.list.find(x => x.id === id);
    if (e) { e.cancelHeavy = true; try { e._heavyAbort?.abort(); } catch (er) {} }
    this.list = this.list.filter(x => x.id !== id); this.chips();
  },
  chips() {
    const tray = $('#as-att'); if (!tray) return; tray.innerHTML = ''; tray.hidden = !this.list.length;
    for (const e of this.list) tray.append(this.chip(e, true));
  },
  chip(e, live) {
    const st = e.state === 'ok' ? (e.note ? 'warn' : 'ok') : e.state;
    const c = h('div', { class: 'at-chip at-card ' + st, title: [e.name, e.size ? this.fmt(e.size) : '', e.error || e.note || ''].filter(Boolean).join(' · ') },
      h('div', { class: 'at-row' },
        h('span', { class: 'ic', html: iconSvg(this.ICON[e.kind] || 'paperclip', 14) }), h('span', { class: 'nm' }, e.name),
        e.state === 'work' || e.state === 'wait' || e.state === 'heavy' ? h('span', { class: 'pg' }, h('i', { style: `width:${Math.round(e.pct || 0)}%` })) : h('span', { class: 'st' }, e.state === 'bad' ? '⚠️' : e.note ? '⚠' : '✓')));
    const meta = this.stageLine(e);
    if (meta) c.append(h('div', { class: 'at-meta muted' }, meta));
    if (e.state === 'heavy') c.append(h('button', { class: 'at-cancel', type: 'button', onclick: () => this.cancelHeavy(e) }, t('v2681.att_cancel')));
    if (live) c.append(h('button', { class: 'x', title: t('v25.at_remove'), html: iconSvg('x', 11), onclick: () => this.remove(e.id) }));
    return c;
  },
  stageLine(e) {
    const parts = (e.stages || []).map(s => t('v2681.att_stage', { name: s.label || s.id, time: this.sec(s.ms || 0), tokens: s.tokens != null ? String(s.tokens) : '—' }));
    if (e.tokensSent) parts.push(t('v2681.att_sent', { tokens: e.tokensSent }));
    const b = this.budget();
    if (liveOrOk(e) && b.nCtx) parts.push(t('v2681.att_budget', { cap: b.cap, nctx: b.nCtx, src: b.source }));
    return parts.join(' · ');
    function liveOrOk(x) { return x.state === 'ok' || x.state === 'heavy' || x.stages?.length; }
  },
  prog(e, pct, step) { e.pct = pct; if (step) e.step = step; this.chips(); },
  markStage(e, id, label, t0, extra) {
    const rec = { id, label, ms: this.ms(t0), tokens: extra && extra.tokens, note: extra && extra.note };
    const i = (e.stages || []).findIndex(s => s.id === id);
    if (i >= 0) e.stages[i] = rec; else (e.stages || (e.stages = [])).push(rec);
    this.chips();
    return rec;
  },
  // ---------- fast stage (no LLM) ----------
  async fast(e) {
    e.state = 'work'; this.prog(e, 5);
    const t0 = Date.now();
    let info;
    if (e.media) info = { name: e.name, size: e.size, kind: this.kindOfName(e.name) };
    else { info = await API.inv('att:inspect', e.path); Object.assign(e, { size: info.size, kind: info.kind, mtime: info.mtime }); }
    e.kind = info.kind; e.hash = this.hashOf(e, info);
    const hit = this.fromCache(e.hash);
    if (hit && (hit.text || hit.summary || hit.kind === 'image')) {
      Object.assign(e, { text: hit.text, summary: hit.summary, note: hit.note, pages: hit.pages, frames: hit.frames, via: hit.via, stages: (hit.stages || []).map(s => ({ ...s })) });
      this.markStage(e, 'cache', t('v2681.att_cache'), t0, { tokens: this.tok(e.text || e.summary || '') });
      e.state = 'ok'; e.pct = 100; e.fastOk = true;
      return;
    }
    if (info.error) { e.state = 'bad'; e.error = info.code === 'BINARY' ? t('v25.at_unsupported', { ext: (e.name.split('.').pop() || '?').toLowerCase() }) : info.error; return; }
    if (info.text != null) { e.text = info.text; if (info.truncated) e.note = t('v25.at_truncated'); }
    else if (e.kind === 'zip') await this.zip(e);
    else if (e.kind === 'pdf') { if (!e.media) { const r = await API.importPath(e.path); e.media = r.file; } this.prog(e, 25); await this.pdf(e); }
    else if (['image', 'audio', 'video'].includes(e.kind)) {
      if (!e.media) { const r = await API.importPath(e.path); e.media = r.file; }
      e.needsHeavy = true;
    } else if (e.text == null) { e.state = 'bad'; e.error = t('v25.at_unsupported', { ext: (e.name.split('.').pop() || '?').toLowerCase() }); return; }
    this.markStage(e, 'fast', t('v2681.att_fast'), t0, { tokens: this.tok(e.text || '') });
    e.fastOk = true;
    const needsOcr = e.kind === 'pdf' && e.needsOcr;
    const over = !!(e.text && !this.fits(e.text));
    const mediaHeavy = !!(e.needsHeavy);
    if (!e.text && !e.children?.length && e.kind !== 'image' && e.kind !== 'audio' && e.kind !== 'video' && !needsOcr) { e.state = 'bad'; e.error ||= t('v25.at_empty'); return; }
    e.state = (needsOcr || over || mediaHeavy) ? 'heavy' : 'ok';
    e.pct = (e.state === 'ok') ? 100 : 55;
    this.toCache(e);
    // Heavy in the background — never blocks send.
    if (e.state === 'heavy') e.heavyDone = this.heavy(e).catch(err => { if (!e.cancelHeavy) e.note = cleanErr(err); }).finally(() => { if (!e.cancelHeavy && e.state !== 'bad') e.state = 'ok'; e.pct = 100; this.toCache(e); this.chips(); });
  },
  fits(text) { return this.tok(text) <= this.budget().cap; },
  cancelHeavy(e) { e.cancelHeavy = true; try { e._heavyAbort?.abort(); } catch (er) {} e.note = t('v2681.att_cancelled'); e.state = e.fastOk ? 'ok' : 'bad'; e.pct = 100; this.chips(); },
  // ---------- heavy stage (vision, whisper, frames, OCR-if-empty, summary-if-over-budget) ----------
  async heavy(e) {
    if (e.cancelHeavy) return;
    const t0 = Date.now();
    if (e.kind === 'pdf' && e.needsOcr) {
      this.prog(e, 60, 'ocr');
      await this.pdfOcr(e);
      if (e.cancelHeavy) return;
    }
    if (e.kind === 'image') { this.prog(e, 60, 'vision'); await this.image(e); }
    else if (e.kind === 'audio') { this.prog(e, 60, 'whisper'); await this.audio(e); }
    else if (e.kind === 'video') { this.prog(e, 60, 'whisper'); await this.video(e); }
    if (e.cancelHeavy) return;
    if (e.text && !this.fits(e.text) && !e.summary) {
      this.prog(e, 80, 'summary');
      try { e.summary = await this.summarize(e.text, e.name, (p) => { if (e.cancelHeavy) throw Object.assign(new Error('cancelled'), { code: 'ABORTED' }); this.prog(e, 80 + p * 18); }); }
      catch (er) { if (!e.cancelHeavy) e.note = t('v25.at_nosum'); }
    }
    this.markStage(e, 'heavy', t('v2681.att_heavy'), t0, { tokens: this.tok(e.summary || e.text || '') });
    this.toCache(e);
  },
  kindOfName(n) { const x = (n.split('.').pop() || '').toLowerCase(); return /^(jpe?g|png|webp|gif|bmp|avif|heic|tiff?)$/.test(x) ? 'image' : /^(mp4|mov|mkv|webm|avi|m4v)$/.test(x) ? 'video' : /^(mp3|wav|m4a|ogg|opus|flac|aac)$/.test(x) ? 'audio' : x === 'pdf' ? 'pdf' : 'unknown'; },
  async image(e) {
    if (e.cancelHeavy) return;
    const parts = []; let ok = false;
    if (/win/i.test(V2.info?.platform || '')) { try { const o = await API.inv('sys:ocr', e.media, 'el'); if (o?.trim()) { parts.push(t('v25.at_ocr') + ':\n' + o.trim()); ok = true; } } catch (er) {} }
    this.prog(e, 70);
    if (e.cancelHeavy) return;
    try { const d = await this.vision(e.media, t('v25.at_vprompt')); if (d) { parts.unshift(t('v25.at_desc') + ': ' + d); ok = true; e.via = this._via; } } catch (er) { e.note = t('v25.at_novision'); }
    e.text = parts.join('\n\n'); if (!ok && !e.note) e.note = t('v25.at_novision');
  },
  async vision(file, prompt) {
    try { const r = await AI.vision(file, prompt); this._via = AI.last.vision || 'local'; return stripThink(r).trim(); }
    catch (e1) {
      const g = AI.enabled().find(p => p.id === 'groq' || /groq\.com/.test(p.base || ''));
      if (!g || Private?.on) throw e1;
      const url = await API.inv('ai:imageData', file);
      const r = await API.inv('ai:chat', g, { model: Store.state.settings.agent?.groqVision || 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] }], temperature: 0.2, max_tokens: 400 });
      this._via = 'Groq'; return stripThink(r.message?.content || '').trim();
    }
  },
  async audio(e) {
    if (e.cancelHeavy) return;
    try { const r = await API.inv('stt:media', Store.state.settings.ai.stt, e.media, {}); e.text = r?.text?.trim() ? t('v25.at_transcript') + ':\n' + r.text.trim() : ''; if (!e.text) e.note = t('v25.at_nospeech'); }
    catch (er) { e.error = t('v25.at_nowhisper') + ' (' + cleanErr(er) + ')'; }
  },
  async video(e) {
    if (e.cancelHeavy) return;
    await this.audio(e); const transcript = e.text || ''; const err = e.error; delete e.error; this.prog(e, 70);
    if (e.cancelHeavy) return;
    const frames = []; let dur = 0;
    try { dur = (await API.inv('video:probe', e.media))?.duration || 0; } catch (er) {}
    const ts = dur > 0 ? [0.1, 0.5, 0.9].map(f => +(dur * f).toFixed(2)) : [0];
    for (const tt of ts) {
      if (e.cancelHeavy) break;
      try { const f = await API.inv('video:frame', e.media, tt); let d = ''; try { d = await this.vision(f, t('v25.at_vprompt_frame')); } catch (er) {} frames.push({ t: tt, file: f, desc: d }); } catch (er) { break; }
    }
    e.frames = frames; this.prog(e, 88);
    const fx = frames.filter(f => f.desc).map(f => `[${f.t.toFixed(1)}s] ${f.desc}`).join('\n');
    e.text = [transcript, fx ? t('v25.at_frames') + ':\n' + fx : ''].filter(Boolean).join('\n\n');
    if (!e.text) e.error = err || t('v25.at_novideo'); else if (!transcript || !fx) e.note = !transcript ? (err || t('v25.at_nospeech')) : t('v25.at_novision');
  },
  async pdf(e) {
    const doc = await Extras.pdfDoc({ file: e.media }); let out = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent(); out += `\n[${p}] ` + tc.items.map(x => x.str).join(' ');
      if (p % 2 === 0) await new Promise((r) => setTimeout(r, 0));
      if (p % 10 === 0) this.prog(e, 25 + 55 * p / doc.numPages);
    }
    e.pages = doc.numPages; e.text = out.trim();
    if (!e.text.replace(/\[\d+\]/g, '').trim()) { e.text = ''; e.needsOcr = true; e.note = t('v2681.att_pdf_ocr'); }
  },
  async pdfOcr(e) {
    if (!/win/i.test(V2.info?.platform || '')) { e.note = t('v25.at_pdfscan'); return; }
    // Render a few pages as images only when there is no text layer.
    try {
      const doc = await Extras.pdfDoc({ file: e.media });
      const parts = [];
      const n = Math.min(doc.numPages, 8);
      for (let p = 1; p <= n; p++) {
        if (e.cancelHeavy) return;
        try {
          if (typeof Extras.pdfPageImage === 'function') {
            const img = await Extras.pdfPageImage(doc, p);
            const o = await API.inv('sys:ocr', img, 'el');
            if (o?.trim()) parts.push(`[${p}] ` + o.trim());
          }
        } catch (er) {}
      }
      if (parts.length) e.text = parts.join('\n');
      else e.note = t('v25.at_pdfscan');
    } catch (er) { e.note = t('v25.at_pdfscan'); }
  },
  async zip(e) {
    const r = await API.inv('att:unzip', e.path); this.prog(e, 30);
    e.tree = r.text; e.skipped = r.skipped; const files = r.all.filter(n => n.kind !== 'zip');
    const kids = []; const MAXF = Store.state.settings.agent?.zipMaxFiles || 40;
    for (const [i, n] of files.entries()) {
      if (i >= MAXF) { kids.push({ name: n.rel, kind: n.kind, state: 'bad', error: t('v25.at_zip_more') }); continue; }
      const k = { path: n.path, name: n.rel, size: n.size, kind: n.kind, state: 'wait', pct: 0, stages: [] };
      try { await this.fast(k); } catch (er) { k.state = 'bad'; k.error = cleanErr(er); }
      kids.push(k); this.prog(e, 30 + 50 * (i + 1) / Math.min(files.length, MAXF));
    }
    e.children = kids;
    const bad = kids.filter(k => k.state === 'bad');
    e.text = t('v25.at_ztree', { n: r.files, size: this.fmt(r.total) }) + '\n' + r.text +
      (r.skipped.length ? '\n\n' + t('v25.at_zskip') + ':\n' + r.skipped.map(s => `- ${s.rel}: ${s.reason}`).join('\n') : '') +
      kids.filter(k => k.state !== 'bad' && (k.text || k.summary)).map(k => `\n\n### ${k.name}\n` + (k.summary || k.text).slice(0, 8000)).join('') +
      (bad.length ? '\n\n' + t('v25.at_zbad') + ':\n' + bad.map(k => `- ${k.name}: ${k.error}`).join('\n') : '');
    if (bad.length || r.skipped.length) e.note = t('v25.at_zpartial', { n: bad.length + r.skipped.length });
  },
  chunks(text, size) {
    size = size || Math.max(2000, Math.floor(this.budget().cap * 2));
    const out = []; let i = 0;
    while (i < text.length) { let j = Math.min(text.length, i + size); if (j < text.length) { const cut = text.lastIndexOf('\n', j); if (cut > i + size * 0.6) j = cut; } out.push(text.slice(i, j)); i = j; }
    return out;
  },
  async summarize(text, name, onp) {
    // Chunk size follows the real budget, not a fixed character cap. Sample at most what fits a few rounds.
    let ch = this.chunks(text); const total = ch.length;
    const maxCh = Math.max(4, Math.min(16, Math.ceil(this.budget().cap / 800)));
    if (ch.length > maxCh) { const step = ch.length / maxCh; ch = Array.from({ length: maxCh }, (_, i) => ch[Math.floor(i * step)]); }
    const parts = [];
    for (const [i, c] of ch.entries()) { parts.push(await AI.text('summarize', t('v25.at_sum_chunk', { name, i: i + 1, n: ch.length, text: c }))); onp?.((i + 1) / (ch.length + 1)); }
    const fin = await AI.text('summarize', t('v25.at_sum_final', { name, parts: parts.map((p, i) => `(${i + 1}) ${p}`).join('\n') }));
    return fin + (total > ch.length ? '\n' + t('v25.at_sampled', { n: ch.length, total }) : '');
  },
  // ---------- hand-off to the assistant. Never waits for the heavy stage. ----------
  async take() {
    const L = this.list.slice(); if (!L.length) return null;
    await Promise.all(L.map(e => e.fastReady || Promise.resolve()));
    this.list = []; this.chips(); this.last = L; return L;
  },
  meta(L) { return L.map(e => ({ name: e.name, kind: e.kind, ok: e.state !== 'bad', note: e.error || e.note || '', size: e.size || 0, media: e.media || '', tokensSent: e.tokensSent || 0, stages: e.stages || [] })); },
  context(L = this.last) {
    if (!L?.length) return '';
    const b = this.budget();
    let s = '\n\n' + t('v25.at_ctx_head') + '\n' + t('v2681.att_budget', { cap: b.cap, nctx: b.nCtx, src: b.source }) + '\n';
    const bodies = L.map(e => this.bodyFor(e, b));
    const total = bodies.reduce((n, x) => n + x.tokens, 0);
    const scale = total > b.cap && total > 0 ? (b.cap / total) : 1;
    for (const row of bodies) {
      const e = row.e;
      let body = row.body;
      let tokens = row.tokens;
      if (scale < 1 && body.length > 32) {
        const keep = Math.max(32, Math.floor(body.length * scale));
        body = body.slice(0, keep) + '\n… ' + t('v25.at_more');
        tokens = this.tok(body);
      }
      e.tokensSent = tokens;
      s += `\n### ${e.name} (${e.kind}${e.size ? ', ' + this.fmt(e.size) : ''}${e.media ? ', media=' + e.media : ''}, tokens=${tokens})\n`;
      if (e.state === 'bad') { s += '⚠️ ' + t('v25.at_cant', { name: e.name }) + ': ' + e.error + '\n'; continue; }
      if (e.note) s += '(' + e.note + ')\n';
      if (row.usedSummary) s += t('v25.at_summary') + ':\n';
      s += body + '\n';
    }
    return s;
  },
  bodyFor(e, b) {
    if (e.state === 'bad') return { e, body: '', tokens: 0, usedSummary: false };
    if (e.summary && e.text && !this.fits(e.text)) {
      const body = e.summary + '\n\n' + t('v25.at_head') + ':\n' + e.text.slice(0, Math.max(400, Math.floor((b.cap * 4) * 0.15)));
      return { e, body, tokens: this.tok(body), usedSummary: true };
    }
    const body = e.text || e.summary || '';
    return { e, body, tokens: this.tok(body), usedSummary: !!e.summary && !e.text };
  },
  brief() { return this.last.length ? t('v25.at_brief', { list: this.last.map(e => `${e.name} [${e.kind}${e.state === 'bad' ? ', ⚠️' : ''}${e.tokensSent ? ', ' + e.tokensSent + ' tok' : ''}]`).join(', ') }) : ''; },
  unreadable(L) { const bad = (L || []).filter(e => e.state === 'bad'); return bad.length ? '⚠️ ' + t('v25.at_unread', { list: bad.map(e => `${e.name} — ${e.error}`).join('; ') }) : ''; },
  all(L = this.last) { const out = []; for (const e of L || []) { out.push(e); if (e.children) out.push(...this.all(e.children)); } return out; },
  find(name) { const A = this.all(); const n = norm(name || ''); return A.find(e => norm(e.name) === n) || A.find(e => norm(e.name).includes(n)); },
};

// ---------- tools the model can call ----------
Object.assign(Cmd.T, {
  list_attachments: { d: t('v25.tl_list_att'), p: {}, async run() { return { ok: true, files: Att.all().map(e => ({ name: e.name, kind: e.kind, size: e.size, readable: e.state !== 'bad', note: e.error || e.note || '', placeable: !!e.media, tokensSent: e.tokensSent || 0 })) }; } },
  read_attachment: { d: t('v25.tl_read_att'), p: { name: { type: 'string' }, offset: { type: 'number' } }, req: ['name'],
    async run(a) { const e = Att.find(a.name); if (!e) return { ok: false, error: t('v25.at_nofile') }; if (e.state === 'bad') return { ok: false, error: e.error }; const o = Math.max(0, +a.offset || 0); const txt = e.text || ''; const span = Math.max(1000, Att.budget().cap * 2); return { ok: true, name: e.name, total: txt.length, offset: o, text: txt.slice(o, o + span), more: o + span < txt.length }; } },
  place_attachments: { d: t('v25.tl_place_att'), p: { which: { type: 'string', enum: ['images', 'videos', 'media', 'all'] }, names: { type: 'array', items: { type: 'string' } }, board: { type: 'string', description: t('v25.tl_board') }, title: { type: 'string' } },
    async run(a) {
      let L = Att.all().filter(e => e.state !== 'bad');
      if (a.names?.length) L = a.names.map(n => Att.find(n)).filter(Boolean);
      const which = a.which || 'media';
      const media = L.filter(e => e.media && (which === 'images' ? e.kind === 'image' : which === 'videos' ? e.kind === 'video' : true));
      const texts = which === 'all' ? L.filter(e => !e.media && (e.text || e.summary)) : [];
      if (!media.length && !texts.length) return { ok: false, error: t('v25.at_nothing') };
      if (a.board) { const b = Store.state.boards.find(x => norm(x.name) === norm(a.board)); if (b) { if (Store.state.active !== b.id) await Cmd.T.open_board.run({ name: b.name }); } else await Cmd.T.create_board.run({ name: a.board }); }
      const placed = await Agent.placeGrid(media.map(e => ({ file: e.media, name: e.name.split('/').pop() })), { title: a.title });
      for (const e of texts) { const p = Cmd.freeSpot(420, 260); placed.push(Features.addAt({ type: 'text', w: 420, h: 60, html: `<b>${esc(e.name)}</b><br>` + esc((e.summary || e.text).slice(0, 4000)).replace(/\n/g, '<br>'), size: 14, bg: 'var(--card)' }, p.x, p.y)); }
      return { ok: true, placed: placed.length, ids: placed.map(i => i.id.slice(0, 8)) };
    } },
});
