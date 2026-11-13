'use strict';
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v268-'));
const SHOTS = path.join(ROOT, 'shots');
const SCREEN = path.join(ROOT, 'dist', 'deliver-v2.6.8', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(SCREEN, { recursive: true });
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startRouter() {
  const st = { mode: 'stream', hold: null, allowLoad: false, chats: 0, log: [] };
  const srv = http.createServer((q, resp) => {
    st.log.push(q.method + ' ' + q.url);
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    if (q.url === '/v1/models' || q.url === '/models') {
      return send(200, { data: [
        { id: 'gemma-4-12B-it-Q4_0', loaded: st.mode === 'load' ? st.allowLoad : true },
        { id: 'krikri-8b', loaded: true },
      ] });
    }
    if (q.url === '/health') return send(200, { status: 'ok' });
    if ((q.url === '/tokenize' || q.url === '/v1/tokenize') && q.method === 'POST') {
      let b = ''; q.on('data', (d) => b += d); q.on('end', () => {
        const n = Math.max(8, Math.ceil((b || '').length / 4));
        send(200, { tokens: Array.from({ length: n }, (_, i) => i) });
      });
      return;
    }
    if (q.url === '/props') return send(400, { error: { message: 'model is required' } });
    if (q.url.startsWith('/props?model=')) return send(200, { default_generation_settings: { n_ctx: 32768 } });
    if (q.url === '/slots') return send(200, st.allowLoad || st.mode !== 'load' ? [{ model: 'gemma-4-12B-it-Q4_0' }] : []);
    if (q.method === 'POST' && (q.url === '/v1/chat/completions' || q.url === '/chat/completions')) {
      let b = ''; q.on('data', (d) => b += d); q.on('end', async () => {
        st.chats++;
        let body = {}; try { body = JSON.parse(b); } catch (e) {}
        if (st.mode === 'image') return send(400, { error: { message: 'image input is not supported' } });
        if (st.mode === 'load' && !st.allowLoad) return send(500, { error: { message: 'request cancelled while waiting for model' } });
        const reply = 'Γεια σου, αυτή είναι μια μακριά απάντηση που εμφανίζεται σιγά σιγά.';
        if (body.stream) {
          resp.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'connection': 'keep-alive' });
          if (resp.flushHeaders) resp.flushHeaders();
          resp.write(': ping\n\n');
          resp.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Γεια σου, ' } }] }) + '\n\n');
          if (st.mode === 'stream') {
            st.hold = new Promise((r) => { st.release = r; });
            await st.hold;
          }
          resp.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'αυτή είναι μια μακριά απάντηση που εμφανίζεται σιγά σιγά.' }, finish_reason: 'stop' }], timings: { prompt_n: 120, prompt_ms: 45, predicted_n: 18, predicted_ms: 80, cache_n: 90 } }) + '\n\n');
          return resp.end('data: [DONE]\n\n');
        }
        send(200, { choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], timings: { prompt_n: 120, cache_n: 90 } });
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
async function setup(win, port) {
  await win.evaluate((port) => {
    Store.state.settings.theme = 'midnight'; Theme.apply(Store.state.settings);
    const A = Store.state.settings.ai;
    const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + port + '/v1';
    A.tasks.commands = { p: 'llama', m: 'gemma-4-12B-it-Q4_0' };
    A.tasks.chat = { p: 'llama', m: 'gemma-4-12B-it-Q4_0' };
    A.tasks.greek = { p: 'llama', m: 'krikri-8b' };
    A.tasks.private = { p: 'llama', m: 'gemma-4-12B-it-Q4_0' };
    A.tasks.vision = { p: 'llama', m: 'gemma-4-12B-it-Q4_0' };
    A.servers.llama.ctx = 32768;
    A.servers.llama.modelsMax = 2;
    Store.save();
  }, port);
}

(async () => {
  const router = await startRouter();
  const { app, win } = await launch();
  const ver = await win.evaluate(() => Store.info && Store.info.version);
  ok(String(ver || '') === '2.6.9' || String(ver || '') === '2.6.8' || String(ver || '').includes('2.6.8'), 'app version 2.6.8', ver);
  await setup(win, router.port);

  // 1) streaming mid-answer
  router.st.mode = 'stream';
  await win.evaluate(() => Assistant.show());
  await win.waitForTimeout(400);
  await win.evaluate(() => { const q = document.querySelector('#as-q'); q.value = 'γεια'; void Assistant.send(); return 0; });
  try {
    await win.waitForFunction(() => /Γεια σου/.test(document.querySelector('.as-msg.streaming')?.innerText || ''), null, { timeout: 15000 });
  } catch (e) {
    const dump = await win.evaluate(() => ({
      busy: !!(Assistant && Assistant.busy),
      text: (document.querySelector('#as-msgs') && document.querySelector('#as-msgs').innerText || '').slice(0, 800),
      html: (document.querySelector('#as-msgs') && document.querySelector('#as-msgs').innerHTML || '').slice(0, 800),
    }));
    console.log('DUMP', JSON.stringify(dump), 'ROUTER', router.st.log.join(' | '), 'chats', router.st.chats);
    throw e;
  }
  const stopOn = await win.evaluate(() => document.querySelector('#as-send')?.classList.contains('stop'));
  ok(stopOn, 'send button becomes Stop while streaming');
  const pStream = await shot(win, 'assistant-streaming-midnight.png');
  ok(fs.existsSync(pStream), 'screenshot streaming mid-answer');
  if (router.st.release) router.st.release();
  await win.waitForFunction(() => !document.querySelector('.as-msg.streaming'), null, { timeout: 15000 }).catch(() => {});
  await win.waitForTimeout(400);

  // 2) loading-wait notice
  router.st.mode = 'load';
  router.st.allowLoad = false;
  await win.evaluate(() => { const q = document.querySelector('#as-q'); q.value = 'πες μου κάτι'; void Assistant.send(); return 0; });
  await win.waitForFunction(() => [...document.querySelectorAll('.as-notice')].some((n) => /φορτώνει το μοντέλο|loading the model/i.test(n.textContent || '')), null, { timeout: 15000 });
  const pLoad = await shot(win, 'assistant-loading-wait-midnight.png');
  ok(fs.existsSync(pLoad), 'screenshot loading-wait notice');
  const hasNotice = await win.evaluate(() => [...document.querySelectorAll('.as-notice')].some((n) => /φορτώνει το μοντέλο/.test(n.textContent || '')));
  ok(hasNotice, 'visible «φορτώνει το μοντέλο…» notice');
  router.st.allowLoad = true;
  await win.waitForFunction(() => !document.querySelector('.as-msg.streaming') || /απάντηση|Γεια/.test(document.querySelector('#as-msgs')?.innerText || ''), null, { timeout: 20000 }).catch(() => {});
  await win.waitForTimeout(500);

  // 3) mmproj hint on the Models tab (vision note of the model card)
  await win.evaluate(() => { try { Assistant.hide(); } catch (e) {} Hub.open(); });
  await win.waitForTimeout(400);
  await win.evaluate(() => document.querySelector('[data-hub-tab=models]')?.click());
  await win.waitForTimeout(1000);
  const note = await win.evaluate(() => document.querySelector('[data-mmproj], [data-vision-hint]')?.textContent || '');
  ok(/mmproj/.test(note) && /gemma-4-12B-it-Q4_0/.test(note), 'model / vision card shows mmproj subfolder hint', note);
  const pMm = await shot(win, 'hub-mmproj-hint-midnight.png');
  ok(fs.existsSync(pMm), 'screenshot mmproj hint');

  await quit(app);
  router.srv.close();
  console.log(`\nv2.6.8 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
