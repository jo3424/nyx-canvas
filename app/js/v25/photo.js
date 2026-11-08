'use strict';
// v2.5 Photographer tools (lazy): shoot/model projects (+ optional model-release / consent doc), before/after compare slider,
// batch upscale/enhance, and «My models & LoRAs» folder picker with strength sliders for sd-server. Neutral: lists only YOUR files.
const SEXUAL_RE = /\b(nude|naked|nsfw|topless|undress|undressing|porn|sex|explicit)\b|γυμν|ξεγύμν|ξεντυ|πορν|σεξ/i;
const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'];
const Photo = {
  // ---------------- projects ----------------
  projects() {
    const list = h('div', { class: 'pj-list' });
    const render = () => {
      list.innerHTML = ''; const P = Store.state.projects;
      if (!P.length) list.append(h('p', { class: 'muted' }, t('v25.pj_empty')));
      for (const p of [...P].sort((a, b) => (b.date || '').localeCompare(a.date || ''))) {
        const b = Store.state.boards.find(x => x.id === p.boardId);
        list.append(h('div', { class: 'pj-row' },
          h('span', { class: 'pj-ic' }, p.kind === 'model' ? '👤' : '📷'),
          h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'muted small' }, [p.date ? ddmm(p.date) : '', p.kind === 'model' ? t('v25.pj_model') : t('v25.pj_shoot'), b ? t('v25.pj_n', { v0: b.items.filter(i => i.type === 'image').length }) : t('v25.pj_noboard'), p.folder || ''].filter(Boolean).join(' · ')),
            p.notes ? h('div', { class: 'small' }, p.notes) : null),
          p.release ? h('button', { class: 'chip ok', title: p.release.name, onclick: () => API.openMedia(p.release.file) }, '📄 ' + t('v25.pj_release_ok')) : h('button', { class: 'chip', title: t('v25.pj_release_h'), onclick: () => this.attachRelease(p, render) }, '📄 ' + t('v25.pj_release_add')),
          h('button', { class: 'ib', title: t('v25.pj_open'), html: iconSvg('circle-arrow-right', 16), onclick: () => { if (b) { App.switchBoard(b.id); close(); } } }),
          p.folder ? h('button', { class: 'ib', title: t('v25.pj_import'), html: iconSvg('folder-input', 16), onclick: () => this.importFolder(p).then(render) }) : null,
          h('button', { class: 'ib', title: t('v25.pj_edit'), html: iconSvg('pencil', 16), onclick: () => this.edit(p, render) }),
          h('button', { class: 'ib', title: t('v25.delete'), html: iconSvg('trash', 16), onclick: () => { if (!confirm(t('v25.pj_del_q'))) return; Store.state.projects = Store.state.projects.filter(x => x.id !== p.id); Store.save(); render(); } })));
      }
    };
    const close = Panels.modal('📷 ' + t('v25.ph_projects'), h('div', {}, h('p', { class: 'muted small' }, t('v25.pj_intro')), list, h('p', { class: 'warn small' }, '⚖️ ' + t('v25.pj_consent'))),
      { wide: true, extra: [h('button', { class: 'btn primary', onclick: () => this.edit(null, render) }, iconSvg('plus', 14), t('v25.pj_new'))] });
    render();
  },
  edit(p, done) {
    const isNew = !p; const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const d = p ? { ...p } : { id: uid(), name: '', kind: 'shoot', date: iso, folder: '', notes: '', release: null };
    const stop = (e) => e.stopPropagation();
    const name = h('input', { class: 'inp', value: d.name, placeholder: t('v25.pj_name_ph'), onkeydown: stop });
    const date = h('input', { class: 'inp', type: 'date', value: d.date });
    const notes = h('textarea', { class: 'inp', rows: 2, onkeydown: stop }, d.notes || '');
    const folder = h('input', { class: 'inp', value: d.folder || '', placeholder: t('v25.pj_folder_ph'), onkeydown: stop });
    const body = h('div', { class: 'pj-form' }, Hub.field(t('v25.pj_name'), name),
      selField(t('v25.pj_kind'), [['shoot', '📷 ' + t('v25.pj_shoot')], ['model', '👤 ' + t('v25.pj_model')]], d.kind, (v) => d.kind = v),
      Hub.field(t('v25.pj_date'), date),
      Hub.field(t('v25.pj_folder'), h('div', { class: 'row gap' }, folder, h('button', { class: 'btn ghost sm', onclick: async () => { const r = await API.inv('sys:pickDir', t('v25.pj_folder')); if (r) folder.value = r; } }, iconSvg('folder', 14)))),
      Hub.field(t('v25.pj_notes'), notes), h('p', { class: 'muted small' }, t('v25.pj_folder_h')));
    Panels.modal((isNew ? '➕ ' : '✏️ ') + t('v25.ph_projects'), body, { okLabel: isNew ? t('v25.pj_create') : t('v25.save'), ok: async () => {
      d.name = name.value.trim() || (d.kind === 'model' ? t('v25.pj_model') : t('v25.pj_shoot')) + ' ' + ddmm(date.value || iso); d.date = date.value; d.notes = notes.value.trim(); d.folder = folder.value.trim();
      if (isNew) {
        const b = { id: uid(), name: d.name, emoji: d.kind === 'model' ? '👤' : '📷', color: PALETTE[(4 + Store.state.boards.length) % PALETTE.length], view: null, items: [] };
        Store.state.boards.push(b); d.boardId = b.id; Store.state.projects.push(d); Store.save(); App.switchBoard(b.id);
        if (d.folder) await this.importFolder(d);
      } else { Object.assign(p, d); const b = Store.state.boards.find(x => x.id === p.boardId); if (b) b.name = d.name; Store.save(); Panels.tabs(); }
      setTimeout(() => this.projects(), 30);
    } });
  },
  async importFolder(p) {
    const r = await API.inv('models:listDir', p.folder, IMG_EXT); if (r.error) { toast(t('v25.sd_nodir', { v0: p.folder }), { kind: 'err' }); return; }
    const b = Store.state.boards.find(x => x.id === p.boardId); if (!b) return;
    const have = new Set(b.items.map(i => i.srcPath).filter(Boolean)); let files = r.files.filter(f => !have.has(f.path));
    if (!files.length) { toast(t('v25.pj_nothing')); return; }
    if (files.length > 300 && !confirm(t('v25.pj_many', { v0: files.length }))) files = files.slice(0, 300);
    if (Store.state.active !== b.id) App.switchBoard(b.id);
    toast('⏳ ' + t('v25.pj_importing', { v0: files.length }), { ms: 3000 });
    const items = await Features.importPaths(files.map(f => f.path), { x: 0, y: 0 });
    items.forEach((it, i) => { if (it) { it.srcPath = files[i].path; it.project = p.id; } }); Store.save(); Canvas.fit?.(items.filter(Boolean));
    toast('✓ ' + t('v25.pj_imported', { v0: items.filter(Boolean).length }));
  },
  async attachRelease(p, done) {
    const f = await API.inv('sys:pickExe', t('v25.pj_release_add'), [{ name: 'PDF / image / doc', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx', 'odt', 'txt'] }]); if (!f) return;
    const r = await API.importPath(f); p.release = { file: r.file, name: r.name, date: new Date().toISOString().slice(0, 10) }; Store.save(); toast('📄 ' + t('v25.pj_release_ok')); done?.();
  },
  // ---------------- before / after ----------------
  compareSelected() {
    const sel = Canvas.selItems().filter(i => i.type === 'image' && i.file);
    let a, b; if (sel.length === 1 && sel[0].before) { a = sel[0].before; b = sel[0].file; } else if (sel.length === 2) { [a, b] = sel.map(i => i.file); if (sel[0].before === sel[1].file) [a, b] = [b, a]; } else return toast(t('v25.cmp_need'));
    this.compare(a, b);
  },
  compare(a, b) {
    const after = h('img', { class: 'cmp-after', src: Store.media(b), draggable: false });
    const line = h('div', { class: 'cmp-line' }, h('span', { html: iconSvg('chevrons-left-right', 18) }));
    const box = h('div', { class: 'cmp' }, h('img', { class: 'cmp-before', src: Store.media(a), draggable: false }), after, line, h('b', { class: 'cmp-l' }, t('v25.cmp_before')), h('b', { class: 'cmp-r' }, t('v25.cmp_after')));
    const set = (p) => { p = Math.max(0, Math.min(100, p)); after.style.clipPath = `inset(0 0 0 ${p}%)`; line.style.left = p + '%'; range.value = p; };
    const range = h('input', { type: 'range', min: 0, max: 100, step: .1, value: 50, class: 'cmp-range', oninput: (e) => set(+e.target.value) });
    const mv = (e) => { const r = box.getBoundingClientRect(); set((e.clientX - r.left) / r.width * 100); };
    box.addEventListener('pointerdown', (e) => { box.setPointerCapture(e.pointerId); mv(e); box.onpointermove = mv; });
    box.addEventListener('pointerup', () => { box.onpointermove = null; });
    Panels.modal('◐ ' + t('v25.ph_compare'), h('div', {}, box, range, h('p', { class: 'muted small' }, t('v25.cmp_tip'))), { wide: true });
    set(50);
    const keys = (e) => { if (!document.contains(box)) return removeEventListener('keydown', keys, true); if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); set(+range.value + (e.key === 'ArrowLeft' ? -2 : 2)); } };
    addEventListener('keydown', keys, true);
  },
  // ---------------- batch upscale / enhance ----------------
  batch() {
    const sel = Canvas.selItems().filter(i => i.type === 'image' && i.file); const all = Store.items().filter(i => i.type === 'image' && i.file && !/^(https?:|data:)/.test(i.file));
    if (!all.length) return toast(t('v25.sel_image'));
    const o = { src: sel.length ? 'sel' : 'all', scale: 1, sharpen: 0.6, vibrance: 0.12, levels: true, quality: 92 };
    const slider = (k, min, max, step, label) => { const v = h('b', {}, o[k]); return h('label', { class: 'field rng' }, h('span', {}, label, ' ', v), h('input', { type: 'range', min, max, step, value: o[k], oninput: (e) => { o[k] = +e.target.value; v.textContent = o[k]; } })); };
    const prog = h('div', { class: 'pbar', hidden: true }, h('i', { style: 'width:0%' })); const lbl = h('small', { class: 'muted' });
    const body = h('div', { class: 'v25-note' },
      selField(t('v25.bt_src'), [['sel', t('v25.bt_sel', { v0: sel.length })], ['all', t('v25.bt_all', { v0: all.length })]], o.src, (v) => o.src = v),
      selField(t('v25.bt_scale'), [['1', '1× (' + t('v25.bt_same') + ')'], ['1.5', '1.5×'], ['2', '2×']], '1', (v) => o.scale = +v),
      slider('sharpen', 0, 1.5, .05, t('v25.bt_sharpen')), slider('vibrance', 0, .5, .01, t('v25.bt_vibrance')),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => o.levels = e.target.checked }), h('span', {}, t('v25.bt_levels'))),
      slider('quality', 70, 100, 1, 'JPEG'), prog, lbl, h('p', { class: 'muted small' }, t('v25.bt_note')));
    Panels.modal('🪄 ' + t('v25.ph_batch'), body, { okLabel: t('v25.bt_go'), ok: async () => {
      const src = (o.src === 'sel' && sel.length ? sel : all); prog.hidden = false;
      const off = API.onPhotoProgress?.((p) => { prog.firstChild.style.width = (p.i / p.of * 100) + '%'; lbl.textContent = `${p.i}/${p.of}`; });
      let res; try { res = await API.inv('photo:enhance', src.map(i => i.file), o); } finally { off?.(); }
      let ok = 0; const added = [];
      for (const r of res) { if (r.error) continue; const it = src.find(i => i.file === r.src); if (!it) continue;
        const n = await Features.addMedia({ file: r.file, name: (it.name || 'photo') + ' ✦' }, it.x + it.w + 24, it.y); if (n) { n.before = it.file; added.push(n); ok++; } }
      Store.save(); if (added.length) Canvas.select(added.map(i => i.id));
      const bad = res.filter(r => r.error); toast(`✓ ${t('v25.bt_done', { v0: ok })}` + (bad.length ? ` · ⚠️ ${bad.length}` : ''), { ms: 6000 });
      if (added.length === 1) this.compare(added[0].before, added[0].file);
    } });
  },
  // ---------------- my models & LoRAs (neutral folder picker) ----------------
  async loras() {
    const S = Store.state.settings; const L = S.loras; const sd = S.ai.servers.sd;
    const dir = L.dir || sd.loraDir || '';
    const listBox = h('div', { class: 'lr-list' }); const tags = h('code', { class: 'lr-tags' });
    const updTags = () => { tags.textContent = this.loraTags() || '—'; };
    const load = async () => {
      listBox.innerHTML = ''; const d = L.dir || sd.loraDir; if (!d) { listBox.append(h('p', { class: 'muted' }, t('v25.lr_pick_first'))); return; }
      const r = await API.inv('models:listDir', d, ['safetensors', 'gguf', 'ckpt', 'pt']);
      if (r.error) { listBox.append(h('p', { class: 'err' }, t('v25.sd_nodir', { v0: d }))); return; }
      if (!r.files.length) { listBox.append(h('p', { class: 'muted' }, t('v25.lr_none'))); return; }
      for (const f of r.files) {
        const key = f.rel.replace(/\\/g, '/').replace(/\.[^.]+$/, ''); const st = L.items[key] ||= { on: false, w: 0.8 };
        const val = h('b', { class: 'lr-w' }, st.w.toFixed(2));
        listBox.append(h('div', { class: 'lr-row' + (st.on ? ' on' : '') },
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: st.on, onchange: (e) => { st.on = e.target.checked; e.target.closest('.lr-row').classList.toggle('on', st.on); Store.save(); updTags(); } }), h('span', { title: f.path }, key)),
          h('small', { class: 'muted' }, fmtMB(f.size)),
          h('input', { type: 'range', min: -1, max: 2, step: .05, value: st.w, oninput: (e) => { st.w = +e.target.value; val.textContent = st.w.toFixed(2); Store.save(); updTags(); } }), val));
      }
      updTags();
    };
    const dirInp = h('input', { class: 'inp', value: dir, readonly: true });
    const prompt = h('textarea', { class: 'inp', rows: 3, placeholder: t('v25.lr_prompt_ph'), onkeydown: (e) => e.stopPropagation() }, L.lastPrompt || '');
    const neg = h('input', { class: 'inp', value: L.lastNeg ?? 'blurry, lowres, plastic skin, oversaturated, deformed hands', onkeydown: (e) => e.stopPropagation() });
    const size = { w: 1024, h: 1024, steps: 24, cfg: 4.5 };
    const num = (k, step) => h('input', { class: 'inp sm', type: 'number', value: size[k], step, onchange: (e) => size[k] = +e.target.value });
    const genBtn = h('button', { class: 'btn primary', onclick: async () => {
      const port = sd.port || 7860; const up = await API.inv('proc:health', `http://127.0.0.1:${port}/`).catch(() => ({ ok: false }));
      if (!up.ok) { const st = await Lazy.run('hub25', () => Hub25.sdStart({ quiet: true })); if (!st?.ok) return toast(t('v25.lr_sd_off'), { kind: 'err', ms: 8000 }); toast('⏳ sd-server …'); for (let k = 0; k < 90; k++) { await new Promise(r => setTimeout(r, 2000)); if ((await API.inv('proc:health', `http://127.0.0.1:${port}/`).catch(() => ({}))).ok) break; } }
      L.lastPrompt = prompt.value; L.lastNeg = neg.value; Store.save();
      const full = [prompt.value.trim(), this.loraTags()].filter(Boolean).join(' ');
      if (SEXUAL_RE.test(full) && /\b(real|celebrity|actress|actor|my (ex|neighbou?r|colleague))\b/i.test(full)) return toast(t('v25.sexual_block'), { kind: 'err', ms: 9000 });
      genBtn.disabled = true; genBtn.lastChild.textContent = ' ' + t('v25.lr_generating');
      try { const r = await API.inv('sd:txt2img', { port, prompt: full, negative: neg.value, width: size.w, height: size.h, steps: size.steps, cfg: size.cfg });
        const c = Canvas.center(); let i = 0; for (const f of r.files) await Features.addMedia({ file: f, name: 'sd · ' + prompt.value.slice(0, 40) }, c.x + (i++) * 40, c.y); toast('✓ sd-server');
      } catch (e) { toast('⚠️ ' + cleanErr(e), { kind: 'err', ms: 10000 }); } finally { genBtn.disabled = false; genBtn.lastChild.textContent = ' ' + t('v25.lr_generate'); }
    } }, iconSvg('sparkles', 14), h('span', {}, ' ' + t('v25.lr_generate')));
    const body = h('div', { class: 'lr' },
      h('p', { class: 'muted small' }, t('v25.lr_intro')),
      Hub.field(t('v25.lr_dir'), h('div', { class: 'row gap' }, dirInp, h('button', { class: 'btn ghost sm', onclick: async () => { const r = await API.inv('sys:pickDir', t('v25.lr_dir')); if (r) { L.dir = r; dirInp.value = r; if (!sd.loraDir) sd.loraDir = r; Store.save(); load(); } } }, iconSvg('folder', 14)))),
      listBox, h('div', { class: 'row gap' }, h('span', { class: 'small' }, t('v25.lr_tags')), tags, h('button', { class: 'btn ghost sm', onclick: () => { navigator.clipboard.writeText(this.loraTags()); toast('📋'); } }, iconSvg('copy', 13))),
      h('hr'), Hub.field(t('v25.lr_prompt'), prompt), Hub.field(t('v25.lr_neg'), neg),
      h('div', { class: 'row gap wrap' }, Hub.field('W', num('w', 64)), Hub.field('H', num('h', 64)), Hub.field('steps', num('steps', 1)), Hub.field('cfg', num('cfg', .5))),
      h('p', { class: 'muted small' }, t('v25.lr_real_tip')), h('p', { class: 'warn small' }, '⚖️ ' + t('v25.consent_note')));
    Panels.modal('🧩 ' + t('v25.lora_title'), body, { wide: true, extra: [genBtn, h('button', { class: 'btn ghost', onclick: () => Lazy.run('hub25', () => Hub25.openSdUi()) }, iconSvg('external-link', 14), t('v25.sd_ui'))] });
    load();
  },
  loraTags() { const L = Store.state.settings.loras; return Object.entries(L.items || {}).filter(([, v]) => v.on && v.w).map(([k, v]) => `<lora:${k}:${+v.w.toFixed(2)}>`).join(' '); },
};
