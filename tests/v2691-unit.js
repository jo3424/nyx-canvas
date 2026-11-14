'use strict';
// v2.6.9.1 unit tests: one system message (strict Qwen-style Jinja check), load-retry only on a real load (limit, Stop),
// router b12230 /props + /tokenize behaviour (faithful to tools/server/server-models.cpp at tag b12230), Hub fixes (static).
const http = require('http');
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const P = require('../app/js/v2/prompt.js');
const L = require('../main/limits.js');
const ai = require('../main/ai.js');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 700) : '')); c ? passes++ : fails++; };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// Qwen3.x chat template on llama.cpp: raise_exception('System message must be at the beginning.') for a system at index > 0
const STRICT_MSG = 'Jinja Exception: System message must be at the beginning.';
const strictOk = (msgs) => !(msgs || []).some((m, i) => m && m.role === 'system' && i > 0);

console.log('one system message, first');
const hist = [
  { role: 'system', content: 'Earlier conversation (summary):\n- user: παλιό', digest: true },
  { role: 'user', content: 'γεια' }, { role: 'assistant', content: 'Γεια σου!' },
  { role: 'user', content: 'φτιάξε μια λίστα' }, { role: 'assistant', content: 'Έτοιμη.' },
];
const att = 'Τι λέει;\n\n[Συνημμένο: έκθεση.txt]\n' + 'κείμενο '.repeat(50);
const mk = (board) => P.wireMessages(P.assembleMessages({ instructions: 'INST', extra: '', toolsText: '- search_cards(): find', history: hist, user: att, boardBody: board, includeBoard: true, now: 'Now: Σάββατο 14/11/2026 16:00 (Europe/Athens)' }));
const a = mk('Active board: «Work».\nCards: 2'), b = mk('Active board: «Work».\nCards: 99');
ok(strictOk(a) && a[0].role === 'system' && a.filter((m) => m.role === 'system').length === 1, 'history ≥2 turns + digest + board + attachment → exactly one system, at index 0', a.map((m) => m.role));
const last = a[a.length - 1];
ok(last.role === 'user' && last.content.startsWith(att) && /<context>\n[\s\S]*summary[\s\S]*Cards: 2[\s\S]*Now:[\s\S]*<\/context>$/.test(last.content), 'digest, board, date are in <context> at the end of the LAST user message', last.content.slice(-260));
ok(JSON.stringify(a.slice(0, -1)) === JSON.stringify(b.slice(0, -1)), 'everything before the last user message is byte-identical when the board changes (stable cache prefix)');
ok(P.prefixBeforeBoard(a) === P.prefixBeforeBoard(b) && !P.prefixBeforeBoard(a).includes('Cards:'), 'prefixBeforeBoard excludes the <context> message');
ok(P.stripContext(last.content) === att, 'stripContext gives back the user text');
const g = L.oneSystem([{ role: 'system', content: 'S' }, { role: 'user', content: 'u1' }, { role: 'system', content: 'late board' }, { role: 'assistant', content: 'a' }, { role: 'user', content: [{ type: 'text', text: 'img' }] }, { role: 'system', content: 'late date' }]);
ok(strictOk(g) && g[g.length - 1].content.length === 2 && /late board[\s\S]*late date/.test(g[g.length - 1].content[1].text), 'main guard: late system messages → <context> on the last user message (array content too)', g);
const same = [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }];
ok(L.oneSystem(same) === same, 'main guard is a no-op for a correct list');
ok(/limits\.oneSystem\(reqBody\.messages\)/.test(read('main/ai.js')) && /limits\.oneSystem\(body\.messages\)/.test(read('main/ai.js')), 'guard applied to chat and chatStream bodies');
ok(/NyxPrompt\.assembleMessages\(\{ instructions: t\('v25\.pv_system'\)/.test(read('app/js/v25/core.js')), 'private mode uses the same assembly (its digest was a late system message too)');

console.log('500 is not «loading» by itself');
ok(!ai.isLoadCancel({ status: 500, detail: STRICT_MSG }), 'Jinja 500 → not a load');
ok(!ai.isLoadCancel({ status: 500, detail: 'Internal error' }), 'plain 500 without load text → not a load (checked against /v1/models instead)');
ok(ai.isLoadCancel({ status: 500, detail: 'request cancelled while waiting for model' }) && ai.isLoadCancel({ status: 503, detail: 'Loading model' }), 'load texts → load');
ok(!ai.isLoadCancel({ status: 400, detail: 'request cancelled by a stop while the model was loading' }), 'a user stop is not a load');
ok(ai.isTemplateError({ detail: STRICT_MSG }) && ai.LOAD_RETRY_DEFAULT === 10 && ai.loadRetryMax({ loadRetries: 3 }) === 3 && ai.loadRetryMax({}) === 10, 'template detection; retry limit default 10, settable');
ok(ai.entryLoading({ id: 'x', loaded: false }) === null && ai.entryLoading({ id: 'x', status: { value: 'unloaded' } }) === null && ai.entryLoading({ id: 'x', status: { value: 'sleeping' } }) === null, 'unloaded / sleeping / loaded:false = idle, never «loading» (no endless wait)');
const e1 = ai.routerEntry({ id: 'Qwen3.8-27B-UD-Q4_K_XL', status: { value: 'loaded', args: ['llama-server', '-c', '32768', '-np', '1'] }, context_length: 262144 });
ok(e1.state === 'loaded' && e1.loaded === true && e1.ctxArg === 32768 && e1.ctxTrain === 262144 && !e1.nCtx, 'router /v1/models entry keeps status, -c from args, train length NOT taken as n_ctx', e1);
ok(ai.argCtx(['--ctx-size=16384']) === 16384, '--ctx-size=N parsed');

// faithful fake of llama-server b12230 router mode (tools/server/server-models.cpp): bare GET /props → role=router, n_ctx 0;
// GET with ?model= → validate + proxy (autoload=false + not running → 400 «model is not loaded»); POST reads «model» from the
// body only («model name is missing from the request»). Child chat: strict Qwen template.
function startRouter(opt = {}) {
  const st = { chats: 0, tokenize: [], props: [], status: opt.status || { Q: 'loaded', K: 'unloaded' }, mode: opt.mode || 'ok', loadingFor: opt.loadingFor || 0 };
  const srv = http.createServer((q, res) => {
    const send = (c, o) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    const u = new URL(q.url, 'http://x'); const model = u.searchParams.get('model'); const autoload = u.searchParams.get('autoload');
    const err = (c, m) => send(c, { error: { code: c, message: m, type: c === 400 ? 'invalid_request_error' : 'server_error' } });
    if ((u.pathname === '/v1/models' || u.pathname === '/models') && st.loadingFor > 0 && st.chats > 0) { st.loadingFor--; if (!st.loadingFor) for (const k of Object.keys(st.status)) if (st.status[k] === 'loading') st.status[k] = 'loaded'; }
    if (u.pathname === '/v1/models' || u.pathname === '/models') return send(200, { object: 'list', data: Object.entries(st.status).map(([id, v]) => ({ id, object: 'model', owned_by: 'llamacpp', status: { value: v, args: ['llama-server', '-c', '32768', '-np', '1'] }, context_length: 262144 })) });
    if (u.pathname === '/props' && q.method === 'GET') {
      st.props.push(q.url);
      if (!model) return send(200, { role: 'router', max_instances: 2, models_autoload: true, model_alias: 'llama-server', model_path: 'none', default_generation_settings: { params: {}, n_ctx: 0 }, build_info: 'b12230' });
      if (!(model in st.status)) return err(400, `model '${model}' not found`);
      if (autoload === 'false' && st.status[model] !== 'loaded') return err(400, 'model is not loaded');
      return send(200, { default_generation_settings: { n_ctx: 32768 }, total_slots: 1, model_alias: model });
    }
    let b = ''; q.on('data', (d) => b += d); q.on('end', () => {
      let j = {}; try { j = JSON.parse(b); } catch (e) {}
      if (u.pathname === '/tokenize') {
        st.tokenize.push({ url: q.url, body: j });
        if (!j.model) return err(400, 'model name is missing from the request');
        if (autoload === 'false' && st.status[j.model] !== 'loaded') return err(400, 'model is not loaded');
        return send(200, { tokens: Array.from({ length: Math.ceil(String(j.content || '').length / 3) }, () => 1) });
      }
      if (/chat\/completions/.test(u.pathname)) {
        st.chats++;
        if (st.flip && st.status[j.model] === 'unloaded') st.status[j.model] = 'loading';
        if (st.mode === 'plain500') return err(500, 'Internal Server Error');
        if (st.mode === 'loadtext') return err(500, 'request cancelled while waiting for model');
        if (st.status[j.model] === 'loading') return err(500, 'Internal Server Error');
        if (!strictOk(j.messages)) return err(500, STRICT_MSG);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }) + '\n\n');
        return res.end('data: [DONE]\n\n');
      }
      send(404, { error: 'no' });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, st, p: { id: 'llama', kind: 'local', base: 'http://127.0.0.1:' + srv.address().port + '/v1' } })));
}
const oldMsgs = [{ role: 'system', content: 'INST' }, { role: 'user', content: 'γεια' }, { role: 'assistant', content: 'γεια' }, { role: 'system', content: 'Active board' }, { role: 'system', content: 'Now: …' }, { role: 'user', content: att }];

(async () => {
  console.log('load-retry against a b12230-faithful router');
  {
    const R = await startRouter();
    const r = await ai.chatStream(R.p, { model: 'Q', messages: a }, {});
    ok(r.message.content === 'OK' && R.st.chats === 1, 'strict template + 2.6.9.1 messages (history, digest, board, attachment) → 200, no 500', R.st.chats);
    // old (2.6.9) layout would 500; the main guard still fixes it at the wire
    const r2 = await ai.chatStream(R.p, { model: 'Q', messages: oldMsgs }, {});
    ok(r2.message.content === 'OK' && R.st.chats === 2, 'even a 2.6.9-style list (late system) is normalised in main → no 500');
    // a raw request that bypasses the guard really gets the Jinja 500 and is NOT retried
    const t0 = Date.now(); let notices = [];
    const e = await ai.withLoadRetry(R.p, { model: 'Q' }, () => ai.jfetch(R.p.base + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'Q', messages: oldMsgs }) }), { onStatus: (k, m) => notices.push(m) }).then(() => null, (x) => x);
    ok(e && /System message must be at the beginning/.test(e.message) && R.st.chats === 3 && !notices.length && Date.now() - t0 < 1500, 'Jinja 500 → one request, thrown at once with the server text, no «loading» notice', { m: e && e.message, chats: R.st.chats, notices });
    R.srv.close();
  }
  {
    const R = await startRouter({ mode: 'plain500' });
    const e = await ai.chatStream(R.p, { model: 'Q', messages: a }, {}).then(() => null, (x) => x);
    ok(e && R.st.chats === 1, 'plain 500 while /v1/models says «loaded» → stops after one request', { chats: R.st.chats, m: e && e.message });
    R.srv.close();
  }
  {
    const R = await startRouter({ status: { Q: 'unloaded' }, loadingFor: 4 });
    R.st.status.Q = 'unloaded'; const origChats = () => R.st.chats; R.st.flip = true;
    const notices = [];
    const r = await ai.chatStream(R.p, { model: 'Q', messages: a, onStatus: (k, m) => notices.push(m) }, { onStatus: (k, m) => notices.push(m) });
    ok(r.message.content === 'OK' && R.st.chats >= 2, 'plain 500 while /v1/models says «loading» → retried until loaded', R.st.chats);
    ok(notices.some((n) => /επανάληψη 1\/10/.test(n)), 'visible «επανάληψη k/10» notice', notices);
    R.srv.close();
  }
  {
    const R = await startRouter({ mode: 'loadtext' });
    const e = await ai.chatStream(R.p, { model: 'Q', messages: a, loadRetries: 3 }, {}).then(() => null, (x) => x);
    ok(e && e.code === 'LOADRETRY' && R.st.chats === 4 && /3 επαναλήψεις|3 retries/.test(e.message), 'retry limit (3) → 1 + 3 requests, then a visible error', { chats: R.st.chats, m: e && e.message });
    R.srv.close();
  }
  {
    const R = await startRouter({ mode: 'loadtext' });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 1200);
    const t0 = Date.now();
    const e = await ai.chatStream(R.p, { model: 'Q', messages: a, loadRetries: 50, signal: ctrl.signal }, { signal: ctrl.signal }).then(() => null, (x) => x);
    const n = R.st.chats; await new Promise((r) => setTimeout(r, 1800));
    ok(e && e.code === 'ABORTED' && Date.now() - t0 < 3500 && R.st.chats === n, 'Stop (abort) ends the retries at once; nothing is resent afterwards', { code: e && e.code, chats: n, after: R.st.chats });
    R.srv.close();
  }
  ok(/try \{ AI\.abort\(\); \} catch/.test(read('app/js/v25/agent.js')), 'the agent Stop button also aborts the request in main (it only ended the UI wait before)');

  console.log('ctx and /tokenize on the router');
  {
    const R = await startRouter({ status: { Q: 'loaded', K: 'unloaded' } });
    const c = await ai.contextInfo(R.p, { model: 'Q', probe: true, timeout: 800 });
    ok(c.n_ctx === 32768 && c.router && c.source === 'props_model' && c.model === 'Q', 'probe: bare /props = router (n_ctx 0) → /props?model=<loaded>&autoload=false → 32768', c);
    ok(R.st.props.includes('/props') && R.st.props.includes('/props?model=Q&autoload=false'), 'requests: GET /props, GET /props?model=Q&autoload=false', R.st.props);
    ok(c.trace.length >= 3 && c.trace.some((x) => /role=router, n_ctx=0/.test(x.ans)) && c.trace.some((x) => x.ans === 'n_ctx=32768'), 'trace shows what was asked and answered', c.trace);
    const c2 = await ai.contextInfo(R.p, { model: 'K', probe: true, timeout: 800 });
    ok(c2.n_ctx === 32768 && c2.model === 'Q' && !R.st.props.some((x) => /model=K/.test(x)), 'task model not loaded → asks a loaded one, never the unloaded one (no load started)', { c2: c2.model, props: R.st.props });
    R.st.status = { Q: 'unloaded', K: 'unloaded' };
    const c3 = await ai.contextInfo(R.p, { model: 'Q', probe: true, timeout: 800 });
    ok(c3.n_ctx == null && c3.router && c3.configured === 32768 && c3.warnings.some((w) => w.code === 'router_none_loaded'), 'nothing loaded → no n_ctx, says so, shows -c 32768 from the args (not as a measurement)', c3);
    const t1 = await ai.tokenize(R.p, 'κείμενο', { model: 'Q', onlyIfLoaded: true });
    ok(t1.skipped === 'not_loaded' && t1.state === 'unloaded' && R.st.tokenize.length === 0, 'tokenize: unloaded → skipped with the state, no request', t1);
    R.st.status.Q = 'loaded';
    const t2 = await ai.tokenize(R.p, 'κείμενο κείμενο', { model: 'Q', onlyIfLoaded: true });
    ok(t2.count === 5 && R.st.tokenize[0].body.model === 'Q' && R.st.tokenize[0].url === '/tokenize?autoload=false', 'tokenize: loaded → model in the body + ?autoload=false → measured', { t2, req: R.st.tokenize });
    const t3 = await ai.tokenize(R.p, 'x', {}).then(() => null, (e) => e);
    ok(t3 && /model name is missing/.test(t3.message), 'tokenize without a model on the router → 400 «model name is missing from the request»', t3 && t3.message);
    R.srv.close();
  }

  console.log('attachment budget arithmetic (the 24165 of the chip)');
  ok(32768 - 6491 - 2048 === 24229 && 32768 - 6491 - 2048 - 64 === 24165, '32768 − 6491 − 2048 − 64 (template margin) = 24165');
  const el = JSON.parse(read('app/locales/el.json')), en = JSON.parse(read('app/locales/en.json'));
  ok(/περιθώριο προτύπου \{margin\}/.test(el['v2682.budget']) && /template margin \{margin\}/.test(en['v2682.budget']) && /const margin = 64;/.test(read('app/js/v25/attach.js')), 'the 64 margin is shown on the chip line');

  console.log('Hub (static)');
  const ht = read('app/js/v2/hub-tabs.js'), hb = read('app/js/v2/hub.js');
  ok(!/t\('v267\.available'\)/.test(ht) && /v2691\.stat_loaded_of/.test(ht), '«N / max διαθέσιμα» gone; loaded / --models-max');
  ok(/raceMs\(API\.inv\('perf:snapshot'\), 20000/.test(ht) && !/raceMs\(API\.inv\('perf:snapshot'\), 1200/.test(ht), 'VRAM snapshot no longer cut at 1,2 s');
  ok((ht.match(/v268\.mmproj_card/g) || []).length === 1, 'mmproj hint once');
  ok(/'data-tts-engine': 'omnivoice'/.test(ht) && !/t\('v267\.tts_system'\)/.test(ht), 'TTS card = OmniVoice (no «Φωνή Windows» card)');
  ok(/qwen3\\\.8-27b/.test(ht) && /Apache-2\.0/.test(ht), 'Qwen3.8-27B → Apache-2.0');
  ok(/disk \/ 1e9/.test(ht) && /ttsDir/.test(ht), 'disk in decimal GB, router models + OmniVoice models');
  ok(/v2691\.na_router_model/.test(ht) && /v2691\.na_router_fit/.test(hb), 'router mode: «Μοντέλο» and «μέγιστο που χωράει» marked not applicable');
  ok(/data-np/.test(ht), '-np shows the launch value');
  ok(/v2691\.trace_title/.test(hb), 'Hub shows the router trace');
  for (const k of Object.keys(el).filter((k) => k.startsWith('v2691.'))) if (!en[k]) ok(false, 'en key ' + k);
  ok(Object.keys(el).filter((k) => k.startsWith('v2691.')).length >= 30, 'el/en strings present');

  const pkg = require('../package.json');
  ok(pkg.version === '2.6.9.1' && pkg.devDependencies.electron === '45.2.3', 'version 2.6.9.1, Electron 45.2.3', pkg.version);
  const CH = require('../CHANGELOG.json'); ok(Object.keys(CH)[0] === '2.6.9.1' && CH['2.6.9.1'].el.length === 3 && CH['2.6.9.1'].en.length === 3, 'CHANGELOG 2.6.9.1 first, 3 deliverables');
  console.log(`\nv2.6.9.1 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
