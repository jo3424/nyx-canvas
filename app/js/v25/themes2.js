'use strict';
// v2.5 Themes v2 (lazy): whole-UI theme editor (save as your own theme, export/import JSON) + day/night schedule (sunset or fixed times).
const Themes2 = {
  sel(opts, val, cb) { return h('select', { class: 'inp', onchange: (e) => cb(e.target.value) }, ...opts.map(([v, n]) => h('option', { value: v, selected: String(v) === String(val) ? true : null }, n))); },
  KEYS: ['bg', 'bg2', 'panel-solid', 'card', 'text', 'card-text', 'muted', 'accent', 'accent2', 'border'],
  toHex(c) { if (/^#[0-9a-f]{6}$/i.test(c)) return c; const x = document.createElement('canvas').getContext('2d'); x.fillStyle = '#000'; x.fillStyle = String(c || '#000'); const v = x.fillStyle; return /^#/.test(v) ? v : '#' + (v.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join(''); },
  open(tab = 'edit') {
    const tabs = h('div', { class: 'seg' }); const body = h('div', { class: 'th2' });
    const show = (k) => { tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); body.innerHTML = ''; (k === 'edit' ? this.editor(body) : this.schedule(body)); };
    for (const [k, l] of [['edit', t('v25.th_editor')], ['sched', t('v25.th_sched')]]) tabs.append(h('button', { 'data-k': k, onclick: () => show(k) }, l));
    const close = Panels.modal('🎨 ' + t('v25.th_title'), h('div', {}, tabs, body), { wide: true, onClose: () => Theme.apply(Store.state.settings) });
    this._close = close; show(tab);
  },
  editor(box) {
    const S = Store.state.settings; const cur = Theme.get(S.theme);
    const d = { base: cur.user ? (S.userThemes.find(u => u.id === cur.id)?.base || 'midnight') : cur.id, name: cur.user ? cur.name : cur.name + ' ✦', light: !!cur.light, vars: {} };
    for (const k of this.KEYS) d.vars[k] = this.toHex(cur.vars[k]);
    const preview = () => { const r = document.documentElement; for (const [k, v] of Object.entries(d.vars)) r.style.setProperty('--' + k, v); r.style.setProperty('--panel', hexA(d.vars['panel-solid'], .78)); document.body.classList.toggle('light-ui', d.light); };
    const grid = h('div', { class: 'th2-grid' });
    const fill = () => { grid.innerHTML = ''; for (const k of this.KEYS) grid.append(h('label', { class: 'th2-c' }, h('input', { type: 'color', value: d.vars[k], oninput: (e) => { d.vars[k] = e.target.value; preview(); } }), h('span', {}, t('v25.thv_' + k.replace('-', '_'))))); };
    const baseSel = this.sel(THEMES.filter(x => !x.user).map(x => [x.id, x.name]), d.base, (v) => { d.base = v; const b = Theme.get(v); for (const k of this.KEYS) d.vars[k] = this.toHex(b.vars[k]); d.light = !!b.light; light.checked = d.light; fill(); preview(); });
    const name = h('input', { class: 'inp', value: d.name, onkeydown: (e) => e.stopPropagation(), oninput: (e) => d.name = e.target.value });
    const light = h('input', { type: 'checkbox', checked: d.light, onchange: (e) => { d.light = e.target.checked; preview(); } });
    fill();
    const save = (asNew) => {
      const list = S.userThemes ||= []; let id = cur.user && !asNew ? cur.id : 'u' + Date.now().toString(36);
      const rec = { id, name: (d.name || 'Theme').slice(0, 40), base: d.base, light: d.light, vars: { ...d.vars, panel: hexA(d.vars['panel-solid'], .78) } };
      const i = list.findIndex(u => u.id === id); if (i >= 0) list[i] = rec; else list.push(rec);
      UserThemes.inject(); S.theme = id; Theme.apply(S); Store.save(); toast('🎨 ' + rec.name); this._close?.(); };
    box.append(h('div', { class: 'row gap wrap' }, Hub.field(t('v25.th_base'), baseSel), Hub.field(t('v25.th_name'), name), h('label', { class: 'chk' }, light, h('span', {}, t('v25.th_light')))), grid,
      h('p', { class: 'muted small' }, t('v25.th_tip')),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary', onclick: () => save(false) }, iconSvg('save', 14), cur.user ? t('v25.th_update') : t('v25.th_save')),
        cur.user ? h('button', { class: 'btn ghost', onclick: () => save(true) }, iconSvg('copy-plus', 14), t('v25.th_save_new')) : null,
        h('button', { class: 'btn ghost', onclick: async () => { await navigator.clipboard.writeText(JSON.stringify({ nyxTheme: 1, ...d }, null, 1)); toast('📋 JSON'); } }, iconSvg('clipboard-copy', 14), t('v25.th_export')),
        h('button', { class: 'btn ghost', onclick: async () => { try { const j = JSON.parse(await navigator.clipboard.readText()); if (!j.nyxTheme || !j.vars) throw 0; d.base = THEMES.some(x => x.id === j.base) ? j.base : 'midnight'; d.name = String(j.name || 'Imported').slice(0, 40); d.light = !!j.light; for (const k of this.KEYS) if (/^#[0-9a-f]{6}$/i.test(j.vars[k] || '')) d.vars[k] = j.vars[k]; name.value = d.name; light.checked = d.light; baseSel.value = d.base; fill(); preview(); toast('✓'); } catch { toast(t('v25.th_bad_json'), { kind: 'err' }); } } }, iconSvg('clipboard-paste', 14), t('v25.th_import')),
        cur.user ? h('button', { class: 'btn ghost danger', onclick: () => { S.userThemes = S.userThemes.filter(u => u.id !== cur.id); UserThemes.inject(); S.theme = d.base; Theme.apply(S); Store.save(); this._close?.(); } }, iconSvg('trash', 14), t('v25.delete')) : null));
  },
  schedule(box) {
    const T = Store.state.settings.themeSchedule; const opts = THEMES.map(x => [x.id, x.name]);
    const info = h('p', { class: 'small' });
    const upd = () => { Store.save(); ThemeSchedule.start(); const s = ThemeSchedule.sun(new Date(), +T.lat, +T.lon); const hm = (d) => d.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', hour12: false });
      info.textContent = (s ? `🌅 ${hm(s.rise)} · 🌇 ${hm(s.set)} — ` : '') + t('v25.th_now', { v0: ThemeSchedule.phase() === 'day' ? t('v25.th_day') : t('v25.th_night') }); };
    const on = h('input', { type: 'checkbox', checked: T.on, onchange: (e) => { T.on = e.target.checked; upd(); } });
    const times = h('div', { class: 'row gap', hidden: T.mode === 'sun' },
      Hub.field(t('v25.th_day_at'), h('input', { class: 'inp', type: 'time', value: T.dayAt || '07:30', onchange: (e) => { T.dayAt = e.target.value; upd(); } })),
      Hub.field(t('v25.th_night_at'), h('input', { class: 'inp', type: 'time', value: T.nightAt || '19:30', onchange: (e) => { T.nightAt = e.target.value; upd(); } })));
    const geo = h('div', { class: 'row gap', hidden: T.mode !== 'sun' },
      Hub.field('lat', h('input', { class: 'inp', type: 'number', step: .01, value: T.lat, onchange: (e) => { T.lat = +e.target.value; upd(); } })),
      Hub.field('lon', h('input', { class: 'inp', type: 'number', step: .01, value: T.lon, onchange: (e) => { T.lon = +e.target.value; upd(); } })));
    box.append(h('label', { class: 'chk' }, on, h('span', {}, t('v25.th_sched_on'))),
      h('div', { class: 'row gap wrap' },
        selField(t('v25.th_mode'), [['sun', t('v25.th_mode_sun')], ['time', t('v25.th_mode_time')]], T.mode, (v) => { T.mode = v; times.hidden = v === 'sun'; geo.hidden = v !== 'sun'; upd(); }),
        selField('☀️ ' + t('v25.th_day'), opts, T.day, (v) => { T.day = v; upd(); }),
        selField('🌙 ' + t('v25.th_night'), opts, T.night || 'midnight', (v) => { T.night = v; upd(); })),
      times, geo, info, h('p', { class: 'muted small' }, t('v25.th_sched_note')));
    if (!T.night) T.night = 'midnight'; upd();
  },
};
