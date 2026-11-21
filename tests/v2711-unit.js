'use strict';
// v2.7.1.1 unit tests — «Ελαφρύ Nyx» + widget drag, static side.
// (α) NyxLite (app/js/v2711/lite.js) in a sandbox with a fake clock: pause / resume of intervals, deferred timeouts / frames,
//     keep(), stall detection, tray flush, Windows minimized position, liteMode always / auto / never, begin()/end() hook.
// (β) static guards vs 2.7.1 (28bcceb): no main-process file changed (main.js, main/*, preload.js), unpacked hashes unchanged,
//     no new URL, no spawn, Electron 45.2.3, models / router / ctx untouched, lite.js first, lucide subset up to date,
//     perf panel every 10 s, locale keys, existing settings kept.
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };
const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return null; } };

function sandbox(opts = {}) {
  let clock = 0, seq = 0; const T = new Map(); const F = new Map(); const L = {}; const D = {};
  const addL = (o, ev, f) => { (o[ev] = o[ev] || []).push(f); };
  const fire = (o, ev, e = {}) => (o[ev] || []).forEach((f) => f(e));
  const classes = new Set();
  const doc = { visibilityState: 'visible', readyState: 'complete', hasFocus: () => !!opts.focus, addEventListener: (ev, f) => addL(D, ev, f), body: { classList: { contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } } };
  let flushCb = null;
  const W = {
    screenX: 100, screenY: 80, document: doc, performance: { now: () => clock }, console,
    setTimeout: (fn, ms, ...a) => { const id = ++seq; T.set(id, { at: clock + (+ms || 0), fn, a }); return id; },
    clearTimeout: (id) => T.delete(id),
    setInterval: (fn, ms, ...a) => { const id = ++seq; T.set(id, { at: clock + ms, fn, a, every: ms }); return id; },
    clearInterval: (id) => T.delete(id),
    requestAnimationFrame: (cb) => { const id = ++seq; F.set(id, cb); return id; },
    cancelAnimationFrame: (id) => F.delete(id),
    addEventListener: (ev, f) => addL(L, ev, f),
    nyxAPI: { onFlush: (f) => { flushCb = f; } },
    Store: { state: { settings: {} } }
  };
  W.window = W;
  const ctx = vm.createContext(W);
  vm.runInContext(read('app/js/v2711/lite.js'), ctx);
  const run = (ms) => { const end = clock + ms; for (;;) { let n = null; for (const [id, t] of T) if (t.at <= end && (!n || t.at < n[1].at)) n = [id, t]; if (!n) break; const [id, t] = n; clock = t.at; if (t.every) t.at += t.every; else T.delete(id); t.fn(...t.a); } clock = end; };
  const frame = () => { for (let i = 0; i < 3 && F.size; i++) { const cbs = [...F.values()]; F.clear(); cbs.forEach((cb) => cb(clock)); } }; // a compositor on screen: follow-up frames arrive at once
  const frame1 = () => { const cbs = [...F.values()]; F.clear(); cbs.forEach((cb) => cb(clock)); }; // one throttled frame, nothing after it
  return { W, N: W.NyxLite, run, frame, frame1, fire: (ev, e) => fire(L, ev, e), fireDoc: (ev) => fire(D, ev), doc, classes, flush: () => flushCb && flushCb(), T, F, get clock() { return clock; } };
}

(async () => {
  console.log('v2.7.1.1 unit — «Ελαφρύ Nyx»');
  // ---- (α) NyxLite ----
  {
    const S = sandbox(); const { W, N } = S;
    ok(N && typeof N.begin === 'function' && typeof N.keep === 'function' && typeof N.alive === 'function', 'NyxLite API (begin / run / keep / alive / onChange / mode)');
    let n = 0; const id = W.setInterval(() => n++, 1000);
    ok(id >= 1e9, 'setInterval returns its own id (≥ 1e9)');
    S.frame(); S.run(3000); ok(n === 3 && !N.paused, 'on screen: the interval runs (3 ticks in 3 s)', n);
    S.flush(); ok(N.paused && N.state().reasons.includes('tray'), 'main\'s state:flush (hide to tray) → paused (reason tray)');
    const before = n; S.run(10000); ok(n === before, 'paused: the interval does not run (10 s)', n - before);
    let late = 0; W.setTimeout(() => late++, 500); S.run(1000); ok(late === 0, 'paused: setTimeout ≥ 100 ms waits');
    let quick = 0; W.setTimeout(() => quick++, 10); S.run(50); ok(quick === 1, 'paused: setTimeout < 100 ms still runs (promises / UI hand-offs)');
    let fr = 0; W.requestAnimationFrame(() => fr++); S.frame(); ok(fr === 0, 'paused: animation frames wait');
    S.fire('focus'); S.frame(); S.run(100); S.frame(); ok(!N.paused && late === 1 && fr === 1 && n === before + 1, 'focus → resumes: the waiting timeout + frame run, the missed interval runs once', { late, fr, d: n - before });
    S.run(2000); ok(n === before + 3, 'and the interval continues every 1 s');
    W.clearInterval(id); const c = n; S.run(3000); ok(n === c, 'clearInterval on our id stops it');
    // keep()
    let k = 0, on = true; N.keep(W.setInterval(() => k++, 1000), () => on);
    S.flush(); S.run(3000); ok(k === 3, 'keep(id, pred) with pred true → keeps running off screen (Pomodoro)', k);
    S.fire('pointerdown'); S.frame(); ok(!N.paused, 'pointerdown (+ frames arrive again) → back on screen', N.state());
    on = false; S.flush(); const k0 = k; S.run(3000); ok(k <= k0 + 1, 'keep() with pred false → paused like the rest', k - k0);
    on = true; S.run(1000); const k1 = k; on = false; S.run(3000); ok(k === k1, 'a kept interval stops by itself once pred turns false while already paused (Pomodoro ended while minimized)', k - k1);
    S.fire('keydown'); S.frame(); ok(!N.paused, 'keydown → back on screen');
    // busy work keeps everything running
    let b = 0; W.setInterval(() => b++, 1000); const end = N.begin('llm'); S.flush(); S.run(3000);
    ok(!N.paused && N.offscreen && b === 3, 'while an LLM reply runs (begin("llm")) nothing pauses even off screen', { p: N.paused, b });
    end(); ok(N.paused, 'end() → paused again'); end(); ok(N.state().busy.length === 0, 'end() twice is harmless');
    S.fire('mousemove'); S.frame(); ok(!N.paused, 'mouse move → resumes', N.state());
  }
  {
    const S = sandbox(); const { W, N } = S; let n = 0; W.setInterval(() => n++, 1000);
    S.run(1000); S.run(5000); // no frame delivered while timers fire
    ok(N.paused && N.state().reasons.includes('stall'), 'frames stop arriving for > 3 s while timers fire → paused (stall = minimized / covered)', N.state());
    S.frame(); ok(!N.paused, 'the next frame → resumes');
  }
  {
    const S = sandbox(); const { N } = S; // no app interval at all: only the focus-loss watch can notice the minimize
    S.frame(); S.fire('blur'); ok(!!N._test.watch, 'focus lost → a 1 Hz frame check starts');
    S.run(5500); ok(N.paused && N.state().reasons.includes('stall') && !N._test.watch, 'no frames for ~5 s (minimized) → paused, and the check stops itself', N.state());
    S.frame(); ok(!N.paused && !!N._test.watch, 'a frame arrives (restored, still unfocused) → resumes, check on again');
    S.fire('focus'); ok(!N._test.watch, 'focus → check off (no timer while Nyx is in use)');
  }
  {
    const S = sandbox(); const { W, N } = S; let n = 0; W.setInterval(() => n++, 1000); S.frame();
    for (let i = 0; i < 4; i++) { S.run(900); S.frame1(); } // hidden window: Chromium slows frames to ~1 per second
    ok(N.paused && N.state().reasons.includes('stall'), 'frames slowed to ~1/s (each > 700 ms late, as under X11 when minimized) → paused', N.state());
    const n0 = n; S.run(1000); S.frame1(); S.run(1000); S.frame1(); ok(n === n0, 'and stays paused while frames stay slow (no interval ticks)', n - n0);
    S.run(1000); S.frame(); ok(!N.paused, 'restored: the first fast frame → resumes');
  }
  {
    const S = sandbox(); const { W, N } = S;
    W.screenX = -32000; W.screenY = -32000; S.fire('blur'); S.run(500);
    ok(N.paused && N.state().reasons.includes('min'), 'blur + window at -32000,-32000 (Windows minimized) → paused (min)');
    S.fire('focus'); ok(!N.paused, 'focus → resumes');
    W.screenX = 10; W.screenY = 10; S.fire('blur'); S.run(500); ok(!N.paused, 'blur at a normal position (another window focused) → not paused');
  }
  {
    const S = sandbox(); const { W, N } = S;
    S.doc.visibilityState = 'hidden'; S.fireDoc('visibilitychange'); ok(N.paused && N.state().reasons.includes('hidden'), 'visibilitychange hidden → paused');
    S.doc.visibilityState = 'visible'; S.fireDoc('visibilitychange'); ok(!N.paused, 'visible → resumes');
    // lite mode
    ok(N.mode() === 'auto' && !N.lite && !S.classes.has('nyx-lite'), 'liteMode default «Αυτόματα» (auto), off when idle');
    const e = N.begin('llm'); ok(N.lite && S.classes.has('nyx-lite'), 'auto: on while the model writes (body.nyx-lite)');
    e(); ok(!N.lite && !S.classes.has('nyx-lite'), 'auto: off again after the reply');
    const e2 = N.begin('image'); ok(N.lite && N.state().busy[0] === 'image', 'the same hook for future image / video generation: begin("image")'); e2();
    W.Store.state.settings.liteMode = 'always'; N.apply(); ok(N.lite && S.classes.has('nyx-lite'), '«Πάντα» → always on');
    W.Store.state.settings.liteMode = 'never'; N.apply(); const e3 = N.begin('llm'); ok(!N.lite && !S.classes.has('nyx-lite'), '«Ποτέ» → never, even while the model writes'); e3();
    W.Store.state.settings.liteMode = 'bogus'; ok(N.mode() === 'auto', 'unknown value → auto');
    let got = null; N.onChange((s) => { got = s; }); N.apply(); ok(got && got.mode === 'auto', 'onChange gets the state');
    ok(N.alive({ isConnected: true, closest: () => null }) && !N.alive({ isConnected: false, closest: () => null }) && !N.alive({ isConnected: true, closest: () => ({}) }) && !N.alive(null), 'alive(el): connected and not inside [hidden]');
    const r = await N.run('video', async () => { ok(N.lite, 'run(kind, work) is lite while it works'); return 7; }); ok(r === 7 && !N.lite, 'run() returns the result and ends');
  }
  // ---- (β) static ----
  const git = (a) => { try { return cp.execFileSync('git', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (e) { return null; } };
  const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json')), CH = JSON.parse(read('CHANGELOG.json'));
  ok(pkg.version === '2.7.1.1' && lock.version === '2.7.1.1' && lock.packages[''].version === '2.7.1.1', 'version 2.7.1.1 (package.json + package-lock)');
  ok(pkg.devDependencies.electron === '45.2.3', 'Electron 45.2.3');
  ok(Object.keys(CH)[0] === '2.7.1.1' && CH['2.7.1.1'].el.length === 4 && CH['2.7.1.1'].en.length === 4 && CH['2.7.1'], 'CHANGELOG 2.7.1.1 first (4 items el/en), 2.7.1 kept');
  if (git(['cat-file', '-e', '28bcceb']) !== null) {
    const mainSide = git(['diff', '--name-only', '28bcceb', '--', 'main', 'main.js', 'preload.js', 'electron-builder.yml', 'build']).trim();
    ok(mainSide === '', 'main side unchanged vs 2.7.1: main.js, main/* (incl. gpu.ps1, perf.js, unpacked-sha256.json), preload.js', mainSide);
    const del = git(['diff', '--name-only', '--diff-filter=DR', '28bcceb', '--', '.']).trim();
    ok(del === '', 'nothing deleted or renamed', del);
    const add = git(['diff', '-U0', '28bcceb', '--', 'app', 'main', 'main.js', 'preload.js', 'tools']).split('\n').filter((l) => /^\+(?!\+\+)/.test(l));
    const urls = add.flatMap((l) => l.match(/https?:\/\/[^\s'"`)\\]+/g) || []).filter((u) => !/^http:\/\/www\.w3\.org\/2000\/svg$/.test(u));
    ok(urls.length === 0, 'no new URL in app / main / tools', urls.slice(0, 5));
    ok(!add.some((l) => /\b(spawn|execFile|exec|fork|execSync|spawnSync)\s*\(/.test(l)), 'no new spawn / exec');
    const names = git(['diff', '--name-only', '28bcceb', '--', 'app/js/llm', 'app/js/v2/router.js', 'app/assets/data/models.json']); ok(names !== null && names.trim() === '', 'router / models untouched');
  } else ok(true, 'git guards skipped (no history)');
  const allSrc = ['app/js/v2/core.js', 'app/js/panels.js'].map(read).join('\n');
  ok(!/32768/.test(git(['diff', '28bcceb', '--', 'app']) || '') , 'ctx 32768 not touched by this change');
  const idx = read('app/index.html');
  const scripts = [...idx.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  ok(scripts[0] === 'js/v2711/lite.js', 'lite.js is the first script in index.html', scripts.slice(0, 3));
  ok(scripts.includes('assets/data/lucide-ui.js') && !scripts.includes('assets/data/lucide.js'), 'index.html loads the icon subset, not the 648 KB pack');
  ok(/href="v2711\.css"/.test(idx), 'v2711.css linked');
  ok(fs.existsSync(path.join(ROOT, 'app/assets/data/lucide.js')), 'the full pack still exists (loaded later when needed)');
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts/gen-lucide-ui.js'), '--check'], { encoding: 'utf8' });
  ok(r.status === 0, 'lucide-ui.js up to date (every icon the UI names is in the subset)', (r.stdout + r.stderr).trim());
  const sub = fs.statSync(path.join(ROOT, 'app/assets/data/lucide-ui.js')).size, full = fs.statSync(path.join(ROOT, 'app/assets/data/lucide.js')).size;
  ok(sub < 100000 && full > 600000, `subset ${Math.round(sub / 1024)} KB vs full ${Math.round(full / 1024)} KB`);
  const util = read('app/js/util.js'); ok(/lucideFull/.test(util) && /data-imiss/.test(util), 'missing icon → placeholder + full pack loaded, then patched');
  ok(/NYX_DATA\.lucideUi\[it\.name\]/.test(read('app/js/items.js')), 'icon cards use the subset first (the welcome board does not pull the full pack)');
  ok(/NyxLite\.begin\('llm'\)/.test(read('app/js/v2/core.js')), 'invokeChat: NyxLite.begin("llm") … end() around the reply');
  const perf = read('app/js/v25/perf.js'); ok(/EVERY:\s*10000/.test(perf) && /NyxLite\.alive\(box\)/.test(perf) && /drawerKind !== 'perf'/.test(perf), 'perf panel: every 10 s, stops once its drawer is closed');
  const cv = read('app/js/canvas.js'); ok(/IDLE_MS/.test(cv) && !/requestAnimationFrame\(loop\)/.test(cv), 'Stars: no endless frame loop (idle → still)');
  ok(/widgetDragOk/.test(cv) && /startMove\(e, 4/.test(cv), 'widgets: drag from any point with a 4 px threshold');
  ok(/_sm\(e, \.\.\.a\)/.test(read('app/js/v26/dnd.js')), 'dnd.js passes startMove\'s arguments through');
  const EL = JSON.parse(read('app/locales/el.json')), EN = JSON.parse(read('app/locales/en.json'));
  ok(EL['v2711.lite'] === 'Ελαφριά εμφάνιση' && EL['v2711.lite_auto'] === 'Αυτόματα' && EL['v2711.lite_always'] === 'Πάντα' && EL['v2711.lite_never'] === 'Ποτέ' && EL['v2711.lite_hint'] && ['lite', 'lite_auto', 'lite_always', 'lite_never', 'lite_hint'].every((k) => EN['v2711.' + k]), 'locale keys el/en (Ελαφριά εμφάνιση: Πάντα / Αυτόματα / Ποτέ)');
  if (git(['cat-file', '-e', '28bcceb']) !== null) {
    const oldEl = JSON.parse(git(['show', '28bcceb:app/locales/el.json'])); const lost = Object.keys(oldEl).filter((k) => !(k in EL) || EL[k] !== oldEl[k]);
    ok(lost.length === 0, 'no existing locale key removed or renamed', lost.slice(0, 5));
    const oldPanels = git(['show', '28bcceb:app/js/panels.js']); const ids = (s) => new Set([...s.matchAll(/S\.(\w+)\s*=/g)].map((m) => m[1]));
    const now = ids(read('app/js/panels.js')); const gone = [...ids(oldPanels)].filter((k) => !now.has(k));
    ok(gone.length === 0 && now.has('liteMode'), 'existing settings kept; new settings.liteMode', gone);
  }
  ok(/'set_anim'|set_anim/.test(allSrc), 'the «animations» setting is still there');
  const css = read('app/v2711.css'); ok(/body\.nyx-lite[^{]*\{[^}]*backdrop-filter:\s*none/.test(css) || /backdrop-filter:\s*none\s*!important/.test(css), 'v2711.css: lite → backdrop-filter none');
  console.log(`\nv2.7.1.1 unit: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ crashed: ' + (e && e.stack)); process.exit(1); });
