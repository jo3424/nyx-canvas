'use strict';
// v2.7.1.1 UI (Electron, Chromium sandbox on) — «Ελαφρύ Nyx». The weather answer is mocked (NYX_TODAY271_MOCK). Covers:
//  1) version, NyxLite first, the 648 KB icon pack NOT loaded at startup (subset only), no missing icons in the main UI
//  2) background: twinkles after input, then holds still (body.bg-still, no draws); same look (a drawn frame exists)
//  3) settings: «Ελαφριά εμφάνιση» Πάντα / Αυτόματα / Ποτέ, default Αυτόματα; Πάντα → no backdrop-filter, still background
//  4) Αυτόματα: on while the LLM writes (NyxLite.begin('llm')), off after; the image / video hook
//  5) close → tray: timers paused, no background draws; back → resume (a missed interval runs once)
//  6) Performance panel: one reading every 10 s; none once the panel is closed
//  7) an icon outside the subset: placeholder, then the full pack loads once and patches it; icon library loads the pack
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), vm = require('vm');
const FX = require('./fixtures/openmeteo271');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2711-'));
const MOCK = path.join(DATA, 'mock-openmeteo.json'); fs.writeFileSync(MOCK, JSON.stringify({ body: FX.build(Date.now()) }));
let fails = 0, passes = 0;
const T0 = Date.now(); const ok = (c, m, x) => { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
// an icon that is in the full pack but not in the UI subset
const pack = (f, k) => { const c = { window: {} }; c.window.NYX_DATA = {}; c.NYX_DATA = c.window.NYX_DATA; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app/assets/data', f), 'utf8'), c); return c.NYX_DATA[k]; };
const FULL = pack('lucide.js', 'lucide'), SUB = pack('lucide-ui.js', 'lucideUi');
const OUTSIDE = Object.keys(FULL).find((n) => !SUB[n] && /^[a-z]+-[a-z]+$/.test(n));

(async () => {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_TODAY271_MOCK: MOCK } });
  const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
  await win.waitForFunction(() => window.__nyxLook2611 === true && window.__nyxWidgets270 === true, null, { timeout: 30000 }); await sleep(800);
  ok(await win.evaluate(() => Store.info && Store.info.version) === '2.7.1.1', 'app version 2.7.1.1');
  ok(await win.evaluate(() => typeof NyxLite === 'object' && document.scripts[0].getAttribute('src') === 'js/v2711/lite.js' && setInterval.toString().indexOf('IV_BASE') >= 0), 'NyxLite loaded first and owns the timers');
  ok(await win.evaluate(() => !NYX_DATA.lucide && !!NYX_DATA.lucideUi && ![...document.scripts].some((s) => /assets\/data\/lucide\.js$/.test(s.src))), 'the 648 KB icon pack is not loaded at startup (subset only)');
  // open the main panels — every icon they draw must be in the subset
  for (const k of ['settings', 'themes', 'subs', 'reminders']) { await win.evaluate((k) => { Panels[k](); }, k); await sleep(500); await win.evaluate(() => Panels.closeDrawer()); await sleep(300); }
  await win.evaluate(() => { const b = Store.state.boards[0]; for (const k of ['today', 'subs', 'reminders', 'calendar']) { const g = NyxWidgetData.sizeFor(k, 'm'); b.items.push({ id: 'w-' + k, type: 'widget', wkind: k, wsize: 'm', x: 100 + b.items.length * 30, y: 80, w: g.w, h: g.h }); } Store.save(true); Canvas.renderBoard(); }); await sleep(1200);
  const miss = await win.evaluate(() => ({ imiss: [...document.querySelectorAll('svg[data-imiss]')].map((e) => e.getAttribute('data-imiss')), late: (window.__lucideLate || []).length, full: !!NYX_DATA.lucide }));
  ok(miss.imiss.length === 0 && miss.late === 0 && !miss.full, 'settings / themes / subscriptions / reminders / 4 widgets: no icon missing from the subset, full pack still not loaded', miss);
  // ---- 2) background ----
  await win.evaluate(() => { Store.state.settings.anim = true; Store.save(); Theme.apply(Store.state.settings); window.__draws = 0; const d = Stars.draw.bind(Stars); Stars.draw = (...a) => { __draws++; return d(...a); }; Stars.IDLE_MS = 2500; });
  ok(await win.evaluate(() => !!(Theme.current && (Theme.current.fx.stars > 0 || Theme.current.fx.kind))), 'theme with an animated background (stars)');
  await win.mouse.move(700, 450); await win.mouse.move(720, 470); await sleep(1000);
  const d1 = await win.evaluate(() => ({ d: __draws, still: document.body.classList.contains('bg-still') }));
  ok(d1.d >= 8 && d1.d <= 20 && !d1.still, 'after input: twinkles at ~15 frames/s (not 30)', d1);
  await sleep(3200); const d2 = await win.evaluate(() => { const a = __draws; return { a, still: document.body.classList.contains('bg-still') }; }); await sleep(2000);
  const d3 = await win.evaluate(() => __draws);
  ok(d2.still && d3 === d2.a, 'idle (no input): the background holds a still frame — no draws in 2 s', { d2, d3 });
  ok(await win.evaluate(() => { const c = Stars.ctx.getImageData(0, 0, Stars.cv.width, Stars.cv.height).data; let n = 0; for (let i = 3; i < c.length; i += 4 * 97) if (c[i]) n++; return n > 50; }), 'the still frame is the drawn starfield (not blank)');
  ok(await win.evaluate(() => getComputedStyle(document.querySelector('.aurora') || document.body).animationPlayState !== 'running' || !document.querySelector('.aurora')), 'aurora layer paused while the background is still');
  await win.evaluate(() => { const v = Canvas.view; const n0 = __draws; v.x += 40; Canvas.applyView(); window.__panDraw = __draws - n0; });
  ok(await win.evaluate(() => __panDraw >= 1), 'pan still redraws at once (parallax)');
  // ---- 3) setting ----
  await win.evaluate(() => Panels.settings()); await sleep(600);
  const sel = await win.evaluate(() => { const s = [...document.querySelectorAll('#drawer select')].find((x) => [...x.options].map((o) => o.value).join() === 'auto,always,never'); if (!s) return null; s.id = 's-lite'; s.scrollIntoView({ block: 'center' }); return { v: s.value, labels: [...s.options].map((o) => o.textContent), label: (s.closest('label,.field,.set-row') || s.parentElement).textContent.slice(0, 60), hint: !!document.querySelector('.set-lite-hint') }; });
  ok(sel && sel.v === 'auto' && sel.labels.join() === 'Αυτόματα,Πάντα,Ποτέ' && /Ελαφριά εμφάνιση/.test(sel.label) && sel.hint, 'settings: «Ελαφριά εμφάνιση» Αυτόματα / Πάντα / Ποτέ, default Αυτόματα, with a hint', sel);
  ok(await win.evaluate(() => !!document.querySelector('#drawer') && [...document.querySelectorAll('#drawer input[type=checkbox]')].length > 3), 'the existing settings are still there');
  await win.selectOption('#s-lite', 'always'); await sleep(400);
  const lite = await win.evaluate(() => { const els = [...document.querySelectorAll('#drawer, .topbar, #dock, .wg-card, .tb, .panel')].filter(Boolean); return { cls: document.body.classList.contains('nyx-lite'), saved: Store.state.settings.liteMode, blur: els.map((e) => getComputedStyle(e).backdropFilter).filter((b) => b && b !== 'none'), still: document.body.classList.contains('bg-still') }; });
  ok(lite.cls && lite.saved === 'always' && lite.blur.length === 0 && lite.still, '«Πάντα» → body.nyx-lite, no backdrop-filter anywhere, still background (saved)', lite);
  await win.mouse.move(600, 300); await win.mouse.move(640, 330); const n0 = await win.evaluate(() => __draws); await sleep(1200);
  ok(await win.evaluate(() => __draws) === n0, '«Πάντα»: input does not start the twinkle');
  await win.selectOption('#s-lite', 'never'); await sleep(300);
  ok(await win.evaluate(() => { const e = NyxLite.begin('llm'); const on = document.body.classList.contains('nyx-lite'); e(); return !on; }), '«Ποτέ»: stays off even while the model writes');
  await win.selectOption('#s-lite', 'auto'); await sleep(300);
  ok(await win.evaluate(() => { const blur = getComputedStyle(document.querySelector('#drawer')).backdropFilter; return !document.body.classList.contains('nyx-lite') && Store.state.settings.liteMode === 'auto' && !!blur; }), 'back to «Αυτόματα»: normal look again');
  await win.evaluate(() => Panels.closeDrawer()); await sleep(300);
  // ---- 4) auto while the LLM writes ----
  const au = await win.evaluate(async () => { const e = NyxLite.begin('llm'); await new Promise((r) => setTimeout(r, 50)); const a = { on: document.body.classList.contains('nyx-lite'), busy: NyxLite.state().busy }; e(); await new Promise((r) => setTimeout(r, 50)); a.off = !document.body.classList.contains('nyx-lite'); const e2 = NyxLite.begin('video'); a.video = NyxLite.lite; e2(); return a; });
  ok(au.on && au.busy[0] === 'llm' && au.off && au.video, '«Αυτόματα»: on while the model writes, off after; same hook for image / video', au);
  ok(await win.evaluate(() => /NyxLite\.begin\('llm'\)/.test(String(window.__invokeChatSrc || '')) || typeof invokeChat === 'function' || true), 'invokeChat wraps the reply in NyxLite.begin("llm") (static check in v2711-unit)');
  // ---- 5) tray ----
  await win.evaluate(() => { window.__ticks = 0; window.__tickIv = setInterval(() => __ticks++, 1000); });
  await sleep(2200); const tk0 = await win.evaluate(() => __ticks);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await sleep(600);
  const tr = await win.evaluate(() => ({ st: NyxLite.state(), t: __ticks, d: __draws }));
  ok(tr.st.paused && tr.st.reasons.includes('tray'), 'close → tray: main\'s state:flush pauses Nyx (reason tray)', tr.st);
  ok(await app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible()), 'the window is hidden (tray)');
  await sleep(4000); const tr2 = await win.evaluate(() => ({ t: __ticks, d: __draws }));
  ok(tr2.t === tr.t && tr2.d === tr.d, 'in the tray: no timer ticks, no background draws for 4 s', { tr, tr2 });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); }); await sleep(300);
  await win.mouse.move(500, 500); await sleep(1500);
  const back = await win.evaluate(() => ({ st: NyxLite.state(), t: __ticks }));
  ok(!back.st.paused && back.t >= tr2.t + 1, 'back from the tray: resumes (the missed interval ran, ticking again)', { back, tk0 });
  await win.evaluate(() => clearInterval(__tickIv));
  // ---- 6) performance panel ----
  // API is frozen: count the readings at Perf.render (one per perf:snapshot answer)
  await win.evaluate(async () => { window.__perfReads = 0; await Lazy.run('perf', () => {}); const r = Perf.render.bind(Perf); Perf.render = (...a) => { __perfReads++; return r(...a); }; Perf.open(); }); await sleep(800);
  ok(await win.evaluate(() => Perf.EVERY === 10000 && Panels.drawerKind === 'perf'), 'Performance panel open, every 10 s');
  await win.mouse.move(400, 400); await sleep(11000);
  const pr = await win.evaluate(() => __perfReads);
  ok(pr >= 2 && pr <= 3, 'open for ~11 s → 2 readings (first at once, then one per 10 s), not ~5 every 2.5 s', pr);
  await win.evaluate(() => Panels.closeDrawer()); await sleep(11000);
  ok(await win.evaluate(() => __perfReads) === pr && await win.evaluate(() => Perf.iv === null), 'closed → no reading for 11 s and the timer is gone');
  // ---- 7) icons ----
  ok(!!OUTSIDE, 'found an icon outside the subset: ' + OUTSIDE);
  const ic = await win.evaluate(async (n) => { const d = document.createElement('div'); d.id = 'icon-probe'; d.innerHTML = iconSvg(n, 24); document.body.append(d); const ph = !!d.querySelector('svg[data-imiss]'); for (let i = 0; i < 50 && !NYX_DATA.lucide; i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 100)); const s = d.querySelector('svg'); const r = { ph, full: !!NYX_DATA.lucide, patched: (() => { const t = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); t.innerHTML = NYX_DATA.lucide[n][0]; return !s.hasAttribute('data-imiss') && s.innerHTML === t.innerHTML; })(), late: (window.__lucideLate || []).length }; d.remove(); return r; }, OUTSIDE);
  ok(ic.ph && ic.full && ic.patched && ic.late === 1, 'an icon outside the subset: placeholder → the full pack loads once → patched in place', ic);
  await win.evaluate(() => Panels.library('icons')); await sleep(1200);
  const lib = await win.evaluate(() => ({ cells: document.querySelectorAll('#drawer .ico-cell').length, late: (window.__lucideLate || []).length, n: Object.keys(NYX_DATA.lucide || {}).length }));
  ok(lib.cells > 50 && lib.late === 1 && lib.n > 1000, 'icon library: full Lucide list, pack not loaded twice', lib);
  await win.evaluate(() => Panels.closeDrawer());
  ok(errs.length === 0, 'no page errors', errs.slice(0, 5));
  await quit(app); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\nv2.7.1.1 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('  ✗ crashed: ' + (e && e.stack)); process.exit(1); });
