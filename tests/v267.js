'use strict';
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v267-'));
const SHOTS = path.join(ROOT, 'shots');
const SCREEN = path.join(ROOT, 'dist', 'deliver-v2.6.7', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(SCREEN, { recursive: true });
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startRouter() {
  const srv = http.createServer((q, resp) => {
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    if (q.url === '/v1/models' || q.url === '/models') return send(200, { data: [{ id: 'gemma-4-12b' }, { id: 'krikri-8b' }] });
    if (q.url === '/health') return send(200, { status: 'ok' });
    if (q.url === '/props') return send(400, { error: { message: 'model is required' } });
    if (q.url.startsWith('/props?model=')) return send(200, { default_generation_settings: { n_ctx: 32768 } });
    if (q.url.startsWith('/slots')) return q.url.includes('model=') ? send(200, { n_ctx: 32768 }) : send(400, { error: { message: 'model is required' } });
    if (q.url === '/v1/chat/completions' && q.method === 'POST') {
      let b = ''; q.on('data', d => b += d); q.on('end', () => {
        send(200, { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], timings: { prompt_n: 400, prompt_ms: 800, predicted_n: 20, predicted_ms: 250, cache_n: 100 } });
      });
      return;
    }
    send(404, { error: 'no' });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port })));
}
function startForbidden() {
  const srv = http.createServer((q, resp) => { resp.statusCode = 403; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify({ error: { message: 'Invalid API key' } })); });
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
async function shotTab(win, theme, tab) {
  const name = `hub-${tab}-${theme}.png`;
  const dest = path.join(SCREEN, name);
  await win.screenshot({ path: dest });
  fs.copyFileSync(dest, path.join(SHOTS, name));
  return dest;
}

(async () => {
  const router = await startRouter();
  const forbidden = await startForbidden();
  const { app, win } = await launch();
  const ver = await win.evaluate(() => Store.info && Store.info.version);
  ok(String(ver || '').includes('2.6.7'), 'app version 2.6.7', ver);

  await win.evaluate(({ port, bad }) => {
    const A = Store.state.settings.ai;
    const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + port + '/v1';
    const g = A.providers.find((p) => p.id === 'groq');
    if (g) { g.enabled = true; g.userOn = true; g.base = 'http://127.0.0.1:' + bad + '/v1'; }
    A.tasks.commands = { p: 'llama', m: 'gemma-4-12b' };
    A.tasks.chat = { p: 'llama', m: 'gemma-4-12b' };
    A.tasks.greek = { p: 'llama', m: 'krikri-8b' };
    A.tasks.private = { p: 'llama', m: 'gemma-4-12b' };
    A.servers.llama.ctx = 32768;
    A.servers.llama.modelsMax = 2;
    AI.lastRequest = { at: Date.now(), prompt_n: 11868, prompt_ms: 16600, predicted_n: 64, predicted_ms: 1000, n_ctx: 32768, truncated: false, failed: false, cpu: false, model: 'gemma-4-12b' };
    Store.save();
  }, { port: router.port, bad: forbidden.port });

  const themes = ['midnight', 'minlight'];
  for (const theme of themes) {
    await win.evaluate((th) => { Store.state.settings.theme = th; Theme.apply(Store.state.settings); Store.save(); }, theme);
    await win.waitForTimeout(300);
    await win.evaluate(() => Hub.open());
    await win.waitForTimeout(1200);
    const tabs = await win.evaluate(() => [...document.querySelectorAll('.hub-tab')].map((b) => b.textContent.trim()));
    ok(tabs.length === 4 && /Κατάσταση|Status/.test(tabs[0]) && /Cloud/.test(tabs[3]), 'four tabs in ' + theme, tabs);

    // Status
    await win.evaluate(() => document.querySelector('[data-hub-tab=status]')?.click());
    await win.waitForTimeout(700);
    const st = await win.evaluate(() => ({
      ctx: document.querySelector('[data-gvs-ctx]')?.getAttribute('data-gvs-ctx') || document.querySelector('.hub-stat b')?.parentElement?.parentElement?.innerText || '',
      last: document.querySelector('[data-hub-pane=status]')?.innerText || '',
      emoji: /🇬🇷/.test(document.body.innerText || ''),
      vramUnknown: /VRAM μη διαθέσιμη|VRAM unavailable|VRAM/.test(document.querySelector('[data-hub-pane=status]')?.innerText || ''),
    }));
    ok(/32768/.test(st.ctx) || /32K/.test(st.last), 'Status shows user ctx 32768 / 32K', st);
    ok(/11868/.test(st.last) && /16/.test(st.last) && /64/.test(st.last), 'Status shows last request tokens/time', st.last.slice(0, 400));
    ok(/μεγάλο prompt|large prompt/.test(st.last), 'large prompt pill on a prompt over 25% of ctx', st.last.slice(0, 400));
    ok(!st.emoji, 'no Greek flag emoji in the Hub');
    const pStatus = await shotTab(win, theme, 'status');
    ok(fs.existsSync(pStatus), 'screenshot status ' + theme, pStatus);

    // Models
    await win.evaluate(() => document.querySelector('[data-hub-tab=models]')?.click());
    await win.waitForTimeout(800);
    const md = await win.evaluate(() => ({
      text: document.querySelector('[data-hub-pane=models]')?.innerText || '',
      models: [...document.querySelectorAll('select.task-model option')].map((o) => o.value).filter(Boolean),
      flag: !!document.querySelector('[data-hub-pane=models] .flag-gr'),
      tasks: [...document.querySelectorAll('[data-hub-pane=models] .task-row')].map((r) => r.getAttribute('data-task')),
    }));
    ok(md.models.includes('gemma-4-12b') && md.models.includes('krikri-8b'), 'Models tab dropdowns from /v1/models', md.models);
    ok(md.tasks.includes('chat') && md.tasks.includes('greek') && md.tasks.includes('private') && md.tasks.includes('vision'), 'task rows include greek + private + vision', md.tasks);
    ok(md.flag, 'Greek writing row uses the SVG flag');
    ok(/Κρατάω|Keeping/.test(md.text) && /gemma-4-12b|krikri-8b/.test(md.text), 'installed list live from the router', md.text.slice(0, 400));
    const pModels = await shotTab(win, theme, 'models');
    ok(fs.existsSync(pModels), 'screenshot models ' + theme);

    // Engines
    await win.evaluate(() => document.querySelector('[data-hub-tab=engines]')?.click());
    await win.waitForTimeout(500);
    const en = await win.evaluate(() => {
      const pane = document.querySelector('[data-hub-pane=engines]');
      const adv = pane?.querySelector('details.hub-adv');
      const pathsOutside = [...pane.querySelectorAll('.prow')].filter((r) => !r.closest('details.hub-adv'));
      return {
        text: pane?.innerText || '',
        stop: /Διακοπή|Stop/.test(pane?.innerText || '') || !!pane?.querySelector('[data-srv=llama]'),
        telos: /Τέλος/.test(pane?.innerText || ''),
        pathsOutside: pathsOutside.length,
        hasAdv: !!adv,
        ctx: /32768/.test(pane?.innerText || ''),
      };
    });
    ok(en.hasAdv && en.pathsOutside === 0, 'exe path fields only under Advanced', en);
    ok(en.ctx, 'Engines row shows user ctx 32768', en);
    ok(!en.telos, 'no leftover «Τέλος» label', en);
    const pEng = await shotTab(win, theme, 'engines');
    ok(fs.existsSync(pEng), 'screenshot engines ' + theme);

    // Cloud
    await win.evaluate(() => document.querySelector('[data-hub-tab=cloud]')?.click());
    await win.waitForTimeout(400);
    await win.evaluate(() => document.querySelector('[data-prov=groq] .row.gap .btn.ghost.sm')?.click());
    await win.waitForTimeout(800);
    const cl = await win.evaluate(() => ({
      text: document.querySelector('[data-hub-pane=cloud]')?.innerText || '',
      groq: { txt: document.querySelector('[data-prov=groq] .pstat')?.textContent || '', cls: document.querySelector('[data-prov=groq] .pstat')?.className || '' },
      more: !!document.querySelector('details.hub-more'),
      rented: /Νοικιασμένη GPU|Rented GPU/.test(document.querySelector('[data-hub-pane=cloud]')?.innerText || ''),
      newKey: /Νέο κλειδί|New key/.test(document.querySelector('[data-hub-pane=cloud]')?.innerText || ''),
      dpapiOnly: /κρυπτογραφημένα \(DPAPI\)(?!.*safeStorage)/.test(document.querySelector('[data-hub-pane=cloud]')?.innerText || ''),
    }));
    ok(cl.groq && /403/.test(cl.groq.txt) && /forbidden|bad/.test(cl.groq.cls), 'Groq 403 is red on Cloud', cl.groq);
    ok(cl.more && cl.rented && cl.newKey, 'More / rented GPU / New key on Cloud', cl);
    const pCloud = await shotTab(win, theme, 'cloud');
    ok(fs.existsSync(pCloud), 'screenshot cloud ' + theme);

    await win.evaluate(() => { try { Panels.closeDrawer(); } catch (e) {} });
    await win.waitForTimeout(200);
  }

  // Settings migration: assistant + speech forms
  await win.evaluate(() => Panels.settings('assistant'));
  await win.waitForTimeout(400);
  const as = await win.evaluate(() => ({ form: !!document.querySelector('.assistant-form'), hist: /% του ctx|% of ctx/.test(document.body.innerText || ''), speechInHub: false }));
  ok(as.form && as.hist, 'Assistant settings live in main Settings with history %', as);
  await win.evaluate(() => Panels.settings('speech'));
  await win.waitForTimeout(400);
  const sp = await win.evaluate(() => !!document.querySelector('.speech-form'));
  ok(sp, 'Speech settings live in main Settings');
  const histVal = await win.evaluate(() => Store.state.settings.ai.assistant.historyPct);
  ok(histVal === 25, 'historyPct migrated (default 25 kept)', histVal);

  await quit(app);
  router.srv.close();
  forbidden.srv.close();
  console.log(`\nv2.6.7 xvfb: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
