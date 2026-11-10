'use strict';
// v2.6.7 — 4-tab AI Hub (Κατάσταση / Μοντέλα / Μηχανές / Cloud). Live numbers only; theme tokens; no emoji flags.
Hub.paintHubTabs = function (panes, show) {
  const self = this;
  const fmtNum = (n, d = 1) => {
    if (n == null || !Number.isFinite(+n)) return '—';
    const s = (+n).toFixed(d);
    return (typeof LANG !== 'undefined' && LANG === 'el') ? s.replace('.', ',') : s;
  };
  const fmtGB = (bytes) => fmtNum((bytes || 0) / 1073741824, 1) + ' GB';
  const fmtSec = (ms) => {
    if (ms == null || !Number.isFinite(+ms)) return '—';
    const s = +ms / 1000;
    return fmtNum(s, s >= 10 ? 1 : 1) + ' s';
  };
  const llamaMeta = (cfg) => {
    const extra = String((cfg && cfg.extra) || '');
    const dirM = extra.match(/--models-dir(?:=|\s+)(?:"([^"]+)"|(\S+))/);
    const maxM = extra.match(/--models-max(?:=|\s+)(\d+)/);
    const dir = (cfg && cfg.modelsDir) || (dirM && (dirM[1] || dirM[2])) || '';
    const max = (cfg && +cfg.modelsMax) || (maxM ? +maxM[1] : 0);
    const ctx = (cfg && +cfg.ctx > 0) ? Math.floor(+cfg.ctx) : 0;
    return { dir, max, ctx };
  };
  const modelsDirOf = (cfg) => {
    const m = llamaMeta(cfg);
    if (m.dir) return m.dir;
    const info = (typeof V2 !== 'undefined' && V2.info) || Store.info || {};
    return info.gvs ? String(info.gvs).replace(/[\\/]$/, '') + '\\models' : '';
  };
  const licenseFor = (id) => {
    const Z = typeof MODEL_ZONES !== 'undefined' ? MODEL_ZONES : { other: [], candidates: {} };
    const cards = [...(Z.other || []), ...Object.values(Z.candidates || {}).flat()];
    const hit = cards.find((c) => typeof zoneMatchId === 'function' && zoneMatchId(id, c));
    if (hit) return { license: hit.license, note: hit.licenseNote, url: hit.licenseUrl };
    const s = String(id || '').toLowerCase();
    if (/gemma/.test(s)) return { license: 'Apache-2.0', note: '', url: '' };
    if (/krikri|llama-3\.1|llama3\.1/.test(s)) return { license: 'Llama 3.1 Community License', note: '', url: '' };
    return { license: t('v267.license_unknown'), note: '', url: '' };
  };
  const dot = (kind) => h('span', { class: 'hub-dot ' + (kind || 'x') });
  const pill = (txt, cls) => h('span', { class: 'hub-pill' + (cls ? ' ' + cls : '') }, txt);
  const row = (...kids) => h('div', { class: 'hub-row' }, ...kids);
  const refill25 = (el) => {
    if (typeof Hub25 === 'undefined' || typeof Hub25.fill !== 'function') return;
    const root = (el && (el.closest('.drawer, .panel, #drawer') || el.parentElement)) || document;
    Hub25.fill({
      image: root.querySelector('.hub-image-slot'),
      cloudMore: root.querySelector('.hub-cloud-more-slot'),
      tools: root.querySelector('.hub-tools-slot'),
      sdAdv: root.querySelector('.hub-sd-adv'),
    });
  };

  const paintStatus = async (el) => {
    el.innerHTML = '';
    const A = Store.state.settings.ai;
    const llama = A.providers.find((p) => p.id === 'llama') || { id: 'llama', base: 'http://127.0.0.1:' + (A.servers.llama.port || 8080) + '/v1', kind: 'local' };
    const mid = (A.tasks && (A.tasks.commands?.m || A.tasks.chat?.m || A.tasks.greek?.m)) || '';
    let ctxR = null, models = [], perf = null;
    try { models = llama.enabled ? (await AI.models(llama.id, true)) || [] : []; } catch (e) { models = []; }
    try { ctxR = await API.inv('ai:context', { ...llama, base: llama.base }, { model: mid || (models[0] && models[0].id) || undefined }); } catch (e) { ctxR = { warnings: [{ message: cleanErr(e) }] }; }
    try { perf = await API.inv('perf:snapshot'); } catch (e) { perf = { gpu: { error: cleanErr(e) } }; }
    const meta = llamaMeta(A.servers.llama);
    const nCtx = ctxR?.n_ctx || meta.ctx || null;
    const loaded = Array.isArray(models) ? models.filter((m) => m.loaded === true || m.state === 'loaded') : [];
    const loadedKnown = models.some((m) => m && (m.loaded === true || m.loaded === false || m.state));
    const loadCount = loadedKnown ? loaded.length : null;
    const loadMax = meta.max || null;
    const loadLabel = loadCount != null
      ? (loadMax ? loadCount + ' / ' + loadMax : String(loadCount))
      : (models.length ? models.length + (loadMax ? ' / ' + loadMax : '') : '—');
    const loadSub = loadCount != null ? t('v267.stat_loaded') : (models.length ? t('v267.available') : t('v267.loaded_unknown'));
    const ad = perf && perf.gpu && perf.gpu.adapter;
    const vramKnown = ad && (ad.used != null || ad.total);
    const last = AI.lastRequest || null;
    const speed = last && last.predicted_n != null && last.predicted_ms > 0 ? (last.predicted_n / (last.predicted_ms / 1000)) : null;
    const ctxShown = meta.ctx || nCtx;
    const ctxLabel = meta.ctx ? t('v267.ctx_user', { v0: meta.ctx }) : (nCtx ? t('v267.ctx_live', { v0: nCtx }) : '—');

    const stats = h('div', { class: 'hub-stats' },
      h('div', { class: 'hub-stat' }, h('b', {}, loadLabel), h('span', {}, loadSub)),
      h('div', { class: 'hub-stat' }, h('b', { 'data-gvs-vram': vramKnown ? String(ad.used || 0) : '' }, vramKnown ? fmtGB(ad.used) : '—'), h('span', {}, vramKnown ? t('v267.stat_vram', { v0: fmtGB(ad.total) }) : t('v267.stat_vram_unknown') + (perf?.gpu?.error ? ' · ' + perf.gpu.error : ''))),
      h('div', { class: 'hub-stat' }, h('b', { 'data-gvs-ctx': ctxShown ? String(ctxShown) : '' }, ctxShown ? (ctxShown >= 1024 ? Math.round(ctxShown / 1024) + 'K' : String(ctxShown)) : '—'), h('span', {}, t('v267.stat_ctx'))),
      h('div', { class: 'hub-stat' }, h('b', {}, speed != null ? Math.round(speed) + ' t/s' : '—'), h('span', {}, speed != null ? t('v267.stat_speed') : t('v267.stat_speed_none'))));

    const hl = await API.inv('proc:health', this.healthUrl('llama', A.servers.llama)).catch(() => ({ ok: false }));
    const hw = await API.inv('proc:health', this.healthUrl('whisper', A.servers.whisper)).catch(() => ({ ok: false }));
    const llamaOn = !!(this.procState.llama?.running || hl.ok || hl.status);
    const whisperOn = !!(this.procState.whisper?.running || hw.ok || hw.status);
    const ttsOn = !!(this.procState.tts?.running);
    const sdOn = !!(this.procState.sd?.running);
    const loadedNames = (loadedKnown ? loaded : models).map((m) => String(m.id || '').split(/[\\/]/).pop()).filter(Boolean).slice(0, 4);
    const running = h('div', {},
      h('div', { class: 'hub-h4' }, t('v267.running')),
      row(dot(llamaOn ? 'g' : 'x'), h('span', { class: 'grow' }, t('v267.llm_router') + ' · :' + (A.servers.llama.port || 8080)), loadedNames.length ? pill(loadedNames.join(' · ')) : null),
      row(dot(whisperOn ? 'g' : 'x'), h('span', { class: 'grow' }, t('v267.stt_row') + ' · :' + (A.servers.whisper.port || 8178)), pill((A.servers.whisper.model || A.stt.kind || '').toString().split(/[\\/]/).pop() || 'whisper')),
      row(dot(ttsOn ? 'g' : (A.tts.mode === 'system' ? 'x' : 'x')), h('span', { class: 'grow' }, t('v267.tts_row')), ttsOn ? pill('OmniVoice') : h('button', { class: 'btn sm', onclick: () => this.startTtsEngine?.() || toast(t('v267.not_configured')) }, t('hub.064').trim())),
      row(dot(sdOn ? 'g' : 'x'), h('span', { class: 'grow' }, t('v267.image_row')), sdOn ? pill('sd-server') : h('span', { class: 'muted small' }, t('v267.not_configured'))));

    const lastBox = h('div', {}, h('div', { class: 'hub-h4' }, t('v267.last_msg')));
    if (!last) lastBox.append(h('p', { class: 'muted small' }, t('v267.last_none')));
    else {
      const pct = last.n_ctx ? Math.round((+last.prompt_n || 0) * 100 / last.n_ctx) : 0;
      const large = last.n_ctx && last.prompt_n != null && last.prompt_n > (last.n_ctx * 0.25);
      const issues = [];
      if (last.cpu) issues.push(t('v267.on_cpu'));
      if (last.failed) issues.push(t('v267.failed') + (last.error ? ' · ' + last.error : ''));
      if (last.truncated) issues.push(t('v267.truncated'));
      const line = t('v267.last_line', { v0: last.prompt_n != null ? last.prompt_n : '—', v1: fmtSec(last.prompt_ms), v2: last.predicted_n != null ? last.predicted_n : '—', v3: fmtSec(last.predicted_ms) });
      lastBox.append(row(
        h('span', { class: 'grow' + (issues.length ? ' hub-last bad' : '') }, line),
        large ? pill(t('v267.large_prompt'), 'warn') : null,
        ...issues.map((x) => pill(x, 'bad'))
      ));
      if (large) lastBox.lastChild.querySelector('.hub-pill.warn')?.setAttribute('title', t('v267.large_prompt_tip', { v0: 25, v1: last.prompt_n, v2: last.n_ctx }));
    }
    lastBox.append(h('p', { class: 'muted small' }, t('v267.status_note')));
    const tools = h('div', { class: 'hub-tools-slot' });
    el.append(stats, running, lastBox, h('div', { class: 'hub-h4' }, t('v267.tools_row')), tools);
    refill25(el);
    el._painted = true;
  };

  const paintModels = async (el) => {
    el.innerHTML = '';
    const A = Store.state.settings.ai;
    el.append(h('div', { class: 'hub-h4' }, t('v267.task_only')));
    const mainTasks = ['chat', 'commands', 'greek', 'private', 'vision'];
    const moreTasks = ['summarize', 'embed'];
    const tasks = h('div', { class: 'tasks' });
    for (const k of mainTasks) {
      const def = (AI_TASKS || []).find((x) => x[0] === k) || [k, k, 'box'];
      const rowEl = this.taskRow(k, def[1], def[2]);
      if (k === 'greek') {
        const ic = rowEl.querySelector('.ti');
        if (ic) ic.innerHTML = this.greekFlag(18, 12);
      }
      tasks.append(rowEl);
    }
    el.append(tasks);
    const more = h('details', { class: 'hub-more' }, h('summary', {}, t('v267.more_tasks')));
    for (const k of moreTasks) {
      const def = (AI_TASKS || []).find((x) => x[0] === k) || [k, k, 'box'];
      more.append(this.taskRow(k, def[1], def[2]));
    }
    el.append(more);
    el.append(h('p', { class: 'muted small' }, t('v266.private_model_note') || ''), h('div', { class: 'hub-h4' }, t('v267.installed')));
    const inst = h('div', { 'data-zone': 'keep', class: 'zone' });
    let list = [], err = '';
    const llama = A.providers.find((p) => p.id === 'llama');
    try { list = llama && llama.enabled ? (await AI.models(llama.id, true)) || [] : []; }
    catch (e) { err = cleanErr(e); }
    if (err && !list.length) inst.append(h('p', { class: 'warn small' }, err));
    else if (!list.length) inst.append(h('p', { class: 'muted small' }, t('v266.zone_keep_empty')));
    const cfg = A.servers.llama;
    const dir = modelsDirOf(cfg);
    let disk = null;
    if (dir) {
      try {
        const r = await API.inv('models:listDir', dir, ['gguf', 'bin']);
        if (r && r.files) disk = r.files.reduce((a, f) => a + (f.size || 0), 0);
      } catch (e) { disk = null; }
    }
    for (const m of list) {
      const id = String(m.id || '');
      const name = id.split(/[\\/]/).pop();
      const lic = licenseFor(id);
      const size = (m.size || m.bytes) ? fmtGB(m.size || m.bytes) : '';
      inst.append(row(dot(m.loaded === false ? 'x' : 'g'), h('span', { class: 'grow', 'data-model': id }, name + (size ? ' · ' + size : '')), pill(lic.license), pill(t('v267.zone_keep_pill'))));
    }
    const budget = +cfg.diskBudgetGB || 70;
    inst.append(disk != null
      ? h('p', { class: 'muted small', 'data-disk': String(disk) }, t('v267.disk', { v0: fmtNum(disk / 1073741824, 1), v1: budget }))
      : h('p', { class: 'muted small' }, t('v267.disk_unknown')));
    el.append(inst);
    const zones = this.zonesBox();
    el.append(zones);
    setTimeout(() => {
      const keep = zones.querySelector('[data-zone=keep]');
      if (keep) keep.hidden = true;
      for (const z of ['cand', 'other', 'rej']) {
        const node = zones.querySelector('[data-zone="' + z + '"]');
        if (!node || node.parentElement?.tagName === 'DETAILS') continue;
        const title = node.querySelector('h5')?.textContent || z;
        const det = h('details', { class: 'hub-more', open: true });
        det.append(h('summary', {}, title));
        node.parentElement?.insertBefore(det, node);
        det.append(node);
      }
    }, 120);
    el._painted = true;
  };

  const paintEngines = (el) => {
    el.innerHTML = '';
    const A = Store.state.settings.ai;
    const compact = (id, title, summary, startId) => {
      const st = h('span', { class: 'srv-st' });
      const log = h('pre', { class: 'srv-log', hidden: true });
      const box = h('div', { class: 'srv', 'data-srv': id });
      const upd = (s) => {
        if (s) this.procState[id] = s;
        const r = this.procState[id] || {};
        st.className = 'srv-st ' + (r.running ? 'on' : 'off');
        st.textContent = r.running ? t('hub.061', { pid: r.pid }) : (r.exit != null ? t('hub.062', { exit: r.exit }) : t('hub.063'));
        log.textContent = (r.cmd ? '> ' + r.cmd + '\n' : '') + ((r.log || []).join('\n'));
      };
      API.inv('proc:status', startId || id).then(upd).catch(() => {});
      if (API.onProcStatus) API.onProcStatus((s) => { if (s.id === (startId || id)) upd(s); });
      const running = () => !!(this.procState[startId || id]?.running);
      const go = async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try {
          if (running()) upd(await API.inv('proc:stop', startId || id));
          else if (id === 'sd') await Lazy.run('hub25', () => Hub25.sdStart());
          else await this.startServer(startId || id);
        } finally { b.disabled = false; }
      };
      const startLbl = () => running() ? t('hub.065').trim() : t('hub.064').trim();
      const btn = h('button', { class: 'btn sm primary', onclick: go }, startLbl());
      const logs = h('button', { class: 'btn sm ghost', onclick: () => { log.hidden = !log.hidden; } }, t('v267.logs'));
      box.append(row(dot('x'), h('span', { class: 'grow' }, h('b', {}, title), h('br'), h('span', { class: 'muted small' }, summary)), st, btn, logs), log);
      const syncDot = () => { const d = box.querySelector('.hub-dot'); if (d) d.className = 'hub-dot ' + (running() ? 'g' : 'x'); btn.textContent = startLbl(); };
      const iv = setInterval(() => { if (!document.contains(box)) return clearInterval(iv); syncDot(); }, 800);
      setTimeout(syncDot, 200);
      return box;
    };
    const L = A.servers.llama, W = A.servers.whisper, meta = llamaMeta(L);
    const ctxShow = meta.ctx || '—';
    const dirShow = (meta.dir || modelsDirOf(L) || '—').toString().split(/[\\/]/).slice(-2).join('\\');
    const build = /b12\d+/.test(String(L.exe || L.extra || '')) ? (String(L.exe + L.extra).match(/b12\d+/) || ['b12230'])[0] : t('v267.llm_build_unknown');
    el.append(
      compact('llama', t('v267.llm_router'), t('v267.llm_summary', { v0: build, v1: dirShow, v2: meta.max || '—', v3: ctxShow, v4: 'Vulkan' })),
      compact('whisper', t('v267.stt_row'), t('v267.stt_summary', { v0: (W.model || '').split(/[\\/]/).pop() || 'ggml', v1: W.language || A.stt.language || 'el', v2: W.port || 8178 })),
    );
    const ttsMode = A.tts.mode;
    const ttsBox = h('div', { class: 'srv', 'data-srv': 'tts' });
    if (ttsMode === 'system') {
      ttsBox.append(row(dot('x'), h('span', { class: 'grow' }, h('b', {}, t('v267.tts_row')), h('br'), h('span', { class: 'muted small' }, t('v267.tts_system')))));
    } else {
      ttsBox.append(compact('tts', t('v267.tts_row'), t('v267.tts_summary', { v0: (A.tts.model || '').split(/[\\/]/).pop() || 'base Q8_0' }), 'tts').children[0], compact('tts', '', '', 'tts').querySelector('.srv-log') || '');
      // simpler: just a start button row
      ttsBox.innerHTML = '';
      ttsBox.append(row(dot('x'), h('span', { class: 'grow' }, h('b', {}, t('v267.tts_row')), h('br'), h('span', { class: 'muted small' }, t('v267.tts_summary', { v0: (A.tts.model || '').split(/[\\/]/).pop() || 'base Q8_0' }))), h('button', { class: 'btn sm primary', onclick: () => toast(t('v267.not_configured')) }, t('hub.064').trim())));
    }
    el.append(ttsBox);
    const imgSlot = h('div', { class: 'hub-image-slot srv', 'data-srv': 'sd' });
    imgSlot.append(row(dot('x'), h('span', { class: 'grow' }, h('b', {}, t('v267.image_row')), h('br'), h('span', { class: 'muted small' }, t('v267.image_summary'))), h('button', { class: 'btn sm', onclick: () => { const adv = el.querySelector('details.hub-adv'); if (adv) adv.open = true; } }, t('v267.configure'))));
    el.append(imgSlot);

    const adv = h('details', { class: 'hub-adv' }, h('summary', {}, t('v267.advanced')), h('p', { class: 'muted small' }, t('v267.advanced_note')));
    const llamaAdv = h('div', { 'data-srv': 'llama' });
    const llamaExe = this.pathRow(L, 'exe', t('hub.067'), 'file', { kind: 'exe', names: ['llama-server.exe', 'llama-server'] });
    const llamaModel = this.pathRow(L, 'model', t('hub.068'), 'file', { kind: 'llama' });
    const llamaDir = this.pathRow(L, 'modelsDir', t('v267.models_dir'), 'dir');
    llamaAdv.append(
      llamaExe, llamaModel, llamaDir,
      h('div', { class: 'row gap srv-nums' },
        this.field('Port', this.inp(L, 'port', '8080', 'number')),
        this.field('GPU layers (-ngl)', this.inp(L, 'ngl', '99', 'number')),
        this.ctxField(L),
        this.field(t('v267.models_max'), this.inp(L, 'modelsMax', '2', 'number')),
        this.field(t('v267.disk_budget'), this.inp(L, 'diskBudgetGB', '70', 'number'), t('v267.disk_budget_help'))),
      this.llamaCtxExtras(L),
      this.field(t('hub.069'), this.inp(L, 'extra', t('v22.ph_llama')), t('v22.extra_help')),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: L.autoStart ? true : null, onchange: (e) => { L.autoStart = e.target.checked; Store.save(); } }), h('span', {}, t('v22.autostart')))
    );
    this._rows.llama = { exe: llamaExe, model: llamaModel, modelsDir: llamaDir, log: null };
    const whisAdv = h('div', { 'data-srv': 'whisper' });
    const whisExe = this.pathRow(W, 'exe', t('hub.067'), 'file', { kind: 'exe', names: ['whisper-server.exe', 'whisper-server'] });
    const whisModel = this.pathRow(W, 'model', t('hub.068'), 'file', { kind: 'whisper' });
    whisAdv.append(
      whisExe, whisModel,
      h('div', { class: 'row gap srv-nums' }, this.field('Port', this.inp(W, 'port', '8178', 'number')), this.field(t('hub.015'), this.inp(W, 'language', 'el'))),
      this.field(t('hub.069'), this.inp(W, 'extra', t('v22.ph_whisper')), t('v22.extra_help')),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: W.autoStart ? true : null, onchange: (e) => { W.autoStart = e.target.checked; Store.save(); } }), h('span', {}, t('v22.autostart')))
    );
    this._rows.whisper = { exe: whisExe, model: whisModel, log: null };
    const T = A.tts || {};
    const ttsAdv = h('div', { 'data-srv': 'tts' });
    ttsAdv.append(
      this.pathRow(T, 'exe', t('v22.tts_exe'), 'file', { kind: 'exe', names: ['vs-engine.exe', 'omnivoice-tts.exe', 'piper.exe'] }),
      this.pathRow(T, 'model', t('v22.tts_model'), 'file', { kind: 'tts-model', names: ['omnivoice-base-Q8_0.gguf'] }),
      this.pathRow(T, 'tokenizer', t('v22.tts_tok'), 'file', { kind: 'tts-tokenizer', names: ['omnivoice-tokenizer-Q8_0.gguf'] }),
      this.field(t('hub.069'), this.inp(T, 'extra', ''))
    );
    const sdAdv = h('div', { class: 'hub-sd-adv' });
    adv.append(h('h4', {}, t('v267.llm_router')), llamaAdv, h('h4', {}, t('v267.stt_row')), whisAdv, h('h4', {}, t('v267.tts_row')), ttsAdv, h('h4', {}, t('v267.image_row')), sdAdv);
    el.append(adv);
    refill25(el);
    el._painted = true;
  };

  const paintCloud = (el) => {
    el.innerHTML = '';
    const A = Store.state.settings.ai;
    el.append(h('p', { class: 'muted small' }, t('v267.cloud_note')));
    const usedIds = ['groq', 'venice', 'xai'];
    const moreIds = ['llama', 'lmstudio', 'ollama', 'openrouter', 'openai', 'custom'];
    const list = h('div', { class: 'prov-list hub-cloud-used' });
    for (const id of usedIds) {
      const p = A.providers.find((x) => x.id === id);
      if (p) list.append(this.cloudRow(p));
    }
    A.rentedGpu ||= { enabled: false, capUsd: 10, endpoint: '', extra: '' };
    const Rg = A.rentedGpu;
    const rent = h('div', { class: 'prov', 'data-prov': 'rented' },
      row(dot(Rg.enabled ? 'g' : 'x'), h('span', { class: 'grow' }, t('v267.rented')), pill(t('v267.rented_cap', { v0: Rg.capUsd || 10 })), h('button', { class: 'btn sm', onclick: () => {
        const cap = h('input', { class: 'inp', type: 'number', min: 0, value: Rg.capUsd || 10 });
        const ep = h('input', { class: 'inp', placeholder: 'https://…/v1', value: Rg.endpoint || '' });
        Panels.modal(t('v267.rented'), h('div', {}, this.field(t('v267.rented_cap', { v0: '' }).replace(/\s*\$\/.*/, '') || 'USD', cap), this.field('Endpoint', ep), h('p', { class: 'muted small' }, t('v267.rented_help'))), { ok: () => { Rg.capUsd = +cap.value || 10; Rg.endpoint = ep.value.trim(); Store.save(); paintCloud(el); } });
      } }, t('v267.configure'))));
    list.append(rent);
    el.append(list);
    const more = h('details', { class: 'hub-more' }, h('summary', {}, t('v267.more_cloud')), h('p', { class: 'muted small' }, t('v267.more_cloud_note')));
    for (const id of moreIds) {
      const p = A.providers.find((x) => x.id === id);
      if (p) more.append(this.cloudRow(p));
    }
    const sogniSlot = h('div', { class: 'hub-cloud-more-slot' });
    more.append(sogniSlot);
    el.append(more);
    refill25(el);
    el._painted = true;
  };

  this.cloudRow = this.cloudRow || function (p) {
    // compact cloud row + reuse provRow internals for ping / 403 / key
    const wrap = this.provRow(p);
    wrap.classList.add('hub-cloud-row');
    const status = wrap.querySelector('.pstat');
    if (AI.isBlocked(p.id) && status) {
      const b = AI.blocked[p.id];
      status.className = 'pstat bad forbidden';
      status.textContent = '🚫 403 · ' + (b.reason || t('v267.wrong_key'));
    }
    // add «Νέο κλειδί» next to 403
    if (p.keyRef) {
      const keyBtn = h('button', { class: 'btn sm', onclick: () => {
        const inp = wrap.querySelector('input[type=password]');
        if (inp) { inp.focus(); inp.scrollIntoView({ block: 'center' }); }
      } }, t('v267.new_key'));
      wrap.querySelector('.prov-head')?.append(keyBtn);
    }
    if (p.id === 'venice') {
      wrap.querySelector('.prov-head')?.append(pill(t('v267.venice_note')));
    }
    return wrap;
  };

  panes.status._paint = () => paintStatus(panes.status);
  panes.models._paint = () => paintModels(panes.models);
  panes.engines._paint = () => paintEngines(panes.engines);
  panes.cloud._paint = () => paintCloud(panes.cloud);
  show(this.tab || 'status');
  // Build every pane once so path fields and providers exist in the DOM (hidden tabs stay in the tree).
  if (this.tab !== 'engines') panes.engines._paint();
  if (this.tab !== 'cloud') panes.cloud._paint();
  if (this.tab !== 'models') panes.models._paint();
};
