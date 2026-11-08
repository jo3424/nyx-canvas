'use strict';
// AI Hub (providers, keys, model per task, local servers, speech) + System tools panel.
const Hub = {
  procState: {},
  sec(title, ...kids) { return h('section', { class: 'hub-sec' }, h('h4', {}, title), ...kids); },
  inp(obj, key, ph, type = 'text', onchange) { return h('input', { class: 'inp', type, value: obj[key] ?? '', placeholder: ph || '', onchange: (e) => { obj[key] = type === 'number' ? +e.target.value : e.target.value.trim(); Store.save(); onchange && onchange(); } }); },
  field(label, el, help) { return h('label', { class: 'field' }, h('span', {}, label), el, help ? h('small', { class: 'muted' }, help) : null); },
  // v2.2: path row = input · ✓/✗ · 🔍 find (when missing) · 📁 browse. Missing default paths are auto-fixed when the
  // exact same file name is found elsewhere (e.g. GPU-Voice-Studio\models\ instead of third_party\…\models\).
  FILTERS: { whisper: [['Whisper ggml', ['bin']]], llama: [['GGUF', ['gguf']]], 'tts-model': [['GGUF', ['gguf']]], 'tts-tokenizer': [['GGUF', ['gguf']]], exe: [['exe', ['exe']]], wav: [['Audio', ['wav', 'mp3', 'flac', 'ogg']]] },
  pathRow(obj, key, label, kind = 'file', find = null) {
    const i = this.inp(obj, key, kind === 'dir' ? 'C:\\…' : find && find.kind !== 'exe' ? 'C:\\…\\' + (find.kind === 'whisper' ? 'ggml-*.bin' : find.kind === 'wav' ? '*.wav' : '*.gguf') : 'C:\\…\\*.exe'); i.classList.add('grow');
    const st = h('span', { class: 'pchk' }); let auto = !!find;
    const apply = (p) => { obj[key] = p; i.value = p; Store.save(); check(); };
    const fb = find ? h('button', { class: 'btn ghost sm pfind', hidden: true, title: t('v22.find_tip'), onclick: () => this.findPicker(label, find, obj[key], apply) }, iconSvg('search', 14), t('v22.find')) : null;
    const check = async () => {
      if (!obj[key]) { st.textContent = ''; st.className = 'pchk'; if (fb) fb.hidden = false; return false; }
      const r = await API.inv('sys:exists', [obj[key]]).catch(() => null); const ok = !!r?.[0]?.exists && (kind === 'dir' ? r[0].dir : !r[0].dir);
      st.className = 'pchk ' + (ok ? 'ok' : 'bad'); st.textContent = ok ? '✓' : '✗'; st.title = ok ? t('hub.001') : t('hub.002'); if (fb) fb.hidden = ok;
      if (!ok && auto) { auto = false; const f = await API.inv('sys:findFiles', { kind: find.kind, want: obj[key], limit: 5, budgetMs: 4000 }).catch(() => null); const ex = f?.files?.find(x => x.score >= 1000); if (ex) { apply(ex.path); toast(t('v22.autofixed', { v0: label, v1: ex.path }), { ms: 7000 }); return true; } }
      return ok;
    };
    i.addEventListener('change', check); check();
    const browse = h('button', { class: 'btn ghost sm pbrowse', title: t('hub.003'), html: iconSvg('folder-open', 15), onclick: async () => { const fl = find ? (this.FILTERS[find.kind] || []).map(([n, e]) => ({ name: n, extensions: e })).concat([{ name: '*', extensions: ['*'] }]) : undefined; const p = await API.inv(kind === 'dir' ? 'sys:pickDir' : 'sys:pickExe', label, fl, obj[key] || undefined); if (p) apply(p); } });
    const f = this.field(label, h('div', { class: 'row gap prow' }, i, st, fb, browse)); f._check = check; f._apply = apply; return f;
  },
  // picker of files found on disk
  async findPicker(label, find, current, apply) {
    const list = h('div', { class: 'find-list' }, h('p', { class: 'muted small' }, t('v22.searching')));
    const extraRoots = []; let close;
    const run = async () => {
      list.innerHTML = ''; list.append(h('p', { class: 'muted small' }, t('v22.searching')));
      let r; try { r = await API.inv('sys:findFiles', { kind: find.kind, want: current, names: find.names || [], extraRoots, limit: 40 }); } catch (e) { list.innerHTML = ''; list.append(h('p', { class: 'err' }, cleanErr(e))); return; }
      list.innerHTML = '';
      if (!r.files.length) list.append(h('p', { class: 'muted' }, t('v22.none_found', { v0: r.roots.length })));
      for (const f of r.files) list.append(h('button', { class: 'find-item' + (f.score >= 1000 ? ' exact' : ''), title: f.path, onclick: () => { apply(f.path); close && close(); toast('✓ ' + f.name); } }, h('b', {}, f.name), h('span', { class: 'chip' }, f.size > 1 << 30 ? (f.size / 1073741824).toFixed(2) + ' GB' : (f.size / 1048576).toFixed(0) + ' MB'), h('small', { class: 'muted fpath' }, f.path)));
      list.append(h('p', { class: 'muted small' }, t('v22.scanned', { v0: r.scanned, v1: r.ms, v2: r.roots.join(' · ') })));
    };
    close = Panels.modal(t('v22.find_title', { v0: esc(label) }), list, { wide: true, extra: [
      h('button', { class: 'btn ghost', onclick: async () => { const d = await API.inv('sys:pickDir', t('v22.find_in')); if (d) { extraRoots.unshift(d); run(); } } }, iconSvg('folder-search', 15), t('v22.find_in')),
      h('button', { class: 'btn ghost', onclick: async () => { const fl = (this.FILTERS[find.kind] || []).map(([n, e]) => ({ name: n, extensions: e })).concat([{ name: '*', extensions: ['*'] }]); const p = await API.inv('sys:pickExe', label, fl, current || undefined); if (p) { apply(p); close(); } } }, iconSvg('folder-open', 15), t('v22.browse'))] });
    run();
  },
  open() {
    Panels.openDrawer('ai', t('hub.004', { v0: iconSvg('brain', 20) }), (body) => this.build(body));
  },
  // v2.6.3: one recommendation card: what it is for, exact files + sizes, link to the model page (opens in your browser), «Τι σημαίνει;». No downloads.
  recFiles(files) {
    const gb = (n) => (LANG === 'el' ? n.toFixed(2).replace('.', ',') : n.toFixed(2)) + ' GB';
    return h('ul', { class: 'rec-files' }, ...(files || []).map(([f, size, tag]) => h('li', {}, h('code', {}, f), ' · ' + gb(size), tag ? h('span', { class: 'chip' }, t('core.r_tag_' + tag)) : null,
      h('button', { class: 'icon-btn', title: t('core.r_copy'), html: iconSvg('copy', 13), onclick: () => { navigator.clipboard.writeText(f.split('/').pop()).then(() => toast('📋 ' + f.split('/').pop()), () => {}); } }))));
  },
  recCard(r) {
    const link = (url) => h('button', { class: 'btn sm ghost', onclick: () => API.openExternal(url) }, iconSvg('external-link', 14), t('core.r_open'));
    return h('div', { class: 'rec' + (r.star ? ' star' : ''), 'data-rec': r.id || '' }, h('b', {}, r.name), h('span', { class: 'chip' }, r.role), h('p', { class: 'muted small' }, r.note),
      r.files ? this.recFiles(r.files) : null,
      r.url ? h('div', { class: 'row gap wrap' }, link(r.url)) : null,
      r.alt ? h('div', { class: 'rec-alt' }, h('small', {}, t('core.r_alt') + ': ', h('b', {}, r.alt.name)), h('p', { class: 'muted small' }, r.alt.note), this.recFiles(r.alt.files), h('div', { class: 'row gap wrap' }, link(r.alt.url))) : null,
      r.why ? h('details', { class: 'rec-why' }, h('summary', {}, t('core.r_why')), h('p', { class: 'small' }, r.why)) : null);
  },
  build(body) {
    const A = Store.state.settings.ai;
    // recommendations
    body.append(this.sec(t('hub.005'), h('div', { class: 'recs' }, ...MODEL_RECS.map(r => this.recCard(r))),
      h('p', { class: 'muted small' }, MODEL_FIT_NOTE), h('p', { class: 'muted small' }, t('hub.006'))));
    // providers
    const plist = h('div', { class: 'prov-list' });
    for (const p of A.providers) plist.append(this.provRow(p));
    body.append(this.sec(t('hub.007'), plist, h('p', { class: 'muted small' }, t('hub.008'))));
    // per task
    const tasks = h('div', { class: 'tasks' }); for (const [k, label, ic] of AI_TASKS) tasks.append(this.taskRow(k, label, ic));
    body.append(this.sec(t('hub.009'), tasks));
    // local servers
    body.append(this.sec(t('hub.010'), this.serverBox('llama', 'llama-server', A.servers.llama, 'http://127.0.0.1:' + A.servers.llama.port + '/health'), this.serverBox('whisper', 'whisper-server', A.servers.whisper, 'http://127.0.0.1:' + A.servers.whisper.port + '/')));
    // speech
    const S = A.stt, T = A.tts;
    const ttsBox = h('div', { class: 'tts-box', hidden: T.mode !== 'command' }, ...this.ttsRows(T));
    const sttBase = this.field(t('hub.014'), this.inp(S, 'base', 'http://127.0.0.1:8178')); sttBase.hidden = S.kind === 'groq';
    const groqBox = h('div', { class: 'groq-stt', hidden: S.kind !== 'groq' },
      selField(t('v24.groq_model'), [['whisper-large-v3-turbo', 'whisper-large-v3-turbo (' + t('v24.groq_fast') + ')'], ['whisper-large-v3', 'whisper-large-v3 (' + t('v24.groq_acc') + ')']], S.groqModel || 'whisper-large-v3-turbo', (v) => { S.groqModel = v; Store.save(); }),
      h('p', { class: 'muted small' }, t('v24.groq_stt_note')));
    const vsBox = h('div', { class: 'vs-box', hidden: T.mode !== 'vsserver' }, ...this.vsRows(T));
    const voiceBox = h('div', { class: 'voice-box', hidden: T.mode === 'command' || T.mode === 'vsserver' }, ...this.voiceRows(T));
    body.append(this.sec(t('hub.011'),
      selField(t('hub.012'), [['whispercpp', t('hub.013')], ['groq', t('v24.stt_groq')], ['openai', 'OpenAI-compatible /audio/transcriptions']], S.kind, (v) => { S.kind = v; Store.save(); sttBase.hidden = v === 'groq'; groqBox.hidden = v !== 'groq'; }),
      sttBase, groqBox, this.field(t('hub.015'), this.inp(S, 'language', 'el')),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: S.autoSend ? true : null, onchange: (e) => { S.autoSend = e.target.checked; Store.save(); } }), h('span', {}, t('hub.016'))),
      h('button', { class: 'btn ghost sm', onclick: () => this.testStt() }, iconSvg('mic', 15), t('hub.017')),
      h('hr'),
      selField(t('hub.018'), [['system', t('v24.mode_system')], ['vsserver', t('v24.mode_vs')], ['command', t('hub.020')]], T.mode, (v) => { T.mode = v; Store.save(); ttsBox.hidden = v !== 'command'; vsBox.hidden = v !== 'vsserver'; voiceBox.hidden = v === 'command' || v === 'vsserver'; }),
      voiceBox, vsBox, ttsBox,
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: T.speak ? true : null, onchange: (e) => { T.speak = e.target.checked; Store.save(); } }), h('span', {}, t('hub.023'))),
      h('button', { class: 'btn ghost sm tts-try', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; const r = await Speech.speak(t('hub.024'), { report: true }); b.disabled = false; if (r) toast('🔊 ' + t('v23.tts_ok', { v0: ({ sapi: 'Windows SAPI', onecore: 'Windows OneCore', command: t('hub.020'), vsserver: 'vs-engine', web: t('v24.web_voice') })[r.via] || r.via, v1: r.voice || '—' })); } }, iconSvg('volume-2', 15), t('hub.025'))));
    // assistant
    const As = A.assistant;
    body.append(this.sec(t('hub.026'),
      selField(t('hub.027'), [['auto', t('hub.028')], ['tools', t('hub.029')], ['json', t('hub.030')]], As.mode, (v) => { As.mode = v; Store.save(); }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: As.confirm ? true : null, onchange: (e) => { As.confirm = e.target.checked; Store.save(); } }), h('span', {}, t('hub.031'))),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: A.autoTag ? true : null, onchange: (e) => { A.autoTag = e.target.checked; Store.save(); } }), h('span', {}, t('hub.032'))),
      h('label', { class: 'sfield' }, h('span', {}, t('hub.033')), h('input', { type: 'range', min: 0, max: 1.2, step: .1, value: As.temperature, oninput: (e) => { As.temperature = +e.target.value; Store.save(); } })),
      h('label', { class: 'field' }, h('span', {}, t('hub.034')), h('textarea', { class: 'inp', rows: 3, onchange: (e) => { As.extra = e.target.value; Store.save(); } }, As.extra || ''))));
    // data location: portable / Syncthing
    const dl = h('div', { class: 'data-loc' }, h('p', { class: 'muted small' }, '…'));
    body.append(this.sec(t('hub.035'), dl));
    (async () => {
      const L = await API.inv('data:location').catch(() => null); const conf = await API.inv('data:conflicts').catch(() => []); dl.innerHTML = '';
      if (!L) return dl.append(h('p', { class: 'muted' }, t('hub.036')));
      dl.append(h('div', { class: 'row gap' }, h('code', { class: 'grow', title: L.root }, L.root), h('button', { class: 'btn ghost sm', html: iconSvg('folder-open', 15) + t('hub.037'), onclick: () => API.inv('sys:reveal', L.root) })),
        h('p', { class: 'small' }, L.portable ? t('hub.038') : L.custom ? t('hub.039') : t('hub.040')),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn ghost sm', html: iconSvg('folder-sync', 15) + t('hub.041'), onclick: async () => { const d = await API.inv('sys:pickDir', t('hub.042')); if (!d) return; await API.inv('data:setLocation', d); Panels.modal(t('hub.043'), h('p', {}, t('hub.044') + d + t('hub.045')), { okLabel: t('hub.046'), ok: () => API.inv('app:relaunch') }); } }),
          L.custom ? h('button', { class: 'btn ghost sm', onclick: async () => { await API.inv('data:setLocation', null); toast(t('hub.047')); } }, t('hub.048')) : null),
        conf.length ? h('p', { class: 'warn small' }, t('hub.049', { length: conf.length, v1: conf.slice(0, 3).join(', ') })) : h('p', { class: 'muted small' }, t('hub.050')));
    })();
  },
  provRow(p) {
    const status = h('span', { class: 'pstat' }, p.enabled ? '' : t('hub.051'));
    const keyIn = p.keyRef ? h('input', { class: 'inp', type: 'password', placeholder: 'API key', autocomplete: 'off' }) : null;
    if (keyIn) API.inv('secret:has', p.keyRef).then(has => { if (has) keyIn.placeholder = t('hub.052'); });
    const fix = h('div', { class: 'pfix', hidden: true });
    // v2.2: precise reason (refused / timeout / HTTP …) + what to do + one-click fixes
    const test = async () => {
      status.className = 'pstat'; status.textContent = '…'; status.title = ''; fix.hidden = true; fix.innerHTML = '';
      let r; try { r = await API.inv('ai:ping', p); } catch (e) { r = { ok: false, error: cleanErr(e) }; }
      if (r.ok) {
        AI.modelCache[p.id] = r.models; status.className = 'pstat ok'; status.textContent = t('hub.053', { count: r.count, ms: r.ms }); status.title = r.models.map(m => m.id).join('\n');
        if (r.fixed) { p.base = r.fixed; Store.save(); const bi = row.querySelector('.prov-base'); if (bi) bi.value = r.fixed; toast(t('v22.base_fixed', { v0: p.name, v1: r.fixed }), { ms: 6000 }); }
        this.refreshTasks(); return true;
      }
      status.className = 'pstat bad'; status.textContent = '✗ ' + r.error;
      const acts = [];
      if (p.id === 'lmstudio' && r.code !== 'http') { const lms = await API.inv('ai:lmsFind').catch(() => null); if (lms) acts.push(h('button', { class: 'btn sm primary', title: lms, onclick: async (e) => { e.target.disabled = true; const x = await API.inv('ai:lmsStart').catch(err => ({ ok: false, error: cleanErr(err) })); e.target.disabled = false; if (x.ok) { toast(t('v22.lms_started')); setTimeout(test, 1200); } else toast('⚠️ ' + x.error, { kind: 'err', ms: 8000 }); } }, iconSvg('play', 14), t('v22.lms_start'))); }
      if (p.id === 'llama' && r.code !== 'http') acts.push(h('button', { class: 'btn sm primary', onclick: async (e) => { e.target.disabled = true; const x = await this.startServer('llama'); e.target.disabled = false; if (x.ok) setTimeout(test, 2500); } }, iconSvg('play', 14), t('v22.llama_start')));
      if (r.hint || acts.length) { fix.hidden = false; fix.append(...[r.hint ? h('p', { class: 'small' }, '💡 ' + r.hint) : null, acts.length ? h('div', { class: 'row gap wrap' }, ...acts) : null].filter(Boolean)); }
      return false;
    };
    const row = h('div', { class: 'prov' + (p.enabled ? '' : ' off'), 'data-prov': p.id },
      h('div', { class: 'prov-head' }, h('span', { html: iconSvg(p.icon || 'plug', 18) }), h('b', {}, p.name), h('span', { class: 'chip ' + (p.kind === 'local' ? 'loc' : 'cl') }, p.kind === 'local' ? t('hub.054') : 'cloud'), h('div', { class: 'grow' }),
        h('button', { class: 'btn ghost sm p-all', title: t('v23.use_all_tip'), onclick: () => this.useForAll(p) }, iconSvg('check-check', 14), t('v23.use_all')),
        h('input', { type: 'checkbox', class: 'toggle', checked: p.enabled ? true : null, title: t('hub.055'), onchange: (e) => { p.enabled = e.target.checked; row.classList.toggle('off', !p.enabled);
          // v2.3: switching a provider off clears its old error/fix box (no more stale red messages) and moves tasks to «auto»
          if (!p.enabled) { status.className = 'pstat'; status.textContent = t('hub.051'); status.title = ''; fix.hidden = true; fix.innerHTML = ''; for (const tk of Object.values(Store.state.settings.ai.tasks)) if (tk.p === p.id) { tk.p = ''; tk.m = ''; } }
          else { status.textContent = ''; setTimeout(test, 30); }
          delete AI.modelCache[p.id]; Store.save(); this.refreshTasks(); } })),
      h('div', { class: 'row gap' }, (() => { const bi = this.inp(p, 'base', 'https://…/v1', 'text', () => { status.textContent = ''; fix.hidden = true; }); bi.classList.add('grow', 'prov-base'); return bi; })(), keyIn, keyIn ? h('button', { class: 'btn sm', onclick: async () => { if (!keyIn.value.trim()) return; await API.inv('secret:set', p.keyRef, keyIn.value.trim()); keyIn.value = ''; keyIn.placeholder = t('hub.052'); toast(t('hub.056')); } }, t('hub.057')) : null,
        h('button', { class: 'btn ghost sm', onclick: test }, iconSvg('activity', 14), t('hub.058'))), status, fix, p.id === 'groq' ? h('p', { class: 'muted small groq-note' }, '⚡ ' + t('v24.groq_note')) : null);
    if (p.enabled && p.kind === 'local') setTimeout(test, 50);
    return row;
  },
  // v2.3: «Αυτόματο» = first enabled & reachable provider; disabled providers can't be chosen; shows what will really be used
  taskRow(k, label, ic) {
    const A = Store.state.settings.ai; const c = A.tasks[k] ||= { p: '', m: '' };
    const psel = h('select', { class: 'inp' }, h('option', { value: '' }, t('v23.auto')), ...A.providers.map(p => h('option', { value: p.id, disabled: p.enabled ? null : true }, p.name + (p.enabled ? '' : ' — ' + t('hub.051')))));
    psel.value = c.p || '';
    const msel = h('input', { class: 'inp', list: 'ml-' + k, value: c.m || '', placeholder: k === 'embed' ? t('hub.059') : t('hub.060') }); const dl = h('datalist', { id: 'ml-' + k });
    const res = h('small', { class: 'muted task-res' });
    const row = h('div', { class: 'task-row', 'data-task': k }, h('span', { class: 'ti', html: iconSvg(ic, 16) }), h('span', { class: 'tl' }, label), psel, msel, dl, res);
    row._refresh = async () => {
      psel.value = c.p || ''; msel.value = c.m || ''; const r = AI.task(k);
      res.textContent = r.p ? '→ ' + r.p.name + (r.m ? ' · ' + r.m.split(/[\\/]/).pop().slice(0, 40) : ' · ' + t('v23.first_model')) : '⚠️ ' + t('v23.no_enabled');
      res.classList.toggle('bad', !r.p);
      dl.innerHTML = ''; if (r.p) try { const ms = await AI.models(r.p.id); for (const m of ms) dl.append(h('option', { value: m.id })); } catch (e) {}
    };
    psel.onchange = () => { c.p = psel.value; c.m = ''; msel.value = ''; Store.save(); row._refresh(); Assistant.updModel?.(); };
    msel.onchange = () => { c.m = msel.value.trim(); if (c.m && !c.p) c.p = AI.task(k).p?.id || ''; Store.save(); if (k === 'embed') Search.index = {}; row._refresh(); Assistant.updModel?.(); };
    row._refresh(); return row;
  },
  refreshTasks() { $$('.task-row').forEach(x => x._refresh?.()); try { Assistant.updModel?.(); } catch (e) {} },
  useForAll(p) {
    if (!p.enabled) { p.enabled = true; const r = $(`.prov[data-prov="${p.id}"]`); r?.classList.remove('off'); const tg = r?.querySelector('.prov-head .toggle'); if (tg) tg.checked = true; }
    const T = Store.state.settings.ai.tasks; for (const k of Object.keys(T)) { if (k === 'embed') { if (T.embed.p && T.embed.p !== p.id) { T.embed.p = ''; T.embed.m = ''; } continue; } T[k] = { p: p.id, m: '' }; }
    Store.save(); this.refreshTasks(); toast(t('v23.use_all_done', { v0: p.name }));
  },
  // v2.2: one start path for the button, the provider "▶" fix and auto-start
  _rows: {},
  healthUrl(id, cfg) { return 'http://127.0.0.1:' + (cfg.port || (id === 'llama' ? 8080 : 8178)) + (id === 'llama' ? '/health' : '/'); },
  async startServer(id, { quiet = false } = {}) {
    const A = Store.state.settings.ai; const cfg = A.servers[id]; const name = id === 'llama' ? 'llama-server' : 'whisper-server';
    let pre = await API.inv('proc:precheck', id, cfg).catch(e => ({ ok: false, error: cleanErr(e) }));
    if (!pre.ok && pre.field && cfg[pre.field]) { // same file name somewhere else on disk → fix silently and continue
      const f = await API.inv('sys:findFiles', { kind: pre.field === 'exe' ? 'exe' : id === 'llama' ? 'llama' : 'whisper', want: cfg[pre.field], limit: 3, budgetMs: 4000 }).catch(() => null);
      const ex = f?.files?.find(x => x.score >= 1000);
      if (ex) { const row = this._rows[id]?.[pre.field]; if (row && document.contains(row)) row._apply(ex.path); else { cfg[pre.field] = ex.path; Store.save(); } toast(t('v22.autofixed', { v0: pre.field === 'exe' ? t('hub.067') : t('hub.068'), v1: ex.path }), { ms: 7000 }); pre = await API.inv('proc:precheck', id, cfg).catch(e => ({ ok: false, error: cleanErr(e) })); }
    }
    if (!pre.ok) {
      if (!quiet) {
        const find = pre.field === 'exe' ? { kind: 'exe', names: [name + '.exe', name] } : { kind: id === 'llama' ? 'llama' : 'whisper' };
        const apply = (v) => { const row = this._rows[id]?.[pre.field]; if (row) row._apply(v); else { cfg[pre.field] = v; Store.save(); } };
        toast('⚠️ ' + pre.error, { kind: 'err', ms: 10000, action: pre.field ? { label: t('v22.find'), fn: () => this.findPicker(pre.field === 'exe' ? t('hub.067') : t('hub.068'), find, cfg[pre.field], apply) } : null });
      }
      return { ok: false, error: pre.error };
    }
    const hl = await API.inv('proc:health', this.healthUrl(id, cfg)).catch(() => ({ ok: false }));
    const mine = this.procState[id]?.running;
    if (!mine && (hl.ok || hl.status)) { if (id === 'whisper') { A.stt.base = 'http://127.0.0.1:' + cfg.port; Store.save(); } if (!quiet) toast(t('v22.already_running', { v0: name, v1: cfg.port }), { ms: 6000 }); return { ok: true, external: true }; }
    try {
      const st = await API.inv('proc:start', id, cfg); this.procState[id] = st;
      if (id === 'whisper') { A.stt.base = 'http://127.0.0.1:' + cfg.port; Store.save(); }
      if (!quiet) toast('▶️ ' + name); return { ok: true, st };
    } catch (e) { const m = cleanErr(e); if (!quiet) toast('⚠️ ' + name + ': ' + m.split('\n')[0], { kind: 'err', ms: 9000 }); const lg = this._rows[id]?.log; if (lg) { lg.hidden = false; } return { ok: false, error: m }; }
  },
  async autoStart() {
    const S = Store.state?.settings?.ai?.servers || {};
    for (const id of ['llama', 'whisper']) if (S[id]?.autoStart) { const r = await this.startServer(id, { quiet: true }); if (!r.ok) toast(t('v22.autostart_fail', { v0: id === 'llama' ? 'llama-server' : 'whisper-server', v1: r.error.split('\n')[0] }), { kind: 'err', ms: 9000 }); }
  },
  serverBox(id, name, cfg, healthUrl) {
    const st = h('span', { class: 'srv-st' }); const log = h('pre', { class: 'srv-log', hidden: true });
    const upd = (s) => { this.procState[id] = s; st.className = 'srv-st ' + (s.running ? 'on' : 'off'); st.textContent = s.running ? t('hub.061', { pid: s.pid }) : (s.exit != null ? t('hub.062', { exit: s.exit }) : t('hub.063')); log.textContent = (s.cmd ? '> ' + s.cmd + '\n' : '') + (s.log || []).join('\n'); log.scrollTop = 1e9; };
    API.inv('proc:status', id).then(upd); API.onProcStatus?.((s) => { if (s.id === id) upd(s); });
    const go = async (e) => { const b = e?.currentTarget; if (b) b.disabled = true; try { await this.startServer(id); } finally { if (b) b.disabled = false; } };
    const exeRow = this.pathRow(cfg, 'exe', t('hub.067'), 'file', { kind: 'exe', names: [name + '.exe', name] });
    const modelRow = this.pathRow(cfg, 'model', t('hub.068'), 'file', { kind: id === 'llama' ? 'llama' : 'whisper' });
    this._rows[id] = { exe: exeRow, model: modelRow, log };
    return h('div', { class: 'srv', 'data-srv': id }, h('div', { class: 'prov-head wrap' }, h('b', {}, name), st, h('div', { class: 'grow' }),
      h('button', { class: 'btn sm primary', onclick: go }, iconSvg('play', 14), t('hub.064')), h('button', { class: 'btn sm ghost', onclick: async () => upd(await API.inv('proc:stop', id)) }, iconSvg('square', 14), t('hub.065')),
      h('button', { class: 'btn sm ghost ico', title: 'Log', onclick: () => { log.hidden = !log.hidden; } }, iconSvg('scroll-text', 14)), h('button', { class: 'btn sm ghost ico', title: 'Health', onclick: async () => { const r = await API.inv('proc:health', this.healthUrl(id, cfg)); toast(r.ok ? '✓ ' + this.healthUrl(id, cfg) : t('hub.066') + this.healthUrl(id, cfg)); } }, iconSvg('heart-pulse', 14))),
      exeRow, modelRow,
      h('div', { class: 'row gap srv-nums' }, this.field('Port', this.inp(cfg, 'port', '', 'number')), id === 'llama' ? this.field('GPU layers (-ngl)', this.inp(cfg, 'ngl', '99', 'number')) : this.field(t('hub.015'), this.inp(cfg, 'language', 'el')), id === 'llama' ? this.field('Context (-c)', this.inp(cfg, 'ctx', '8192', 'number')) : null),
      this.field(t('hub.069'), this.inp(cfg, 'extra', id === 'llama' ? t('v22.ph_llama') : t('v22.ph_whisper')), t('v22.extra_help')),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: cfg.autoStart ? true : null, onchange: (e) => { cfg.autoStart = e.target.checked; Store.save(); } }), h('span', {}, t('v22.autostart'))), log);
  },
  // v2.2: TTS engines. omnivoice.cpp CLI is documented (README: --model --codec --lang -o, text on stdin);
  // vs-engine (GPU-Voice-Studio) has no public docs → keep editable + «Δοκιμή» (shows the real stderr) + «--help».
  TTS_PRESETS: {
    vsengine: '{exe} --model {model} --codec {tokenizer} --text-file {text_file} --output {out}',
    omnivoice: '{exe} --model {model} --codec {tokenizer} --lang Greek -o {out} < {text_file}',
    piper: '{exe} --model {model} --output_file {out} < {text_file}',
  },
  // v2.4: voice picker (Chromium + Windows SAPI5 + OneCore, with language), rate/pitch, Greek-voice hint
  voiceRows(T) {
    const sel = h('select', { class: 'inp voice-sel', onchange: (e) => { T.voice = e.target.value; Store.save(); } }, h('option', { value: '' }, t('v24.voice_auto')));
    const hint = h('div', { class: 'voice-hint', hidden: true });
    const fill = async (fresh) => {
      const vs = await Speech.allVoices(fresh).catch(() => []);
      sel.innerHTML = ''; sel.append(h('option', { value: '' }, t('v24.voice_auto')));
      const isEl = (v) => /^el/i.test(v.lang || '');
      const groups = [[t('v24.voices_el'), vs.filter(isEl)], [t('v24.voices_other'), vs.filter(v => !isEl(v))]];
      for (const [label, list] of groups) if (list.length) sel.append(h('optgroup', { label }, ...list.map(v => h('option', { value: v.id }, `${v.name} · ${v.lang || '?'} · ${v.src === 'web' ? t('v24.web_voice') : v.src === 'onecore' ? 'OneCore' : 'SAPI5'}`))));
      sel.value = T.voice || ''; if (sel.value !== (T.voice || '')) sel.value = '';
      hint.hidden = vs.some(isEl); hint.innerHTML = ''; hint.append(h('b', {}, '🗣️ ' + t('v24.no_greek_title')), h('p', { class: 'small' }, t('v24.no_greek_voice')), h('button', { class: 'btn sm ghost', onclick: () => API.inv('sys:winSettings', 'speech') }, iconSvg('settings', 14), t('v24.open_lang')));
      sel.dataset.count = vs.length;
    };
    fill(false);
    const slider = (k, label) => { const val = h('span', { class: 'sl-val' }, String(+T[k] || 0)); return h('label', { class: 'slider-row' }, h('span', {}, label), h('input', { type: 'range', min: -10, max: 10, step: 1, value: +T[k] || 0, class: 'v24-' + k, oninput: (e) => { T[k] = +e.target.value; val.textContent = e.target.value; Store.save(); } }), val); };
    return [
      this.field(t('v24.voice'), h('div', { class: 'row gap' }, sel, h('button', { class: 'btn sm ghost', title: t('hub.083'), onclick: () => fill(true) }, iconSvg('refresh-cw', 14)))),
      selField(t('v23.engine'), [['auto', t('v23.engine_auto')], ['sapi', t('v24.engine_win')]], T.engine || 'auto', (v) => { T.engine = v; Store.save(); }),
      slider('rate', t('v24.rate')), slider('pitch', t('v24.pitch')), hint];
  },
  // v2.4: vs-engine runs as a local HTTP server; Nyx starts it hidden with its own token and discovers the API.
  vsRows(T) {
    const out = h('div', { class: 'vs-out' });
    const chk = (k, label) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: T[k] ? true : null, onchange: (e) => { T[k] = e.target.checked; Store.save(); } }), h('span', {}, label));
    const pre = (txt) => h('pre', { class: 'srv-log' }, txt);
    const table = (rows) => h('div', { class: 'vs-probe' }, ...rows.map(r => h('details', {}, h('summary', {}, h('code', {}, r.path || r.endpoint), ' → ', h('b', { class: r.status >= 200 && r.status < 300 ? 'ok' : 'err' }, String(r.status || '✗')), r.ctype ? h('small', { class: 'muted' }, ' ' + r.ctype) : null), pre(r.body || ''))));
    const test = async (e) => {
      const b = e.currentTarget; b.disabled = true; out.innerHTML = ''; out.append(h('p', { class: 'muted small' }, t('v24.vs_starting')));
      let r; try { r = await API.inv('tts:vsTest', T, t('hub.024')); } catch (err) { r = { ok: false, error: cleanErr(err) }; } b.disabled = false; out.innerHTML = '';
      out.append(h('p', { class: r.ok ? 'ok small' : 'err small' }, r.ok ? t('v24.vs_ok', { v0: r.endpoint, v1: ((r.ms || 0) / 1000).toFixed(1) }) : '✗ ' + (r.error || '')));
      if (r.cmd) out.append(h('small', { class: 'muted' }, t('v22.tts_cmd')), pre(r.cmd + '\n(VS_ENGINE_TOKEN = ' + t('v24.vs_token_set') + ')'));
      if (r.probe) out.append(h('small', { class: 'muted' }, t('v24.vs_found', { v0: r.probe.port, v1: r.probe.auth, v2: (r.probe.routes || []).join(', ') || '—' })), table(r.probe.results || []));
      if (r.tries?.length) out.append(h('small', { class: 'muted' }, t('v24.vs_tries')), table(r.tries));
      if (r.log) out.append(h('small', { class: 'muted' }, 'stdout / stderr'), pre(r.log.trim().slice(-2500)));
      if (r.ok && r.file) out.append(h('audio', { controls: true, src: Store.media(r.file) }));
      if (!r.ok) out.append(h('p', { class: 'muted small' }, '💡 ' + t('v24.vs_hint')));
    };
    const stop = async () => { await API.inv('tts:vsStop'); out.innerHTML = ''; out.append(h('p', { class: 'muted small' }, t('v24.vs_stopped'))); };
    const help = async () => { const r = await API.inv('tts:help', T.exe).catch(e => ({ ok: false, error: cleanErr(e) })); Panels.modal('vs-engine --help', h('pre', { class: 'srv-log tall' }, r.ok ? (r.out || t('v22.no_output')) : '✗ ' + r.error), { wide: true }); };
    if (!T.device) T.device = 'Vulkan0';
    return [
      h('p', { class: 'muted small' }, t('v24.vs_intro')),
      this.pathRow(T, 'exe', t('v22.tts_exe'), 'file', { kind: 'exe', names: ['vs-engine.exe'] }),
      this.pathRow(T, 'model', '--model (gguf)', 'file', { kind: 'tts-model', names: ['omnivoice-base-Q8_0.gguf'] }),
      this.pathRow(T, 'tokenizer', '--codec (tokenizer gguf)', 'file', { kind: 'tts-tokenizer', names: ['omnivoice-tokenizer-Q8_0.gguf'] }),
      h('div', { class: 'row gap wrap' },
        selField('--device', [['Vulkan0', 'Vulkan0 (GPU)'], ['Vulkan1', 'Vulkan1'], ['CUDA0', 'CUDA0'], ['CPU', 'CPU']], T.device, (v) => { T.device = v; Store.save(); }),
        this.field('--port', this.inp(T, 'port', t('v24.vs_port_auto')))),
      h('div', { class: 'row gap wrap' }, chk('noFa', '--no-fa'), chk('clampFp16', '--clamp-fp16')),
      this.pathRow(T, 'refAudio', t('v24.vs_ref'), 'file', { kind: 'wav', names: ['reference.wav'] }),
      this.field(t('v24.vs_endpoint'), this.inp(T, 'endpoint', 'POST /v1/audio/speech'), t('v24.vs_endpoint_help')),
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn sm primary vs-test', onclick: test }, iconSvg('flask-conical', 14), t('v24.vs_test')), h('button', { class: 'btn sm ghost', onclick: stop }, iconSvg('square', 14), t('v24.vs_stop')), h('button', { class: 'btn sm ghost', onclick: help }, iconSvg('circle-question-mark', 14), t('v22.tts_help'))),
      h('p', { class: 'muted small' }, '💡 ' + t('v24.vs_hint')), out];
  },
  ttsRows(T) {
    const tpl = this.inp(T, 'template', ''); tpl.classList.add('mono');
    const preset = selField(t('v22.tts_preset'), [['', t('v22.tts_custom')], ['vsengine', t('v22.tts_vs')], ['omnivoice', 'omnivoice.cpp (omnivoice-tts)'], ['piper', 'Piper']], Object.keys(this.TTS_PRESETS).find(k => this.TTS_PRESETS[k] === T.template) || '', (v) => { if (!v) return; T.template = this.TTS_PRESETS[v]; tpl.value = T.template; Store.save(); });
    const out = h('div', { class: 'tts-out' });
    const test = async (e) => {
      const b = e.currentTarget; b.disabled = true; out.innerHTML = ''; out.append(h('p', { class: 'muted small' }, t('v22.tts_running')));
      let r; try { r = await API.inv('tts:test', T); } catch (err) { r = { ok: false, error: cleanErr(err) }; } b.disabled = false; out.innerHTML = '';
      out.append(h('p', { class: r.ok ? 'ok small' : 'err small' }, r.ok ? t('v22.tts_ok', { v0: ((r.ms || 0) / 1000).toFixed(1) }) : '✗ ' + (r.error || '').split('\n')[0]));
      if (r.cmd) out.append(h('small', { class: 'muted' }, t('v22.tts_cmd')), h('pre', { class: 'srv-log' }, r.cmd));
      if (r.stderr || r.stdout) out.append(h('small', { class: 'muted' }, 'stderr / stdout'), h('pre', { class: 'srv-log' }, ((r.stderr || '') + '\n' + (r.stdout || '')).trim()));
      else if (!r.ok && r.error && r.error.includes('\n')) out.append(h('pre', { class: 'srv-log' }, r.error));
      if (r.ok && r.file) out.append(h('audio', { controls: true, src: Store.media(r.file.split(/[\\/]/).pop()) }));
    };
    const help = async () => { const r = await API.inv('tts:help', T.exe).catch(e => ({ ok: false, error: cleanErr(e) })); Panels.modal(esc((T.exe || '').split(/[\\/]/).pop() || 'exe') + ' --help', h('pre', { class: 'srv-log tall' }, r.ok ? (r.out || t('v22.no_output')) : '✗ ' + r.error), { wide: true }); };
    return [preset,
      this.pathRow(T, 'exe', t('v22.tts_exe'), 'file', { kind: 'exe', names: ['vs-engine.exe', 'omnivoice-tts.exe', 'piper.exe'] }),
      this.pathRow(T, 'model', t('v22.tts_model'), 'file', { kind: 'tts-model', names: ['omnivoice-base-Q8_0.gguf'] }),
      this.pathRow(T, 'tokenizer', t('v22.tts_tok'), 'file', { kind: 'tts-tokenizer', names: ['omnivoice-tokenizer-Q8_0.gguf'] }),
      this.field(t('hub.021'), tpl, t('v22.tts_note')),
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn sm primary', onclick: test }, iconSvg('flask-conical', 14), t('v22.tts_test')), h('button', { class: 'btn sm ghost', onclick: help }, iconSvg('circle-question-mark', 14), t('v22.tts_help'))), out];
  },
  async testStt() {
    try { await Speech.start(); toast(t('hub.070')); await new Promise(r => setTimeout(r, 5000)); const b = await Speech.stop(); toast(t('hub.071')); const r = await Speech.transcribeBlob(b); Panels.modal(t('hub.072'), h('p', {}, r.text || t('hub.073'))); } catch (e) { Speech.rec && Speech.stop(); toast('⚠️ ' + e.message, { kind: 'err', ms: 6000 }); }
  },
  // ---------------- System tools ----------------
  // v2.1: the tools panel moved to Settings → «Εργαλεία & διαδρομές» (cached detection + deep scan).
  tools() { Panels.drawerKind = null; Panels.settings('tools'); },
  async toolsLegacy() {
    Panels.openDrawer('tools', t('hub.074', { v0: iconSvg('wrench', 20) }), async (body) => {
      body.append(h('p', { class: 'muted small' }, t('hub.075')));
      const ov = Store.state.settings.tools || {}; let r;
      try { r = await API.inv('sys:detect', ov); } catch (e) { body.innerHTML = ''; body.append(h('p', { class: 'err' }, e.message)); return; }
      body.innerHTML = ''; const info = V2.info || {};
      body.append(h('div', { class: 'sysinfo' }, h('span', {}, '🖥️ ' + (info.platform || r.platform || '')), h('span', {}, '🧮 ' + (info.cpu || '') + ' · ' + (info.cpus || '') + ' threads'), h('span', {}, '🧠 RAM ' + ((info.mem || 0) / 1073741824).toFixed(0) + ' GB')));
      const cats = {}; for (const t of r.tools) (cats[t.cat] ||= []).push(t);
      for (const [cat, list] of Object.entries(cats)) {
        body.append(h('h4', {}, cat));
        for (const t of list) body.append(h('div', { class: 'tool-row ' + (t.found ? 'ok' : 'miss') }, h('span', { class: 'tdot' }), h('div', { class: 'tmain' }, h('b', {}, t.name), h('span', { class: 'tver' }, t.version || (t.serving ? tr('hub.076') : t.found ? tr('hub.077') : tr('assistant.041'))), h('small', { class: 'tpath', title: t.path || '' }, t.path || t.note || '')),
          t.found && t.path && t.kind !== 'http' ? h('button', { class: 'btn ghost sm', title: tr('hub.078'), html: iconSvg('play', 14), onclick: () => API.inv('sys:launch', t.path, t.kind).then(x => x && toast(x)).catch(e => toast('⚠️ ' + e.message)) }) : null,
          t.path ? h('button', { class: 'btn ghost sm', title: tr('hub.079'), html: iconSvg('folder-open', 14), onclick: () => API.inv('sys:reveal', t.path) }) : null,
          h('button', { class: 'btn ghost sm', title: tr('hub.080'), html: iconSvg('pencil', 14), onclick: async () => { const p = await API.inv('sys:pickExe', t.name); if (p) { (Store.state.settings.tools ||= {})[t.id] = p; Store.save(); Panels.drawerKind = null; this.toolsLegacy(); } } })));
      }
      body.append(h('h4', {}, t('hub.081')));
      for (const f of r.files) body.append(h('div', { class: 'tool-row ' + (f.exists ? 'ok' : 'miss') }, h('span', { class: 'tdot' }), h('div', { class: 'tmain' }, h('b', {}, f.name), h('span', { class: 'tver' }, f.exists ? ((f.size || 0) / 1073741824).toFixed(2) + ' GB' : t('hub.082')), h('small', { class: 'tpath' }, f.p)), f.exists ? h('button', { class: 'btn ghost sm', html: iconSvg('folder-open', 14), onclick: () => API.inv('sys:reveal', f.p) }) : null));
      body.append(h('div', { class: 'row gap wrap', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => { Panels.drawerKind = null; this.toolsLegacy(); } }, iconSvg('refresh-cw', 15), t('hub.083')), h('button', { class: 'btn ghost', onclick: () => this.open() }, iconSvg('brain', 15), t('hub.084'))));
    });
  },
};
