'use strict';
// Nyx v2.1 — Settings tabs: «Ενημερώσεις» (signed code-only updates, rollback, components) and «Εργαλεία & διαδρομές».
// Everything here lives inside the Settings drawer; nothing is added to the canvas.
const Settings21 = {
  fmtSize(b) { if (!b) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return (i >= 3 ? b.toFixed(2) : b.toFixed(i ? 1 : 0)) + ' ' + u[i]; },
  fmtDate(ms) { if (!ms) return ''; try { return new Date(ms).toLocaleString(LANG === 'en' ? 'en-GB' : 'el-GR', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; } },
  rerender(tab) { Panels.drawerKind = null; Panels.settings(tab); },
  btn(icon, label, onclick, cls = 'btn') { return h('button', { class: cls, onclick }, iconSvg(icon, 15), ' ' + label); },
  // ====================== Update ======================
  async update(body) {
    const S = Store.state.settings; const U = (S.update ||= {});
    const wrap = h('div', { class: 'upd' }); body.append(wrap);
    let info; try { info = await API.inv('upd:info'); } catch (e) { wrap.append(h('p', { class: 'err' }, e.message)); return; }
    const status = h('div', { class: 'upd-status muted small' });
    const prog = h('div', { class: 'upd-prog', hidden: true }, h('i'));
    const setProg = (p) => { prog.hidden = p == null || p >= 1; prog.firstChild.style.width = Math.round((p || 0) * 100) + '%'; };
    this._offProg?.(); this._offProg = API.onUpdProgress?.((p) => setProg(p));
    const say = (msg, kind = '') => { status.className = 'upd-status small ' + (kind || 'muted'); status.textContent = msg; };
    const restartBox = h('div', { class: 'upd-restart', hidden: true }, h('span', {}, '🔄 ' + t('set21.restart_q')), h('button', { class: 'btn', onclick: () => API.inv('upd:restart') }, iconSvg('rotate-cw', 15), ' ' + t('set21.restart_now')), h('button', { class: 'btn ghost', onclick: () => { restartBox.hidden = true; } }, t('set21.later')));
    const after = (r) => {
      setProg(null);
      if (!r) return; if (!r.ok) { say('⚠️ ' + (r.msg || r.code), 'err'); return; }
      if ('to' in r) say('↩️ ' + t('set21.rolled', { v: r.to || '' }), 'ok'); else say('✅ ' + t('set21.installed', { v: r.version || '' }), 'ok');
      restartBox.hidden = false;
    };
    // --- current version card
    const ver = h('div', { class: 'upd-card' },
      h('div', { class: 'upd-ver' }, h('b', {}, 'Nyx Canvas'), h('span', { class: 'upd-badge', 'data-testid': 'upd-version' }, 'v' + info.version)),
      h('div', { class: 'muted small' }, info.external ? t('set21.src_external', { v: info.active || info.version }) : t('set21.src_builtin')),
      h('div', { class: 'muted small', 'data-testid': 'upd-runtime' }, `Electron ${info.electron} · Chromium ${info.chrome || ''} · Node ${info.node}`),
      info.rolledBack ? h('div', { class: 'small err' }, '⚠️ ' + t('set21.auto_rb', { v: info.rolledBack })) : null,
      !info.canUpdate ? h('div', { class: 'small muted' }, 'ℹ️ ' + t('set21.dev_mode')) : null);
    const urlInp = h('input', { class: 'inp', value: U.url || '', placeholder: t('set21.url_ph'), onchange: (e) => { U.url = e.target.value.trim(); Store.save(); } });
    const checkBtn = this.btn('refresh-cw', t('set21.check'), async () => {
      if (!U.url) { say('ℹ️ ' + t('set21.no_url'), 'muted'); urlInp.focus(); return; }
      checkBtn.disabled = true; say('⏳ ' + t('set21.checking'));
      const r = await API.inv('upd:check', U.url); checkBtn.disabled = false; U.lastCheck = Date.now(); Store.save();
      if (!r.ok) return say('⚠️ ' + (r.msg || r.code), 'err');
      if (!r.newer) return say('✅ ' + t('set21.up_to_date', { v: r.current }), 'ok');
      say('✨ ' + t('set21.avail', { v: r.latest.version }), 'ok'); newBox.innerHTML = '';
      const log = r.latest.changelog?.[LANG] || r.latest.changelog?.el || [];
      newBox.append(h('div', { class: 'upd-card new' }, h('b', {}, 'v' + r.latest.version), log.length ? h('ul', { class: 'upd-log' }, ...log.map(x => h('li', {}, x))) : null,
        r.needsFull ? h('p', { class: 'small err' }, t('set21.needs_full')) : this.btn('download', t('set21.download'), async (e) => { e.target.disabled = true; setProg(0.01); say('⬇️ ' + t('set21.downloading')); after(await API.inv('upd:download', U.url)); e.target.disabled = false; })));
    });
    const newBox = h('div');
    const fileBtn = this.btn('file-up', t('set21.from_file'), async () => { say('⏳ ' + t('set21.verifying')); after(await API.inv('upd:installFile')); if (status.textContent.startsWith('⏳')) say(''); }, 'btn ghost');
    const tokInp = h('input', { class: 'inp', type: 'password', placeholder: t('set21.token_ph'), onchange: async (e) => { const ok = await API.inv('upd:setToken', e.target.value.trim()); e.target.value = ''; e.target.placeholder = ok ? '•••••••• ' + t('set21.saved') : t('set21.token_ph'); } });
    API.inv('upd:hasToken').then(x => { if (x) tokInp.placeholder = '•••••••• ' + t('set21.saved'); }).catch(() => {});
    const hist = (info.history || []).slice().reverse();
    wrap.append(...[ver,
      h('div', { class: 'row gap wrap' }, checkBtn, fileBtn),
      status, prog, restartBox, newBox,
      h('details', { class: 'upd-adv' }, h('summary', {}, t('set21.source')),
        h('label', { class: 'field' }, h('span', {}, t('set21.url')), urlInp),
        h('p', { class: 'muted small' }, t('set21.url_help')),
        h('label', { class: 'field' }, h('span', {}, t('set21.token')), tokInp),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: U.auto ? true : null, onchange: (e) => { U.auto = e.target.checked; Store.save(); } }), h('span', {}, t('set21.auto'))),
        h('p', { class: 'muted small' }, t('set21.sig_note'))),
      h('h4', {}, '↩️ ' + t('set21.rollback_h')),
      h('p', { class: 'muted small' }, info.active ? t('set21.rb_to', { v: info.previous || info.builtinVersion }) : t('set21.rb_none')),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn ghost', disabled: info.active ? null : true, onclick: async () => { if (!confirm(t('set21.rb_confirm'))) return; after(await API.inv('upd:rollback')); } }, iconSvg('undo-2', 15), ' ' + t('set21.rollback')),
        info.canUpdate ? h('button', { class: 'btn ghost', onclick: () => API.inv('upd:openRoot') }, iconSvg('folder-open', 15), ' ' + t('set21.open_code')) : null),
      hist.length ? h('details', { class: 'upd-adv' }, h('summary', {}, t('set21.history')), h('ul', { class: 'upd-log small' }, ...hist.map(x => h('li', {}, `${this.fmtDate(x.at)} · ${x.ev} ${x.v || ''}${x.to ? ' → ' + x.to : ''}`)))) : null,
      h('h4', {}, '📝 ' + t('set21.changelog')), this.changelog(info.changelog || {}),
      h('h4', {}, '🧩 ' + t('set21.components')), await this.components()].filter(Boolean));
  },
  changelog(log) {
    const vers = Object.keys(log).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).slice(0, 4);
    if (!vers.length) return h('p', { class: 'muted small' }, '—');
    return h('div', { class: 'upd-changelog' }, ...vers.map((v, i) => h('details', { open: i === 0 ? true : null }, h('summary', {}, 'v' + v), h('ul', { class: 'upd-log' }, ...((log[v][LANG] || log[v].el || [])).map(x => h('li', {}, x))))));
  },
  async components() {
    const box = h('div', { class: 'upd-comp' });
    box.append(h('p', { class: 'muted small' }, t('set21.comp_help')));
    let r = { tools: [] }; try { r = await API.inv('sys:detect', Store.state.settings.tools || {}); } catch (e) {}
    const get = (id) => r.tools.find(x => x.id === id) || {};
    const models = ['lmstudio-models', 'ollama', 'hf-cache', 'gvs', 'forge-models'].map(get).filter(x => x.found);
    const scanN = r.scan?.items?.length;
    const rows = [['llama', 'llama.cpp', get('llama')], ['whisper', 'whisper.cpp', get('whisper')], ['ffmpeg', 'FFmpeg', get('ffmpeg')]];
    const latestCells = {};
    for (const [id, name, x] of rows) {
      latestCells[id] = h('span', { class: 'tver muted' }, '');
      box.append(h('div', { class: 'tool-row ' + (x.found ? 'ok' : 'miss'), 'data-comp': id }, h('span', { class: 'tdot' }),
        h('div', { class: 'tmain' }, h('b', {}, name), h('span', { class: 'tver' }, x.found ? (x.version || t('set21.found')) : t('set21.not_found')), h('small', { class: 'tpath', title: x.path || '' }, x.path || '')), latestCells[id]));
    }
    box.append(h('div', { class: 'tool-row ' + (models.length || scanN ? 'ok' : 'miss') }, h('span', { class: 'tdot' }),
      h('div', { class: 'tmain' }, h('b', {}, t('set21.models')), h('span', { class: 'tver' }, models.map(m => m.name + (m.version ? ' (' + m.version + ')' : m.note ? ' (' + m.note.replace(/^models: .*\((\d+)\)$/, '$1') + ')' : '')).join(' · ') || '—'),
        h('small', { class: 'tpath' }, scanN != null ? t('set21.scan_last', { n: scanN, d: this.fmtDate(r.scan.at) }) : t('set21.scan_never')))));
    const st = h('span', { class: 'muted small' });
    box.append(h('div', { class: 'row gap wrap' }, this.btn('search-check', t('set21.comp_check'), async (e) => {
      e.target.disabled = true; st.textContent = '⏳ ' + t('set21.checking');
      try { const L = await API.inv('upd:components'); for (const [id, v] of Object.entries(L)) { const c = latestCells[id]; if (!c) continue; c.textContent = v.ok ? t('set21.latest', { v: v.tag }) : '⚠️'; c.title = v.ok ? (v.url || '') : v.msg; } st.textContent = t('set21.comp_note'); } catch (err) { st.textContent = '⚠️ ' + err.message; }
      e.target.disabled = false;
    }, 'btn ghost'), h('button', { class: 'btn ghost', onclick: () => this.rerender('tools') }, iconSvg('wrench', 15), ' ' + t('set21.tab_tools')), st));
    return box;
  },
  // ====================== Tools & paths ======================
  async tools(body) {
    const force = !!(this._force || this._rescan); this._force = this._rescan = false;
    const ov = Store.state.settings.tools || {};
    const head = h('div', { class: 'row gap wrap tools-head' }); const list = h('div', { class: 'tools-list' }, h('p', { class: 'muted small' }, '⏳ ' + t('set21.detecting')));
    body.append(h('p', { class: 'muted small' }, t('set21.tools_help')), head, list);
    let r; try { r = await API.inv('sys:detect', ov, force); } catch (e) { list.innerHTML = ''; list.append(h('p', { class: 'err' }, e.message)); return; }
    head.append(h('span', { class: 'muted small', 'data-testid': 'tools-at' }, (r.cached ? t('set21.cached') : t('set21.fresh')) + ' · ' + this.fmtDate(r.at)),
      h('button', { class: 'btn sm', 'data-testid': 'tools-rescan', onclick: () => { this._force = true; this.rerender('tools'); } }, iconSvg('refresh-cw', 14), ' ' + t('set21.rescan')));
    list.innerHTML = '';
    const info = V2.info || {};
    if (info.cpu) list.append(h('div', { class: 'sysinfo' }, h('span', {}, '🖥️ ' + (info.platform || r.platform || '')), h('span', {}, '🧮 ' + (info.cpu || '') + ' · ' + (info.cpus || '') + ' threads'), h('span', {}, '🧠 RAM ' + ((info.mem || 0) / 1073741824).toFixed(0) + ' GB')));
    const order = ['GPU', 'Media', 'Dev', 'AI', 'Apps']; const cats = {};
    for (const x of r.tools) (cats[x.cat] ||= []).push(x);
    const catName = (c) => t('set21.cat_' + c.toLowerCase());
    for (const cat of Object.keys(cats).sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99)) {
      list.append(h('h4', {}, catName(cat)));
      for (const x of cats[cat].sort((a, b) => (b.found - a.found))) list.append(this.toolRow(x));
    }
    if (r.files?.length) {
      list.append(h('h4', {}, t('set21.model_files')));
      for (const f of r.files) list.append(h('div', { class: 'tool-row ' + (f.exists ? 'ok' : 'miss') }, h('span', { class: 'tdot' }), h('div', { class: 'tmain' }, h('b', {}, f.name), h('span', { class: 'tver' }, f.exists ? this.fmtSize(f.size) : t('set21.missing')), h('small', { class: 'tpath', title: f.p }, f.p)), f.exists ? this.openBtn(f.p) : null));
    }
    list.append(this.scanBox(r.scan));
  },
  openBtn(p) { return h('button', { class: 'btn ghost sm', title: t('set21.open_folder'), 'aria-label': t('set21.open_folder'), html: iconSvg('folder-open', 14), onclick: async () => { const x = await API.inv('sys:openFolder', p); if (x === 'missing') toast('⚠️ ' + t('set21.missing')); } }); },
  toolRow(x) {
    const sub = (x.items || []).length > 1 || (x.items || []).length === 1 && x.items[0].path !== x.path;
    const meta = [x.version || (x.serving ? t('set21.serving') : x.found ? t('set21.found') : t('set21.not_found')), x.size && x.size > 1048576 ? this.fmtSize(x.size) : ''].filter(Boolean).join(' · ');
    const row = h('div', { class: 'tool-row ' + (x.found ? 'ok' : 'miss'), 'data-tool': x.id }, h('span', { class: 'tdot' }),
      h('div', { class: 'tmain' }, h('b', {}, x.name), h('span', { class: 'tver' }, meta), h('small', { class: 'tpath', title: x.path || '' }, x.path || x.note || ''), x.path && x.note ? h('small', { class: 'tpath muted' }, x.note) : null),
      x.found && x.path && x.kind && x.kind !== 'http' ? h('button', { class: 'btn ghost sm', title: t('set21.launch'), html: iconSvg('play', 14), onclick: () => API.inv('sys:launch', x.path, x.kind).then(m => m && toast(m)).catch(e => toast('⚠️ ' + e.message)) }) : null,
      x.path && !/^https?:/.test(x.path) ? this.openBtn(x.path) : null,
      h('button', { class: 'btn ghost sm', title: t('set21.set_path'), html: iconSvg('pencil', 14), onclick: async () => { const p = await API.inv('sys:pickExe', x.name); if (p) { (Store.state.settings.tools ||= {})[x.id] = p; Store.save(); this._rescan = true; this.rerender('tools'); } } }));
    if (!sub) return row;
    const d = h('details', { class: 'tool-sub' }, h('summary', {}, t('set21.items', { n: x.items.length })), ...x.items.slice(0, 60).map(i => h('div', { class: 'tool-item' + (i.primary ? ' prim' : '') }, h('span', {}, i.name, i.primary ? h('span', { class: 'chip ok', title: t('v23.primary_tip') }, t('v23.primary')) : null), h('small', { class: 'tpath', title: i.path }, [i.size ? this.fmtSize(i.size) : '', i.note || '', i.path].filter(Boolean).join(' · ')), i.path ? this.openBtn(i.path) : null)));
    return h('div', { class: 'tool-group' }, row, d);
  },
  scanBox(last) {
    const box = h('div', { class: 'scan-box' }); const prog = h('div', { class: 'muted small', 'data-testid': 'scan-prog' }); const res = h('div', { class: 'scan-res' });
    const show = (s) => {
      res.innerHTML = ''; if (!s) { prog.textContent = t('set21.scan_never'); return; }
      if (s.error) { prog.textContent = '⚠️ ' + s.error; return; }
      const tot = (s.items || []).reduce((a, b) => a + (b.size || 0), 0);
      prog.textContent = t('set21.scan_sum', { n: (s.items || []).length, s: this.fmtSize(tot), d: this.fmtDate(s.at), ms: ((s.ms || 0) / 1000).toFixed(1) }) + (s.cancelled ? ' · ' + t('set21.scan_cancelled') : '');
      const q = h('input', { class: 'inp', placeholder: t('set21.filter'), oninput: () => draw() });
      const ul = h('div'); const draw = () => { ul.innerHTML = ''; const f = q.value.toLowerCase(); for (const i of (s.items || []).filter(i => !f || i.path.toLowerCase().includes(f)).slice(0, 300)) ul.append(h('div', { class: 'tool-item' + (i.primary ? ' prim' : '') }, h('span', {}, i.name, i.primary ? h('span', { class: 'chip ok', title: t('v23.primary_tip') }, t('v23.primary')) : null), h('small', { class: 'tpath', title: i.path }, this.fmtSize(i.size) + ' · ' + i.path), this.openBtn(i.path))); };
      if ((s.items || []).length) { res.append(q, ul); draw(); }
    };
    const startB = this.btn('scan-search', t('set21.scan_start'), async () => { await API.inv('sys:scan'); running(true); });
    const cancelB = this.btn('x', t('set21.scan_cancel'), async () => { await API.inv('sys:scanCancel'); }, 'btn ghost');
    const running = (on) => { startB.hidden = on; cancelB.hidden = !on; if (on) prog.textContent = '⏳ ' + t('set21.scanning'); };
    this._offScan?.(); this._offScanDone?.();
    this._offScan = API.onScanProgress?.((p) => { running(true); prog.textContent = '⏳ ' + t('set21.scan_prog', { d: p.dirs, n: p.found }) + ' · ' + String(p.dir || '').slice(-60); });
    this._offScanDone = API.onScanDone?.((s) => { running(false); show(s); });
    box.append(h('h4', {}, '🔎 ' + t('set21.scan_h')), h('p', { class: 'muted small' }, t('set21.scan_help')), h('div', { class: 'row gap wrap' }, startB, cancelB), prog, res);
    running(false); show(last);
    API.inv('sys:scanState').then(st => { if (st.running) running(true); }).catch(() => {});
    return box;
  },
};
window.Settings21 = Settings21;
// Optional daily background check (notify only, never installs on its own).
