'use strict';
// v2.6.11 — appearance only (no change to data, router, models, plugins or permissions):
//  TabStrip: board tabs shrink, then «+N ▾»; wheel scrolls the strip; active tab always visible; ←/→/Home/End
//            (v2.6.12: anchored to the start — the first tabs stay visible, the last / new ones go into «+N ▾»)
//  Flyout:   tool options touch their dock button, stay inside the window; keys 1–9 only while open and not typing
//  UIStyle:  6 optional panel styles (Settings → Themes); the theme's own look stays the default; «Γυαλί» only ≥ 4.5:1
//  HubHead:  Hub header «loaded / max · μέγιστο max · N στον φάκελο» from the router's real answers
// Pure logic lives in ui2611.js (NyxUI) and is unit-tested in tests/v2611-unit.js.
const TabStrip = {
  start: null, maxStart: 0, mode: 'fit', _raf: 0,
  els() { return { T: $('#tabs'), zone: $('#tabs-zone'), more: $('#tabs-more'), add: $('#btn-add-tab') }; },
  layout(opts = {}) {
    const { T, zone, more, add } = this.els(); if (!T || !zone || !more) return null;
    const tabs = [...T.querySelectorAll(':scope > .tab')]; const S = Store.state;
    const active = Math.max(0, S.boards.findIndex((b) => b.id === S.active));
    // natural widths (all shown, no fixed width)
    T.classList.add('measuring'); more.hidden = true;
    for (const x of tabs) { x.hidden = false; x.style.width = ''; x.classList.remove('narrow'); }
    const widths = tabs.map((x) => x.getBoundingClientRect().width);
    T.classList.remove('measuring');
    const avail = Math.max(0, zone.clientWidth - (add ? add.offsetWidth : 0) - 10);
    // v2.6.12: anchored to the START — the FIRST tabs stay in the bar, the LAST / new ones that do not fit go into «+N ▾».
    // The active tab never pushes the first ones out: when it is hidden, «+N ▾» is highlighted and the board is marked in
    // its list. Only the wheel moves the window (this.start); re-renders keep it.
    const L = NyxUI.tabLayout({ widths, avail, active, start: this.start, anchor: 'start' });
    this.start = L.start; this.maxStart = L.maxStart; this.mode = L.mode;
    tabs.forEach((x, i) => {
      const vis = L.visible.includes(i); x.hidden = !vis;
      if (vis && L.mode !== 'fit') { x.style.width = L.width[i] + 'px'; x.classList.toggle('narrow', L.width[i] < 130); }
    });
    T.dataset.mode = L.mode; T.dataset.hidden = String(L.hidden.length);
    const n = L.hidden.length; more.hidden = !n; more.classList.toggle('has-active', !!(n && L.activeHidden));
    if (n) {
      more.innerHTML = ''; more.append(h('span', { class: 'tm-n' }, '+' + n), h('span', { class: 'tm-ch', html: iconSvg('chevron-down', 13) }));
      const lab = t('v2611.tabs_more', { v0: n }) + (L.activeHidden ? ' · ' + t('v2612.tabs_active_in_menu') : '');
      more.dataset.count = String(n); more.setAttribute('aria-label', lab); more.title = lab;
    }
    this._hidden = L.hidden.map((i) => S.boards[i]).filter(Boolean);
    return L;
  },
  soon() { cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(() => this.layout({ follow: false })); },
  openMore() {
    const { more } = this.els(); if (!more || more.hidden) return;
    const r = more.getBoundingClientRect();
    const act = Store.state.active;
    const rows = (this._hidden || []).map((b) => [`<span class="mi-emo">${esc(b.emoji || '•')}</span>`, b.name, () => { App.switchBoard(b.id); setTimeout(() => ($('#tabs .tab.on:not([hidden])') || $('#tabs-more'))?.focus(), 30); }, 'tm-item' + (b.id === act ? ' on' : ''), String(b.items.length)]);
    Panels.menu(r.right, r.bottom + 4, rows);
    const m = $('#ctxmenu'); m.dataset.menu = 'tabs-more';
    // v2.6.12: one line per title (ellipsis) + the full name in a tooltip; the active board (if hidden) is highlighted
    [...m.querySelectorAll('.mi')].forEach((x, i) => { const b = this._hidden[i]; x.dataset.board = b.id; x.setAttribute('role', 'menuitem'); x.title = b.name; if (b.id === act) x.setAttribute('aria-current', 'page'); });
    const mr = m.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(r.right - mr.width, innerWidth - mr.width - 8)) + 'px'; // right-aligned under «+N ▾»
    more.setAttribute('aria-expanded', 'true');
    const obs = new MutationObserver(() => { if (m.hidden) { more.setAttribute('aria-expanded', 'false'); obs.disconnect(); } }); obs.observe(m, { attributes: true, attributeFilter: ['hidden'] });
    (m.querySelector('.mi.on') || m.querySelector('.mi'))?.focus();
  },
  init() {
    const { T, zone, more } = this.els(); if (!T || !zone || !more) return;
    more.onclick = () => ($('#ctxmenu').hidden ? this.openMore() : Panels.closeMenu());
    zone.addEventListener('wheel', (e) => {
      if (this.mode !== 'overflow') return;
      e.preventDefault();
      const ns = NyxUI.wheelStart(this.start || 0, e.deltaY, e.deltaX, this.maxStart);
      if (ns !== this.start) { this.start = ns; this.layout({ follow: false }); }
    }, { passive: false });
    // ←/→/Home/End between boards. 2.6.12: an active board that sits in «+N ▾» hands the focus to «+N ▾», and the same
    // keys keep working there (relative to the active board), so the keyboard never gets stuck.
    const nav = (e, i, enter) => {
      const B = Store.state.boards; let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % B.length; else if (e.key === 'ArrowLeft') j = (i - 1 + B.length) % B.length;
      else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = B.length - 1;
      else if (enter && (e.key === 'Enter' || e.key === ' ')) j = i;
      if (j == null) return false;
      e.preventDefault(); e.stopPropagation();
      App.switchBoard(B[j].id); setTimeout(() => ($('#tabs .tab.on:not([hidden])') || $('#tabs-more'))?.focus(), 0);
      return true;
    };
    T.addEventListener('keydown', (e) => {
      const tab = e.target.closest && e.target.closest('.tab'); if (!tab) return;
      const i = Store.state.boards.findIndex((b) => b.id === tab.dataset.board); if (i < 0) return;
      nav(e, i, true);
    });
    // the ctxmenu of «+N»: ↑/↓ move between boards
    $('#ctxmenu').addEventListener('keydown', (e) => {
      if ($('#ctxmenu').dataset.menu !== 'tabs-more' || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const items = [...$('#ctxmenu').querySelectorAll('.mi')]; const k = items.indexOf(document.activeElement);
      e.preventDefault(); e.stopPropagation(); items[(k + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    });
    more.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.openMore(); return; }
      if (!more.classList.contains('has-active')) return;
      const i = Store.state.boards.findIndex((b) => b.id === Store.state.active); if (i >= 0) nav(e, i, false);
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.soon()).observe(zone);
    addEventListener('resize', () => this.soon());
    this.layout({ follow: true });
  },
};

const Flyout = {
  isOpen() { const o = $('#toolopts'); return !!o && !o.hidden && o.classList.contains('flyout'); },
  place() {
    const o = $('#toolopts'); if (!o || o.hidden) return null;
    const btn = $(`#dock .tool[data-tool="${Tools.dockOf ? Tools.dockOf(Tools.cur) : Tools.cur}"]`); if (!btn) return null;
    o.style.maxHeight = 'none'; o.style.left = '0px'; o.style.top = '0px';
    const br = btn.getBoundingClientRect(); const fw = o.offsetWidth, fh = o.offsetHeight;
    const tb = $('#titlebar') ? $('#titlebar').getBoundingClientRect().bottom : 0;
    const p = NyxUI.clampFlyout(br, { w: fw, h: fh }, { left: 0, top: tb, right: innerWidth, bottom: innerHeight }, { margin: 8, gap: 0 });
    o.style.left = p.left + 'px'; o.style.top = p.top + 'px'; o.style.maxHeight = p.maxH ? p.maxH + 'px' : '';
    o.dataset.side = p.side; o.dataset.touch = p.touch ? '1' : '0'; o.classList.toggle('scroll', !!p.maxH);
    return p;
  },
  key(e) {
    if (!this.isOpen()) return false;
    if (!$('#modal').hidden || !$('#palette').hidden) return false;
    if (typeof Browser !== 'undefined' && Browser.isOn?.()) return false;
    const typing = NyxUI.isTyping(e.target) || NyxUI.isTyping(document.activeElement) || !!(typeof Canvas !== 'undefined' && Canvas.editing);
    const items = [...$('#toolopts').querySelectorAll('[data-fk]')];
    const i = NyxUI.flyoutDigit({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey, typing }, true, items.length);
    if (i < 0) return false;
    e.preventDefault(); e.stopPropagation(); items[i].click(); return true;
  },
  init() {
    addEventListener('keydown', (e) => this.key(e), true);
    addEventListener('resize', () => this.place());
    if (this.isOpen()) this.place();
  },
};

const UIStyle = {
  current() { return (Store.state && Store.state.settings && Store.state.settings.uiStyle) || ''; },
  glass() { return NyxUI.glassCheck((Theme.current && Theme.current.vars) || {}); },
  apply() {
    const want = this.current(); const vars = (Theme.current && Theme.current.vars) || {};
    const css = want ? NyxUI.styleCss(want, vars) : '';
    let st = document.getElementById('nyx-ui-style');
    if (!st) { st = document.createElement('style'); st.id = 'nyx-ui-style'; document.head.append(st); }
    st.textContent = css;
    if (want && css) document.body.dataset.uiStyle = want; else delete document.body.dataset.uiStyle;
    document.body.dataset.uiStyleWanted = want;
    if (Flyout.isOpen()) Flyout.place();
  },
  set(id) {
    const S = Store.state.settings;
    if (id) S.uiStyle = id; else delete S.uiStyle; // additive setting: absent = the theme's own look (default)
    Store.save(); this.apply(); Panels.refreshDrawer?.();
  },
  section() {
    const cur = this.current(); const g = this.glass(); const fmt = (n) => (Math.floor(n * 10) / 10).toFixed(1).replace('.', LANG === 'el' ? ',' : '.');
    const btn = (id, label, extra = {}) => h('button', { class: 'ui-style-btn' + (cur === id ? ' on' : ''), type: 'button', 'data-ui-style-pick': id || 'default', 'aria-pressed': cur === id ? 'true' : 'false', onclick: () => this.set(id), ...extra }, label);
    const kids = [btn('', t('v2611.st_default'))];
    for (const s of NyxUI.UI_STYLES) {
      if (s.glass) kids.push(btn(s.id, t(s.key) + ' · ' + fmt(g.min) + ':1', g.ok ? { title: t('v2611.glass_ok', { v0: fmt(g.min) }) } : { disabled: true, title: t('v2611.glass_low', { v0: fmt(g.min) }) }));
      else kids.push(btn(s.id, t(s.key)));
    }
    const wanted = cur && !document.body.dataset.uiStyle;
    return h('div', { class: 'ui-style-sec', 'data-ui-styles': '1' },
      h('h4', {}, t('v2611.st_title')),
      h('p', { class: 'muted small' }, t('v2611.st_help')),
      h('div', { class: 'ui-style-grid' }, ...kids),
      wanted ? h('p', { class: 'warn small', 'data-ui-style-fallback': '1' }, t('v2611.glass_fallback', { v0: fmt(g.min) })) : null);
  },
  init() { addEventListener('nyx-theme', () => this.apply()); this.apply(); },
};

const HubHead = {
  line: '', data: null,
  set(models, max) {
    const r = NyxUI.hubCounts(models, max, t); this.line = r.line; this.data = r;
    for (const el of document.querySelectorAll('[data-st=hub-head]')) {
      el.textContent = r.line; el.dataset.loaded = r.loaded == null ? '' : String(r.loaded); el.dataset.max = r.max == null ? '' : String(r.max); el.dataset.folder = String(r.folder);
    }
    return r;
  },
  el() { return h('div', { class: 'hub-head', 'data-st': 'hub-head', title: t('v2611.hub_head_tip') }, this.line || '…'); },
};

// the Bin's corner: bottom left; on a short window where the dock would reach it, it moves just right of the dock
function look2611PlaceBin() {
  const bc = $('#bin-corner'), d = $('#dock'); if (!bc || !d) return;
  bc.style.left = '';
  const dr = d.getBoundingClientRect(), br = bc.getBoundingClientRect();
  if (dr.bottom > br.top - 8 && dr.right > br.left) bc.style.left = Math.round(dr.right + 8) + 'px';
}
// the Library button in the dock shows when the Library drawer is open (like the mockup)
function look2611MarkLibrary() { const d = $('#drawer'); const on = !!d && !d.hidden && d.dataset.kind === 'library'; $('#dock .tool[data-tool=library]')?.classList.toggle('on', on); }

(function bootLook2611() {
  const go = () => {
    if (typeof Store === 'undefined' || !Store.state || !$('#dock .tool')) return setTimeout(go, 60);
    TabStrip.init(); Flyout.init(); UIStyle.init();
    addEventListener('keydown', (e) => { if (e.key === '/' && typeof Panels !== 'undefined' && Panels.libSlash) Panels.libSlash(e); }, true); // v2.6.12: «/» → Library search
    look2611PlaceBin(); addEventListener('resize', look2611PlaceBin);
    const d = $('#drawer'); if (d) new MutationObserver(look2611MarkLibrary).observe(d, { attributes: true, attributeFilter: ['hidden', 'data-kind'] });
    window.__nyxLook2611 = true;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
