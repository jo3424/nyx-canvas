'use strict';
// Built-in browser: <webview> tabs on a persistent partition (logins stay in Electron's session, never read by Nyx).
const PART = 'persist:nyxweb';
const Browser = {
  el: null, tabs: [], cur: null,
  init() {
    this.el = h('div', { id: 'browser', class: 'browser', hidden: true },
      h('div', { class: 'br-tabs', id: 'br-tabs' }),
      h('div', { class: 'br-bar' },
        h('button', { class: 'ib', title: t('browser.001'), html: iconSvg('arrow-left', 17), onclick: () => this.wv()?.canGoBack() && this.wv().goBack() }),
        h('button', { class: 'ib', title: t('browser.002'), html: iconSvg('arrow-right', 17), onclick: () => this.wv()?.canGoForward() && this.wv().goForward() }),
        h('button', { class: 'ib', id: 'br-reload', title: t('browser.003'), html: iconSvg('rotate-cw', 17), onclick: () => this.wv()?.reload() }),
        h('button', { class: 'ib', title: t('store.001'), html: iconSvg('house', 17), onclick: () => this.nav(Store.state.settings.browser.home) }),
        h('form', { class: 'br-addr', onsubmit: (e) => { e.preventDefault(); delete $('#br-url').dataset.dirty; this.nav($('#br-url').value); } }, h('span', { id: 'br-lock', html: iconSvg('lock', 13) }), h('input', { id: 'br-url', class: 'inp', spellcheck: 'false', oninput: (e) => { e.target.dataset.dirty = '1'; }, placeholder: t('browser.004'), onkeydown: (e) => e.stopPropagation(), onfocus: (e) => e.target.select() })),
        h('button', { class: 'btn sm', title: t('browser.005'), onclick: () => this.pin() }, iconSvg('pin', 15), t('browser.006')),
        h('button', { class: 'ib', title: t('browser.007'), html: iconSvg('camera', 17), onclick: () => this.screenshot() }),
        h('button', { class: 'ib', title: t('browser.008'), html: iconSvg('scissors', 17), onclick: () => this.clip() }),
        h('button', { class: 'ib', title: t('browser.009'), html: iconSvg('radar', 17), onclick: () => this.track() }),
        h('button', { class: 'ib', title: t('browser.010'), html: iconSvg('sparkles', 17), onclick: () => this.summarize() }),
        h('button', { class: 'ib', title: t('browser.011'), html: iconSvg('ellipsis-vertical', 17), onclick: (e) => this.more(e) }),
        h('button', { class: 'ib', id: 'br-min', title: t('v23.br_min'), html: iconSvg('minus', 17), onclick: () => this.minimize() }),
        h('button', { class: 'ib', id: 'br-max', title: t('browser.012'), html: iconSvg('maximize-2', 17), onclick: () => this.toggleMax() }),
        h('button', { class: 'ib', title: t('assistant.064'), html: iconSvg('x', 17), onclick: () => this.hide() })),
      h('div', { class: 'br-prog', id: 'br-prog' }),
      h('div', { class: 'br-views', id: 'br-views' }),
      h('div', { class: 'br-resize', onpointerdown: (e) => this.resize(e) }));
    document.body.append(this.el);
    API?.onBrowserNewTab?.((url) => this.open(url));
    API?.onBrowserKey?.((e) => this.key(e));
    this.addBtn = h('button', { class: 'br-tab add', id: 'br-add', title: t('v23.br_new') + ' (Ctrl+T)', html: iconSvg('plus', 15), onclick: () => this.newTab(Store.state.settings.browser.home, true, true) });
    $('#br-tabs').append(this.addBtn);
    this.pill = h('button', { class: 'br-pill', id: 'br-pill', hidden: true, title: t('v23.br_restore'), onclick: () => this.show() }, h('span', { html: iconSvg('globe', 15) }), h('span', { class: 'tt' }), h('span', { class: 'x', title: t('assistant.064'), html: iconSvg('x', 12), onclick: (e) => { e.stopPropagation(); this.closeAll(); } }));
    document.body.append(this.pill);
    API?.onBrowserDownload?.((d) => toast('⬇️ ' + d.name, { ms: 8000, action: { label: t('browser.013'), fn: () => Features.importPaths([d.path], Canvas.center()) } }));
    const saved = Store.state.settings.browser.tabs || []; this._restore = saved.slice(0, 12);
  },
  wv() { return this.cur?.wv; },
  // v2.3: keyboard (from the page via main's before-input-event, or from the app while the browser is on top)
  isOn() { return !!this.el && !this.el.hidden && this.el.classList.contains('in'); },
  key({ k, shift, alt }) {
    if (!this.isOn()) return false;
    if (k === 't') { this.newTab(Store.state.settings.browser.home, true, true); return true; }
    if (k === 'w') { if (this.cur) this.close(this.cur); return true; }
    if (k === 'l') { const i = $('#br-url'); i.focus(); i.select(); return true; }
    if (k === 'tab') { if (this.tabs.length > 1) { const i = this.tabs.indexOf(this.cur); this.select(this.tabs[(i + (shift ? -1 : 1) + this.tabs.length) % this.tabs.length]); } return true; }
    if (k === 'r' || k === 'f5') { this.wv()?.reload(); return true; }
    if (alt && k === 'arrowleft') { this.wv()?.canGoBack() && this.wv().goBack(); return true; }
    if (alt && k === 'arrowright') { this.wv()?.canGoForward() && this.wv().goForward(); return true; }
    return false;
  },
  minimize() { this.hide(true); },
  toggleMax() { const m = this.el.classList.toggle('max'); const b = $('#br-max'); b.innerHTML = iconSvg(m ? 'minimize-2' : 'maximize-2', 17); b.title = m ? t('v23.br_unmax') : t('browser.012'); },
  closeAll() { for (const tb of [...this.tabs]) { tb.wv.remove(); tb.btn.remove(); } this.tabs = []; this.cur = null; this._restore = null; this.pill.hidden = true; this.hide(); this.persist(); },
  syncPill() { if (!this.pill) return; this.pill.querySelector('.tt').textContent = (this.cur?.title || t('browser.014')) + (this.tabs.length > 1 ? ` +${this.tabs.length - 1}` : ''); },
  show() { if (this.pill) this.pill.hidden = true; if (!this.tabs.length) { if (this._restore?.length) { this._restore.forEach(u => this.newTab(u, false)); this._restore = null; this.select(this.tabs[0]); } else this.newTab(Store.state.settings.browser.home); } this.el.hidden = false; requestAnimationFrame(() => this.el.classList.add('in')); $('#btn-browser')?.classList.add('on'); },
  hide(min) { if (this.pill) { this.pill.hidden = !(min && this.tabs.length); this.syncPill(); } this.el.classList.remove('in'); $('#btn-browser')?.classList.remove('on'); setTimeout(() => { if (!this.el.classList.contains('in')) this.el.hidden = true; }, 200); },
  toggle() { this.el.hidden ? this.show() : this.hide(); },
  open(url) { const t = this.newTab(this.fix(url)); this.show(); return t; },
  fix(u) { u = String(u || '').trim(); if (!u) return Store.state.settings.browser.home; if (/^https?:\/\//i.test(u) || /^about:/.test(u)) return u; if (/^[\w-]+(\.[\w-]+)+(\/|$|:)/.test(u) && !/\s/.test(u)) return 'https://' + u; return Store.state.settings.browser.search.replace('%s', encodeURIComponent(u)); },
  nav(u) { const url = this.fix(u); if (!this.cur) return this.open(url); this.cur.wv.loadURL(url).catch(() => {}); },
  newTab(url, sel = true, focusUrl = false) {
    const wv = h('webview', { partition: PART, src: url || 'about:blank', allowpopups: '', webpreferences: 'contextIsolation=yes' });
    const tab = { id: uid(), wv, title: hostOf(url) || t('browser.014'), url, icon: '' };
    tab.btn = h('div', { class: 'br-tab', title: tab.title }, h('img', { class: 'fav' }), h('span', { class: 'tt' }, tab.title), h('button', { class: 'ib x', title: t('assistant.064') + ' (Ctrl+W)', html: iconSvg('x', 12), onclick: (e) => { e.stopPropagation(); this.close(tab); } }));
    tab.btn.onclick = () => this.select(tab); tab.btn.onauxclick = (e) => { if (e.button === 1) this.close(tab); };
    wv.addEventListener('page-title-updated', (e) => { tab.title = e.title; tab.btn.querySelector('.tt').textContent = e.title; tab.btn.title = e.title; if (tab === this.cur) this.syncPill(); });
    wv.addEventListener('page-favicon-updated', (e) => { tab.icon = e.favicons[0]; const f = tab.btn.querySelector('.fav'); f.onerror = () => { f.removeAttribute('src'); }; f.src = rimg(tab.icon); });
    wv.addEventListener('did-navigate', (e) => { tab.url = e.url; if (tab === this.cur) this.syncBar(); this.persist(); });
    wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { tab.url = e.url; if (tab === this.cur) this.syncBar(); } });
    wv.addEventListener('did-start-loading', () => { if (tab === this.cur) $('#br-prog').classList.add('on'); });
    wv.addEventListener('did-stop-loading', () => { if (tab === this.cur) $('#br-prog').classList.remove('on'); });
    wv.addEventListener('did-fail-load', (e) => { if (e.errorCode !== -3 && e.isMainFrame) toast('🌐 ' + e.errorDescription + ' · ' + hostOf(e.validatedURL)); });
    $('#br-tabs').insertBefore(tab.btn, this.addBtn || null); $('#br-views').append(wv); this.tabs.push(tab);
    if (sel) this.select(tab); this.persist();
    if (focusUrl) { if (this.el.hidden) this.show(); setTimeout(() => { const i = $('#br-url'); i.focus(); i.select(); }, 60); }
    tab.btn.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }); return tab;
  },
  select(tab) { this.cur = tab; for (const t of this.tabs) { t.wv.classList.toggle('on', t === tab); t.btn.classList.toggle('on', t === tab); } this.syncBar(); this.syncPill(); tab?.btn.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }); $('#br-prog')?.classList.remove('on'); },
  close(tab) { const i = this.tabs.indexOf(tab); if (i < 0) return; this.tabs.splice(i, 1); tab.wv.remove(); tab.btn.remove(); if (this.cur === tab) this.cur = null; if (this.tabs.length) this.select(this.tabs[Math.max(0, i - 1)]); else this.hide(); this.persist(); },
  syncBar() { const u = this.cur?.url || ''; const i = $('#br-url'); if (document.activeElement !== i || !i.dataset.dirty) { i.value = u; delete i.dataset.dirty; } $('#br-lock').classList.toggle('insecure', /^http:/.test(u)); },
  persist: debounce(function () { Store.state.settings.browser.tabs = Browser.tabs.map(t => t.url).filter(u => /^https?:/.test(u || '')); Store.save(); }, 800),
  resize(e) { const start = e.clientX, w0 = this.el.offsetWidth; const mv = (ev) => { this.el.style.width = clamp(w0 + (start - ev.clientX), 380, innerWidth - 60) + 'px'; }; const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); this.el.classList.remove('resizing'); }; this.el.classList.add('resizing'); addEventListener('pointermove', mv); addEventListener('pointerup', up); },
  wcId() { const wv = this.wv(); if (!wv) throw new Error(t('browser.015')); return wv.getWebContentsId(); },
  async snap() { const r = await API.inv('web:capture', this.wcId()); return r; },
  async pin(asLive) {
    try { const t = this.cur; const s = await this.snap(); const w = 520, hh = Math.round(w * Math.min(1.4, s.h / s.w)) + 40; const p = Cmd.freeSpot(w, hh);
      const it = Features.addAt({ type: 'web', url: t.url, title: t.title, favicon: t.icon, snap: s.file, snapAt: Date.now(), live: !!asLive, w, h: hh }, p.x, p.y); toast('📌 ' + t.title); return it; } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); }
  },
  async screenshot() { try { const s = await this.snap(); const sc = Math.min(1, 560 / s.w); const p = Cmd.freeSpot(s.w * sc, s.h * sc); const it = Features.addAt({ type: 'image', file: s.file, name: (this.cur.title || 'screenshot') + '.png', caption: hostOf(this.cur.url), source: this.cur.url, w: s.w * sc, h: s.h * sc }, p.x, p.y); toast(t('browser.016')); return it; } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); } },
  async clip() { try { const r = await API.inv('web:selection', this.wcId()); if (!r.text?.trim()) return toast(t('browser.017')); const html = sanitize(r.html || esc(r.text)) + `<br><a href="${esc(r.url)}">— ${esc(r.title || hostOf(r.url))}</a>`; const p = Cmd.freeSpot(420, 200); Features.addAt({ type: 'text', w: 420, h: 60, html: `<blockquote>${html}</blockquote>`, size: 15, bg: 'var(--card)', source: r.url, tags: ['clip'] }, p.x, p.y); toast(t('browser.018')); } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); } },
  track() { const t = this.cur; if (!t) return; const c = Canvas.center(); Features.newTracker({ x: c.x, y: c.y, url: t.url, session: true }, null); },
  async summarize() { try { const r = await API.inv('web:pageText', this.wcId()); toast(t('browser.019')); const s = await AI.text('summarize', t('browser.020', { title: r.title, url: r.url, v2: r.text.slice(0, 14000) })); const p = Cmd.freeSpot(440, 260); Features.addAt({ type: 'text', w: 440, h: 60, html: md(t('browser.021', { title: r.title, s, url: r.url })), size: 15, bg: 'var(--card)', source: r.url }, p.x, p.y); } catch (e) { toast('⚠️ ' + e.message, { kind: 'err', ms: 6000 }); } },
  more(e) { const I = (n) => iconSvg(n, 15); Panels.menu(e.clientX, e.clientY, [
    [I('square-plus'), t('browser.022'), () => this.pin(true)], [I('file-text'), t('browser.023'), async () => { const r = await API.inv('web:pageText', this.wcId()); const p = Cmd.freeSpot(460, 300); Features.addAt({ type: 'text', w: 460, h: 60, html: `<b>${esc(r.title)}</b><br>${esc(r.text.slice(0, 4000)).replace(/\n/g, '<br>')}`, size: 14, bg: 'var(--card)', source: r.url }, p.x, p.y); }],
    [I('link'), t('browser.024'), () => Features.addLinkUrl(this.cur.url)], [I('external-link'), t('browser.025'), () => API.openExternal(this.cur.url)], [I('search-code'), 'DevTools', () => this.wv()?.openDevTools()], '-',
    [I('house'), t('browser.026'), () => { Store.state.settings.browser.home = this.cur.url; Store.save(); toast('🏠 ✓'); }],
    [I('trash-2'), t('browser.027'), () => Panels.modal(t('browser.028'), h('p', {}, t('browser.029')), { okLabel: t('panels.054'), ok: async () => { await API.inv('web:clearSession'); toast('🧹 ✓'); this.tabs.forEach(t => t.wv.reload()); } }), 'danger']]); },
};
// web card renderer
Items.R.web = function (n, it) {
  const live = it.live && !V2.viewer;
  n.innerHTML = t('browser.030', { v0: live ? 'is-live' : '', v1: esc(rimg(it.favicon || '')), v2: esc(it.title || hostOf(it.url)), v3: live ? t('browser.031') : t('browser.032'), v4: iconSvg(live ? 'image' : 'radio', 13), v5: iconSvg('refresh-cw', 13), v6: iconSvg('globe', 13), v7: live ? '' : `<img draggable="false" src="${esc(Store.media(it.snap))}">`, v8: live ? '' : `<div class="wc-foot">${esc(hostOf(it.url))} · ${it.snapAt ? fmtDate(it.snapAt) : ''}</div>` });
  if (live) { const wv = h('webview', { class: 'live', partition: PART, src: it.url, webpreferences: 'contextIsolation=yes' }); n.querySelector('.wc-body').append(wv); }
};
TYPE_ICON.web = 'globe'; TYPE_ICON.plugin = 'puzzle'; TYPE_ICON.pomodoro = 'timer';
async function refreshWebSnap(it) {
  toast('🔄 ' + hostOf(it.url));
  try { const r = await API.inv('web:renderText', it.url, { session: true, capture: true }); if (r.file) { Store.change(() => { it.snap = r.file; it.snapAt = Date.now(); it.pageText = (r.text || '').slice(0, 20000); }); Items.mount(it); } } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); }
}
