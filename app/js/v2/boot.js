'use strict';
// v2 boot: titlebar buttons, keys, init of v2 modules, viewer mode, desktop stickies restore.
(function () {
  const _init = App.init.bind(App);
  App.init = async function () {
    await _init();
    try { v2Boot(); } catch (e) { console.error('v2 boot', e); toast('⚠️ v2: ' + e.message, { kind: 'err', ms: 8000 }); }
  };
  function tb(id, icon, tip, fn) { const b = h('button', { class: 'tb-btn', id, title: tip, html: iconSvg(icon, 18), onclick: fn }); return b; }
  function v2Boot() {
    const right = $('#titlebar .tb-right'); const before = $('#btn-reminders');
    right.insertBefore(tb('btn-assistant', 'sparkles', t('boot.001'), () => Assistant.toggle()), before);
    right.insertBefore(tb('btn-browser', 'globe', 'Browser (Ctrl+B)', () => Browser.toggle()), before);
    right.insertBefore(tb('btn-store', 'blocks', t('boot.002'), () => PluginStore.open()), before);
    // v2.6.7.1: the wrench «Εργαλεία συστήματος» icon opened Settings (same as Ρυθμίσεις). Tools stay under Ρυθμίσεις → Εργαλεία & διαδρομές and Ctrl+K.
    right.insertBefore(tb('btn-ai', 'cpu', t('boot.004'), () => Hub.open()), before);
    Assistant.init(); Browser.init(); Automations.init();
    PluginStore.refresh().then(() => PluginStore.syncCards()).catch(e => console.warn('plugins', e));
    Extras.lockOverlay();
    if (V2.viewer) {
      document.body.classList.add('viewer'); const b = Store.state.boards.find(b => b.id === V2.viewer); if (b) App.switchBoard(b.id);
      API?.onState?.((text) => { try { const st = V2.migrate(JSON.parse(text)); const keep = Store.state.active; Store.state = st; Store.state.active = keep; Canvas.renderBoard(); } catch (e) {} });
      document.body.append(h('div', { class: 'viewer-badge' }, t('boot.005') + (b?.name || '')));
    } else {
      for (const it of allItems()) if (it.desk?.on) API?.inv('sticky:open', { id: it.id, desk: it.desk });
    }
    window.__nyxV2Ready = true;
    if (!V2.viewer) setTimeout(() => Hub.autoStart().catch(e => console.warn('autostart', e)), 1500); // v2.2: llama/whisper auto-start
  }
  addEventListener('keydown', (e) => {
    const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(); const typing = e.target.closest?.('input,textarea,select,[contenteditable=true]');
    if (c && e.code === 'Space') { e.preventDefault(); e.stopPropagation(); return Assistant.toggle(); }
    if (c && e.shiftKey && k === 'd') { e.preventDefault(); e.stopPropagation(); return Extras.dailyNote(); }
    if (typing) return;
    if (c && !e.shiftKey && k === 'b') { e.preventDefault(); e.stopPropagation(); return Browser.toggle(); }
    if (c && e.shiftKey && k === 'f') { e.preventDefault(); e.stopPropagation(); return Extras.tagFilter(); }
    if (c && e.shiftKey && k === 'p') { e.preventDefault(); e.stopPropagation(); return PluginStore.open(); }
    if (e.key === 'F5' && !c) { e.preventDefault(); e.stopPropagation(); return Extras.present(); }
    if (e.key === 'Escape') { if (!$('#modal').hidden) return; if (!$('#assistant')?.hidden) { e.stopPropagation(); return Assistant.hide(); } if (!$('#browser')?.hidden && !$('#browser').classList.contains('max')) { e.stopPropagation(); return Browser.hide(); } }
  }, true);
})();
// Daily update check (opt-in: Settings → Updates → advanced). Runs 45 s after start, never blocks startup.
setTimeout(async () => {
  try { const U = Store.state.settings.update || {}; if (!U.auto || !U.url || Date.now() - (U.lastCheck || 0) < 864e5) return;
    const r = await API.inv('upd:check', U.url); U.lastCheck = Date.now(); Store.save();
    if (r.ok && r.newer) toast('✨ ' + t('set21.upd_toast', { v: r.latest.version }), { ms: 9000 }); } catch (e) {}
}, 45000);
