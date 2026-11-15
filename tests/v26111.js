'use strict';
// v2.6.11.1 UI (Electron, Chromium sandbox on), appearance only:
//  a) 40 boards: the strip is anchored to the END — the last tabs + the active one visible, the FIRST tabs in «+N ▾»;
//     «+» adds the new board at the end and it is visible; wheel, ←/→/Home/End and the «+N» menu keep working
//  b) shapes flyout = 6 shapes + arrow + line (keys 1–8); A / L still pick arrow / line; no own dock buttons
//  c) pen flyout as mockup 03: hex (+ invalid input), eyedropper (EyeDropper stub → colour; failure → click a card),
//     opacity %, 1–40 px, 4 recent colours (additive setting), visible size dots; highlighter keeps its colours + 38 %
//  +) tooltip «Βιβλιοθήκη (Ctrl+E)», zoom 5–800 %; regressions: assistant, Ctrl+Z/Y, subscriptions, MCP, settings, restart
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v26111-'));
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
    more: more.hidden ? null : more.textContent, moreCount: +(more.dataset.count || 0), onVis: !!on && !on.hidden && r(on).right <= zr.right + 1 && r(on).left >= zr.left - 1, onId: on && on.dataset.board, active: Store.state.active,
    overflow: Math.round(r(more.hidden ? T : more).right) <= Math.round(zr.right) + 1, scroll: T.scrollWidth <= T.clientWidth + 1 };
});

const fly = (win) => win.evaluate(() => {
  const o = document.querySelector('#toolopts'); const r = o.getBoundingClientRect(); const tb = document.querySelector('#titlebar').getBoundingClientRect().bottom;
  const own = document.querySelector(`#dock .tool[data-tool="${Tools.dockOf(Tools.cur)}"]`); const br = own.getBoundingClientRect();
  return { open: !o.hidden, flyout: o.dataset.flyout, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), W: innerWidth, H: innerHeight, tb: Math.round(tb),
    btnRight: Math.round(br.right), btnTop: Math.round(br.top), btnBottom: Math.round(br.bottom), fk: o.querySelectorAll('[data-fk]').length };
});
const inside = (f) => f.left >= 0 && f.right <= f.W && f.top >= f.tb && f.bottom <= f.H;
const touches = (f) => Math.abs(f.left - f.btnRight) <= 1 && f.top < f.btnBottom && f.bottom > f.btnTop;

(async () => {
  const router = await startRouter();
  let { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(String(ver) === '2.6.11.1', 'app version 2.6.11.1', ver);
  const before = await win.evaluate((a) => {
    const A = Store.state.settings.ai; const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + a.port + '/v1';
    for (const k of ['commands', 'chat', 'vision', 'summarize']) A.tasks[k] = { p: 'llama', m: a.QWEN };
    Object.assign(A.servers.llama, { ctx: 32768, port: a.port, extra: '--models-max 1' }); A.assistant.thinking = false;
    Store.state.subs = [{ id: 's1', name: 'Netflix', price: 13.99, currency: 'EUR', cycle: 'monthly', next: '2026-11-20', active: true, color: '#e50914', icon: '🎬' }, { id: 's2', name: 'Spotify', price: 10.99, currency: 'EUR', cycle: 'monthly', next: '2026-11-25', active: true, color: '#1db954', icon: '🎵' }];
    Store.save(true);
    const s = JSON.parse(JSON.stringify(Store.state.settings));
    return { settingsKeys: Object.keys(s).sort(), subs: JSON.stringify(Store.state.subs), recent: s.recentColors, hlOp: s.highlighterOpacity };
  }, { port: router.port, QWEN });
  ok(before.recent === undefined && before.hlOp === undefined, 'no new setting is written before it is used (additive)', before);

  // ---- a) tabs anchored to the end ----
  await win.evaluate(() => { const B = Store.state.boards; for (let i = B.length; i < 40; i++) B.push({ id: 'b' + i, name: 'Πίνακας ' + (i + 1), emoji: '📁', color: '#7c8cff', view: null, items: [] }); Store.save(true); App.switchBoard(B[0].id); Panels.tabs(); });
  await sleep(400);
  let s = await strip(win);
  const order = await win.evaluate(() => { const T = document.querySelector('#tabs'); const ids = Store.state.boards.map((b) => b.id); const vis = [...T.querySelectorAll('.tab')].filter((x) => !x.hidden).map((x) => ids.indexOf(x.dataset.board)); const hid = TabStrip._hidden.map((b) => ids.indexOf(b.id)); return { vis, hid }; });
  const lastVisible = order.vis.includes(39) && order.vis.includes(38);
  const firstHidden = order.hid.length > 0 && order.hid[0] === 1 && Math.max(...order.hid) < Math.min(...order.vis.filter((i) => i !== 0));
  ok(s.mode === 'overflow' && s.tops.length === 1 && order.vis[0] === 0 && lastVisible && firstHidden, 'active = 1st board: it stays visible with the LAST tabs; the FIRST ones (2…) are in «+N ▾»', { s, order });
  await shot(win, 'v26111-tabs-end.png');
  // «+» adds at the end, visible next to «+»
  await win.click('#btn-add-tab'); await sleep(500); await win.keyboard.press('Escape'); await sleep(200);
  const added = await win.evaluate(() => { const B = Store.state.boards; const last = B[B.length - 1]; const T = document.querySelector('#tabs'); const vis = [...T.querySelectorAll('.tab')].filter((x) => !x.hidden); return { n: B.length, lastActive: Store.state.active === last.id, lastTabIsLastVisible: vis[vis.length - 1].dataset.board === last.id }; });
  ok(added.n === 41 && added.lastActive && added.lastTabIsLastVisible, '«+» adds the new board at the END (rightmost visible tab, active)', added);
  // order as in the mockup: tabs → «+» → «+N ▾» (DOM/focus order and on screen)
  const ord = await win.evaluate(() => {
    const T = document.querySelector('#tabs'); const add = document.querySelector('#btn-add-tab'); const more = document.querySelector('#tabs-more');
    const vis = [...T.querySelectorAll('.tab')].filter((x) => !x.hidden); const lastR = vis[vis.length - 1].getBoundingClientRect().right;
    const a = add.getBoundingClientRect(); const m = more.getBoundingClientRect(); const zr = document.querySelector('#tabs-zone').getBoundingClientRect();
    const kids = [...document.querySelector('#tabs-zone').children].map((x) => x.id);
    return { kids, moreShown: !more.hidden, lastR: Math.round(lastR), addL: Math.round(a.left), addR: Math.round(a.right), moreL: Math.round(m.left), moreR: Math.round(m.right), zoneR: Math.round(zr.right), sameRow: Math.abs(a.top - m.top) < 6 };
  });
  ok(ord.kids.join() === 'tabs,btn-add-tab,tabs-more' && ord.moreShown && ord.lastR <= ord.addL && ord.addR <= ord.moreL && ord.moreR <= ord.zoneR + 1 && ord.sameRow, 'order like the mockup: tabs → «+» → «+N ▾» (on screen and for Tab focus)', ord);
  // pick a hidden first tab from «+N ▾»: it shows up pinned, the last tabs stay
  await win.click('#tabs-more'); await sleep(250);
  const menuFirst = await win.evaluate(() => ({ ids: [...document.querySelectorAll('#ctxmenu .mi')].map((x) => x.dataset.board).slice(0, 3), second: Store.state.boards[0].id }));
  ok(menuFirst.ids[0] === menuFirst.second, '«+N ▾» list starts with the FIRST hidden boards', menuFirst);
  await win.evaluate(() => document.querySelectorAll('#ctxmenu .mi')[2].click()); await sleep(350);
  const pinned = await win.evaluate(() => { const B = Store.state.boards; const ids = B.map((b) => b.id); const T = document.querySelector('#tabs'); const vis = [...T.querySelectorAll('.tab')].filter((x) => !x.hidden).map((x) => ids.indexOf(x.dataset.board)); return { active: ids.indexOf(Store.state.active), vis }; });
  ok(pinned.vis.includes(pinned.active) && pinned.vis.includes(40), 'a board picked from «+N»: visible together with the last tabs', pinned);
  // wheel moves the window; keyboard still works
  const s0 = await win.evaluate(() => TabStrip.start);
  await win.mouse.move(400, 15); await win.mouse.wheel(0, -120); await sleep(250);
  const s1 = await win.evaluate(() => TabStrip.start);
  ok(s1 < s0, 'wheel up scrolls the strip towards the first tabs', { s0, s1 });
  await win.evaluate(() => document.querySelector('#tabs .tab.on').focus()); await win.keyboard.press('End'); await sleep(250);
  const endK = await win.evaluate(() => Store.state.active === Store.state.boards[Store.state.boards.length - 1].id);
  await win.keyboard.press('Home'); await sleep(250);
  const homeK = await win.evaluate(() => Store.state.active === Store.state.boards[0].id && !document.querySelector('#tabs .tab.on').hidden);
  ok(endK && homeK, 'keyboard: End → last board, Home → first board (visible)');

  // ---- b) shapes flyout with arrow + line ----
  const dock = await win.evaluate(() => [...document.querySelectorAll('#dock .tool')].map((b) => b.dataset.tool));
  ok(!dock.includes('arrow') && !dock.includes('line') && dock.includes('shape') && dock.includes('frame'), 'dock: no separate arrow / line buttons (shapes and frame stay)', dock);
  await win.evaluate(() => { document.querySelector('#viewport').focus(); Tools.pick('select'); }); await win.mouse.click(700, 500);
  await win.keyboard.press('r'); await sleep(250);
  let f = await fly(win);
  const items = await win.evaluate(() => [...document.querySelectorAll('#toolopts [data-fk]')].map((b) => b.dataset.shape || b.dataset.shapeTool));
  ok(f.open && f.fk === 8 && items.join() === 'rect,ellipse,diamond,triangle,star,heart,arrow,line' && touches(f) && inside(f), 'R → shapes flyout: 6 shapes + arrow + line, keys 1–8, touches its button', { f, items });
  await win.keyboard.press('7'); await sleep(250);
  const k7 = await win.evaluate(() => ({ cur: Tools.cur, shapeOn: document.querySelector('#dock .tool[data-tool=shape]').classList.contains('on'), flyOpen: !document.querySelector('#toolopts').hidden, onItem: document.querySelector('#toolopts .ob.on')?.dataset.shapeTool }));
  ok(k7.cur === 'arrow' && k7.shapeOn && k7.flyOpen && k7.onItem === 'arrow', 'key 7 → arrow (shapes button lit, flyout stays open, arrow marked)', k7);
  await win.keyboard.press('8'); await sleep(200);
  ok((await win.evaluate(() => Tools.cur)) === 'line', 'key 8 → line');
  await win.keyboard.press('3'); await sleep(200);
  ok((await win.evaluate(() => Tools.cur === 'shape' && Store.state.settings.shapeKind === 'diamond')), 'key 3 → back to shapes, diamond');
  await win.evaluate(() => Tools.pick('select')); await win.mouse.click(700, 500);
  await win.keyboard.press('a'); await sleep(200);
  f = await fly(win);
  ok((await win.evaluate(() => Tools.cur)) === 'arrow' && f.open && f.flyout === 'arrow' && touches(f), 'A still picks the arrow (flyout opens at the shapes button)', f);
  // draw an arrow and a line: same function as before
  const nA = await win.evaluate(() => Store.items().filter((i) => i.type === 'arrow').length);
  await win.mouse.move(600, 400); await win.mouse.down(); await win.mouse.move(760, 460, { steps: 6 }); await win.mouse.up(); await sleep(200);
  await win.keyboard.press('Escape'); await win.keyboard.press('l'); await sleep(150);
  await win.mouse.move(600, 520); await win.mouse.down(); await win.mouse.move(780, 520, { steps: 6 }); await win.mouse.up(); await sleep(200);
  const drawn = await win.evaluate((n) => ({ arrows: Store.items().filter((i) => i.type === 'arrow').length - n, lines: Store.items().filter((i) => i.type === 'line').length }), nA);
  ok(drawn.arrows === 1 && drawn.lines >= 1, 'arrow and line are drawn as before', drawn);
  await win.keyboard.press('Escape');
  await shot(win, 'v26111-flyout-shapes.png');
  await win.evaluate(() => Tools.pick('shape')); await sleep(200); await shot(win, 'v26111-flyout-shapes-open.png');

  // ---- c) pen flyout ----
  await win.evaluate(() => { Tools.pick('select'); Tools.pick('pen'); }); await sleep(250);
  f = await fly(win);
  const pen = await win.evaluate(() => {
    const o = document.querySelector('#toolopts'); const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const dots = [...o.querySelectorAll('.szb i')].map((i) => { const r = i.getBoundingClientRect(); const bg = getComputedStyle(i).backgroundColor; return { w: Math.round(r.width), bg }; });
    return { hex: o.querySelector('.fo-hex')?.value, drop: vis(o.querySelector('[data-eyedrop]')), op: o.querySelector('.fo-op')?.value, px: o.querySelector('.fo-px')?.value, pxMax: o.querySelector('.fo-px')?.max, dots, fk: o.querySelectorAll('[data-fk]').length };
  });
  ok(f.open && touches(f) && inside(f) && pen.fk === 9, 'pen flyout touches its button, inside the window, colours 1–9', f);
  ok(/^#[0-9A-F]{6}$/.test(pen.hex || '') && pen.drop && pen.op === '100' && pen.px === '4' && pen.pxMax === '40', 'pen flyout: hex field + eyedropper, opacity 100 %, thickness 4 px (max 40)', pen);
  ok(pen.dots.length === 4 && pen.dots.every((d) => d.w >= 3 && !/rgba\(0, 0, 0, 0\)|transparent/.test(d.bg)), 'the 4 size dots are visible (fixed: they were invisible)', pen.dots);
  await shot(win, 'v26111-flyout-pen.png');
  // hex: valid + invalid
  await win.fill('#toolopts .fo-hex', '#ff8800'); await win.press('#toolopts .fo-hex', 'Enter'); await sleep(250);
  let st = await win.evaluate(() => ({ c: Store.state.settings.penColor, rec: (Store.state.settings.recentColors || {}).pen }));
  ok(st.c === '#FF8800' && st.rec && st.rec[0] === '#FF8800', 'hex #ff8800 + Enter → pen colour #FF8800, first in recent colours', st);
  await win.fill('#toolopts .fo-hex', 'zz12'); await win.press('#toolopts .fo-hex', 'Enter'); await sleep(250);
  st = await win.evaluate(() => ({ c: Store.state.settings.penColor, v: document.querySelector('#toolopts .fo-hex').value }));
  ok(st.c === '#FF8800' && st.v === '#FF8800', 'invalid hex is refused (colour unchanged, field restored)', st);
  // digits typed in the hex / px field never pick a colour
  await win.click('#toolopts .fo-px'); await win.keyboard.press('Control+a'); await win.keyboard.type('15'); await win.keyboard.press('Enter'); await sleep(250);
  st = await win.evaluate(() => ({ c: Store.state.settings.penColor, px: Store.state.settings.penSize }));
  ok(st.c === '#FF8800' && st.px === 15, 'thickness 15 px typed in the field (digits did not pick colours 1/5)', st);
  await win.evaluate(() => { const i = document.querySelector('#toolopts .fo-px'); i.value = '99'; i.dispatchEvent(new Event('change')); }); await sleep(150);
  ok((await win.evaluate(() => Store.state.settings.penSize)) === 40, 'thickness is clamped to 40 px');
  await win.evaluate(() => { const i = document.querySelector('#toolopts .fo-px'); i.value = '6'; i.dispatchEvent(new Event('change')); const o = document.querySelector('#toolopts .fo-op'); o.value = '50'; o.dispatchEvent(new Event('change')); }); await sleep(150);
  // a stroke uses colour, px and opacity
  await win.evaluate(() => document.activeElement && document.activeElement.blur());
  await win.mouse.move(500, 300); await win.mouse.down(); await win.mouse.move(620, 330, { steps: 6 }); await win.mouse.up(); await sleep(250);
  const ink = await win.evaluate(() => { const l = Store.items().filter((i) => i.type === 'ink'); const it = l[l.length - 1]; return it && { color: it.color, size: it.size, op: it.opacity, kind: it.kind }; });
  ok(ink && ink.kind === 'pen' && ink.color === '#FF8800' && ink.size === 6 && ink.op === 0.5, 'a pen stroke uses the colour, 6 px and 50 % opacity', ink);
  // eyedropper: EyeDropper resolves → colour
  await win.evaluate(() => { Tools.pick('pen'); window.EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#123456' }); } }; });
  await sleep(150); await win.click('#toolopts [data-eyedrop]'); await sleep(300);
  st = await win.evaluate(() => ({ c: Store.state.settings.penColor, rec: Store.state.settings.recentColors.pen }));
  ok(st.c === '#123456' && st.rec[0] === '#123456', 'eyedropper (EyeDropper API) → #123456', st);
  // eyedropper fails / is cancelled → click on a card takes its colour
  const sid = await win.evaluate(() => { window.EyeDropper = class { open() { return Promise.reject(new DOMException('cancelled', 'AbortError')); } }; const it = Features.addAtCenter({ type: 'sticky', html: 'χρώμα', w: 200, h: 160, paper: '#a5d6a7' }); Canvas.select([]); Tools.pick('pen'); return it.id; });
  await sleep(250); await win.click('#toolopts [data-eyedrop]'); await sleep(300);
  const pickOn = await win.evaluate(() => document.body.dataset.colorPick === '1');
  const nInk = await win.evaluate(() => Store.items().filter((i) => i.type === 'ink').length);
  const sr = await win.evaluate((id) => { const r = Items.el(Store.get(id)).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sid);
  await win.mouse.click(sr.x, sr.y); await sleep(300);
  st = await win.evaluate((n) => ({ c: Store.state.settings.penColor, pick: document.body.dataset.colorPick || '', ink: Store.items().filter((i) => i.type === 'ink').length - n }), nInk);
  ok(pickOn && st.c === '#A5D6A7' && !st.pick && st.ink === 0, 'EyeDropper cancelled → click on a note takes its colour #A5D6A7 (no stroke drawn)', { pickOn, st });
  await win.evaluate(() => { window.EyeDropper = undefined; Tools.pick('pen'); }); await sleep(150); await win.click('#toolopts [data-eyedrop]'); await sleep(200);
  await win.keyboard.press('Escape'); await sleep(150);
  ok((await win.evaluate(() => !document.body.dataset.colorPick && Store.state.settings.penColor === '#A5D6A7')), 'no EyeDropper → fallback; Esc cancels it, colour unchanged');
  // recent colours: 4, newest first, clickable
  const rec = await win.evaluate(() => [...document.querySelectorAll('#toolopts .sw.recent')].map((b) => b.dataset.recent));
  ok(rec.length === 3 && rec[0] === '#A5D6A7' && rec.includes('#123456') && rec.includes('#FF8800'), 'recent colours shown, newest first', rec);
  for (const c of ['#111111', '#222222']) await win.evaluate((c) => { const i = document.querySelector('#toolopts .fo-hex'); i.value = c; i.dispatchEvent(new Event('change')); }, c);
  await sleep(200);
  const rec2 = await win.evaluate(() => [...document.querySelectorAll('#toolopts .sw.recent')].map((b) => b.dataset.recent));
  ok(rec2.length === 4 && rec2[0] === '#222222' && !rec2.includes('#FF8800'), 'at most 4 recent colours (oldest drops off)', rec2);
  await win.evaluate(() => document.querySelectorAll('#toolopts .sw.recent')[2].click()); await sleep(200);
  ok((await win.evaluate(() => Store.state.settings.penColor)) === rec2[2], 'clicking a recent colour selects it');
  await shot(win, 'v26111-flyout-pen-recent.png');
  // highlighter: own colours, 38 %
  await win.evaluate(() => Tools.pick('highlighter')); await sleep(200);
  const hl = await win.evaluate(() => ({ sw: [...document.querySelectorAll('#toolopts .fo-grid:not(.fo-recent) .sw:not(.custom)')].map((b) => b.dataset.tip), op: document.querySelector('#toolopts .fo-op').value }));
  ok(hl.sw.length === 6 && hl.sw[0] === '#FFE14D' && hl.op === '38', 'highlighter keeps its 6 colours and 38 % opacity', hl);
  await win.mouse.move(500, 600); await win.mouse.down(); await win.mouse.move(640, 610, { steps: 6 }); await win.mouse.up(); await sleep(250);
  ok((await win.evaluate(() => { const l = Store.items().filter((i) => i.kind === 'highlighter'); return l[l.length - 1].opacity; })) === 0.38, 'a highlighter stroke still has 38 % opacity');
  await win.evaluate(() => Tools.pick('pen')); await setSize(app, win, 1000, 560); await sleep(300);
  f = await fly(win);
  ok(f.open && inside(f) && touches(f), 'short window (1000×560): pen flyout stays inside and touches its button', f);
  await shot(win, 'v26111-flyout-pen-short.png');
  await setSize(app, win, 1440, 900); await win.evaluate(() => Tools.pick('select'));

  // ---- note flyout: 10th paper kind = key 0 (only while open, never while typing; hint in the tooltip) ----
  await win.evaluate(() => { Store.state.settings.stickyKind = ''; Tools.pick('sticky'); document.querySelector('#viewport').focus(); }); await sleep(250);
  const pk = await win.evaluate(() => { const b = [...document.querySelectorAll('#toolopts [data-pk]')]; return { n: b.length, fk: b.map((x) => x.dataset.fk || ''), aria: b[9]?.getAttribute('aria-keyshortcuts'), last: b[9]?.dataset.pk }; });
  ok(pk.n === 10 && pk.fk.join('') === '1234567890' && pk.aria === '0' && pk.last === 'glass', 'note flyout: 10 paper kinds with keys 1–9 and 0 (10th = Γυαλί)', pk);
  await win.keyboard.press('0'); await sleep(150);
  ok((await win.evaluate(() => Store.state.settings.stickyKind)) === 'glass', 'note flyout open: key 0 → 10th paper kind');
  await win.evaluate(() => { Store.state.settings.stickyKind = ''; Tools.opts(); document.querySelector('#viewport').focus(); }); await sleep(150);
  await win.keyboard.press('Numpad0'); await sleep(150);
  ok((await win.evaluate(() => Store.state.settings.stickyKind)) === 'glass', 'note flyout open: Numpad 0 → 10th paper kind');
  const box0 = await win.evaluate(() => { const b = document.querySelector('#toolopts [data-fk="0"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await win.mouse.move(box0.x, box0.y); await sleep(700);
  const tip0 = await win.evaluate(() => { const x = document.querySelector('#tip'); return { hidden: x.hidden, text: x.textContent, key: x.querySelector('.tip-key')?.textContent }; });
  ok(!tip0.hidden && tip0.key === '0' && /Γυαλί|Glass/.test(tip0.text), 'tooltip of the 10th paper kind shows «0»', tip0);
  await win.mouse.move(700, 500);
  // typing in a card with the note flyout open: «0» is written, the kind is not changed
  const cid0 = await win.evaluate(() => { Tools.pick('select'); return Features.addAtCenter({ type: 'sticky', html: '', w: 220, h: 160 }).id; }); await sleep(150);
  await win.evaluate(() => { Store.state.settings.stickyKind = 'lined'; Tools.pick('sticky'); }); await sleep(100);
  await win.evaluate((id) => Canvas.edit(id), cid0); await sleep(200);
  await win.keyboard.type('10'); await sleep(200);
  const typed0 = await win.evaluate((id) => ({ html: document.querySelector(`.item[data-id="${id}"] .txt`)?.innerText || '', kind: Store.state.settings.stickyKind }), cid0);
  ok(/10/.test(typed0.html) && typed0.kind === 'lined', 'typing «10» in a card: written in the card, paper kind unchanged', typed0);
  await win.evaluate(() => Canvas.endEdit()); await sleep(100);
  // other flyouts: no «0» (pen has 9 keys, shapes 8); no flyout: «0» does nothing
  const other0 = await win.evaluate(() => { Tools.pick('pen'); const p = [...document.querySelectorAll('#toolopts [data-fk]')].map((x) => x.dataset.fk).join(''); Tools.pick('shape'); const s = [...document.querySelectorAll('#toolopts [data-fk]')].map((x) => x.dataset.fk).join(''); return { p, s }; });
  ok(other0.p === '123456789' && other0.s === '12345678', 'only the note flyout has key 0 (pen 1–9, shapes 1–8)', other0);
  await win.evaluate(() => { Tools.pick('select'); document.querySelector('#viewport').focus(); }); await sleep(100);
  const z0 = await win.evaluate(() => JSON.stringify([Store.state.settings.stickyKind, Store.state.settings.shapeKind, Canvas.view ? Canvas.view.z : null]));
  await win.keyboard.press('0'); await sleep(150);
  ok((await win.evaluate(() => JSON.stringify([Store.state.settings.stickyKind, Store.state.settings.shapeKind, Canvas.view ? Canvas.view.z : null]))) === z0, 'no flyout open: «0» changes nothing');

  // ---- tooltip + zoom ----
  const lib = await win.evaluate(() => { const b = document.querySelector('#dock .tool[data-tool=library]'); return { tip: t(b.dataset.tip), aria: b.getAttribute('aria-label') }; });
  await win.hover('#dock .tool[data-tool=library]'); await sleep(700);
  const tipTxt = await win.evaluate(() => { const x = document.getElementById('tip'); return x && !x.hidden ? x.textContent : ''; });
  ok(lib.tip === 'Βιβλιοθήκη (Ctrl+E)' && /Βιβλιοθήκη \(Ctrl\+E\)/.test(tipTxt), 'tooltip on 😊+: «Βιβλιοθήκη (Ctrl+E)»', { lib, tipTxt });
  ok((await win.evaluate(() => Canvas.MINZ === 0.05 && Canvas.MAXZ === 8)), 'zoom limits stay 5 %–800 %');

  // ---- regressions ----
  const rid = await win.evaluate(() => Features.addAtCenter({ type: 'sticky', html: 'undo', w: 200, h: 160 }).id);
  await win.mouse.click(300, 700); await win.evaluate(() => document.querySelector('#viewport').focus()); await win.keyboard.press('Control+z'); await sleep(300);
  const goneZ = await win.evaluate((id) => !Store.items().some((i) => i.id === id), rid);
  await win.keyboard.press('Control+y'); await sleep(300);
  ok(goneZ && (await win.evaluate((id) => Store.items().some((i) => i.id === id), rid)), 'Ctrl+Z removes the new card, Ctrl+Y brings it back');
  await win.evaluate(() => { Store.state.chat = []; Assistant.show(); Assistant.render(); document.querySelector('#as-q').value = 'Γεια'; Assistant.send(); });
  await win.waitForFunction(() => !Assistant.busy && (Store.state.chat || []).some((m) => m.role === 'assistant'), null, { timeout: 30000 }).catch(() => {});
  const ans = await win.evaluate(() => { const m = (Store.state.chat || []).filter((x) => x.role === 'assistant').pop(); return m ? { c: m.content, e: !!m.error } : null; });
  ok(ans && !ans.e && /απαντώ κανονικά/.test(ans.c), 'assistant still answers', ans);
  await win.evaluate(() => { try { Assistant.hide(); } catch (e) {} });
  const mcp = await win.evaluate(async () => { const list = await API.inv('plugins:list').catch(() => null); const arr = Array.isArray(list) ? list : (list && list.plugins) || []; return arr.some((p) => /mcp/i.test(String(p.id || p.name || ''))); });
  ok(mcp, 'MCP plugin still installed');
  const after = await win.evaluate(() => ({ keys: Object.keys(Store.state.settings).sort(), subs: JSON.stringify(Store.state.subs), boards: Store.state.boards.length }));
  ok(after.subs === before.subs, 'subscriptions unchanged');
  ok(before.settingsKeys.every((k) => after.keys.includes(k)), 'no existing setting removed', before.settingsKeys.filter((k) => !after.keys.includes(k)));
  ok(after.boards === 41, 'boards unchanged (40 + the one added)');
  await win.evaluate(() => Store.save(true)); await sleep(300); await quit(app);
  ({ app, win } = await launch());
  const re = await win.evaluate(() => ({ rec: (Store.state.settings.recentColors || {}).pen || [], op: Store.state.settings.penOpacity, subs: JSON.stringify(Store.state.subs), boards: Store.state.boards.length }));
  ok(re.rec.length === 4 && re.op === 50 && re.subs === before.subs && re.boards === 41, 'after restart: recent colours, opacity, subscriptions and boards kept', re);
  s = await strip(win);
  ok(s.tops.length === 1 && s.onVis && s.mode === 'overflow', 'after restart: one line, active visible', s);
  await quit(app);
  router.srv.close();
  console.log(`\nv2.6.11.1 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
