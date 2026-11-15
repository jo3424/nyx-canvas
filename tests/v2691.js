'use strict';
// v2.6.9.1 UI (Electron, Chromium sandbox on) against a fake llama-server router that follows b12230's router code
// (tools/server/server-models.cpp): bare GET /props → role=router + dummy n_ctx 0; ?model=&autoload=false on a loaded
// model → its props; POST reads «model» from the body; /v1/models has status {value,args}. The chat child applies a
// strict Qwen-style template check: any system message after index 0 → 500 «Jinja Exception: System message must be at the beginning.»
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2691-'));
const MODELS = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2691-models-'));
const OMNI = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2691-omni-'));
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QWEN = 'Qwen3.8-27B-UD-Q4_K_XL', KRIKRI = 'llama-krikri-8b-instruct-q8_0';
const STRICT = 'Jinja Exception: System message must be at the beginning.';
// model files (sparse): 1,5 GB in the router folder + 0,5 GB OmniVoice → 2,0 decimal GB
fs.mkdirSync(path.join(MODELS, QWEN)); fs.writeFileSync(path.join(MODELS, QWEN, QWEN + '.gguf'), ''); fs.truncateSync(path.join(MODELS, QWEN, QWEN + '.gguf'), 1500000000);
for (const f of ['omnivoice-base-Q8_0.gguf', 'omnivoice-tokenizer-Q8_0.gguf']) fs.writeFileSync(path.join(OMNI, f), ''); fs.truncateSync(path.join(OMNI, 'omnivoice-base-Q8_0.gguf'), 500000000);
const EXE = path.join(OMNI, 'omnivoice-tts'); fs.writeFileSync(EXE, '#!/bin/sh\n');
const DOC = path.join(DATA, 'σημειώσεις.txt'); fs.writeFileSync(DOC, 'Πρακτικά συνάντησης: προϋπολογισμός 1640€ και επόμενα βήματα.\n'.repeat(40));

function startRouter() {
  const st = { chats: [], violations: 0, tokenize: [], props: [], mode: 'ok', status: { [QWEN]: 'loaded', [KRIKRI]: 'unloaded' } };
  const srv = http.createServer((q, resp) => {
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    const err = (c, m) => send(c, { error: { code: c, message: m, type: c === 400 ? 'invalid_request_error' : 'server_error' } });
    const u = new URL(q.url, 'http://x'); const model = u.searchParams.get('model'); const autoload = u.searchParams.get('autoload');
    if (u.pathname === '/v1/models' || u.pathname === '/models') return send(200, { object: 'list', data: Object.entries(st.status).map(([id, v]) => ({ id, object: 'model', owned_by: 'llamacpp', status: { value: v, args: ['llama-server', '-c', '32768', '-np', '1'] }, context_length: 262144 })) });
    if (u.pathname === '/health') return send(200, { status: 'ok' });
    if (u.pathname === '/slots') return model ? send(200, [{ id: 0, n_ctx: 32768 }]) : err(400, 'model name is missing from the request');
    if (u.pathname === '/props' && q.method === 'GET') {
      st.props.push(q.url);
      if (!model) return send(200, { role: 'router', max_instances: 2, models_autoload: true, model_alias: 'llama-server', model_path: 'none', default_generation_settings: { params: {}, n_ctx: 0 }, build_info: 'b12230' });
      if (autoload === 'false' && st.status[model] !== 'loaded') return err(400, 'model is not loaded');
      return send(200, { default_generation_settings: { n_ctx: 32768 }, total_slots: 1, model_alias: model });
    }
    let b = ''; q.on('data', (d) => b += d); q.on('end', () => {
      let body = {}; try { body = JSON.parse(b); } catch (e) {}
      if (u.pathname === '/tokenize' || u.pathname === '/v1/tokenize') {
        st.tokenize.push({ url: q.url, model: body.model });
        if (!body.model) return err(400, 'model name is missing from the request');
        if (autoload === 'false' && st.status[body.model] !== 'loaded') return err(400, 'model is not loaded');
        return send(200, { tokens: Array.from({ length: Math.ceil(String(body.content || '').length / 3) }, () => 1) });
      }
      if (/chat\/completions/.test(u.pathname)) {
        const msgs = body.messages || [];
        const bad = msgs.some((m, i) => m && m.role === 'system' && i > 0);
        const user = [...msgs].reverse().find((m) => m.role === 'user') || {};
        st.chats.push({ model: body.model, roles: msgs.map((m) => m.role), bad, user: typeof user.content === 'string' ? user.content : JSON.stringify(user.content), at: Date.now() });
        if (st.mode === 'jinja' || bad) { st.violations += bad ? 1 : 0; return err(500, STRICT); }
        if (st.mode === 'loadtext') return err(500, 'request cancelled while waiting for model');
        resp.writeHead(200, { 'content-type': 'text/event-stream' });
        resp.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Ο πίνακας και το συνημμένο διαβάστηκαν.' }, finish_reason: 'stop' }], timings: { prompt_n: 900, prompt_ms: 120, predicted_n: 20, predicted_ms: 400 } }) + '\n\n');
        return resp.end('data: [DONE]\n\n');
      }
      send(404, { error: 'no' });
    });
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
const lastAssistant = (win) => win.evaluate(() => { const all = (Store.state.chat || []).filter((x) => x.role === 'assistant'); const m = all[all.length - 1]; const els = document.querySelectorAll('#as-msgs .as-msg.r-assistant'); const el = els[els.length - 1]; return m ? { content: m.content, error: !!m.error, notices: (m.notices || []).map((n) => n.text), cls: el ? el.className : '', color: el && el.querySelector('.bubble') ? getComputedStyle(el.querySelector('.bubble')).color : '' } : null; });

(async () => {
  const router = await startRouter();
  const { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(['2.6.9.1', '2.6.9.2', '2.6.9.3', '2.6.10', '2.6.10.1', '2.6.11', '2.6.11.1', '2.6.12', '2.6.12.1', '2.6.12.2'].includes(String(ver)), 'app version 2.6.9.1(+)', ver);
  await win.evaluate((a) => {
    Store.state.settings.theme = 'midnight'; Theme.apply(Store.state.settings);
    const A = Store.state.settings.ai; const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + a.port + '/v1';
    for (const k of ['commands', 'chat', 'vision', 'summarize']) A.tasks[k] = { p: 'llama', m: a.QWEN };
    Object.assign(A.servers.llama, { ctx: 32768, modelsDir: a.MODELS, port: a.port, model: '/x/llama-krikri-8b-instruct-q8_0.gguf' }); delete A.servers.llama.np;
    Object.assign(A.tts, { mode: 'system', exe: a.EXE, model: a.OMNI + '/omnivoice-base-Q8_0.gguf', tokenizer: a.OMNI + '/omnivoice-tokenizer-Q8_0.gguf' });
    A.assistant.thinking = false; A.assistant.canvasConfirm = true; A.assistant.attachReserve = 2048;
    Store.state.chat = [
      { role: 'user', content: 'Θέλω να οργανώσω τις σημειώσεις της συνάντησης.', at: Date.now() - 300000 },
      { role: 'assistant', content: 'Εντάξει, χωρίζουμε σε αποφάσεις και επόμενα βήματα.', at: Date.now() - 290000 },
      { role: 'user', content: 'Και ποιος κάνει τι;', at: Date.now() - 200000 },
      { role: 'assistant', content: 'Ορίζουμε υπεύθυνο σε κάθε βήμα.', at: Date.now() - 190000 },
    ];
    Store.save(); Assistant.show(); Assistant.render();
  }, { port: router.port, QWEN, MODELS, OMNI, EXE });

  // 1) Qwen strict template: history 2 turns + board + attachment → no 500
  await win.evaluate((p) => Att.add([p]), DOC);
  await win.waitForFunction(() => { const e = Att.list[0]; return e && e.state === 'ok' && e.tk && e.tk.src === 'measured'; }, null, { timeout: 20000 });
  const chip = await win.evaluate(() => document.querySelector('#as-att .at-chip')?.innerText || '');
  const budgetLine = await win.evaluate(() => { const b = Att.budget(); return { line: t('v2682.budget', { cap: b.cap, nctx: b.nCtx, base: b.histTok, reserve: b.reserve, margin: b.margin, src: b.source }), b }; });
  ok(/περιθώριο προτύπου 64/.test(budgetLine.line) && budgetLine.b.cap === budgetLine.b.nCtx - budgetLine.b.histTok - budgetLine.b.reserve - 64, 'chip budget line shows the 64 template margin explicitly', budgetLine);
  ok(router.st.tokenize.length === 1 && router.st.tokenize[0].model === QWEN && /autoload=false/.test(router.st.tokenize[0].url), 'attachment measured by /tokenize with the model in the body + autoload=false', router.st.tokenize);
  const before = router.st.chats.length;
  await win.evaluate(() => { document.querySelector('#as-q').value = 'Τι έχει ο πίνακας και τι λέει το συνημμένο;'; Assistant.send(); });
  await win.waitForFunction(() => !Assistant.busy && (Store.state.chat || []).filter((m) => m.role === 'assistant').length >= 3, null, { timeout: 30000 });
  const r1 = await lastAssistant(win);
  const sent = router.st.chats.slice(before);
  ok(r1 && !r1.error && /διαβάστηκαν/.test(r1.content), 'answer arrives (no 500)', r1);
  ok(sent.length >= 1 && sent.every((c) => !c.bad && c.roles.filter((r) => r === 'system').length <= 1 && c.roles.indexOf('system') <= 0) && sent[0].roles[0] === 'system' && sent[0].roles.filter((r) => r === 'system').length === 1, 'every request: at most one system message, at index 0 (the chat request has exactly one)', sent.map((c) => c.roles));
  ok(JSON.stringify(sent[0].roles) === JSON.stringify(['system', 'user', 'assistant', 'user', 'assistant', 'user']), 'history 2 turns + one current user message (the question is not sent twice with an attachment)', sent[0].roles);
  ok(sent[0].roles.length >= 6 && /<context>[\s\S]*Ενεργός πίνακας|<context>[\s\S]*πίνακας/i.test(sent[0].user) && /σημειώσεις\.txt|Πρακτικά συνάντησης/.test(sent[0].user) && /<\/context>$/.test(sent[0].user.trim()), 'history (2 turns) + attachment in the user message, board/date in <context> at its end', { roles: sent[0].roles, tail: sent[0].user.slice(-300) });
  ok(router.st.violations === 0, 'strict template saw no late system message', router.st.violations);

  // 2) any other 500 (Jinja) → stops at once, red error, nothing resent
  router.st.mode = 'jinja';
  const b2 = router.st.chats.length; const t2 = Date.now();
  await win.evaluate(() => { Store.state.chat = []; Assistant.render(); document.querySelector('#as-q').value = 'Φτιάξε μια κάρτα για αύριο'; Assistant.send(); });
  await win.waitForFunction(() => !Assistant.busy && (Store.state.chat || []).some((m) => m.role === 'assistant'), null, { timeout: 30000 });
  const r2 = await lastAssistant(win); const n2 = router.st.chats.length - b2;
  await sleep(2500);
  ok(r2 && r2.error && /System message must be at the beginning/.test(r2.content) && /\berr\b/.test(r2.cls), 'Jinja 500 → error shown in red with the router text', r2);
  ok(n2 <= 2 && router.st.chats.length - b2 === n2 && Date.now() - t2 < 12000, `stopped at once (${n2} request(s), none resent after)`, { n2, after: router.st.chats.length - b2 });

  // 3) loading text → visible k/N retries; Stop cuts them
  router.st.mode = 'loadtext';
  await win.evaluate(() => { Store.state.settings.ai.assistant.loadRetries = 10; Store.state.chat = []; Assistant.render(); document.querySelector('#as-q').value = 'Γεια'; Assistant.send(); });
  await win.waitForFunction(() => /επανάληψη \d+\/10/.test(document.querySelector('#as-msgs')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
  const live = await win.evaluate(() => document.querySelector('#as-msgs')?.innerText || '');
  ok(/φορτώνει το μοντέλο… επανάληψη \d+\/10/.test(live), 'visible «φορτώνει το μοντέλο… επανάληψη k/10»', live.slice(-200));
  await win.evaluate(() => Assistant.onSendClick());
  await win.waitForFunction(() => !Assistant.busy, null, { timeout: 10000 }).catch(() => {});
  await sleep(400); const n3 = router.st.chats.length; await sleep(2500);
  ok(router.st.chats.length === n3, 'Stop: no more resends after the click', { at: n3, after: router.st.chats.length });
  router.st.mode = 'ok';

  // 4) Hub: router ctx + tokenize trace, status numbers, TTS card, license, mmproj once, disk, router-mode labels, -np
  await win.evaluate(() => { try { Assistant.hide(); } catch (e) {} Hub.open(); });
  await win.waitForTimeout(500);
  await win.evaluate(() => document.querySelector('[data-hub-tab=status]')?.click());
  await win.waitForFunction(() => /φορτωμένα/.test(document.querySelector('[data-st=load-sub]')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
  await win.waitForFunction(() => document.querySelector('[data-st=vram-sub]')?.getAttribute('data-st-done') === '1', null, { timeout: 25000 }).catch(() => {});
  const st = await win.evaluate(() => ({ load: document.querySelector('[data-st=load]')?.textContent, sub: document.querySelector('[data-st=load-sub]')?.textContent, vram: document.querySelector('[data-st=vram-sub]')?.textContent, done: document.querySelector('[data-st=vram-sub]')?.getAttribute('data-st-done') }));
  ok(st.load === '1 / 2' && /φορτωμένα · μέγιστο 2 · 2 στον φάκελο/.test(st.sub) && !/--models-max/.test(st.sub), 'status: «1 / 2 φορτωμένα · μέγιστο 2 · 2 στον φάκελο» (2.6.12: no «--models-max» text)', st);
  ok(st.done === '1' && !/1,2|μέτρηση VRAM…/.test(st.vram), 'VRAM line painted after the real snapshot finished (no GPU on this Linux box → says so, not a 1,2 s cut)', st);
  await win.evaluate(() => document.querySelector('[data-hub-tab=engines]')?.click());
  await win.waitForTimeout(800);
  await win.evaluate(() => { const d = document.querySelector('details.hub-adv'); if (d) d.open = true; });
  await win.waitForFunction(() => !!document.querySelector('.hub-adv [data-trace]'), null, { timeout: 15000 }).catch(() => {});
  const eng = await win.evaluate(() => {
    const adv = document.querySelector('.hub-adv');
    const ctx = adv?.querySelector('[data-gvs-ctx]');
    const tr = adv?.querySelector('[data-trace]');
    const np = [...(adv?.querySelectorAll('input[data-np]') || [])][0];
    const tts = document.querySelector('[data-srv=tts]');
    return { ctx: ctx && ctx.getAttribute('data-gvs-ctx'), ctxTxt: ctx && ctx.textContent, trace: tr ? [...tr.querySelectorAll('div')].map((d) => d.textContent) : [], tok: tr?.querySelector('[data-tok]')?.textContent || '',
      na: !!adv?.querySelector('[data-na=router]'), naFit: adv?.querySelector('[data-na=router-fit]')?.textContent || '', np: np && np.value, npHelp: np && np.parentElement.querySelector('small')?.textContent,
      tts: tts && tts.innerText, ttsReady: tts && tts.getAttribute('data-tts-ready'), useBtn: !!tts?.querySelector('[data-act=use-omnivoice]') };
  });
  ok(eng.ctx === '32768', '«↻ Ανανέωση ctx» reads 32768 from the router (was «δεν διαβάστηκε ακόμα (—)»)', eng);
  ok(eng.trace.some((x) => /GET \/props → 200 role=router, n_ctx=0/.test(x)) && eng.trace.some((x) => /GET \/props\?model=Qwen3\.8-27B-UD-Q4_K_XL&autoload=false → 200 n_ctx=32768/.test(x)) && eng.trace.some((x) => /POST \/tokenize\?autoload=false \{model: Qwen3\.8-27B-UD-Q4_K_XL/.test(x)), 'Hub shows what was asked and what the router answered (/props, /props?model=, /tokenize)', eng.trace);
  ok(/μετρημένο/.test(eng.tok), '/tokenize line: measured', eng.tok);
  ok(eng.na && /δεν ισχύει/.test(eng.naFit), 'router mode: «Μοντέλο» and «μέγιστο που χωράει» say they do not apply', eng);
  ok(eng.np === '1' && /Τιμή εκκίνησης: 1/.test(eng.npHelp || ''), '-np shows 1 (launch value), not a placeholder', eng);
  ok(/OmniVoice/.test(eng.tts) && !/Φωνή Windows \(δεν χρειάζεται/.test(eng.tts) && eng.ttsReady === '1' && /exe ✓ · μοντέλο ✓ · tokenizer ✓/.test(eng.tts), '«Κείμενο → φωνή» shows OmniVoice with exe/μοντέλο/tokenizer ✓', eng.tts);
  ok(eng.useBtn && /Φωνή συστήματος/.test(eng.tts), 'mode still «system» → visible warning + «Χρήση OmniVoice» button (no silent change)', eng.tts);
  const modeBefore = await win.evaluate(() => Store.state.settings.ai.tts.mode);
  ok(modeBefore === 'system', 'the TTS setting was not changed by opening the Hub');
  await win.evaluate(() => document.querySelector('[data-hub-tab=models]')?.click());
  await win.waitForFunction(() => !!document.querySelector('[data-disk]'), null, { timeout: 15000 }).catch(() => {});
  const mdl = await win.evaluate(() => ({ disk: (() => { const d = document.querySelector('[data-disk]'); return d && (d.title || d.textContent); })(), gb: document.querySelector('[data-disk]')?.getAttribute('data-disk-gb'), mm: document.querySelectorAll('.hub-mmproj-note').length, lic: [...document.querySelectorAll('[data-model]')].map((e) => (e.closest('.hub-model') || e.parentElement).innerText) }));
  ok(mdl.gb === '2,0' && /δεκαδικά GB/.test(mdl.disk) && /\+/.test(mdl.disk), 'disk: 2,0 decimal GB = router models + OmniVoice models, unit stated', mdl.disk);
  ok(mdl.mm === 1, 'mmproj hint shown once', mdl.mm);
  ok(mdl.lic.some((x) => /Qwen3\.8-27B-UD-Q4_K_XL/.test(x) && /Apache-2\.0/.test(x)), 'Qwen3.8-27B-UD-Q4_K_XL → Apache-2.0', mdl.lic);

  await quit(app);
  router.srv.close();
  console.log(`\nv2.6.9.1 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
