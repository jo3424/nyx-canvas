'use strict';
// Nyx v2.6.6 e2e (headless, Chromium sandbox on): fake llama-server router + Hub/assistant checks
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const L = require('../main/limits');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v266-'));
const SHOTS = path.join(ROOT, 'shots');
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function startRouter() {
  const chats = [];
  const srv = http.createServer((q, resp) => {
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    if (q.url === '/v1/models' || q.url === '/models') return send(200, { data: [{ id: 'gemma-4-12b' }, { id: 'krikri-8b' }] });
    if (q.url === '/health') return send(200, { status: 'ok' });
    if (q.url === '/props') return send(400, { error: { message: 'model is required' } });
    if (q.url.startsWith('/props?model=')) return send(200, { default_generation_settings: { n_ctx: 32768 } });
    if (q.url === '/slots') return send(400, { error: { message: 'model is required' } });
    if (q.url.startsWith('/slots?model=')) return send(200, { n_ctx: 32768 });
    if (q.url === '/tokenize' && q.method === 'POST') {
      let b = ''; q.on('data', d => b += d); q.on('end', () => {
        const c = (JSON.parse(b).content || '');
        send(200, { tokens: new Array(Math.max(1, Math.ceil(c.length / 2))).fill(1) });
      });
      return;
    }
    if (q.url === '/v1/chat/completions' && q.method === 'POST') {
      let b = ''; q.on('data', d => b += d); q.on('end', () => {
        const j = JSON.parse(b); chats.push(j);
        send(200, { choices: [{ message: { role: 'assistant', content: 'Γεια σου!' }, finish_reason: 'stop' }], model: j.model || 'gemma-4-12b', timings: { prompt_n: j._n || 400, prompt_ms: 800, predicted_n: 5, predicted_ms: 40, cache_n: 200 } });
      });
      return;
    }
    send(404, { error: 'no' });
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv, chats, port: srv.address().port })));
}

function startForbidden() {
  const srv = http.createServer((q, resp) => { resp.statusCode = 403; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify({ error: { message: 'Invalid API key' } })); });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port })));
}

async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  app.process().stdout.on('data', d => { const s = String(d); if (/\[renderer\]|Error/.test(s)) errors.push('main: ' + s.trim().slice(0, 300)); });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV25Ready === true || window.__nyxV2Ready === true, null, { timeout: 30000 });
  await win.waitForTimeout(400);
  return { app, win };
}
async function quit(app) { const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const router = await startRouter();
  const forbidden = await startForbidden();
  const { app, win } = await launch();
  const shown = await win.evaluate(() => (typeof APP_VERSION !== 'undefined' ? APP_VERSION : null) || (Store.info && Store.info.version));
  ok((shown || '').toString().includes('2.6.6'), 'app version 2.6.6', shown);

  await win.evaluate(({ port, bad }) => {
    const A = Store.state.settings.ai;
    const L = A.providers.find(p => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + port + '/v1';
    const g = A.providers.find(p => p.id === 'groq');
    if (g) { g.enabled = true; g.base = 'http://127.0.0.1:' + bad + '/v1'; g.userOn = true; }
    A.tasks.commands = { p: 'llama', m: 'gemma-4-12b' };
    A.tasks.chat = { p: 'llama', m: 'gemma-4-12b' };
    A.tasks.private = { p: 'llama', m: 'krikri-8b' };
    A.assistant.historyPct = 25;
    A.assistant.mode = 'tools';
    // seed a large board so a regression that always sends cards would be visible
    const b = Store.board();
    for (let i = 0; i < 40; i++) b.items.push({ id: 'card' + String(i).padStart(4, '0') + 'xxxx', type: 'note', x: i * 20, y: 0, w: 180, h: 180, html: 'Σημείωση ' + i + ' με αρκετό κείμενο στον πίνακα', tags: ['τεστ'] });
    Store.save(true);
  }, { port: router.port, bad: forbidden.port });

  await win.evaluate(() => Hub.open());
  await win.waitForTimeout(1200);
  const hub = await win.evaluate(() => ({
    zones: !!document.querySelector('.zones'),
    keep: (document.querySelector('[data-zone=keep]')?.textContent || ''),
    pulid: (document.body.innerText || '').includes('PuLID'),
    antelope: /antelopev2/i.test(document.body.innerText || ''),
    rt: /🔀/.test(document.body.innerText || '') && /Router v2/i.test(document.body.innerText || ''),
    sheet: /Google Sheet/.test(document.body.innerText || ''),
    hauhauNo: /δεν είναι πια η σύσταση|no longer the pick/.test(document.body.innerText || ''),
    hist: !!document.querySelector('.field') && /% του ctx|% of ctx/.test(document.body.innerText || ''),
    models: [...document.querySelectorAll('select.task-model option')].map(o => o.value).filter(Boolean),
  }));
  ok(hub.zones && /gemma-4-12b|krikri-8b/.test(hub.keep), 'Hub zones: Κρατάω lists /v1/models', hub);
  ok(hub.pulid && hub.antelope, 'PuLID/InstantID cards mention antelopev2', hub);
  ok(!hub.rt && !hub.sheet && !hub.hauhauNo, 'Router V2, Google Sheet LoRA, and HauhauCS “not recommended” are gone', hub);
  ok(hub.hist, 'history % setting is visible in the Hub', hub);
  ok(hub.models.includes('gemma-4-12b') && hub.models.includes('krikri-8b'), 'task dropdowns come from /v1/models', hub.models);

  // 403 on Groq
  await win.evaluate(() => document.querySelector('[data-prov=groq] .row.gap .btn.ghost.sm')?.click());
  await win.waitForTimeout(800);
  const groq = await win.evaluate(() => ({
    txt: document.querySelector('[data-prov=groq] .pstat')?.textContent || '',
    cls: document.querySelector('[data-prov=groq] .pstat')?.className || '',
    blocked: !!(AI.blocked && AI.blocked.groq && AI.blocked.groq.status === 403),
  }));
  ok(groq.blocked && /403/.test(groq.txt) && /forbidden|bad/.test(groq.cls), 'Groq 403 is red and marked blocked', groq);

  // live ctx via /props?model=
  const ctxTxt = await win.evaluate(() => document.querySelector('[data-gvs-ctx]')?.getAttribute('data-gvs-ctx') || document.querySelector('.gvs-ctx')?.textContent || '');
  ok(/32768/.test(ctxTxt), 'live ctx displayed as 32768 after Hub open', ctxTxt);
  await win.evaluate(() => document.querySelector('.llama-ctx-x .btn')?.click());
  await win.waitForTimeout(600);
  const ctx2 = await win.evaluate(() => document.querySelector('[data-gvs-ctx]')?.getAttribute('data-gvs-ctx') || '');
  ok(ctx2 === '32768', 'refresh reads n_ctx 32768 via /props?model=', ctx2);

  await win.evaluate(() => { try { Panels.closeDrawer(); } catch (e) {} Assistant.show(); });
  await win.waitForTimeout(400);
  await win.evaluate(() => { const q = document.querySelector('#as-q'); q.value = 'γεια'; Assistant.send(); });
  await win.waitForFunction(() => (document.querySelector('#as-msgs')?.innerText || '').includes('Γεια') || (Store.state.chat || []).some(m => m.role === 'assistant' && m.content), null, { timeout: 20000 }).catch(() => {});
  await win.waitForTimeout(400);
  ok(router.chats.length >= 1, 'assistant sent a chat request', router.chats.length);
  const req = router.chats[0] || {};
  const sys = ((req.messages || []).find(m => m.role === 'system') || {}).content || '';
  const dateAt = Math.max(sys.lastIndexOf('Τώρα'), sys.lastIndexOf('Now'));
  const boardAt = sys.indexOf('Σημείωση 0');
  ok(req.cache_prompt === true, 'cache_prompt:true is sent', req.cache_prompt);
  ok(req.model === 'gemma-4-12b', 'request uses the selected model id', req.model);
  ok(dateAt > 0 && dateAt > sys.indexOf('Nyx'), 'date is in the system prompt', sys.slice(-120));
  ok(boardAt < 0, '«γεια» does not include the full board cards', { boardAt, sysLen: sys.length });
  const tok = L.estimateTokens(req.messages || [], req.tools || []);
  ok(tok > 0, 'e2e «γεια» estimateTokens on this box (after)', { tokens: tok, messages: (req.messages || []).length, tools: (req.tools || []).length });
  console.log('  TOKEN_REPORT_E2E ' + JSON.stringify({ method: 'limits.estimateTokens on the actual request captured by the fake router, this box', after: tok, model: req.model, sysLen: sys.length, cache_prompt: req.cache_prompt }));
  const chip = await win.evaluate(() => document.querySelector('#as-limit')?.textContent || '');
  ok(/prompt|tok|32768|ctx/.test(chip), 'assistant panel shows prompt tokens / ctx', chip);

  // MCP settings present
  await win.evaluate(() => PluginStore.open());
  await win.waitForTimeout(400);
  const hasLimits = await win.evaluate(() => {
    const p = PluginStore.get && PluginStore.get('mcp-server');
    const keys = (p && p.config || []).map(c => c.key);
    return { keys, max: p && p.config && p.config.find(c => c.key === 'maxImageMb'), tmo: p && p.config && p.config.find(c => c.key === 'deleteConfirmMin') };
  });
  ok(hasLimits.keys.includes('maxImageMb') && hasLimits.keys.includes('deleteConfirmMin'), 'MCP plugin has visible image and timeout settings', hasLimits);

  await win.screenshot({ path: path.join(SHOTS, 'v266-assistant.png') }).catch(() => {});
  await quit(app);
  router.srv.close();
  forbidden.srv.close();
  console.log(`\nv2.6.6 xvfb: ${passes} passed, ${fails} failed`);
  if (errors.length) console.log('errors', errors.slice(0, 8));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
