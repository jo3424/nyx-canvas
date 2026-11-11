'use strict';
// v2.5 — assistant attachments: drop / paperclip any file, local-first understanding.
// Images → vision (local Qwen3.8-27B + mmproj via the Router «vision» slot, else Groq vision) + Windows OCR; audio/video → whisper + ffmpeg keyframes;
// PDF → pdf.js; DOCX/XLSX/PPTX/ODT/CSV/TXT/MD/code → text (main/attach.js); ZIP → safe extract + recursion.
// Big texts are chunked and summarised (map-reduce). Unreadable files are reported clearly.
const Att = {
  list: [], last: [], seq: 0, busy: 0, MAXCTX: 24000, CHUNK: 6000,
  ICON: { image: 'image', audio: 'audio-lines', video: 'film', pdf: 'file-text', docx: 'file-text', xlsx: 'sheet', pptx: 'presentation', odt: 'file-text', csv: 'sheet', text: 'file-text', code: 'file-code', zip: 'file-archive', unknown: 'file-question-mark' },
  fmt(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B'; },
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
        // Stream large drops in chunks so the renderer is not frozen on a single arrayBuffer().
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
    for (const p of paths) {
      const e = typeof p === 'string' ? { path: p, name: p.split(/[\\/]/).pop() } : { ...p };
      Object.assign(e, { id: 'a' + (++this.seq), state: 'wait', pct: 0, kind: e.kind || '' }); this.list.push(e);
      e.done = this.process(e).catch(err => { e.state = 'bad'; e.error = cleanErr(err); }).finally(() => this.chips());
    }
    this.chips(); Assistant.show?.();
  },
  remove(id) { this.list = this.list.filter(x => x.id !== id); this.chips(); },
  chips() {
    const tray = $('#as-att'); if (!tray) return; tray.innerHTML = ''; tray.hidden = !this.list.length;
    for (const e of this.list) tray.append(this.chip(e, true));
  },
  chip(e, live) {
    const st = e.state === 'ok' ? (e.note ? 'warn' : 'ok') : e.state;
    const c = h('span', { class: 'at-chip ' + st, title: [e.name, e.size ? this.fmt(e.size) : '', e.error || e.note || ''].filter(Boolean).join(' · ') },
      h('span', { class: 'ic', html: iconSvg(this.ICON[e.kind] || 'paperclip', 14) }), h('span', { class: 'nm' }, e.name),
      e.state === 'work' || e.state === 'wait' ? h('span', { class: 'pg' }, h('i', { style: `width:${Math.round(e.pct || 0)}%` })) : h('span', { class: 'st' }, e.state === 'bad' ? '⚠️' : e.note ? '⚠' : '✓'));
    if (live) c.append(h('button', { class: 'x', title: t('v25.at_remove'), html: iconSvg('x', 11), onclick: () => this.remove(e.id) }));
    return c;
  },
  prog(e, pct, step) { e.pct = pct; if (step) e.step = step; this.chips(); },
  // ---------- understanding ----------
  async process(e) {
    e.state = 'work'; this.prog(e, 5);
    let info;
    if (e.media) info = { name: e.name, size: e.size, kind: this.kindOfName(e.name) };
    else { info = await API.inv('att:inspect', e.path); Object.assign(e, { size: info.size, kind: info.kind }); }
    e.kind = info.kind; this.chips();
    if (info.error) { e.state = 'bad'; e.error = info.code === 'BINARY' ? t('v25.at_unsupported', { ext: (e.name.split('.').pop() || '?').toLowerCase() }) : info.error; return; }
    if (info.text != null) { e.text = info.text; if (info.truncated) e.note = t('v25.at_truncated'); }
    else if (e.kind === 'zip') await this.zip(e);
    else if (['image', 'audio', 'video', 'pdf'].includes(e.kind)) { if (!e.media) { const r = await API.importPath(e.path); e.media = r.file; } this.prog(e, 25); await this[e.kind](e); }
    else { e.state = 'bad'; e.error = t('v25.at_unsupported', { ext: (e.name.split('.').pop() || '?').toLowerCase() }); return; }
    this.prog(e, 85);
    if (e.text && e.text.length > 12000) { try { e.summary = await this.summarize(e.text, e.name, (p) => this.prog(e, 85 + p * 14)); } catch (er) { e.note = t('v25.at_nosum'); } }
    if (!e.text && !e.children?.length && e.kind !== 'image') { e.state = 'bad'; e.error ||= t('v25.at_empty'); return; }
    e.state = 'ok'; e.pct = 100;
  },
  kindOfName(n) { const x = (n.split('.').pop() || '').toLowerCase(); return /^(jpe?g|png|webp|gif|bmp|avif|heic|tiff?)$/.test(x) ? 'image' : /^(mp4|mov|mkv|webm|avi|m4v)$/.test(x) ? 'video' : /^(mp3|wav|m4a|ogg|opus|flac|aac)$/.test(x) ? 'audio' : x === 'pdf' ? 'pdf' : 'unknown'; },
  async image(e) {
    const parts = []; let ok = false;
    if (/win/i.test(V2.info?.platform || '')) { try { const o = await API.inv('sys:ocr', e.media, 'el'); if (o?.trim()) { parts.push(t('v25.at_ocr') + ':\n' + o.trim()); ok = true; } } catch (er) {} }
    this.prog(e, 45);
    try { const d = await this.vision(e.media, t('v25.at_vprompt')); if (d) { parts.unshift(t('v25.at_desc') + ': ' + d); ok = true; e.via = this._via; } } catch (er) { e.note = t('v25.at_novision'); }
    e.text = parts.join('\n\n'); if (!ok && !e.note) e.note = t('v25.at_novision');
  },
  // local vision first (task "vision" → Router vision slot), then Groq vision (free plan) as fallback
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
    try { const r = await API.inv('stt:media', Store.state.settings.ai.stt, e.media, {}); e.text = r?.text?.trim() ? t('v25.at_transcript') + ':\n' + r.text.trim() : ''; if (!e.text) e.note = t('v25.at_nospeech'); }
    catch (er) { e.error = t('v25.at_nowhisper') + ' (' + cleanErr(er) + ')'; }
  },
  async video(e) {
    await this.audio(e); const transcript = e.text || ''; const err = e.error; delete e.error; this.prog(e, 55);
    const frames = []; let dur = 0;
    try { dur = (await API.inv('video:probe', e.media))?.duration || 0; } catch (er) {}
    const ts = dur > 0 ? [0.1, 0.5, 0.9].map(f => +(dur * f).toFixed(2)) : [0];
    for (const tt of ts) { try { const f = await API.inv('video:frame', e.media, tt); let d = ''; try { d = await this.vision(f, t('v25.at_vprompt_frame')); } catch (er) {} frames.push({ t: tt, file: f, desc: d }); } catch (er) { break; } }
    e.frames = frames; this.prog(e, 80);
    const fx = frames.filter(f => f.desc).map(f => `[${f.t.toFixed(1)}s] ${f.desc}`).join('\n');
    e.text = [transcript, fx ? t('v25.at_frames') + ':\n' + fx : ''].filter(Boolean).join('\n\n');
    if (!e.text) e.error = err || t('v25.at_novideo'); else if (!transcript || !fx) e.note = !transcript ? (err || t('v25.at_nospeech')) : t('v25.at_novision');
  },
  async pdf(e) {
    const doc = await Extras.pdfDoc({ file: e.media }); let out = '';
    for (let p = 1; p <= Math.min(doc.numPages, 300); p++) { const tc = await (await doc.getPage(p)).getTextContent(); out += `\n[${p}] ` + tc.items.map(x => x.str).join(' '); if (p % 2 === 0) await new Promise((r) => setTimeout(r, 0)); if (p % 10 === 0) this.prog(e, 25 + 55 * p / doc.numPages); if (out.length > 400000) break; }
    e.pages = doc.numPages; e.text = out.trim(); if (!e.text.replace(/\[\d+\]/g, '').trim()) { e.text = ''; e.error = t('v25.at_pdfscan'); }
  },
  async zip(e) {
    const r = await API.inv('att:unzip', e.path); this.prog(e, 30);
    e.tree = r.text; e.skipped = r.skipped; const files = r.all.filter(n => n.kind !== 'zip');
    const kids = []; const MAXF = Store.state.settings.agent?.zipMaxFiles || 40;
    for (const [i, n] of files.entries()) {
      if (i >= MAXF) { kids.push({ name: n.rel, kind: n.kind, state: 'bad', error: t('v25.at_zip_more') }); continue; }
      const k = { path: n.path, name: n.rel, size: n.size, kind: n.kind, state: 'wait', pct: 0 };
      try { await this.process(k); } catch (er) { k.state = 'bad'; k.error = cleanErr(er); }
      kids.push(k); this.prog(e, 30 + 50 * (i + 1) / Math.min(files.length, MAXF));
    }
    e.children = kids;
    const bad = kids.filter(k => k.state === 'bad');
    e.text = t('v25.at_ztree', { n: r.files, size: this.fmt(r.total) }) + '\n' + r.text +
      (r.skipped.length ? '\n\n' + t('v25.at_zskip') + ':\n' + r.skipped.map(s => `- ${s.rel}: ${s.reason}`).join('\n') : '') +
      kids.filter(k => k.state !== 'bad' && (k.text || k.summary)).map(k => `\n\n### ${k.name}\n` + (k.summary || k.text).slice(0, 3000)).join('') +
      (bad.length ? '\n\n' + t('v25.at_zbad') + ':\n' + bad.map(k => `- ${k.name}: ${k.error}`).join('\n') : '');
    if (bad.length || r.skipped.length) e.note = t('v25.at_zpartial', { n: bad.length + r.skipped.length });
  },
  chunks(text, size = this.CHUNK) {
    const out = []; let i = 0;
    while (i < text.length) { let j = Math.min(text.length, i + size); if (j < text.length) { const cut = text.lastIndexOf('\n', j); if (cut > i + size * 0.6) j = cut; } out.push(text.slice(i, j)); i = j; }
    return out;
  },
  // map-reduce: summarise ≤16 evenly-sampled chunks, then combine. Throws when no model → caller keeps head/tail.
  async summarize(text, name, onp) {
    let ch = this.chunks(text); const total = ch.length;
    if (ch.length > 16) { const step = ch.length / 16; ch = Array.from({ length: 16 }, (_, i) => ch[Math.floor(i * step)]); }
    const parts = [];
    for (const [i, c] of ch.entries()) { parts.push(await AI.text('summarize', t('v25.at_sum_chunk', { name, i: i + 1, n: ch.length, text: c }))); onp?.((i + 1) / (ch.length + 1)); }
    const fin = await AI.text('summarize', t('v25.at_sum_final', { name, parts: parts.map((p, i) => `(${i + 1}) ${p}`).join('\n') }));
    return fin + (total > ch.length ? '\n' + t('v25.at_sampled', { n: ch.length, total }) : '');
  },
  // ---------- hand-off to the assistant ----------
  async take() { const L = this.list.slice(); if (!L.length) return null; await Promise.all(L.map(e => e.done)); this.list = []; this.chips(); this.last = L; return L; },
  meta(L) { return L.map(e => ({ name: e.name, kind: e.kind, ok: e.state !== 'bad', note: e.error || e.note || '', size: e.size || 0, media: e.media || '' })); },
  context(L = this.last) {
    if (!L?.length) return '';
    let s = '\n\n' + t('v25.at_ctx_head') + '\n'; const per = Math.floor(this.MAXCTX / L.length);
    for (const e of L) {
      s += `\n### ${e.name} (${e.kind}${e.size ? ', ' + this.fmt(e.size) : ''}${e.media ? ', media=' + e.media : ''})\n`;
      if (e.state === 'bad') { s += '⚠️ ' + t('v25.at_cant', { name: e.name }) + ': ' + e.error + '\n'; continue; }
      if (e.note) s += '(' + e.note + ')\n';
      const body = e.summary ? t('v25.at_summary') + ':\n' + e.summary + '\n\n' + t('v25.at_head') + ':\n' + e.text.slice(0, 2000) : (e.text || '');
      s += body.slice(0, per) + (body.length > per ? '\n… ' + t('v25.at_more') : '') + '\n';
    }
    return s;
  },
  brief() { return this.last.length ? t('v25.at_brief', { list: this.last.map(e => `${e.name} [${e.kind}${e.state === 'bad' ? ', ⚠️' : ''}]`).join(', ') }) : ''; },
  unreadable(L) { const bad = (L || []).filter(e => e.state === 'bad'); return bad.length ? '⚠️ ' + t('v25.at_unread', { list: bad.map(e => `${e.name} — ${e.error}`).join('; ') }) : ''; },
  all(L = this.last) { const out = []; for (const e of L || []) { out.push(e); if (e.children) out.push(...this.all(e.children)); } return out; },
  find(name) { const A = this.all(); const n = norm(name || ''); return A.find(e => norm(e.name) === n) || A.find(e => norm(e.name).includes(n)); },
};

// ---------- tools the model can call ----------
Object.assign(Cmd.T, {
  list_attachments: { d: t('v25.tl_list_att'), p: {}, async run() { return { ok: true, files: Att.all().map(e => ({ name: e.name, kind: e.kind, size: e.size, readable: e.state !== 'bad', note: e.error || e.note || '', placeable: !!e.media })) }; } },
  read_attachment: { d: t('v25.tl_read_att'), p: { name: { type: 'string' }, offset: { type: 'number' } }, req: ['name'],
    async run(a) { const e = Att.find(a.name); if (!e) return { ok: false, error: t('v25.at_nofile') }; if (e.state === 'bad') return { ok: false, error: e.error }; const o = Math.max(0, +a.offset || 0); const txt = e.text || ''; return { ok: true, name: e.name, total: txt.length, offset: o, text: txt.slice(o, o + 6000), more: o + 6000 < txt.length }; } },
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
