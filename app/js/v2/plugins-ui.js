'use strict';
// Plugin Store (catalog, permissions approval, config, actions, cards, logs) + Automations engine ("όταν Χ τότε Υ") + plugin bridge ops.
const PERMS = {
  net: ['globe', t('pluginsui.001'), t('pluginsui.002')],
  notify: ['bell', t('pluginsui.003'), t('pluginsui.004')],
  board: ['layout-grid', t('pluginsui.005'), t('pluginsui.006')],
  assistant: ['sparkles', t('pluginsui.007'), t('pluginsui.008')],
  widget: ['app-window', 'Widget', t('pluginsui.009')],
  clipboard: ['clipboard', t('pluginsui.010'), t('pluginsui.011')],
  files: ['folder', t('pluginsui.012'), t('pluginsui.013')],
  server: ['server', t('pluginsui.014'), t('pluginsui.015')],
  exec: ['terminal', t('pluginsui.016'), t('pluginsui.017')],
};
const PluginStore = {
  list: [], tab: 'store', cat: 'all', q: '',
  async refresh() { try { this.list = await API.inv('plugins:list'); } catch (e) { this.list = []; } return this.list; },
  get(id) { return this.list.find(p => p.id === id); },
  commands() { return this.list.filter(p => p.enabled).flatMap(p => (p.actions || []).filter(a => !a.hidden).map(a => [p.icon || 'puzzle', `${p.name}: ${a.label}`, '', () => this.runAction(p, a)])); },
  status(p) {
    if (p.error) return ['err', t('pluginsui.018')];
    if (p.requires && !p.enabled) return ['ext', t('pluginsui.019')];
    if (p.enabled && p.running) return ['on', t('hub.055')];
    if (p.enabled) return ['on', t('hub.055')];
    if (p.installed) return ['off', t('pluginsui.020')];
    return ['avail', t('pluginsui.021')];
  },
  async open(tab) {
    if (tab) this.tab = tab; await this.refresh();
    Panels.openDrawer('store', t('pluginsui.022'), (body) => this.build(body));
  },
  build(body) {
    body.innerHTML = '';
    const tabs = h('div', { class: 'seg tabs3' }, ...[['store', t('pluginsui.023')], ['installed', t('pluginsui.024')], ['auto', t('pluginsui.025')]].map(([k, l]) => h('button', { class: this.tab === k ? 'on' : '', onclick: () => { this.tab = k; this.build(body); } }, l)));
    body.append(tabs);
    if (this.tab === 'auto') return Automations.ui(body);
    const cats = ['all', ...new Set(this.list.map(p => p.category))];
    const top = h('div', { class: 'row gap' }, h('input', { class: 'inp grow', placeholder: t('pluginsui.026'), value: this.q, oninput: (e) => { this.q = e.target.value; draw(); }, onkeydown: (e) => e.stopPropagation() }),
      h('button', { class: 'btn sm', title: t('pluginsui.027'), onclick: () => this.installFolder() }, iconSvg('folder-plus', 14), t('pluginsui.028')), h('button', { class: 'ib', title: t('pluginsui.029'), html: iconSvg('folder-open', 16), onclick: () => API.inv('plugins:openFolder') }));
    const chips = h('div', { class: 'chips' }, ...cats.map(c => h('button', { class: 'chip' + (this.cat === c ? ' on' : ''), onclick: (e) => { this.cat = c; $$('.chip', chips).forEach(x => x.classList.remove('on')); e.target.classList.add('on'); draw(); } }, c === 'all' ? t('pluginsui.030') : c)));
    const listEl = h('div', { class: 'plist' });
    body.append(top, this.tab === 'store' ? chips : '', listEl,
      h('p', { class: 'muted small' }, t('pluginsui.031')));
    const draw = () => {
      listEl.innerHTML = ''; const nq = norm(this.q);
      const L = this.list.filter(p => (this.tab === 'installed' ? p.installed : true) && (this.cat === 'all' || this.tab !== 'store' || p.category === this.cat) && (!nq || norm(p.name + ' ' + p.description + ' ' + p.category).includes(nq)));
      if (!L.length) listEl.append(h('div', { class: 'empty small' }, this.tab === 'installed' ? t('pluginsui.032') : t('pluginsui.033')));
      for (const p of L) listEl.append(this.row(p, () => this.build(body)));
    };
    draw();
  },
  row(p, redraw) {
    const [sk, sl] = this.status(p);
    const el = h('div', { class: 'pcard ' + sk },
      h('div', { class: 'ph' }, h('span', { class: 'pico', html: iconSvg(p.icon || 'puzzle', 22) }), h('div', { class: 'grow' }, h('div', { class: 'pn' }, p.name, h('small', { class: 'muted' }, ' v' + (p.version || '1')), p.verified ? null : h('span', { class: 'pbadge warn', title: t('pluginsui.034') }, t('pluginsui.035'))), h('div', { class: 'muted small' }, p.category + (p.author ? ' · ' + p.author : '') + (p.license ? ' · ' + p.license : ''))),
        h('span', { class: 'pst ' + sk }, sl)),
      h('p', { class: 'pd' }, p.description),
      p.long ? h('details', {}, h('summary', {}, t('browser.011')), h('div', { class: 'small', html: md(p.long) })) : null,
      p.permissions.length ? h('div', { class: 'perms' }, ...p.permissions.map(k => h('span', { class: 'perm' + (k === 'exec' ? ' danger' : ''), title: PERMS[k]?.[2] || k, html: iconSvg(PERMS[k]?.[0] || 'shield', 12) + ' ' + (PERMS[k]?.[1] || k) }))) : h('div', { class: 'perms' }, h('span', { class: 'perm ok' }, t('pluginsui.036'))),
      p.error ? h('div', { class: 'perr' }, '⚠️ ' + p.error) : null);
    const acts = h('div', { class: 'pacts' });
    if (!p.installed) acts.append(h('button', { class: 'btn primary sm', onclick: () => this.install(p, redraw) }, iconSvg('download', 14), p.requires ? t('pluginsui.037') : t('pluginsui.038')));
    else {
      acts.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: p.enabled ? true : null, onchange: async (e) => { try { this.list = await API.inv('plugins:enable', p.id, e.target.checked); } catch (er) { toast('⚠️ ' + er.message, { kind: 'err' }); } redraw(); } }), h('span', {}, t('hub.055'))));
      if (p.config.length) acts.append(h('button', { class: 'btn sm', onclick: () => this.configure(p, redraw) }, iconSvg('settings-2', 14), t('pluginsui.039')));
      for (const a of (p.actions || []).filter(a => !a.hidden).slice(0, 4)) acts.append(h('button', { class: 'btn sm', disabled: !p.enabled, onclick: () => this.runAction(p, a) }, iconSvg(a.icon || 'play', 14), ' ' + a.label));
      for (const c of p.cards || []) acts.append(h('button', { class: 'btn sm', disabled: !p.enabled, onclick: () => this.addCard(p, c) }, iconSvg('square-plus', 14), t('pluginsui.040') + c.name));
      acts.append(h('button', { class: 'ib', title: 'Logs', html: iconSvg('scroll-text', 15), onclick: () => this.logs(p) }), h('button', { class: 'ib danger', title: t('pluginsui.041'), html: iconSvg('trash-2', 15), onclick: () => Panels.modal(t('pluginsui.041'), h('p', {}, t('pluginsui.042', { name: p.name })), { okLabel: t('pluginsui.041'), ok: async () => { this.list = await API.inv('plugins:uninstall', p.id); redraw(); } }) }));
    }
    if (p.homepage) acts.append(h('button', { class: 'ib', title: p.homepage, html: iconSvg('external-link', 15), onclick: () => Browser.open(p.homepage) }));
    el.append(acts); return el;
  },
  approve(p) {
    return new Promise((res) => {
      const box = h('div', { class: 'approve' }, h('p', {}, h('b', {}, p.name), t('pluginsui.043')),
        p.permissions.length ? h('ul', { class: 'permlist' }, ...p.permissions.map(k => h('li', { class: k === 'exec' ? 'danger' : '' }, h('span', { html: iconSvg(PERMS[k]?.[0] || 'shield', 16) }), h('div', {}, h('b', {}, PERMS[k]?.[1] || k), h('div', { class: 'muted small' }, PERMS[k]?.[2] || t('pluginsui.044')))))) : h('p', { class: 'muted' }, t('pluginsui.045')),
        p.requires ? h('div', { class: 'note' }, h('b', {}, t('pluginsui.046')), p.requires.text || '', p.requires.url ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); API.openExternal(p.requires.url); } }, t('pluginsui.047')) : null) : null,
        p.verified ? null : h('p', { class: 'warn small' }, t('pluginsui.048')),
        p.source === 'user' || p.folder ? h('p', { class: 'warn small' }, t('v26.plugin_full_access')) : null);
      let ok = false; Panels.modal(t('pluginsui.049'), box, { okLabel: t('pluginsui.050'), ok: () => { ok = true; }, onClose: () => res(ok) });
    });
  },
  async install(p, redraw) {
    if (!(await this.approve(p))) return;
    try { this.list = await API.inv('plugins:install', p.id, p.permissions); const np = this.get(p.id); toast(np?.error ? '⚠️ ' + np.error : `🧩 ${p.name} ✓`); if (np?.config?.some(f => f.required && !np.values[f.key])) this.configure(np, redraw); } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); }
    redraw?.(); this.syncCards();
  },
  async installFolder() {
    // nothing is copied until the permissions are approved (main: installFromFolder -> installPending)
    try { const r = await API.inv('plugins:installFolder'); if (!r?.pending) return;
      const p = { id: r.pending, name: r.name, permissions: r.permissions || [], requires: r.requires, verified: false, source: 'user', folder: true };
      if (!(await this.approve(p))) return;
      this.list = await API.inv('plugins:installPending', r.pending, p.permissions); const np = this.get(r.pending); toast(np?.error ? '⚠️ ' + np.error : `🧩 ${p.name} ✓`);
      if (np?.config?.some(f => f.required && !np.values[f.key])) this.configure(np, () => this.open('installed')); else this.open('installed'); this.syncCards();
    } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); } },
  configure(p, redraw) {
    const f = form(p.config.map(c => [c.key, c.label + (c.required ? ' *' : ''), c.type === 'select' ? 'select' : c.type || 'text', p.values[c.key] ?? '', { placeholder: c.placeholder || '', options: c.options }]));
    p.config.forEach(c => c.help && f.el.append(h('p', { class: 'muted small' }, c.label + ': ' + c.help)));
    Panels.modal('⚙️ ' + p.name, f.el, { ok: async () => { try { this.list = await API.inv('plugins:config', p.id, f.val()); toast('✓'); } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); } redraw?.(); } });
  },
  async runAction(p, a) {
    let args = {};
    if (a.args?.length) { const f = form(a.args.map(x => [x.key, x.label, x.type || 'text', x.default ?? '', { placeholder: x.placeholder || '', options: x.options }])); const ok = await new Promise(r => { let k = false; Panels.modal(a.label, f.el, { ok: () => { k = true; }, onClose: () => r(k) }); }); if (!ok) return; args = f.val(); }
    try { const r = await API.inv('plugins:action', p.id, a.id, args); if (this.showResult(r)) return r; if (r && typeof r === 'object' && r.card) Cmd.T.create_card.run(r.card); else if (r && typeof r === 'string') toast(r.slice(0, 200)); else toast(`✓ ${a.label}`); return r; } catch (e) { toast('⚠️ ' + e.message, { kind: 'err', ms: 7000 }); }
  },
  // r.show = { titleKey|title, noteKey, text } → modal with copy button (used for secrets: never on a card); r.toastKey → localized toast
  showResult(r) {
    if (!r || typeof r !== 'object') return false;
    const tk = (k) => (typeof k === 'string' && /^v2[0-9]\.[a-z0-9_.]+$/.test(k)) ? t(k) : '';
    if (r.show && typeof r.show.text === 'string') {
      const s = r.show; const pre = h('pre', { class: 'logs' }, s.text);
      const box = h('div', {}, s.noteKey ? h('p', { class: 'muted small' }, tk(s.noteKey)) : null, pre, h('button', { class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(s.text); toast('📋 ' + t('v26.copied')); } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); } } }, iconSvg('copy', 14), ' ' + t('v26.copy')));
      Panels.modal(tk(s.titleKey) || String(s.title || ''), box, { wide: true }); return true;
    }
    if (r.toastKey) { toast(tk(r.toastKey) || '✓'); return true; }
    return false;
  },
  async logs(p) { const l = await API.inv('plugins:logs', p.id); Panels.modal('📜 ' + p.name, h('pre', { class: 'logs' }, l.join('\n') || '—'), { wide: true }); },
  addCard(p, c) { if (p.rendererCard) { const at = Cmd.freeSpot(c.w || 260, c.h || 220); const it0 = Features.addAt({ type: p.rendererCard, w: c.w || 260, h: c.h || 220 }, at.x, at.y); Panels.closeDrawer(); return it0; } const at = Cmd.freeSpot(c.w || 340, c.h || 260); const it = Features.addAt({ type: 'plugin', plugin: p.id, card: c.type, cfg: {}, w: c.w || 340, h: c.h || 260, title: c.name }, at.x, at.y); this.refreshCard(it, true); Panels.closeDrawer(); return it; },
  async refreshCard(it, manual) {
    const n = Items.el(it); n?.classList.add('busy');
    try { const d = await API.inv('plugins:card', it.plugin, it.card, it.cfg || {}); Store.change(() => { it.data = d; it.at = Date.now(); it.error = ''; }); } catch (e) { it.error = e.message; if (manual) toast('⚠️ ' + e.message, { kind: 'err' }); }
    n?.classList.remove('busy'); if (Items.nodes.has(it.id)) Items.mount(it);
  },
  syncCards() { for (const it of Store.items()) if (it.type === 'plugin') { const p = this.get(it.plugin); const c = p?.cards?.find(c => c.type === it.card); const every = (c?.every || 30) * 60e3; if (p?.enabled && (!it.at || Date.now() - it.at > every)) this.refreshCard(it); } },
};
Items.R.plugin = function (n, it) {
  const d = it.data || {}; const p = PluginStore.get(it.plugin);
  const rows = (d.rows || []).slice(0, 30).map(r => `<div class="pr${r.url ? ' live act' : ''}" ${r.url ? `data-act="plugin-url" data-url="${esc(r.url)}"` : ''}><span class="pl">${r.icon ? r.icon + ' ' : ''}${esc(r.label)}</span>${r.value != null ? `<span class="pv" style="${r.color ? 'color:' + esc(r.color) : ''}">${esc(String(r.value))}</span>` : ''}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div>`).join('');
  n.innerHTML = t('pluginsui.051', { v0: iconSvg(p?.icon || 'puzzle', 15), v1: esc(d.title || it.title || it.plugin), v2: iconSvg('refresh-cw', 13), v3: it.error ? `<div class="perr">⚠️ ${esc(it.error)}</div>` : '', v4: d.text ? `<p>${esc(d.text)}</p>` : '', v5: rows || (!d.text && !it.error ? '<div class="muted small">…</div>' : ''), v6: d.footer || it.at ? `<div class="pc-foot">${esc(d.footer || '')} ${it.at ? '· ' + new Date(it.at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }) : ''}</div>` : '' });
};

// ---------------- bridge ops from plugins ----------------
const PluginOps = {
  async run({ op, args, plugin }) {
    if (op.startsWith('board.')) {
      const tool = op.slice(6);
      // New MCP tools (and MCP's own names for search/create/…) live in McpBoard: no silent caps, labelled undo, always-confirm delete.
      if (typeof McpBoard !== 'undefined' && McpBoard.handles(tool)) return await McpBoard.run(tool, args[0] || {}, { plugin });
      if (tool === 'snapshot') { const b = Store.board(); return { board: b.name, items: b.items.filter(i => !['ink'].includes(i.type)).map(i => ({ id: i.id, type: i.type, x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w || 200), h: Math.round(i.h || 120), title: Features.itemTitle(i), text: Search.text(i).slice(0, 20000), url: i.url || '', color: i.paper || i.color || '', tags: i.tags || [], src: i.file || i.src || '', ...(i.type === 'arrow' ? { x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2 } : {}) })) }; }
      if (tool === 'importJson') { const r = await V2Import.jsonCanvas(args[0]); return r; }
      const map = { addCard: 'create_card', addCards: 'create_cards', update: 'update_card', search: 'search_cards', read: 'read_cards', show: 'show_card', remove: 'delete_cards', group: 'group_cards', addSubscription: 'add_subscription', createBoard: 'create_board' };
      const name = map[tool] || tool; if (!Cmd.T[name] || ['set_theme', 'open_url', 'run_plugin', 'open_panel'].includes(name)) throw new Error(t('pluginsui.052') + tool);
      if (name === 'create_card') args[0] = { kind: 'note', ...args[0], tags: [...(args[0]?.tags || []), plugin] };
      return await Cmd.exec(name, args[0] || {});
    }
    if (op === 'assistant') return await Assistant.ask(String(args[0] || ''), plugin);
    if (op === 'shared') { const [k, v] = args; Store.state.shared ||= {}; if (v == null) delete Store.state.shared[k]; else Store.state.shared[k] = { v: String(v).slice(0, 80), by: plugin, at: Date.now() }; Store.save(); return true; }
    throw new Error(t('pluginsui.053') + op);
  },
};
API?.onPluginOp?.(async (msg) => { try { API.opResult({ id: msg.id, ok: true, value: await PluginOps.run(msg) }); } catch (e) { API.opResult({ id: msg.id, ok: false, error: String(e.message || e) }); } });
API?.onPluginEvent?.(({ ev, data }) => Automations.fire('plugin', { ev, data }));
API?.onToast?.((m) => (m && typeof m === 'object') ? toast((m.kind === 'err' ? '⚠️ ' : '') + String(m.text || ''), { ms: m.ms || 8000, kind: m.kind }) : toast('🧩 ' + m, { ms: 5000 }));
Assistant.ask = async function (text, src) {
  this.push({ role: 'user', content: text, src: src || 'auto' }); let res;
  try { res = await this.run(text); } catch (e) { res = { content: '⚠️ ' + e.message, error: true }; }
  this.push({ role: 'assistant', ...res }); return { content: res.content, actions: (res.actions || []).length };
};

// ---------------- Automations ----------------
const TRIG = { card: t('pluginsui.054'), transcript: t('pluginsui.055'), time: t('pluginsui.056'), every: t('pluginsui.057'), tracker: t('pluginsui.058'), startup: t('pluginsui.059'), assistant: t('pluginsui.060'), plugin: t('pluginsui.061') };
const DO = { autotag: t('pluginsui.062'), transcribe: t('pluginsui.063'), tag: t('pluginsui.064'), move: t('pluginsui.065'), color: t('pluginsui.066'), notify: t('pluginsui.067'), assistant: t('pluginsui.068'), voicecmd: t('pluginsui.069'), summarize: t('pluginsui.070'), plugin: t('pluginsui.071'), snapshot: t('pluginsui.072') };
const AUTO_PRESETS = [
  { name: t('pluginsui.073'), when: { type: 'card', cardType: 'image' }, then: [{ do: 'autotag' }] },
  { name: t('pluginsui.074'), when: { type: 'card', cardType: 'video' }, then: [{ do: 'transcribe' }] },
  { name: t('pluginsui.075'), when: { type: 'transcript', text: 'nyx' }, then: [{ do: 'voicecmd' }] },
  { name: t('pluginsui.076'), when: { type: 'card', tag: 'todo' }, then: [{ do: 'move', arg: t('pluginsui.077') }] },
  { name: t('pluginsui.078'), when: { type: 'time', at: '08:30' }, then: [{ do: 'assistant', arg: t('pluginsui.079') }] },
  { name: t('pluginsui.080'), when: { type: 'tracker' }, then: [{ do: 'notify', arg: t('pluginsui.081') }] },
  { name: t('pluginsui.082'), when: { type: 'time', at: '21:00', days: '0' }, then: [{ do: 'snapshot' }] },
];
const Automations = {
  list() { return (Store.state.automations ||= []); },
  running: 0,
  match(a, ev, p) {
    const w = a.when || {}; if (w.type !== ev) return false;
    if (ev === 'card' || ev === 'transcript') { if (!p) return false; if (w.cardType && p.type !== w.cardType) return false; if (w.tag && !(p.tags || []).some(t => norm(t) === norm(w.tag))) return false; if (w.text && !norm(Search.text(p)).includes(norm(w.text))) return false; }
    if (ev === 'plugin' && w.text && !norm(p?.ev || '').includes(norm(w.text))) return false;
    if (ev === 'assistant' && w.text && !norm(p?.content || '').includes(norm(w.text))) return false;
    return true;
  },
  fire(ev, payload) {
    if (V2.viewer || this.running > 4) return;
    try { if (ev === 'card' && payload) API?.dispatch('card', { id: payload.id, type: payload.type, title: Features.itemTitle(payload), tags: payload.tags || [] }); else if (ev !== 'plugin') API?.dispatch(ev, payload && payload.id ? { id: payload.id, type: payload.type } : null); } catch (e) {}
    for (const a of this.list()) if (a.on && this.match(a, ev, payload)) setTimeout(() => this.run(a, payload), ev === 'card' ? 400 : 0);
  },
  async run(a, it) {
    this.running++; a.last = Date.now(); a.count = (a.count || 0) + 1;
    try {
      for (const s of a.then || []) {
        const live = it?.id ? Store.find(it.id)?.item : null;
        if (s.do === 'autotag' && live?.type === 'image') await Vision.tag(live);
        else if (s.do === 'transcribe' && live && ['video', 'audio'].includes(live.type) && !live.transcript) await Media2.transcribe(live, true);
        else if (s.do === 'tag' && live) { Store.change(() => { live.tags = [...new Set([...(live.tags || []), String(s.arg || '').replace(/^#/, '')])].filter(Boolean); }); Items.nodes.has(live.id) && Items.mount(live); }
        else if (s.do === 'color' && live?.type === 'sticky') { Store.change(() => { live.paper = colorOf(s.arg, live.paper); }); Items.mount(live); }
        else if (s.do === 'move' && live) { const f = Store.find(live.id); let b = Store.state.boards.find(b => norm(b.name) === norm(s.arg || '')); if (!b) { b = { id: uid(), name: s.arg || t('pluginsui.083'), emoji: '⚡', color: PALETTE[5], view: null, items: [] }; Store.state.boards.push(b); } if (f && f.board !== b) { f.board.items = f.board.items.filter(i => i !== live); live.x = 0 + (b.items.length % 6) * 260; live.y = Math.floor(b.items.length / 6) * 260; b.items.push(live); Items.unmount(live.id); Store.save(); Panels.tabs(); } }
        else if (s.do === 'notify') API?.notify('Nyx · ' + a.name, (s.arg || '') + (live ? ' — ' + Features.itemTitle(live) : ''));
        else if (s.do === 'assistant') await Assistant.ask(fillVars(s.arg, live), t('pluginsui.084'));
        else if (s.do === 'voicecmd' && live?.transcript?.text) { const t = live.transcript.text.replace(/^\s*(nyx|νυξ|νιξ)[,:\s]*/i, ''); await Assistant.ask(t, tr('pluginsui.085')); }
        else if (s.do === 'summarize') await Cmd.T.summarize.run({ scope: 'board' });
        else if (s.do === 'plugin' && s.arg) { const [pid, act] = String(s.arg).split(':'); await API.inv('plugins:action', pid, act, { item: live ? Cmd.brief(live) : null }); }
        else if (s.do === 'snapshot') await API.inv('snap:create', t('extras.088'));
      }
      a.err = '';
    } catch (e) { a.err = e.message; console.warn('automation', a.name, e); } finally { this.running--; Store.save(); }
  },
  tick() {
    const d = new Date(); const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; const key = d.toDateString() + ' ' + hm;
    for (const a of this.list()) { if (!a.on) continue; const w = a.when || {};
      if (w.type === 'time' && w.at === hm && a._k !== key && (!w.days || String(w.days).split(',').includes(String(d.getDay())))) { a._k = key; this.run(a); }
      if (w.type === 'every' && (+w.min || 0) >= 1 && Date.now() - (a.last || 0) >= w.min * 60e3) this.run(a); }
    PluginStore.syncCards();
  },
  init() { setTimeout(() => { for (const a of this.list()) if (a.on && a.when?.type === 'startup') this.run(a); }, 4000); setInterval(() => this.tick(), 30e3); },
  ui(body) {
    const wrap = h('div', { class: 'autos' }); body.append(wrap);
    const draw = () => {
      wrap.innerHTML = '';
      wrap.append(h('div', { class: 'row gap' }, h('button', { class: 'btn primary sm', onclick: () => this.edit(null, draw) }, iconSvg('plus', 14), t('pluginsui.086')), h('span', { class: 'muted small grow' }, t('pluginsui.087'))));
      if (!this.list().length) wrap.append(h('p', { class: 'muted' }, t('pluginsui.088')));
      for (const a of this.list()) wrap.append(h('div', { class: 'auto ' + (a.on ? 'on' : '') }, h('input', { type: 'checkbox', class: 'toggle', checked: a.on ? true : null, onchange: (e) => { a.on = e.target.checked; Store.save(); } }),
        h('div', { class: 'grow', onclick: () => this.edit(a, draw) }, h('b', {}, a.name), h('div', { class: 'muted small' }, this.describe(a) + (a.count ? ` · ${a.count}× · ${fmtDate(a.last)}` : '') + (a.err ? ' · ⚠️ ' + a.err : ''))),
        h('button', { class: 'ib', title: t('pluginsui.089'), html: iconSvg('play', 15), onclick: () => this.run(a, Canvas.selItems()[0]) }), h('button', { class: 'ib danger', title: t('panels.054'), html: iconSvg('trash-2', 15), onclick: () => { Store.state.automations = this.list().filter(x => x !== a); Store.save(); draw(); } })));
      wrap.append(h('h4', {}, t('pluginsui.090')), ...AUTO_PRESETS.map(p => h('div', { class: 'auto preset' }, h('span', { html: iconSvg('wand-sparkles', 16) }), h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'muted small' }, this.describe(p))), h('button', { class: 'btn sm', onclick: () => { this.list().push({ id: uid(), on: true, ...JSON.parse(JSON.stringify(p)) }); Store.save(); draw(); toast('⚡ ' + p.name); } }, t('pluginsui.091')))));
    };
    draw();
  },
  describe(a) { const w = a.when || {}; let s = TRIG[w.type] || w.type; if (w.cardType) s += ` (${w.cardType})`; if (w.tag) s += ` #${w.tag}`; if (w.text) s += ` «${w.text}»`; if (w.at) s += ' ' + w.at; if (w.days) s += ' [' + String(w.days).split(',').map(d => GR_DAYS[+d]?.slice(0, 3)).join(',') + ']'; if (w.min) s += ` ${w.min}′`; return s + ' → ' + (a.then || []).map(t => DO[t.do] + (t.arg ? `: ${String(t.arg).slice(0, 40)}` : '')).join(', '); },
  edit(a, done) {
    const isNew = !a; a = a ? JSON.parse(JSON.stringify(a)) : { id: uid(), on: true, name: '', when: { type: 'card' }, then: [{ do: 'tag', arg: '' }] };
    const w = a.when, s = a.then[0] || (a.then[0] = { do: 'notify' });
    const f = form([['name', t('extras.058'), 'text', a.name, { placeholder: t('pluginsui.092') }], ['type', t('pluginsui.093'), 'select', w.type, { options: Object.entries(TRIG) }], ['cardType', t('pluginsui.094'), 'select', w.cardType || '', { options: [['', t('pluginsui.095')], ['sticky', t('pluginsui.096')], ['text', t('pluginsui.097')], ['image', t('pluginsui.098')], ['video', t('pluginsui.099')], ['audio', t('pluginsui.100')], ['link', t('pluginsui.101')], ['web', t('assistant.095')]] }], ['tag', t('pluginsui.102'), 'text', w.tag || ''], ['text', t('pluginsui.103'), 'text', w.text || ''], ['at', t('pluginsui.104'), 'time', w.at || '09:00'], ['days', t('pluginsui.105'), 'text', w.days || ''], ['min', t('pluginsui.057'), 'number', w.min || 60], ['do', t('pluginsui.106'), 'select', s.do, { options: Object.entries(DO) }], ['arg', t('pluginsui.107'), 'text', s.arg || '']]);
    f.el.append(h('p', { class: 'muted small' }, t('pluginsui.108')));
    Panels.modal(isNew ? t('pluginsui.109') : '⚡ ' + a.name, f.el, { ok: () => { const v = f.val(); a.name = v.name || (TRIG[v.type] + ' → ' + DO[v.do]); a.when = { type: v.type, ...(v.cardType ? { cardType: v.cardType } : {}), ...(v.tag ? { tag: v.tag.replace(/^#/, '') } : {}), ...(v.text ? { text: v.text } : {}), ...(v.type === 'time' ? { at: v.at, ...(v.days ? { days: v.days.replace(/\s/g, '') } : {}) } : {}), ...(v.type === 'every' ? { min: Math.max(1, +v.min) } : {}) }; a.then = [{ do: v.do, ...(v.arg ? { arg: v.arg } : {}) }];
      const L = this.list(); const i = L.findIndex(x => x.id === a.id); if (i >= 0) L[i] = a; else L.push(a); Store.save(); done?.(); } });
  },
};
function fillVars(s, it) { return String(s || '').replace(/\{title\}/g, it ? Features.itemTitle(it) : '').replace(/\{text\}/g, it ? Search.text(it).slice(0, 2000) : ''); }
