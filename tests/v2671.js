'use strict';
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2671-'));
const SHOTS = path.join(ROOT, 'shots');
// v2.6.9.1: never overwrite a delivered folder from a test run — delivery screenshots only with NYX_DELIVER_SHOTS=1
const SCREEN = process.env.NYX_DELIVER_SHOTS === '1' ? path.join(ROOT, 'dist', 'deliver-v2.6.7.1', 'screens') : path.join(ROOT, 'shots', 'deliver-v2.6.7.1');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(SCREEN, { recursive: true });
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startRouter(opts = {}) {
  const maxInst = opts.max_instances;
  const srv = http.createServer((q, resp) => {
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    if (q.url === '/v1/models' || q.url === '/models') return send(200, { data: [{ id: 'gemma-4-12b', loaded: true }, { id: 'krikri-8b', loaded: true }] });
    if (q.url === '/health') return send(200, { status: 'ok' });
    if (q.url === '/props') {
      if (maxInst != null) return send(200, { role: 'router', max_instances: maxInst, default_generation_settings: { n_ctx: 0 } });
      return send(400, { error: { message: 'model is required' } });
    }
    if (q.url.startsWith('/props?model=')) return send(200, { default_generation_settings: { n_ctx: 32768 } });
    send(404, { error: 'no' });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port })));
}
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true || window.__nyxV25Ready === true, null, { timeout: 30000 });
  await win.waitForTimeout(400);
  return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
async function shot(win, name) {
  const dest = path.join(SCREEN, name);
  await win.screenshot({ path: dest });
  fs.copyFileSync(dest, path.join(SHOTS, name));
  return dest;
}

(async () => {
  const { app, win } = await launch();
  const ver = await win.evaluate(() => Store.info && Store.info.version);
  ok(String(ver || '') === '2.6.7.1' || String(ver || '').includes('2.6.7.1'), 'app version 2.6.7.1', ver);

  const toolsBtn = await win.evaluate(() => !!document.getElementById('btn-tools'));
  const settingsBtn = await win.evaluate(() => !!document.getElementById('btn-settings'));
  ok(!toolsBtn && settingsBtn, 'titlebar has Settings and no System-tools duplicate', { toolsBtn, settingsBtn });

  await win.evaluate(() => { Store.state.settings.theme = 'midnight'; Theme.apply(Store.state.settings); Store.save(); });

  // --- Status shell appears immediately even when the router is down ---
  await win.evaluate(() => {
    const A = Store.state.settings.ai;
    const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:1/v1';
    A.servers.llama.port = 8080;
    A.servers.llama.ctx = 32768;
    A.tasks.private = { p: 'llama', m: '' };
    Store.save();
  });
  const appeared = await win.evaluate(async () => {
    const t0 = performance.now();
    Hub.tab = 'status';
    Hub.open();
    const pane = document.querySelector('[data-hub-pane=status]');
    const shellMs = performance.now() - t0;
    const hasShell = !!(pane && (pane.querySelector('.hub-stats') || pane.querySelector('.hub-h4')));
    return { shellMs, hasShell, text: (pane && pane.innerText) || '' };
  });
  ok(appeared.hasShell && appeared.shellMs < 250, 'Status shell is painted immediately (no 1–2s blank wait)', appeared);

  await win.waitForTimeout(1500);
  const down = await win.evaluate(() => {
    const pane = document.querySelector('[data-hub-pane=status]');
    const dot = pane?.querySelector('[data-st=llama-dot], .hub-dot');
    return {
      text: pane?.innerText || '',
      dot: dot?.className || '',
      msg: pane?.querySelector('[data-st=llama-msg]')?.textContent || '',
    };
  });
  ok(/δεν τρέχει στο :8080|not running on :8080/.test(down.text + down.msg), 'Status shows red down text when router does not answer', down);
  ok(/hub-dot r|\bh-r\b|hub-dot r/.test(down.dot) || /hub-down/.test(down.msg + down.text), 'Status router indicator is red, not grey', down);
  const pStatusDown = await shot(win, 'hub-status-router-down-midnight.png');
  ok(fs.existsSync(pStatusDown), 'screenshot status router-down');

  await win.evaluate(() => document.querySelector('[data-hub-tab=engines]')?.click());
  await win.waitForTimeout(1200);
  const eng = await win.evaluate(() => {
    const pane = document.querySelector('[data-hub-pane=engines]');
    const box = pane?.querySelector('[data-srv=llama]');
    return {
      text: pane?.innerText || '',
      st: box?.querySelector('.srv-st')?.textContent || '',
      stCls: box?.querySelector('.srv-st')?.className || '',
      start: box?.querySelector('[data-st=start], .btn.primary')?.textContent?.trim() || '',
      dot: box?.querySelector('.hub-dot')?.className || '',
      max: /max άγνωστο|max unknown|max —/.test(pane?.innerText || ''),
      dash: /max —/.test(pane?.innerText || ''),
    };
  });
  ok(/δεν τρέχει στο :8080|not running on :8080/.test(eng.text + eng.st), 'Engines shows red «δεν τρέχει στο :8080»', eng);
  ok(/err/.test(eng.stCls) || /hub-dot r/.test(eng.dot), 'Engines status is red, not grey', eng);
  ok(/Έναρξη|Start/.test(eng.start), 'Engines has an Έναρξη button', eng);
  ok(!eng.dash, 'Engines does not show «max —»', eng);
  const pEngDown = await shot(win, 'hub-engines-start-router-down-midnight.png');
  ok(fs.existsSync(pEngDown), 'screenshot engines Έναρξη / router-down');

  await win.evaluate(() => document.querySelector('[data-hub-tab=models]')?.click());
  await win.waitForTimeout(600);
  const md = await win.evaluate(() => {
    const row = document.querySelector('.task-row[data-task=private] .task-res');
    return { text: row?.textContent || '', cls: row?.className || '' };
  });
  ok(/Διάλεξε μοντέλο για αυτή την εργασία|Choose a model for this task/.test(md.text) && /bad/.test(md.cls), 'Private task with no model shows a visible warning', md);

  await win.evaluate(() => { try { Panels.closeDrawer(); } catch (e) {} });
  await win.waitForTimeout(200);

  // --- paper kind picker ---
  await win.evaluate(() => { Tools.pick('sticky'); });
  await win.waitForTimeout(200);
  const opts = await win.evaluate(() => {
    const o = document.getElementById('toolopts');
    const kinds = [...(o?.querySelectorAll('[data-pk]') || [])].map((b) => b.getAttribute('data-pk'));
    return { kinds, text: o?.innerText || '', count: kinds.length };
  });
  ok(opts.count >= 10 && opts.kinds.includes('classic') && opts.kinds.includes('lined') && opts.kinds.includes('grid'), 'sticky tool options show 10 paper kinds', opts);
  const pKinds = await shot(win, 'note-type-picker-toolbar-midnight.png');
  ok(fs.existsSync(pKinds), 'screenshot note type picker (toolbar)');

  await win.evaluate(() => {
    const vp = document.getElementById('viewport') || document.body;
    const r = vp.getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 200, clientY: r.top + 200, button: 2 });
    vp.dispatchEvent(ev);
    // Panels.ctx expects an event with target; call it directly
    try { Panels.ctx({ clientX: r.left + 220, clientY: r.top + 220, target: document.getElementById('items-layer') || document.body, preventDefault() {}, }); } catch (e) {}
  });
  await win.waitForTimeout(300);
  const menu = await win.evaluate(() => {
    const m = document.getElementById('ctxmenu');
    const kinds = [...(m?.querySelectorAll('[data-pk]') || [])].map((b) => b.getAttribute('data-pk'));
    return { hidden: m?.hidden, text: m?.innerText || '', count: kinds.length, kinds };
  });
  ok(menu.count >= 10 && /Είδος χαρτιού|Paper kind/.test(menu.text), 'right-click menu has the paper-kind picker', menu);
  const pMenu = await shot(win, 'note-type-picker-menu-midnight.png');
  ok(fs.existsSync(pMenu), 'screenshot note type picker (context menu)');
  await win.evaluate(() => { try { Panels.closeMenu(); } catch (e) {} });

  // router up: max_instances from /props
  const router = await startRouter({ max_instances: 2 });
  await win.evaluate((port) => {
    const A = Store.state.settings.ai;
    const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + port + '/v1';
    A.servers.llama.port = port;
    A.servers.llama.ctx = 32768;
    Store.save();
    Hub.tab = 'engines';
    Hub.open();
  }, router.port);
  await win.waitForTimeout(1500);
  const up = await win.evaluate(() => {
    const pane = document.querySelector('[data-hub-pane=engines]');
    return { text: pane?.innerText || '' };
  });
  ok(/max 2/.test(up.text), 'Engines reads models-max 2 from the router /props', up.text.slice(0, 400));
  router.srv.close();

  await quit(app);
  console.log(`\nv2.6.7.1 xvfb: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
