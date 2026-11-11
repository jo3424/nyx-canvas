'use strict';
// v2.6.8.2 — logs can be copied: mouse selection, Ctrl+C, Ctrl+A (only the focused log), and «Αντιγραφή όλων».
// The canvas shortcuts (Ctrl+C copies cards, Ctrl+A selects all cards) no longer swallow these keys inside a log
// or while text outside the canvas is selected.
(function (root) {
  const SEL = 'pre.srv-log, pre.logs, [data-logcopy]';
  // Pure decision, unit-tested: what a key press should do.
  // ctx: { key, ctrl, inLog (focus/target inside a log), selText (selected text), selInCanvasItem (selection is inside a card) }
  function decide(ctx) {
    if (!ctx || !ctx.ctrl) return ctx && ctx.inLog && ctx.key !== 'escape' ? 'pass' : null;
    const k = String(ctx.key || '').toLowerCase();
    const hasSel = !!(ctx.selText && String(ctx.selText).length) && !ctx.selInCanvasItem;
    if (k === 'c') { if (hasSel) return 'native'; if (ctx.inLog) return 'copyAll'; return null; }
    if (k === 'a') return ctx.inLog ? 'selectLog' : null;
    if (ctx.inLog) return 'pass';
    return null;
  }
  const api = { SEL, decide };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  const LogCopy = root.LogCopy = Object.assign(api, {
    logOf(node) { const el = node && (node.nodeType === 1 ? node : node.parentElement); return el && el.closest ? el.closest(SEL) : null; },
    async copy(pre, btn) {
      const text = String(pre.textContent || '');
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
        try { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); ok = document.execCommand('copy'); } catch (e2) {}
      }
      if (ok) toast('📋 ' + t('v2682.copied', { n: text ? text.split('\n').length : 0 }), { ms: 1800 });
      else toast('⚠️ ' + t('v2682.copy_fail'), { kind: 'err' });
      if (btn) { btn.classList.add('done'); setTimeout(() => btn.classList.remove('done'), 900); }
      return ok;
    },
    selectAll(pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); },
    decorate(pre) {
      if (!pre || pre.dataset.lc === '1') return;
      pre.dataset.lc = '1';
      if (!pre.hasAttribute('tabindex')) pre.tabIndex = 0;
      const sib = pre.nextElementSibling; // the plugin «show text» dialog already has its own copy button
      if (sib && sib.tagName === 'BUTTON' && (sib.textContent || '').trim() === t('v26.copy')) return;
      const btn = h('button', { class: 'btn sm ghost log-copy', type: 'button', title: t('v2682.copy_all') }, iconSvg('copy', 13), ' ' + t('v2682.copy_all'));
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.copy(pre, btn); });
      pre.after(btn);
    },
    scan(rootEl) { if (!rootEl || !rootEl.querySelectorAll) return; if (rootEl.matches && rootEl.matches(SEL)) this.decorate(rootEl); rootEl.querySelectorAll(SEL).forEach(p => this.decorate(p)); },
    // Called from App.keys() before the canvas shortcuts. true = handled / let the browser do it.
    key(e) {
      const sel = getSelection();
      const selText = sel && !sel.isCollapsed ? String(sel) : '';
      const anchor = sel && sel.anchorNode;
      const aEl = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
      const inLogEl = this.logOf(e.target) || (document.activeElement && this.logOf(document.activeElement));
      const act = decide({ key: e.key, ctrl: e.ctrlKey || e.metaKey, inLog: !!inLogEl, selText, selInCanvasItem: !!(aEl && aEl.closest && aEl.closest('.item')) });
      if (!act) return false;
      if (act === 'native' || act === 'pass') return true;
      if (act === 'selectLog') { e.preventDefault(); this.selectAll(inLogEl); return true; }
      if (act === 'copyAll') { e.preventDefault(); this.copy(inLogEl); return true; }
      return false;
    },
    init() {
      this.scan(document.body);
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) this.scan(n); }).observe(document.body, { childList: true, subtree: true });
    },
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => LogCopy.init()); else LogCopy.init();
})(typeof window !== 'undefined' ? window : globalThis);
