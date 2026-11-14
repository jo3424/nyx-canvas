'use strict';
// v2.6.10 — links inside cards (<a href> in notes, «Πηγές», or a plain https://… written in a note).
// Click → a new tab in the Nyx browser (webview, partition persist:nyxweb, same restrictions as every Nyx tab).
// Ctrl/⌘+click, or the context menu → «Άνοιγμα στον κανονικό browser». http(s) only. A click on a link never starts a
// card drag or an edit. While a card is being edited the link is just text (the click places the caret).
const Links = {
  URL_RE: /https?:\/\/[^\s<>"'«»]+/g,
  ok(u) { try { const x = new URL(String(u)); return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : null; } catch (e) { return null; } },
  // the link under the pointer inside a card (not while that card is being edited), or null
  at(e) {
    const node = e.target && e.target.closest && e.target.closest('.item'); if (!node) return null;
    if (Canvas.editing && node.dataset.id === Canvas.editing) return null;
    if (e.target.closest('[contenteditable=true]')) return null;
    const a = e.target.closest('a[href]');
    if (a && node.contains(a)) { const u = this.ok(a.getAttribute('href')); return u ? { url: u, el: a, node } : (/^mailto:/i.test(a.getAttribute('href') || '') ? { url: null, mail: true, el: a, node } : null); }
    // a plain URL written in the text of a note: find the word under the pointer
    if (!e.target.closest('.txt')) return null;
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (!r || !r.startContainer || r.startContainer.nodeType !== 3 || !node.contains(r.startContainer)) return null;
    const text = r.startContainer.textContent || ''; const off = r.startOffset;
    this.URL_RE.lastIndex = 0; let m;
    while ((m = this.URL_RE.exec(text))) {
      const s = m.index, en = s + m[0].replace(/[.,;:!?)\]]+$/, '').length;
      if (off >= s && off <= en) {
        // make sure the pointer is really over the characters (caretRangeFromPoint snaps to the nearest one)
        const rr = document.createRange(); rr.setStart(r.startContainer, s); rr.setEnd(r.startContainer, en);
        const hit = [...rr.getClientRects()].some((b) => e.clientX >= b.left - 1 && e.clientX <= b.right + 1 && e.clientY >= b.top - 1 && e.clientY <= b.bottom + 1);
        if (!hit) return null;
        const u = this.ok(text.slice(s, en)); return u ? { url: u, node } : null;
      }
    }
    return null;
  },
  openNyx(url) { const u = this.ok(url); if (!u) return false; if (typeof Browser === 'undefined' || !Browser.open) { API?.openExternal(u); return 'external'; } Browser.open(u); this.last = { url: u, where: 'nyx', at: Date.now() }; return 'nyx'; },
  openSystem(url) { const u = this.ok(url); if (!u) return false; API?.openExternal(u); this.last = { url: u, where: 'external', at: Date.now() }; return 'external'; },
  // pointerdown on a link: no select / drag / edit. Opens on release if the pointer did not travel.
  down(e) {
    const L = this.at(e); if (!L) return false;
    if (L.mail) return false; // mailto: keeps the old behaviour (system mail app via the main process)
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ext = e.ctrlKey || e.metaKey;
    const up = (ev) => { removeEventListener('pointerup', up, true); if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) return; ext ? this.openSystem(L.url) : this.openNyx(L.url); };
    addEventListener('pointerup', up, true);
    return true;
  },
  menu(e) {
    const L = this.at(e); if (!L || !L.url) return false;
    e.preventDefault(); e.stopPropagation();
    const I = (n) => iconSvg(n, 15);
    Panels.menu(e.clientX, e.clientY, [
      [I('globe'), t('v2610.link_open_nyx'), () => this.openNyx(L.url)],
      [I('external-link'), t('v2610.link_open_system'), () => this.openSystem(L.url), '', 'Ctrl+click'],
      [I('copy'), t('v2610.link_copy'), () => { try { navigator.clipboard.writeText(L.url); toast('📋 ' + L.url); } catch (err) {} }],
    ]);
    return true;
  },
  init() {
    const vp = $('#viewport'); if (!vp || this._on) return; this._on = true;
    vp.addEventListener('pointerdown', (e) => { if (e.button === 0) this.down(e); else if (e.button === 1 && this.at(e)?.url) { e.preventDefault(); e.stopPropagation(); this.openNyx(this.at(e).url); } }, true);
    vp.addEventListener('contextmenu', (e) => this.menu(e), true);
    // the browser's own navigation of an <a> in a card never happens (the main process would send it outside)
    vp.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('.item a[href]'); if (a && !e.target.closest('[contenteditable=true]') && !/^mailto:/i.test(a.getAttribute('href') || '')) { e.preventDefault(); } }, true);
    vp.addEventListener('dblclick', (e) => { if (this.at(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
    vp.addEventListener('auxclick', (e) => { if (e.button === 1 && e.target.closest && e.target.closest('.item a[href]')) e.preventDefault(); }, true);
  },
};
window.Links = Links;
