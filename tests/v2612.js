'use strict';
// v2.6.12 UI (Electron, Chromium sandbox on):
//  1) tabs: fill the bar, then 3 new tabs (real «+» clicks) → the 3 are in «+N ▾»; first tabs unchanged; active highlighted
//     in the menu (aria-current) and «+N ▾» marked; menu titles one line + ellipsis + tooltip; wheel; order; narrow active count
//  2) palette: many changes (SV drag, hue, swatches) WITHOUT reopening — the flyout is never rebuilt (no opts() call), the
//     palette stays open, hex / recent colours right, a drawn stroke uses the final colour
//  3) Library: «/» focuses search (not while typing elsewhere), arrows move a visible selection, Enter inserts, 8 columns,
//     tabs on one line, real counter, tool keys do nothing while typing in the search
//  4) Hub: chips from real data or «—», vision + mmproj, key card never shows the key (Copy puts it in the clipboard), port
//     card, router log redacted, no «--models-max», one «Εργαλεία v2.5»; shapes flyout centred; paper icons + tooltip
//  5) small window 1024×700; regressions: assistant, Ctrl+Z/Y, Bin, subscriptions, MCP, settings, restart
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2612-'));
const SHOTS = path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0, passes = 0;
const T0 = Date.now(); const ok = (c, m, x) => { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QWEN = 'Qwen3.8-27B-UD-Q4_K_XL';
const MODELS = { [QWEN]: 'loaded', 'gemma-4-12B-it-Q4_0': 'unloaded', 'llama-krikri-8b-instruct-q8_0': 'unloaded' };

function startRouter() {
  const st = { chats: 0, maxInstances: 1 };
  const srv = http.createServer((q, resp) => {
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    const u = new URL(q.url, 'http://x'); const model = u.searchParams.get('model');
    if (u.pathname === '/v1/models' || u.pathname === '/models') return send(200, { object: 'list', data: Object.entries(MODELS).map(([id, v]) => ({ id, object: 'model', status: { value: v, args: ['llama-server', '-c', '32768', '-np', '1'] } })) });
    if (u.pathname === '/health') return send(200, { status: 'ok' });
    if (u.pathname === '/slots') return send(200, [{ id: 0, n_ctx: 32768 }]);
    if (u.pathname === '/props') return model ? send(200, { default_generation_settings: { n_ctx: 32768 }, total_slots: 1 }) : send(200, { role: 'router', max_instances: st.maxInstances, default_generation_settings: { n_ctx: 0 }, build_info: 'b12230' });
    let b = ''; q.on('data', (d) => b += d); q.on('end', () => {
      if (/tokenize/.test(u.pathname)) return send(200, { tokens: [1, 2, 3] });
      if (/chat\/completions/.test(u.pathname)) {
        st.chats++;
        resp.writeHead(200, { 'content-type': 'text/event-stream' });
        resp.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Γεια σου, απαντώ κανονικά.' }, finish_reason: 'stop' }], timings: { prompt_n: 40, prompt_ms: 20, predicted_n: 6, predicted_ms: 100 } }) + '\n\n');
        return resp.end('data: [DONE]\n\n');
      }
      send(404, { error: 'no' });
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port, st })));
}
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => (window.__nyxV2Ready === true || window.__nyxV25Ready === true) && window.__nyxLook2611 === true, null, { timeout: 30000 });
  await win.waitForTimeout(500);
  return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const setSize = async (app, win, w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => { const x = BrowserWindow.getAllWindows()[0]; x.setSize(w, h); }, [w, h]); await sleep(500); };
const shot = (win, name) => win.screenshot({ path: path.join(SHOTS, name) }).then(() => path.join(SHOTS, name)).catch(() => '');
const MDIR = path.join(DATA, 'models');
for (const [dir, f, sz] of [[QWEN, QWEN + '.gguf', 16.2e9], [QWEN, 'mmproj-Qwen3.8-27B.gguf', 0.9e9], ['llama-krikri-8b-instruct-q8_0', 'llama-krikri-8b-instruct-q8_0.gguf', 8.1e9], ['gemma-4-12B-it-Q4_0', 'gemma-4-12B-it-Q4_0.gguf', 7.3e9]]) {
  fs.mkdirSync(path.join(MDIR, dir), { recursive: true }); const p = path.join(MDIR, dir, f); fs.writeFileSync(p, ''); fs.truncateSync(p, sz); // sparse
}
const vis = (win) => win.evaluate(() => {
  const ids = Store.state.boards.map((b) => b.id); const T = document.querySelector('#tabs'); const more = document.querySelector('#tabs-more');
  const v = [...T.querySelectorAll('.tab')].filter((x) => !x.hidden);
  return { vis: v.map((x) => ids.indexOf(x.dataset.board)), hid: (TabStrip._hidden || []).map((b) => ids.indexOf(b.id)), n: ids.length, active: ids.indexOf(Store.state.active),
    moreShown: !more.hidden, moreActive: more.classList.contains('has-active'), moreLabel: more.getAttribute('aria-label') || '', tops: [...new Set(v.map((x) => Math.round(x.getBoundingClientRect().top)))].length };
});

(async () => {
  const router = await startRouter();
  let { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(['2.6.12', '2.6.12.1', '2.6.12.2', '2.6.13', '2.6.13.1', '2.7.0', '2.7.1', '2.7.1.1'].includes(String(ver)), 'app version 2.6.12', ver);
  const before = await win.evaluate((a) => {
    const A = Store.state.settings.ai; const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + a.port + '/v1';
    for (const k of ['commands', 'chat', 'vision', 'summarize', 'greek', 'private']) A.tasks[k] = { p: 'llama', m: a.QWEN };
    Object.assign(A.servers.llama, { ctx: 32768, port: a.port, extra: '--models-max 1', modelsDir: a.MDIR }); A.assistant.thinking = false;
    Store.state.subs = [{ id: 's1', name: 'Netflix', price: 13.99, currency: 'EUR', cycle: 'monthly', next: '2026-11-20', active: true, color: '#e50914', icon: '🎬' }];
    Store.save(true);
    const s = JSON.parse(JSON.stringify(Store.state.settings));
    return { settingsKeys: Object.keys(s).sort(), subs: JSON.stringify(Store.state.subs) };
  }, { port: router.port, QWEN, MDIR });

  // ---- 1) tabs ----
  // fill the bar exactly: add boards while everything still fits
  const nFit = await win.evaluate(async () => {
    const B = Store.state.boards; let i = 0;
    while (i < 60) { B.push({ id: 'f' + i, name: 'Πίνακας ' + (B.length + 1), emoji: '📁', color: '#7c8cff', view: null, items: [] }); Panels.tabs(); TabStrip.layout(); i++; if (!document.querySelector('#tabs-more').hidden) { B.pop(); Panels.tabs(); TabStrip.layout(); break; } }
    App.switchBoard(B[0].id); Store.save(true); return B.length;
  });
  await sleep(300);
  let v0 = await vis(win);
  ok(!v0.moreShown && v0.vis.length === nFit && v0.tops === 1, `bar full: ${nFit} tabs, all visible, no «+N ▾» yet`, v0);
  const newIds = [];
  for (let k = 0; k < 3; k++) { await win.click('#btn-add-tab'); await sleep(450); await win.keyboard.press('Escape'); await sleep(150); newIds.push(await win.evaluate(() => Store.state.active)); }
  let v1 = await vis(win);
  const newIdx = await win.evaluate((ids) => ids.map((id) => Store.state.boards.findIndex((b) => b.id === id)), newIds);
  ok(v1.n === nFit + 3 && newIdx.every((i) => v1.hid.includes(i)), 'created 3 new tabs → all 3 are in «+N ▾»', { v1, newIdx });
  ok(v1.vis.every((x, i) => x === i) && v1.vis[0] === 0 && v1.tops === 1, 'the FIRST tabs stay in the bar (in order, one line)', v1);
  ok(v1.active === newIdx[2] && v1.moreActive && /ενεργή|active/i.test(v1.moreLabel), 'active (newest) is in the menu: «+N ▾» highlighted, aria says so', v1);
  await shot(win, 'v2612-tabs-full-plus3.png');
  // a long name for the last board → one line + ellipsis + full title in the menu
  const LONG = 'Ένας πολύ πολύ μεγάλος τίτλος πίνακα που δεν χωράει ποτέ σε μία γραμμή του μενού';
  await win.evaluate((n) => { const B = Store.state.boards; B[B.length - 1].name = n; Store.save(); Panels.tabs(); }, LONG); await sleep(200);
  await win.click('#tabs-more'); await sleep(300);
  const menu = await win.evaluate(() => {
    const m = document.querySelector('#ctxmenu'); const items = [...m.querySelectorAll('.mi[data-board]')]; const on = m.querySelector('.mi.on');
    const last = items[items.length - 1]; const lab = last && (last.querySelector('.mi-l, .mi-t, span:not(.mi-emo):not(.mi-k)') || last); const cs = getComputedStyle(lab);
    return { kind: m.dataset.menu, n: items.length, ids: items.map((x) => x.dataset.board), onId: on && on.dataset.board, onCur: on && on.getAttribute('aria-current'), focus: document.activeElement && document.activeElement.dataset.board,
      lastTitle: last && last.title, lastH: last && Math.round(last.getBoundingClientRect().height), ellipsis: cs.textOverflow, ws: cs.whiteSpace, overflow: lab.scrollWidth > lab.clientWidth };
  });
  ok(menu.kind === 'tabs-more' && menu.n === v1.hid.length && newIds.every((id) => menu.ids.includes(id)), 'menu lists exactly the hidden boards, incl. the 3 new ones', menu);
  ok(menu.onId === newIds[2] && menu.onCur === 'page' && menu.focus === newIds[2], 'active board highlighted in the menu (.on, aria-current) and focused', menu);
  ok(menu.lastTitle === LONG && menu.ellipsis === 'ellipsis' && menu.ws === 'nowrap' && menu.lastH <= 40 && menu.overflow, 'long title: one line with ellipsis, full name in the tooltip', menu);
  await shot(win, 'v2612-tabs-menu.png');
  await win.keyboard.press('Escape'); await sleep(150);
  // picking a first-row board from the bar keeps everything; picking from the menu keeps the first tabs
  await win.evaluate(() => App.switchBoard(Store.state.boards[1].id)); await sleep(200);
  let v2 = await vis(win);
  ok(v2.vis.join() === v1.vis.join() && !v2.moreActive, 'switching to a visible tab: nothing moves, «+N ▾» not highlighted', v2);
  // wheel + order
  await win.mouse.move(250, 15); await win.mouse.wheel(0, 120); await sleep(250);
  const w1 = await vis(win); await win.mouse.wheel(0, -120); await sleep(250); const w2 = await vis(win);
  ok(w1.vis[0] === 1 && w2.vis[0] === 0, 'wheel scrolls the strip by one tab and back', { w1: w1.vis, w2: w2.vis });
  const ord = await win.evaluate(() => [...document.querySelector('#tabs-zone').children].map((x) => x.id).join());
  ok(ord === 'tabs,btn-add-tab,tabs-more', 'order tabs → «+» → «+N ▾»', ord);
  // keyboard on «+N ▾» when the active board is in it
  await win.evaluate(() => { App.switchBoard(Store.state.boards[Store.state.boards.length - 1].id); }); await sleep(200);
  await win.evaluate(() => document.querySelector('#tabs-more').focus()); await win.keyboard.press('Home'); await sleep(250);
  const home = await win.evaluate(() => ({ a: Store.state.boards.findIndex((b) => b.id === Store.state.active), f: document.activeElement && document.activeElement.classList.contains('tab') }));
  ok(home.a === 0 && home.f, 'Home on «+N ▾» (active in the menu) → first board, focus back on its tab', home);

  // ---- 2) palette ----
  await win.evaluate(() => { document.querySelector('#viewport').focus(); Tools.pick('pen'); }); await sleep(300);
  await win.evaluate(() => { document.querySelector('#toolopts').dataset.probe = 'same'; window.__opts = 0; const o = Tools.opts.bind(Tools); Tools.opts = (...a) => { window.__opts++; return o(...a); }; });
  await win.click('#toolopts .sw.custom[data-picker]'); await sleep(300);
  const pk = async () => win.evaluate(() => ({ picker: !!document.querySelector('.fo-picker'), fly: !document.querySelector('#toolopts').hidden && document.querySelector('#toolopts').dataset.probe === 'same', opts: window.__opts,
    color: Store.state.settings.penColor, hex: document.querySelector('#toolopts .fo-hex').value.toUpperCase(), val: (document.querySelector('.fo-picker .pk-val') || {}).textContent, recent: (Store.state.settings.recentColors || {}).pen || [],
    recentDom: [...document.querySelectorAll('#toolopts .sw.recent')].map((b) => b.dataset.recent) }));
  let p = await pk();
  ok(p.picker && p.fly, 'palette opened inside the pen flyout', p);
  const svr = await win.evaluate(() => { const r = document.querySelector('.fo-picker .pk-sv').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const seen = [];
  for (const [fx, fy] of [[0.9, 0.1], [0.5, 0.3], [0.2, 0.6], [0.8, 0.2], [0.65, 0.15]]) {
    await win.mouse.move(svr.x + svr.w * fx, svr.y + svr.h * fy); await win.mouse.down(); await win.mouse.move(svr.x + svr.w * (fx - 0.05), svr.y + svr.h * (fy + 0.05), { steps: 3 }); await win.mouse.up(); await sleep(120);
    p = await pk(); seen.push(p.color);
    if (!p.picker || !p.fly) break;
  }
  ok(p.picker && p.fly && p.opts === 0 && new Set(seen).size === 5, '5 changes in the palette square: palette and flyout stay open, flyout never rebuilt (opts() 0×)', { p, seen });
  ok(p.hex === p.color && p.val === p.color, 'hex field and palette value show the current colour', p);
  ok(p.recent[0] === p.color && p.recent.length <= 4 && new Set(p.recent).size === p.recent.length && p.recentDom.join() === p.recent.join(), 'recent colours: newest first, ≤ 4, no duplicates, row matches', p);
  // hue slider + swatches while the palette is open
  await win.evaluate(() => { const r = document.querySelector('.fo-picker .pk-hue'); for (const v of [30, 90, 200]) { r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); } r.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(150);
  const afterHue = await pk();
  await win.evaluate(() => document.querySelectorAll('#toolopts .sw[data-c]')[4].click()); await sleep(120);
  await win.evaluate(() => document.querySelectorAll('#toolopts .sw[data-c]')[9].click()); await sleep(120);
  p = await pk();
  const sw9 = await win.evaluate(() => document.querySelectorAll('#toolopts .sw[data-c]')[9].dataset.c.toUpperCase()); p.color = String(p.color).toUpperCase();
  ok(afterHue.color !== seen[4] && p.color === sw9 && p.picker && p.fly && p.opts === 0, 'hue slider and 2 swatches while open: colour follows, palette + flyout stay, no rebuild', { afterHue: afterHue.color, p, sw9 });
  ok(p.recent[0] === sw9 && p.recent.length === 4 && p.hex === sw9, 'recent + hex after the swatches', p);
  await shot(win, 'v2612-palette-open.png');
  // draw: the stroke takes the final colour
  const nInk = await win.evaluate(() => Store.items().filter((i) => i.type === 'ink').length);
  await win.mouse.move(700, 600); await win.mouse.down(); await win.mouse.move(820, 650, { steps: 8 }); await win.mouse.up(); await sleep(300);
  const ink = await win.evaluate(() => { const a = Store.items().filter((i) => i.type === 'ink'); return { n: a.length, color: a.length && String(a[a.length - 1].color).toUpperCase() }; });
  ok(ink.n === nInk + 1 && String(ink.color).toUpperCase() === sw9, 'drawing uses the final colour', { ink, sw9 });
  ok(!(await win.evaluate(() => !!document.querySelector('.fo-picker'))), 'a click on the canvas closes the palette (outside)');
  // Esc closes the palette, the flyout stays
  await win.click('#toolopts .sw.custom[data-picker]'); await sleep(200); await win.keyboard.press('Escape'); await sleep(150);
  p = await pk(); ok(!p.picker && p.fly, 'Esc closes only the palette', p);
  await win.evaluate(() => { Tools.pick('select'); });

  // ---- 3) Library ----
  await win.evaluate(() => document.querySelector('#viewport').focus()); await win.keyboard.press('Control+e'); await sleep(900);
  const lib0 = await win.evaluate(() => {
    const d = document.querySelector('#drawer'); const tabs = [...d.querySelectorAll('.lib-tabs button')]; const cells = [...d.querySelectorAll('#lib-grid > button')];
    const xs = new Set(cells.slice(0, 16).map((c) => Math.round(c.getBoundingClientRect().left))); const f = d.querySelector('[data-lib-count]');
    return { kind: d.dataset.kind, tops: new Set(tabs.map((b) => Math.round(b.getBoundingClientRect().top))).size, icons: tabs.every((b) => b.querySelector('svg') && b.textContent.trim()), cols: [...xs].filter((x) => x <= Math.min(...xs) + 8 * 80).length,
      firstRowCols: cells.filter((c) => Math.round(c.getBoundingClientRect().top) === Math.round(cells[0].getBoundingClientRect().top)).length,
      shown: +f.dataset.shown, total: +f.dataset.total, cells: cells.length, all: NYX_DATA.emoji.length, slash: !!d.querySelector('.lib-slash'), enter: !!d.querySelector('.lib-enter'), sel: d.querySelectorAll('#lib-grid > .sel').length,
      right: Math.round(innerWidth - d.getBoundingClientRect().right) };
  });
  ok(lib0.kind === 'library' && lib0.right <= 16 && lib0.tops === 1 && lib0.icons, 'Library: right drawer, tabs icon + name on one line', lib0);
  ok(lib0.firstRowCols === 8, '8 columns', lib0);
  ok(lib0.shown === lib0.cells && lib0.total === lib0.all && lib0.slash && lib0.enter && lib0.sel === 1, 'real counter (cells / all emoji), «/» hint, «Enter εισαγωγή», one selected cell', lib0);
  // «/» while typing in the assistant field: types a slash, does not jump
  await win.evaluate(() => { Store.state.chat = []; Assistant.show(); Assistant.render(); }); await sleep(300);
  await win.click('#as-q'); await win.keyboard.type('a/b'); await sleep(100);
  const typed = await win.evaluate(() => ({ v: document.querySelector('#as-q').value, f: document.activeElement.id }));
  ok(typed.v === 'a/b' && typed.f === 'as-q', '«/» while typing in another field: just a slash, focus stays', typed);
  await win.evaluate(() => { document.querySelector('#as-q').value = ''; Assistant.hide(); document.querySelector('#viewport').focus(); }); await sleep(150);
  await win.keyboard.press('/'); await sleep(150);
  const sl = await win.evaluate(() => ({ f: document.activeElement === document.querySelector('#drawer .lib-search input'), v: document.querySelector('#drawer .lib-search input').value }));
  ok(sl.f && sl.v === '', '«/» focuses the Library search (no slash typed)', sl);
  // tool keys do nothing while typing in the search
  const toolB = await win.evaluate(() => Tools.cur); await win.keyboard.type('r4'); await sleep(250);
  const toolA = await win.evaluate(() => ({ cur: Tools.cur, v: document.querySelector('#drawer .lib-search input').value }));
  ok(toolA.cur === toolB && toolA.v === 'r4', 'typing «r4» in the search: no tool shortcut fires', { toolB, toolA });
  await win.evaluate(() => { const q = document.querySelector('#drawer .lib-search input'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(500);
  await win.keyboard.press('ArrowDown'); await sleep(100); await win.keyboard.press('ArrowRight'); await sleep(100); await win.keyboard.press('ArrowDown'); await sleep(150);
  const nav = await win.evaluate(() => { const cells = [...document.querySelectorAll('#lib-grid > button')]; const s = cells.findIndex((c) => c.classList.contains('sel')); const g = document.querySelector('#lib-grid').getBoundingClientRect(); const r = cells[s] && cells[s].getBoundingClientRect(); return { s, n: document.querySelectorAll('#lib-grid > .sel').length, aria: cells[s] && cells[s].getAttribute('aria-selected'), visible: !!r && r.top >= g.top - 1 && r.bottom <= Math.max(g.bottom, innerHeight) + 1, focus: document.activeElement === cells[s], emo: cells[s] && cells[s].textContent }; });
  ok(nav.n === 1 && nav.aria === 'true' && nav.visible && nav.s >= 8, `arrows: visible selection moves (cell ${nav.s})`, nav);
  const nItems = await win.evaluate(() => Store.items().length);
  await win.keyboard.press('Enter'); await sleep(400);
  const ins = await win.evaluate((emo) => { const a = Store.items(); const last = a[a.length - 1]; return { n: a.length, has: JSON.stringify(last || {}).includes(emo) }; }, nav.emo);
  ok(ins.n === nItems + 1 && ins.has, 'Enter inserts the selected emoji', { ins, emo: nav.emo });
  await shot(win, 'v2612-library.png');
  await win.evaluate(() => Panels.closeDrawer()); await sleep(200);

  // ---- 4) shapes / paper ----
  await win.evaluate(() => { document.querySelector('#viewport').focus(); Tools.pick('shape'); }); await sleep(300);
  const cen = await win.evaluate(() => { const o = document.querySelector('#toolopts').getBoundingClientRect(); const b = document.querySelector('#dock .tool[data-tool=shape]').getBoundingClientRect(); const tb = document.querySelector('#titlebar').getBoundingClientRect().bottom; return { d: Math.round((o.top + o.bottom) / 2 - (b.top + b.bottom) / 2), top: Math.round(o.top), tb: Math.round(tb), bottom: Math.round(o.bottom), H: innerHeight }; });
  ok((Math.abs(cen.d) <= 2 || cen.top <= cen.tb + 9 || cen.bottom >= cen.H - 9) && cen.top >= cen.tb && cen.bottom <= cen.H, 'shapes flyout centred vertically on its button (clamped inside the window)', cen);
  await win.evaluate(() => Tools.pick('sticky')); await sleep(300);
  const pb = await win.evaluate(() => { const b = document.querySelector('#toolopts [data-pk=grid]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, labels: document.querySelectorAll('#toolopts .fo-label').length, txt: [...document.querySelectorAll('#toolopts [data-pk]')].every((x) => !x.textContent.trim()) }; });
  await win.mouse.move(pb.x, pb.y); await sleep(700);
  const tip = await win.evaluate(() => { const t = document.getElementById('tip'); return t && !t.hidden ? t.textContent : null; });
  ok(pb.labels === 0 && pb.txt && /Είδος χαρτιού/.test(tip || '') && /Τετραγωνισμένο/.test(tip || ''), 'paper kinds: icons only, «Είδος χαρτιού: …» in the tooltip', { pb, tip });
  await win.evaluate(() => Tools.pick('select'));

  // ---- 5) Hub ----
  await win.evaluate(() => Hub.open()); await sleep(300);
  await win.evaluate(() => document.querySelector('[data-hub-tab=status]')?.click());
  await win.waitForFunction(() => { const k = document.querySelector('[data-router-key-card]'); return k && k.dataset.state !== 'checking'; }, null, { timeout: 10000 }).catch(() => {});
  await sleep(600);
  const hs = await win.evaluate(() => {
    const p = document.querySelector('#hub, .hub, [data-hub]') || document.body; const txt = p.innerText; const k = document.querySelector('[data-router-key-card]');
    const tools = [...p.querySelectorAll('*')].filter((e) => e.children.length === 0 && /Εργαλεία v2\.5/.test(e.textContent) && e.offsetParent !== null).length;
    return { key: !!k, kstate: k && k.dataset.state, ktext: k && k.innerText, port: (document.querySelector('[data-router-port]') || {}).innerText, mm: /--models-max/.test(txt), tools, log: !!document.querySelector('[data-st=router-log]'), stat: (document.querySelector('.hub-stat, .hub-stats > *') || {}).innerText };
  });
  await app.evaluate(({ clipboard }) => clipboard.writeText('')).catch(() => {});
  await win.click('[data-router-key-card] .hk-copy'); await sleep(400);
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText()).catch(() => '');
  const html = await win.evaluate(() => document.documentElement.outerHTML);
  ok(hs.key && clip.length >= 16 && !html.includes(clip) && !html.includes(clip.slice(-4)) && !/••|\u2022/.test(hs.ktext), 'key card: Copy puts the key in the clipboard, the page never contains the key nor its last 4 characters', { hs, clipLen: clip.length });
  ok(new RegExp(':' + router.port).test(hs.port || ''), 'port card shows the router port', hs.port);
  ok(!hs.mm && hs.tools === 1, 'no «--models-max» text; «Εργαλεία v2.5» exactly once', hs);
  // router log: proc:status answer with secrets → shown redacted
  // the main process answers proc:status('llama') with a log that contains the key (as if Nyx had started the router)
  await app.evaluate(({ ipcMain }, k) => { ipcMain.removeHandler('proc:status'); ipcMain.handle('proc:status', (_e, key) => key === 'llama' ? { log: ['srv listening', 'POST /v1/chat Authorization: Bearer ' + k, 'args --api-key ' + k + ' -c 32768', 'GET /x?api_key=' + k], cmd: 'llama-server --api-key-file C:\\nyx\\router-api-key.txt' } : { log: [], cmd: '' }); }, clip || 'nyx-test-key-1234567890abcd');
  await win.evaluate(() => document.querySelector('[data-hub-tab=models]')?.click()); await sleep(300);
  await win.evaluate(() => document.querySelector('[data-hub-tab=status]')?.click()); await sleep(900);
  const lg = await win.evaluate(() => (document.querySelector('[data-st=router-log]') || {}).textContent || '');
  ok(/srv listening/.test(lg) && !lg.includes(clip || 'nyx-test-key-1234567890abcd') && /κρυφό|redacted|απόκρυψη|\[/.test(lg), 'router log shown read-only with the key redacted', lg);
  await shot(win, 'v2612-hub-status.png');
  await win.evaluate(() => document.querySelector('[data-hub-tab=models]')?.click());
  await win.waitForFunction(() => document.querySelectorAll('.hub-model[data-mstate]').length >= 3, null, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  const md = await win.evaluate(() => {
    const cards = [...document.querySelectorAll('.hub-model[data-mstate]')].map((c) => ({ name: (c.querySelector('.hub-mname') || {}).textContent, st: c.dataset.mstate, chips: [...c.querySelectorAll('.hub-chips > *')].map((x) => x.textContent.trim()) }));
    const mm = [...document.querySelectorAll('.hub-mmproj[data-mmproj]')].map((c) => c.innerText);
    return { cards, mm, strip: (document.querySelector('[data-st=disk-strip]') || {}).innerText };
  });
  const q = md.cards.find((c) => /Qwen3\.8/.test(c.name || '')) || {};
  const k8 = md.cards.find((c) => /krikri/.test(c.name || '')) || {};
  ok(q.st === 'loaded' && ['Q4_K_XL', '16,2 GB', 'ctx 32K'].every((x) => (q.chips || []).includes(x)) && (q.chips || []).some((x) => /t\/s/.test(x)) && (q.chips || []).some((x) => /^VRAM/.test(x)) && (q.chips || []).includes(':' + router.port), 'Qwen card: quant / GB / ctx / t/s / VRAM / port chips', q);
  ok((q.chips || []).some((x) => /όραση/.test(x)) && md.mm.length === 1 && /mmproj/.test(md.mm[0]) && /0,9 GB/.test(md.mm[0]), 'vision: Qwen marked «όραση», mmproj card with «mmproj» + 0,9 GB', { q, mm: md.mm });
  ok(['Q8_0', '8,1 GB'].every((x) => (k8.chips || []).includes(x)) && (k8.chips || []).some((x) => /t\/s —/.test(x)) && !(k8.chips || []).includes(':' + router.port), 'unloaded model: real quant / GB, unknown t/s → «—», no port', k8);
  ok(/32,5|ΔΙΣΚΟΣ|Δίσκος/i.test(md.strip || ''), 'disk strip at the top', md.strip);
  await shot(win, 'v2612-hub-models.png');
  await win.evaluate(() => { try { Hub.close(); } catch (e) {} document.querySelector('#hub-close, .hub .x')?.click?.(); }); await sleep(200);

  // ---- 6) small window 1024×700 ----
  await setSize(app, win, 1024, 700);
  const sm = await vis(win);
  const sp = await win.evaluate(() => { const b = document.querySelector('#btn-search'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), aria: b.getAttribute('aria-label'), span: getComputedStyle(b.querySelector('span[data-t]')).display, icon: !!b.querySelector('svg') && b.querySelector('svg').getBoundingClientRect().width > 0 }; });
  ok(sm.tops === 1 && sm.vis.length >= 2 && sp.icon && sp.span === 'none' && /Αναζήτηση/.test(sp.aria || ''), '1024 px: one line, ≥ 2 tabs («Πίνακας N» names), search as an icon with a label', { sm, sp });
  await win.evaluate(() => App.switchBoard(Store.state.boards[0].id)); await sleep(200);
  const nar = await win.evaluate(() => { const t = document.querySelector('#tabs .tab.on'); const c = t.querySelector('.tab-count'); return { narrow: t.classList.contains('narrow'), count: getComputedStyle(c).display, txt: c.textContent }; });
  ok(!nar.narrow || (nar.count !== 'none'), 'narrow active tab shows its card count', nar);
  await win.keyboard.press('Control+e'); await sleep(800);
  const lsm = await win.evaluate(() => { const d = document.querySelector('#drawer').getBoundingClientRect(); const cells = [...document.querySelectorAll('#lib-grid > button')]; return { right: Math.round(d.right), bottom: Math.round(d.bottom), W: innerWidth, H: innerHeight, cols: cells.filter((c) => Math.round(c.getBoundingClientRect().top) === Math.round(cells[0].getBoundingClientRect().top)).length }; });
  ok(lsm.right <= lsm.W && lsm.bottom <= lsm.H && lsm.cols === 8, '1024×700: Library inside the window, 8 columns', lsm);
  await shot(win, 'v2612-small-library.png');
  await win.evaluate(() => Panels.closeDrawer()); await sleep(200);
  await win.evaluate(() => { document.querySelector('#viewport').focus(); Tools.pick('pen'); }); await sleep(250); await win.click('#toolopts .sw.custom[data-picker]'); await sleep(250);
  const psm = await win.evaluate(() => { const a = document.querySelector('#toolopts').getBoundingClientRect(); const b = document.querySelector('.fo-picker').getBoundingClientRect(); const tb = document.querySelector('#titlebar').getBoundingClientRect().bottom; return [a, b].every((r) => r.left >= 0 && r.right <= innerWidth && r.top >= tb - 1 && r.bottom <= innerHeight); });
  ok(psm, '1024×700: pen flyout and palette inside the window');
  await win.evaluate(() => { Tools.closePicker(); Tools.pick('select'); });
  await win.evaluate(() => Hub.open()); await sleep(600);
  const hsm = await win.evaluate(() => { const p = document.querySelector('#hub, .hub-panel, [data-hub]'); if (!p) return null; const r = p.getBoundingClientRect(); return { right: Math.round(r.right), W: innerWidth, left: Math.round(r.left) }; });
  ok(!hsm || (hsm.right <= hsm.W && hsm.left >= 0), '1024×700: Hub inside the window', hsm);
  await win.evaluate(() => { try { Hub.close(); } catch (e) {} });
  await setSize(app, win, 1440, 900);

  // ---- 7) regressions ----
  await win.evaluate(() => { Tools.pick('select'); Store.undoStack.length = 0; }); const rid = await win.evaluate(() => Features.addAtCenter({ type: 'sticky', html: 'αναίρεση', w: 200, h: 140 }).id); await sleep(200);
  await win.evaluate(() => document.querySelector('#viewport').focus()); await win.keyboard.press('Control+z'); await sleep(300);
  const goneZ = await win.evaluate((id) => !Store.state.boards.some((b) => b.items.some((i) => i.id === id)), rid);
  await win.keyboard.press('Control+y'); await sleep(300);
  const backY = await win.evaluate((id) => Store.state.boards.some((b) => b.items.some((i) => i.id === id)), rid);
  ok(goneZ && backY, 'Ctrl+Z removes the new card, Ctrl+Y brings it back');
  // Bin: delete the card → it is in the Bin → restore
  const bin0 = await win.evaluate(() => (Store.state.bin || []).length);
  await win.evaluate((id) => { Canvas.sel.clear(); Canvas.sel.add(id); Canvas.refresh && Canvas.refresh(); document.querySelector('#viewport').focus(); }, rid); await win.keyboard.press('Delete');
  await sleep(300);
  const bin1 = await win.evaluate((id) => ({ n: (Store.state.bin || []).length, gone: !Store.items().some((i) => i.id === id) }), rid);
  await win.click('#z-bin'); await sleep(400);
  const row = await win.evaluate(() => { const r = document.querySelector('[data-bin-restore]'); if (r) r.click(); return !!r; }); await sleep(400);
  const bin2 = await win.evaluate((id) => Store.state.boards.some((b) => b.items.some((i) => i.id === id)), rid);
  ok(bin1.n === bin0 + 1 && bin1.gone && row && bin2, 'Bin: deleted card goes to the Bin and comes back with «Επαναφορά»', { bin0, bin1, row, bin2 });
  await win.evaluate(() => { try { Panels.closeDrawer(); } catch (e) {} });
  await win.evaluate(() => { Store.state.chat = []; Assistant.show(); Assistant.render(); document.querySelector('#as-q').value = 'Γεια'; Assistant.send(); });
  await win.waitForFunction(() => !Assistant.busy && (Store.state.chat || []).some((m) => m.role === 'assistant'), null, { timeout: 30000 }).catch(() => {});
  const ans = await win.evaluate(() => { const m = (Store.state.chat || []).filter((x) => x.role === 'assistant').pop(); return m ? { c: m.content, e: !!m.error } : null; });
  ok(ans && !ans.e && /απαντώ κανονικά/.test(ans.c), 'assistant still answers', ans);
  await win.evaluate(() => { try { Assistant.hide(); } catch (e) {} });
  const mcp = await win.evaluate(async () => { const list = await API.inv('plugins:list').catch(() => null); const arr = Array.isArray(list) ? list : (list && list.plugins) || []; return arr.some((p) => /mcp/i.test(p.id || p.name || '')); });
  ok(mcp, 'MCP plugin still installed');
  const after = await win.evaluate(() => { const s = JSON.parse(JSON.stringify(Store.state.settings)); return { settingsKeys: Object.keys(s).sort(), subs: JSON.stringify(Store.state.subs), boards: Store.state.boards.length, ctx: s.ai.servers.llama.ctx, extra: s.ai.servers.llama.extra }; });
  ok(after.subs === before.subs, 'subscriptions unchanged');
  ok(before.settingsKeys.every((k) => after.settingsKeys.includes(k)), 'no existing setting removed', before.settingsKeys.filter((k) => !after.settingsKeys.includes(k)));
  ok(after.ctx === 32768 && /--models-max 1/.test(after.extra), 'router settings untouched (ctx 32768, --models-max 1)', after);
  const nB = after.boards;
  await win.evaluate(() => Store.save(true)); await sleep(300); await quit(app);
  ({ app, win } = await launch()); await sleep(500);
  const rs = await vis(win);
  ok(rs.n === nB && rs.tops === 1 && rs.vis[0] === 0, 'after restart: all boards, one line, the first tabs in the bar', rs);
  await quit(app); router.srv.close();
  console.log(`\nv2.6.12 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
