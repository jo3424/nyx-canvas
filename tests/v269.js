'use strict';
// v2.6.9 UI (Electron, Chromium sandbox on) against a mock llama router:
// date_calc / money_calc computed by Nyx, visible + editable thinking cap with re-ask without thinking, model per task
// (chat → Krikri, commands → Qwen), Krikri's tool-call 500 «peg-native» → warning + JSON (no endless «loading»),
// MTP / t/s in the Hub status, measured-VRAM warning (synthetic snapshot on Linux — there is no Windows GPU counter here).
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const C = require('../app/js/v26/calc.js');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v269-'));
const SHOTS = path.join(ROOT, 'shots');
// v2.6.9.1: never overwrite a delivered folder from a test run — delivery screenshots only with NYX_DELIVER_SHOTS=1
const SCREEN = process.env.NYX_DELIVER_SHOTS === '1' ? path.join(ROOT, 'dist', 'deliver-v2.6.9', 'screens') : path.join(ROOT, 'shots', 'deliver-v2.6.9');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(SCREEN, { recursive: true });
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QWEN = 'Qwen3.6-35B-A3B-UD-Q4_K_XL', KRIKRI = 'llama-krikri-8b-instruct-q8_0';

function startRouter() {
  const st = { chats: [], thinkClosed: 0 };
  const srv = http.createServer((q, resp) => {
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    if (q.url.startsWith('/v1/models') || q.url === '/models') return send(200, { data: [{ id: QWEN, status: { value: 'loaded' } }, { id: KRIKRI, status: { value: 'loaded' } }] });
    if (q.url === '/health') return send(200, { status: 'ok' });
    if (q.url.startsWith('/slots')) return send(200, [{ model: QWEN }]);
    if (q.url.startsWith('/props?model=')) return send(200, { default_generation_settings: { n_ctx: 32768 } });
    if (q.url === '/props') return send(400, { error: { message: 'model is required' } });
    if ((q.url.startsWith('/tokenize') || q.url.startsWith('/v1/tokenize')) && q.method === 'POST') { let b = ''; q.on('data', (d) => b += d); q.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch (e) {} send(200, { tokens: Array.from({ length: Math.ceil(String(j.content || '').length / 2) }, () => 1) }); }); return; }
    if (q.method === 'POST' && /chat\/completions/.test(q.url)) {
      let b = ''; q.on('data', (d) => b += d); q.on('end', () => {
        let body = {}; try { body = JSON.parse(b); } catch (e) {}
        const msgs = body.messages || []; const last = msgs[msgs.length - 1] || {}; const user = [...msgs].reverse().find((m) => m.role === 'user') || {};
        const think = !!(body.chat_template_kwargs && body.chat_template_kwargs.enable_thinking);
        st.chats.push({ model: body.model, tools: !!(body.tools && body.tools.length), think, user: String(user.content || '').replace(/\n*<context>[\s\S]*$/, '').slice(-80), lastRole: last.role });
        const timings = { prompt_n: 900, prompt_ms: 120, predicted_n: 69, predicted_ms: 1000, draft_n: 48, draft_n_accepted: 36 };
        const sse = (events) => { resp.writeHead(200, { 'content-type': 'text/event-stream' }); for (const e of events) resp.write('data: ' + JSON.stringify(e) + '\n\n'); resp.end('data: [DONE]\n\n'); };
        // Krikri cannot parse tool calls on b12230
        if (body.model === KRIKRI && body.tools && body.tools.length) return send(500, { error: { code: 500, message: 'Failed to parse input at pos 0: does not match the expected peg-native format', type: 'server_error' } });
        const u = String(user.content || '');
        if (think) { // endless thinking until the client closes
          resp.writeHead(200, { 'content-type': 'text/event-stream' });
          let i = 0; const tick = () => { if (resp.destroyed || resp.writableEnded) return; resp.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'σκέψη ' + (i++) + ' · ' } }] }) + '\n\n'); setTimeout(tick, 2); };
          resp.on('close', () => { if (!resp.writableEnded) st.thinkClosed++; }); return tick();
        }
        if (last.role === 'tool') {
          let j = {}; try { j = JSON.parse(last.content); } catch (e) {}
          const txt = j.dmy ? `Πέφτει ${j.weekday_el} ${j.dmy} (σε ${j.days_from_today} μέρες).` : j.parts ? 'Μερίδια: ' + j.parts.map((p) => p.text).join(' + ') + ' = ' + j.check + '.' : 'OK';
          return sse([{ choices: [{ delta: { content: txt }, finish_reason: 'stop' }], timings }]);
        }
        if (body.tools && body.tools.length && /σε 45 μέρες/.test(u)) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'date_calc', arguments: JSON.stringify({ expr: 'σε 45 μέρες' }) } }] }, finish_reason: 'tool_calls' }], timings }]);
        if (body.tools && body.tools.length && /1640/.test(u)) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c2', type: 'function', function: { name: 'money_calc', arguments: JSON.stringify({ op: 'split', total: '1640€', parts: 3 }) } }] }, finish_reason: 'tool_calls' }], timings }]);
        if (body.model === KRIKRI && !body.tools) {
          if (/JSON|json|actions/.test(JSON.stringify(msgs[0] || ''))) return sse([{ choices: [{ delta: { content: '{"say":"Γεια σου! (JSON χωρίς εργαλεία)","actions":[]}' }, finish_reason: 'stop' }], timings: { prompt_n: 700, predicted_n: 30, predicted_ms: 600 } }]);
          return sse([{ choices: [{ delta: { content: 'Ένας γάτος μπαίνει σε ένα καφενείο… (Krikri)' }, finish_reason: 'stop' }], timings: { prompt_n: 700, predicted_n: 30, predicted_ms: 600 } }]);
        }
        return sse([{ choices: [{ delta: { content: 'Η απάντηση χωρίς σκέψη.' }, finish_reason: 'stop' }], timings }]);
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
async function shot(win, name, clip) { const dest = path.join(SCREEN, name); await win.screenshot({ path: dest, ...(clip ? { clip } : {}) }); fs.copyFileSync(dest, path.join(SHOTS, name)); return dest; }
const asBox = (win) => win.evaluate(() => { const r = document.querySelector('#assistant').getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 1440), height: Math.min(r.height, 900) }; });
async function say(win, text) {
  await win.evaluate((t) => { Store.state.chat = []; Assistant.render(); document.querySelector('#as-q').value = t; Assistant.send(); }, text);
  await win.waitForFunction(() => !Assistant.busy && (Store.state.chat || []).some((m) => m.role === 'assistant'), null, { timeout: 30000 });
  return win.evaluate(() => { const m = Store.state.chat.find((x) => x.role === 'assistant'); return { content: m.content, notices: (m.notices || []).map((n) => n.text), actions: m.actions || [], model: m.model, html: document.querySelector('#as-msgs').innerText }; });
}

(async () => {
  const router = await startRouter();
  const { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(String(ver).includes('2.6.9') || String(ver).startsWith('2.6.10'), 'app version 2.6.9', ver);
  await win.evaluate((a) => {
    Store.state.settings.theme = 'midnight'; Theme.apply(Store.state.settings);
    const A = Store.state.settings.ai; const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + a.port + '/v1';
    for (const k of ['commands', 'chat', 'vision', 'summarize']) A.tasks[k] = { p: 'llama', m: a.QWEN };
    A.servers.llama.ctx = 32768; A.assistant.thinking = false; A.assistant.thinkingBudget = 0; A.assistant.canvasConfirm = true;
    try { localStorage.removeItem('nyx.toolCaps'); } catch (e) {}
    Store.state.chat = []; Store.save(); Assistant.show();
  }, { port: router.port, QWEN });
  const cardsBefore = await win.evaluate(() => Store.items().length);

  // 1) dates and amounts by Nyx
  const today = C.resolveDate('σε 45 μέρες', { now: new Date() });
  const r1 = await say(win, 'Τι μέρα πέφτει σε 45 μέρες;');
  ok(r1.content.startsWith(`Πέφτει ${today.weekday_el} ${today.dmy} (σε 45 μέρες).`) && r1.actions.some((a) => a.tool === 'date_calc' && a.ok), `date_calc: «σε 45 μέρες» → ${today.weekday_el} ${today.dmy} (computed by Nyx)`, r1);
  ok(/ημερομηνία \(Nyx\)/.test(r1.html), 'action chip «ημερομηνία (Nyx)»', r1.html.slice(-200));
  await shot(win, 'date-calc-by-nyx-midnight.png', await asBox(win));
  const r2 = await say(win, 'Μοίρασε 1640€ σε 3 άτομα');
  ok(r2.content.startsWith('Μερίδια: 546,67 € + 546,67 € + 546,66 € = 1.640,00 €.'), 'money_calc: 1640€ / 3 → 546,67 + 546,67 + 546,66 = 1.640,00 €', r2.content);
  await shot(win, 'money-calc-by-nyx-midnight.png', await asBox(win));
  ok((await win.evaluate(() => Store.items().length)) === cardsBefore, 'calc tools did not touch the canvas');

  // 2) thinking cap: visible, editable, re-ask without thinking
  const chip0 = await win.evaluate(() => { Store.state.settings.ai.assistant.thinking = true; Assistant.syncThink(); const c = document.querySelector('#as-think-cap'); return { txt: c.textContent, vis: c.getBoundingClientRect().width > 0 }; });
  ok(chip0.vis && chip0.txt === 'Σκέψη: χωρίς όριο', 'chip visible next to «Σκέψη»: «Σκέψη: χωρίς όριο» (0 = no fixed cap)', chip0);
  await win.click('#as-think-cap');
  await win.waitForSelector('#as-think-cap-inp', { timeout: 5000 });
  await win.fill('#as-think-cap-inp', '256');
  await shot(win, 'think-cap-edit-midnight.png');
  await win.evaluate(() => { const b = [...document.querySelectorAll('.modal button, dialog button, .modal-foot button')].find((x) => /OK|Εντάξει|Αποθήκευση|Ναι/i.test(x.textContent)); if (b) b.click(); });
  await win.waitForTimeout(300);
  const chip1 = await win.evaluate(() => ({ txt: document.querySelector('#as-think-cap').textContent, v: Store.state.settings.ai.assistant.thinkingBudget }));
  ok(chip1.v === 256 && chip1.txt === 'Σκέψη ≤ 256 tokens', 'edited to 256 → «Σκέψη ≤ 256 tokens», saved in settings', chip1);
  const before = router.st.chats.length;
  const r3 = await say(win, 'Γράψε μου δύο γραμμές για τη θάλασσα');
  const reqs = router.st.chats.slice(before).filter((c) => c.user === 'Γράψε μου δύο γραμμές για τη θάλασσα'); // (the memory-facts request after the reply is separate)
  ok(reqs.length === 2 && reqs[0].think && !reqs[1].think, 'first request with thinking, second without', reqs);
  ok(router.st.thinkClosed >= 1, 'thinking stream was closed at the cap (server stops generating)', router.st.thinkClosed);
  ok(r3.content === 'Η απάντηση χωρίς σκέψη.' && r3.notices.includes('Η σκέψη έφτασε το όριο των 256 tokens — ζητάω την απάντηση χωρίς σκέψη.'), 'answer arrives + visible notice «Η σκέψη έφτασε το όριο των 256 tokens…»', r3);
  ok((await win.evaluate(() => Store.state.settings.ai.assistant.thinking)) === true, 'thinking setting unchanged (no silent switch-off)');
  await shot(win, 'think-cap-reask-midnight.png', await asBox(win));
  await win.evaluate(() => { Store.state.settings.ai.assistant.thinking = false; Store.state.settings.ai.assistant.thinkingBudget = 0; Store.save(); Assistant.syncThink(); });

  // 3a) model per task: chat → Krikri (plain talk), commands → Qwen (dates/amounts/canvas)
  await win.evaluate((a) => { Object.assign(Store.state.settings.ai.tasks.chat, { p: 'llama', m: a.KRIKRI }); Store.save(); }, { KRIKRI });
  let b0 = router.st.chats.length;
  const r4 = await say(win, 'Πες μου ένα ανέκδοτο');
  const q4 = router.st.chats.slice(b0).filter((c) => c.user === 'Πες μου ένα ανέκδοτο');
  ok(q4.length === 1 && q4[0].model === KRIKRI && !q4[0].tools && /Krikri/.test(r4.content), 'plain chat → Krikri, without tools', q4);
  ok(r4.notices.some((n) => /μοντέλο «Συζήτηση»: llama-krikri/.test(n)), 'visible note which model answered', r4.notices);
  b0 = router.st.chats.length;
  await say(win, 'Μοίρασε 1640€ σε 3 άτομα');
  ok(router.st.chats.slice(b0)[0].model === QWEN && router.st.chats.slice(b0)[0].tools, 'amount question → Qwen with tools', router.st.chats.slice(b0));
  await win.evaluate((a) => { Object.assign(Store.state.settings.ai.tasks.chat, { p: 'llama', m: a.QWEN }); Store.save(); }, { QWEN });

  // 3b) Krikri for commands: warning in the Hub, 500 peg-native → JSON, no endless loading
  await win.evaluate((a) => { for (const k of ['commands', 'chat']) Object.assign(Store.state.settings.ai.tasks[k], { p: 'llama', m: a.KRIKRI }); Store.save(); }, { KRIKRI });
  const t0 = Date.now();
  const r5 = await say(win, 'Γεια σου');
  ok(Date.now() - t0 < 15000 && r5.content.startsWith('Γεια σου! (JSON χωρίς εργαλεία)'), `500 peg-native → JSON answer in ${Date.now() - t0} ms (was endless «loading»)`, r5);
  ok(r5.notices.some((n) => /δεν δέχεται tool calls/.test(n) && /peg-native/.test(n)), 'visible notice: model does not accept tool calls (with the router message)', r5.notices);
  await shot(win, 'krikri-no-tools-notice-midnight.png', await asBox(win));
  await win.evaluate(() => { try { Assistant.hide(); } catch (e) {} Hub.open(); });
  await win.waitForTimeout(500);
  await win.evaluate(() => document.querySelector('[data-hub-tab=models]')?.click());
  await win.waitForFunction(() => { const p = document.querySelector('.task-row[data-task=commands] .task-tools'); return p && !p.hidden && p.getAttribute('data-tools') === 'no'; }, null, { timeout: 10000 }).catch(() => {});
  const pillK = await win.evaluate(() => { const p = document.querySelector('.task-row[data-task=commands] .task-tools'); return p ? { hidden: p.hidden, txt: p.textContent, tip: p.title, st: p.getAttribute('data-tools') } : null; });
  ok(pillK && !pillK.hidden && pillK.st === 'no' && /Δεν κάνει tool calls/.test(pillK.txt) && /peg-native/.test(pillK.tip), 'Hub «Εντολές» row: ⚠️ Δεν κάνει tool calls (tooltip with the 500)', pillK);
  const rowBox = await win.evaluate(() => { const r = document.querySelector('.task-row[data-task=commands]').closest('.tasks').getBoundingClientRect(); return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(r.width + 16, 1440), height: Math.min(r.height + 16, 900) }; });
  await shot(win, 'hub-commands-krikri-warning-midnight.png', rowBox);
  await win.evaluate((a) => { for (const k of ['commands', 'chat']) Object.assign(Store.state.settings.ai.tasks[k], { p: 'llama', m: a.QWEN }); Store.save(); Hub.refreshTasks(); }, { QWEN });
  await win.waitForTimeout(800);
  const pillQ = await win.evaluate(() => { const p = document.querySelector('.task-row[data-task=commands] .task-tools'); return p ? { txt: p.textContent, st: p.getAttribute('data-tools') } : null; });
  ok(pillQ && pillQ.st === 'ok' && /tool calls ✓/.test(pillQ.txt), 'Qwen (made tool calls above) → «tool calls ✓»', pillQ);

  // 3c) MTP + t/s in the status panel (from the server's timings of the last request)
  await win.evaluate(() => { AI.lastTimings = { prompt_n: 900, prompt_ms: 120, predicted_n: 69, predicted_ms: 1000, draft_n: 48, draft_n_accepted: 36 }; AI.noteRequest({ model: 'Qwen3.6-35B-A3B-UD-Q4_K_XL', timings: AI.lastTimings }); document.querySelector('[data-hub-tab=status]')?.click(); });
  await win.waitForTimeout(1500);
  const stat = await win.evaluate(() => { const m = document.querySelector('[data-st=mtp]'); const s = document.querySelector('[data-st=speed]'); return { mtp: m && m.textContent, mtpState: m && m.getAttribute('data-mtp'), tip: m && m.parentElement.title, speed: s && s.innerText }; });
  ok(stat.mtpState === 'on' && stat.mtp === 'MTP ενεργό' && /36 από 48 δεκτά \(75%\)/.test(stat.tip), 'Hub status: «MTP ενεργό» (36/48 draft tokens accepted)', stat);
  ok(/69 t\/s/.test(stat.speed) && /Qwen3\.6-35B/.test(stat.speed), 'Hub status: 69 t/s with the model name', stat);
  // VRAM warning: real snapshot on this Linux box has no GPU counters → no warning shown
  const real = await win.evaluate(async () => { const s = await API.inv('perf:snapshot'); const w = NyxLimits.vramWarn(s); const el = document.querySelector('[data-st=vram-warn]'); return { state: w.state, hidden: el ? el.hidden : null }; });
  ok(real.state === 'none' && real.hidden === true, 'no GPU measurement on the box → no VRAM warning (never from file sizes)', real);
  // synthetic Windows snapshot (RX 7900 XTX + router + Voice Studio's llama-server) to show the warning UI
  const warn = await win.evaluate(() => {
    const GB = 1073741824;
    const snap = { gpu: { adapter: { name: 'AMD Radeon RX 7900 XTX', total: 24 * GB, used: 22.6 * GB }, procs: [{ pid: 4100, name: 'llama-server', path: 'C:\\Users\\jonh\\llama-router\\llama-server.exe', vram: 17.1 * GB }, { pid: 5200, name: 'llama-server', path: 'C:\\Users\\jonh\\GPU-Voice-Studio\\third_party\\llama\\llama-server.exe', vram: 4.4 * GB }] } };
    const el = document.querySelector('[data-st=vram-warn]'); Hub.paintVramWarn(el, snap); el.scrollIntoView({ block: 'center' }); return { txt: el.textContent, hidden: el.hidden, st: el.getAttribute('data-vram') };
  });
  ok(!warn.hidden && warn.st === 'gvs' && /22,6 GB από 24,0 GB/.test(warn.txt) && /Voice Studio/.test(warn.txt), 'VRAM warning text with the measured numbers + Voice Studio', warn);
  const stBox = await win.evaluate(() => { const r = document.querySelector('.hub-stats').parentElement.getBoundingClientRect(); return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(r.width + 16, 1440), height: Math.min(520, 900) }; });
  await shot(win, 'hub-status-mtp-ts-vram-midnight.png', stBox);

  await quit(app);
  router.srv.close();
  console.log(`\nv2.6.9 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
