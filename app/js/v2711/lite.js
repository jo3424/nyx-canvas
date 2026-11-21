'use strict';
// v2.7.1.1 «Ελαφρύ Nyx» — loaded FIRST, before every other script.
// (1) Knows whether Nyx is on screen. The app window runs with backgroundThrottling:false (main.js, unchanged), so
//     document.hidden stays false when the window is minimized or sent to the tray. The signals used here, all renderer-side:
//       · 'hidden' — document.visibilityState (if Chromium ever reports it)
//       · 'tray'   — main sends 'state:flush' right before it hides the window to the tray; cleared on focus / input
//       · 'stall'  — minimized / fully covered: a requested frame does not arrive for 3 s while timers fire, or two frames in a
//                    row arrive > 700 ms late (Chromium's ~1 fps for hidden windows); probed on timer ticks and by a 1 Hz check
//                    while Nyx has no focus; cleared by the next fast frame
//       · 'min'    — Windows parks a minimized window at -32000,-32000 (checked once, 0,4 s after the window loses focus)
// (2) While Nyx is off screen and nothing works in the background (no LLM reply / image / video), every setInterval stops,
//     setTimeout callbacks ≥ 100 ms and requestAnimationFrame callbacks wait, and they all continue when Nyx is back
//     (a missed interval runs once). Exceptions (NyxLite.keep): a running Pomodoro and enabled time automations.
// (3) «Ελαφριά εμφάνιση» (settings.liteMode: 'always' | 'auto' (default) | 'never'): body.nyx-lite → no blur, still background.
//     In «Αυτόματα» it is on while something heavy runs: NyxLite.begin('llm' | 'image' | 'video' | …) → end().
(function () {
  const W = window;
  const RT = { st: W.setTimeout.bind(W), ct: W.clearTimeout.bind(W), si: W.setInterval.bind(W), ci: W.clearInterval.bind(W), raf: W.requestAnimationFrame.bind(W), caf: W.cancelAnimationFrame.bind(W) };
  const now = () => (W.performance && performance.now()) || Date.now();
  const IV_BASE = 1e9; let ivSeq = 0;
  const ivs = new Map();            // our interval id → { fn, ms, args, real, keep, pausedAt }
  const lateT = new Map();          // real timeout id → callback that fired while paused
  const lateR = new Map();          // real rAF id → callback that fired while paused
  const reasons = new Set();
  const busy = new Map(); let busySeq = 0;
  const subs = new Set();
  let wasPaused = false, wasLite = null;
  const safe = (f) => { try { return !!f(); } catch (e) { return false; } };
  const isPaused = () => reasons.size > 0 && busy.size === 0;
  function mode() { try { const m = typeof Store !== 'undefined' && Store && Store.state && Store.state.settings && Store.state.settings.liteMode; /* Store is a top-level const, not window.Store */ return m === 'always' || m === 'never' ? m : 'auto'; } catch (e) { return 'auto'; } }
  const isLite = () => { const m = mode(); return m === 'always' || (m === 'auto' && busy.size > 0); };
  // ---------- timers ----------
  function arm(o) { if (!o.real) o.real = RT.si(() => { if (o.keep && isPaused() && !safe(o.keep)) { RT.ci(o.real); o.real = 0; o.pausedAt = now(); return; } o.fn.apply(W, o.args); probe(); }, o.ms); } // a kept interval stops once its reason ends (Pomodoro finished while minimized)
  W.setInterval = function (fn, ms, ...args) {
    if (typeof fn !== 'function') return RT.si(fn, ms, ...args);
    const id = IV_BASE + (++ivSeq); const o = { fn, ms: Math.max(0, +ms || 0), args, real: 0, keep: null, pausedAt: 0 };
    ivs.set(id, o); if (isPaused()) o.pausedAt = now(); else arm(o); return id;
  };
  function clearAny(id) {
    const o = ivs.get(id); if (o) { if (o.real) RT.ci(o.real); ivs.delete(id); return; }
    lateT.delete(id); RT.ct(id); RT.ci(id);
  }
  W.clearInterval = clearAny; W.clearTimeout = clearAny;
  W.setTimeout = function (fn, ms, ...args) {
    if (typeof fn !== 'function') return RT.st(fn, ms, ...args);
    const d = +ms || 0; let id = 0;
    id = RT.st(() => { if (d >= 100 && isPaused()) { lateT.set(id, () => fn.apply(W, args)); return; } fn.apply(W, args); probe(); }, d);
    return id;
  };
  W.requestAnimationFrame = function (cb) { let id = 0; id = RT.raf((t) => { if (isPaused()) { lateR.set(id, cb); return; } cb(t); }); return id; };
  W.cancelAnimationFrame = function (id) { lateR.delete(id); RT.caf(id); };
  // ---------- frames stop arriving → off screen ----------
  // A requested frame normally arrives within ~16 ms. Minimized / covered, Chromium either stops frames (none for 3 s while
  // timers fire) or slows them to ~1 per second (seen under X11): two slow frames in a row (> 700 ms each) also mean off screen.
  // While stalled a frame chain keeps asking (at the compositor's slow rate, or not at all); the first fast frame (≤ 120 ms) resumes.
  let pr = null, slow = 0;
  function frameBack() {
    const lat = now() - pr.at; pr = null;
    if (lat <= 120) { slow = 0; drop('stall'); return; }
    if (lat > 700 && ++slow >= 2) add('stall');
    if (reasons.has('stall') || slow) probe(true);
  }
  function probe(chain) {
    const t = now();
    if (!pr) { pr = { at: t, n: 0 }; RT.raf(frameBack); return; }
    if (chain === true || reasons.has('stall')) return;
    pr.n++; if (t - pr.at > 3000 && pr.n >= 2) add('stall');
  }
  // ---------- pause / resume ----------
  function sync() {
    const p = isPaused();
    if (p !== wasPaused) {
      wasPaused = p; const t = now();
      if (p) { for (const o of ivs.values()) { if (o.keep && safe(o.keep)) continue; if (o.real) { RT.ci(o.real); o.real = 0; } o.pausedAt = t; } }
      else {
        let k = 0;
        for (const o of ivs.values()) { if (o.real) continue; arm(o); if (o.pausedAt && t - o.pausedAt >= o.ms) RT.st(() => { try { o.fn.apply(W, o.args); } catch (e) { console.error(e); } }, 20 + 15 * (k++)); o.pausedAt = 0; }
        const T = [...lateT.values()]; lateT.clear(); T.forEach((f, i) => RT.st(() => f(), 10 + 5 * i));
        const R = [...lateR.values()]; lateR.clear(); if (R.length) RT.raf((ts) => R.forEach((f) => { try { f(ts); } catch (e) { console.error(e); } }));
      }
    }
    applyLite();
    for (const f of subs) { try { f(api.state()); } catch (e) { console.error(e); } }
  }
  // while Nyx has no focus (minimizing always takes it), a 1 Hz frame check finds a stall within ~5 s; it stops on focus or once stalled
  let watch = 0;
  const watchOn = (force) => { if (!watch && !reasons.has('stall') && (force || !document.hasFocus())) watch = RT.si(probe, 1000); };
  const watchOff = () => { if (watch) { RT.ci(watch); watch = 0; } };
  function add(r) { if (r === 'stall') watchOff(); if (!reasons.has(r)) { reasons.add(r); sync(); } }
  function drop(r) { if (reasons.delete(r)) { sync(); if (r === 'stall') watchOn(); } }
  function applyLite() {
    const on = isLite(); const b = document.body; if (!b) return;
    if (on !== wasLite || b.classList.contains('nyx-lite') !== on) { wasLite = on; b.classList.toggle('nyx-lite', on); }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') add('hidden'); else { drop('hidden'); drop('tray'); } });
  const back = () => { drop('tray'); drop('min'); };
  W.addEventListener('focus', () => { watchOff(); back(); }); W.addEventListener('pointerdown', back, true); W.addEventListener('keydown', back, true); W.addEventListener('mousemove', back, true);
  W.addEventListener('blur', () => { watchOn(true); RT.st(() => { if (!document.hasFocus() && W.screenX <= -30000 && W.screenY <= -30000) add('min'); }, 400); });
  try { if (W.nyxAPI && typeof nyxAPI.onFlush === 'function') nyxAPI.onFlush(() => add('tray')); } catch (e) {}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyLite()); else applyLite();
  // ---------- public API ----------
  const api = {
    get paused() { return isPaused(); },
    get lite() { return isLite(); },
    get offscreen() { return reasons.size > 0; },
    mode,
    state() { return { paused: isPaused(), lite: isLite(), mode: mode(), reasons: [...reasons], busy: [...busy.values()] }; },
    // the hook for heavy work (LLM reply today; image / video generation later): const end = NyxLite.begin('image'); … end();
    begin(kind) { const id = ++busySeq; busy.set(id, String(kind || 'work')); sync(); let done = false; return () => { if (done) return; done = true; busy.delete(id); sync(); }; },
    async run(kind, work) { const end = api.begin(kind); try { return await (typeof work === 'function' ? work() : work); } finally { end(); } },
    // an interval that must keep running off screen while pred() is true (Pomodoro, time automations)
    keep(id, pred) { const o = ivs.get(id); if (o) o.keep = typeof pred === 'function' ? pred : () => true; return id; },
    onChange(f) { subs.add(f); return () => subs.delete(f); },
    apply() { sync(); },
    // a panel's poller should stop once its element is gone or its drawer is closed (hidden)
    alive(el) { return !!(el && el.isConnected && !el.closest('[hidden]')); },
    _test: { add, drop, reasons, ivs, lateT, lateR, RT, get watch() { return watch; } }
  };
  W.NyxLite = api;
})();
