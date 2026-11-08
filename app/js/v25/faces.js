'use strict';
// v2.5 Faces v1 (lazy): local YuNet detect + SFace embeddings (onnxruntime-web WASM in a worker) → clusters → you name them →
// Ctrl+K finds «Μαρία» in photos. Nothing leaves the PC. Optional Sogni identity edit / image→video, with consent.
const Faces = {
  body: null,
  open() { Panels.openDrawer('faces', '<span class="ti">' + iconSvg('scan-face', 20) + '</span> ' + t('v25.faces_title'), (body) => { this.body = body; this.render(); }); },
  imageFiles() { const out = new Set(); for (const b of Store.state.boards) for (const it of b.items) if (it.type === 'image' && it.file && !/^(https?:|data:|blob:)/.test(it.file)) out.add(it.file); return [...out]; },
  itemsFor(file) { const r = []; for (const b of Store.state.boards) for (const it of b.items) if (it.file === file) r.push(it); return r; },
  async render() {
    const body = this.body; if (!body || !document.contains(body)) return; body.innerHTML = '';
    const F = Store.state.settings.faces;
    if (!F.consentAck) {
      body.append(h('div', { class: 'v25-note' }, h('h4', {}, '🛡️ ' + t('v25.fc_consent_t')), h('p', {}, t('v25.fc_consent_1')), h('p', {}, t('v25.fc_consent_2')), h('p', { class: 'warn small' }, '⚖️ ' + t('v25.consent_note')),
        h('button', { class: 'btn primary', onclick: () => { F.consentAck = true; Store.save(); this.render(); } }, iconSvg('check', 15), t('v25.fc_agree'))));
      return;
    }
    const st = await API.inv('faces:status').catch(e => ({ ready: false, error: cleanErr(e), total: 0 }));
    if (!st.ready) {
      const prog = h('div', { class: 'pbar' }, h('i', { style: 'width:0%' })); const lbl = h('small', { class: 'muted' }, '');
      const off = API.onFacesProgress?.((p) => { if (p.total) { prog.firstChild.style.width = (p.done / p.total * 100).toFixed(1) + '%'; lbl.textContent = p.file + ' · ' + fmtMB(p.done) + ' / ' + fmtMB(p.total); } });
      body.append(h('div', { class: 'v25-note' }, h('p', {}, t('v25.fc_need_dl', { v0: fmtMB(st.total || 54e6) })), h('p', { class: 'muted small' }, t('v25.fc_dl_src')),
        h('button', { class: 'btn primary', onclick: async (e) => { e.currentTarget.disabled = true; try { await API.inv('faces:download'); toast('✓ ' + t('v25.fc_ready')); } catch (err) { toast('⚠️ ' + cleanErr(err), { kind: 'err', ms: 9000 }); } off?.(); this.render(); } }, iconSvg('download', 15), t('v25.fc_download')), prog, lbl));
      return;
    }
    const files = this.imageFiles(); const stat = h('small', { class: 'muted' }, t('v25.fc_count', { v0: files.length }));
    const prog = h('div', { class: 'pbar', hidden: true }, h('i', { style: 'width:0%' }));
    const scanBtn = h('button', { class: 'btn primary sm', onclick: async () => {
      scanBtn.disabled = true; prog.hidden = false; const off = API.onFacesProgress?.((p) => { if (p.of) { prog.firstChild.style.width = (p.scan / p.of * 100).toFixed(1) + '%'; stat.textContent = `${p.scan}/${p.of} · ${p.faces} ${t('v25.fc_faces')}`; } });
      try { const r = await API.inv('faces:scan', files); await People.sync(); toast('✓ ' + t('v25.fc_scanned', { v0: r.scanned, v1: r.faces, v2: r.newPeople, v3: r.skipped })); } catch (e) { toast('⚠️ ' + cleanErr(e), { kind: 'err', ms: 9000 }); }
      off?.(); scanBtn.disabled = false; prog.hidden = true; this.render(); } }, iconSvg('scan-search', 14), t('v25.fc_scan'));
    body.append(h('div', { class: 'row gap wrap fc-head' }, scanBtn, stat, h('div', { class: 'grow' }),
      h('button', { class: 'btn ghost sm', title: t('v25.fc_forget_all'), onclick: () => Panels.modal(t('v25.fc_forget_all'), h('p', {}, t('v25.fc_forget_all_q')), { okLabel: t('v25.delete'), ok: async () => { await API.inv('faces:forgetAll'); await People.sync(); this.render(); } }) }, iconSvg('trash', 14))), prog);
    const people = await API.inv('faces:people').catch(() => []);
    if (!people.length) { body.append(h('p', { class: 'muted' }, t('v25.fc_empty'))); return; }
    const named = people.filter(p => p.name), un = people.filter(p => !p.name);
    const grid = (list) => h('div', { class: 'fc-grid' }, ...list.map(p => this.card(p, people)));
    if (named.length) body.append(h('h4', {}, t('v25.fc_named', { v0: named.length })), grid(named));
    if (un.length) body.append(h('h4', {}, t('v25.fc_unnamed', { v0: un.length })), grid(un));
    body.append(h('p', { class: 'muted small' }, t('v25.fc_tip')));
  },
  card(p, all) {
    const inp = h('input', { class: 'inp fc-name', value: p.name, placeholder: t('v25.fc_who'), onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); },
      onchange: async (e) => { await API.inv('faces:name', p.pid, e.target.value); await People.sync(); this.render(); } });
    return h('div', { class: 'fc-card', 'data-pid': p.pid },
      h('img', { src: p.thumb, alt: '', onclick: () => this.person(p, all) }), inp,
      h('small', { class: 'muted' }, t('v25.fc_in', { v0: p.files.length, v1: p.faces })),
      h('div', { class: 'row gap' }, h('button', { class: 'ib', title: t('v25.fc_show'), html: iconSvg('images', 15), onclick: () => this.person(p, all) }),
        h('button', { class: 'ib', title: t('v25.fc_merge'), html: iconSvg('merge', 15), onclick: () => this.mergeDlg(p, all) }),
        h('button', { class: 'ib', title: t('v25.fc_forget'), html: iconSvg('eye-off', 15), onclick: async () => { await API.inv('faces:forget', p.pid); await People.sync(); this.render(); } })));
  },
  mergeDlg(p, all) {
    let into = null; const list = h('div', { class: 'fc-grid sm' }, ...all.filter(x => x.pid !== p.pid).map(x => h('button', { class: 'fc-pick', onclick: (e) => { into = x; $$('.fc-pick.on').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }, h('img', { src: x.thumb }), h('small', {}, x.name || '—'))));
    Panels.modal(t('v25.fc_merge'), h('div', {}, h('p', {}, t('v25.fc_merge_q')), list), { wide: true, okLabel: t('v25.fc_merge'), ok: async () => { if (!into) return false; await API.inv('faces:merge', into.pid, p.pid); await People.sync(); this.render(); } });
  },
  async person(p) {
    const faces = await API.inv('faces:faces', p.pid).catch(() => []);
    const grid = h('div', { class: 'fc-grid sm' }, ...faces.map(f => h('div', { class: 'fc-face' }, h('img', { src: f.thumb, title: f.file + ' · ' + Math.round(f.sim * 100) + '%', onclick: () => { const it = this.itemsFor(f.file)[0]; if (it) { Canvas.focusItem(it.id); } } }),
      h('button', { class: 'ib', title: t('v25.fc_not_him'), html: iconSvg('user-x', 14), onclick: async (e) => { await API.inv('faces:reject', f.id); e.currentTarget.closest('.fc-face').remove(); People.sync(); } }))));
    const close = Panels.modal('👤 ' + esc(p.name || t('v25.fc_who')), h('div', {}, h('p', { class: 'muted small' }, t('v25.fc_person_tip')), grid), { wide: true, extra: [
      h('button', { class: 'btn ghost', onclick: () => { const ids = []; for (const f of faces) for (const it of this.itemsFor(f.file)) if (Store.find(it.id)?.board.id === Store.state.active) ids.push(it.id); if (ids.length) { Canvas.select(ids); close?.(); } else toast(t('v25.fc_not_here')); } }, iconSvg('mouse-pointer-2', 14), t('v25.fc_select_here')),
      Store.state.settings.sogni.enabled && p.name ? h('button', { class: 'btn ghost', onclick: async () => { const files = await API.inv('faces:bestFiles', p.pid, 2); close?.(); this.sogniDlg('identity', files, p.name); } }, iconSvg('user-round', 14), t('v25.sg_identity')) : null].filter(Boolean) });
  },
  // ---------- Sogni (cloud, optional): identity-consistent edit / image→video ----------
  sogniSelected(kind) {
    const imgs = Canvas.selItems().filter(i => i.type === 'image' && i.file); if (!imgs.length) return toast(t('v25.sel_image'));
    this.sogniDlg(kind, imgs.slice(0, 4).map(i => i.file));
  },
  sogniDlg(kind, files, who) {
    const needConsent = kind !== 'i2v';
    const prompt = h('textarea', { class: 'inp', rows: 3, placeholder: kind === 'identity' ? t('v25.sg_ph_id') : t('v25.sg_ph_i2v'), onkeydown: (e) => e.stopPropagation() });
    const secs = h('input', { class: 'inp', type: 'number', min: 2, max: 10, value: 5 });
    const cons = h('input', { type: 'checkbox' });
    const prog = h('small', { class: 'muted' }, '');
    const body = h('div', { class: 'v25-note' },
      h('div', { class: 'row gap sg-thumbs' }, ...files.map(f => h('img', { src: Store.media(f) }))),
      Hub.field(t('v25.sg_prompt'), prompt), kind === 'i2v' ? Hub.field(t('v25.sg_secs'), secs) : null,
      needConsent ? h('label', { class: 'chk consent' }, cons, h('span', {}, t('v25.sg_consent', { v0: who || t('v25.sg_person') }))) : null,
      h('p', { class: 'warn small' }, '⚖️ ' + t('v25.consent_note')), h('p', { class: 'muted small' }, '💸 ' + t('v25.sg_cost')), prog);
    Panels.modal((kind === 'identity' ? '🪪 ' + t('v25.sg_identity') : '🎞️ ' + t('v25.sg_i2v')) + ' · Sogni', body, { wide: true, okLabel: t('v25.sg_go'), ok: async () => {
      if (needConsent && !cons.checked) { toast(t('v25.consent_need'), { kind: 'err' }); return false; }
      const off = API.onSogniProgress?.((p) => { prog.textContent = p.text || (p.pct != null ? Math.round(p.pct) + '%' : ''); });
      toast('⏳ Sogni …', { ms: 4000 });
      (async () => { try { const r = await API.inv('sogni:run', kind, { files, prompt: prompt.value.trim(), seconds: +secs.value, consent: needConsent ? cons.checked : undefined, tokenType: Store.state.settings.sogni.tokenType });
        const c = Canvas.center(); let i = 0; for (const f of r.files) await Features.addMedia({ file: f, name: f }, c.x + (i++) * 40, c.y); toast('✓ Sogni · ' + r.model);
      } catch (e) { toast('⚠️ Sogni: ' + cleanErr(e), { kind: 'err', ms: 10000 }); } finally { off?.(); } })();
    } });
  },
};
