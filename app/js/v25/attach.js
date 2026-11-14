'use strict';
// v2.6.8.1 — upload is text extraction only (OCR only when a PDF has no text layer). No LLM on upload.
// v2.6.8.2 — real token counts: /tokenize when the model is already loaded (one request per attachment, cached per hash),
// otherwise a conservative estimate (NyxTok: Greek/code ≈ chars/2, English ≈ chars/3.5). The chip says which one.
// Before every send: system + history + attachments + reserve ≤ n_ctx; attachments are trimmed, never sent over the limit.
// Send never waits for the heavy stage: it pauses (and aborts the in-flight background request) and resumes after the reply.
// Zip / code: file list + the full files that fit, no automatic summary. A summary only via the «Περίληψη» button.
const Att = {
  list: [], last: [], seq: 0, busy: 0, cache: new Map(), tokCache: new Map(),
  _nCtx: 0, _nCtxSource: 'unset', _promptTokens: 0, _blocks: [], _metaRefs: null,
  _bgStreams: new Set(), _pausedIds: new Set(), _pauser: null,
  ICON: { image: 'image', audio: 'audio-lines', video: 'film', pdf: 'file-text', docx: 'file-text', xlsx: 'sheet', pptx: 'presentation', odt: 'file-text', csv: 'sheet', text: 'file-text', code: 'file-code', zip: 'file-archive', unknown: 'file-question-mark' },
  fmt(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B'; },
  tok(s, kind) { return NyxTok.estimate(s, kind); },
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
  // System prompt + tool list + history (as the assistant will trim it), estimated the same conservative way.
  baseTokens(nCtx, histPct) {
    let sys = 0, hist = 0;
    try { sys = NyxTok.estimate(Assistant.system(false)) + NyxTok.estimate(JSON.stringify(Cmd.tools()), 'json'); } catch (e) { sys = 0; }
    try { hist = (Store.state.chat || []).filter(m => m.content && m.role !== 'notice' && !m.error).reduce((n, m) => n + NyxTok.estimate(String(m.content)) + 8, 0); } catch (e) { hist = 0; }
    hist = Math.min(hist, Math.floor(nCtx * histPct / 100));
    return { sys, hist };
  },
  budget() {
    const now = Date.now();
    if (this._bmemo && now - this._bmemo.at < 1000) return this._bmemo.b;
    const b = this._budget(); this._bmemo = { at: now, b }; return b;
  },
  _budget() {
    const As = (Store.state.settings.ai && Store.state.settings.ai.assistant) || {};
    const nCtx = this.nCtx();
    const reserve = (As.attachReserve != null && As.attachReserve !== '' && Number.isFinite(+As.attachReserve)) ? Math.max(0, +As.attachReserve) : 2048;
    const histPct = As.historyPct == null ? 25 : (Number.isFinite(+As.historyPct) ? +As.historyPct : 25);
    const base = this.baseTokens(nCtx, histPct);
    const histTok = base.sys + base.hist;
    // 64 = the answer margin of computeMaxTokens (main/limits.js DEFAULT_RESERVE): room for the chat-template tokens that
    // wrap the messages. v2.6.9.1: shown in the chip line («περιθώριο προτύπου 64»), it was hidden (32768−6491−2048 = 24229, chip 24165).
    const margin = 64;
    const cap = Math.max(0, nCtx - histTok - reserve - margin);
    return { nCtx, reserve, histTok, sysTok: base.sys, cap, margin, source: this.nCtxSource() };
  },
  async refreshNctx() {
    try {
      const { p, mid } = this.localModel();
      // Probe only: never call /props?model= from upload (that can start or wait for a load).
      const c = await API.inv('ai:context', p, { model: mid || undefined, probe: true, timeout: 800 });
      if (c && c.n_ctx) { this._nCtx = c.n_ctx; this._nCtxSource = c.source || 'probe'; }
    } catch (e) {}
    return this.nCtx();
  },
  localModel() {
    const A = Store.state.settings.ai;
    const p = (A.providers || []).find(x => x.id === 'llama') || { id: 'llama', base: 'http://127.0.0.1:8080/v1', kind: 'local' };
    const mid = (A.tasks && (A.tasks.commands?.m || A.tasks.chat?.m)) || '';
    return { p, mid };
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
      hash: e.hash, text: e.text, summary: e.summary, kind: e.kind, note: e.note, tree: e.tree, children: e.children, skipped: e.skipped,
      pages: e.pages, frames: e.frames, via: e.via, stages: e.stages && e.stages.map(s => ({ ...s })),
    });
  },
  // ---------- token counts ----------
  // Token count of the full extracted text: { n, src: 'measured' | 'estimate' }.
  tokensOf(e) {
    const text = e.text || '';
    if (e.tk && e.tk.len === text.length) return e.tk;
    const key = (e.hash || e.name || '') + ':' + text.length;
    const hit = this.tokCache.get(key);
    if (hit) { e.tk = hit; return hit; }
    return { n: this.tok(text, e.kind), src: 'estimate', len: text.length };
  },
  // One /tokenize per attachment, only when the model is already loaded (no load is started). Cached per hash.
  async measure(e) {
    const text = e.text || ''; if (!text) return null;
    const key = (e.hash || e.name || '') + ':' + text.length;
    if (this.tokCache.get(key)?.src === 'measured') { e.tk = this.tokCache.get(key); return e.tk; }
    e.tk = { n: this.tok(text, e.kind), src: 'estimate', len: text.length };
    try {
      const { p, mid } = this.localModel();
      if (!mid || !p || p.enabled === false) { e.tk.why = t('v2691.est_no_model'); return e.tk; }
      const r = await API.inv('ai:tokenize', p, text, { model: mid, onlyIfLoaded: true, timeout: 8000 });
      // v2.6.9.1: why it stayed an estimate is visible (chip tooltip) — e.g. the router lists the model as «unloaded»
      if (r && r.skipped) e.tk.why = t('v2691.est_not_loaded', { v0: mid, v1: r.state || t('v2691.state_unknown_short') });
      if (r && Number.isFinite(+r.count) && +r.count > 0) {
        e.tk = { n: +r.count, src: 'measured', len: text.length }; this.tokCache.set(key, e.tk);
        for (const st of e.stages || []) if (st.id === 'fast' || st.id === 'cache' || st.id === 'heavy') st.tokens = e.tk.n;
        this.chips();
      }
    } catch (er) { e.tk.why = t('v2691.est_failed', { v0: cleanErr(er) }); }
    return e.tk;
  },
  srcLabel(src) { return src === 'measured' ? t('v2682.measured') : t('v2682.estimated'); },
  // Per-file rows of a zip with token counts (scaled by the measured/estimated ratio of the whole zip when it was measured).
  zipRows(e) {
    const kids = e.children || [];
    const whole = this.tokensOf(e);
    const est = this.tok(e.text || '', e.kind) || 1;
    const ratio = whole.src === 'measured' ? Math.max(0.2, whole.n / est) : 1;
    return kids.map(k => ({ name: k.name, size: k.size || 0, kind: k.kind, text: k.state === 'bad' ? '' : (k.text || ''), tokens: k.state === 'bad' ? 0 : Math.ceil(this.tok(k.text || '', k.kind) * ratio), bad: k.state === 'bad', error: k.error || k.note || '' }));
  },
  // What one attachment would cost in full: { body, tokens, src }.
  fullOf(e, b) {
    if (e.state === 'bad') return { body: '', tokens: 0, src: 'estimate' };
    if (e.kind === 'zip' && e.children) {
      const rows = this.zipRows(e); const src = this.tokensOf(e).src;
      const manifest = NyxTok.zipPlan(rows, 0, { fmt: (x) => this.fmt(x) }).manifest;
      const sum = e.summary ? this.tok(e.summary) : 0;
      return { body: '', tokens: rows.reduce((n, r) => n + r.tokens, 0) + this.tok(manifest, 'code') + 32 + sum, src, zip: rows, sum };
    }
    const tk = this.tokensOf(e);
    if (e.summary && tk.n > (b ? b.cap : Infinity)) {
      const body = e.summary; return { body, tokens: this.tok(body), src: 'estimate', usedSummary: true };
    }
    return { body: e.text || '', tokens: e.text ? tk.n : 0, src: tk.src };
  },
  // Split the budget across attachments by tokens (small ones whole, big ones share the rest).
  plan(L, b) {
    b = b || this.budget();
    const items = (L || []).filter(e => e.state !== 'bad').map(e => ({ id: e.id, e, ...this.fullOf(e, b) }));
    const alloc = NyxTok.allocate(items.map(x => ({ id: x.id, tokens: x.tokens })), b.cap);
    const out = {};
    for (const x of items) out[x.id] = { send: Math.min(x.tokens, alloc[x.id] || 0), total: x.tokens, src: x.src, over: (alloc[x.id] || 0) < x.tokens, item: x };
    return out;
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
    this.refreshNctx().then(() => this.chips());
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
    if (e) { e.cancelHeavy = true; this.abortBg(e); }
    this.list = this.list.filter(x => x.id !== id); this.chips();
  },
  chips() {
    const tray = $('#as-att'); if (!tray) return; tray.innerHTML = ''; tray.hidden = !this.list.length;
    const pl = this.list.length ? this.plan(this.list) : {};
    for (const e of this.list) tray.append(this.chip(e, true, pl[e.id]));
  },
  // live: chip in the tray (plan = what would be sent now). Not live: chip in the chat history (tokensSent/tokensTotal).
  chip(e, live, pl) {
    const total = live ? (pl ? pl.total : 0) : (e.tokensTotal || 0);
    const send = live ? (pl ? pl.send : 0) : (e.tokensSent || 0);
    const src = live ? (pl ? pl.src : 'estimate') : (e.tokSrc || 'estimate');
    const over = e.state !== 'bad' && total > 0 && send < total;
    const busy = e.state === 'work' || e.state === 'wait' || e.state === 'heavy';
    const st = over ? 'over' : e.state === 'ok' ? (e.note ? 'warn' : 'ok') : e.state;
    const c = h('div', { class: 'at-chip at-card ' + st, 'data-att': e.id || '', title: [e.name, e.size ? this.fmt(e.size) : '', e.error || e.note || ''].filter(Boolean).join(' · ') },
      h('div', { class: 'at-row' },
        h('span', { class: 'ic', html: iconSvg(this.ICON[e.kind] || 'paperclip', 14) }), h('span', { class: 'nm' }, e.name),
        busy ? h('span', { class: 'pg' }, h('i', { style: `width:${Math.round(e.pct || 0)}%` })) : h('span', { class: 'st' }, e.state === 'bad' ? '⚠️' : over ? '◐' : e.note ? '⚠' : '✓')));
    if (total > 0 && e.state !== 'bad') {
      const label = over ? t(live ? 'v2682.will_send' : 'v2682.were_sent', { x: send, y: total }) : t('v2682.all_fit', { y: total });
      c.append(h('div', { class: 'at-tok' + (over ? ' over' : '') }, label + ' · ', h('span', { class: 'at-src ' + src, title: src !== 'measured' && e.tk && e.tk.why ? e.tk.why : null, 'data-why': src !== 'measured' && e.tk && e.tk.why ? e.tk.why : null }, this.srcLabel(src))));
    }
    if (e.kind === 'zip' && (e.children || e.files)) c.append(this.fileList(e, live ? send : null));
    const meta = this.stageLine(e, live);
    if (meta) c.append(h('div', { class: 'at-meta muted' }, meta));
    // v2.6.9.2: the cause is written on the chip itself (was only in the tooltip)
    if (e.note && e.state === 'ok') c.append(h('div', { class: 'at-note', 'data-note': '1' }, '⚠ ' + e.note));
    if (live && e.state === 'heavy') c.append(h('button', { class: 'at-cancel', type: 'button', onclick: () => this.cancelHeavy(e) }, t('v2681.att_cancel')));
    if (live && e.state === 'ok' && (e.text || e.children) && !e.summary && (over || e.kind === 'zip' || e.kind === 'code')) c.append(h('button', { class: 'at-sum', type: 'button', onclick: () => this.summaryJob(e) }, t('v2682.summary_btn')));
    if (live && e.summary) c.append(h('div', { class: 'at-meta muted' }, t('v2682.summary_ready')));
    if (live && this._pauser && this._pauser.paused && e.state === 'heavy') c.append(h('div', { class: 'at-meta muted' }, t('v2682.paused')));
    if (live) c.append(h('button', { class: 'x', title: t('v25.at_remove'), html: iconSvg('x', 11), onclick: () => this.remove(e.id) }));
    return c;
  },
  // Zip file list on the chip: path · size · tokens; ● sent in full, ◑ short digest (manifest / CHANGELOG), ○ only listed.
  fileList(e, cap) {
    const rows = e.files || this.zipRows(e).map(r => ({ name: r.name, size: r.size, tokens: r.tokens, bad: r.bad }));
    let inc = new Set(), dig = new Set();
    if (e.children) { const zp = NyxTok.zipPlan(this.zipRows(e), cap == null ? (e.tokensSent || 0) : cap, { fmt: (x) => this.fmt(x) }); inc = new Set(zp.included); dig = new Set(zp.digested); }
    else { inc = new Set(rows.filter(r => r.how === 'full').map(r => r.name)); dig = new Set(rows.filter(r => r.how === 'digest').map(r => r.name)); }
    const d = h('details', { class: 'at-files' }, h('summary', {}, t('v2682.zip_list', { n: rows.length, full: inc.size, digest: dig.size })));
    const ul = h('ul', {});
    for (const r of rows) ul.append(h('li', { class: inc.has(r.name) ? 'full' : dig.has(r.name) ? 'digest' : 'listed' }, (inc.has(r.name) ? '● ' : dig.has(r.name) ? '◑ ' : '○ ') + r.name + ' · ' + this.fmt(r.size) + ' · ' + (r.bad ? '⚠' : r.tokens + ' tok')));
    d.append(ul);
    return d;
  },
  stageLine(e, live) {
    const parts = (e.stages || []).map(s => t('v2681.att_stage', { name: s.label || s.id, time: this.sec(s.ms || 0), tokens: s.tokens != null ? String(s.tokens) : '—' }));
    if (live) { const b = this.budget(); if (b.nCtx && (e.state === 'ok' || e.state === 'heavy' || e.stages?.length)) parts.push(t('v2682.budget', { cap: b.cap, nctx: b.nCtx, base: b.histTok, reserve: b.reserve, margin: b.margin, src: b.source })); }
    return parts.join(' · ');
  },
  prog(e, pct, step) { e.pct = pct; if (step) e.step = step; this.chips(); },
  markStage(e, id, label, t0, extra) {
    const rec = { id, label, ms: this.ms(t0), tokens: extra && extra.tokens, note: extra && extra.note };
    const i = (e.stages || []).findIndex(s => s.id === id);
    if (i >= 0) e.stages[i] = rec; else (e.stages || (e.stages = [])).push(rec);
    if (!e._child) this.chips();
    return rec;
  },
  // ---------- fast stage (no LLM) ----------
  async fast(e) {
    e.state = 'work'; if (!e._child) this.prog(e, 5);
    const t0 = Date.now();
    let info;
    if (e.media) info = { name: e.name, size: e.size, kind: this.kindOfName(e.name) };
    else { info = await API.inv('att:inspect', e.path); Object.assign(e, { size: info.size, kind: info.kind, mtime: info.mtime }); }
    e.kind = info.kind; e.hash = this.hashOf(e, info);
    const hit = this.fromCache(e.hash);
    // v2.6.9.2: an image whose description failed is not served from the cache (re-adding it asks again)
    if (hit && (hit.text || hit.summary)) {
      Object.assign(e, { text: hit.text, summary: hit.summary, note: hit.note, tree: hit.tree, children: hit.children, skipped: hit.skipped, pages: hit.pages, frames: hit.frames, via: hit.via, stages: (hit.stages || []).map(s => ({ ...s })) });
      this.markStage(e, 'cache', t('v2681.att_cache'), t0, { tokens: this.tok(e.text || e.summary || '', e.kind) });
      e.state = 'ok'; e.pct = 100; e.fastOk = true;
      if (!e._child) this.measure(e);
      return;
    }
    if (info.error) { e.state = 'bad'; e.error = info.code === 'BINARY' ? t('v25.at_unsupported', { ext: (e.name.split('.').pop() || '?').toLowerCase() }) : info.error; return; }
    if (info.text != null) { e.text = info.text; if (info.truncated) e.note = t('v25.at_truncated'); }
    else if (e.kind === 'zip') await this.zip(e);
    else if (e.kind === 'pdf') { if (!e.media) { const r = await API.importPath(e.path); e.media = r.file; } if (!e._child) this.prog(e, 25); await this.pdf(e); }
    else if (['image', 'audio', 'video'].includes(e.kind)) {
      if (!e.media) { const r = await API.importPath(e.path); e.media = r.file; }
      e.needsHeavy = !e._child;
      if (e._child) { e.state = 'ok'; e.note = t('v2682.zip_media_listed'); e.text = ''; e.fastOk = true; return; }
    } else if (e.text == null) { e.state = 'bad'; e.error = t('v25.at_unsupported', { ext: (e.name.split('.').pop() || '?').toLowerCase() }); return; }
    this.markStage(e, 'fast', t('v2681.att_fast'), t0, { tokens: this.tok(e.text || '', e.kind) });
    e.fastOk = true;
    const needsOcr = e.kind === 'pdf' && e.needsOcr && !e._child;
    const mediaHeavy = !!(e.needsHeavy);
    if (!e.text && !e.children?.length && e.kind !== 'image' && e.kind !== 'audio' && e.kind !== 'video' && !needsOcr) { e.state = 'bad'; e.error ||= t('v25.at_empty'); return; }
    // Over the budget is not a reason for background work any more: the text is trimmed at send, a summary only on request.
    e.state = (needsOcr || mediaHeavy) ? 'heavy' : 'ok';
    e.pct = (e.state === 'ok') ? 100 : 55;
    this.toCache(e);
    if (!e._child && e.text) this.measure(e);
    // Heavy in the background — never blocks send, pauses while a message is being answered.
    if (e.state === 'heavy') e.heavyDone = this.heavy(e).catch(err => { if (!e.cancelHeavy) e.note = cleanErr(err); }).finally(() => { if (!e.cancelHeavy && e.state !== 'bad') e.state = 'ok'; e.pct = 100; this.toCache(e); if (e.text) this.measure(e); this.chips(); });
  },
  fits(text, kind) { return this.tok(text, kind) <= this.budget().cap; },
  cancelHeavy(e) { e.cancelHeavy = true; this.abortBg(e); e.note = t('v2681.att_cancelled'); e.state = e.fastOk ? 'ok' : 'bad'; e.pct = 100; this.chips(); },
  // ---------- background model calls: own stream id, pause on send, resume after ----------
  pauser() { return this._pauser || (this._pauser = NyxTok.Pauser()); },
  pauseHeavy() {
    this.pauser().pause();
    for (const id of this._bgStreams) { this._pausedIds.add(id); try { API.inv('ai:chatAbort', id).catch(() => {}); } catch (e) {} }
    this.chips();
  },
  resumeHeavy() { this.pauser().resume(); this.chips(); },
  abortBg(e) { for (const id of (e && e._bg) || []) { try { API.inv('ai:chatAbort', id).catch(() => {}); } catch (er) {} } },
  // v2.6.9.2: background requests (vision, video frames, summaries) always ask WITHOUT thinking. Qwen3.8 on the router
  // thinks by default («preserving reasoning enabled»): with max_tokens 400 the thinking ate every token and the content
  // came back empty → «χωρίς ανάλυση εικόνας». If the answer is still empty (server ignored enable_thinking, or it hit
  // the length limit), the 2.6.9 rule applies: ask once more without the max_tokens limit, and say so on the chip.
  async llm(task, messages, opts = {}, e) {
    const r = await this.llmRaw(task, messages, opts, e);
    if (r.text || opts.noReask) return r.text;
    if (e) (e.notes2692 ||= []).push(t('v2692.reask_empty', { v0: r.finish || '—', v1: r.reasoningN }));
    const r2 = await this.llmRaw(task, messages, { ...opts, max_tokens: 0 }, e);
    if (r2.text) return r2.text;
    throw Object.assign(new Error(t('v2692.empty_answer', { v0: r2.model || '—', v1: r2.finish || '—', v2: r2.reasoningN })), { code: 'EMPTY', finish: r2.finish });
  },
  async llmRaw(task, messages, opts = {}, e) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await this.pauser().wait();
      if (e && e.cancelHeavy) throw Object.assign(new Error('cancelled'), { code: 'ABORTED' });
      let pm;
      try { pm = await AI.pickModel(task); }
      catch (er) { if (!er.code) er.code = 'NOMODEL'; throw er; }
      const { p, m } = pm;
      const id = 'bg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      this._bgStreams.add(id); if (e) (e._bg ||= new Set()).add(id);
      try {
        const body = { model: m, messages, temperature: opts.temperature ?? 0.3, chat_template_kwargs: { enable_thinking: false }, _streamId: id, _bg: true };
        if (opts.max_tokens !== 0) body.max_tokens = opts.max_tokens || 700;
        const r = await invokeChat(p, body);
        this._via = p.name || p.id;
        const reasoning = r.message?.reasoning_content || r.reasoning || '';
        const text = stripThink(r.message?.content || '', reasoning).trim();
        return { text, finish: r.finish || r.finish_reason || '', reasoningN: reasoning ? (r.reasoning_n || this.tok(String(reasoning))) : 0, model: String(m || '').split(/[\\/]/).pop(), via: this._via };
      } catch (er) {
        // Aborted because the user pressed send: wait for the reply to finish, then do this step again.
        if (this._pausedIds.has(id) || this.pauser().paused) { this._pausedIds.delete(id); continue; }
        throw er;
      } finally { this._bgStreams.delete(id); if (e && e._bg) e._bg.delete(id); }
    }
    throw new Error('paused too often');
  },
  // ---------- heavy stage (vision, whisper, frames, OCR-if-empty) ----------
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
    this.markStage(e, 'heavy', t('v2681.att_heavy'), t0, { tokens: this.tok(e.summary || e.text || '') });
    this.toCache(e);
  },
  // «Περίληψη» on the chip: the only way a summary is made. Background, pausable, cancellable.
  async summaryJob(e) {
    if (e.summarizing) return;
    e.summarizing = true; e.cancelHeavy = false; const prev = e.state; e.state = 'heavy'; this.prog(e, 5, 'summary');
    const t0 = Date.now();
    try {
      const text = e.kind === 'zip' && e.children ? this.zipRows(e).filter(r => r.text).map(r => `### ${r.name}\n${r.text}`).join('\n\n') : (e.text || '');
      e.summary = await this.summarize(text, e.name, (p) => { if (e.cancelHeavy) throw Object.assign(new Error('cancelled'), { code: 'ABORTED' }); this.prog(e, 5 + p * 90); }, e);
      this.markStage(e, 'summary', t('v25.at_summary'), t0, { tokens: this.tok(e.summary) });
    } catch (er) { if (!e.cancelHeavy) e.note = t('v25.at_nosum') + (er && er.code !== 'ABORTED' ? ' — ' + (er.code === 'NOMODEL' ? cleanErr(er) : this.visionCause(er)) : ''); }
    finally { e.summarizing = false; if (e.state === 'heavy') e.state = prev === 'bad' ? 'bad' : 'ok'; e.pct = 100; this.toCache(e); this.chips(); }
  },
  kindOfName(n) { const x = (n.split('.').pop() || '').toLowerCase(); return /^(jpe?g|png|webp|gif|bmp|avif|heic|tiff?)$/.test(x) ? 'image' : /^(mp4|mov|mkv|webm|avi|m4v)$/.test(x) ? 'video' : /^(mp3|wav|m4a|ogg|opus|flac|aac)$/.test(x) ? 'audio' : x === 'pdf' ? 'pdf' : 'unknown'; },
  async image(e) {
    if (e.cancelHeavy) return;
    const parts = []; let ok = false;
    if (/win/i.test(V2.info?.platform || '')) { try { const o = await API.inv('sys:ocr', e.media, 'el'); if (o?.trim()) { parts.push(t('v25.at_ocr') + ':\n' + o.trim()); ok = true; } } catch (er) {} }
    this.prog(e, 70);
    if (e.cancelHeavy) return;
    let cause = '';
    try { const d = await this.vision(e.media, t('v25.at_vprompt'), e); if (d) { parts.unshift(t('v25.at_desc') + ': ' + d); ok = true; e.via = this._via; } } catch (er) { if (!e.cancelHeavy) cause = this.visionCause(er); }
    e.text = parts.join('\n\n');
    // v2.6.9.2: the chip says the real reason; «ρύθμισε τη θέση Όραση» only when the slot is really empty
    if (cause) e.note = cause; else if (!ok && !e.note) e.note = t('v2692.no_desc');
    if (e.notes2692 && e.notes2692.length) e.note = [e.note, ...e.notes2692].filter(Boolean).join(' · ');
  },
  visionCause(er) {
    if (!er) return '';
    if (er.code === 'NOMODEL') return t('v25.at_novision');
    if (er.code === 'EMPTY') return er.message;
    const msg = cleanErr(er);
    if (er.code === 'TIMEOUT' || /time ?out|timed out|ETIMEDOUT/i.test(msg)) return t('v2692.vision_timeout', { v0: msg });
    return t('v2692.vision_error', { v0: msg || '—' });
  },
  async vision(file, prompt, e) {
    const url = await API.inv('ai:imageData', file);
    const msgs = [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] }];
    try { return await this.llm('vision', msgs, { temperature: 0.2, max_tokens: 400 }, e); }
    catch (e1) {
      if (e && e.cancelHeavy) throw e1;
      const g = AI.enabled().find(p => p.id === 'groq' || /groq\.com/.test(p.base || ''));
      if (!g || Private?.on) throw e1;
      let r; try { r = await API.inv('ai:chat', g, { model: Store.state.settings.agent?.groqVision || 'meta-llama/llama-4-scout-17b-16e-instruct', messages: msgs, temperature: 0.2, max_tokens: 400 }); } catch (e2) { throw e1; } // the local cause is the one to show
      const txt = stripThink(r.message?.content || '').trim(); if (!txt) throw e1;
      this._via = 'Groq'; return txt;
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
    const frames = []; let dur = 0; let frameCause = '';
    try { dur = (await API.inv('video:probe', e.media))?.duration || 0; } catch (er) {}
    const ts = dur > 0 ? [0.1, 0.5, 0.9].map(f => +(dur * f).toFixed(2)) : [0];
    for (const tt of ts) {
      if (e.cancelHeavy) break;
      try { const f = await API.inv('video:frame', e.media, tt); let d = ''; try { d = await this.vision(f, t('v25.at_vprompt_frame'), e); } catch (er) { frameCause ||= this.visionCause(er); } frames.push({ t: tt, file: f, desc: d }); } catch (er) { break; }
    }
    e.frames = frames; this.prog(e, 88);
    const fx = frames.filter(f => f.desc).map(f => `[${f.t.toFixed(1)}s] ${f.desc}`).join('\n');
    e.text = [transcript, fx ? t('v25.at_frames') + ':\n' + fx : ''].filter(Boolean).join('\n\n');
    if (!e.text) e.error = err || t('v25.at_novideo'); else if (!transcript || !fx) e.note = !transcript ? (err || t('v25.at_nospeech')) : (frameCause || t('v2692.no_desc'));
  },
  async pdf(e) {
    const doc = await Extras.pdfDoc({ file: e.media }); let out = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent(); out += `\n[${p}] ` + tc.items.map(x => x.str).join(' ');
      if (p % 2 === 0) await new Promise((r) => setTimeout(r, 0));
      if (p % 10 === 0 && !e._child) this.prog(e, 25 + 55 * p / doc.numPages);
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
  // Zip: read every file (text extraction only, no LLM, no vision), keep them per file. The send builds a file list
  // and adds the full files that fit (text/code first, smallest first); manifest / CHANGELOG get a short digest.
  async zip(e) {
    const r = await API.inv('att:unzip', e.path); this.prog(e, 30);
    e.tree = r.text; e.skipped = r.skipped; const files = r.all.filter(n => n.kind !== 'zip');
    const kids = []; const MAXF = Store.state.settings.agent?.zipMaxFiles || 40;
    for (const [i, n] of files.entries()) {
      if (i >= MAXF) { kids.push({ name: n.rel, size: n.size, kind: n.kind, state: 'bad', error: t('v25.at_zip_more') }); continue; }
      const k = { path: n.path, name: n.rel, size: n.size, kind: n.kind, state: 'wait', pct: 0, stages: [], _child: true };
      try { await this.fast(k); } catch (er) { k.state = 'bad'; k.error = cleanErr(er); }
      kids.push({ name: k.name, size: k.size, kind: k.kind, state: k.state, text: k.text || '', error: k.error || '', note: k.note || '', media: k.media || '' });
      this.prog(e, 30 + 50 * (i + 1) / Math.min(files.length, MAXF));
    }
    e.children = kids;
    const bad = kids.filter(k => k.state === 'bad');
    // Full text (for read_attachment and for one /tokenize of the whole zip).
    e.text = t('v25.at_ztree', { n: r.files, size: this.fmt(r.total) }) + '\n' + r.text +
      (r.skipped.length ? '\n\n' + t('v25.at_zskip') + ':\n' + r.skipped.map(s => `- ${s.rel}: ${s.reason}`).join('\n') : '') +
      kids.filter(k => k.state !== 'bad' && k.text).map(k => `\n\n### ${k.name}\n` + k.text).join('') +
      (bad.length ? '\n\n' + t('v25.at_zbad') + ':\n' + bad.map(k => `- ${k.name}: ${k.error}`).join('\n') : '');
    if (bad.length || r.skipped.length) e.note = t('v25.at_zpartial', { n: bad.length + r.skipped.length });
  },
  chunks(text, size) {
    size = size || Math.max(2000, Math.floor(this.budget().cap * NyxTok.charsPerToken(text) * 0.5));
    const out = []; let i = 0;
    while (i < text.length) { let j = Math.min(text.length, i + size); if (j < text.length) { const cut = text.lastIndexOf('\n', j); if (cut > i + size * 0.6) j = cut; } out.push(text.slice(i, j)); i = j; }
    return out;
  },
  async summarize(text, name, onp, e) {
    // Chunk size follows the real budget, not a fixed character cap. Sample at most what fits a few rounds.
    let ch = this.chunks(text); const total = ch.length;
    const maxCh = Math.max(4, Math.min(16, Math.ceil(this.budget().cap / 800)));
    if (ch.length > maxCh) { const step = ch.length / maxCh; ch = Array.from({ length: maxCh }, (_, i) => ch[Math.floor(i * step)]); }
    const parts = [];
    for (const [i, c] of ch.entries()) { parts.push(await this.llm('summarize', [{ role: 'user', content: t('v25.at_sum_chunk', { name, i: i + 1, n: ch.length, text: c }) }], {}, e)); onp?.((i + 1) / (ch.length + 1)); }
    const fin = await this.llm('summarize', [{ role: 'user', content: t('v25.at_sum_final', { name, parts: parts.map((p, i) => `(${i + 1}) ${p}`).join('\n') }) }], {}, e);
    return fin + (total > ch.length ? '\n' + t('v25.at_sampled', { n: ch.length, total }) : '');
  },
  // ---------- hand-off to the assistant. Never waits for the heavy stage. ----------
  // Send uses what the fast stage has now (a fast read that is about to finish gets a short grace).
  async take(graceMs) {
    const L = this.list.slice(); if (!L.length) return null;
    const grace = graceMs == null ? 400 : graceMs;
    await Promise.race([Promise.all(L.map(e => e.fastReady || Promise.resolve())), new Promise(r => setTimeout(r, grace))]);
    // v2.6.9.1: an attachment counted while the model was not loaded yet is measured again at send time (once; never starts a load)
    const est = L.filter(e => e.text && !e._child && e.tk && e.tk.src !== 'measured');
    if (est.length) await Promise.race([Promise.all(est.map(e => this.measure(e).catch(() => null))), new Promise(r => setTimeout(r, 1500))]);
    this.list = []; this.chips(); this.last = L; return L;
  },
  meta(L) { const M = L.map(e => ({ name: e.name, kind: e.kind, ok: e.state !== 'bad', note: e.error || e.note || '', size: e.size || 0, media: e.media || '', tokensSent: e.tokensSent || 0, tokensTotal: e.tokensTotal || 0, tokSrc: e.tokSrc || '', files: e.files || undefined, stages: e.stages || [] })); this._metaRefs = { L, M }; return M; },
  syncMeta() {
    const R = this._metaRefs; if (!R) return;
    R.L.forEach((e, i) => { const m = R.M[i]; if (!m) return; m.tokensSent = e.tokensSent || 0; m.tokensTotal = e.tokensTotal || 0; m.tokSrc = e.tokSrc || ''; if (e.files) m.files = e.files; });
  },
  context(L = this.last) {
    if (!L?.length) return '';
    const b = this.budget();
    const pl = this.plan(L, b);
    this._blocks = [];
    let s = '\n\n' + t('v25.at_ctx_head') + '\n' + t('v2682.budget', { cap: b.cap, nctx: b.nCtx, base: b.histTok, reserve: b.reserve, margin: b.margin, src: b.source }) + '\n';
    for (const e of L) {
      const p = pl[e.id];
      let body = '', sent = 0, total = 0, src = 'estimate';
      if (e.state !== 'bad' && p) {
        total = p.total; src = p.src;
        if (e.kind === 'zip' && e.children) {
          const zp = NyxTok.zipPlan(p.item.zip, Math.max(0, p.send - (p.item.sum || 0)), { fmt: (x) => this.fmt(x) });
          body = t('v2682.zip_head', { n: zp.rows.length, full: zp.included.length, digest: zp.digested.length }) + '\n' + zp.manifest +
            zp.parts.map(x => `\n\n#### ${x.r.name}${x.how === 'digest' ? ' (' + t('v2682.digest') + ')' : ''}\n` + x.body).join('') +
            (zp.listed.length ? '\n\n' + t('v2682.zip_listed', { n: zp.listed.length }) : '');
          if (e.summary) body = t('v25.at_summary') + ':\n' + e.summary + '\n\n' + body;
          sent = Math.min(p.total, zp.used + (p.item.sum || 0));
          e.files = zp.rows.map(r => ({ name: r.name, size: r.size, tokens: r.tokens, bad: r.bad, how: zp.included.includes(r.name) ? 'full' : zp.digested.includes(r.name) ? 'digest' : 'listed' }));
        } else if (!e.text && !e.summary) {
          body = e.state === 'heavy' || e.state === 'work' || e.state === 'wait' ? t('v2682.still_reading') : '';
          sent = 0; total = 0;
        } else {
          const full = p.item.body;
          if (p.send < p.total) { body = NyxTok.sliceToTokens(full, p.send, p.total) + '\n… ' + t('v2682.cut_note', { x: p.send, y: p.total }) + ' ' + t('v25.at_more'); sent = p.send; }
          else { body = full; sent = p.total; }
          if (p.item.usedSummary) body = t('v25.at_summary') + ':\n' + body;
        }
      }
      e.tokensSent = sent; e.tokensTotal = total; e.tokSrc = src;
      s += `\n### ${e.name} (${e.kind}${e.size ? ', ' + this.fmt(e.size) : ''}${e.media ? ', media=' + e.media : ''}, tokens=${sent}${total > sent ? '/' + total : ''})\n`;
      if (e.state === 'bad') { s += '⚠️ ' + t('v25.at_cant', { name: e.name }) + ': ' + e.error + '\n'; continue; }
      if (e.note) s += '(' + e.note + ')\n';
      if (body) { this._blocks.push({ e, body, tokens: sent, total }); s += body + '\n'; }
    }
    this.syncMeta();
    return s;
  },
  // Pre-send check (called by chatTurn after the server counted the prompt). Trim attachment text until
  // prompt + reserve ≤ n_ctx. Visible notice, chips show «στάλθηκαν X από Y».
  async fitPrompt(msgs, prep, onNotice, reprep) {
    const B = this._blocks; if (!B || !B.length || !prep || !prep.n_ctx || prep.promptTokens == null) return null;
    const reserve = this.budget().reserve;
    let cur = prep, trimmed = false;
    for (let loop = 0; loop < 4; loop++) {
      const over = (+cur.promptTokens) + reserve - (+cur.n_ctx);
      if (!(over > 0)) break;
      const live = B.filter(b => b.tokens > 0 && msgs.some(m => m && typeof m.content === 'string' && m.content.includes(b.body)));
      if (!live.length) break;
      const r = NyxTok.shrinkBlocks(msgs, live, over, (x, y) => '\n… ' + t('v2682.cut_note', { x, y }));
      if (!r.changed) break;
      trimmed = true;
      cur = await reprep(msgs);
      if (!cur || cur.promptTokens == null) break;
    }
    if (!trimmed) return null;
    for (const b of B) b.e.tokensSent = b.tokens;
    this.syncMeta();
    const sent = B.reduce((n, b) => n + b.tokens, 0), total = B.reduce((n, b) => n + (b.total || b.tokens), 0);
    if (onNotice) onNotice('warn', t('v2682.fit_notice', { x: sent, y: total, p: cur.promptTokens, n: cur.n_ctx, src: cur.tokSrc === 'tokenize' ? t('v2682.measured') : t('v2682.estimated') }));
    return cur;
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
