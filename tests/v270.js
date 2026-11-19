'use strict';
// v2.7.0 UI (Electron, Chromium sandbox on):
//  1) «Προσθήκη widget» gallery (top-bar button and «+ → Widget…»): 5 ready tiles, live/own tiles disabled with the version
//  2) the 5 widgets on the canvas with real data: Σήμερα, Συνδρομές (same total as the Subscriptions panel), Υπενθυμίσεις,
//     Ημερολόγιο (today marked, dots, ‹ › months, a day click), #tag (cards with the tag, a click opens the card)
//  3) ⋯ menu: sizes S/M/L, collapse, pin (it.pinned → Widget window), lock, remove → Bin, Ctrl+Z brings it back
//  4) loading (skeleton) and error («Δεν φόρτωσε» + «Ξανά») states through a slow / failing provider
//  5) fixes: board delete → Ctrl+Z / toast «Αναίρεση» → cards leave the Bin; Hub Qwen size from the real files (not the
//     MTP draft); VRAM from the per-process numbers; assistant chat without the «Voice Studio» line
//  6) small window 1024×700: widgets and gallery inside the window; screenshots (NYX_SHOTS or shots/)
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v270-'));
const SHOTS = process.env.NYX_SHOTS || path.join(__dirname, '..', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0, passes = 0;
const T0 = Date.now(); const ok = (c, m, x) => { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QWEN = 'Qwen3.8-27B-UD-Q4_K_XL';
const MODELS = { [QWEN]: 'loaded', 'gemma-4-12B-it-Q4_0': 'unloaded' };
const G = 1e9, GiB = 1073741824;
function startRouter() {
  const srv = http.createServer((q, resp) => {
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    const u = new URL(q.url, 'http://x'); const model = u.searchParams.get('model');
    if (u.pathname === '/v1/models' || u.pathname === '/models') return send(200, { object: 'list', data: Object.entries(MODELS).map(([id, v]) => ({ id, object: 'model', status: { value: v, args: ['llama-server', '-c', '32768', '-np', '1'] } })) });
    if (u.pathname === '/health') return send(200, { status: 'ok' });
    if (u.pathname === '/slots') return send(200, [{ id: 0, n_ctx: 32768 }]);
    if (u.pathname === '/props') return model ? send(200, { default_generation_settings: { n_ctx: 32768 }, total_slots: 1 }) : send(200, { role: 'router', max_instances: 1, default_generation_settings: { n_ctx: 0 }, build_info: 'b12230' });
    let b = ''; q.on('data', (d) => b += d); q.on('end', () => {
      if (/tokenize/.test(u.pathname)) return send(200, { tokens: [1, 2, 3] });
      if (/chat\/completions/.test(u.pathname)) { resp.writeHead(200, { 'content-type': 'text/event-stream' }); resp.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Εντάξει.' }, finish_reason: 'stop' }], timings: { prompt_n: 40, prompt_ms: 20, predicted_n: 6, predicted_ms: 100 } }) + '\n\n'); return resp.end('data: [DONE]\n\n'); }
      send(404, { error: 'no' });
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port })));
}
const MDIR = path.join(DATA, 'models');
// the PC's folder: the model (17,7 GB) + its vision projector + the MTP draft (1,68 GB) that 2.6.13.1 showed as the size
for (const [dir, f, sz] of [[QWEN, 'mtp-Qwen3.8-27B-Q4_0.gguf', 1.68 * G], [QWEN, 'mmproj-Qwen3.8-27B.gguf', 0.9 * G], [QWEN, QWEN + '.gguf', 17.7 * G], ['gemma-4-12B-it-Q4_0', 'gemma-4-12B-it-Q4_0.gguf', 7.3 * G]]) {
  fs.mkdirSync(path.join(MDIR, dir), { recursive: true }); const p = path.join(MDIR, dir, f); fs.writeFileSync(p, ''); fs.truncateSync(p, sz);
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const shot = (win, name) => win.screenshot({ path: path.join(SHOTS, name) }).catch(() => '');
const seed = (now) => {
  const D = (d, hh, mm) => { const x = new Date(now); x.setDate(x.getDate() + d); if (hh != null) x.setHours(hh, mm || 0, 0, 0); return x; };
  const ymd = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  return {
    subs: [
      { id: 's1', name: 'Υπηρεσία ταινιών Α', price: 9.99, currency: 'EUR', cycle: 'monthly', next: ymd(D(1)), active: true, color: '#e50914', icon: '🎬' },
      { id: 's2', name: 'Μουσική Β', price: 8, currency: 'EUR', cycle: 'monthly', next: ymd(D(3)), active: true, color: '#1db954', icon: '🎵' },
      { id: 's3', name: 'Cloud Γ', price: 2.99, currency: 'EUR', cycle: 'monthly', next: ymd(D(13)), active: true, color: '#4285f4', icon: '☁️' },
    ],
    items: [
      { id: 'r1', type: 'sticky', x: -900, y: 600, w: 200, h: 160, html: 'Πότισμα φυτών', reminder: { on: true, at: D(0, 23, 58).toISOString() } },
      { id: 'r2', type: 'sticky', x: -660, y: 600, w: 200, h: 160, html: 'Τηλέφωνο στον λογιστή', reminder: { on: true, at: D(1, 10, 0).toISOString() } },
      { id: 'r3', type: 'sticky', x: -420, y: 600, w: 200, h: 160, html: 'Γενέθλια φίλου 🎂', reminder: { on: true, at: D(4, 9, 0).toISOString(), repeat: 'yearly' } },
      { id: 't1', type: 'sticky', x: -180, y: 600, w: 200, h: 160, html: 'Ιδέα για το σαλόνι', tags: ['ιδέες'] },
      { id: 't2', type: 'sticky', x: 60, y: 600, w: 200, h: 160, html: 'Ιδέα για δώρο', tags: ['ιδέες', 'δώρα'] },
    ],
  };
};

(async () => {
  const router = await startRouter();
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
  await win.waitForFunction(() => window.__nyxLook2611 === true, null, { timeout: 30000 }); await sleep(600);
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(ver === '2.7.0', 'app version 2.7.0', ver);
  ok(await win.evaluate(() => window.__nyxWidgets270 === true && typeof Widgets === 'object' && typeof Items.R.widget === 'function'), 'widgets module loaded, a «widget» card type exists');
  const keys0 = await win.evaluate((a) => {
    const A = Store.state.settings.ai; const L = A.providers.find((p) => p.id === 'llama'); L.enabled = true; L.base = 'http://127.0.0.1:' + a.port + '/v1';
    for (const k of ['commands', 'chat', 'vision', 'summarize', 'greek', 'private']) A.tasks[k] = { p: 'llama', m: a.QWEN };
    Object.assign(A.servers.llama, { ctx: 32768, port: a.port, extra: '--models-max 1', modelsDir: a.MDIR });
    Store.state.subs = a.S.subs; Store.board().items.push(...a.S.items); Store.save(true); Canvas.renderBoard();
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    return Object.keys(Store.state.settings).sort().join();
  }, { port: router.port, QWEN, MDIR, S: seed(Date.now()) });

  // ---- 1) gallery ----
  await win.click('#btn-widgets'); await sleep(450);
  const gal = await win.evaluate(() => {
    const g = document.querySelector('#modal:not([hidden]) [data-wgallery]'); if (!g) return null;
    const tiles = [...g.querySelectorAll('.wg-tile')].map((x) => ({ k: x.dataset.gkind, add: !!x.querySelector('[data-gadd]'), later: (x.querySelector('[data-glater]') || {}).textContent || '', dis: [...x.querySelectorAll('[data-gsize]')].every((b) => b.disabled) }));
    const box = document.querySelector('#modal .modal-box').getBoundingClientRect();
    return { tiles, cats: [...g.querySelectorAll('[data-gcat]')].map((b) => b.dataset.gcat), box: { l: box.left, t: box.top, r: box.right, b: box.bottom, W: innerWidth, H: innerHeight } };
  });
  const ready = ['today', 'subs', 'reminders', 'calendar', 'tag'];
  ok(gal && ready.every((k) => (gal.tiles.find((x) => x.k === k) || {}).add), 'gallery: the 5 ready widgets each have «+ Προσθήκη»', gal);
  ok(gal && ['rss', 'youtube', 'water', 'custom'].every((k) => { const x = gal.tiles.find((y) => y.k === k); return x && !x.add && x.dis && /2\.7\.[12]/.test(x.later); }) && /απόφασ|decision/i.test((gal.tiles.find((x) => x.k === 'weather') || {}).later || ''), 'gallery: RSS / YouTube / Νερό / own are shown disabled with «2.7.1 / 2.7.2»; Καιρός says it needs your decision', gal && gal.tiles);
  ok(gal && gal.cats.join() === 'all,ready,live,mine' && gal.box.l >= 0 && gal.box.r <= gal.box.W && gal.box.b <= gal.box.H, 'gallery: categories + inside the window', gal);
  await win.click('[data-gcat=ready]'); await sleep(150);
  ok(await win.evaluate(() => [...document.querySelectorAll('[data-wgallery] .wg-tile')].map((x) => x.dataset.gkind).join()) === ready.join(), 'gallery: «Έτοιμα» shows only the 5');
  await win.click('[data-gcat=all]'); await sleep(150);
  await shot(win, 'v270-gallery.png');
  // add «Υπενθυμίσεις» size L from the gallery with real clicks
  await win.click('.wg-tile[data-gkind=reminders] [data-gsize=l]'); await sleep(100);
  await win.click('.wg-tile[data-gkind=reminders] [data-gadd]'); await sleep(500);
  const rem = await win.evaluate(() => { const it = Store.items().find((i) => i.type === 'widget' && i.wkind === 'reminders'); return it && { wsize: it.wsize, w: it.w, h: it.h, modal: !document.querySelector('#modal').hidden }; });
  ok(rem && rem.wsize === 'l' && rem.w === 440 && !rem.modal, 'gallery: size L + «Προσθήκη» → a «Υπενθυμίσεις» widget 440 wide, gallery closed', rem);
  // «+ → Widget…» opens the same gallery
  await win.click('[data-tool=insert]'); await sleep(350);
  const viaPlus = await win.evaluate(() => { const r = document.querySelector('#ctxmenu .ins-widget'); if (r) { r.click(); return true; } return false; }); await sleep(350);
  ok(viaPlus && await win.evaluate(() => !!document.querySelector('#modal:not([hidden]) [data-wgallery]')), '«+» menu has «Widget…» and it opens the gallery');
  await win.keyboard.press('Escape'); await sleep(200);
  // add the other four (programmatic placement, the data is what matters here)
  const ids = await win.evaluate(() => {
    const out = {}; const place = { subs: [-1000, -400], calendar: [0, -400], today: [-1000, 60], tag: [-400, 60] };
    out.reminders = Store.items().find((i) => i.type === 'widget' && i.wkind === 'reminders').id;
    const r = Store.get(out.reminders); r.x = -540; r.y = -400; Items.mount(r);
    for (const [k, [x, y]] of Object.entries(place)) { const it = Widgets.add(k, 'm', k === 'tag' ? { wtag: 'ιδέες' } : undefined); it.x = x; it.y = y; Items.mount(it); out[k] = it.id; }
    Store.save(true); Canvas.deselect && Canvas.deselect(); Canvas.fit && Canvas.fit(null, false, 60); return out;
  });
  await sleep(900);
  const W = await win.evaluate((ids) => {
    const g = (id) => document.querySelector(`.item[data-id="${id}"]`); const tx = (id) => (g(id) || {}).innerText || '';
    const S = NyxCalc.subsSummary(Store.state.subs, { lang: LANG });
    const cal = g(ids.calendar); const todayCell = cal && cal.querySelector('.wg-cal .today, [data-wday].today');
    return { states: Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, (g(id) && g(id).querySelector('.wg-body') || {}).dataset?.wstate])),
      today: tx(ids.today), subs: tx(ids.subs), subsTotal: (g(ids.subs) && g(ids.subs).querySelector('[data-wsubs-total]') || {}).textContent || '', panelTotal: S.totalText,
      rem: tx(ids.reminders), remRows: g(ids.reminders) ? g(ids.reminders).querySelectorAll('.wg-row').length : 0,
      calToday: todayCell ? todayCell.textContent.trim() : '', calDots: cal ? cal.querySelectorAll('.k-sub, .k-reminder, .k-countdown, .k-show, [class*="k-"]').length : 0, calTitle: cal ? (cal.querySelector('.wg-chip, .wg-cal-m, [data-wmonth]') || {}).textContent : '',
      tag: tx(ids.tag), tagRows: g(ids.tag) ? g(ids.tag).querySelectorAll('.wg-row').length : 0, d: new Date().getDate() };
  }, ids);
  ok(Object.values(W.states).every((s) => s === 'ok'), 'all 5 widgets painted (state ok)', W.states);
  ok(/Πότισμα φυτών/.test(W.today) && /Τηλέφωνο στον λογιστή/.test(W.today + W.rem), 'Σήμερα: today\'s reminder; tomorrow listed', W.today);
  ok(W.subsTotal && W.subsTotal.replace(/\s/g, '') === String(W.panelTotal).replace(/\s/g, '') && /Υπηρεσία ταινιών Α/.test(W.subs), 'Συνδρομές: same monthly total as the Subscriptions panel (' + W.panelTotal + ') + next charges', { w: W.subsTotal, p: W.panelTotal, txt: W.subs });
  ok(W.remRows >= 3 && /Γενέθλια φίλου/.test(W.rem), 'Υπενθυμίσεις: ≥3 rows incl. the birthday', W.rem);
  ok(W.calToday === String(W.d) && W.calDots > 0, 'Ημερολόγιο: today (' + W.d + ') marked, dots for events', W);
  ok(W.tagRows === 2 && /σαλόνι/.test(W.tag) && /δώρο/.test(W.tag), '#ιδέες: exactly the 2 tagged cards', W.tag);
  await shot(win, 'v270-widgets.png');
  // calendar: next month and back (view only, no undo step)
  const steps0 = await win.evaluate(() => (NyxUndo && NyxUndo.size ? NyxUndo.size() : (Store.hist ? Store.hist.length : null)));
  const mon = (id) => win.evaluate((id) => (document.querySelector(`.item[data-id="${id}"] .wg-cal-head b`) || {}).textContent || '', id);
  const mStart = await mon(ids.calendar); await win.click(`.item[data-id="${ids.calendar}"] [data-act=w-next]`).catch(() => {}); await sleep(300);
  const m1 = await mon(ids.calendar);
  await win.click(`.item[data-id="${ids.calendar}"] [data-act=w-prev]`); await sleep(250);
  const m0 = await mon(ids.calendar);
  ok(mStart && m1 && m1 !== mStart && m0 === mStart, 'Ημερολόγιο: › shows another month, ‹ comes back', { mStart, m1, m0 });
  // a #tag row click opens that card
  await win.click(`.item[data-id="${ids.tag}"] .wg-row`); await sleep(500);
  ok(await win.evaluate(() => ['t1', 't2'].some((id) => Canvas.sel && Canvas.sel.has(id))), '#tag row click → the card is selected / focused');

  // ---- 3) ⋯ menu ----
  const openMenu = async (id) => { await win.evaluate((id) => { Panels.closeMenu && Panels.closeMenu(); const r = document.querySelector(`.item[data-id="${id}"]`).getBoundingClientRect(); if (r.top < 80 || r.bottom > innerHeight - 60 || r.left < 0 || r.right > innerWidth - 300) { Canvas.focusItem(id); } }, id); await sleep(500); await win.click(`.item[data-id="${id}"] .wg-more`); await sleep(250); };
  await openMenu(ids.today);
  const mrows = await win.evaluate(() => { const m = document.querySelector('#ctxmenu'); return { kind: m.dataset.menu, rows: [...m.querySelectorAll('[data-wmi]')].map((b) => b.dataset.wmi) }; });
  ok(mrows.kind === 'widget' && ['sz-s', 'sz-m', 'sz-l', 'collapse', 'pin', 'lock', 'del'].every((x) => mrows.rows.includes(x)), '⋯ menu: sizes, collapse, pin, lock, remove', mrows);
  await win.click('#ctxmenu [data-wmi=sz-s]'); await sleep(300);
  let it = await win.evaluate((id) => { const i = Store.get(id); const n = document.querySelector(`.item[data-id="${id}"]`); return { s: i.wsize, w: i.w, h: i.h, cls: n.className }; }, ids.today);
  ok(it.s === 's' && it.w === 240 && /wsz-s/.test(it.cls), 'size S → 240 wide, class wsz-s', it);
  await openMenu(ids.today); await win.click('#ctxmenu [data-wmi=sz-l]'); await sleep(300);
  it = await win.evaluate((id) => Store.get(id).wsize + ' ' + Store.get(id).w, ids.today); ok(it === 'l 440', 'size L → 440', it);
  await openMenu(ids.today); await win.click('#ctxmenu [data-wmi=collapse]'); await sleep(300);
  it = await win.evaluate((id) => { const i = Store.get(id); return { c: i.wcollapsed, h: i.h, cls: document.querySelector(`.item[data-id="${id}"]`).className }; }, ids.today);
  ok(it.c === true && it.h === 46 && /wg-collapsed/.test(it.cls), 'collapse → header only (46 px)', it);
  await openMenu(ids.today); await win.click('#ctxmenu [data-wmi=collapse]'); await sleep(300);
  it = await win.evaluate((id) => ({ c: !!Store.get(id).wcollapsed, h: Store.get(id).h }), ids.today); ok(!it.c && it.h === 380, 'expand → back to L height', it);
  await openMenu(ids.today); await win.click('#ctxmenu [data-wmi=pin]'); await sleep(300);
  ok(await win.evaluate((id) => Store.get(id).pinned === true, ids.today), 'pin → it.pinned (shown in the Widget window)');
  await openMenu(ids.today); await win.click('#ctxmenu [data-wmi=lock]'); await sleep(300);
  ok(await win.evaluate((id) => Store.get(id).locked === true, ids.today), 'lock → locked');
  await openMenu(ids.today); await win.click('#ctxmenu [data-wmi=lock]'); await sleep(300);
  await openMenu(ids.subs); await win.click('#ctxmenu [data-wmi=del]'); await sleep(450);
  const del = await win.evaluate((id) => ({ gone: !Store.get(id), inBin: (Store.state.bin || []).some((e) => e.id === id) }), ids.subs);
  ok(del.gone && del.inBin, 'remove → the widget goes to the Bin (nothing deleted)', del);
  await win.evaluate(() => document.body.focus()); await win.keyboard.press('Control+z'); await sleep(600);
  const back = await win.evaluate((id) => ({ back: !!Store.get(id), inBin: (Store.state.bin || []).some((e) => e.id === id), painted: !!document.querySelector(`.item[data-id="${id}"] .wg-body[data-wstate=ok]`) }), ids.subs);
  ok(back.back && !back.inBin && back.painted, 'Ctrl+Z → the widget is back, painted, and out of the Bin', back);

  // ---- 4) loading / error ----
  await win.evaluate((id) => { window.__fail = true; Widgets.providers.reminders = () => new Promise((res, rej) => setTimeout(() => (window.__fail ? rej(new Error('δοκιμαστικό σφάλμα')) : res(null)), 1200)); Widgets.refreshAll(); }, ids.reminders); await sleep(300);
  const ld = await win.evaluate((id) => { const b = document.querySelector(`.item[data-id="${id}"] .wg-body`); return { st: b.dataset.wstate, sk: !!b.querySelector('.wg-skel, .skel, [class*=skel]') }; }, ids.reminders);
  ok(ld.st === 'loading' && ld.sk, 'slow source → loading state with a skeleton', ld);
  await shot(win, 'v270-loading.png');
  await sleep(1300);
  const er = await win.evaluate((id) => { const b = document.querySelector(`.item[data-id="${id}"] .wg-body`); return { st: b.dataset.wstate, txt: b.innerText, retry: !!b.querySelector('[data-act=w-retry]') }; }, ids.reminders);
  ok(er.st === 'error' && /Δεν φόρτωσε|didn.t load/i.test(er.txt) && er.retry, 'failing source → «Δεν φόρτωσε» + «Ξανά»', er);
  await shot(win, 'v270-error.png');
  await win.evaluate(() => { window.__fail = false; delete Widgets.providers.reminders; });
  await win.click(`.item[data-id="${ids.reminders}"] [data-act=w-retry]`); await sleep(500);
  ok(await win.evaluate((id) => document.querySelector(`.item[data-id="${id}"] .wg-body`).dataset.wstate === 'ok', ids.reminders), '«Ξανά» → ok again');

  // ---- 5a) board delete + undo → Bin ----
  const bres = await win.evaluate(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms)); const binIds = () => (Store.state.bin || []).map((e) => e.id).filter((x) => /^bx/.test(x)).sort().join();
    Store.state.boards.push({ id: 'bx', name: 'Δοκιμή', emoji: '🧪', color: '#7c8cff', view: { x: 0, y: 0, z: 1 }, items: [{ id: 'bx1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, html: 'ένα' }, { id: 'bx2', type: 'sticky', x: 300, y: 0, w: 200, h: 200, html: 'δύο' }] });
    Store.save(true); Panels.tabs(); const out = {};
    const del = async () => { document.querySelectorAll('.toast').forEach((t) => t.remove()); App.deleteBoard(Store.state.boards.find((b) => b.id === 'bx')); await sl(200); document.querySelector('#modal .btn.primary')?.click(); await sl(300); };
    await del(); out.afterDel = binIds(); out.gone = !Store.state.boards.some((b) => b.id === 'bx');
    App.undo(); await sl(500); out.afterUndo = binIds(); out.back = Store.state.boards.filter((b) => b.id === 'bx').length; out.badge = document.querySelector('#z-bin').dataset.count;
    await del(); [...document.querySelectorAll('.toast button')].find((x) => /Αναίρεση|Undo/.test(x.textContent))?.click(); await sl(500);
    out.afterToast = binIds(); out.back2 = Store.state.boards.filter((b) => b.id === 'bx').length; out.items = (Store.state.boards.find((b) => b.id === 'bx') || { items: [] }).items.map((i) => i.id).join();
    return out;
  });
  ok(bres.gone && bres.afterDel === 'bx1,bx2', 'board delete → its 2 cards in the Bin', bres);
  ok(bres.back === 1 && bres.afterUndo === '' && bres.badge === String(await win.evaluate(() => (Store.state.bin || []).length)), 'Ctrl+Z / «Αναίρεση» → board back, its cards leave the Bin, badge updated', bres);
  ok(bres.back2 === 1 && bres.afterToast === '' && bres.items === 'bx1,bx2', 'toast «Αναίρεση» → board back once (no duplicate), cards out of the Bin', bres);

  // ---- 5b) Hub: size + VRAM ----
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('perf:snapshot'); ipcMain.handle('perf:snapshot', () => ({ ok: true, gpu: { adapter: { name: 'AMD Radeon RX 7900 XTX', total: 25753026560, used: 23622320128 }, procs: [
    { pid: 4100, name: 'llama-server', path: 'C:\\llama\\llama-server.exe', owner: 'llama', vram: 21474836480 }, { pid: 5200, name: 'llama-server', path: 'D:\\GPU-Voice-Studio\\bin\\llama-server.exe', owner: '', vram: 1073741824 },
    { pid: 3000, name: 'Nyx Canvas', owner: 'nyx:GPU', vram: 322122547 }, { pid: 900, name: 'dwm', owner: '', vram: 214748364 }] }, servers: [], procs: [] })); });
  await win.evaluate(() => Hub.open()); await sleep(300);
  await win.evaluate(() => document.querySelector('[data-hub-tab=status]')?.click()); await sleep(1800);
  const hv = await win.evaluate(() => ({ b: (document.querySelector('[data-st=vram]') || {}).textContent, sub: (document.querySelector('[data-st=vram-sub]') || {}).textContent, src: (document.querySelector('[data-st=vram]') || { dataset: {} }).dataset.vramSrc, title: (document.querySelector('[data-st=vram-sub]') || {}).title }));
  ok(hv.src === 'procs' && /^21,5 GB$/.test(hv.b || '') && /llama-server 20,0/.test(hv.sub || '') && /Voice Studio/.test(hv.title || ''), 'Hub status VRAM = sum of the real processes (21,5 GB = 20 + 1 + 0,3 + 0,2), top processes listed, card total only in the tooltip', hv);
  await shot(win, 'v270-hub-status.png');
  await win.evaluate(() => document.querySelector('[data-hub-tab=models]')?.click());
  await win.waitForFunction(() => document.querySelectorAll('.hub-model[data-mstate]').length >= 2, null, { timeout: 15000 }).catch(() => {}); await sleep(1500);
  const q = await win.evaluate(() => { const c = [...document.querySelectorAll('.hub-model[data-mstate]')].find((x) => /Qwen3\.8/.test(x.innerText)); return c ? [...c.querySelectorAll('.hub-chips > *')].map((x) => ({ t: x.textContent.trim(), src: x.dataset.vramSrc || '' })) : null; });
  ok(q && q.some((x) => x.t === '17,7 GB') && !q.some((x) => /^1,7 GB$/.test(x.t)), 'Hub Qwen card: 17,7 GB from the model file (not the 1,68 GB MTP draft, not hard-coded)', q);
  ok(q && q.some((x) => x.t === 'VRAM 20,0' && x.src === 'procs'), 'Hub Qwen VRAM chip = the router\'s llama-server process (Voice Studio\'s llama-server excluded)', q);
  await shot(win, 'v270-hub-models.png');
  await win.evaluate(() => { try { Hub.close(); } catch (e) {} });

  // ---- 5c) assistant: no Voice Studio line ----
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('perf:snapshot'); ipcMain.handle('perf:snapshot', () => ({ ok: true, gpu: { adapter: { total: 25753026560, used: 25000000000 }, procs: [{ pid: 5200, name: 'python', path: 'D:\\GPU-Voice-Studio\\venv\\python.exe', owner: '', vram: 9e9 }] }, servers: [], procs: [] })); });
  const as = await win.evaluate(async () => { const sl = (ms) => new Promise((r) => setTimeout(r, ms)); try { Assistant.open ? Assistant.open() : document.querySelector('#btn-assistant')?.click(); } catch (e) {} await sl(1500); const p = document.querySelector('#assistant, .assistant, [data-assistant]'); return { open: !!p, txt: p ? p.innerText : '' }; });
  ok(as.open && !/Voice Studio/.test(as.txt), 'assistant chat: no «Voice Studio» warning', as.txt.slice(0, 300));
  await win.evaluate(() => { try { Assistant.close && Assistant.close(); } catch (e) {} document.querySelector('#assistant .x, .assistant .close')?.click?.(); });

  // ---- 6) small window ----
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1024, height: 700 })); await sleep(600);
  await win.evaluate(() => { Canvas.fit && Canvas.fit(null, false, 40); }); await sleep(500);
  await shot(win, 'v270-widgets-small.png');
  await win.click('#btn-widgets'); await sleep(450);
  const gs = await win.evaluate(() => { const r = document.querySelector('#modal .modal-box').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, W: innerWidth, H: innerHeight }; });
  ok(gs.l >= 0 && gs.t >= 0 && gs.r <= gs.W && gs.b <= gs.H, '1024×700: gallery inside the window', gs);
  await shot(win, 'v270-gallery-small.png');
  await win.keyboard.press('Escape'); await sleep(200);
  const keys1 = await win.evaluate(() => Object.keys(Store.state.settings).sort().join());
  ok(keys0.split(',').every((k) => keys1.split(',').includes(k)), 'settings keys: nothing removed or renamed');
  ok(!errs.length, 'no page errors', errs.slice(0, 5));
  await quit(app); router.srv.close();
  console.log(`\nv2.7.0 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
