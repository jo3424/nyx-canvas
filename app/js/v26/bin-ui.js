'use strict';
// v2.6.10 — Κάδος: the small corner button (with a counter) and the drawer that lists deleted cards / subscriptions.
// Restore one by one or with checkboxes, back to the same board and position (one undo step). Nothing leaves the
// bin without an explicit OK; items older than NyxBin.KEEP_DAYS are only marked.
const Bin = {
  fmt(ms) { try { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)); const g = (k) => (p.find(x => x.type === k) || {}).value; return `${g('day')}/${g('month')} ${g('hour')}:${g('minute')}`; } catch (e) { return ''; } },
  list() { return [...((Store.state && Store.state.bin) || [])].sort((a, b) => b.at - a.at); },
  oldOnes() { return NyxBin.old(Store.state, Date.now()); },
  init() {
    if ($('#z-bin')) return;
    const bar = $('#corner .zoombar'); if (!bar) return;
    const b = h('button', { id: 'z-bin', class: 'z-bin', 'data-bin': '1', onclick: () => this.open() }, h('span', { html: iconSvg('trash-2', 15) }), h('span', { class: 'bin-n', hidden: true }));
    bar.append(b); this.badge();
  },
  badge() {
    const b = $('#z-bin'); if (!b) return; const n = ((Store.state && Store.state.bin) || []).length; const old = n ? this.oldOnes().length : 0;
    const c = b.querySelector('.bin-n'); c.hidden = !n; c.textContent = n > 99 ? '99+' : String(n); c.classList.toggle('old', old > 0);
    b.dataset.count = String(n); b.dataset.old = String(old);
    b.title = t('v2610.bin_tip', { n }) + (old ? ' · ' + t('v2610.bin_old_tip', { n: old, d: NyxBin.KEEP_DAYS }) : '');
    if (Panels.drawerKind === 'bin') this.render();
  },
  open() { Panels.openDrawer('bin', `${iconSvg('trash-2', 20)} ${t('v2610.bin')}`, (body) => { this.body = body; this.render(); }); },
  icon(e) { if (e.kind === 'sub') return (e.v && e.v.icon) || '💳'; return { sticky: '🗒️', text: '🔤', shape: '⬛', image: '🖼️', video: '🎬', audio: '🎵', link: '🔗', file: '📄', web: '🌐', frame: '🖼', reminder: '⏰', countdown: '⏳', show: '📺', subs: '💳', tracker: '🔎', arrow: '➡️', line: '➖' }[e.v && e.v.type] || '▫️'; },
  name(e) { return e.name || (e.kind === 'card' ? Features.itemTitle(e.v || {}) : (e.v && e.v.name)) || e.id; },
  where(e) {
    if (e.kind === 'sub') return t('v2610.bin_sub');
    const live = e.board && Store.state.boards.find(b => b.id === e.board.id);
    if (live) return `${live.emoji || ''} ${live.name}`.trim();
    return `${(e.board && e.board.name) || '—'} · ${t('v2610.bin_board_gone')}`;
  },
  render() {
    const body = this.body; if (!body || Panels.drawerKind !== 'bin') return; body.innerHTML = '';
    const all = this.list(); const old = this.oldOnes(); const oldSet = new Set(old.map(e => e.bid));
    body.append(h('p', { class: 'muted small', 'data-bin-rule': '1' }, t('v2610.bin_rule', { d: NyxBin.KEEP_DAYS })));
    if (!all.length) { body.append(h('p', { class: 'muted', 'data-bin-empty': '1' }, t('v2610.bin_empty'))); return; }
    if (old.length) body.append(h('div', { class: 'note warn', 'data-bin-old': String(old.length) }, t('v2610.bin_old', { n: old.length, d: NyxBin.KEEP_DAYS }), ' ', h('button', { class: 'btn sm ghost danger', 'data-act': 'bin-purge-old', onclick: () => this.purge(old.map(e => e.bid), t('v2610.bin_purge_old_q', { n: old.length, d: NyxBin.KEEP_DAYS })) }, t('v2610.bin_purge_old', { n: old.length }))));
    const sel = () => [...body.querySelectorAll('[data-bin-cb]:checked')].map(x => x.dataset.binCb);
    const bar = h('div', { class: 'row gap wrap bin-bar' },
      h('button', { class: 'btn sm ghost', 'data-act': 'bin-all', onclick: () => { const cbs = [...body.querySelectorAll('[data-bin-cb]')]; const on = !cbs.every(c => c.checked); cbs.forEach(c => { c.checked = on; }); } }, t('v2610.bin_all')),
      h('button', { class: 'btn sm primary', 'data-act': 'bin-restore-sel', onclick: () => { const ids = sel(); if (!ids.length) return toast(t('v2610.bin_pick')); this.restore(ids); } }, '♻️ ' + t('v2610.bin_restore_sel')),
      h('button', { class: 'btn sm ghost danger', 'data-act': 'bin-purge-sel', onclick: () => { const ids = sel(); if (!ids.length) return toast(t('v2610.bin_pick')); this.purge(ids, t('v2610.bin_purge_q', { n: ids.length })); } }, t('v2610.bin_purge_sel')));
    body.append(bar);
    const ul = h('div', { class: 'bin-list' });
    for (const e of all) {
      ul.append(h('label', { class: 'bin-row' + (oldSet.has(e.bid) ? ' old' : ''), 'data-bin-row': e.bid, 'data-kind': e.kind },
        h('input', { type: 'checkbox', 'data-bin-cb': e.bid }),
        h('span', { class: 'bin-ico' }, this.icon(e)),
        h('span', { class: 'bin-main' }, h('b', { class: 'bin-name' }, this.name(e)), h('span', { class: 'muted small bin-meta' }, `${this.where(e)} · ${this.fmt(e.at)}${oldSet.has(e.bid) ? ' · ' + t('v2610.bin_old_one', { d: NyxBin.KEEP_DAYS }) : ''}`)),
        h('button', { class: 'btn sm', 'data-bin-restore': e.bid, onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); this.restore([e.bid]); } }, t('v2610.bin_restore'))));
    }
    body.append(ul);
  },
  // restore; when a card's board no longer exists, say so and let the user choose where it goes
  async restore(bids) {
    const p = NyxBin.plan(Store.state, bids);
    let choice = null;
    if (p.noBoard.length) { choice = await this.askBoards(p.noBoard); if (!choice) return { restored: [], cancelled: true }; }
    let r;
    Store.change(() => { r = NyxBin.restore(Store.state, bids, choice); }, t('v2610.bin_lbl'));
    App.afterHistory(); this.badge();
    const n = r.restored.length; const where = [...new Set(r.restored.filter(e => e.kind === 'card').map(e => { const b = Store.state.boards.find(x => x.id === (choice && choice[e.board.id] && choice[e.board.id] !== 'recreate' ? choice[e.board.id] : e.board.id)); return b ? b.name : ''; }).filter(Boolean))];
    toast('♻️ ' + t('v2610.bin_done', { n }) + (where.length ? ' → ' + where.join(', ') : '') + (r.exists.length ? ' · ' + t('v2610.bin_exists', { n: r.exists.length }) : ''), { ms: 6000, action: { label: t('undo'), fn: () => App.undo() } });
    return r;
  },
  askBoards(entries) {
    const gone = new Map(); for (const e of entries) { const k = (e.board && e.board.id) || 'gone'; if (!gone.has(k)) gone.set(k, { b: e.board || { id: k, name: '' }, n: 0 }); gone.get(k).n++; }
    return new Promise((res) => {
      let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
      const body = h('div', { 'data-bin-ask': '1' }, ...[...gone.values()].map(({ b, n }) => h('div', { class: 'field' },
        h('p', {}, t('v2610.bin_board_q', { v0: b.name || '—', n })),
        h('select', { class: 'inp', 'data-bin-board': b.id }, h('option', { value: 'recreate' }, t('v2610.bin_recreate', { v0: b.name || '—' })), ...Store.state.boards.map(x => h('option', { value: x.id }, `${x.emoji || ''} ${x.name}`.trim()))))));
      Panels.modal('♻️ ' + t('v2610.bin_board_title'), body, { okLabel: t('v2610.bin_restore'), ok: () => { const c = {}; body.querySelectorAll('[data-bin-board]').forEach(s => { c[s.dataset.binBoard] = s.value; }); fin(c); }, onClose: () => fin(null) });
    });
  },
  // explicit OK only
  purge(bids, q) {
    Panels.modal('🗑️ ' + t('v2610.bin_purge_title'), h('p', { 'data-bin-purge-q': '1' }, q), { okLabel: t('v2610.bin_purge_ok'), ok: () => { const n = NyxBin.purge(Store.state, bids); Store.save(); this.badge(); toast('🗑️ ' + t('v2610.bin_purged', { n })); } });
  },
  // a board deleted from its tab: its cards go to the bin (the board's «Αναίρεση» toast still works as before)
  boardDeleted(b, idx) { try { const now = Date.now(); (b.items || []).forEach((it, i) => { if (NyxBin.binnable(it)) NyxBin.add(Store.state, NyxBin.cardEntry(it, b, i, now, Features.itemTitle(it))); }); this.badge(); } catch (e) { console.warn('bin', e); } },
};
window.Bin = Bin;
