'use strict';
// v2.6.13 UI — the tab bar AUTO-SCROLLS while a tab is dragged (pointer-events drag of 2.6.12.2), driven twice:
//   pass «mouse»: Playwright mouse.down / move / up (Input.dispatchMouseEvent → real pointer events, no dispatchEvent)
//   pass «X»:     a REAL X pointer moved by xdotool (XTest), like a physical mouse (skipped without DISPLAY + xdotool)
// Cases (40 boards, so most tabs are hidden):
//  1) hold near the RIGHT edge → the bar scrolls; drop BETWEEN tabs that were hidden at the start → order as planned
//  2) speed ∝ closeness: 1 s at 3 px from the edge scrolls more tabs than 1 s at 34 px (edge zone 40 px, 250 ms dwell)
//  2b) a quick pass over the edge zone (< 250 ms) does not scroll
//  3) release → scrolling stops at once;  4) Esc while scrolling → stops, nothing moved
//  5) LEFT edge → scrolls back and stops at the first tab;  6) mid-drag screenshots 1440×900 and 1024×700
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const SHOTS = process.env.NYX_SHOTS || path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0, passes = 0;
const T0 = Date.now(); const ok = (c, m, x) => { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let XDO = ''; try { XDO = cp.execFileSync('sh', ['-c', 'command -v xdotool']).toString().trim(); } catch (_) {}
const X = (...a) => cp.execFileSync(XDO, a.map(String));

async function launch(w, h, real) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2613as-'));
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, [w, h, real]) => { const x = BrowserWindow.getAllWindows()[0]; if (real) { x.setBounds({ x: 0, y: 0, width: w, height: h }); x.focus(); } else { x.setSize(w, h); x.center(); } }, [w, h, real]);
  await win.waitForFunction(() => (window.__nyxV2Ready === true || window.__nyxV25Ready === true) && window.__nyxLook2611 === true, null, { timeout: 30000 });
  await win.waitForTimeout(600);
  await win.evaluate(() => {
    document.querySelectorAll('#toasts > *, .toast').forEach((t) => t.remove());
    const B = Store.state.boards; for (let i = 0; i < 40; i++) B.push({ id: 'a' + i, name: 'Πίνακας ' + i, emoji: '📁', color: '#7c8cff', view: null, items: [] });
    Store.save(true); Panels.tabs(); TabStrip.start = 0; TabStrip.layout({ follow: false });
  });
  await sleep(300);
  return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (_) {} }

async function pass(name, real, w, h, shotTag) {
  console.log(`\n— pass «${name}» ${w}×${h}`);
  const { app, win } = await launch(w, h, real);
  const cb = real ? await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds()) : { x: 0, y: 0 };
  // pointer driver
  const P = real ? {
    move: async (x, y, steps = 1, from) => { if (from && steps > 1) for (let i = 1; i < steps; i++) { X('mousemove', Math.round(cb.x + from.x + (x - from.x) * i / steps), Math.round(cb.y + from.y + (y - from.y) * i / steps)); await sleep(30); } X('mousemove', Math.round(cb.x + x), Math.round(cb.y + y)); await sleep(30); },
    down: async () => { X('mousedown', 1); await sleep(80); }, up: async () => { X('mouseup', 1); await sleep(80); }, esc: async () => { X('key', 'Escape'); await sleep(80); },
  } : {
    move: async (x, y, steps = 1) => { await win.mouse.move(x, y, { steps }); },
    down: async () => { await win.mouse.down(); }, up: async () => { await win.mouse.up(); }, esc: async () => { await win.keyboard.press('Escape'); },
  };
  let cur = { x: 0, y: 0 }; const go = async (x, y, steps = 8) => { await P.move(x, y, steps, cur); cur = { x, y }; };
  const st = () => win.evaluate(() => ({ start: TabStrip.start || 0, max: TabStrip.maxStart, mode: TabStrip.mode, vis: [...document.querySelectorAll('#tabs .tab:not([hidden])')].map((t) => t.dataset.board) }));
  const bar = () => win.evaluate(() => { const r = document.querySelector('#tabs').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, y: r.top + r.height / 2 }; });
  const tabPt = (id, fx = 0.5) => win.evaluate(([id, fx]) => { const e = document.querySelector(`#tabs .tab[data-board="${id}"]:not([hidden])`); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height / 2 }; }, [id, fx]);
  const ids = () => win.evaluate(() => Store.state.boards.map((b) => b.id));
  const reset = async () => { await win.evaluate(() => { TabStrip.start = 0; TabStrip.layout({ follow: false }); }); await sleep(150); };
  const grab = async (id) => { const p = await tabPt(id); await go(p.x, p.y, 2); await P.down(); await go(p.x + 30, p.y, 4); return p; };
  let s0 = await st(); const B = await bar();
  ok(s0.mode === 'overflow' && s0.max >= 14 && s0.start === 0, `${name}: 40 boards → overflow, ${s0.vis.length} tabs visible, maxStart ${s0.max}`, s0);
  // 1) right edge, drop between hidden tabs
  const I = await ids(); const hiddenAtStart = I.filter((x) => !s0.vis.includes(x)); const dragged = s0.vis[1];
  await grab(dragged);
  await go(B.right - 4, B.y, 10);
  let t = Date.now(); let s1 = await st(); while (s1.start < Math.min(6, s1.max) && Date.now() - t < 4000) { await sleep(60); s1 = await st(); }
  const mid = await win.evaluate(() => ({ ghost: !!document.querySelector('.tab-ghost'), glow: document.querySelector('#tabs').classList.contains('as-right') }));
  if (shotTag) await win.screenshot({ path: path.join(SHOTS, `v2613-${shotTag}-01-autoscroll-right-MIDDRAG.png`) });
  ok(s1.start >= Math.min(6, s1.max) && mid.ghost && mid.glow, `${name}: holding near the right edge scrolls the bar (start 0 → ${s1.start}), ghost follows, edge glows`, { s1, mid });
  await go((B.left + B.right) / 2, B.y, 6); await sleep(200); s1 = await st();
  const target = s1.vis.find((x) => hiddenAtStart.includes(x) && x !== dragged);
  const expOrder = await win.evaluate(([I, id, t]) => NyxUI.boardMove(I, id, t, 'before'), [I, dragged, target]);
  const tp = await tabPt(target, 0.2); await go(tp.x, tp.y, 6); await sleep(150);
  const stA = await st(); await P.up(); await sleep(400);
  const got = await ids(); const last = await win.evaluate(() => TabDrag.last);
  ok(!!target && got.join() === expOrder.join(), `${name}: dropped BEFORE «${target}», a tab that was hidden when the drag began`, { target, last, got: got.slice(0, 12) });
  ok(last && last.scrolled > 0 && last.moved, `${name}: TabDrag.last.scrolled = ${last && last.scrolled}`, last);
  const stB = await st(); await sleep(600); const stC = await st();
  ok(stB.start === stC.start, `${name}: after release the bar stays where it is (no more scrolling)`, { stA, stB, stC });
  // 2) speed ∝ closeness
  const rate = async (dx) => {
    await reset(); const v = (await st()).vis; await grab(v[1]); await go(B.right - dx, B.y, 8);
    const a = (await st()).start; await sleep(1000); const b = (await st()).start;
    await go((B.left + B.right) / 2, B.y, 4); await P.esc(); await P.up(); await sleep(300); return b - a;
  };
  const far = await rate(34), near = await rate(3);
  ok(far >= 1 && near > far, `${name}: 1 s at 34 px → ${far} tabs; 1 s at 3 px → ${near} tabs (closer = faster)`, { far, near });
  { await reset(); const v = (await st()).vis; await grab(v[1]); await go(B.right - 10, B.y, 2); await sleep(120); await go((B.left + B.right) / 2, B.y, 2); await sleep(500);
    const q = (await st()).start; await P.esc(); await P.up(); await sleep(300);
    ok(q === 0, `${name}: a quick pass through the edge zone (< 250 ms) does not scroll`, q); }
  // 4) Esc while scrolling
  await reset(); const before = await ids(); const v4 = (await st()).vis; await grab(v4[1]); await go(B.right - 4, B.y, 8); await sleep(400);
  await P.esc(); const e1 = await st(); await sleep(600); const e2 = await st(); await P.up(); await sleep(300);
  const l4 = await win.evaluate(() => TabDrag.last);
  ok(e1.start > 0 && e1.start === e2.start && (await ids()).join() === before.join() && l4 && l4.cancelled, `${name}: Esc while scrolling → stops at once (start ${e1.start} stays), nothing moved`, { e1: e1.start, e2: e2.start, l4 });
  ok(!(await win.evaluate(() => document.querySelector('#tabs').classList.contains('as-left') || document.querySelector('#tabs').classList.contains('as-right') || !!document.querySelector('.tab-ghost'))), `${name}: no glow / ghost left after Esc`);
  // 5) left edge back to the first tab
  await win.evaluate(() => { TabStrip.start = Math.min(8, TabStrip.maxStart); TabStrip.layout({ follow: false }); }); await sleep(150);
  const v5 = (await st()).vis; await grab(v5[Math.floor(v5.length / 2)]); await go(B.left + 3, B.y, 10);
  t = Date.now(); let s5 = await st(); let shotDone = false;
  while (s5.start > 0 && Date.now() - t < 4000) { if (!shotDone && shotTag && s5.start <= 6) { shotDone = true; await win.screenshot({ path: path.join(SHOTS, `v2613-${shotTag}-02-autoscroll-left-MIDDRAG.png`) }); } await sleep(40); s5 = await st(); }
  await sleep(400); const s5b = await st();
  ok(s5.start === 0 && s5b.start === 0, `${name}: near the left edge → scrolls back to the first tab and stops there`, { s5, s5b });
  const glowL = await win.evaluate(() => document.querySelector('#tabs').classList.contains('as-left'));
  ok(!glowL, `${name}: at the first tab the left glow switches off (nothing more to scroll)`);
  await P.esc(); await P.up(); await sleep(300);
  // pointer in the middle of the bar → no scroll
  await reset(); const v6 = (await st()).vis; await grab(v6[1]); await go((B.left + B.right) / 2, B.y, 6); await sleep(700);
  ok((await st()).start === 0, `${name}: pointer in the middle of the bar → no scroll`); await P.esc(); await P.up();
  await quit(app);
}
(async () => {
  await pass('mouse', false, 1440, 900, 'normal');
  await pass('mouse', false, 1024, 700, 'small');
  if (XDO && process.env.DISPLAY) await pass('X pointer', true, 1440, 900, 'xpointer');
  else console.log('X pointer pass: SKIPPED (needs DISPLAY + xdotool)');
  console.log(`\nv2.6.13 tab auto-scroll: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
