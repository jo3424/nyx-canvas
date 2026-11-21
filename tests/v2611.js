'use strict';
// v2.6.11 UI (Electron, Chromium sandbox on), appearance only:
//  1) 40 boards: strip on one line, tabs ≥ minimum, «+N ▾» with the rest, active visible, wheel, ←/→, menu, Ctrl+Tab
//  2) flyouts (shapes / pen / note): touch their dock button, inside the window (normal + short window), keys 1–9 only
//     while open and never while typing (card edit, search field), digit in the tooltip
//  3) Library on the right: tabs on one line, real counter; Bin in its own corner (not next to zoom)
//  4) Hub against a fake b12230-style router (models-max 1, 3 models): «1 / 1 · μέγιστο 1 · 3 στον φάκελο», Greek states,
//     cards not cut; panel styles optional, default unchanged, Γυαλί with measured contrast
//  5) regressions: assistant answers, Ctrl+Z / Ctrl+Y, subscriptions untouched, MCP plugin still there, settings kept
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2611-'));
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
const strip = (win) => win.evaluate(() => {
  const T = document.querySelector('#tabs'); const zone = document.querySelector('#tabs-zone'); const more = document.querySelector('#tabs-more');
  const vis = [...T.querySelectorAll('.tab')].filter((x) => !x.hidden); const r = (e) => e.getBoundingClientRect();
  const on = T.querySelector('.tab.on'); const zr = r(zone); const tr = r(T);
  return { n: T.querySelectorAll('.tab').length, vis: vis.length, tops: [...new Set(vis.map((x) => Math.round(r(x).top)))], minW: Math.min(...vis.map((x) => r(x).width)), stripH: Math.round(tr.height), mode: T.dataset.mode,
    more: more.hidden ? null : more.textContent, moreCount: +(more.dataset.count || 0), onVis: !!on && !on.hidden && r(on).right <= zr.right + 1 && r(on).left >= zr.left - 1, onId: on && on.dataset.board, active: Store.state.active, moreActive: more.classList.contains('has-active'),
    overflow: Math.round(r(more.hidden ? T : more).right) <= Math.round(zr.right) + 1, scroll: T.scrollWidth <= T.clientWidth + 1 };
});

(async () => {
  const router = await startRouter();
  let { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(['2.6.11', '2.6.11.1', '2.6.12', '2.6.12.1', '2.6.12.2', '2.6.13', '2.6.13.1', '2.7.0', '2.7.1', '2.7.1.1'].includes(String(ver)), 'app version 2.6.11', ver);
  // baseline data: 1 board with cards, 2 subscriptions, settings snapshot (must survive everything below)
  const before = await win.evaluate((a) => {
    const A = Store.state.settings.ai; const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + a.port + '/v1';
    for (const k of ['commands', 'chat', 'vision', 'summarize']) A.tasks[k] = { p: 'llama', m: a.QWEN };
    Object.assign(A.servers.llama, { ctx: 32768, port: a.port, extra: '--models-max 1' }); A.assistant.thinking = false;
    Store.state.subs = [{ id: 's1', name: 'Netflix', price: 13.99, currency: 'EUR', cycle: 'monthly', next: '2026-11-20', active: true, color: '#e50914', icon: '🎬' }, { id: 's2', name: 'Spotify', price: 10.99, currency: 'EUR', cycle: 'monthly', next: '2026-11-25', active: true, color: '#1db954', icon: '🎵' }];
    Store.save(true);
    const s = JSON.parse(JSON.stringify(Store.state.settings)); delete s.uiStyle;
    return { settingsKeys: Object.keys(s).sort(), theme: s.theme, subs: JSON.stringify(Store.state.subs), uiStyle: Store.state.settings.uiStyle };
  }, { port: router.port, QWEN });
  ok(before.uiStyle === undefined && (await win.evaluate(() => !document.body.dataset.uiStyle)), 'default: no panel style applied (the theme look stays the default)');

  // ---- 1) many boards ----
  await win.evaluate(() => { const B = Store.state.boards; const names = ['Ιδέες', 'Σειρές & Ταινίες', 'Hermes', 'Δουλειά', 'Ταξίδι Νάξος', 'Συνταγές', 'Βιβλία', 'Γυμναστήριο', 'Αγορές', 'Φωτογραφίες']; for (let i = B.length; i < 40; i++) B.push({ id: 'b' + i, name: names[i % names.length] + ' ' + i, emoji: '📁', color: PALETTE[4 + i % 10], view: null, items: [] }); Store.save(); Panels.tabs(); });
  await sleep(300);
  let s = await strip(win);
  ok(s.n === 40 && s.tops.length === 1 && s.stripH <= 40, '40 boards: one line (no wrap)', s);
  ok(s.mode === 'overflow' && s.moreCount === 40 - s.vis && s.more === '+' + (40 - s.vis) && s.minW >= 95, `tabs shrink to ≥ 96 px, then «${s.more} ▾» holds the other ${40 - s.vis}`, s);
  ok(s.onVis && s.overflow && s.scroll, 'active tab visible, nothing spills past the strip', s);
  await shot(win, 'v2611-tabs-40.png');
  // switch to a board far away (Ctrl+Tab backwards from the first = the last one)
  await win.evaluate(() => App.switchBoard(Store.state.boards[0].id)); await sleep(150);
  await win.evaluate(() => document.querySelector('#viewport').focus()); await win.keyboard.press('Control+Shift+Tab'); await sleep(250);
  // 2.6.12: anchored to the start — the last board stays in «+N ▾» (highlighted) instead of pushing the first tabs out
  s = await strip(win); ok(s.active === 'b39' && s.onId === 'b39' && !s.onVis && s.moreActive, 'Ctrl+Shift+Tab → last board is active; it stays in «+N ▾», which is highlighted (2.6.12)', s);
  // wheel scrolls the strip, active stays shown
  const st0 = await win.evaluate(() => TabStrip.start);
  const zr = await win.evaluate(() => { const r = document.querySelector('#tabs').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; });
  await win.mouse.move(zr.x, zr.y); for (let i = 0; i < 5; i++) { await win.mouse.wheel(0, 120); await sleep(60); }
  await sleep(200);
  const st1 = await win.evaluate(() => TabStrip.start); s = await strip(win);
  for (let i = 0; i < 9; i++) { await win.mouse.wheel(0, -120); await sleep(60); }
  await sleep(200);
  const st2 = await win.evaluate(() => TabStrip.start);
  ok(st1 > st0 && st2 === 0 && s.tops.length === 1, `wheel moves the strip (${st0} → ${st1} → ${st2}), one line`, { st0, st1, st2, s });
  // «+N ▾» menu → pick a hidden board
  await win.click('#tabs-more'); await sleep(250);
  const menu = await win.evaluate(() => { const m = document.querySelector('#ctxmenu'); return { hidden: m.hidden, kind: m.dataset.menu, n: m.querySelectorAll('.mi[data-board]').length, first: m.querySelector('.mi[data-board]')?.dataset.board, exp: document.querySelector('#tabs-more').getAttribute('aria-expanded'), focus: document.activeElement?.dataset?.board }; });
  const nHidden = (await strip(win)).moreCount;
  ok(!menu.hidden && menu.kind === 'tabs-more' && menu.n === nHidden && menu.exp === 'true' && menu.focus === 'b39', '«+N ▾» opens a list of exactly the hidden boards (focus on the active b39 in it, aria-expanded)', menu);
  await win.keyboard.press('Home').catch(() => {}); await win.evaluate(() => document.querySelector('#ctxmenu .mi[data-board]').focus());
  await win.keyboard.press('ArrowDown'); await win.keyboard.press('Enter'); await sleep(300);
  s = await strip(win); const picked = await win.evaluate(() => Store.state.active);
  ok(picked !== 'b39' && s.onId === picked && !s.onVis && s.moreActive && s.vis >= 1, 'keyboard: ↓ + Enter in the list → that board is active (marked in «+N ▾»; the first tabs stay)', { picked, s });
  await win.evaluate(() => App.switchBoard(Store.state.boards[1].id)); await sleep(200);
  // ←/→ on the focused tab
  await win.evaluate(() => document.querySelector('#tabs .tab.on').focus());
  const a0 = await win.evaluate(() => Store.state.boards.findIndex((b) => b.id === Store.state.active));
  await win.keyboard.press('ArrowRight'); await sleep(200);
  const a1 = await win.evaluate(() => ({ i: Store.state.boards.findIndex((b) => b.id === Store.state.active), focus: document.activeElement?.classList.contains('on'), role: document.activeElement?.getAttribute('role'), sel: document.activeElement?.getAttribute('aria-selected') }));
  ok(a1.i === (a0 + 1) % 40 && a1.focus && a1.role === 'tab' && a1.sel === 'true', '→ on a focused tab: next board, focus follows (role=tab, aria-selected)', { a0, a1 });
  await win.evaluate(() => App.switchBoard(Store.state.boards[0].id)); await sleep(200);
  // narrow window: still one line
  await setSize(app, win, 900, 700); s = await strip(win);
  ok(s.tops.length === 1 && (s.onVis || s.moreActive) && s.overflow && s.minW >= 95, 'window 900 px: still one line, active visible (or highlighted in «+N ▾»)', s);
  await setSize(app, win, 1440, 900);
  // the strip never deletes boards
  ok((await win.evaluate(() => Store.state.boards.length)) === 40, 'all 40 boards still there');

  // ---- 2) flyouts ----
  const fly = (win) => win.evaluate(() => {
    const o = document.querySelector('#toolopts'); const b = document.querySelector(`#dock .tool[data-tool="${Tools.cur}"]`); const tb = document.querySelector('#titlebar').getBoundingClientRect().bottom;
    const r = o.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { open: !o.hidden, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), btnRight: Math.round(br.right), btnTop: Math.round(br.top), btnBottom: Math.round(br.bottom), tb: Math.round(tb), W: innerWidth, H: innerHeight, touch: o.dataset.touch, fk: o.querySelectorAll('[data-fk]').length, scroll: o.classList.contains('scroll') };
  });
  const inside = (f) => f.left >= 0 && f.right <= f.W && f.top >= f.tb && f.bottom <= f.H;
  const touches = (f) => Math.abs(f.left - f.btnRight) <= 1 && f.top < f.btnBottom && f.bottom > f.btnTop;
  for (const [tool, n] of [['shape', (await win.evaluate(() => typeof SHAPE_LINES !== 'undefined')) ? 8 : 6], ['pen', 9], ['sticky', (await win.evaluate(() => NyxUI.flyoutDigit({ key: '0', code: 'Digit0' }, true, 10) === 9)) ? 10 : 9]]) {
    await win.evaluate((t) => Tools.pick(t), tool); await sleep(250);
    const f = await fly(win);
    ok(f.open && touches(f) && inside(f) && f.touch === '1' && f.fk === n, `${tool} flyout: touches its button, inside the window, ${n} items with keys (1–9, 0 = 10th)`, f);
    await shot(win, `v2611-flyout-${tool}.png`);
  }
  await setSize(app, win, 1000, 560);
  for (const tool of ['sticky', 'pen', 'shape']) {
    await win.evaluate((t) => Tools.pick(t), tool); await sleep(300);
    const f = await fly(win);
    ok(f.open && inside(f) && touches(f), `short window (560 px): ${tool} flyout inside the window and touching${f.scroll ? ' (inner scroll)' : ''}`, f);
  }
  await shot(win, 'v2611-flyout-short.png');
  await setSize(app, win, 1440, 900);
  // keys 1–9
  await win.evaluate(() => { Store.state.settings.shapeKind = 'rect'; Tools.pick('shape'); document.querySelector('#viewport').focus(); }); await sleep(200);
  await win.keyboard.press('4'); await sleep(150);
  ok((await win.evaluate(() => Store.state.settings.shapeKind)) === 'triangle', 'shapes flyout open: key 4 → Τρίγωνο');
  await win.evaluate(() => { Store.state.settings.stickyKind = ''; Tools.pick('sticky'); document.querySelector('#viewport').focus(); }); await sleep(200);
  await win.keyboard.press('3'); await sleep(150);
  ok((await win.evaluate(() => Store.state.settings.stickyKind)) === 'grid', 'note flyout open: key 3 → Τετραγωνισμένο');
  // tooltip shows the digit
  const tipBox = await win.evaluate(() => { const b = document.querySelector('#toolopts [data-fk="3"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await win.mouse.move(tipBox.x, tipBox.y); await sleep(700);
  const tip = await win.evaluate(() => { const t = document.querySelector('#tip'); return { hidden: t.hidden, text: t.textContent, key: t.querySelector('.tip-key')?.textContent }; });
  ok(!tip.hidden && /Τετραγωνισμένο/.test(tip.text) && tip.key === '3', 'tooltip: «Τετραγωνισμένο 3» (the key only in the tooltip)', tip);
  await shot(win, 'v2611-flyout-tooltip.png');
  // typing in a card: digits are typed, nothing is picked
  const cid = await win.evaluate(() => { Tools.pick('select'); const it = Features.addAtCenter({ type: 'sticky', html: '', w: 220, h: 160 }); return it.id; }); await sleep(200);
  await win.evaluate(() => { Store.state.settings.shapeKind = 'rect'; Tools.pick('shape'); }); await sleep(100);
  await win.evaluate((id) => { Canvas.edit(id); }, cid); await sleep(200);
  await win.keyboard.type('25'); await sleep(200);
  const typed = await win.evaluate((id) => ({ html: document.querySelector(`.item[data-id="${id}"] .txt`)?.innerText || '', kind: Store.state.settings.shapeKind, open: !document.querySelector('#toolopts').hidden }), cid);
  ok(/25/.test(typed.html) && typed.kind === 'rect', 'typing «25» in a card: the digits are written, the shape is not changed', typed);
  await win.evaluate(() => Canvas.endEdit()); await sleep(100);
  // search field (palette) — digits go into the field
  await win.evaluate(() => { Tools.pick('shape'); Store.state.settings.shapeKind = 'rect'; Tools.opts(); Panels.palette(); }); await sleep(250);
  await win.keyboard.type('2'); await sleep(150);
  const pal = await win.evaluate(() => ({ v: document.querySelector('#pal-q').value, kind: Store.state.settings.shapeKind }));
  ok(pal.v === '2' && pal.kind === 'rect', 'typing in the search field: «2» goes into the field, not the flyout', pal);
  await win.evaluate(() => Panels.closePalette()); await sleep(150);
  // no flyout open: digits do nothing
  await win.evaluate(() => { Tools.pick('select'); document.querySelector('#viewport').focus(); }); const k0 = await win.evaluate(() => JSON.stringify([Store.state.settings.shapeKind, Store.state.settings.stickyKind, Store.state.active]));
  await win.keyboard.press('2'); await sleep(150);
  ok((await win.evaluate(() => JSON.stringify([Store.state.settings.shapeKind, Store.state.settings.stickyKind, Store.state.active]))) === k0 && (await win.evaluate(() => document.querySelector('#toolopts').hidden)), 'no flyout open: key 2 changes nothing');

  // ---- 3) Library + Bin ----
  await win.evaluate(() => document.querySelector('#viewport').focus()); await win.keyboard.press('Control+e'); await sleep(900);
  const lib = await win.evaluate(() => {
    const d = document.querySelector('#drawer'); const tabs = [...d.querySelectorAll('.lib-tabs button')]; const foot = d.querySelector('[data-lib-count]');
    const dr = d.getBoundingClientRect();
    const c = d.querySelector('.lib-tabs').getBoundingClientRect(); const clipped = tabs.filter((b) => { const r = b.getBoundingClientRect(); return r.left < c.left - 1 || r.right > c.right + 1 || b.scrollWidth > b.clientWidth + 1; }).length;
    const lt = d.querySelector('.lib-tabs'); const scrollable = lt.scrollWidth > lt.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(lt).overflowX);
    return { clipped, scrollable, kind: d.dataset.kind, right: Math.round(innerWidth - dr.right), tops: [...new Set(tabs.map((b) => Math.round(b.getBoundingClientRect().top)))].length, n: tabs.length, shown: +foot.dataset.shown, total: +foot.dataset.total, text: foot.textContent, cells: d.querySelectorAll('.lib-grid .emo-cell').length, dock: document.querySelector('#dock .tool[data-tool=library]').classList.contains('on') };
  });
  ok(lib.kind === 'library' && lib.right <= 16 && lib.dock, 'Library opens as the right drawer (Ctrl+E), dock button marked', lib);
  ok(lib.n === 5 && lib.tops === 1 && (lib.clipped === 0 || lib.scrollable), 'Library: 5 tabs on one line, never wrapped (2.6.12: icon + name; the strip scrolls sideways when they do not fit)', lib);
  ok(lib.shown === lib.cells && lib.total > lib.shown && lib.text.includes(lib.shown.toLocaleString('el-GR')) && lib.text.includes(lib.total.toLocaleString('el-GR')), `Library counter is real: «${lib.text}» = cells in the grid / all emoji`, lib);
  await shot(win, 'v2611-library.png');
  await win.evaluate(() => document.querySelector('[data-lib-group="4"]').click()); await sleep(400);
  const food = await win.evaluate(() => { const f = document.querySelector('[data-lib-count]'); return { shown: +f.dataset.shown, total: +f.dataset.total, cells: document.querySelectorAll('.lib-grid .emo-cell').length, all: NYX_DATA.emoji.filter((x) => x[2] === 4).length }; });
  ok(food.total === food.all && food.shown === food.cells, 'Library group «Φαγητό»: counter = real number of food emoji', food);
  await win.evaluate(() => document.querySelector('[data-lib-tab=memes]').click()); await sleep(300);
  const tabsAfter = await win.evaluate(() => { const tabs = [...document.querySelectorAll('.lib-tabs button')]; const on = document.querySelector('.lib-tabs button.on'); const c = document.querySelector('.lib-tabs').getBoundingClientRect(); const r = on.getBoundingClientRect(); return { tops: [...new Set(tabs.map((b) => Math.round(b.getBoundingClientRect().top)))].length, onVisible: r.left >= c.left - 1 && r.right <= c.right + 1, text: document.querySelector('[data-lib-count]').textContent }; });
  ok(tabsAfter.tops === 1 && tabsAfter.onVisible, 'last tab («Τα memes μου») active: still one line and fully visible', tabsAfter);
  await win.evaluate(() => Panels.closeDrawer()); await sleep(300);
  const bin = await win.evaluate(() => { const b = document.querySelector('#z-bin'); const r = b.getBoundingClientRect(); const z = document.querySelector('#corner .zoombar').getBoundingClientRect(); return { inZoom: !!b.closest('.zoombar'), inCorner: !!b.closest('#bin-corner'), left: Math.round(r.left), bottom: Math.round(innerHeight - r.bottom), dist: Math.round(z.left - r.right) }; });
  ok(!bin.inZoom && bin.inCorner && bin.left <= 80 && bin.bottom <= 16 && bin.dist > 600, 'Bin in its own corner (bottom left), far from the zoom buttons', bin);

  // ---- 4) Hub ----
  await win.evaluate(() => { Hub.open(); }); await sleep(400);
  await win.evaluate(() => document.querySelector('[data-hub-tab=status]')?.click());
  await win.waitForFunction(() => /φάκελο/.test(document.querySelector('[data-st=hub-head]')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  await win.waitForFunction(() => document.querySelector('[data-st=llama-run]')?.getAttribute('data-run') === 'on', null, { timeout: 8000 }).catch(() => {});
  const hub = await win.evaluate(() => {
    const head = document.querySelector('[data-st=hub-head]'); const pane = document.querySelector('[data-hub-pane=status]');
    const cut = [...document.querySelectorAll('#drawer .hub-stat, #drawer .hub-row, #drawer .hub-pill, #drawer .hub-head')].filter((e) => e.offsetParent && (e.scrollWidth > e.clientWidth + 1)).map((e) => e.className + ': ' + e.textContent.slice(0, 40));
    return { head: head?.textContent, run: document.querySelector('[data-st=llama-run]')?.textContent, runAttr: document.querySelector('[data-st=llama-run]')?.getAttribute('data-run'), live: document.querySelector('[data-st=live-pages]')?.textContent, text: pane.innerText, cut, english: /\b(running|stopped|webviews?)\b/i.test(pane.innerText) };
  });
  ok(hub.head === '1 / 1 · μέγιστο 1 · 3 στον φάκελο', 'Hub header from the router: «1 / 1 · μέγιστο 1 · 3 στον φάκελο»', hub.head);
  ok(hub.run === 'σε λειτουργία' && hub.runAttr === 'on' && /σταματημένο/.test(hub.text) && hub.live === 'Ζωντανές σελίδες' && !hub.english, 'Greek states: σε λειτουργία / σταματημένο, «Ζωντανές σελίδες», no running/stopped/webviews', hub);
  ok(!hub.cut.length, 'status cards / rows / pills: no text cut off', hub.cut);
  await shot(win, 'v2611-hub-status.png');
  // live data: the router now says max 2 and 2 loaded → the header follows (no fixed numbers)
  router.st.maxInstances = 2; MODELS['gemma-4-12B-it-Q4_0'] = 'loaded';
  await win.evaluate(() => { document.querySelector('[data-hub-tab=models]').click(); }); await sleep(200);
  await win.evaluate(() => { document.querySelector('[data-hub-tab=status]').click(); });
  await win.waitForFunction(() => /^2 \/ 2/.test(document.querySelector('[data-st=hub-head]')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
  ok((await win.evaluate(() => document.querySelector('[data-st=hub-head]').textContent)) === '2 / 2 · μέγιστο 2 · 3 στον φάκελο', 'router changes (max 2, 2 loaded) → «2 / 2 · μέγιστο 2 · 3 στον φάκελο»');
  router.st.maxInstances = 1; MODELS['gemma-4-12B-it-Q4_0'] = 'unloaded';
  await win.evaluate(() => { document.querySelector('[data-hub-tab=models]').click(); });
  await win.waitForFunction(() => document.querySelectorAll('.hub-model[data-mstate]').length >= 3, null, { timeout: 10000 }).catch(() => {});
  const mods = await win.evaluate(() => { const cards = [...document.querySelectorAll('.hub-model[data-mstate]')]; const cut = cards.filter((e) => e.scrollWidth > e.clientWidth + 1).length; return { states: cards.map((c) => c.dataset.mstate + ':' + c.querySelector('.hub-mstate').textContent), loaded: document.querySelectorAll('.hub-model.is-loaded').length, cut, head: document.querySelector('[data-st=hub-head]').textContent }; });
  ok(mods.states.length === 3 && mods.states.filter((x) => x === 'loaded:φορτωμένο').length === 1 && mods.states.filter((x) => x === 'disk:στον δίσκο').length === 2 && mods.loaded === 1 && !mods.cut, 'Models: 1 «φορτωμένο» (highlighted) + 2 «στον δίσκο», no card cut off', mods);
  ok(mods.head === '1 / 1 · μέγιστο 1 · 3 στον φάκελο', 'header on the Models tab: same real line', mods.head);
  const squeezed = await win.evaluate(() => [...document.querySelectorAll('#drawer .hub-pane.on .hub-pill')].filter((p) => p.offsetParent && !p.hidden).map((p) => { const r = p.getBoundingClientRect(); return { t: p.textContent.slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h > 44 || x.w < 20));
  ok(!squeezed.length, 'Models tab: no pill squeezed into a column (every pill ≤ 2 lines)', squeezed);
  await shot(win, 'v2611-hub-models.png');
  // narrow Hub (window 900 px): stats still not cut
  await setSize(app, win, 900, 800); await win.evaluate(() => document.querySelector('[data-hub-tab=status]').click()); await sleep(1500);
  const cutN = await win.evaluate(() => [...document.querySelectorAll('#drawer .hub-stat, #drawer .hub-pane.on .hub-row, #drawer .hub-head')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.className));
  ok(!cutN.length, 'window 900 px: Hub cards still not cut', cutN);
  await setSize(app, win, 1440, 900);
  await win.evaluate(() => Panels.closeDrawer()); await sleep(300);

  // ---- panel styles ----
  await win.evaluate(() => Panels.themes()); await sleep(400);
  const sty = await win.evaluate(() => { const btns = [...document.querySelectorAll('[data-ui-style-pick]')]; const g = btns.find((b) => b.dataset.uiStylePick === 'glass'); return { n: btns.length, on: btns.find((b) => b.classList.contains('on'))?.dataset.uiStylePick, glass: g?.textContent, glassDisabled: g?.disabled, ratio: NyxUI.glassCheck(Theme.current.vars).min }; });
  ok(sty.n === 7 && sty.on === 'default' && sty.ratio >= 4.5 && !sty.glassDisabled && /Γυαλί · \d,\d:1/.test(sty.glass), `7 choices (Προεπιλογή + 6), default selected; Γυαλί offered with measured contrast ${sty.ratio.toFixed(2)}:1`, sty);
  await win.evaluate(() => document.querySelector('[data-ui-style-pick=glass]').click()); await sleep(300);
  await win.evaluate(() => Tools.pick('pen')); await sleep(200);
  const gl = await win.evaluate(() => { const o = document.querySelector('#toolopts'); const cs = getComputedStyle(o); return { body: document.body.dataset.uiStyle, saved: Store.state.settings.uiStyle, bg: cs.backgroundColor, muted: cs.getPropertyValue('--muted').trim() }; });
  ok(gl.body === 'glass' && gl.saved === 'glass' && /rgba\(18, 22, 40, 0\.82\)/.test(gl.bg), 'Γυαλί applied to flyouts/drawer only when chosen', gl);
  await shot(win, 'v2611-style-glass.png');
  await win.evaluate(() => { Store.state.settings.theme = 'x-low'; THEMES.push({ id: 'x-low', name: 'low', desc: '', shape: 'solid', icon: 'regular', vars: { ...THEMES[0].vars, bg: '#777777', bg2: '#888888', card: '#999999', 'panel-solid': '#808080', text: '#9a9a9a', muted: '#a0a0a0' }, fx: THEMES[3].fx }); Theme.apply(Store.state.settings); Panels.refreshDrawer(); }); await sleep(300);
  const low = await win.evaluate(() => ({ body: document.body.dataset.uiStyle || '', saved: Store.state.settings.uiStyle, disabled: document.querySelector('[data-ui-style-pick=glass]')?.disabled, note: !!document.querySelector('[data-ui-style-fallback]') }));
  ok(low.body === '' && low.saved === 'glass' && low.disabled && low.note, 'low-contrast theme: Γυαλί not applied (default shown, choice kept, button disabled, note)', low);
  await win.evaluate(() => { THEMES.pop(); Store.state.settings.theme = 'midnight'; Theme.apply(Store.state.settings); document.querySelector('[data-ui-style-pick=default]')?.click(); }); await sleep(300);
  ok((await win.evaluate(() => Store.state.settings.uiStyle === undefined && !document.body.dataset.uiStyle)), '«Προεπιλογή (θέμα)» → setting removed, theme look back');
  await win.evaluate(() => Panels.closeDrawer()); await sleep(200);

  // ---- 5) regressions ----
  // undo / redo
  await win.evaluate(() => { Tools.pick('select'); Store.undoStack.length = 0; }); const rid = await win.evaluate(() => Features.addAtCenter({ type: 'sticky', html: 'αναίρεση', w: 200, h: 140 }).id); await sleep(200);
  await win.evaluate(() => document.querySelector('#viewport').focus()); await win.keyboard.press('Control+z'); await sleep(300);
  const goneZ = await win.evaluate((id) => !Store.state.boards.some((b) => b.items.some((i) => i.id === id)), rid);
  await win.keyboard.press('Control+y'); await sleep(300);
  const backY = await win.evaluate((id) => Store.state.boards.some((b) => b.items.some((i) => i.id === id)), rid);
  ok(goneZ && backY, 'Ctrl+Z removes the new card, Ctrl+Y brings it back');
  // assistant answers through the router
  await win.evaluate(() => { Store.state.chat = []; Assistant.show(); Assistant.render(); document.querySelector('#as-q').value = 'Γεια'; Assistant.send(); });
  await win.waitForFunction(() => !Assistant.busy && (Store.state.chat || []).some((m) => m.role === 'assistant'), null, { timeout: 30000 }).catch(() => {});
  const ans = await win.evaluate(() => { const m = (Store.state.chat || []).filter((x) => x.role === 'assistant').pop(); return m ? { c: m.content, e: !!m.error } : null; });
  ok(ans && !ans.e && /απαντώ κανονικά/.test(ans.c) && router.st.chats >= 1, 'assistant still answers', ans);
  await win.evaluate(() => { try { Assistant.hide(); } catch (e) {} });
  // MCP plugin still installed and its settings untouched
  const mcp = await win.evaluate(async () => { const list = await API.inv('plugins:list').catch(() => null); const arr = Array.isArray(list) ? list : (list && list.plugins) || []; return arr.some((p) => /mcp/i.test(p.id || p.name || '')); });
  ok(mcp, 'MCP plugin still installed');
  // subscriptions and settings untouched
  const after = await win.evaluate(() => { const s = JSON.parse(JSON.stringify(Store.state.settings)); delete s.uiStyle; return { settingsKeys: Object.keys(s).sort(), subs: JSON.stringify(Store.state.subs), boards: Store.state.boards.length }; });
  ok(after.subs === before.subs, 'subscriptions unchanged after all of the above');
  ok(before.settingsKeys.every((k) => after.settingsKeys.includes(k)), 'no existing setting removed', before.settingsKeys.filter((k) => !after.settingsKeys.includes(k)));
  ok(after.boards === 40, 'boards unchanged (40)');
  // persists across restart: strip still one line
  await win.evaluate(() => Store.save(true)); await sleep(300); await quit(app);
  ({ app, win } = await launch());
  s = await strip(win);
  ok(s.n === 40 && s.tops.length === 1 && (s.onVis || s.moreActive) && s.mode === 'overflow', 'after restart: 40 boards, one line, active visible or highlighted in «+N ▾»', s);
  ok((await win.evaluate(() => JSON.stringify(Store.state.subs))) === before.subs, 'after restart: subscriptions identical');
  await quit(app);
  router.srv.close();
  console.log(`\nv2.6.11 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
