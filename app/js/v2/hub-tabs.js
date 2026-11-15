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
    // v2.6.9.1: checked on Hugging Face 14/11/2026 — unsloth/Qwen3.8-27B-GGUF and its base Qwen/Qwen3.8-27B both say license: apache-2.0
    if (/qwen3\.8-27b/.test(s)) return { license: 'Apache-2.0', note: t('v2691.lic_qwen38'), url: 'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF' };
    if (/krikri|llama-3\.1|llama3\.1/.test(s)) return { license: 'Llama 3.1 Community License', note: '', url: '' };
    return { license: t('v267.license_unknown'), note: '', url: '' };
  };
  const raceMs = (p, ms, fb) => Promise.race([Promise.resolve(p).catch(() => fb), new Promise((r) => setTimeout(() => r(fb), ms))]);
  const maxLabel = (n) => (n != null && Number.isFinite(+n) && +n >= 0) ? String(Math.floor(+n)) : t('v2671.max_unknown');
  const routerDown = (port) => t('v2671.router_down', { v0: port || 8080 });
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

  const paintStatus = (el) => {
    const A = Store.state.settings.ai;
    const llama = A.providers.find((p) => p.id === 'llama') || { id: 'llama', base: 'http://127.0.0.1:' + (A.servers.llama.port || 8080) + '/v1', kind: 'local' };
    const port = A.servers.llama.port || 8080;
    const meta = llamaMeta(A.servers.llama);
    const last = AI.lastRequest || null;
    const cached = el._live || {};

    const loadB = h('b', { 'data-st': 'load' }, cached.loadLabel || '…');
    const loadS = h('span', { 'data-st': 'load-sub' }, cached.loadSub || t('v2671.loading'));
    const vramB = h('b', { 'data-st': 'vram' }, cached.vramB || '…');
    const vramS = h('span', { 'data-st': 'vram-sub' }, cached.vramS || t('v2671.loading'));
    const ctxB = h('b', { 'data-st': 'ctx' }, cached.ctxB || (meta.ctx ? (meta.ctx >= 1024 ? Math.round(meta.ctx / 1024) + 'K' : String(meta.ctx)) : '…'));
    const ctxS = h('span', {}, t('v267.stat_ctx'));
    const speed = last && last.predicted_n != null && last.predicted_ms > 0 ? (last.predicted_n / (last.predicted_ms / 1000)) : null;
    // v2.6.9: MTP / speculative state from the server's own timings of the last request (draft_n), never guessed
    const mtp = NyxLimits.mtpOf(AI.lastTimings);
    const mtpB = h('b', { 'data-st': 'mtp', 'data-mtp': mtp.state }, mtp.state === 'on' ? t('v269.mtp_on') : mtp.state === 'off' ? t('v269.mtp_off') : t('v269.mtp_unknown'));
    const lastModel = last && last.model ? String(last.model).split(/[\\/]/).pop() : '';
    const mtpTip = mtp.state === 'on' ? t('v269.mtp_on_tip', { v0: mtp.accepted != null ? mtp.accepted : '—', v1: mtp.draft, v2: mtp.rate != null ? Math.round(mtp.rate * 100) + '%' : '—' }) : mtp.state === 'off' ? t('v269.mtp_off_tip', { v0: lastModel || '—' }) : t('v269.mtp_unknown_tip');
    const stats = h('div', { class: 'hub-stats' },
      h('div', { class: 'hub-stat' }, loadB, loadS),
      h('div', { class: 'hub-stat' }, vramB, vramS),
      h('div', { class: 'hub-stat' }, ctxB, ctxS),
      h('div', { class: 'hub-stat', 'data-st': 'speed' }, h('b', {}, speed != null ? Math.round(speed) + ' t/s' : '—'), h('span', {}, speed != null ? (lastModel ? t('v269.speed_model', { v0: lastModel }) : t('v267.stat_speed')) : t('v267.stat_speed_none'))),
      h('div', { class: 'hub-stat', title: mtpTip }, mtpB, h('span', {}, t('v269.stat_mtp'))));
    const vramWarn = h('div', { class: 'hub-vram-warn', 'data-st': 'vram-warn', hidden: true });

    const llamaDot = dot(cached.llamaKind || 'x'); llamaDot.setAttribute('data-st', 'llama-dot');
    const llamaMsg = h('span', { class: 'grow', 'data-st': 'llama-msg' }, t('v267.llm_router') + ' · :' + port);
    const llamaPill = h('span', { 'data-st': 'llama-pill', class: 'hub-pills' });
    if (cached.loadedNames) llamaPill.append(pill(cached.loadedNames));
    const whisperDot = dot(cached.whisperOn ? 'g' : 'x');
    const ttsOn = !!(this.procState.tts?.running);
    const sdOn = !!(this.procState.sd?.running);
    // v2.6.11: one clear Greek state per row (σε λειτουργία / σταματημένο), never an English «running/stopped»
    const runPill = (on, st) => { const p = pill(on == null ? t('v2611.st_check') : on ? t('v2611.st_on') : t('v2611.st_off'), on ? 'ok' : on === false ? 'off' : ''); p.setAttribute('data-run', on == null ? '' : on ? 'on' : 'off'); if (st) p.setAttribute('data-st', st); return p; };
    const llamaRun = runPill(cached.llamaKind ? cached.llamaKind === 'g' : null, 'llama-run');
    const whisperRun = runPill(cached.whisperOn != null ? !!cached.whisperOn : null, 'whisper-run');
    const liveN = document.querySelectorAll('webview').length;
    const running = h('div', {},
      h('div', { class: 'hub-h4' }, t('v267.running')),
      row(llamaDot, llamaMsg, llamaPill, llamaRun),
      row(whisperDot, h('span', { class: 'grow' }, t('v267.stt_row') + ' · :' + (A.servers.whisper.port || 8178)), h('span', { class: 'hub-pills' }, pill((A.servers.whisper.model || A.stt.kind || '').toString().split(/[\\/]/).pop() || 'whisper')), whisperRun),
      row(dot(ttsOn ? 'g' : 'x'), h('span', { class: 'grow' }, t('v267.tts_row')), ttsOn ? pill('OmniVoice') : h('button', { class: 'btn sm', onclick: () => this.startTtsEngine?.() || toast(t('v267.not_configured')) }, t('hub.064').trim()), runPill(ttsOn)),
      row(dot(sdOn ? 'g' : 'x'), h('span', { class: 'grow' }, t('v267.image_row')), sdOn ? pill('sd-server') : h('span', { class: 'muted small' }, t('v267.not_configured'))),
      row(dot(liveN ? 'g' : 'x'), h('span', { class: 'grow', 'data-st': 'live-pages', 'data-n': String(liveN) }, t('v2611.live_pages')), pill(t('v2611.live_pages_n', { v0: liveN }))));

    const lastBox = h('div', {}, h('div', { class: 'hub-h4' }, t('v267.last_msg')));
    if (!last) lastBox.append(h('p', { class: 'muted small' }, t('v267.last_none')));
    else {
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
    el.innerHTML = '';
    el.append(stats, vramWarn, running, lastBox, h('div', { class: 'hub-h4' }, t('v267.tools_row')), tools);
    refill25(el);
    el._painted = true;

    const tok = el._fillTok = (el._fillTok || 0) + 1;
    const mid = (A.tasks && (A.tasks.commands?.m || A.tasks.chat?.m || A.tasks.greek?.m)) || '';
    (async () => {
      const modelsP = llama.enabled ? raceMs(AI.models(llama.id, true), 1200, []) : Promise.resolve([]);
      const ctxP = raceMs(API.inv('ai:context', { ...llama, base: llama.base }, { model: mid || undefined, probe: true, timeout: 800 }), 1200, null);
      // v2.6.9.1: the Windows GPU snapshot (PowerShell + WMI) takes 2–6 s; racing it at 1,2 s showed «VRAM μη διαθέσιμη».
      // It is painted separately when it arrives (up to 20 s), with «μέτρηση…» meanwhile and the real error if it fails.
      const perfP = Promise.resolve(null);
      vramS.textContent = t('v2691.vram_measuring');
      raceMs(API.inv('perf:snapshot'), 20000, { _timeout: true }).then((pf) => {
        if (el._fillTok !== tok || !document.contains(el)) return;
        const ad2 = pf && pf.gpu && pf.gpu.adapter;
        const known = ad2 && (ad2.used != null || ad2.total);
        vramB.textContent = known ? fmtGB(ad2.used) : '—';
        if (known) vramB.setAttribute('data-gvs-vram', String(ad2.used || 0));
        vramS.textContent = known ? t('v267.stat_vram', { v0: fmtGB(ad2.total) }) : (pf && pf._timeout ? t('v2691.vram_timeout') : t('v267.stat_vram_unknown') + (pf?.gpu?.error ? ' · ' + pf.gpu.error : ''));
        vramS.setAttribute('data-st-done', '1');
        Hub.paintVramWarn(vramWarn, pf && !pf._timeout ? pf : null);
        if (el._live) { el._live.vramB = vramB.textContent; el._live.vramS = vramS.textContent; }
      });
      const infoP = raceMs(API.inv('ai:routerInfo', llama, { timeout: 800 }), 900, null);
      const hlP = raceMs(API.inv('proc:health', this.healthUrl('llama', A.servers.llama), 800), 900, { ok: false });
      const hwP = raceMs(API.inv('proc:health', this.healthUrl('whisper', A.servers.whisper), 800), 900, { ok: false });
      const [models0, ctxR0, perf0, info0, hl0, hw0] = await Promise.all([modelsP, ctxP, perfP, infoP, hlP, hwP]);
      if (el._fillTok !== tok || !document.contains(el)) return;
      const models = Array.isArray(models0) ? models0 : [];
      const ctxR = ctxR0 && !ctxR0._timeout ? ctxR0 : ctxR0;
      const perf = perf0 || { gpu: {} };
      const info = info0 && info0.ok ? info0 : null;
      const hl = hl0 || { ok: false };
      const hw = hw0 || { ok: false };

      const liveMax = (info && info.max_instances != null) ? info.max_instances : (meta.max || null);
      const nCtx = ctxR?.n_ctx || meta.ctx || null;
      const loaded = models.filter((m) => m.loaded === true || m.state === 'loaded');
      const loadedKnown = models.some((m) => m && (m.loaded === true || m.loaded === false || m.state));
      const loadCount = loadedKnown ? loaded.length : null;
      const loadMax = liveMax;
      // v2.6.9.1: «3 / 2 διαθέσιμα» mixed the number of models in the folder with --models-max. Now: loaded / max when the
      // router says which are loaded (status.value), otherwise «— φορτωμένα» plus «N στον φάκελο» — never one over the other.
      const loadLabel = loadCount != null ? (loadMax != null ? loadCount + ' / ' + loadMax : String(loadCount)) : '—';
      const loadSub = loadCount != null
        ? (loadMax != null ? t('v2691.stat_loaded_of', { v0: loadMax }) : t('v267.stat_loaded')) + (models.length ? ' · ' + t('v2691.in_folder', { v0: models.length }) : '')
        : (models.length ? t('v2691.loaded_unknown_n', { v0: models.length }) : t('v267.loaded_unknown'));
      const ad = perf && perf.gpu && perf.gpu.adapter;
      const vramKnown = ad && (ad.used != null || ad.total);
      const ctxShown = meta.ctx || nCtx;
      loadB.textContent = loadLabel;
      loadS.textContent = loadSub;
      if (vramKnown) { vramB.textContent = fmtGB(ad.used); vramB.setAttribute('data-gvs-vram', String(ad.used || 0)); vramS.textContent = t('v267.stat_vram', { v0: fmtGB(ad.total) }); }
      ctxB.textContent = ctxShown ? (ctxShown >= 1024 ? Math.round(ctxShown / 1024) + 'K' : String(ctxShown)) : '—';
      if (ctxShown) ctxB.setAttribute('data-gvs-ctx', String(ctxShown));

      const llamaOn = !!(this.procState.llama?.running || hl.ok || hl.status);
      const whisperOn = !!(this.procState.whisper?.running || hw.ok || hw.status);
      llamaDot.className = 'hub-dot ' + (llamaOn ? 'g' : 'r');
      if (!llamaOn) {
        llamaMsg.textContent = t('v267.llm_router') + ' · ' + routerDown(port);
        llamaMsg.classList.add('hub-down');
      } else {
        llamaMsg.textContent = t('v267.llm_router') + ' · :' + port;
        llamaMsg.classList.remove('hub-down');
      }
      const loadedNames = (loadedKnown ? loaded : models).map((m) => String(m.id || '').split(/[\\/]/).pop()).filter(Boolean).slice(0, 4);
      llamaPill.innerHTML = '';
      if (loadedNames.length) llamaPill.append(pill(loadedNames.join(' · ')));
      whisperDot.className = 'hub-dot ' + (whisperOn ? 'g' : 'x');
      const setRun = (p, on) => { p.textContent = on ? t('v2611.st_on') : t('v2611.st_off'); p.className = 'hub-pill ' + (on ? 'ok' : 'off'); p.setAttribute('data-run', on ? 'on' : 'off'); };
      setRun(llamaRun, llamaOn); setRun(whisperRun, whisperOn);
      if (typeof HubHead !== 'undefined') HubHead.set(models, liveMax);

      el._live = {
        loadLabel, loadSub,
        vramB: vramB.textContent, vramS: vramS.textContent,
        ctxB: ctxB.textContent,
        llamaKind: llamaOn ? 'g' : 'r',
        whisperOn, loadedNames: loadedNames.join(' · '),
        liveMax,
      };
      this._routerLive = { max: liveMax, down: !llamaOn, port, at: Date.now() };
    })().catch((e) => console.warn('hub status fill', e));
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
    el.append(tasks, h('p', { class: 'muted small hub-mmproj-note', 'data-vision-hint': '1' }, t('v268.mmproj_card')));
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
    if (typeof HubHead !== 'undefined' && !err) {
      // v2.6.11: header from the same read-only /props the Status tab uses (never a stale or fixed number)
      const info = llama && llama.enabled ? await raceMs(API.inv('ai:routerInfo', llama, { timeout: 800 }), 900, null) : null;
      const mx = info && info.ok && info.max_instances != null ? info.max_instances : (llamaMeta(A.servers.llama).max || null);
      HubHead.set(list, mx);
    }
    if (err && !list.length) inst.append(h('p', { class: 'warn small' }, err));
    else if (!list.length) inst.append(h('p', { class: 'muted small' }, t('v266.zone_keep_empty')));
    const cfg = A.servers.llama;
    const dir = modelsDirOf(cfg);
    // v2.6.9.1: disk = model files (.gguf/.bin/.safetensors) in the router's models folder AND the OmniVoice models folder,
    // in decimal GB (10^9, like Explorer «size» in GB on the PC measure 37,9 GB). It was GVS\models only, in GiB (34,4).
    let disk = null; const diskParts = [];
    const ttsDir = String(A.tts.model || '').replace(/[\\/][^\\/]*$/, '');
    const dirs = [...new Set([dir, ttsDir].filter(Boolean))].filter((d, i, arr) => !arr.some((o, j) => j !== i && d.toLowerCase().startsWith(o.toLowerCase() + '\\')));
    for (const d of dirs) {
      try {
        const r = await API.inv('models:listDir', d, ['gguf', 'bin', 'safetensors']);
        if (r && r.files) { const b = r.files.reduce((a, f) => a + (f.size || 0), 0); diskParts.push({ dir: d, bytes: b }); disk = (disk || 0) + b; }
      } catch (e) {}
    }
    for (const m of list) {
      const id = String(m.id || '');
      const name = id.split(/[\\/]/).pop();
      const lic = licenseFor(id);
      const size = (m.size || m.bytes) ? fmtGB(m.size || m.bytes) : '';
      // v2.6.11: card per model with a Greek state (φορτωμένο / φορτώνει / στον δίσκο); long names wrap, never cut
      const ms = NyxUI.modelState(m);
      const card = row(dot(ms === 'loaded' ? 'g' : ms === 'loading' ? 'y' : 'x'), h('span', { class: 'grow hub-mname', 'data-model': id }, name + (size ? ' · ' + size : '')), h('span', { class: 'hub-pills' }, pill(lic.license), pill(t('v267.zone_keep_pill'))), pill(t('v2611.m_' + ms), (ms === 'loaded' ? 'ok' : ms === 'loading' ? 'warn' : 'off') + ' hub-mstate'));
      card.classList.add('hub-model'); card.setAttribute('data-mstate', ms); if (ms === 'loaded') card.classList.add('is-loaded');
      inst.append(card);
    }
    // v2.6.9.1: the mmproj hint is shown once (under the tasks); it was repeated here.
    const budget = +cfg.diskBudgetGB || 70;
    inst.append(disk != null
      ? h('p', { class: 'muted small', 'data-disk': String(disk), 'data-disk-gb': fmtNum(disk / 1e9, 1) }, t('v2691.disk', { v0: fmtNum(disk / 1e9, 1), v1: budget, v2: diskParts.map((x) => x.dir.split(/[\\/]/).slice(-2).join('\\') + ' ' + fmtNum(x.bytes / 1e9, 1)).join(' + ') }))
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
        const titleEl = node.querySelector('h5');
        const title = titleEl?.textContent || z;
        if (titleEl) titleEl.hidden = true;
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
    const compact = (id, title, summary, startId, opts) => {
      opts = opts || {};
      const st = h('span', { class: 'srv-st' });
      const log = h('pre', { class: 'srv-log', hidden: true });
      const box = h('div', { class: 'srv', 'data-srv': id });
      const sumEl = h('span', { class: 'muted small', 'data-st': 'summary' }, summary);
      let live = !!(this.procState[startId || id]?.running);
      let mine = live;
      let lastHealth = null;
      const port = opts.port;
      const upd = (s) => {
        if (s) this.procState[startId || id] = s;
        const r = this.procState[startId || id] || {};
        mine = !!r.running;
        live = !!(mine || (lastHealth && (lastHealth.ok || lastHealth.status)));
        if (opts.health && lastHealth && !live) {
          st.className = 'srv-st err';
          st.textContent = routerDown(port);
        } else if (live && !mine && opts.health) {
          st.className = 'srv-st on';
          st.textContent = t('v2671.external_on', { v0: port || 8080 });
        } else {
          st.className = 'srv-st ' + (r.running ? 'on' : 'off');
          st.textContent = r.running ? t('hub.061', { pid: r.pid }) : (r.exit != null ? t('hub.062', { exit: r.exit }) : (opts.health ? routerDown(port) : t('hub.063')));
          if (opts.health && !r.running) st.className = 'srv-st err';
        }
        log.textContent = (r.cmd ? '> ' + r.cmd + '\n' : '') + ((r.log || []).join('\n'));
      };
      API.inv('proc:status', startId || id).then(upd).catch(() => {});
      if (API.onProcStatus) API.onProcStatus((s) => { if (s.id === (startId || id)) upd(s); });
      const runningMine = () => !!(this.procState[startId || id]?.running);
      const go = async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try {
          if (runningMine()) upd(await API.inv('proc:stop', startId || id));
          else if (id === 'sd') await Lazy.run('hub25', () => Hub25.sdStart());
          else await this.startServer(startId || id);
        } finally { b.disabled = false; syncDot(); }
      };
      const startLbl = () => runningMine() ? t('hub.065').trim() : t('hub.064').trim();
      const btn = h('button', { class: 'btn sm primary', 'data-st': 'start', onclick: go }, startLbl());
      const logs = h('button', { class: 'btn sm ghost', onclick: () => { log.hidden = !log.hidden; } }, t('v267.logs'));
      box.append(row(dot('x'), h('span', { class: 'grow' }, h('b', {}, title), h('br'), sumEl), st, btn, logs), log);
      const syncDot = () => {
        const d = box.querySelector('.hub-dot');
        const on = !!(runningMine() || (opts.health && lastHealth && (lastHealth.ok || lastHealth.status)));
        if (d) d.className = 'hub-dot ' + (on ? 'g' : (opts.health ? 'r' : 'x'));
        btn.textContent = startLbl();
        upd(this.procState[startId || id]);
      };
      if (opts.health) {
        const ping = async () => {
          lastHealth = await API.inv('proc:health', this.healthUrl(id, opts.cfg || A.servers[id] || {}), 800).catch(() => ({ ok: false }));
          syncDot();
        };
        ping();
        const ivH = setInterval(() => { if (!document.contains(box)) return clearInterval(ivH); ping(); }, 2500);
      }
      const iv = setInterval(() => { if (!document.contains(box)) return clearInterval(iv); syncDot(); }, 800);
      setTimeout(syncDot, 200);
      box._setSummary = (txt) => { sumEl.textContent = txt; };
      return box;
    };
    const L = A.servers.llama, W = A.servers.whisper, meta = llamaMeta(L);
    const ctxShow = meta.ctx || '—';
    const dirShow = (meta.dir || modelsDirOf(L) || '—').toString().split(/[\\/]/).slice(-2).join('\\');
    const build = /b12\d+/.test(String(L.exe || L.extra || '')) ? (String(L.exe + L.extra).match(/b12\d+/) || ['b12230'])[0] : t('v267.llm_build_unknown');
    const maxShow = maxLabel(this._routerLive && this._routerLive.max != null ? this._routerLive.max : (meta.max || null));
    const llamaBox = compact('llama', t('v267.llm_router'), t('v267.llm_summary', { v0: build, v1: dirShow, v2: maxShow, v3: ctxShow, v4: 'Vulkan' }), 'llama', { health: true, port: L.port || 8080, cfg: L });
    // v2.6.10.1: router API key — «ενεργό» + copy (the key itself stays in main) + warning when the router answers without it
    const keyRow = (() => {
      const box = h('div', { class: 'srv-key', 'data-router-key': '' });
      const line = h('span', { class: 'grow small', 'data-rk': 'line' }, '🔑 ' + t('v26101.key_active'));
      const copy = h('button', { class: 'btn sm ghost', 'data-rk': 'copy', onclick: async () => {
        try { await API.inv('proc:routerKeyCopy'); toast(t('v26101.key_copied'), { ms: 6000 }); } catch (e) { toast('⚠️ ' + cleanErr(e), { kind: 'err', ms: 8000 }); }
      } }, t('v26101.copy'));
      const warn = h('p', { class: 'small rk-warn', 'data-rk': 'warn', hidden: true });
      box.append(row(line, copy), warn);
      const port = +(L.port || 8080);
      const check = async () => {
        const r = await API.inv('proc:routerKey', port).catch(() => null); if (!r) return;
        box.dataset.state = r.state;
        const msg = r.state === 'open' ? t('v26101.warn_open', { v0: port }) : r.state === 'mismatch' ? t('v26101.warn_mismatch', { v0: port }) : ((r.autostart && r.autostart.on && !r.autostart.keyed) ? t('v26101.warn_autostart') : '');
        warn.hidden = !msg; warn.textContent = msg ? '⚠️ ' + msg : '';
      };
      check();
      const iv = setInterval(() => { if (!document.contains(box)) return clearInterval(iv); check(); }, 20000);
      // re-check at once when the router comes up / goes down (public /health — no «unauthorized» lines in its log)
      let lastUp = null;
      const ivU = setInterval(async () => {
        if (!document.contains(box)) return clearInterval(ivU);
        const hh = await API.inv('proc:health', 'http://127.0.0.1:' + port + '/health', 800).catch(() => null);
        const up = !!(hh && (hh.ok || hh.status));
        if (lastUp !== null && up !== lastUp) check();
        lastUp = up;
      }, 2500);
      box._check = check;
      return box;
    })();
    el.append(
      llamaBox,
      keyRow,
      compact('whisper', t('v267.stt_row'), t('v267.stt_summary', { v0: (W.model || '').split(/[\\/]/).pop() || 'ggml', v1: W.language || A.stt.language || 'el', v2: W.port || 8178 })),
    );
    const llamaProv = A.providers.find((p) => p.id === 'llama') || { id: 'llama', base: 'http://127.0.0.1:' + (L.port || 8080) + '/v1', kind: 'local' };
    raceMs(API.inv('ai:routerInfo', llamaProv, { timeout: 800 }), 900, null).then((info) => {
      const live = (info && info.ok && info.max_instances != null) ? info.max_instances : (meta.max || null);
      this._routerLive = { ...(this._routerLive || {}), max: live, at: Date.now() };
      llamaBox._setSummary?.(t('v267.llm_summary', { v0: build, v1: dirShow, v2: maxLabel(live), v3: ctxShow, v4: 'Vulkan' }));
    });

    // v2.6.9.1: the «Κείμενο → φωνή» card is about OmniVoice (the Windows voice was ruled out). It shows the OmniVoice
    // files with ✓/✗; if the speaking mode is still «Φωνή συστήματος», that is said in a warning with a one-click switch
    // (only on the user's click — nothing changes by itself).
    const ttsMode = A.tts.mode;
    const ttsBox = h('div', { class: 'srv', 'data-srv': 'tts', 'data-tts-engine': 'omnivoice' });
    const ttsSum = h('span', { class: 'muted small', 'data-st': 'tts-summary' }, t('v267.tts_summary', { v0: (A.tts.model || '').split(/[\\/]/).pop() || 'base Q8_0' }));
    const ttsChecks = h('span', { class: 'muted small', 'data-st': 'tts-paths' }, '');
    const ttsWarn = h('p', { class: 'warn small', 'data-st': 'tts-mode-warn', hidden: true });
    const ttsDot = dot('x');
    ttsBox.append(row(ttsDot, h('span', { class: 'grow' }, h('b', {}, t('v267.tts_row') + ' · OmniVoice'), h('br'), ttsSum, h('br'), ttsChecks), h('button', { class: 'btn sm primary', onclick: () => toast(t('v267.not_configured')) }, t('hub.064').trim())), ttsWarn);
    (async () => {
      const keys = [['exe', 'exe'], ['model', t('v2691.tts_model')], ['tokenizer', 'tokenizer']];
      const paths = keys.map(([k]) => A.tts[k] || '');
      const r = await API.inv('sys:exists', paths.filter(Boolean)).catch(() => null);
      let j = 0; const okAll = []; const parts = keys.map(([k, lab], i) => { if (!paths[i]) { okAll.push(false); return lab + ' —'; } const e = r && r[j++]; const ok = !!(e && e.exists && !e.dir); okAll.push(ok); return lab + ' ' + (ok ? '✓' : '✗'); });
      ttsChecks.textContent = parts.join(' · ');
      const ready = okAll.every(Boolean);
      ttsDot.className = 'hub-dot ' + (ready ? 'g' : 'x');
      ttsBox.setAttribute('data-tts-ready', ready ? '1' : '0');
      if (ttsMode === 'system') {
        ttsWarn.hidden = false; ttsWarn.innerHTML = '';
        ttsWarn.append(t(ready ? 'v2691.tts_mode_system' : 'v2691.tts_mode_system_missing'), ' ', ready ? h('button', { class: 'btn sm', 'data-act': 'use-omnivoice', onclick: () => { A.tts.mode = 'command'; Store.save(); ttsWarn.hidden = true; toast(t('v2691.tts_switched')); } }, t('v2691.tts_use')) : '');
      }
    })();
    el.append(ttsBox);
    const imgSlot = h('div', { class: 'hub-image-slot srv', 'data-srv': 'sd' });
    imgSlot.append(row(dot('x'), h('span', { class: 'grow' }, h('b', {}, t('v267.image_row')), h('br'), h('span', { class: 'muted small' }, t('v267.image_summary'))), h('button', { class: 'btn sm', onclick: () => { const adv = el.querySelector('details.hub-adv'); if (adv) adv.open = true; } }, t('v267.configure'))));
    el.append(imgSlot);

    const adv = h('details', { class: 'hub-adv' }, h('summary', {}, t('v267.advanced')), h('p', { class: 'muted small' }, t('v267.advanced_note')));
    const llamaAdv = h('div', { 'data-srv': 'llama' });
    const llamaExe = this.pathRow(L, 'exe', t('hub.067'), 'file', { kind: 'exe', names: ['llama-server.exe', 'llama-server'] });
    const llamaModel = this.pathRow(L, 'model', t('hub.068'), 'file', { kind: 'llama' });
    // v2.6.9.1: in router mode (--models-dir) the single «Μοντέλο» file is not used; it stays editable but says so.
    const routerMode = !!(meta.dir || /--models-dir/.test(String(L.extra || '')));
    if (routerMode) { llamaModel.classList.add('hub-na'); llamaModel.setAttribute('data-na', 'router'); llamaModel.append(h('small', { class: 'muted hub-na-note' }, t('v2691.na_router_model'))); }
    const llamaDir = this.pathRow(L, 'modelsDir', t('v267.models_dir'), 'dir');
    llamaAdv.append(
      llamaExe, llamaModel, llamaDir,
      h('div', { class: 'row gap srv-nums' },
        this.field('Port', this.inp(L, 'port', '8080', 'number')),
        this.field('GPU layers (-ngl)', this.inp(L, 'ngl', '99', 'number')),
        this.ctxField(L),
        this.field(t('v267.models_max'), this.inp(L, 'modelsMax', '2', 'number')),
        (() => {
          // v2.6.9.1: show the value the launch really uses (procs.js: -np from settings, else from «Επιπλέον», else 1), not a placeholder
          const exM = String(L.extra || '').match(/(?:^|\s)(?:-np|--parallel)(?:=|\s+)(\d+)/);
          const eff = (L.np != null && L.np !== '' && +L.np > 0) ? +L.np : exM ? +exM[1] : 1;
          const i = this.inp(L, 'np', '1', 'number'); if (i.value === '') i.value = String(eff);
          i.setAttribute('data-np', String(eff));
          return this.field(t('v2671.n_parallel'), i, t('v2691.np_help', { v0: eff, v1: (L.np != null && L.np !== '' && +L.np > 0) ? t('v2691.np_src_set') : exM ? t('v2691.np_src_extra') : t('v2691.np_src_default') }));
        })(),
        this.field(t('v267.disk_budget'), this.inp(L, 'diskBudgetGB', '70', 'number'), t('v267.disk_budget_help'))),
      this.llamaCtxExtras(L),
      this.field(t('hub.069'), this.inp(L, 'extra', t('v22.ph_llama')), t('v22.extra_help')),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: L.autoStart ? true : null, onchange: (e) => { L.autoStart = e.target.checked; Store.save(); } }), h('span', {}, t('v22.autostart'))),
      (() => {
        const box = h('div', { class: 'win-auto' });
        const paint = (st) => {
          const on = !!(st && st.on);
          L.winAutostart = on; Store.save();
          box.innerHTML = '';
          box.append(
            h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: on ? true : null, onchange: async (e) => {
              const want = e.target.checked;
              try {
                const r = await API.inv('proc:winAutostart', { on: want, cfg: L });
                toast(r.on ? t('v2671.win_autostart_on') : t('v2671.win_autostart_off'), { ms: 6000 });
                paint(r);
              } catch (err) { e.target.checked = !want; toast('⚠️ ' + t('v2671.win_autostart_fail', { v0: cleanErr(err) }), { kind: 'err', ms: 9000 }); }
            } }), h('span', {}, t('v2671.win_autostart'))),
            h('p', { class: 'muted small' }, t('v2671.win_autostart_help', { v0: L.port || 8080 }) + (st && st.path ? ' · ' + st.path : '')),
            // v2.6.10.1: a script written by 2.6.10 starts the router without the key → say so, rewrite only on click
            (on && st && st.keyed === false) ? h('p', { class: 'small rk-warn', 'data-rk': 'autostart' }, '⚠️ ' + t('v26101.warn_autostart'), ' ', h('button', { class: 'btn sm', 'data-rk': 'rewrite', onclick: async () => {
              try { const r = await API.inv('proc:winAutostart', { on: true, cfg: L }); toast(t('v26101.autostart_rewritten'), { ms: 6000 }); paint(r); } catch (err) { toast('⚠️ ' + t('v2671.win_autostart_fail', { v0: cleanErr(err) }), { kind: 'err', ms: 9000 }); }
            } }, t('v26101.autostart_rewrite'))) : null
          );
        };
        API.inv('proc:winAutostart').then(paint).catch(() => paint({ on: !!L.winAutostart }));
        return box;
      })()
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
