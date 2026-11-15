'use strict';
// v2.6.9 unit tests: dates/amounts computed by code (never by the model), thinking cap that stops the stream and never
// leaves an empty answer, tool-call 500 (Krikri «peg-native») no longer retried forever, MTP / t/s / VRAM helpers.
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const R = path.join(__dirname, '..');
const pkg = require('../package.json');
const el = require('../app/locales/el.json');
const en = require('../app/locales/en.json');
const C = require('../app/js/v26/calc.js');
const ai = require('../main/ai');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 800) : '')); c ? passes++ : fails++; };
const NOW = new Date('2026-11-13T15:00:00Z'); // Παρασκευή 13/11/2026, 17:00 Europe/Athens

(async () => {
  ok(pkg.version === '2.6.9' || (pkg.version.startsWith('2.6.9.') || pkg.version.startsWith('2.6.10') || pkg.version.startsWith('2.6.11')), 'package.json version 2.6.9(+)', pkg.version);
  ok(pkg.devDependencies && /45\.2\.3/.test(pkg.devDependencies.electron || ''), 'Electron stays 45.2.3', pkg.devDependencies && pkg.devDependencies.electron);
  const CH = require('../CHANGELOG.json'); ok(['2.6.9', '2.6.9.1', '2.6.9.2', '2.6.9.3', '2.6.10', '2.6.10.1', '2.6.11'].includes(Object.keys(CH)[0]) && CH['2.6.9'].el.length === 3 && CH['2.6.9'].en.length === 3, 'CHANGELOG 2.6.9 first, 3 deliverables (el/en)');

  // ---- 1) dates: the evidence phrases ----
  const d45 = C.resolveDate('σε 45 μέρες', { now: NOW });
  ok(d45.ok && d45.date === '2026-12-28' && d45.weekday_el === 'Δευτέρα' && d45.days_from_today === 45, '«σε 45 μέρες» → Δευτέρα 28/12/2026 (45 days)', d45);
  const tue = C.resolveDate('Τρίτη 17/11', { now: NOW });
  ok(tue.ok && tue.dmy === '17/11/2026' && tue.weekday === 2 && !tue.notes.some((n) => /mismatch/.test(n)), '«Τρίτη 17/11» → Τρίτη 17/11/2026, weekday checked', tue);
  const bad = C.resolveDate('Δευτέρα 17/11', { now: NOW });
  ok(bad.ok && bad.weekday_el === 'Τρίτη' && bad.notes.some((n) => n === 'weekday_mismatch:Δευτέρα→Τρίτη'), 'wrong weekday is reported, the real one is returned', bad);
  ok(C.resolveDate('Τρίτη', { now: NOW }).date === '2026-11-17', '«Τρίτη» alone → next Tuesday 17/11');
  ok(C.resolveDate('αύριο στις 9:30', { now: NOW }).iso === '2026-11-14T07:30:00.000Z', '«αύριο στις 9:30» → 14/11 09:30 Athens (07:30Z)');
  ok(C.resolveDate('σε 2 ώρες', { now: NOW }).time === '19:00', '«σε 2 ώρες» → 19:00');
  ok(C.resolveDate('5/1', { now: NOW }).date === '2027-01-05' && C.resolveDate('5/1', { now: NOW }).notes.includes('year_next'), 'past DD/MM → next year, with a note');
  ok(C.resolveDate('31/01', { now: new Date('2027-01-10T10:00:00Z') }).date === '2027-01-31', 'DD/MM later this year stays this year');
  const m1 = C.resolveDate('σε 1 μήνα', { now: new Date('2027-01-31T10:00:00Z') });
  ok(m1.date === '2027-02-28' && m1.notes.includes('month_end:31'), '31/1 + 1 month → 28/2 with a month-end note', m1);
  ok(C.resolveDate('σε 3 εβδομάδες', { now: NOW }).date === '2026-12-04', '«σε 3 εβδομάδες» → 04/12');
  ok(C.resolveDate('17 Νοεμβρίου', { now: NOW }).date === '2026-11-17', '«17 Νοεμβρίου» → 17/11/2026');
  ok(C.resolveDate('in 10 days', { now: NOW }).date === '2026-11-23', 'English «in 10 days»');
  ok(C.resolveDate('πριν 3 μέρες', { now: NOW }).date === '2026-11-10', '«πριν 3 μέρες» → 10/11');
  // DST: Athens leaves summer time on 25/10/2026 — calendar days never drift
  const dst = C.resolveDate('αύριο στις 10:00', { now: new Date('2026-10-24T12:00:00Z') });
  ok(dst.date === '2026-10-25' && dst.iso === '2026-10-25T08:00:00.000Z', 'DST change day: 25/10 10:00 Athens = 08:00Z (UTC+2)', dst);
  ok(C.resolveDate('σε 1 μέρα', { now: new Date('2026-10-24T22:30:00Z') }).date === '2026-10-26', 'date is taken in Athens (00:30 on 25/10) not UTC');
  const nope = C.resolveDate('κάποια στιγμή', { now: NOW });
  ok(!nope.ok && nope.error === 'not_understood', 'unknown phrase → ok:false, never a made-up date', nope);
  ok(!C.resolveDate('31/02', { now: NOW }).ok, '31/02 → invalid, not rolled to March');
  ok(C.toInstant('2026-12-24T18:00:00+02:00').toISOString() === '2026-12-24T16:00:00.000Z' && C.toInstant('σε 45 μέρες', { now: NOW }).toISOString() === '2026-12-28T07:00:00.000Z' && C.toInstant('κάτι', { now: NOW }) === null, 'toInstant: ISO kept, phrase resolved (09:00 Athens), unknown → null');

  // ---- 1) amounts: exact cents ----
  const sp = C.money({ op: 'split', total: '1640€', parts: 3 });
  const sumC = sp.parts.reduce((a, p) => a + Math.round(p.amount * 100), 0);
  ok(sp.ok && sumC === 164000 && sp.parts.map((p) => p.text).join('|') === '546,67 €|546,67 €|546,66 €', '1640€ / 3 → 546,67 + 546,67 + 546,66 = 1.640,00 € exactly', sp);
  const w = C.money({ op: 'split', total: '1.640,00', weights: [2, 1, 1], names: ['Γιάννης', 'Μαρία', 'Νίκος'] });
  ok(w.ok && w.parts[0].text === '820,00 €' && w.parts[0].name === 'Γιάννης' && w.check === '1.640,00 €', 'weighted split with names', w);
  const odd = C.money({ op: 'split', total: '100', parts: 7 }); ok(odd.parts.reduce((a, p) => a + Math.round(p.amount * 100), 0) === 10000, '100 / 7 adds up to 100,00 exactly', odd.parts.map((p) => p.text));
  ok(C.money({ op: 'percent', total: '1640', percent: 24 }).text === '393,60 €' && C.money({ op: 'percent', total: '1640', percent: 24 }).plus === '2.033,60 €', '24% of 1640 = 393,60 € (total 2.033,60 €)');
  ok(C.money({ op: 'sum', items: ['12,50', '7,30', '1.200'] }).text === '1.219,80 €', 'sum with Greek decimals/thousands');
  ok(C.money({ op: 'arith', expr: '(120+80)*1,24' }).value === 248 && !C.money({ op: 'arith', expr: '1/0' }).ok && !C.money({ op: 'arith', expr: 'process.exit()' }).ok, 'safe arithmetic (no eval): 248, /0 and code rejected');
  ok(C.parseAmount('1.640') === 164000 && C.parseAmount('12,5') === 1250 && C.parseAmount('1,640.50') === 164050 && C.parseAmount('abc') === null, 'parseAmount: 1.640 / 12,5 / 1,640.50 / abc');
  ok(!C.money({ op: 'split', total: 'xyz', parts: 2 }).ok, 'bad total → ok:false');
  ok(C.needsCalc('μοίρασε 1640€ σε 3') && C.needsCalc('τι μέρα πέφτει σε 45 μέρες') && !C.needsCalc('πες μου ένα ανέκδοτο') && !C.needsCalc('γράψε ένα ποίημα για τη θάλασσα'), 'needsCalc: date/amount questions go to the tools model, plain talk does not');

  // ---- assistant wiring (source checks) ----
  const asSrc = fs.readFileSync(path.join(R, 'app/js/v2/assistant.js'), 'utf8');
  ok(/date_calc:\s*\{/.test(asSrc) && /money_calc:\s*\{/.test(asSrc) && /NyxCalc\.toInstant\(a\.date/.test(asSrc), 'assistant has date_calc / money_calc tools; reminder dates go through NyxCalc');
  ok(!/WRITE: new Set\([^)]*(date_calc|money_calc)/.test(asSrc), 'calc tools are read-only (not in WRITE → never touch the canvas)');
  ok(/date_calc/.test(el['v266.sys_instructions']) && !/δώσε ISO/.test(el['v266.sys_instructions']) && /date_calc/.test(en['v266.sys_instructions']), 'system prompt tells the model to call the tools instead of computing');
  ok(fs.readFileSync(path.join(R, 'app/index.html'), 'utf8').includes('js/v26/calc.js'), 'calc.js loaded in index.html');

  // ---- 3) tool-call 500 (Krikri) is not a model load ----
  const peg = Object.assign(new Error('HTTP 500: Failed to parse input at pos 12: does not match the expected peg-native format'), { status: 500 });
  ok(ai.isToolFormatError(peg) && !ai.isLoadCancel(peg), 'peg-native 500 → tool-format error, not «loading model»');
  ok(ai.isLoadCancel(Object.assign(new Error('request cancelled while waiting for model'), { status: 500 })), 'real load cancel still retried');
  let runs = 0; let thrown = null;
  const t0 = Date.now();
  try { await ai.withLoadRetry({ kind: 'local', base: 'http://127.0.0.1:1/v1' }, { model: 'llama-krikri-8b-instruct-q8_0', tools: [{ type: 'function', function: { name: 'x' } }] }, async () => { runs++; throw peg; }); } catch (e) { thrown = e; }
  ok(runs === 1 && thrown && thrown.code === 'NOTOOLS' && thrown.toolModel === 'llama-krikri-8b-instruct-q8_0' && Date.now() - t0 < 500, 'withLoadRetry stops at once with NOTOOLS (was an endless loop)', { runs, code: thrown && thrown.code });

  // ---- 2) thinking cap at the stream level (mock llama-server SSE) ----
  const seen = { closed: 0, sent: 0, bodies: [] };
  const srv = http.createServer((q, resp) => {
    let b = ''; q.on('data', (d) => b += d); q.on('end', () => {
      const body = JSON.parse(b || '{}'); seen.bodies.push(body);
      resp.writeHead(200, { 'content-type': 'text/event-stream' });
      const mode = body.messages[0].content;
      let i = 0; const N = 400;
      const tick = () => {
        if (resp.writableEnded || resp.destroyed) return;
        if (mode === 'answer-early' && i === 5) { resp.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Γεια!' } }] }) + '\n\n'); }
        if (i >= N) { resp.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], timings: { predicted_n: N, predicted_ms: 5000, draft_n: 120, draft_n_accepted: 90 } }) + '\n\n'); return resp.end('data: [DONE]\n\n'); }
        seen.sent++; resp.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'σκέψη ' + i + ' ' } }] }) + '\n\n'); i++;
        setTimeout(tick, 1);
      };
      resp.on('close', () => { if (!resp.writableEnded) seen.closed++; });
      tick();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const P = { id: 'llama', kind: 'local', base: 'http://127.0.0.1:' + srv.address().port + '/v1' };
  const deltas = [];
  const r1 = await ai.chatStream(P, { messages: [{ role: 'user', content: 'think-forever' }], think_cap: 64, chat_template_kwargs: { enable_thinking: true } }, { onDelta: (e) => deltas.push(e) });
  await new Promise((r) => setTimeout(r, 100));
  ok(r1.finish === 'think_cap' && r1.reasoning_n === 64 && !r1.message.content, 'cap 64: stream stops at 64 thinking tokens, finish think_cap', { finish: r1.finish, n: r1.reasoning_n });
  ok(seen.closed === 1 && seen.sent < 400, 'connection closed → the server stops generating (sent ' + seen.sent + ' of 400)', seen.closed);
  ok(!('think_cap' in seen.bodies[0]), 'think_cap is never sent to the server');
  ok(deltas.some((d) => d.type === 'delta' && d.reasoning && d.reasoning_n > 0 && d.text === ''), 'thinking streams to the UI live (reasoning-only deltas)');
  const r2 = await ai.chatStream(P, { messages: [{ role: 'user', content: 'answer-early' }], think_cap: 64 }, {});
  ok(r2.finish === 'stop' && r2.message.content === 'Γεια!', 'once the answer has started the cap does not cut it', { finish: r2.finish });
  const r3 = await ai.chatStream(P, { messages: [{ role: 'user', content: 'no-cap' }] }, {});
  ok(r3.finish === 'stop' && r3.reasoning_n === 400 && r3.timings.draft_n === 120, 'no cap (0) → nothing is cut', { finish: r3.finish, n: r3.reasoning_n });
  srv.close();
  ok(ai.openThinkInContent('<think>abc') && !ai.openThinkInContent('<think>a</think>ok'), 'unclosed <think> in content counts as thinking');

  // ---- 2) renderer chatTurn: re-ask without thinking, never empty (core.js in a VM, IPC stubbed) ----
  const coreSrc = fs.readFileSync(path.join(R, 'app/js/v2/core.js'), 'utf8');
  const grab = (name) => { const i = coreSrc.indexOf(name); if (i < 0) throw new Error('missing ' + name); return i; };
  const limitsSrc = coreSrc.slice(grab('const NyxLimits = {'), grab('function stripThink(s, r)'));
  const turnSrc = coreSrc.slice(grab('function newStreamId()'), grab('\nfunction parseJsonLoose'));
  function runTurn(script, settings) {
    const calls = []; const notices = [];
    const mem = {};
    const ctx = {
      console, Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, setTimeout,
      t: (k, v) => { let s = el[k] || k; for (const [a, b] of Object.entries(v || {})) s = s.split('{' + a + '}').join(String(b)); return s; },
      cleanErr: (e) => String((e && e.message) || e),
      localStorage: { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = String(v); } },
      Store: { state: { settings: { ai: { assistant: { thinking: true, thinkingBudget: 512, maxContinue: 8, ...(settings || {}) } } } } },
      AI: { lastTimings: null, prepare: async (p, m, o) => ({ n_ctx: 32768, max_tokens: 4096, body: { max_tokens: 4096, chat_template_kwargs: { enable_thinking: !!o.thinking } } }), markBlocked() {}, noteRequest() {} },
      API: { inv: async (ch, p, body) => { calls.push(body); const step = script[calls.length - 1] || script[script.length - 1]; return typeof step === 'function' ? step(body) : step; } },
    };
    vm.createContext(ctx);
    vm.runInContext(limitsSrc + '\n' + turnSrc + '\nthis.NyxLimits = NyxLimits; this.chatTurn = chatTurn;', ctx);
    return { ctx, calls, notices, run: (body) => ctx.chatTurn({ id: 'llama' }, { model: 'qwen3.6-35b', messages: [{ role: 'user', content: 'Γεια' }], stream: false, ...(body || {}) }, (k, m) => notices.push([k, m])) };
  }
  // the 12–13/11 evidence: thinking used the budget, no answer
  let h = runTurn([{ message: { content: '', reasoning_content: 'σκέφτομαι…'.repeat(50) }, finish: 'think_cap', reasoning_n: 512 }, { message: { content: 'Η απάντηση.' }, finish: 'stop' }]);
  let res = await h.run();
  ok(res.message.content === 'Η απάντηση.' && res.thinkCapHit && res.retriedNoThink, 'cap hit → asked again without thinking → real answer', res.message);
  ok(h.calls.length === 2 && h.calls[0].think_cap === 512 && h.calls[0].chat_template_kwargs.enable_thinking === true && h.calls[1].chat_template_kwargs.enable_thinking === false && !('think_cap' in h.calls[1]), '2nd request has thinking off and no cap', h.calls.map((c) => [c.think_cap, c.chat_template_kwargs]));
  ok(h.notices.some(([k, m]) => k === 'warn' && m === 'Η σκέψη έφτασε το όριο των 512 tokens — ζητάω την απάντηση χωρίς σκέψη.'), 'visible notice «Η σκέψη έφτασε το όριο…»', h.notices);
  ok(h.ctx.Store.state.settings.ai.assistant.thinking === true && h.ctx.Store.state.settings.ai.assistant.thinkingBudget === 512, 'settings untouched (thinking stays on, cap stays 512)');
  // only thinking, finish=length (no cap set)
  h = runTurn([{ message: { content: '<think>πολύ σκέψη', reasoning_content: '' }, finish: 'length' }, { message: { content: 'ΟΚ' }, finish: 'stop' }], { thinkingBudget: 0 });
  res = await h.run();
  ok(res.message.content === 'ΟΚ' && h.calls.length === 2 && !('think_cap' in h.calls[0]) && h.notices.some(([k, m]) => /μόνο σκέψη χωρίς απάντηση \(κόπηκε στο όριο απάντησης\)/.test(m)), 'thinking hit the answer limit → re-ask without thinking, notice says why', h.notices);
  // still empty without thinking → visible notice + raw, never silent
  h = runTurn([{ message: { content: '', reasoning_content: 'σκέψη' }, finish: 'stop' }, { message: { content: '' }, finish: 'stop' }]);
  res = await h.run();
  ok(h.calls.length === 2 && res.emptyFinal && res.emptyAfterClean && h.notices.some(([k, m]) => k === 'warn' && /δεν έδωσε απάντηση ούτε χωρίς σκέψη/.test(m)), 'empty even without thinking → «δεν έδωσε απάντηση» notice + raw, no third try', h.notices);
  // thinking off: no retry loop
  h = runTurn([{ message: { content: '' }, finish: 'stop' }], { thinking: false });
  res = await h.run();
  ok(h.calls.length === 1 && res.emptyFinal, 'thinking off + empty → one request, visible notice');
  // normal answer: untouched
  h = runTurn([{ message: { content: 'Καλησπέρα', reasoning_content: 'λίγη σκέψη' }, finish: 'stop' }]);
  res = await h.run();
  ok(h.calls.length === 1 && res.message.content === 'Καλησπέρα' && !res.retriedNoThink && res.reasoning === 'λίγη σκέψη', 'answer with thinking within the cap → no retry');
  // tool calls remembered for the Hub warning
  h = runTurn([{ message: { content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'date_calc', arguments: '{"expr":"σε 45 μέρες"}' } }] }, finish: 'tool_calls' }]);
  res = await h.run({ tools: [{ type: 'function', function: { name: 'date_calc' } }] });
  ok(res.message.tool_calls.length === 1 && h.ctx.NyxLimits.toolCap('qwen3.6-35b').state === 'ok', 'a successful tool call is remembered (Hub shows «tool calls ✓»)');

  // ---- 3) Hub helpers: tool-call capability, MTP, t/s, VRAM ----
  const L = h.ctx.NyxLimits;
  ok(L.toolCap('llama-krikri-8b-instruct-q8_0').state === 'no' && L.toolCap('llama-krikri-8b-instruct-q8_0').known, 'Krikri → «δεν κάνει tool calls» (known from 12–13/11)');
  L.noteTools('gemma-4-12B-it-Q4_0', false, 'HTTP 500 peg-native'); ok(L.toolCap('gemma-4-12B-it-Q4_0').state === 'no' && /peg-native/.test(L.toolCap('gemma-4-12B-it-Q4_0').err), 'a 500 seen on this PC is remembered with its message');
  ok(L.toolCap('Qwen3-8B').state === 'unknown', 'never tried → unknown (no guess)');
  ok(L.isToolFormatError('Error invoking remote method: HTTP 500 … does not match the expected peg-native format'), 'renderer recognises the IPC message');
  ok(L.mtpOf({ predicted_n: 100, predicted_ms: 1450, draft_n: 120, draft_n_accepted: 90 }).state === 'on' && Math.round(L.mtpOf({ draft_n: 120, draft_n_accepted: 90 }).rate * 100) === 75, 'MTP on from draft_n (75% accepted)');
  ok(L.mtpOf({ predicted_n: 100, predicted_ms: 1450 }).state === 'off' && L.mtpOf(null).state === 'unknown', 'no draft_n → off; no timings → unknown');
  ok(Math.round(L.speedOf({ predicted_n: 690, predicted_ms: 10000 })) === 69, 't/s = predicted_n / seconds (69)');
  const GB = 1073741824;
  const snapGvs = { gpu: { adapter: { name: 'AMD Radeon RX 7900 XTX', total: 24 * GB, used: 22.6 * GB }, procs: [{ pid: 10, name: 'llama-server', path: 'C:\\Users\\jonh\\llama-router\\llama-server.exe', vram: 17 * GB }, { pid: 11, name: 'llama-server', path: 'C:\\Users\\jonh\\GPU-Voice-Studio\\third_party\\llama\\llama-server.exe', vram: 4.4 * GB }] } };
  const vw = L.vramWarn(snapGvs);
  ok(vw.state === 'gvs' && vw.gvs.length === 1 && vw.gvs[0].pid === 11, 'Voice Studio found by its folder (same exe name as the router)', vw);
  ok(L.vramWarn({ gpu: { adapter: { total: 24 * GB, used: 10 * GB }, procs: [{ pid: 10, name: 'llama-server', vram: 9 * GB }] } }).state === 'ok', 'router alone at 10/24 GB → no warning');
  ok(L.vramWarn({ gpu: { adapter: null, procs: [] } }).state === 'none' && L.vramWarn(null).state === 'none', 'no measurement → no warning (never from file sizes)');
  ok(L.vramWarn({ gpu: { adapter: { total: 24 * GB, used: 23 * GB }, procs: [] } }, { shared0: 0 }).state === 'ok', '≥ 90% used alone → no warning (2.6.9.2: 94–99% is normal for Qwen+MTP+mmproj+32K)');
  const hubSrc = fs.readFileSync(path.join(R, 'app/js/v2/hub.js'), 'utf8');
  ok(/paintToolCap/.test(hubSrc) && /paintVramWarn/.test(hubSrc) && /perf:snapshot/.test(fs.readFileSync(path.join(R, 'app/js/v2/hub-tabs.js'), 'utf8')), 'Hub paints tool-call warning and the measured VRAM warning');
  const ps = fs.readFileSync(path.join(R, 'main/res/gpu.ps1'), 'utf8'); ok(/path = \$pa/.test(ps), 'gpu.ps1 reports the process path');
  const uh = require('../main/unpacked-sha256.json').files['main/res/gpu.ps1']; ok(uh === require('crypto').createHash('sha256').update(fs.readFileSync(path.join(R, 'main/res/gpu.ps1'))).digest('hex'), 'unpacked integrity hash updated for gpu.ps1');

  ok(/const \{ onNotice, onDelta, \.\.\.rest \} = opts/.test(coreSrc), '2.6.8.x bug fixed: AI.chat no longer sends the callbacks through IPC (JSON path «could not be cloned»)');
  // ---- rules that must not move ----
  const lim = require('../main/limits');
  ok(!/ctx\s*[:=]\s*(?:65536|131072)/.test(coreSrc) && lim.computeMaxTokens({ nCtx: 32768, promptTokens: 1000 }).max_tokens <= 32768, 'ctx is only read (32768), never raised');
  ok(/thinkingBudget: 0/.test(coreSrc), 'default thinking cap stays 0 = no artificial fixed cap');
  for (const k of Object.keys(el).filter((k) => k.startsWith('v269.'))) if (!(k in en)) ok(false, 'en missing ' + k);
  ok(Object.keys(el).filter((k) => k.startsWith('v269.')).length >= 40, 'v269 strings in el/en');
  const tracked = require('child_process').execFileSync('git', ['ls-files'], { cwd: R }).toString();
  ok(!/\.pem$|nebula-keys\//m.test(tracked), 'no key files tracked in git');

  console.log(`\nv2.6.9 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
