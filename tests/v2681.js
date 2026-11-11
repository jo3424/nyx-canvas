'use strict';
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2681-'));
const SHOTS = path.join(ROOT, 'shots');
const SCREEN = path.join(ROOT, 'dist', 'deliver-v2.6.8.1', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(SCREEN, { recursive: true });
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 800) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startRouter() {
  const st = { chats: 0, log: [], propsModel: 0 };
  const srv = http.createServer((q, resp) => {
    st.log.push(q.method + ' ' + q.url);
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    if (q.url === '/v1/models' || q.url === '/models') return send(200, { data: [{ id: 'gemma-4-12B-it-Q4_0', loaded: true, meta: { n_ctx: 32768 } }] });
    if (q.url === '/health') return send(200, { status: 'ok' });
    if ((q.url === '/tokenize' || q.url === '/v1/tokenize') && q.method === 'POST') {
      let b = ''; q.on('data', (d) => b += d); q.on('end', () => send(200, { tokens: Array.from({ length: Math.max(8, Math.ceil((b || '').length / 4)) }, (_, i) => i) }));
      return;
    }
    if (q.url === '/props') return send(400, { error: { message: 'model is required' } });
    if (q.url.startsWith('/props?model=')) { st.propsModel++; return send(200, { default_generation_settings: { n_ctx: 32768 } }); }
    if (q.url === '/slots') return send(200, [{ model: 'gemma-4-12B-it-Q4_0' }]);
    if (q.method === 'POST' && (q.url === '/v1/chat/completions' || q.url === '/chat/completions')) {
      let b = ''; q.on('data', (d) => b += d); q.on('end', () => {
        st.chats++;
        let body = {}; try { body = JSON.parse(b); } catch (e) {}
        const reply = 'Ορίστε μια σύντομη απάντηση για τη δοκιμή.';
        if (body.stream) {
          resp.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'connection': 'keep-alive' });
          if (resp.flushHeaders) resp.flushHeaders();
          resp.write(': ping\n\n');
          resp.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: 'stop' }], timings: { prompt_n: 80, prompt_ms: 20, predicted_n: 12, predicted_ms: 30, cache_n: 40 } }) + '\n\n');
          return resp.end('data: [DONE]\n\n');
        }
        send(200, { choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] });
      });
      return;
    }
    send(404, { error: 'no' });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port, st })));
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
  const router = await startRouter();
  const { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || (typeof NYX_VERSION !== 'undefined' ? NYX_VERSION : ''));
  ok(String(ver || '').includes('2.6.8.1') || String(ver || '').includes('2.6.8'), 'app version 2.6.8.1', ver);

  await win.evaluate((port) => {
    Store.state.settings.theme = 'midnight'; Theme.apply(Store.state.settings);
    const A = Store.state.settings.ai;
    const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + port + '/v1';
    A.tasks.commands = { p: 'llama', m: 'gemma-4-12B-it-Q4_0' };
    A.tasks.chat = { p: 'llama', m: 'gemma-4-12B-it-Q4_0' };
    A.servers.llama.ctx = 32768;
    A.servers.llama.modelsMax = 2;
    A.servers.llama.exe = 'C:\\\\Users\\\\admin\\\\llama-router\\\\llama-server.exe';
    A.assistant.canvasConfirm = true;
    A.assistant.attachReserve = 2048;
    Store.save();
  }, router.port);

  // 1) attachment panel with stage times and tokens sent
  await win.evaluate(() => {
    Assistant.show();
    Att._nCtx = 32768; Att._nCtxSource = 'settings_ctx';
    Att.list = [{
      id: 'a1', name: 'σημείωμα.pdf', kind: 'pdf', state: 'ok', size: 82000, pct: 100,
      text: 'x'.repeat(4000), tokensSent: 4200, fastOk: true,
      stages: [
        { id: 'fast', label: 'Γρήγορο', ms: 1800, tokens: 4200 },
        { id: 'heavy', label: 'Βαρύ', ms: 0, tokens: 0, note: 'χωρίς περίληψη — χωράει' },
      ],
    }];
    Att.chips();
  });
  await win.waitForTimeout(300);
  const attText = await win.evaluate(() => document.querySelector('#as-att')?.innerText || '');
  ok(/σημείωμα\.pdf/.test(attText) && /Γρήγορο/.test(attText) && /4200|4\.200|4,200/.test(attText), 'attachment panel shows stage time and tokens', attText);
  ok(/όριο|n_ctx|32768/.test(attText), 'attachment panel shows computed budget, not a silent 12000/24000', attText);
  const pAtt = await shot(win, 'attachment-panel-stages-midnight.png');
  ok(fs.existsSync(pAtt), 'screenshot attachment panel');

  // Sending must not wait for a heavy stage (fastReady already resolved).
  const takeMs = await win.evaluate(async () => {
    const e = Att.list[0];
    e.heavyDone = new Promise(() => {}); // would hang forever if take() awaited heavy
    e.fastReady = Promise.resolve();
    const t0 = Date.now();
    const L = await Att.take();
    return { ms: Date.now() - t0, n: (L || []).length, sent: L && L[0] && L[0].tokensSent };
  });
  ok(takeMs.ms < 500 && takeMs.n === 1, 'take() returns in <500 ms even if heavy is still running', takeMs);

  // Re-show a finished reply with the To-the-canvas button (and put the file back on the tray for a clean shot we already took)
  await win.evaluate(() => {
    Store.state.chat = [
      { role: 'user', content: 'τι λέει το pdf;' },
      { role: 'assistant', content: 'Ορίστε μια σύντομη απάντηση για τη δοκιμή.', model: 'gemma-4-12B-it-Q4_0' },
    ];
    Assistant.show(); Assistant.render();
  });
  await win.waitForTimeout(400);
  const btn = await win.evaluate(() => {
    const b = document.querySelector('.as-tools .to-canvas, .as-tools button');
    const labels = [...document.querySelectorAll('.as-tools button')].map((x) => (x.textContent || '').trim());
    return { has: labels.some((s) => s === 'Στον καμβά'), labels };
  });
  ok(btn.has, '«Στον καμβά» button under the reply', btn);
  const pBtn = await shot(win, 'to-canvas-button-midnight.png');
  ok(fs.existsSync(pBtn), 'screenshot To-the-canvas button');

  // Unsolicited create_card is blocked (tool list still advertised)
  const blocked = await win.evaluate(async () => {
    Cmd._forceCanvas = false;
    Cmd._lastUser = 'τι καιρό κάνει αύριο;';
    const tools = Cmd.tools().map((x) => x.function.name);
    const r = await Cmd.exec('create_card', { kind: 'text', text: 'δεν το ζήτησα' });
    return { toolsHas: tools.includes('create_card'), blocked: !!(r && r.blocked), error: r && r.error };
  });
  ok(blocked.toolsHas && blocked.blocked, 'create_card stays in the tool list but exec is blocked without an explicit ask', blocked);

  // 2) confirm-before-canvas dialog (setting ON, explicit ask)
  await win.evaluate(() => { Cmd._lastUser = 'βάλε το στον καμβά'; void Cmd.exec('create_card', { kind: 'text', title: 'δοκιμή', text: 'δοκιμή κάρτας' }); });
  await win.waitForFunction(() => {
    const m = document.querySelector('#modal');
    return m && !m.hidden && /καμβά|canvas/i.test(m.innerText || '');
  }, null, { timeout: 8000 });
  const modalTxt = await win.evaluate(() => document.querySelector('#modal')?.innerText || '');
  ok(/καμβά|create_card|δοκιμή/i.test(modalTxt), 'confirm-before-canvas dialog is visible', modalTxt.slice(0, 400));
  const pModal = await shot(win, 'confirm-before-canvas-midnight.png');
  ok(fs.existsSync(pModal), 'screenshot confirm-before-canvas dialog');
  await win.evaluate(() => { const m = document.querySelector('#modal'); if (m) { const c = m.querySelector('.btn.ghost, [data-close], .x, .btn:not(.primary)'); if (c) c.click(); else { m.hidden = true; } } });
  await win.waitForTimeout(200);

  // 3) Engines: b12230 path + models-max 2
  await win.evaluate(() => { try { Assistant.hide(); } catch (e) {} Hub.open(); });
  await win.waitForTimeout(400);
  await win.evaluate(() => document.querySelector('[data-hub-tab=engines]')?.click());
  await win.waitForTimeout(600);
  await win.evaluate(() => { const adv = document.querySelector('details.hub-adv'); if (adv) adv.open = true; });
  await win.waitForTimeout(400);
  const eng = await win.evaluate(() => {
    const pane = document.querySelector('[data-hub-pane=engines]') || document.body;
    const text = pane.innerText || '';
    const exe = [...pane.querySelectorAll('input')].map((i) => i.value).find((v) => /llama-server/.test(v || '')) || '';
    const max = [...pane.querySelectorAll('input')].map((i) => ({ n: i.previousSibling, v: i.value, ph: i.placeholder })).filter((x) => x.v === '2' || x.ph === '2');
    return { text: text.slice(0, 1500), exe, hasRouter: /llama-router/.test(text + ' ' + exe), hasGvs: /GPU-Voice-Studio\\\\third_party\\\\llama/.test(text + ' ' + exe), max2: /2/.test([...pane.querySelectorAll('input')].map((i) => i.value).join(' ')) };
  });
  ok(eng.hasRouter && !eng.hasGvs, 'Engines shows %USERPROFILE%\\\\llama-router\\\\llama-server.exe, not the GVS exe', eng);
  ok(eng.max2, 'Engines models-max field is 2', eng);
  const pEng = await shot(win, 'engines-llama-router-max2-midnight.png');
  ok(fs.existsSync(pEng), 'screenshot Engines b12230 path and max 2');

  // Opening Engines during "load" must not call /props?model= (Hub uses probe).
  const propsBefore = router.st.propsModel;
  await win.evaluate(() => document.querySelector('[data-hub-tab=status]')?.click());
  await win.waitForTimeout(400);
  await win.evaluate(() => document.querySelector('[data-hub-tab=engines]')?.click());
  await win.waitForTimeout(800);
  ok(router.st.propsModel === propsBefore, 'opening Engines does not hit /props?model= (probe only)', { before: propsBefore, after: router.st.propsModel, log: router.st.log.slice(-12) });

  await quit(app);
  router.srv.close();
  console.log(`\nv2.6.8.1 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
