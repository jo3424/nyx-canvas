'use strict';
// v2.6.8.2 UI (Electron, Chromium sandbox on): real files through the attach pipeline against a mock llama router
// (/tokenize counts like the server did on the PC), orange chip, zip file list, send pauses the heavy stage,
// prompt never above n_ctx, log copy (button, mouse selection + Ctrl+C, Ctrl+A).
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2682-'));
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2682-fx-'));
const SHOTS = path.join(ROOT, 'shots');
// v2.6.9.1: never overwrite a delivered folder from a test run — delivery screenshots only with NYX_DELIVER_SHOTS=1
const SCREEN = process.env.NYX_DELIVER_SHOTS === '1' ? path.join(ROOT, 'dist', 'deliver-v2.6.8.2', 'screens') : path.join(ROOT, 'shots', 'deliver-v2.6.8.2');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(SCREEN, { recursive: true });
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N_CTX = 32768;
const GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]/g;
const isCode = (c) => ((c.match(/[{}[\]();=<>/\\:"'`|&*+#$_~^%@!?,.-]/g) || []).length / Math.max(1, c.length)) >= 0.07;
function realTok(s) { s = String(s || ''); let n = 0; for (let i = 0; i < s.length; i += 2000) { const c = s.slice(i, i + 2000); const g = (c.match(GREEK) || []).length; n += g / 1.4 + (c.length - g) / (isCode(c) ? 3.14 : 3.6); } return Math.ceil(n); }

// fixtures: half-Greek 51,070-char text (the 34-page PDF's text), a code zip, a PNG
function rng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
const GR = ['Η εφαρμογή διαβάζει το αρχείο και κρατά τις σελίδες με τη σειρά τους.', 'Ο πίνακας δείχνει τα έσοδα ανά μήνα και τις αλλαγές από πέρσι.', 'Στο κεφάλαιο αυτό περιγράφεται η διαδικασία έγκρισης των αιτήσεων.', 'Οι συμμετέχοντες συμφώνησαν να ξαναδούν το χρονοδιάγραμμα τον Δεκέμβριο.'];
const ENG = ['The report lists the quarterly figures and the main risks for the next year.', 'Section four explains how the data was collected and cleaned before analysis.', 'All values are rounded to two decimals unless noted otherwise in the table.', 'The appendix contains the full questionnaire and the raw answers.'];
let doc = ''; { const r = rng(7); let p = 1; while (doc.length < 51070) { if (doc.length > p * 1500) doc += `\n[${++p}] `; doc += (r() < 0.5 ? GR : ENG)[Math.floor(r() * 4)] + ' '; } doc = doc.slice(0, 51070); }
const DOC = path.join(FIX, 'έκθεση-34-σελίδες.txt'); fs.writeFileSync(DOC, doc);
const ZIPDIR = path.join(FIX, 'z'); fs.mkdirSync(path.join(ZIPDIR, 'app', 'js'), { recursive: true });
const code = (n, seed) => { const r = rng(seed); let s = "'use strict';\n"; while (s.length < n) { const k = Math.floor(r() * 1000); s += `function f${k}(a, b) {\n  const x = [a, b].map((v) => v * ${k});\n  if (x[0] > ${k}) { return { ok: true, v: x }; }\n  return null;\n}\n`; } return s.slice(0, n); };
[[41000, 'attach.js'], [30000, 'core.js'], [22000, 'agent.js'], [16000, 'hub.js'], [12000, 'assistant.js'], [6000, 'dnd.js'], [2200, 'logcopy.js'], [1280, 'tokens.js']].forEach(([n, f], i) => fs.writeFileSync(path.join(ZIPDIR, 'app', 'js', f), code(n, i + 1)));
fs.writeFileSync(path.join(ZIPDIR, 'package.json'), JSON.stringify({ name: 'nyx-canvas', version: '2.6.7.1', main: 'boot.js', scripts: { start: 'electron .' }, devDependencies: { electron: '45.2.3' } }, null, 2));
fs.writeFileSync(path.join(ZIPDIR, 'CHANGELOG.json'), JSON.stringify({ '2.6.7.1': { el: ['Μικροδιορθώσεις Hub. '.repeat(60)] }, '2.6.7': { el: ['Engines. '.repeat(80)] }, '2.6.6': { el: ['x'] } }, null, 1));
const ZIP = path.join(FIX, 'nyx-2.6.7-to-2.6.7.1.zip');
execFileSync('python3', ['-c', `import zipfile,os,sys\nz=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)\nfor r,d,fs in os.walk(sys.argv[2]):\n  for f in fs:\n    p=os.path.join(r,f); z.write(p, os.path.relpath(p, sys.argv[2]))\nz.close()`, ZIP, ZIPDIR]);
const PNG = path.join(FIX, 'φωτο.png');
fs.writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

function startRouter() {
  const st = { log: [], chats: [], tokenize: 0, visionOpen: 0, visionAborted: 0, visionDone: 0, order: [] };
  const srv = http.createServer((q, resp) => {
    st.log.push(q.method + ' ' + q.url);
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    if (q.url.startsWith('/v1/models') || q.url === '/models') return send(200, { data: [{ id: 'gemma-4-12B-it-Q4_0', status: { value: 'loaded' } }] });
    if (q.url === '/health') return send(200, { status: 'ok' });
    if (q.url.startsWith('/slots')) return send(200, [{ model: 'gemma-4-12B-it-Q4_0' }]);
    if (q.url.startsWith('/props?model=')) return send(200, { default_generation_settings: { n_ctx: N_CTX } });
    if (q.url === '/props') return send(400, { error: { message: 'model is required' } });
    if ((q.url.startsWith('/tokenize') || q.url.startsWith('/v1/tokenize')) && q.method === 'POST') {
      let b = ''; q.on('data', (d) => b += d); q.on('end', () => { st.tokenize++; let j = {}; try { j = JSON.parse(b); } catch (e) {} send(200, { tokens: Array.from({ length: realTok(j.content || '') }, (_, i) => i % 50000) }); });
      return;
    }
    if (q.method === 'POST' && /chat\/completions/.test(q.url)) {
      let b = ''; q.on('data', (d) => b += d); q.on('end', () => {
        let body = {}; try { body = JSON.parse(b); } catch (e) {}
        const isVision = JSON.stringify(body.messages || []).includes('image_url');
        if (isVision) {
          st.visionOpen++; const n = st.visionOpen; st.order.push('vision' + n + ':start');
          if (n === 1) { resp.on('close', () => { if (!resp.writableEnded) { st.visionAborted++; st.order.push('vision1:aborted'); } }); return; } // busy: hangs until the client aborts
          st.visionDone++; st.order.push('vision' + n + ':done');
          resp.writeHead(200, { 'content-type': 'text/event-stream' });
          resp.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Μια κόκκινη κουκκίδα.' }, finish_reason: 'stop' }] }) + '\n\n');
          return resp.end('data: [DONE]\n\n');
        }
        const all = (body.messages || []).map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
        const promptTok = (body.messages || []).reduce((n, m) => n + realTok(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) + 8, 0) + (body.tools ? realTok(JSON.stringify(body.tools)) : 0);
        st.chats.push({ promptTok, max_tokens: body.max_tokens, len: all.length, hasCut: /κόπηκε|cut to fit/.test(all), zipList: /Λίστα αρχείων|File list/.test(all) });
        st.order.push('user:chat');
        if (promptTok > N_CTX) return send(400, { error: { message: `the request exceeds the available context size (${promptTok} > ${N_CTX})` } });
        const reply = 'Εντάξει, το διάβασα.';
        if (body.stream) {
          resp.writeHead(200, { 'content-type': 'text/event-stream' });
          resp.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: 'stop' }], timings: { prompt_n: promptTok, predicted_n: 6 } }) + '\n\n');
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
async function shot(win, name, clip) { const dest = path.join(SCREEN, name); await win.screenshot({ path: dest, ...(clip ? { clip } : {}) }); fs.copyFileSync(dest, path.join(SHOTS, name)); return dest; }
const chipText = (win) => win.evaluate(() => document.querySelector('#as-att')?.innerText || '');

(async () => {
  const router = await startRouter();
  const { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(String(ver).includes('2.6.8.2') || String(ver).includes('2.6.9') || String(ver).startsWith('2.6.10') || String(ver).startsWith('2.6.11'), 'app version 2.6.8.2', ver);
  await win.evaluate((port) => {
    Store.state.settings.theme = 'midnight'; Theme.apply(Store.state.settings);
    const A = Store.state.settings.ai; const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + port + '/v1';
    for (const k of ['commands', 'chat', 'vision', 'summarize']) A.tasks[k] = { p: 'llama', m: 'gemma-4-12B-it-Q4_0' };
    A.servers.llama.ctx = 32768; A.assistant.attachReserve = 2048; A.assistant.canvasConfirm = true;
    Store.state.chat = []; Store.save(); Assistant.show();
  }, router.port);

  // 1) the 51,070-char half-Greek document after a short conversation: measured with /tokenize, orange chip, no green ✓
  await win.evaluate(() => {
    const q = ['Θέλω να οργανώσω τις σημειώσεις της συνάντησης για τον προϋπολογισμό και τα επόμενα βήματα.', 'Ορίστε μια πρόταση: χωρίζουμε σε αποφάσεις, εκκρεμότητες και ερωτήματα, με υπεύθυνο και ημερομηνία.'];
    Store.state.chat = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: q[i % 2].repeat(3), at: Date.now() - (24 - i) * 60000 }));
    Assistant.render();
  });
  await win.evaluate((p) => Att.add([p]), DOC);
  await win.waitForFunction(() => { const e = Att.list[0]; return e && e.state === 'ok' && e.tk && e.tk.src === 'measured'; }, null, { timeout: 20000 });
  await win.waitForTimeout(300);
  const c1 = await chipText(win);
  const st1 = await win.evaluate(() => { const e = Att.list[0]; const p = Att.plan(Att.list)[e.id]; const chip = document.querySelector('#as-att .at-chip'); return { tk: e.tk, send: p.send, total: p.total, over: p.over, cls: chip.className, st: chip.querySelector('.st')?.textContent, color: getComputedStyle(chip.querySelector('.at-tok')).color }; });
  ok(st1.tk.n > 20000 && st1.tk.n < 32000 && Math.ceil(51070 / 4) === 12768, `measured ${st1.tk.n} tokens (old chars/4 said 12,768)`, st1);
  ok(st1.over && /\bover\b/.test(st1.cls) && st1.st !== '✓', 'chip is orange, no green ✓', st1);
  ok(/θα σταλούν \d+ από \d+ tokens/.test(c1) && /μετρημένο/.test(c1), 'chip says «θα σταλούν X από Y tokens · μετρημένο»', c1);
  ok(router.st.tokenize === 1, 'exactly one /tokenize for the attachment', router.st.tokenize);
  const box1 = await win.evaluate(() => { const r = document.querySelector('#assistant').getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 1440), height: Math.min(r.height, 900) }; });
  await shot(win, 'attachment-orange-chip-midnight.png', box1);

  // send it: the server must never see a prompt above n_ctx
  await win.evaluate(() => { document.querySelector('#as-q').value = 'Τι λέει η έκθεση;'; Assistant.send(); });
  await win.waitForFunction(() => !Assistant.busy && (Store.state.chat || []).some((m) => m.role === 'assistant'), null, { timeout: 30000 });
  const ch1 = router.st.chats[router.st.chats.length - 1];
  ok(ch1 && ch1.promptTok <= N_CTX && ch1.promptTok + 2048 <= N_CTX + 64, `server-side prompt ${ch1 && ch1.promptTok} ≤ ${N_CTX} (with room for the answer)`, ch1);
  const hist1 = await win.evaluate(() => { const u = Store.state.chat.find((m) => m.role === 'user' && m.atts); return u && u.atts[0]; });
  ok(hist1 && hist1.tokensSent > 0 && hist1.tokensSent <= hist1.tokensTotal && hist1.tokSrc === 'measured', 'history chip keeps «στάλθηκαν X από Y» (μετρημένο)', hist1);
  const errs = await win.evaluate(() => (Store.state.chat || []).filter((m) => m.error).map((m) => m.content));
  ok(!errs.length, 'no context-size error', errs);

  // 2) the code zip: file list chip, no auto-summary
  await win.evaluate(() => { Store.state.chat = []; Assistant.render(); });
  await win.evaluate((p) => Att.add([p]), ZIP);
  await win.waitForFunction(() => { const e = Att.list[0]; return e && e.state === 'ok' && e.children && e.tk; }, null, { timeout: 20000 });
  await win.waitForTimeout(500);
  await win.evaluate(() => { const d = document.querySelector('#as-att details.at-files'); if (d) d.open = true; });
  await win.waitForTimeout(200);
  const c2 = await chipText(win);
  ok(/αρχεία · \d+ ολόκληρα · \d+ σύντομα/.test(c2) && /app\/js\/attach\.js · \d+ KB · \d+ tok/.test(c2) && /package\.json/.test(c2), 'zip chip lists files (path · size · tokens)', c2.slice(0, 600));
  ok(/Περίληψη/.test(c2), '«Περίληψη» button on the chip (summary only on request)', c2.slice(-200));
  ok(router.st.visionOpen === 0 && !router.st.chats.slice(1).length, 'no model call for the zip on upload');
  const box2 = await win.evaluate(() => { const r = document.querySelector('#assistant').getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 1440), height: Math.min(r.height, 900) }; });
  await shot(win, 'attachment-zip-filelist-midnight.png', box2);
  await win.evaluate(() => { document.querySelector('#as-q').value = 'Τι άλλαξε;'; Assistant.send(); });
  await win.waitForFunction(() => !Assistant.busy && (Store.state.chat || []).some((m) => m.role === 'assistant'), null, { timeout: 30000 });
  const ch2 = router.st.chats[router.st.chats.length - 1];
  ok(ch2 && ch2.zipList && ch2.promptTok <= N_CTX, `zip sent as a file list + files that fit; prompt ${ch2 && ch2.promptTok} ≤ ${N_CTX} (was 50,556)`, ch2);

  // 3) heavy stage in flight (vision on a photo) → send pauses it, user request goes first, it resumes after
  await win.evaluate(() => { Store.state.chat = []; Assistant.render(); });
  await win.evaluate((p) => Att.add([p]), PNG);
  await win.waitForFunction(() => Att.list[0] && Att.list[0].state === 'heavy' && Att._bgStreams.size === 1, null, { timeout: 15000 });
  await sleep(300);
  ok(router.st.visionOpen === 1, 'vision request is running at the router', router.st.order);
  const t0 = Date.now();
  await win.evaluate(() => { document.querySelector('#as-q').value = 'Τι δείχνει η φωτογραφία;'; Assistant.send(); });
  await win.waitForFunction(() => !Assistant.busy && (Store.state.chat || []).some((m) => m.role === 'assistant'), null, { timeout: 30000 });
  const replyMs = Date.now() - t0;
  await win.waitForFunction(() => { const e = Att.last[0]; return e && e.state === 'ok'; }, null, { timeout: 15000 }).catch(() => {});
  await sleep(300);
  const o = router.st.order;
  const iAb = o.indexOf('vision1:aborted'), iUser = o.lastIndexOf('user:chat'), iV2 = o.indexOf('vision2:start');
  ok(iAb >= 0 && iAb < iUser, 'the in-flight background request was aborted before the user request', o);
  ok(iV2 > iUser && router.st.visionDone === 1, 'the background step ran again after the reply', o);
  ok(replyMs < 8000, `reply did not wait for the heavy stage (${replyMs} ms)`, replyMs);

  // 4) logs: «Αντιγραφή όλων», mouse selection + Ctrl+C, Ctrl+A
  await win.evaluate(() => { try { Assistant.hide(); } catch (e) {} Hub.open(); });
  await win.waitForTimeout(400);
  await win.evaluate(() => document.querySelector('[data-hub-tab=engines]')?.click());
  await win.waitForTimeout(700);
  const LOG = ['> llama-server.exe --models-max 2 -np 1 -c 32768', 'main: server is listening on http://127.0.0.1:8080', 'srv  load_model: loading gemma-4-12B-it-Q4_0', 'slot launch_slot_: id 0 | task 12 | processing task', 'slot release: id 0 | task 12 | stop processing'].join('\n');
  // the router's output arrives the normal way (proc:status event from the main process)
  await app.evaluate(({ BrowserWindow }, lines) => BrowserWindow.getAllWindows()[0].webContents.send('proc:status', { id: 'llama', running: false, exit: 0, log: lines }), LOG.split('\n'));
  await win.waitForTimeout(300);
  const logInfo = await win.evaluate((txt) => {
    const pre = document.querySelector('pre.srv-log'); if (!pre) return null;
    pre.hidden = false; pre.scrollIntoView({ block: 'center' });
    if (pre.textContent !== txt) return { wrongText: pre.textContent };
    const btn = pre.nextElementSibling;
    return { hasBtn: !!(btn && btn.classList.contains('log-copy')), label: btn && btn.textContent.trim(), tabindex: pre.tabIndex };
  }, LOG);
  ok(logInfo && logInfo.hasBtn && logInfo.label === 'Αντιγραφή όλων' && logInfo.tabindex === 0, 'router log has «Αντιγραφή όλων» and can take focus', logInfo);
  await win.waitForTimeout(300);
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await win.click('pre.srv-log + .log-copy');
  await win.waitForTimeout(300);
  const clipAll = await app.evaluate(({ clipboard }) => clipboard.readText());
  ok(clipAll === LOG, '«Αντιγραφή όλων» copies the whole log', clipAll);
  const box = await win.evaluate(() => { const r = document.querySelector('pre.srv-log').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  // mouse selection across the first lines, then Ctrl+C
  await win.mouse.move(box.x + 9, box.y + 12); await win.mouse.down(); await win.mouse.move(box.x + box.w * 0.6, box.y + 40, { steps: 8 }); await win.mouse.up();
  const sel = await win.evaluate(() => String(getSelection()));
  await win.keyboard.press('Control+c');
  await win.waitForTimeout(250);
  const clipSel = await app.evaluate(({ clipboard }) => clipboard.readText());
  ok(sel.length > 10 && clipSel === sel && LOG.includes(clipSel.trim().split('\n')[0]), 'mouse selection + Ctrl+C copies the selected log text', { sel, clipSel });
  const cards = await win.evaluate(() => (typeof Clip !== 'undefined' && Clip.buf) ? Clip.buf.length : null);
  await win.click('pre.srv-log');
  await win.keyboard.press('Control+a');
  const selAll = await win.evaluate(() => ({ s: String(getSelection()), cards: (typeof Canvas !== 'undefined' && Canvas.sel) ? Canvas.sel.size : 0 }));
  ok(selAll.s.trim() === LOG.trim() && selAll.cards === 0, 'Ctrl+A in the log selects only the log (no cards selected)', selAll);
  await win.keyboard.press('Control+c');
  await win.waitForTimeout(250);
  ok((await app.evaluate(({ clipboard }) => clipboard.readText())).trim() === LOG.trim(), 'Ctrl+A then Ctrl+C copies the log');
  await win.evaluate(() => { getSelection().removeAllRanges(); document.querySelector('pre.srv-log + .log-copy').classList.add('done'); });
  const lb = await win.evaluate(() => { const pre = document.querySelector('pre.srv-log'); const r = pre.closest('.srv').getBoundingClientRect(); return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(r.width + 16, 1440), height: Math.min(r.height + 16, 900) }; });
  await shot(win, 'log-copy-button-midnight.png', lb);
  void cards;

  await quit(app);
  router.srv.close();
  console.log(`\nv2.6.8.2 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
