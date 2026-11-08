// Nyx v2.3 end-to-end (headless): xvfb-run -a node tests/v23.js
// toasts auto-dismiss · reminder X + undo · assistant docks beside drawers · Text tool writes inside notes · live font while typing ·
// text attached to a paper moves with it · paper kinds · visual video trimmer · widget mini-dashboard + agenda · themes · browser tabs.
// Screenshots → shots/v23-*.png
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v23-home ')); const DATA = path.join(HOME, 'Δεδομένα Nyx'); fs.mkdirSync(DATA);
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const listen = (srv) => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], env: { ...process.env, HOME, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_CODE_DIR: path.join(DATA, 'app-code') } });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|ERR_ABORTED|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 25000 }); await win.waitForTimeout(500);
  return { app, win };
}
async function quit(app) { const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 20)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const rect = (win, sel) => win.evaluate((sel) => { const r = (typeof sel === 'string' ? document.querySelector(sel) : null)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 } : null; }, sel);
const itemRect = (win, id) => win.evaluate((id) => { const r = Items.el(Store.get(id)).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, id);

(async () => {
  const page = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(`<!doctype html><title>Page ${q.url.slice(1)}</title><body style="background:${q.url.includes('b') ? '#264' : '#624'};color:#fff;font:40px sans-serif">PAGE ${q.url}</body>`); });
  const PP = await listen(page);
  let { app, win } = await launch();

  console.log('Toasts');
  await win.evaluate(() => { toast('short one', { ms: 1200 }); toast('⚠️ error stays longer'); toast('closable'); });
  await win.waitForTimeout(2200);
  let tt = await win.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent));
  ok(!tt.some(x => x.includes('short one')) && tt.some(x => x.includes('error stays')), 'normal toast auto-dismisses, error toast still visible', tt);
  await win.evaluate(() => [...document.querySelectorAll('#toasts .toast')].find(t => t.textContent.includes('closable'))?.querySelector('.tx').click()); await win.waitForTimeout(400);
  ok(!(await win.evaluate(() => document.querySelector('#toasts').textContent)).includes('closable'), 'toast ✕ closes it');
  await win.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));

  console.log('Reminders ✕ + undo');
  const rid = await win.evaluate(() => { const it = Features.addAtCenter({ type: 'sticky', html: 'Γάλα', w: 200, h: 160 }); Store.change(() => { it.reminder = { on: true, at: new Date(Date.now() + 7200e3).toISOString(), repeat: 'none', sound: 'chime', msg: 'Αγορά γάλα' }; }); Panels.reminders(); return it.id; });
  await win.waitForSelector('#drawer .rem-x'); await win.click('#drawer .rem-x'); await win.waitForTimeout(300);
  ok(await win.evaluate((id) => !Store.get(id)?.reminder?.on && !document.querySelector('#drawer .rem-row .rem-text')?.textContent.includes('Αγορά'), rid), 'reminder ✕ removes it from the list');
  await win.evaluate(() => document.querySelector('#toasts .toast .tact')?.click()); await win.waitForTimeout(300);
  ok(await win.evaluate((id) => Store.get(id)?.reminder?.msg === 'Αγορά γάλα', rid), 'undo brings it back');

  console.log('Agenda in reminders drawer');
  await win.evaluate(() => { if (Panels.drawerKind !== 'reminders') Panels.reminders(); }); await win.waitForSelector('#drawer .agenda');
  await win.fill('#drawer .ag-add .dmy', '30/11'); await win.fill('#drawer .ag-add .inp.grow', 'Πληρωμή ΔΕΗ'); await win.press('#drawer .ag-add .inp.grow', 'Enter'); await win.waitForTimeout(300);
  const ag = await win.evaluate(() => (Store.state.agenda || []).find(a => a.text === 'Πληρωμή ΔΕΗ'));
  ok(ag && /-11-30$/.test(ag.day), 'agenda note for 30/11 (DD/MM input) saved on the right day', ag);
  ok(await win.evaluate(() => [...document.querySelectorAll('#drawer .ag-day')].some(e => /30\/11/.test(e.textContent))), 'agenda day heading shows DD/MM', await win.evaluate(() => [Panels.drawerKind, [...document.querySelectorAll('#drawer .ag-day')].map(e => e.textContent), document.activeElement?.className]));

  console.log('Assistant docks beside the drawer');
  await win.evaluate(() => { Panels.subs(); Assistant.show(); }); await win.waitForTimeout(500);
  const dr = await rect(win, '#drawer'), as = await rect(win, '#assistant');
  ok(dr && as && (as.x + as.w <= dr.x + 2 || as.x >= dr.x + dr.w - 2), 'assistant does not cover the open drawer', { dr, as });
  await win.evaluate(() => { Assistant.hide(); Panels.closeDrawer(); });

  console.log('Text tool writes inside a note + live font');
  const sid = await win.evaluate(() => { Store.items().forEach(i => { if (i.type !== 'sticky') return; }); const it = Features.addAtCenter({ type: 'sticky', html: 'Αρχή', w: 260, h: 220, paper: '#8fd3ff' }); Canvas.select([]); return it.id; });
  let sr = await itemRect(win, sid);
  const nText0 = await win.evaluate(() => Store.items().filter(i => i.type === 'text').length);
  await win.evaluate(() => Tools.pick('text')); await win.mouse.click(sr.cx, sr.cy + 30); await win.waitForTimeout(250);
  ok(await win.evaluate(([id, n0]) => Canvas.editing === id && Store.items().filter(i => i.type === 'text').length === n0, [sid, nText0]), 'clicking a note with the Text tool edits the note (no new text box on top)', await win.evaluate(([id, x, y]) => ({ ed: Canvas.editing, id, n: Store.items().filter(i => i.type === 'text').length, at: document.elementFromPoint(x, y)?.className, z: Canvas.view.z }), [sid, sr.cx, sr.cy + 30]));
  await win.keyboard.press('End'); await win.keyboard.type(' γράφω');
  await win.evaluate((id) => Canvas.select([id]), sid); await win.waitForTimeout(150);
  const live = await win.evaluate((id) => { const s = document.querySelector('#stylebar .sb-sel'); if (!s) return 'no stylebar'; s.value = 'Caveat'; s.dispatchEvent(new Event('change')); const tx = Items.el(Store.get(id)).querySelector('.txt'); return { ed: Canvas.editing === id, ff: tx.style.fontFamily, focus: document.activeElement === tx || tx.contains(document.activeElement) }; }, sid);
  await win.keyboard.type(' και συνεχίζω'); await win.waitForTimeout(100);
  const txt = await win.evaluate((id) => Items.el(Store.get(id)).querySelector('.txt').innerText, sid);
  ok(live.ed && /Caveat/.test(live.ff) && live.focus, 'font change applies live while still typing', live);
  ok(/γράφω και συνεχίζω/.test(txt), 'typing continues after the font change', txt);
  await win.evaluate(() => Canvas.commitEdit?.() || Canvas.stopEdit?.() || document.activeElement.blur()); await win.mouse.click(60, 860); await win.waitForTimeout(200);

  console.log('Text attached to a paper moves with it (+lock badge)');
  const att = await win.evaluate(() => { const host = Features.addAtCenter({ type: 'image', file: '', w: 300, h: 200 }); const p = host; window.__h0 = { x: host.x, y: host.y }; const tx = Store.change(() => Store.addItem({ type: 'text', x: p.x + 20, y: p.y + 20, w: 200, h: 34, html: 'Λεζάντα', parent: p.id, locked: true })); Items.mount(tx); Canvas.select([]); return { host: host.id, tx: tx.id, x: tx.x, y: tx.y }; });
  sr = await itemRect(win, att.host);
  await win.evaluate(() => Tools.pick('select')); await win.mouse.move(sr.x + sr.w - 30, sr.y + sr.h - 30); await win.mouse.down(); await win.mouse.move(sr.x + sr.w + 70, sr.y + sr.h + 30, { steps: 6 }); await win.mouse.up(); await win.waitForTimeout(200);
  const moved = await win.evaluate((a) => { const t = Store.get(a.tx); const H = Store.get(a.host); a.hdx = H.x - __h0.x; a.hdy = H.y - __h0.y; const r = Items.el(t).getBoundingClientRect(); const b = Items.el(t).querySelector('.bdg'); return { dx: t.x - a.x, dy: t.y - a.y, hdx: a.hdx, hdy: a.hdy, badge: !!b, inside: b ? Items.el(t).contains(b) : false }; }, att);
  const zz = await win.evaluate(() => Canvas.view.z); ok(Math.abs(moved.hdx - 100 / zz) < 12 && Math.abs(moved.hdy - 60 / zz) < 12 && Math.abs(moved.dx - moved.hdx) < 0.5 && Math.abs(moved.dy - moved.hdy) < 0.5, 'locked attached text moved exactly with the card (≈100,60 px drag)', moved);
  ok(moved.badge && moved.inside, 'lock badge lives on the item, so it follows');
  // text created by clicking a card with the Text tool gets attached
  sr = await itemRect(win, att.host); await win.evaluate(() => Tools.pick('text')); await win.mouse.click(sr.cx, sr.cy); await win.waitForTimeout(200);
  await win.keyboard.type('νέα'); const np = await win.evaluate((h) => Store.items().filter(i => i.type === 'text' && i.parent === h).length, att.host);
  ok(np === 2, 'Text tool on a card creates attached text', [np, await win.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return [e?.className, e?.closest('.item')?.dataset.id]; }, [sr.cx, sr.cy]), att.host]);
  await win.mouse.click(60, 860); await win.waitForTimeout(150);
  const nb0 = await win.evaluate(() => Store.items().filter(i => i.type === 'text').length);
  await win.evaluate(() => Tools.pick('text')); await win.mouse.click(250, 700); await win.waitForTimeout(150); await win.keyboard.type('κενό'); await win.mouse.click(60, 860); await win.waitForTimeout(150);
  ok(await win.evaluate((n) => Store.items().filter(i => i.type === 'text').length === n + 1 && Store.items().some(i => i.type === 'text' && /κενό/.test(i.html)), nb0), 'Text tool on empty canvas still creates a text box');

  console.log('Paper kinds');
  const pid = await win.evaluate(() => { const it = Features.addAtCenter({ type: 'sticky', html: 'Τετράδιο', w: 240, h: 220 }); Canvas.select([it.id]); Panels.stylebar(); return it.id; });
  await win.waitForTimeout(150); const pkb = await win.$(`#stylebar .sb[title="${await win.evaluate(() => t('v23.paper_kind'))}"]`);
  ok(!!pkb, 'stylebar has a «paper kind» button for notes');
  if (pkb) { await pkb.click(); await win.waitForTimeout(150); const n = await win.evaluate(() => document.querySelectorAll('.pk-row button, .pk-row .sw').length); ok(n >= 10, '10 paper kinds offered', n); await win.evaluate(() => [...document.querySelectorAll('.pk-row > *')][1]?.click()); await win.waitForTimeout(150); }
  ok(await win.evaluate((id) => Store.get(id).paperKind === 'lined' && !!Items.el(Store.get(id)).querySelector('.paper.pk-lined'), pid), 'picking «lined» changes the paper');
  ok(await win.evaluate(() => STICKY.length >= 16), '16 paper colours');
  await win.evaluate((id) => { const kinds = PAPER_KINDS.map(k => k[0]); let x = -900; for (const k of kinds) { const it = Features.addAtCenter({ type: 'sticky', html: k || 'classic', w: 170, h: 150, paper: STICKY[kinds.indexOf(k) + 2] }); Store.change(() => { if (k) it.paperKind = k; it.x = x; it.y = 900; }); x += 190; Items.mount(it); } Canvas.select([]); }, pid);

  console.log('Video trimmer');
  let vid = null;
  try {
    const f = path.join(HOME, 'clip.webm'); execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=30:duration=8', '-c:v', 'libvpx', '-b:v', '300k', f]);
    vid = await win.evaluate(async (b64) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const r = await API.importBuffer('clip.webm', bin); return Features.addAtCenter({ type: 'video', file: r.file, name: 'clip.webm', w: 480, h: 300 }).id; }, fs.readFileSync(f).toString('base64'));
  } catch (e) { ok(false, 'ffmpeg fixture: ' + e.message); }
  if (vid) {
    await win.evaluate((id) => Media2.clipModal(Store.get(id), null), vid);
    await win.waitForSelector('.trimmer .tr-track'); await win.waitForFunction(() => Media2._trim?.pv.duration > 7, null, { timeout: 10000 });
    await win.waitForTimeout(1800);
    const thumbs = await win.evaluate(() => { const c = document.querySelector('.tr-strip'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 400) if (d[i]) n++; return n; });
    ok(thumbs > 50, 'filmstrip thumbnails painted on the bar', thumbs);
    const tr = await rect(win, '.tr-track'); const ho = await rect(win, '.tr-h.out');
    await win.mouse.move(ho.cx, ho.cy); await win.mouse.down(); await win.mouse.move(tr.x + tr.w * 0.75, ho.cy, { steps: 5 }); await win.mouse.up();
    let s = await win.evaluate(() => ({ t0: Media2._trim.t0, t1: Media2._trim.t1, dur: document.querySelector('.tr-dur').textContent }));
    ok(Math.abs(s.t1 - 6) < 0.25, 'dragging the out-handle sets the end (~6s)', s);
    await win.mouse.click(tr.x + tr.w * 0.25, tr.y + 6); await win.waitForTimeout(150); await win.keyboard.press('i'); await win.waitForTimeout(100);
    s = await win.evaluate(() => ({ t0: Media2._trim.t0, t1: Media2._trim.t1, dur: document.querySelector('.tr-dur').textContent }));
    ok(Math.abs(s.t0 - 2) < 0.25, 'click on the bar + I sets the start (~2s)', s);
    ok(/^0:0[34]\./.test(s.dur), 'live duration label ≈ 4 s', s.dur);
    const c0 = await win.evaluate(() => Media2._trim.pv.currentTime); await win.keyboard.press('ArrowRight'); await win.waitForTimeout(150);
    const c1 = await win.evaluate(() => Media2._trim.pv.currentTime); ok(Math.abs(c1 - c0 - 1 / 30) < 0.01, '→ steps one frame', [c0, c1]);
    await win.keyboard.press('Shift+ArrowRight'); await win.waitForTimeout(150); await win.keyboard.press('o'); await win.waitForTimeout(150);
    s = await win.evaluate(() => ({ t1: Media2._trim.t1, n0: document.querySelector('.tr-nums input').value })); ok(Math.abs(s.t1 - (c1 + 1)) < 0.05, 'Shift+→ = 1 s, O sets the end', s);
    await win.evaluate(() => Media2._trim.seek(Media2._trim.t0 + 0.6)); await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(SHOTS, 'v23-trimmer.png') });
    await win.evaluate(() => [...document.querySelectorAll('#modal .btn')].find(b => b.textContent.includes(t('v23.tr_hl')))?.click()); await win.waitForTimeout(200);
    ok(await win.evaluate((id) => (Store.get(id).highlights || []).length === 1 && !document.querySelector('#modal').classList.contains('in'), vid), '«keep as highlight» saves the range and closes');
  }

  console.log('Themes');
  const th = await win.evaluate(() => THEMES.map(x => ({ id: x.id, space: !!x.space, stars: x.fx?.stars || 0, kind: x.fx?.kind || '' })));
  ok(th.filter(x => x.space).every(x => x.stars > 0.3), 'every space theme keeps visible stars', th.filter(x => x.space));
  ok(['desk', 'glass', 'ocean', 'forest', 'minlight', 'retro', 'sakura', 'rain'].every(k => th.some(x => x.id === k && !x.space && x.kind)), '8 new animated non-space themes', th.map(x => x.id));
  // custom tweaks stay per theme (one theme's edits no longer kill another theme's stars)
  const per = await win.evaluate(() => { const S = Store.state.settings; S.theme = 'midnight'; S.customs = { midnight: { stars: 0 } }; Theme.apply(S); const a = Theme.current.fx.stars; S.theme = 'aurora'; Theme.apply(S); const b = Theme.current.fx.stars; return { a, b }; });
  ok(per.a === 0 && per.b > 0.3, 'per-theme customisation does not leak into other themes', per);
  await win.evaluate(() => { const S = Store.state.settings; S.customs = {}; Canvas.view.z = 0.55; Canvas.applyView?.(); });
  for (const id of ['sakura', 'desk', 'rain']) {
    const drew = await win.evaluate(async (id) => { const S = Store.state.settings; S.theme = id; Theme.apply(S); await new Promise(r => setTimeout(r, 700)); const c = $('#stars'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 1600) if (d[i]) n++; return n; }, id);
    ok(drew > 20, `theme «${id}» animates its own scene`, drew);
    if (id !== 'rain') { await win.evaluate(() => Panels.themes()); await win.waitForTimeout(500); await win.screenshot({ path: path.join(SHOTS, `v23-theme-${id}.png`) }); if (id === 'sakura') { const hd = await win.evaluate(() => document.querySelectorAll('#drawer .tg-head').length); ok(hd === 2, 'themes drawer shows each group once', hd); } await win.evaluate(() => Panels.closeDrawer()); }
  }
  await win.evaluate(() => { const S = Store.state.settings; S.theme = 'midnight'; Theme.apply(S); Store.save(true); });

  console.log('Board tabs ✕');
  const nb = await win.evaluate(() => { App.newBoard?.(); return Store.state.boards.length; }); await win.waitForTimeout(300);
  await win.keyboard.press('Escape'); await win.waitForTimeout(250); ok(await win.evaluate(() => !document.querySelector('#modal').classList.contains('in')), 'new board rename dialog closes with Esc');
  ok(await win.evaluate(() => document.querySelectorAll('#tabs .tab .tab-x').length) >= 2, 'board tabs have a close ✕');

  console.log('Browser: + tab, Ctrl+T, close, minimize/restore, maximize');
  await win.evaluate((u) => Browser.open(u), `http://127.0.0.1:${PP}/a`); await win.waitForTimeout(1200);
  await win.click('#br-add'); await win.waitForTimeout(400);
  let bt = await win.evaluate(() => Browser.tabs.length); ok(bt === 2, '+ opens a new tab', bt);
  await win.evaluate(() => document.activeElement?.blur?.()); await win.keyboard.press('Control+t'); await win.waitForTimeout(400);
  const ctl = await win.evaluate((n) => ({ tabs: Browser.tabs.length, boards: Store.state.boards.length }), nb);
  ok(ctl.tabs === 3 && ctl.boards === nb, 'Ctrl+T opens a browser tab (not a new board behind it)', ctl);
  await win.evaluate((u) => { Browser.cur.wv.src = u; }, `http://127.0.0.1:${PP}/b`); await win.waitForTimeout(1200);
  const vis = await win.evaluate(() => [...document.querySelectorAll('#browser webview')].map(w => getComputedStyle(w).display !== 'none' && getComputedStyle(w).visibility !== 'hidden'));
  ok(vis.filter(Boolean).length === 1 && vis[vis.length - 1], 'only the selected tab\'s page is visible', vis);
  const ub = await win.evaluate(() => $('#br-url').value); ok(/\/b$/.test(ub), 'address bar follows the current tab after navigation', ub);
  await win.screenshot({ path: path.join(SHOTS, 'v23-browser-tabs.png') });
  await win.evaluate(() => document.activeElement?.blur?.()); await win.keyboard.press('Control+w'); await win.waitForTimeout(300); ok(await win.evaluate(() => Browser.tabs.length) === 2, 'Ctrl+W closes the tab');
  await win.click('#br-max'); await win.waitForTimeout(200); ok(await win.evaluate(() => document.querySelector('#browser').classList.contains('max')), 'maximize toggles');
  await win.click('#br-min'); await win.waitForTimeout(300);
  ok(await win.evaluate(() => document.querySelector('#browser').hidden && !document.querySelector('#br-pill').hidden && Browser.tabs.length === 2), 'minimize hides it, keeps tabs, shows a pill');
  await win.click('#br-pill .tt'); await win.waitForTimeout(300);
  ok(await win.evaluate(() => !document.querySelector('#browser').hidden && Browser.tabs.length === 2), 'pill restores the same tabs');
  await win.evaluate(() => Browser.closeAll()); await win.evaluate(() => Browser.hide?.()); await win.waitForTimeout(200);

  console.log('Widget mini-dashboard');
  await win.evaluate(() => { const it = Features.addAtCenter({ type: 'sticky', html: 'Καρφιτσωμένο 📌', w: 200, h: 160 }); Canvas.select([it.id]); Actions.togglePin(); const c = Features.addAtCenter({ type: 'countdown', title: 'Διακοπές', emoji: '🏖️', target: new Date(Date.now() + 9 * 864e5).toISOString(), w: 260, h: 150 }); Store.change(() => Store.state.subs.push({ id: uid(), name: 'Spotify', price: 10.99, currency: 'EUR', cycle: 'monthly', next: ymd(Date.now() + 4 * 864e5) })); Store.save(true); });
  await win.waitForTimeout(500);
  await app.evaluate(() => global.__nyx.toggleWidget(true));
  const ww = await app.waitForEvent('window', { timeout: 10000 });
  ww.on('pageerror', e => errors.push('widget pageerror: ' + e.message)); ww.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('widget: ' + m.text()); });
  await ww.waitForFunction(() => window.__wReady === true, null, { timeout: 10000 }); await ww.waitForTimeout(600);
  ok(await ww.evaluate(() => [...document.querySelectorAll('#w-pins .w-pin')].some(p => p.textContent.includes('Καρφιτσωμένο'))), '«Καρφίτσωμα στο widget» shows the note in the widget');
  ok(await ww.evaluate(() => document.querySelector('#w-up').textContent.includes('Διακοπές') && document.querySelector('#w-subs').textContent.includes('Spotify')), 'upcoming countdowns + subscriptions listed');
  ok(await ww.evaluate(() => /\d\d\/\d\d/.test(document.querySelector('#w-subs .w-s').textContent)), 'subscription date in DD/MM');
  const target = await ww.evaluate(() => { const b = [...document.querySelectorAll('#w-cal .d')].find(d => d.dataset.day !== ymd(Date.now())); b.click(); return b.dataset.day; });
  await ww.waitForTimeout(100);
  ok(await ww.evaluate((d) => document.querySelector('#w-cal .d.sel')?.dataset.day === d && document.querySelector('#w-day').classList.contains('other'), target), 'any calendar day is clickable and becomes the note target');
  await ww.fill('#w-q', 'Γενέθλια Μαρίας'); await ww.press('#w-q', 'Enter'); await ww.waitForTimeout(800);
  ok(await win.evaluate((d) => (Store.state.agenda || []).some(a => a.day === d && a.text === 'Γενέθλια Μαρίας') && !Store.items().some(i => (i.html || '').includes('Γενέθλια')), target), 'widget note goes to that day\'s agenda, not a paper on the canvas');
  ok(await ww.evaluate(() => document.querySelector('#w-dayp').textContent.includes('Γενέθλια Μαρίας') && !!document.querySelector('#w-cal .d.sel.note')), 'day panel lists it, calendar marks the day');
  await ww.click('#w-mic'); await ww.waitForTimeout(1500); await ww.click('#w-mic'); await ww.waitForTimeout(1500);
  ok(await win.evaluate((d) => (Store.state.agenda || []).some(a => a.day === d && a.file && a.voice), target), 'voice memo from the widget lands in the agenda (audio file)');
  ok(await ww.evaluate(() => !!document.querySelector('#w-dayp audio')), 'voice memo playable in the widget day panel');
  await ww.screenshot({ path: path.join(SHOTS, 'v23-widget.png') });
  const before = await win.evaluate(() => Store.items().length);
  await ww.evaluate(() => [...document.querySelectorAll('#w-dayp .w-ag')].find(r => r.textContent.includes('Γενέθλια')).querySelectorAll('.w-agb')[0].click()); await ww.waitForTimeout(500);
  ok(await win.evaluate((n) => Store.items().length === n + 1, before), '→ canvas sends an agenda note to the board on request');
  await ww.evaluate(() => [...document.querySelectorAll('#w-dayp .w-ag')].find(r => r.textContent.includes('Γενέθλια')).querySelectorAll('.w-agb')[1].click()); await ww.waitForTimeout(500);
  ok(await win.evaluate(() => !(Store.state.agenda || []).some(a => a.text === 'Γενέθλια Μαρίας')), 'widget ✕ deletes the agenda note');
  ok(await ww.evaluate(() => (window.__missingIcons ? [...window.__missingIcons] : []).length === 0), 'widget icons ok');

  // note + attached text screenshot
  await win.evaluate(() => { Store.state.boards.forEach(() => {}); const b = Store.board(); const host = Features.addAtCenter({ type: 'sticky', html: 'Λίστα για αύριο', w: 300, h: 260, paper: '#ffd23f' }); Store.change(() => { host.paperKind = 'pin'; host.locked = true; }); Items.mount(host); const tx = Store.change(() => Store.addItem({ type: 'text', x: host.x + 30, y: host.y + host.h - 70, w: 240, h: 34, html: '✓ συνημμένο κείμενο', parent: host.id, font: 'Caveat', size: 26, color: '#3b2a05', locked: true })); Items.mount(tx); Canvas.select([host.id]); Canvas.fit([host]); Canvas.view.z *= 0.75; Canvas.applyView(); document.querySelectorAll('#toasts .toast').forEach(t => t.remove()); });
  await win.waitForTimeout(800); await win.screenshot({ path: path.join(SHOTS, 'v23-note-attached.png') });
  await win.evaluate(() => { Canvas.view = { x: 0, y: 0, z: 0.5 }; Canvas.fit(Store.items().filter(i => i.type === 'sticky' && i.y === 900)); }); await win.waitForTimeout(800); await win.screenshot({ path: path.join(SHOTS, 'v23-paper-kinds.png') });

  await quit(app); page.close();
  const real = errors.filter(e => !/Autofill|DevTools|Electron Security Warning|ERR_ABORTED/.test(e));
  ok(real.length === 0, 'no console errors' + (real.length ? ':\n    ' + real.join('\n    ') : ''));
  console.log(`\n${passes} passed, ${fails} failed`); console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
