'use strict';
// v2.7.1 UI (Electron, Chromium sandbox on) — «Σήμερα» widget, Variant C «Μίνιμαλ». The weather answer is ALWAYS mocked
// (NYX_TODAY271_MOCK): no live call. Covers:
//  1) gallery → «Σήμερα» (real clicks) with no answer → «Ο καιρός δεν ήρθε» + «Ξανά»; «Ξανά» (real click) → the weather
//  2) header line «15° Λίγα σύννεφα · 12 km/h ΒΔ», 8 boxes every 3 h (Τώρα first), name day, «Ενημέρωση ΩΩ:ΛΛ», Open-Meteo
//  3) a 2.7.0 «Σήμερα» card (and a collapsed one on another board) migrates in place: same id/place/pin; others untouched
//  4) name day 25/11 (Αικατερίνη) and 21/11 («Δεν υπάρχει καταχώριση»)
//  5) ⋯ menu: S / M / L and accent (Nyx default, Τιρκουάζ…); remove → Bin, Ctrl+Z back
//  6) stale (>60′ dimmed «Τελευταία διαθέσιμα»), offline («Χωρίς σύνδεση», last values), back online → fresh
//  7) light: no backdrop-filter, no running animations, no canvas in the widget; one request (fixed URL) for many repaints
//  8) screenshots at 1440×900 and 1024×700 (NYX_SHOTS or shots/)
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os');
const FX = require('./fixtures/openmeteo271');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v271-'));
const MOCK = path.join(DATA, 'mock-openmeteo.json');
const SHOTS = process.env.NYX_SHOTS || path.join(__dirname, '..', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const URL_FIXED = require('../main/today271').URL_FIXED;
let fails = 0, passes = 0;
const T0 = Date.now(); const ok = (c, m, x) => { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setMock = (m) => fs.writeFileSync(MOCK, JSON.stringify(m));
const calls = () => { try { return fs.readFileSync(MOCK + '.calls', 'utf8').trim().split('\n').filter(Boolean); } catch (e) { return []; } };
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const shot = (win, name) => win.screenshot({ path: path.join(SHOTS, name) }).catch(() => '');
const W = (win, id) => win.evaluate((id) => {
  const n = document.querySelector(`.item[data-id="${id}"]`); const it = Store.get(id); if (!n || !it) return null; const card = n.querySelector('.wg-card');
  return { st: card.getAttribute('data-t271-state'), inl: (n.querySelector('[data-t271-cur]') || {}).textContent || '', off: !!n.querySelector('[data-t271-off]'), cells: [...n.querySelectorAll('[data-t271-cell]')].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.querySelector('.t271-hl').textContent),
    ft: (n.querySelector('.t271-ft') || {}).textContent || '', down: (n.querySelector('[data-t271-down]') || {}).textContent || '', dim: !!n.querySelector('.t271-wx.t271-dim'), names: (n.querySelector('.t271-nd') || {}).textContent || '',
    w: it.w, h: it.h, x: it.x, y: it.y, wsize: it.wsize, acc: card.getAttribute('data-waccent'), accVar: getComputedStyle(card).getPropertyValue('--accent').trim(), pinned: !!it.pinned, w271: it.w271, collapsed: !!it.wcollapsed, wh: it.wh,
    blur: getComputedStyle(card).backdropFilter, anims: n.getAnimations({ subtree: true }).length, canvas: n.querySelectorAll('canvas').length, nodes: n.querySelectorAll('*').length,
    over: (() => { const b = n.getBoundingClientRect(); return [...n.querySelectorAll('.t271-ft, .t271-strip, .wg-head')].some((e) => e.getBoundingClientRect().bottom > b.bottom + 1 || e.getBoundingClientRect().right > b.right + 1); })() };
}, id);

(async () => {
  setMock({ fail: 'http' });
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_TODAY271_MOCK: MOCK } });
  const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
  await win.waitForFunction(() => window.__nyxLook2611 === true && window.__nyxWidgets270 === true, null, { timeout: 30000 }); await sleep(600);
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(ver === '2.7.1', 'app version 2.7.1', ver);
  ok(await win.evaluate(() => typeof NyxToday271 === 'object' && !!document.getElementById('t271-sun') && document.querySelectorAll('.t271-sprite').length === 1), 'Variant C module + one static icon sprite');
  ok(calls().length === 0, 'no request before a «Σήμερα» widget exists', calls());
  await win.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); Canvas.view.x = 0; Canvas.view.y = 0; Canvas.view.z = 1; Canvas.applyView(); });

  // ---- 1) gallery → «Σήμερα», no answer → down + «Ξανά» ----
  await win.click('#btn-widgets'); await sleep(450);
  const gdesc = await win.evaluate(() => (document.querySelector('.wg-tile[data-gkind=today] .wg-tdesc') || {}).textContent || '');
  ok(/Καιρός Θεσσαλονίκης ανά 3 ώρες/.test(gdesc), 'gallery: «Σήμερα» described as weather every 3 hours + name day', gdesc);
  await win.click('.wg-tile[data-gkind=today] [data-gadd]'); await sleep(900);
  const nid = await win.evaluate(() => { const it = Store.items().find((i) => i.type === 'widget' && i.wkind === 'today'); return it && it.id; });
  let w = await W(win, nid);
  ok(w && w.wsize === 'm' && w.w === 480 && w.h === 186 && w.acc === 'nyx', 'added at size M (480×186), accent Nyx', w);
  ok(w && w.st === 'down' && /Ο καιρός δεν ήρθε/.test(w.down) && /Νέα προσπάθεια σε 10′/.test(w.down) && /Ξανά/.test(w.down), 'no answer → «Ο καιρός δεν ήρθε», «Νέα προσπάθεια σε 10′», «Ξανά»', w);
  ok(calls().length === 1 && calls()[0] === URL_FIXED, 'one request, to the fixed Open-Meteo URL', calls());
  await win.evaluate(() => { const n = document.querySelector('.item.t-widget .t271'); Canvas.view.x = 0; Canvas.view.y = 0; Canvas.applyView(); });
  await win.evaluate((id) => Canvas.focusItem && Canvas.focusItem(id), nid); await sleep(400);
  await shot(win, 'v271-down.png');
  setMock({ body: FX.build(Date.now()) }); await sleep(15200);
  await win.click(`.item[data-id="${nid}"] [data-act=w-retry]`); const tRetry = Date.now(); await sleep(900);
  w = await W(win, nid);
  ok(w && w.st === 'ok' && calls().length === 2, '«Ξανά» (real click) → a new request → the weather', { w, c: calls().length });

  // ---- 2) content ----
  ok(/^15° Λίγα σύννεφα · 12 km\/h ΒΔ$/.test(w.inl.trim()), 'header line: «15° Λίγα σύννεφα · 12 km/h ΒΔ»', w.inl);
  ok(w.cells.length === 8 && w.cells[0] === 'Τώρα' && w.cells.slice(1).every((x) => /^\d\d:00$/.test(x)), '8 boxes every 3 hours, «Τώρα» first, no scroll', w.cells);
  const today = new Date(); const hm = String(today.getHours()).padStart(2, '0') + ':';
  ok(/Γιορτή/.test(w.ft) && new RegExp('Ενημέρωση ' + hm + '\\d\\d').test(w.ft) && /Weather data by Open-Meteo\.com/.test(w.ft), 'footer: Γιορτή · Ενημέρωση ΩΩ:ΛΛ · Weather data by Open-Meteo.com', w.ft);
  ok(!/°F|πυξίδα/i.test(w.inl + w.ft) && w.blur === 'none' && w.anims === 0 && w.canvas === 0, 'only °C, no compass; no blur, no animation, no canvas', { blur: w.blur, anims: w.anims, canvas: w.canvas });
  ok(!w.over, 'everything inside the card at M', w);
  const strip = await win.evaluate((id) => { const s = document.querySelector(`.item[data-id="${id}"] .t271-strip`); return { sw: s.scrollWidth, cw: s.clientWidth, ov: getComputedStyle(s).overflowX }; }, nid);
  ok(strip.sw <= strip.cw + 1, 'the 8 boxes fit (no horizontal scroll)', strip);
  await win.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); Canvas.select([]); });
  const el = await win.$(`.item[data-id="${nid}"]`); await el.screenshot({ path: path.join(SHOTS, 'v271-widget-M.png') });
  await shot(win, 'v271-normal.png');

  // ---- 3) migration of 2.7.0 cards ----
  const mig = await win.evaluate(() => {
    const b = Store.board(); b.items.push({ id: 'old270', type: 'widget', wkind: 'today', wsize: 'm', w: 320, h: 300, x: -700, y: 320, pinned: true, title: 'Σήμερα', z: 3 }, { id: 'cal270', type: 'widget', wkind: 'calendar', wsize: 'm', w: 300, h: 330, x: 700, y: 320 });
    const b2 = { id: 'b271test', name: 'Άλλος', emoji: '🗂️', items: [{ id: 'old270c', type: 'widget', wkind: 'today', wsize: 'l', w: 440, h: 46, wh: 380, wcollapsed: true, x: 10, y: 20, locked: true }] };
    Store.state.boards.push(b2); Store.save(true); Canvas.renderBoard(); return true;
  }); await sleep(800);
  const o = await W(win, 'old270'); const cal = await win.evaluate(() => { const i = Store.get('cal270'); return { w: i.w, h: i.h, x: i.x }; });
  ok(o && o.w271 === 1 && o.w === 480 && o.h === 186 && o.x === -700 && o.y === 320 && o.pinned && o.st === 'ok' && o.cells.length === 8, '2.7.0 «Σήμερα» card → the new one in place (same id, place, pin; size M of 2.7.1)', o);
  ok(cal.w === 300 && cal.h === 330 && cal.x === 700, 'Ημερολόγιο widget untouched', cal);
  await win.evaluate(() => App.switchBoard('b271test')); await sleep(700);
  const oc = await W(win, 'old270c');
  ok(oc && oc.collapsed && oc.w === 600 && oc.h === 46 && oc.wh === 186 && oc.x === 10 && oc.w271 === 1 && /15°/.test(oc.inl), 'collapsed 2.7.0 card on another board: stays collapsed (header shows the weather), size L kept', oc);
  const lockedKept = await win.evaluate(() => Store.get('old270c').locked === true); ok(lockedKept, 'lock kept');
  await win.evaluate(() => { const b = Store.state.boards[0]; App.switchBoard(b.id); }); await sleep(700);
  await sleep(400);
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'data', 'nyx.json'), 'utf8'));
  const all = saved.boards.flatMap((b) => b.items);
  ok(all.filter((i) => i.wkind === 'today').every((i) => i.w271 === 1) && all.some((i) => i.id === 'old270') && all.some((i) => i.id === 'old270c'), 'migration saved in nyx.json; nothing deleted');

  // ---- 4) name days ----
  const nd = async (y, m, d) => { await win.evaluate(([y, m, d]) => { Widgets.now271 = () => new Date(y, m, d, 12).getTime(); Widgets.refreshAll(); }, [y, m, d]); await sleep(600); return (await W(win, nid)).names; };
  const n25 = await nd(2026, 10, 25); ok(/Γιορτή\s*Αικατερίνη/.test(n25), '25/11 → «Γιορτή Αικατερίνη»', n25);
  await win.evaluate(() => Canvas.select([])); await (await win.$(`.item[data-id="${nid}"]`)).screenshot({ path: path.join(SHOTS, 'v271-widget-2511.png') });
  const n21 = await nd(2026, 10, 21); ok(/Γιορτή\s*Δεν υπάρχει καταχώριση/.test(n21), '21/11 → «Δεν υπάρχει καταχώριση»', n21);
  await (await win.$(`.item[data-id="${nid}"]`)).screenshot({ path: path.join(SHOTS, 'v271-widget-2111.png') });
  await win.evaluate(() => { delete Widgets.now271; Widgets.refreshAll(); }); await sleep(400);

  // ---- 5) menu: sizes + accent ----
  const openMenu = async (id) => { await win.click(`.item[data-id="${id}"] .wg-more`); await sleep(250); };
  await openMenu(nid);
  const rows = await win.evaluate(() => [...document.querySelectorAll('#ctxmenu [data-wmi]')].map((b) => b.getAttribute('data-wmi')));
  ok(['sz-s', 'sz-m', 'sz-l', 'acc-nyx', 'acc-teal', 'acc-amber', 'acc-rose'].every((k) => rows.includes(k)), 'menu: sizes S/M/L + accent Nyx/Τιρκουάζ/Κεχριμπάρι/Ροζ', rows);
  await win.click('#ctxmenu [data-wmi=sz-s]'); await sleep(500); w = await W(win, nid);
  ok(w.wsize === 's' && w.w === 380 && w.h === 204 && w.cells.length === 6 && !w.over, 'S → 380×204, 6 boxes fit', w);
  await win.evaluate(() => Canvas.select([])); await (await win.$(`.item[data-id="${nid}"]`)).screenshot({ path: path.join(SHOTS, 'v271-widget-S.png') });
  await openMenu(nid); await win.click('#ctxmenu [data-wmi=sz-l]'); await sleep(500); w = await W(win, nid);
  ok(w.wsize === 'l' && w.w === 600 && w.cells.length === 8 && !w.over, 'L → 600 wide, 8 boxes', w);
  await win.evaluate(() => Canvas.select([])); await (await win.$(`.item[data-id="${nid}"]`)).screenshot({ path: path.join(SHOTS, 'v271-widget-L.png') });
  await openMenu(nid); await win.click('#ctxmenu [data-wmi=acc-teal]'); await sleep(400); w = await W(win, nid);
  ok(w.acc === 'teal' && w.accVar === '#2fbfb2' && (await win.evaluate((id) => Store.get(id).waccent, nid)) === 'teal', 'accent Τιρκουάζ → saved on the widget, card uses it', w);
  await win.evaluate(() => Canvas.select([])); await (await win.$(`.item[data-id="${nid}"]`)).screenshot({ path: path.join(SHOTS, 'v271-widget-teal.png') });
  await win.keyboard.press('Control+z'); await sleep(400);
  ok((await win.evaluate((id) => Store.get(id).waccent, nid)) === undefined, 'Ctrl+Z undoes the accent');
  await openMenu(nid); await win.click('#ctxmenu [data-wmi=sz-m]'); await sleep(500);
  await openMenu(nid); await win.click('#ctxmenu [data-wmi=acc-nyx]'); await sleep(400); w = await W(win, nid);
  ok(w.acc === 'nyx' && w.wsize === 'm' && (await win.evaluate((id) => !('waccent' in Store.get(id)), nid)), 'Nyx (default) → no extra field, back to M', w);
  await openMenu(nid); await win.click('#ctxmenu [data-wmi=del]'); await sleep(400);
  const gone = await win.evaluate((id) => !Store.get(id), nid);
  await win.keyboard.press('Control+z'); await sleep(600);
  ok(gone && (await W(win, nid)) && (await W(win, nid)).st === 'ok', 'remove → Bin; Ctrl+Z brings it back with the weather');

  // ---- 6) stale / offline / back online ----
  const c0 = calls().length;
  await win.evaluate(() => { window.__realNow = Date.now; const d = Date.now(); Date.now = () => window.__realNow() + 61 * 60000; Widgets.refreshAll(); }); await sleep(600);
  w = await W(win, nid);
  ok(w.st === 'stale' && w.dim && /Τελευταία διαθέσιμα · \d\d:\d\d/.test(w.ft), 'over 60′ → dimmed + «Τελευταία διαθέσιμα · ΩΩ:ΛΛ»', w);
  await win.evaluate(() => Canvas.select([])); await (await win.$(`.item[data-id="${nid}"]`)).screenshot({ path: path.join(SHOTS, 'v271-widget-stale.png') });
  await win.evaluate(() => { Date.now = window.__realNow; Widgets.refreshAll(); }); await sleep(500);
  setMock({ fail: 'net' });
  const cdp = await win.context().newCDPSession(win);
  await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await sleep(900);
  w = await W(win, nid);
  ok(w.off && w.cells.length === 8 && /15°/.test(w.inl), 'offline → «Χωρίς σύνδεση» with the last values', w);
  await win.evaluate(() => Canvas.select([])); await (await win.$(`.item[data-id="${nid}"]`)).screenshot({ path: path.join(SHOTS, 'v271-widget-offline.png') });
  setMock({ body: FX.build(Date.now(), { t: 13.6, code: 61 }) });
  await sleep(Math.max(0, 15500 - (Date.now() - tRetry))); // «Ξανά» / online refetch at most every 15 s
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await sleep(1200);
  w = await W(win, nid);
  ok(!w.off && /^14° Ασθενής βροχή/.test(w.inl.trim()) && calls().length === c0 + 1, 'back online → one request, fresh values (14° Ασθενής βροχή)', { inl: w.inl, c: calls().length - c0 });

  // ---- 7) light: repaints do not fetch ----
  const c1 = calls().length;
  await win.evaluate(async () => { for (let i = 0; i < 20; i++) { Widgets.refreshAll(); await new Promise((r) => setTimeout(r, 30)); } }); await sleep(600);
  ok(calls().length === c1, '20 repaints (60 s timer, saves) → no extra request (main cache)', calls().length - c1);
  const css = await win.evaluate(() => { const n = document.querySelector(`.item.t-widget .t271`); return { anims: document.getAnimations().filter((a) => n.contains(a.effect && a.effect.target)).length }; });
  ok(css.anims === 0, 'no running animations in the widget', css);

  // ---- 8) small window ----
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1024, height: 700 })); await sleep(700);
  await win.evaluate((id) => { Canvas.select([]); Canvas.focusItem && Canvas.focusItem(id); }, nid); await sleep(500);
  w = await W(win, nid); ok(w && w.cells.length === 8 && !w.over, 'small window 1024×700: the widget unchanged, all inside', w);
  await shot(win, 'v271-small.png');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1440, height: 900 })); await sleep(400);

  ok(!errs.length, 'no page errors', errs);
  await quit(app);
  console.log(`\nv2.7.1 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('  ✗ crashed: ' + (e && e.stack)); process.exit(1); });
