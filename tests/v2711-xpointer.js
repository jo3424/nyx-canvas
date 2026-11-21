'use strict';
// v2.7.1.1 — moving widgets with a REAL pointer (xdotool → XTest, like a physical mouse), for EACH widget:
//   Σήμερα, Συνδρομές, Υπενθυμίσεις, Ημερολόγιο, #tag
//   · drag from the centre → it moves; Ctrl+Z → back (one undo step)
//   · drag (≥ 4 px) from a row / button / day → it moves and the row's action does NOT run; Ctrl+Z → back
//   · click on the row (with 2 px of hand jitter) → its action runs and the widget does not move
//   · locked → a drag does not move it
//   · an input inside a widget does not start a move
// Needs an X server (xvfb-run -a -s "-screen 0 1600x1000x24") and xdotool.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2711x-'));
const SHOTS = process.env.NYX_SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const FX = require('./fixtures/openmeteo271'); const MOCK = path.join(DATA, 'mock.json'); fs.writeFileSync(MOCK, JSON.stringify({ body: FX.build(Date.now()) }));
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 700) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let XDO = ''; try { XDO = cp.execFileSync('sh', ['-c', 'command -v xdotool']).toString().trim(); } catch (_) {}
if (!XDO || !process.env.DISPLAY) { console.log('v2.7.1.1 real-pointer: SKIPPED (needs DISPLAY + xdotool)'); process.exit(0); }
const X = (...a) => cp.execFileSync(XDO, a.map(String));
(async () => {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_TODAY271_MOCK: MOCK } });
  const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 0, y: 0, width: 1440, height: 900 }); w.focus(); });
  await win.waitForFunction(() => window.__nyxLook2611 === true && window.__nyxWidgets270 === true, null, { timeout: 30000 }); await sleep(800);
  console.log('app version ' + await win.evaluate(() => Store.info && Store.info.version) + ' · root ' + ROOT);
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  const S = (p) => [Math.round(cb.x + p.x), Math.round(cb.y + p.y)];
  const ids = await win.evaluate(() => {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const D = (d, h = 9, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x; }; const ymd = (x) => x.toISOString().slice(0, 10);
    Store.state.subs = [{ id: 's1', name: 'Υπηρεσία ταινιών Α', price: 9.99, currency: 'EUR', cycle: 'monthly', next: ymd(D(1)), active: true, color: '#e50914', icon: '🎬' }, { id: 's2', name: 'Μουσική Β', price: 8, currency: 'EUR', cycle: 'monthly', next: ymd(D(3)), active: true, color: '#1db954', icon: '🎵' }];
    Store.state.boards.push({ id: 'wx', name: 'Widgets', emoji: '🧩', color: '#7c8cff', view: { x: 0, y: 0, z: 1 }, items: [
      { id: 'r1', type: 'sticky', x: -900, y: 900, w: 200, h: 160, html: 'Πότισμα φυτών', reminder: { on: true, at: D(0, 23, 58).toISOString() } },
      { id: 'r2', type: 'sticky', x: -660, y: 900, w: 200, h: 160, html: 'Τηλέφωνο στον λογιστή', reminder: { on: true, at: D(1, 10, 0).toISOString() } },
      { id: 't1', type: 'sticky', x: -420, y: 900, w: 200, h: 160, html: 'Ιδέα για το σαλόνι', tags: ['ιδέες'] },
      { id: 't2', type: 'sticky', x: -180, y: 900, w: 200, h: 160, html: 'Ιδέα για δώρο', tags: ['ιδέες'] }] });
    Store.save(true); App.switchBoard('wx');
    const place = { today: [-580, -420], subs: [-60, -420], reminders: [320, -420], calendar: [-580, -140], tag: [-60, -140] }; // right of the dock
    const out = {}; for (const k of Object.keys(place)) { const w = Widgets.add(k, 'm'); w.x = place[k][0]; w.y = place[k][1]; if (k === 'tag') w.wtag = 'ιδέες'; Items.mount(w); out[k] = w.id; }
    Store.save(true); window.__home = () => { Canvas.view = { x: innerWidth / 2, y: innerHeight / 2, z: 1 }; Canvas.applyView(); Canvas.deselect && Canvas.deselect(); }; __home();
    window.__acts = []; const a0 = Widgets.action.bind(Widgets); Widgets.action = (act, it, el) => { __acts.push(act + ':' + it.wkind); return a0(act, it, el); };
    return out;
  });
  await sleep(1500);
  const pt = (sel, fx = 0.5, fy = 0.5) => win.evaluate(([s, fx, fy]) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; }, [sel, fx, fy]);
  const item = (id) => win.evaluate((id) => { const i = Store.state.boards.find((b) => b.id === 'wx').items.find((x) => x.id === id); return i && { x: Math.round(i.x), y: Math.round(i.y) }; }, id);
  const acts = () => win.evaluate(() => __acts.splice(0));
  const home = async () => { await win.evaluate(() => { document.querySelectorAll('.ctxmenu,.pop').forEach((m) => { m.hidden = true; }); if (Panels.drawerKind) Panels.closeDrawer(); __home(); }); await sleep(350); };
  async function xdrag(a, b) {
    const [ax, ay] = S(a), [bx, by] = S(b);
    X('mousemove', ax, ay); await sleep(150); X('mousedown', 1); await sleep(120);
    for (let i = 1; i <= 12; i++) { X('mousemove', Math.round(ax + (bx - ax) * i / 12), Math.round(ay + (by - ay) * i / 12)); await sleep(40); }
    await sleep(150); X('mouseup', 1); await sleep(500);
  }
  async function xclick(a, jitter = 2) { const [ax, ay] = S(a); X('mousemove', ax, ay); await sleep(150); X('mousedown', 1); await sleep(60); X('mousemove', ax + jitter, ay); await sleep(60); X('mouseup', 1); await sleep(600); }
  const undo = async () => { await win.evaluate(() => document.body.focus()); await win.keyboard.press('Control+z'); await sleep(450); };
  const near = (a, b, dx, dy, tol = 12) => a && b && Math.abs(b.x - a.x - dx) <= tol && Math.abs(b.y - a.y - dy) <= tol;
  // per widget: the «centre» point and the «row» (an element with an action) + what its click must do
  const W = {
    today: { name: 'Σήμερα', centre: '.t271-strip', row: '[data-act=w-menu]', act: 'w-menu' },
    subs: { name: 'Συνδρομές', centre: '.wg-body', row: '.wg-row', act: 'w-subs', after: () => win.evaluate(() => Panels.drawerKind === 'subs') },
    reminders: { name: 'Υπενθυμίσεις', centre: '.wg-body', row: '.wg-row', act: 'w-open' },
    calendar: { name: 'Ημερολόγιο', centre: '.wg-body', row: '[data-act=w-day]', act: 'w-day', after: (id) => win.evaluate((id) => Widgets.picked.has(id), id) },
    tag: { name: '#tag', centre: '.wg-body', row: '.wg-row', act: 'w-open' }
  };
  for (const [k, cfg] of Object.entries(W)) {
    const id = ids[k]; const q = (s) => `.item[data-id="${id}"] ${s}`;
    await home(); await acts();
    // 1) from the centre
    const A0 = await item(id); let p = await pt(q(cfg.centre), 0.5, 0.55); await xdrag(p, { x: p.x + 120, y: p.y + 60 });
    const A1 = await item(id); ok(near(A0, A1, 120, 60), `${cfg.name}: drag from the centre moves it (≈ +120, +60)`, { A0, A1, p });
    await undo(); const A2 = await item(id); ok(near(A0, A2, 0, 0, 1), `${cfg.name}: Ctrl+Z puts it back (one undo step)`, { A0, A2 });
    // 2) from a row / button / day: moves, the action does not run
    await home(); await acts();
    p = await pt(q(cfg.row), 0.5, 0.5); const hasRow = !!p; ok(hasRow, `${cfg.name}: has a row / button with an action (${cfg.row})`);
    if (hasRow) {
      await xdrag(p, { x: p.x + 100, y: p.y + 50 }); const B1 = await item(id); const a1 = await acts();
      ok(near(A0, B1, 100, 50), `${cfg.name}: drag from a row (${cfg.act}) moves it`, { A0, B1 });
      ok(!a1.length, `${cfg.name}: … and the row's action does not run`, a1);
      await undo(); const B2 = await item(id); ok(near(A0, B2, 0, 0, 1), `${cfg.name}: Ctrl+Z puts it back`, { A0, B2 });
      // 3) a click (2 px of jitter) runs the action, no move
      await home(); await acts(); p = await pt(q(cfg.row), 0.5, 0.5); await xclick(p, 2);
      const C1 = await item(id); const a2 = await acts(); const eff = cfg.after ? await cfg.after(id) : true;
      ok(a2.includes(cfg.act + ':' + k) && eff, `${cfg.name}: click on the row → ${cfg.act} runs`, { a2, eff });
      ok(near(A0, C1, 0, 0, 1), `${cfg.name}: … and the widget does not move`, { A0, C1 });
      if (SHOTS && k === 'subs') await win.screenshot({ path: path.join(SHOTS, 'v2711x-row-click-subs.png') });
    }
    // 4) locked → no move
    await home(); await win.evaluate((id) => { const it = Store.get(id); Store.change(() => { it.locked = true; }); Items.mount(it); }, id); await sleep(200);
    p = await pt(q(cfg.centre), 0.5, 0.55); await xdrag(p, { x: p.x + 120, y: p.y + 60 }); const L1 = await item(id);
    ok(near(A0, L1, 0, 0, 1), `${cfg.name}: locked → a drag does not move it`, { A0, L1 });
    await win.evaluate((id) => { const it = Store.get(id); Store.change(() => { it.locked = false; }); Items.mount(it); }, id); await sleep(200);
  }
  // an input inside a widget body: typing / selecting there never moves the widget
  await home();
  await win.evaluate((id) => { const b = document.querySelector(`.item[data-id="${id}"] .wg-body`); const i = document.createElement('input'); i.className = 'inp t2711-inp'; i.value = 'κείμενο'; i.style.cssText = 'position:relative;z-index:5;width:120px'; b.prepend(i); }, ids.subs);
  const I0 = await item(ids.subs); let p = await pt(`.item[data-id="${ids.subs}"] .t2711-inp`); await xdrag(p, { x: p.x + 80, y: p.y + 40 });
  const I1 = await item(ids.subs); ok(near(I0, I1, 0, 0, 1), 'an input inside a widget does not move it', { I0, I1 });
  // 3 px total movement on a row = still a click (the threshold is 4 px)
  await home(); await acts(); await win.evaluate((id) => Items.mount(Store.get(id)), ids.calendar); await sleep(300);
  p = await pt(`.item[data-id="${ids.calendar}"] [data-act=w-next]`); const N0 = await item(ids.calendar); await xclick(p, 3); const a3 = await acts(); const N1 = await item(ids.calendar);
  ok(a3.includes('w-next:calendar') && near(N0, N1, 0, 0, 1), 'calendar ›: a click with 3 px of movement changes the month and does not move it', { a3, N0, N1 });
  ok(!errs.length, 'no page errors', errs);
  await app.close();
  console.log(`\nv2.7.1.1 real-pointer: ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\nv2.7.1.1 real-pointer: ${passes} passed, ${fails + 1} failed`); process.exit(1); });
