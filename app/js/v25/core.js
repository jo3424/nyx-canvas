'use strict';
// Nyx v2.5 core (eager, small): settings defaults, lazy loader + startup timing, Router v2, «Ιδιωτικό» slot,
// theme schedule + user themes, people in search, Hub/commands hooks. Heavy panels load on first use (Lazy.need).
const V25 = { t0: performance.now(), marks: {}, lazyMs: {} };
const Lazy = {
  done: {}, files: { perf: 'js/v25/perf.js', models: 'js/v25/models.js', faces: 'js/v25/faces.js', themes2: 'js/v25/themes2.js', hub25: 'js/v25/hub25.js', photo: 'js/v25/photo.js' },
  need(name) {
    return this.done[name] ||= new Promise((res, rej) => { const t0 = performance.now(); const s = document.createElement('script'); s.src = this.files[name]; s.onload = () => { V25.lazyMs[name] = Math.round(performance.now() - t0); res(); }; s.onerror = () => { delete this.done[name]; rej(new Error('load ' + name)); }; document.body.append(s); });
  },
  async run(name, fn) { try { await this.need(name); return await fn(); } catch (e) { console.error(e); toast('⚠️ ' + cleanErr(e), { kind: 'err', ms: 8000 }); } },
};
const fmtGB = (b) => (b / 2 ** 30).toFixed(b >= 10 * 2 ** 30 ? 1 : 2) + ' GB';
const fmtMB = (b) => b >= 2 ** 30 ? fmtGB(b) : Math.round(b / 2 ** 20) + ' MB';
const ddmm = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

// ---------- defaults (wrap Store.load once more; v2 core already merged its own) ----------
(function () {
  const _load = Store.load.bind(Store);
  Store.load = async function () {
    await _load(); const S = this.state.settings; const A = S.ai;
    A.servers.sd = { exe: '', modelDir: '', loraDir: '', upscaleDir: '', port: 7860, extra: '', autoStart: false, ...(A.servers.sd || {}) };
    A.router = { enabled: false, groqFallback: true, unloadMin: 0, timeout: 120, ...(A.router || {}) };
    A.router.profiles = { fast: { model: '', ctx: 0, extra: '' }, vision: { model: '', ctx: 0, extra: '' }, uncensored: { model: '', ctx: 0, extra: '' }, ...(A.router.profiles || {}) };
    for (const k of ['fast', 'vision', 'uncensored']) { const pr = A.router.profiles[k]; if (pr && !pr.ctxUserSet && +pr.ctx === 8192) pr.ctx = 0; }
    A.private = { provider: 'llama', model: '', ack: false, ...(A.private || {}) };
    const xai = A.providers.find(p => p.id === 'xai'); if (xai && !xai.defModel) xai.defModel = 'grok-4.7';
    S.faces = { consentAck: false, ...(S.faces || {}) };
    S.sogni = { enabled: false, consentAck: false, tokenType: 'spark', ...(S.sogni || {}) };
    S.loras = { dir: '', items: {}, ...(S.loras || {}) };
    S.themeSchedule = { on: false, mode: 'sun', day: 'minlight', night: S.theme || 'midnight', dayAt: '07:30', nightAt: '19:30', lat: 37.98, lon: 23.73, ...(S.themeSchedule || {}) };
    if (!THEMES.some(x => x.id === S.themeSchedule.day) && !(S.userThemes || []).some(u => u.id === S.themeSchedule.day)) S.themeSchedule.day = 'minlight';
    S.userThemes ||= [];
    this.state.projects ||= [];
    UserThemes.inject(); ThemeSchedule.start();
  };
})();

// ---------- user themes (Themes v2) ----------
const UserThemes = {
  inject() {
    for (let i = THEMES.length - 1; i >= 0; i--) if (THEMES[i].user) THEMES.splice(i, 1);
    for (const u of Store.state.settings.userThemes || []) { const base = THEMES.find(x => x.id === u.base) || THEMES[0]; THEMES.push({ ...base, id: u.id, name: u.name, desc: t('v25.th_user'), user: true, light: !!u.light, vars: { ...base.vars, ...(u.vars || {}) } }); }
  },
};
// ---------- theme schedule: by sunrise/sunset (NOAA) or fixed times ----------
const ThemeSchedule = {
  // NOAA sunrise equation (±1–2 min), returns local Date objects
  sun(date, lat, lon) {
    const rad = Math.PI / 180; const d0 = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));
    const n = Math.round((d0 - Date.UTC(2000, 0, 1, 12)) / 864e5); const Js = n - lon / 360; const M = (357.5291 + 0.98560028 * Js) % 360;
    const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad); const L = (M + C + 180 + 102.9372) % 360;
    const Jt = 2451545 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad); const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
    const cosw = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
    if (cosw < -1 || cosw > 1) return null; const w = Math.acos(cosw) / rad / 360; const toDate = (J) => new Date((J - 2440587.5) * 864e5);
    return { rise: toDate(Jt - w), set: toDate(Jt + w) };
  },
  phase(now = new Date()) {
    const T = Store.state.settings.themeSchedule; let a, b;
    if (T.mode === 'sun') { const s = this.sun(now, +T.lat || 37.98, +T.lon || 23.73); if (s) { a = s.rise; b = s.set; } }
    if (!a) { const at = (hm) => { const [h, m] = String(hm || '07:00').split(':').map(Number); const d = new Date(now); d.setHours(h || 0, m || 0, 0, 0); return d; }; a = at(T.dayAt); b = at(T.nightAt); }
    return now >= a && now < b ? 'day' : 'night';
  },
  tick(force) {
    const S = Store.state?.settings; const T = S?.themeSchedule; if (!T?.on || V2.viewer) return;
    const ph = this.phase(); if (!force && ph === this._ph) return; this._ph = ph;
    const want = ph === 'day' ? T.day : T.night; if (want && S.theme !== want && THEMES.some(x => x.id === want)) { S.theme = want; Theme.apply(S); Store.save(); }
  },
  start() { clearInterval(this._iv); this._ph = null; this.tick(); this._iv = setInterval(() => this.tick(), 60e3); },
};

// ---------- Router v2: one llama-server, the right model per task (fast / vision / uncensored), Groq fallback ----------
const Router = {
  loaded: null, lastUse: 0, busy: null,
  cfg() { return Store.state.settings.ai.router; },
  profFor(task) { return Private.on ? 'uncensored' : task === 'vision' ? 'vision' : 'fast'; },
  async health(port) { const r = await API.inv('proc:health', 'http://127.0.0.1:' + port + '/health').catch(() => ({ ok: false })); return r.ok; },
  // v2.6: one switch at a time — callers queue on `lock`, so two tasks can never start/stop llama-server concurrently.
  // The loaded profile is identified by model + ctx + extra (same model with another ctx/extra means a reload).
  lock: Promise.resolve(), loadedKey: null,
  ensure(task) { const run = () => this.ensureNow(task); const p = this.lock.then(run, run); this.lock = p.catch(() => {}); return p; },
  async ensureNow(task) {
    const R = this.cfg(); if (!R.enabled) return false; const name = this.profFor(task); const prof = R.profiles[name]; if (!prof?.model) return false;
    const S = Store.state.settings.ai.servers.llama; this.lastUse = Date.now();
    const cfg = { ...S, model: prof.model, ctx: +prof.ctx || S.ctx, extra: [S.extra, prof.extra].filter(Boolean).join(' ') };
    const key = JSON.stringify([cfg.model, cfg.ctx, cfg.extra]);
    if (name === 'vision' && !/--mmproj\b/.test(cfg.extra) && !this._warnMm) { this._warnMm = true; toast('⚠️ ' + t('v25.rt_nommproj'), { ms: 9000 }); } // v2.6.3
    const st = await API.inv('proc:status', 'llama').catch(() => ({})); if (this.loaded === prof.model && this.loadedKey === key && st.running) return true;
    if (!st.running && !this.loaded && await this.health(S.port)) { if (!this._warnExt) { this._warnExt = true; toast(t('v25.rt_external'), { ms: 8000 }); } return false; } // someone else's llama-server: leave it alone
    this.busy = (async () => {
      toast('🔀 ' + t('v25.rt_switch', { v0: t('v25.rt_' + name), v1: prof.model.split(/[\\/]/).pop() }), { ms: 5000 });
      await API.inv('proc:stopWait', 'llama', 15000).catch(() => {}); this.loaded = null; this.loadedKey = null;
      const pre = await API.inv('proc:precheck', 'llama', cfg); if (!pre.ok) throw new Error(pre.error);
      Hub.procState.llama = await API.inv('proc:start', 'llama', cfg);
      const until = Date.now() + (+R.timeout || 120) * 1000;
      while (Date.now() < until) { await new Promise(r => setTimeout(r, 1000)); if (await this.health(S.port)) { this.loaded = prof.model; this.loadedKey = key; delete AI.modelCache.llama; return true; } const s2 = await API.inv('proc:status', 'llama').catch(() => ({})); if (!s2.running) throw new Error(t('v25.rt_died') + ((s2.log || []).slice(-2).join(' ').slice(0, 200))); }
      throw new Error(t('v25.rt_timeout'));
    })();
    try { return await this.busy; } finally { this.busy = null; }
  },
  async groq() { const p = AI.prov('groq'); if (!p || Private.on) return null; if (!(await API.inv('secret:has', 'key:groq').catch(() => false))) return null; return { p: { ...p, enabled: true }, m: p.defModel || 'llama-3.3-70b-versatile', fallback: true }; },
  idle() { const R = this.cfg(); if (!R?.enabled || !(+R.unloadMin > 0) || !this.loaded || this.busy) return; if (Date.now() - this.lastUse > R.unloadMin * 60e3) { API.inv('proc:stop', 'llama').catch(() => {}); this.loaded = null; this.loadedKey = null; toast('💤 ' + t('v25.rt_unloaded')); } },
};
setInterval(() => { try { Router.idle(); } catch (e) {} }, 60e3);
(function () {
  const orig = AI.pickModel.bind(AI);
  AI.pickModel = async function (task) {
    if (task === 'embed') return orig(task);
    if (Private.on) return Private.pick();
    const R = Router.cfg();
    if (R?.enabled && AI.task(task).p?.id === 'llama') {
      try { await Router.ensure(task); } catch (e) { const g = R.groqFallback && await Router.groq(); if (g) { toast('⚡ ' + t('v25.rt_fallback', { v0: cleanErr(e) }), { ms: 7000 }); this.last[task] = 'groq'; return g; } throw e; }
    }
    try { return await orig(task); } catch (e) { const g = R?.enabled && R.groqFallback && await Router.groq(); if (g) { toast('⚡ ' + t('v25.rt_fallback', { v0: cleanErr(e) }), { ms: 7000 }); return g; } throw e; }
  };
})();

// ---------- «Ιδιωτικό»: local-only uncensored chat — kept in memory only, never saved, indexed or sent to automations ----------
const Private = {
  on: false, chat: [], veniceOk: false,
  cfg() { return Store.state.settings.ai.private; },
  async pick() {
    const P = this.cfg();
    if (P.provider === 'venice') {
      const p = AI.prov('venice'); if (!p || !(await API.inv('secret:has', 'key:venice').catch(() => false))) throw new Error(t('v25.pv_need_venice'));
      if (!this.veniceOk) { const ok = await new Promise(r => Panels.modal('Venice AI', h('div', {}, h('p', {}, '💸 ' + t('v25.venice_cost')), h('p', { class: 'muted small' }, t('v25.pv_cloud_note'))), { okLabel: t('v25.continue'), ok: () => { r(true); }, onClose: () => r(false) })); if (!ok) throw new Error(t('v25.cancelled')); this.veniceOk = true; }
      return { p: { ...p, enabled: true }, m: P.model || p.defModel || 'venice-uncensored' };
    }
    const lp = AI.prov('llama'); try { await Router.ensure('private'); } catch (e) { throw new Error(t('v25.pv_llama_fail', { v0: cleanErr(e) })); }
    return { p: { ...lp, enabled: true }, m: P.model || 'default' };
  },
  async run(text) {
    const { p, m } = await this.pick();
    const msgs = [{ role: 'system', content: t('v25.pv_system') }, ...this.chat.slice(-80, -1).filter(x => x.content).map(x => ({ role: x.role, content: String(x.content) })), { role: 'user', content: text }];
    const notices = [];
    const r = await AI.chatTurn(p, { model: m, messages: msgs, temperature: 0.8 }, (kind, msg) => notices.push({ kind, text: msg }));
    const content = stripThink(r.message?.content || '', r.message?.reasoning_content || r.reasoning);
    const emptied = !!(r.emptyAfterClean || (!String(content || '').trim() && r.rawContent));
    return { content, model: r.model || m, reasoning: r.reasoning || '', truncated: !!r.truncated, notices, emptyAfterClean: emptied, rawContent: emptied ? r.rawContent : undefined };
  },
  async toggle(force) {
    const want = force ?? !this.on; const P = this.cfg();
    if (want && !P.ack) { const ok = await new Promise(r => Panels.modal('🎭 ' + t('v25.pv_title'), h('div', { class: 'v25-note' }, h('p', {}, t('v25.pv_intro')), h('p', { class: 'warn small' }, '⚖️ ' + t('v25.legal_guard'))), { okLabel: t('v25.pv_ok'), ok: () => r(true), onClose: () => r(false) })); if (!ok) return; P.ack = true; Store.save(); }
    this.on = want; if (!want) this.chat = [];
    document.getElementById('assistant')?.classList.toggle('private', want); $('#as-private')?.classList.toggle('on', want);
    Assistant.render(); Assistant.updModel(); toast(want ? '🎭 ' + t('v25.pv_on') : t('v25.pv_off'));
  },
};
(function () {
  const A = Assistant; const _push = A.push.bind(A), _render = A.render.bind(A), _history = A.history.bind(A), _run = A.run.bind(A), _upd = A.updModel.bind(A), _init = A.init.bind(A);
  A.push = function (m) { if (!Private.on) return _push(m); Private.chat.push({ at: Date.now(), ...m }); if (Private.chat.length > 200) Private.chat.splice(0, Private.chat.length - 200); this.render(); };
  A.render = function () { if (!Private.on) return _render(); const real = Store.state.chat; Store.state.chat = Private.chat; try { _render(); } finally { Store.state.chat = real; } $('#as-msgs')?.prepend(h('div', { class: 'pv-banner' }, '🎭 ' + t('v25.pv_banner'))); };
  A.history = function () { if (!Private.on) return _history(); const real = Store.state.chat; Store.state.chat = Private.chat; try { return _history(); } finally { Store.state.chat = real; } };
  A.run = function (text) { return Private.on ? Private.run(text) : _run(text); };
  A.updModel = async function () { await _upd(); if (Private.on) { const el = $('#as-model'); const P = Private.cfg(); if (el) { el.textContent = '🎭 ' + (P.provider === 'venice' ? 'Venice' : 'llama-server' + (Router.cfg().profiles.uncensored.model ? ' · ' + Router.cfg().profiles.uncensored.model.split(/[\\/]/).pop().slice(0, 24) : '')); el.classList.remove('bad'); } } };
  A.init = function () {
    _init(); const head = this.el?.querySelector('.as-head'); if (!head) return;
    const btn = h('button', { class: 'ib', id: 'as-private', title: t('v25.pv_title'), html: iconSvg('venetian-mask', 16), onclick: () => Private.toggle() });
    head.insertBefore(btn, head.querySelector('.grow')?.nextSibling || null);
    // in private mode the eraser clears only the private (memory) chat
    head.addEventListener('click', (e) => { const b = e.target.closest('button'); if (Private.on && b && b.title === t('assistant.063')) { e.stopPropagation(); e.preventDefault(); Private.chat = []; A.render(); } }, true);
  };
  const _fire = Automations.fire.bind(Automations); Automations.fire = function (ev, payload) { if (Private.on && ev === 'assistant') return; return _fire(ev, payload); };
})();

// ---------- people (Faces) in search ----------
(function () {
  const _text = Search.text.bind(Search);
  Search.text = function (it) { const s = _text(it); return it.people?.length ? s + ' \n' + it.people.join(' ') : s; };
})();
const People = {
  // copy names from faces.json onto image cards (it.people) so Ctrl+K finds «Μαρία» in photos
  async sync() { const map = await API.inv('faces:names').catch(() => ({})); let n = 0; for (const it of allItems()) { if (it.type !== 'image' || !it.file) continue; const m = map[it.file]; const want = m?.n?.length ? m.n : undefined; if (JSON.stringify(it.people) !== JSON.stringify(want)) { if (want) it.people = want; else delete it.people; n++; } } if (n) Store.save(); return n; },
};

// ---------- hooks: Hub sections, commands, titlebar, autostart ----------
(function () {
  const _build = Hub.build.bind(Hub);
  Hub.build = function (body) {
    _build(body);
    const secs = body.querySelectorAll('.hub-sec'); const after = secs[3] || secs[secs.length - 1];
    const ph = h('div', { class: 'v25-hub' }, h('p', { class: 'muted small' }, '…')); after ? after.after(ph) : body.append(ph);
    Lazy.run('hub25', () => Hub25.fill(ph, after));
  };
  const _as = Hub.autoStart.bind(Hub);
  Hub.autoStart = async function () { await _as(); if (Store.state?.settings?.ai?.servers?.sd?.autoStart) Lazy.run('hub25', () => Hub25.sdStart({ quiet: true })); };
  const _cmds = PluginStore.commands.bind(PluginStore);
  PluginStore.commands = function () {
    return [..._cmds(),
      ['gauge', t('v25.perf_title'), 'Ctrl+Shift+M', () => Lazy.run('perf', () => Perf.open())],
      ['table-2', t('v25.models_title'), '', () => Lazy.run('models', () => ModelsTable.open())],
      ['scan-face', t('v25.faces_title'), 'Ctrl+Shift+U', () => Lazy.run('faces', () => Faces.open())],
      ['paintbrush', t('v25.th_editor'), '', () => Lazy.run('themes2', () => Themes2.open())],
      ['sunset', t('v25.th_sched'), '', () => Lazy.run('themes2', () => Themes2.open('sched'))],
      ['venetian-mask', t('v25.pv_title'), '', () => { Assistant.show(); Private.toggle(true); }],
      ['image-play', t('v25.sd_open_ui'), '', () => Lazy.run('hub25', () => Hub25.openSdUi())],
      ['camera', t('v25.ph_projects'), '', () => Lazy.run('photo', () => Photo.projects())],
      ['columns-2', t('v25.ph_compare'), '', () => Lazy.run('photo', () => Photo.compareSelected())],
      ['wand-sparkles', t('v25.ph_batch'), '', () => Lazy.run('photo', () => Photo.batch())],
      ['layers', t('v25.lora_title'), '', () => Lazy.run('photo', () => Photo.loras())],
      ...(Store.state.settings.sogni?.enabled ? [['film', t('v25.sg_i2v_sel'), '', () => Lazy.run('faces', () => Faces.sogniSelected('i2v'))], ['user-round', t('v25.sg_id_sel'), '', () => Lazy.run('faces', () => Faces.sogniSelected('identity'))]] : []),
    ];
  };
  const _init = App.init.bind(App);
  App.init = async function () {
    await _init(); V25.marks.ready = Math.round(performance.now());
    const nav = performance.getEntriesByType('navigation')[0]; if (nav) { V25.marks.dom = Math.round(nav.domContentLoadedEventEnd); V25.marks.load = Math.round(nav.loadEventEnd); }
    if (V2.viewer) return;
    const right = $('#titlebar .tb-right'); const before = $('#btn-reminders');
    if (right && !$('#btn-perf')) right.insertBefore(h('button', { class: 'tb-btn', id: 'btn-perf', title: t('v25.perf_title') + ' (Ctrl+Shift+M)', html: iconSvg('gauge', 18), onclick: () => Lazy.run('perf', () => Perf.open()) }), before);
    addEventListener('keydown', (e) => { const c = e.ctrlKey || e.metaKey; if (!c || !e.shiftKey) return; const k = e.key.toLowerCase(); if (e.target.closest?.('input,textarea,select,[contenteditable=true]')) return;
      if (k === 'm') { e.preventDefault(); e.stopPropagation(); Lazy.run('perf', () => Perf.open()); } if (k === 'u') { e.preventDefault(); e.stopPropagation(); Lazy.run('faces', () => Faces.open()); } }, true);
    window.__nyxV25Ready = true;
  };
})();
