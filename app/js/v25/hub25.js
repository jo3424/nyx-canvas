'use strict';
// v2.5 AI Hub additions (lazy): sd-server box, Router v2, «Ιδιωτικό», services & keys, links to Models / Performance / Faces / Photo tools.
const Hub25 = {
  chk(obj, key, label, cb) { return h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: obj[key] ? true : null, onchange: (e) => { obj[key] = e.target.checked; Store.save(); cb && cb(e.target.checked); } }), h('span', {}, label)); },
  keyRow(ref, label, extra) {
    const i = h('input', { class: 'inp grow', type: 'password', placeholder: 'API key', autocomplete: 'off' }); API.inv('secret:has', ref).then(has => { if (has) i.placeholder = t('hub.052'); });
    return Hub.field(label, h('div', { class: 'row gap' }, i, h('button', { class: 'btn sm', onclick: async () => { const v = i.value.trim(); if (!v) return; await API.inv('secret:set', ref, v); i.value = ''; i.placeholder = t('hub.052'); toast(t('hub.056')); } }, t('hub.057')), extra || null));
  },
  fill(ph, serversSec) {
    const A = Store.state.settings.ai; ph.innerHTML = '';
    // sd-server goes inside «Τοπικοί servers»
    const sd = this.sdBox(A.servers.sd); (serversSec || ph).append(sd);
    ph.append(this.routerSec(), this.privateSec(), this.toolsSec(), this.servicesSec());
  },
  // ---------- sd-server (stable-diffusion.cpp, Vulkan, single exe, own web UI) ----------
  async sdStart({ quiet = false } = {}) {
    const cfg = Store.state.settings.ai.servers.sd;
    const pre = await API.inv('proc:precheck', 'sd', cfg).catch(e => ({ ok: false, error: cleanErr(e) }));
    if (!pre.ok) { if (!quiet) toast('⚠️ ' + pre.error, { kind: 'err', ms: 9000 }); return { ok: false, error: pre.error }; }
    const hl = await API.inv('proc:health', 'http://127.0.0.1:' + (cfg.port || 7860) + '/').catch(() => ({ ok: false }));
    if (!Hub.procState.sd?.running && (hl.ok || hl.status)) { if (!quiet) toast(t('v22.already_running', { v0: 'sd-server', v1: cfg.port })); return { ok: true, external: true }; }
    try { Hub.procState.sd = await API.inv('proc:start', 'sd', cfg); if (!quiet) toast('▶️ sd-server'); return { ok: true }; } catch (e) { const m = cleanErr(e); if (!quiet) toast('⚠️ sd-server: ' + m.split('\n')[0], { kind: 'err', ms: 9000 }); return { ok: false, error: m }; }
  },
  openSdUi() { const p = Store.state.settings.ai.servers.sd.port || 7860; Browser.open('http://127.0.0.1:' + p + '/'); },
  sdBox(cfg) {
    const st = h('span', { class: 'srv-st' }); const log = h('pre', { class: 'srv-log', hidden: true });
    const upd = (s) => { Hub.procState.sd = s; st.className = 'srv-st ' + (s.running ? 'on' : 'off'); st.textContent = s.running ? t('hub.061', { pid: s.pid }) : (s.exit != null ? t('hub.062', { exit: s.exit }) : t('hub.063')); log.textContent = (s.cmd ? '> ' + s.cmd + '\n' : '') + (s.log || []).join('\n'); };
    API.inv('proc:status', 'sd').then(upd).catch(() => {}); API.onProcStatus?.((s) => { if (s.id === 'sd') upd(s); });
    return h('div', { class: 'srv', 'data-srv': 'sd' },
      h('div', { class: 'prov-head wrap' }, h('b', {}, 'sd-server'), h('span', { class: 'chip loc' }, 'Vulkan'), st, h('div', { class: 'grow' }),
        h('button', { class: 'btn sm primary', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await this.sdStart(); } finally { b.disabled = false; } } }, iconSvg('play', 14), t('hub.064')),
        h('button', { class: 'btn sm ghost', onclick: async () => upd(await API.inv('proc:stop', 'sd')) }, iconSvg('square', 14), t('hub.065')),
        h('button', { class: 'btn sm ghost', title: 'http://127.0.0.1:' + (cfg.port || 7860), onclick: () => this.openSdUi() }, iconSvg('external-link', 14), t('v25.sd_ui')),
        h('button', { class: 'btn sm ghost ico', title: 'Log', onclick: () => { log.hidden = !log.hidden; } }, iconSvg('scroll-text', 14))),
      h('p', { class: 'muted small' }, t('v25.sd_note')),
      Hub.pathRow(cfg, 'exe', t('hub.067'), 'file', { kind: 'exe', names: ['sd-server.exe', 'sd-server'] }),
      Hub.pathRow(cfg, 'modelDir', t('v25.sd_models'), 'dir'),
      Hub.pathRow(cfg, 'loraDir', t('v25.sd_loras'), 'dir'),
      Hub.pathRow(cfg, 'upscaleDir', t('v25.sd_upscalers'), 'dir'),
      h('div', { class: 'row gap srv-nums' }, Hub.field('Port', Hub.inp(cfg, 'port', '7860', 'number')), Hub.field(t('hub.069'), Hub.inp(cfg, 'extra', '--offload-to-cpu --diffusion-fa'))),
      h('div', { class: 'row gap wrap' }, this.chk(cfg, 'autoStart', t('v22.autostart')), h('button', { class: 'btn sm ghost', onclick: () => Lazy.run('photo', () => Photo.loras()) }, iconSvg('layers', 14), t('v25.lora_title'))), log);
  },
  // ---------- Router v2 ----------
  routerSec() {
    const R = Store.state.settings.ai.router; const body = h('div', { class: 'rt-body', hidden: !R.enabled });
    const prof = (k, ic) => { const P = R.profiles[k]; return h('div', { class: 'rt-prof' }, h('div', { class: 'row gap' }, h('span', { html: iconSvg(ic, 16) }), h('b', {}, t('v25.rt_' + k)), h('small', { class: 'muted' }, t('v25.rt_' + k + '_d'))),
      Hub.pathRow(P, 'model', 'GGUF', 'file', { kind: 'llama' }), h('div', { class: 'row gap srv-nums' }, Hub.field('Context (-c)', Hub.inp(P, 'ctx', '8192', 'number')), Hub.field(t('hub.069'), Hub.inp(P, 'extra', k === 'vision' ? '--mmproj C:\\…\\mmproj.gguf' : '')))); };
    body.append(prof('fast', 'zap'), prof('vision', 'eye'), prof('uncensored', 'venetian-mask'),
      h('div', { class: 'row gap srv-nums' }, Hub.field(t('v25.rt_unload'), Hub.inp(R, 'unloadMin', '0', 'number'), t('v25.rt_unload_h')), Hub.field(t('v25.rt_timeout_l'), Hub.inp(R, 'timeout', '120', 'number'))),
      this.chk(R, 'groqFallback', t('v25.rt_groq')), h('p', { class: 'muted small' }, t('v25.rt_note')));
    return Hub.sec('🔀 ' + t('v25.rt_title'), this.chk(R, 'enabled', t('v25.rt_on'), (v) => { body.hidden = !v; Router.loaded = null; }), body);
  },
  privateSec() {
    const P = Store.state.settings.ai.private;
    return Hub.sec('🎭 ' + t('v25.pv_title'), h('p', { class: 'small' }, t('v25.pv_desc')),
      selField(t('v25.pv_engine'), [['llama', t('v25.pv_llama')], ['venice', 'Venice AI (cloud · ' + t('v25.pv_cost') + ')']], P.provider, (v) => { P.provider = v; Store.save(); }),
      Hub.field(t('hub.060'), Hub.inp(P, 'model', 'venice-uncensored / default')),
      h('p', { class: 'warn small' }, '⚖️ ' + t('v25.legal_guard')),
      h('button', { class: 'btn sm', onclick: () => { Assistant.show(); Private.toggle(true); } }, iconSvg('venetian-mask', 14), t('v25.pv_open')));
  },
  toolsSec() {
    const b = (ic, label, fn) => h('button', { class: 'btn sm ghost', onclick: fn }, iconSvg(ic, 14), label);
    return Hub.sec('🧰 ' + t('v25.tools'), h('div', { class: 'row gap wrap' },
      b('table-2', t('v25.models_title'), () => Lazy.run('models', () => ModelsTable.open())), b('gauge', t('v25.perf_title'), () => Lazy.run('perf', () => Perf.open())),
      b('scan-face', t('v25.faces_title'), () => Lazy.run('faces', () => Faces.open())), b('camera', t('v25.ph_projects'), () => Lazy.run('photo', () => Photo.projects())),
      b('wand-sparkles', t('v25.ph_batch'), () => Lazy.run('photo', () => Photo.batch())), b('paintbrush', t('v25.th_editor'), () => Lazy.run('themes2', () => Themes2.open())),
      b('activity', t('v25.startup'), () => this.timing())));
  },
  timing() {
    const m = V25.marks; const rows = [[t('v25.t_dom'), m.dom], [t('v25.t_ready'), m.ready], ...Object.entries(V25.lazyMs).map(([k, v]) => ['lazy · ' + k, v])];
    Panels.modal('⏱️ ' + t('v25.startup'), h('div', {}, h('table', { class: 'v25-tbl' }, ...rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', { class: 'num' }, b != null ? b + ' ms' : '—')))), h('p', { class: 'muted small' }, t('v25.t_note'))));
  },
  // ---------- your services: verdicts + keys (all optional, off until configured) ----------
  SERVICES: [
    ['sogni', 'Sogni AI', 'keep'], ['venice', 'Venice AI', 'keep'], ['xai', 'xAI · Grok 4.7', 'keep'], ['groq', 'Groq (free)', 'keep'],
    ['claude', 'Claude Pro', 'link'], ['chatgpt', 'ChatGPT Plus', 'link'], ['r2', 'Cloudflare R2', 'later'], ['cfai', 'Cloudflare Workers AI', 'skip'],
    ['github', 'GitHub', 'later'], ['vps', 'Hostinger VPS', 'skip'], ['hex', 'anomalyco/hex', 'skip'], ['sheet', 'Google Sheet (LoRA)', 'notused'],
  ],
  servicesSec() {
    const S = Store.state.settings.sogni; const sg = h('div', { class: 'sg-box', hidden: !S.enabled });
    const bal = h('span', { class: 'pstat' });
    sg.append(this.keyRow('key:sogni', 'Sogni API key', h('button', { class: 'btn ghost sm', onclick: async () => { bal.textContent = '…'; try { const r = await API.inv('sogni:test'); bal.className = 'pstat ok'; bal.textContent = '✓ Spark ' + (r.spark ?? '—'); } catch (e) { bal.className = 'pstat bad'; bal.textContent = '✗ ' + cleanErr(e); } } }, iconSvg('activity', 14), t('hub.058'))), bal,
      h('p', { class: 'muted small' }, '💸 ' + t('v25.sg_cost')), h('p', { class: 'warn small' }, '⚖️ ' + t('v25.consent_note')));
    const verdict = { keep: ['ok', t('v25.vd_keep')], link: ['', t('v25.vd_link')], later: ['', t('v25.vd_later')], skip: ['bad', t('v25.vd_skip')], notused: ['bad', t('v25.vd_notused')] };
    const tbl = h('table', { class: 'v25-tbl svc' }, ...this.SERVICES.map(([id, name, v]) => h('tr', {}, h('td', {}, h('b', {}, name)), h('td', {}, h('span', { class: 'chip ' + verdict[v][0] }, verdict[v][1])), h('td', { class: 'small muted' }, t('v25.svc_' + id)))));
    const links = h('div', { class: 'row gap wrap' }, ...[['grok.com', 'https://grok.com'], ['claude.ai', 'https://claude.ai'], ['chatgpt.com', 'https://chatgpt.com'], ['Sogni', 'https://app.sogni.ai'], ['Venice', 'https://venice.ai']].map(([n, u]) => h('button', { class: 'btn ghost sm', onclick: () => Browser.open(u) }, iconSvg('external-link', 13), n)));
    return Hub.sec('🔌 ' + t('v25.services'), tbl, links, h('hr'), this.chk(S, 'enabled', t('v25.sg_on'), (v) => { sg.hidden = !v; }), sg, h('p', { class: 'muted small' }, t('v25.svc_note')));
  },
};
