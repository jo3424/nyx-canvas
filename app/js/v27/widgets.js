'use strict';
// v2.7.0 — widgets on the canvas (mockups 08 / 09 / 12 / 13): Σήμερα, Συνδρομές, Υπενθυμίσεις, Ημερολόγιο, #tag.
// A widget is a normal canvas card (type 'widget'): it moves, resizes, locks, goes to the Bin and comes back with Undo
// like any card. Extra fields only: wkind, wsize ('s' | 'm' | 'l'), wcollapsed, wtag, title. Pinning is the existing
// «Καρφίτσωμα στο παράθυρο Widget» (it.pinned). The data comes from NyxWidgetData (local state only: no network).
// States: loading (skeleton until the data is ready), error (message + «Ξανά»), empty, collapsed (header + summary).
const Widgets = {
  ICON: { today: 'sun', subs: 'credit-card', reminders: 'bell', calendar: 'calendar-days', tag: 'hash' },
  // later kinds: shown in the gallery as «coming», never addable in 2.7.0 (no new URLs in this version)
  LATER: [['rss', 'rss', 'live', '2.7.1'], ['youtube', 'youtube', 'live', '2.7.1'], ['weather', 'cloud-sun', 'live', 'decide'], ['water', 'droplet', 'mine', '2.7.2'], ['custom', 'plus', 'mine', '2.7.2'], ['feed', 'rss', 'mine', '2.7.1']],
  months: new Map(), // calendar month offset per widget (view only, not saved)
  picked: new Map(), // calendar: picked day per widget (view only)
  providers: {}, // tests may replace a provider (e.g. a slow or failing one) to show the loading / error states
  title(it) { return it.wkind === 'tag' ? '#' + (it.wtag || t('v270.k_tag')) : t('v270.k_' + it.wkind); },
  // ---------- data ----------
  subsSummary() { return (typeof NyxCalc !== 'undefined' && NyxCalc.subsSummary) ? NyxCalc.subsSummary(Store.state.subs || [], { lang: LANG === 'en' ? 'en' : 'el' }) : null; },
  data(it) {
    const P = this.providers[it.wkind]; if (P) return P(it);
    const D = NyxWidgetData; const now = Date.now(); const st = Store.state;
    if (it.wkind === 'subs') { const S = this.subsSummary(); if (!S) throw new Error(t('v270.err_calc')); return S; }
    const subsUp = (() => { const S = this.subsSummary(); return S ? S.upcoming : null; })();
    if (it.wkind === 'reminders') return D.reminders(st, now, it.wsize === 'l' ? 5 : 3);
    if (it.wkind === 'today') return D.today(st, now, { subsUpcoming: subsUp });
    if (it.wkind === 'calendar') { const off = this.months.get(it.id) || 0; const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + off); return D.calendar(st, d.getFullYear(), d.getMonth() + 1, now, { subsUpcoming: subsUp }); }
    if (it.wkind === 'tag') return { ...D.tagged(st, it.wtag, it.wsize === 's' ? 3 : it.wsize === 'l' ? 9 : 5), tags: D.allTags(st).slice(0, 8) };
    throw new Error(t('v270.err_kind', { v0: it.wkind }));
  },
  // ---------- frame ----------
  render(n, it) {
    const kind = NyxWidgetData.KINDS.includes(it.wkind) ? it.wkind : 'today';
    n.classList.add('wg-' + kind, 'wsz-' + (it.wsize || 'm')); n.classList.toggle('wg-collapsed', !!it.wcollapsed);
    n.innerHTML = `<div class="card wg-card" data-wkind="${esc(kind)}" data-wsize="${esc(it.wsize || 'm')}"><div class="wg-head"><span class="wg-ico">${iconSvg(this.ICON[kind], 15)}</span><b class="wg-title">${esc(this.title(it))}</b><span class="wg-chip" hidden></span><button class="live mini act wg-more" data-act="w-menu" title="${esc(t('v270.menu'))}">${iconSvg('ellipsis', 15)}</button></div><div class="wg-body live" data-wstate="loading">${this.skeleton()}</div></div>`;
    this.fill(n, it);
  },
  skeleton() { return `<div class="wg-skel"><i></i><i></i><i class="short"></i></div><div class="wg-note">${esc(t('v270.loading'))}</div>`; },
  fill(n, it) {
    const body = n.querySelector('.wg-body'); if (!body) return;
    const tok = (n._wTok = (n._wTok || 0) + 1);
    const done = (d) => { if (n._wTok !== tok) return; try { this.paint(n, it, body, d); } catch (e) { this.fail(body, e); } };
    let r; try { r = this.data(it); } catch (e) { this.fail(body, e); return; }
    if (r && typeof r.then === 'function') { body.setAttribute('data-wstate', 'loading'); body.innerHTML = this.skeleton(); r.then(done, (e) => { if (n._wTok === tok) this.fail(body, e); }); }
    else done(r);
  },
  fail(body, e) {
    body.setAttribute('data-wstate', 'error');
    body.innerHTML = `<div class="wg-err"><span class="wg-err-ico">${iconSvg('triangle-alert', 22)}</span><b>${esc(t('v270.err_title'))}</b><span class="muted small">${esc(String((e && e.message) || e || '').slice(0, 160))}</span><button class="btn sm ghost act" data-act="w-retry">${iconSvg('refresh-cw', 13)} ${esc(t('v270.retry'))}</button></div>`;
  },
  chip(n, text, hot) { const c = n.querySelector('.wg-chip'); if (!c) return; c.hidden = !text; c.textContent = text || ''; c.classList.toggle('hot', !!hot); },
  relText(r) { return r.k === 'in_h' ? (r.n === 1 ? t('v270.rel_in_1h') : t('v270.rel_in_h', { n: r.n })) : r.k === 'in_min' ? t('v270.rel_in_min', { n: r.n }) : r.k === 'tomorrow' ? t('v2693.tomorrow') : r.k === 'days' ? t('v270.rel_days', { n: r.n }) : r.k === 'past_today' ? t('v270.rel_past_today') : t('v270.rel_past'); },
  hm(at) { const d = new Date(at); return pad(d.getHours()) + ':' + pad(d.getMinutes()); },
  whenText(e) { const dd = Math.round((new Date(e.at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5); const timed = !/^\d{4}-\d\d-\d\d$/.test(String(e.raw || '')) && (new Date(e.at).getHours() || new Date(e.at).getMinutes()); const tm = timed ? ' ' + this.hm(e.at) : ''; return dd === 0 ? t('v2693.today') + tm : dd === 1 ? t('v2693.tomorrow') + ' ' + fmtDM(new Date(e.at)) + tm : fmtDay(new Date(e.at)) + tm; },
  KIND_ICON: { reminder: 'alarm-clock', countdown: 'timer', show: 'tv', sub: 'credit-card' },
  row(e, right, hot, act) {
    return `<div class="wg-row${hot ? ' hot' : ''} act live" data-act="${act || 'w-open'}" data-ref="${esc(e.id)}" data-rkind="${esc(e.kind || '')}" style="--rc:${esc(e.color || (e.kind === 'sub' ? '#4fbf7a' : e.birthday ? '#e3a33b' : e.kind === 'reminder' ? '#e0607a' : 'var(--accent)'))}"><span class="wg-ri">${e.emo && e.kind !== 'reminder' ? esc(e.emo) : iconSvg(e.birthday ? 'cake' : (this.KIND_ICON[e.kind] || 'dot'), 14)}</span><span class="wg-rm"><b>${esc(e.title || '—')}</b><span class="muted">${esc(e.sub || this.whenText(e))}</span></span>${right ? `<span class="wg-rr${hot ? ' hot' : ''}">${esc(right)}</span>` : ''}</div>`;
  },
  paint(n, it, body, d) {
    const k = it.wkind; const sz = it.wsize || 'm'; let html = ''; let chip = '', hot = false;
    if (k === 'subs') {
      const S = d; const up = S.upcoming.slice(0, sz === 's' ? 0 : sz === 'l' ? 4 : 2);
      html = `<div class="wg-lab muted">${esc(t('v270.this_month', { v0: S.month.name + ' ' + S.month.y }))}</div><div class="wg-big act live" data-act="w-subs" style="cursor:pointer"><b data-wsubs-total="${S.total}">${esc(S.totalText)}</b><span class="muted">${esc(t('v270.of_active', { n: S.active }))}</span></div><div class="subx-bar wg-bar"><i style="width:${Math.round(S.pct * 100)}%"></i></div><div class="wg-lab muted small">${esc(t('v270.paid_left', { v0: S.paidText, v1: S.dueText, v2: S.month.lastDM }))}</div>`
        + (up.length ? `<div class="wg-list">${up.map((u) => this.row({ id: u.id, kind: 'sub', emo: u.icon || '💳', title: u.name, color: u.color, sub: u.dm + ' · ' + Subs.when(u) }, u.text, false, 'w-subs')).join('')}</div>` : (sz !== 's' && !S.upcoming.length ? `<div class="wg-empty muted">${esc(t('sub_empty'))}</div>` : ''));
      const nx = S.upcoming[0]; chip = nx ? nx.text + ' · ' + Subs.when(nx) : '';
    } else if (k === 'reminders') {
      html = d.items.length ? `<div class="wg-list">${d.items.map((e) => this.row(e, this.relText(e.rel), e.rel.soon)).join('')}</div>` + (d.more ? `<div class="wg-more-line muted small">${esc(t('v270.more_week', { n: d.more }))}</div>` : '') : `<div class="wg-empty muted">${esc(t('v270.rem_empty'))}</div>`;
      const f = d.items[0]; chip = f ? t('v270.chip_rem', { n: d.total, v0: this.relText(f.rel) }) : ''; hot = !!(f && f.rel.soon);
    } else if (k === 'today') {
      const now = new Date(); const date = now.toLocaleDateString(LANG === 'el' ? 'el-GR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      html = `<div class="wg-date"><b>${esc(date.charAt(0).toUpperCase() + date.slice(1))}</b></div>` + (d.items.length ? `<div class="wg-list">${d.items.slice(0, sz === 's' ? 2 : sz === 'l' ? 6 : 4).map((e) => this.row({ ...e, sub: e.kind === 'sub' ? (e.amount || '') + ' · ' + t('v270.charge') : this.whenText(e) }, e.kind === 'sub' ? '' : this.relText(e.rel), e.rel.soon)).join('')}</div>` : `<div class="wg-empty muted">${esc(t('v270.today_empty'))}</div>`)
        + `<div class="wg-more-line muted small">${esc(d.tomorrow ? t('v270.tomorrow_n', { n: d.tomorrow }) : d.next ? t('v270.next_on', { v0: fmtDay(new Date(d.next.at)), v1: d.next.title }) : t('v270.nothing_next'))}</div>`;
      chip = d.items.length ? t('v270.chip_today', { n: d.items.length }) : '';
    } else if (k === 'calendar') {
      const mn = new Date(d.year, d.month - 1, 1).toLocaleDateString(LANG === 'el' ? 'el-GR' : 'en-GB', { month: 'long', year: 'numeric' });
      const wd = t('v270.wd').split(',');
      const pick = this.picked.get(it.id);
      const cell = (c) => `<button class="wg-day act live${c.inMonth ? '' : ' out'}${c.today ? ' today' : ''}${pick === c.day ? ' picked' : ''}" data-act="w-day" data-day="${c.day}" data-n="${c.n}">${c.d}${c.kinds.length ? `<i class="wg-dots">${c.kinds.slice(0, 3).map((x) => `<s class="k-${x}"></s>`).join('')}</i>` : ''}</button>`;
      let foot = '';
      if (pick) { const evs = NyxWidgetData.events(Store.state, { subsUpcoming: (this.subsSummary() || {}).upcoming }).filter((e) => e.day === pick); foot = `<div class="wg-cal-foot" data-wpick="${pick}"><b>${esc(fmtDay(pick))}</b> · ${evs.length ? evs.slice(0, 3).map((e) => esc(e.title)).join(' · ') : esc(t('v270.cal_none'))}</div>`; }
      else if (sz !== 's') foot = `<div class="wg-cal-foot muted">${d.upcoming.map((e) => esc(fmtDay(new Date(e.at)) + ' ' + (e.kind === 'sub' ? t('v270.charge_short') : e.title.split(/\s+/).slice(0, 2).join(' ')))).join(' · ') || esc(t('v270.cal_none'))}</div>`;
      html = `<div class="wg-cal-head"><b>${esc(mn.charAt(0).toUpperCase() + mn.slice(1))}</b><span class="grow"></span><button class="mini act live" data-act="w-prev">‹</button><button class="mini act live" data-act="w-next">›</button></div><div class="wg-cal"><div class="wg-wd">${wd.map((x) => `<span>${esc(x)}</span>`).join('')}</div>${d.weeks.filter((w, i) => i < 5 || w.some((c) => c.inMonth)).map((w) => `<div class="wg-wk">${w.map(cell).join('')}</div>`).join('')}</div>${foot}`;
      const tk = d.weeks.flat().find((c) => c.today); chip = tk && tk.n ? t('v270.chip_today', { n: tk.n }) : '';
    } else if (k === 'tag') {
      if (!d.tag) html = `<div class="wg-empty muted">${esc(t('v270.tag_pick'))}</div><div class="wg-tags">${d.tags.map((x) => `<button class="chip act live" data-act="w-settag" data-tag="${esc(x.tag)}">#${esc(x.tag)} <span class="muted">${x.n}</span></button>`).join('') || `<span class="muted small">${esc(t('v270.tag_none'))}</span>`}</div>`;
      else html = d.items.length ? `<div class="wg-list">${d.items.map((x) => this.row({ id: x.id, kind: 'card', emo: x.emoji || '🗒️', title: x.title, sub: x.board, color: 'var(--accent)' }, '', false)).join('')}</div>` + (d.total > d.items.length ? `<div class="wg-more-line muted small">${esc(t('v270.tag_more', { n: d.total - d.items.length }))}</div>` : '') : `<div class="wg-empty muted">${esc(t('v270.tag_empty', { v0: d.tag }))}</div>`;
      chip = d.tag ? String(d.total) : '';
    }
    body.setAttribute('data-wstate', 'ok'); body.innerHTML = html; this.chip(n, it.wcollapsed ? chip : '', hot);
  },
  // ---------- refresh: data changes (subscriptions, reminders, tags…) repaint the widgets on the open board ----------
  refreshAll() { for (const it of (Store.items ? Store.items() : [])) if (it.type === 'widget') { const n = Items.el(it); if (n) this.fill(n, it); } },
  soon() { clearTimeout(this._t); this._t = setTimeout(() => this.refreshAll(), 250); },
  // ---------- actions (clicks inside a widget) ----------
  action(act, it, el) {
    if (act === 'w-menu') return this.menu(it, el);
    if (act === 'w-retry') { const n = Items.el(it); if (n) this.fill(n, it); return; }
    if (act === 'w-prev' || act === 'w-next') { this.months.set(it.id, (this.months.get(it.id) || 0) + (act === 'w-next' ? 1 : -1)); this.picked.delete(it.id); const n = Items.el(it); if (n) this.fill(n, it); return; }
    if (act === 'w-day') { const d = el && el.dataset.day; this.picked.get(it.id) === d ? this.picked.delete(it.id) : this.picked.set(it.id, d); const n = Items.el(it); if (n) this.fill(n, it); return; }
    if (act === 'w-subs') return Panels.subs();
    if (act === 'w-settag') return this.setTag(it, el && el.dataset.tag);
    if (act === 'w-open') { const id = el && el.dataset.ref; if (!id) return; if (el.dataset.rkind === 'sub') return Panels.subs(); if (Store.get && Store.get(id)) return Canvas.focusItem(id); if (typeof App !== 'undefined' && App.goToItem) return App.goToItem(id); const b = (Store.state.boards || []).find((x) => (x.items || []).some((i) => i.id === id)); if (b && App.switchBoard) { App.switchBoard(b.id); setTimeout(() => Canvas.focusItem(id), 120); } }
  },
  setTag(it, tag) { const v = NyxWidgetData.normTag(tag); if (!v) return; Store.change(() => { it.wtag = v; it.title = '#' + v; }, t('v270.lbl_tag')); Items.mount(it); },
  setSize(it, s) { const g = NyxWidgetData.sizeFor(it.wkind, s); Store.change(() => { it.wsize = s; it.w = g.w; it.h = g.h; }, t('v270.lbl_size')); Items.mount(it); Canvas.select && Canvas.select([it.id]); },
  toggleCollapse(it) { Store.change(() => { it.wcollapsed = !it.wcollapsed; if (it.wcollapsed) { it.wh = it.h; it.h = 46; } else { it.h = it.wh || NyxWidgetData.sizeFor(it.wkind, it.wsize).h; delete it.wh; } }, t('v270.lbl_collapse')); Items.mount(it); },
  menu(it, el) {
    const r = (el || Items.el(it)).getBoundingClientRect(); const I = (x) => iconSvg(x, 15); const ck = (on) => on ? ' ✓' : '';
    const rows = [
      [I('maximize-2'), t('v270.size') + ': ' + t('v270.sz_s') + ck(it.wsize === 's'), () => this.setSize(it, 's'), 'w-sz-s'],
      [I('maximize-2'), t('v270.size') + ': ' + t('v270.sz_m') + ck((it.wsize || 'm') === 'm'), () => this.setSize(it, 'm'), 'w-sz-m'],
      [I('maximize-2'), t('v270.size') + ': ' + t('v270.sz_l') + ck(it.wsize === 'l'), () => this.setSize(it, 'l'), 'w-sz-l'], '-',
      [I(it.wcollapsed ? 'chevrons-up-down' : 'chevrons-down-up'), it.wcollapsed ? t('v270.expand') : t('v270.collapse'), () => this.toggleCollapse(it), 'w-collapse'],
      [I('pin'), t('v270.pin_window') + ck(!!it.pinned), () => { Canvas.select([it.id]); Actions.togglePin(); }, 'w-pin'],
      [I(it.locked ? 'lock' : 'lock-open'), t('lock') + ck(!!it.locked), () => { Canvas.select([it.id]); Actions.toggleLock ? Actions.toggleLock() : null; }, 'w-lock'],
    ];
    if (it.wkind === 'tag') rows.push([I('hash'), t('v270.tag_change'), () => this.tagDialog(it), 'w-tag']);
    rows.push('-', [I('trash-2'), t('v270.remove_bin'), () => { Canvas.select([it.id]); Actions.del(); }, 'w-del danger']);
    Panels.menu(r.right - 220, r.bottom + 4, rows);
    const m = $('#ctxmenu'); m.dataset.menu = 'widget'; m.querySelectorAll('.mi').forEach((b, i) => { const cls = [...b.classList].find((c) => c.startsWith('w-')); if (cls) b.setAttribute('data-wmi', cls.slice(2)); });
  },
  tagDialog(it) {
    const inp = h('input', { class: 'inp', value: it.wtag || '', placeholder: '#' + t('v270.k_tag'), 'data-wtag-input': '1' });
    const chips = h('div', { class: 'wg-tags' }, ...NyxWidgetData.allTags(Store.state).slice(0, 16).map((x) => h('button', { class: 'chip', onclick: () => { inp.value = x.tag; } }, '#' + x.tag + ' ', h('span', { class: 'muted' }, String(x.n)))));
    Panels.modal('#️⃣ ' + esc(t('v270.tag_change')), h('div', {}, h('p', { class: 'muted small' }, t('v270.tag_help')), inp, chips), { ok: () => { const v = NyxWidgetData.normTag(inp.value); if (!v) return false; this.setTag(it, v); } });
  },
  // ---------- adding ----------
  add(kind, size, extra) {
    const p = NyxWidgetData.newItem(kind, size, { title: kind === 'tag' && extra && extra.wtag ? '#' + extra.wtag : t('v270.k_' + kind), ...(extra || {}) });
    const it = Features.addAtCenter(p); if (it && Canvas.select) Canvas.select([it.id]); return it;
  },
  gallery() {
    const sizes = {}; let cat = 'all';
    const tiles = [['today', 'ready'], ['subs', 'ready'], ['reminders', 'ready'], ['calendar', 'ready'], ['tag', 'ready'], ...this.LATER.map(([k, , c, v]) => [k, c, v])];
    const count = (c) => tiles.filter((x) => c === 'all' || x[1] === c).length;
    const grid = h('div', { class: 'wg-gal-grid' });
    const prev = (k) => { const P = { today: '<b>☀ </b><i></i><i class="s"></i>', subs: '<b>42,97 €</b><u></u><i></i>', reminders: '<i></i><i class="s"></i><i></i>', calendar: '<em></em>', tag: '<b>#</b><i></i><i class="s"></i>', rss: '<i></i><i></i><i class="s"></i>', youtube: '<span class="yt">▶</span>', weather: '<b>☁ —°</b>', water: '<b>5 / 8</b>', custom: '<b>＋</b>', feed: '<i class="url"></i>' }; return `<div class="wg-prev p-${k}">${P[k] || ''}</div>`; };
    const paint = () => {
      grid.innerHTML = '';
      for (const sec of ['ready', 'live', 'mine']) {
        const list = tiles.filter((x) => x[1] === sec && (cat === 'all' || cat === sec)); if (!list.length) continue;
        grid.append(h('h6', { class: 'wg-gal-sec' }, t('v270.gal_' + sec)));
        const row = h('div', { class: 'wg-gal-row' });
        for (const [k, , ver] of list) {
          const ready = sec === 'ready'; sizes[k] ||= 'm';
          const szb = (s) => h('button', { class: 'wg-szb' + (sizes[k] === s ? ' on' : ''), disabled: !ready, 'data-gsize': s, onclick: () => { sizes[k] = s; paint(); } }, t('v270.sz_' + s + '_short'));
          row.append(h('div', { class: 'wg-tile' + (ready ? '' : ' later'), 'data-gkind': k },
            h('div', { html: prev(k) }),
            h('div', { class: 'wg-tname' }, h('span', { html: iconSvg(this.ICON[k] || (this.LATER.find((x) => x[0] === k) || [])[1] || 'square', 14) }), ' ' + t('v270.k_' + k)),
            h('div', { class: 'wg-tdesc muted small' }, t('v270.d_' + k)),
            h('div', { class: 'wg-tfoot' }, szb('s'), szb('m'), szb('l'), h('span', { class: 'grow' }),
              ready ? h('button', { class: 'btn sm primary', 'data-gadd': k, onclick: () => { close(); this.add(k, sizes[k]); } }, '+ ' + t('v270.add'))
                : h('span', { class: 'wg-later', 'data-glater': ver }, ver === 'decide' ? t('v270.later_decide') : t('v270.later_in', { v0: ver })))));
        }
        grid.append(row);
      }
      nav.querySelectorAll('[data-gcat]').forEach((b) => b.classList.toggle('on', b.dataset.gcat === cat));
    };
    const nav = h('div', { class: 'wg-gal-nav' }, ...[['all', 'layout-grid'], ['ready', 'sparkles'], ['live', 'rss'], ['mine', 'palette']].map(([c, ic]) => h('button', { 'data-gcat': c, onclick: () => { cat = c; paint(); } }, h('span', { html: iconSvg(ic, 14) }), h('span', { class: 'grow' }, ' ' + t('v270.cat_' + c)), h('b', { class: 'muted' }, String(count(c))))));
    const body = h('div', { class: 'wg-gal', 'data-wgallery': '1' }, nav, grid);
    paint();
    const close = Panels.modal(iconSvg('layout-grid', 18) + ' ' + esc(t('v270.gallery')), body, { wide: true });
    $('#modal .modal-box').classList.add('wg-gal-box');
    setTimeout(() => { const f = body.querySelector('[data-gcat=all]'); if (f && !body.contains(document.activeElement)) f.focus(); }, 0); // Esc closes it even when opened from a menu
    const cleanup = () => { $('#modal .modal-box').classList.remove('wg-gal-box'); };
    setTimeout(() => { const M = $('#modal'); const o = M.onpointerdown; const obs = new MutationObserver(() => { if (M.hidden) { cleanup(); obs.disconnect(); } }); obs.observe(M, { attributes: true, attributeFilter: ['hidden'] }); }, 0);
    return close;
  },
  init() {
    Items.R.widget = (n, it) => this.render(n, it);
    const ca = Features.cardAction.bind(Features);
    Features.cardAction = (act, it) => { if (it && it.type === 'widget' && String(act).startsWith('w-')) return this.action(act, it, this._lastAct); return ca(act, it); };
    document.addEventListener('click', (e) => { this._lastAct = e.target.closest && e.target.closest('.act'); }, true);
    const sv = Store.save.bind(Store); Store.save = (...a) => { const r = sv(...a); this.soon(); return r; };
    const tb = document.getElementById('btn-widgets'); if (tb) tb.onclick = () => this.gallery();
    setInterval(() => this.refreshAll(), 60000);
    window.__nyxWidgets270 = true;
  }
};
Widgets.init();
