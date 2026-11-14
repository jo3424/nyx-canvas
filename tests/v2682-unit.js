'use strict';
// v2.6.8.2 unit tests: real token counting + pre-send fit (both evidence cases ≤ 32768), send never waits for the
// heavy stage (pause + abort + resume), zip file-list path without auto-summary, copyable logs.
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const R = path.join(__dirname, '..');
const pkg = require('../package.json');
const el = require('../app/locales/el.json');
const en = require('../app/locales/en.json');
const T = require('../app/js/v26/tokens.js');
const LC = require('../app/js/v26/logcopy.js');
const limits = require('../main/limits');
const ai = require('../main/ai');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 800) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const N_CTX = 32768, RESERVE = 2048;

// ---- simulated server tokenizer, calibrated on the two reports from the PC (11/11) ----
// PDF: 51,070 chars, ~49% Greek → ~25k tokens for the file (+ system ≈ 30.4k prompt). Code zip: ~143k chars → ~45.5k tokens.
const GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]/g;
function realTok(s) {
  s = String(s || ''); let n = 0;
  for (let i = 0; i < s.length; i += 2000) {
    const c = s.slice(i, i + 2000); const g = (c.match(GREEK) || []).length; const rest = c.length - g;
    n += g / 1.4 + rest / (T.isCodeLike(c) ? 3.14 : 3.6);
  }
  return Math.ceil(n);
}
const realPrompt = (msgs) => msgs.reduce((n, m) => n + realTok(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) + 8, 0);

// deterministic text builders
function rng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
const GR = ['Η εφαρμογή διαβάζει το αρχείο και κρατά τις σελίδες με τη σειρά τους.', 'Ο πίνακας δείχνει τα έσοδα ανά μήνα και τις αλλαγές από πέρσι.', 'Στο κεφάλαιο αυτό περιγράφεται η διαδικασία έγκρισης των αιτήσεων.', 'Οι συμμετέχοντες συμφώνησαν να ξαναδούν το χρονοδιάγραμμα τον Δεκέμβριο.'];
const ENG = ['The report lists the quarterly figures and the main risks for the next year.', 'Section four explains how the data was collected and cleaned before analysis.', 'All values are rounded to two decimals unless noted otherwise in the table.', 'The appendix contains the full questionnaire and the raw answers.'];
function makePdf() {
  const r = rng(7); let s = ''; let p = 1;
  while (s.length < 51070) { if (s.length > p * 1500) { s += `\n[${++p}] `; } s += (r() < 0.5 ? GR : ENG)[Math.floor(r() * 4)] + ' '; }
  return s.slice(0, 51070);
}
function makeCode(name, n, seed) {
  const r = rng(seed); let s = `// ${name}\n'use strict';\n`;
  while (s.length < n) { const k = Math.floor(r() * 1000); s += `function f${k}(a, b) {\n  const x = [a, b].map((v) => v * ${k});\n  if (x[0] > ${k}) { return { ok: true, v: x }; }\n  return null;\n}\n`; }
  return s.slice(0, n);
}
const SYS = ('You are Nyx, the assistant of an infinite canvas app. Use the tools to create, move and read cards. Answer in Greek. ').repeat(160); // ≈ 18k chars ≈ 5k tokens

// ---- a small renderer harness for attach.js (no DOM, IPC stubbed) ----
function harness(opts = {}) {
  const calls = { inv: [], llm: [], aborts: [] };
  const tr = (k, v) => { let s = el[k] || k; for (const [a, b] of Object.entries(v || {})) s = s.split('{' + a + '}').join(String(b)); return s; };
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Map, Set, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, Infinity, NaN, isFinite, encodeURIComponent,
    t: tr, h: () => ({ append() {}, classList: { add() {}, remove() {} } }), $: () => null, iconSvg: () => '', toast: (m) => { calls.toasts = (calls.toasts || []).concat(m); },
    cleanErr: (e) => String((e && e.message) || e), norm: (s) => String(s || '').toLowerCase(), esc: (s) => s, stripThink: (s) => String(s || ''),
    V2: { info: { platform: 'linux' } }, Extras: {}, Private: { on: false }, Features: {}, Agent: {},
    Store: { state: { chat: opts.chat || [], settings: { ai: { assistant: { attachReserve: RESERVE, historyPct: 25 }, providers: [{ id: 'llama', name: 'llama', base: 'http://127.0.0.1:8080/v1', kind: 'local', enabled: true }], tasks: { commands: { p: 'llama', m: 'gemma-4-12B-it-Q4_0' } }, servers: { llama: { ctx: N_CTX } } }, agent: {} } } },
    AI: { lastPrep: null, pickModel: async () => ({ p: { id: 'llama', name: 'llama' }, m: 'gemma' }), enabled: () => [], last: {} },
    Assistant: { system: () => SYS, show() {} },
    Cmd: { T: {}, tools: () => [] },
    API: {
      inv: async (ch, ...a) => {
        calls.inv.push([ch, ...a]);
        if (ch === 'ai:tokenize') return opts.loaded ? { count: realTok(a[1]) } : { count: null, skipped: 'not_loaded' };
        if (ch === 'ai:chatAbort') { calls.aborts.push(a[0]); const f = ctx._pending.get(a[0]); if (f) f(); return true; }
        if (ch === 'ai:context') return { n_ctx: N_CTX, source: 'models' };
        if (opts.inv) return opts.inv(ch, ...a);
        return null;
      },
    },
    _pending: new Map(),
    // background chat: hangs until aborted (first call) or answers (later calls) — like a busy -np 1 router
    invokeChat: (p, body) => {
      calls.llm.push(body._streamId);
      if (opts.llmAnswer) return Promise.resolve({ message: { content: opts.llmAnswer } });
      if (calls.llm.length === 1) return new Promise((res, rej) => ctx._pending.set(body._streamId, () => rej(new Error('cancelled'))));
      return Promise.resolve({ message: { content: 'ok-after-resume' } });
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(R, 'app/js/v26/tokens.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(R, 'app/js/v25/attach.js'), 'utf8') + '\nglobalThis.Att = Att;', ctx);
  ctx.Att._nCtx = N_CTX; ctx.Att._nCtxSource = 'models';
  return { Att: ctx.Att, ctx, calls };
}
const histChat = (tokens) => { const out = []; let n = 0; const r = rng(3); while (n < tokens) { const c = GR[Math.floor(r() * 4)].repeat(6); out.push({ role: out.length % 2 ? 'assistant' : 'user', content: c }); n += realTok(c) + 8; } return out; };

(async () => {
  console.log('version + changelog + electron');
  ok((pkg.version === '2.6.8.2' || (pkg.version.startsWith('2.6.9') || pkg.version.startsWith('2.6.10'))) && pkg.devDependencies.electron === '45.2.3', 'version 2.6.8.2, Electron 45.2.3', pkg.version);
  const log = require(R + '/CHANGELOG.json')['2.6.8.2'];
  ok(log && log.el.length === 3 && log.en.length === 3, 'CHANGELOG 2.6.8.2 has exactly 3 el+en groups');
  ok(/tokenize/.test(log.el[0]) && /θα σταλούν/.test(log.el[0]), 'group 1 = token counting / orange chip');
  ok(/Περίληψη/.test(log.el[1]) && /-np 1/.test(log.el[1]), 'group 2 = send never blocks / zip list');
  ok(/Αντιγραφή όλων/.test(log.el[2]) && /Ctrl\+A/.test(log.el[2]), 'group 3 = copyable logs');
  ok(Object.keys(el).filter(k => k.startsWith('v2682.')).length === Object.keys(en).filter(k => k.startsWith('v2682.')).length, 'el/en v2682 key counts match');
  ok(el['v2682.will_send'] === 'θα σταλούν {x} από {y} tokens' && el['v2682.measured'] === 'μετρημένο' && el['v2682.estimated'] === 'εκτίμηση' && el['v2682.summary_btn'] === 'Περίληψη' && el['v2682.copy_all'] === 'Αντιγραφή όλων', 'Greek labels as specified');

  console.log('estimate (no model loaded)');
  const PDF = makePdf();
  ok(PDF.length === 51070, 'PDF fixture is 51,070 chars', PDF.length);
  const gs = T.greekShare(PDF);
  ok(gs > 0.44 && gs < 0.56, 'PDF fixture is about half Greek', gs.toFixed(2));
  ok(Math.ceil(PDF.length / 4) === 12768, 'old chars/4 gives 12.8k (the bug)', Math.ceil(PDF.length / 4));
  const estPdf = T.estimate(PDF, 'pdf'), realPdf = realTok(PDF);
  ok(estPdf >= realPdf && estPdf <= realPdf * 1.3, 'new estimate ≥ simulated server count and not wildly above', { estPdf, realPdf });
  ok(T.estimate('The quick brown fox jumps over the lazy dog. '.repeat(100)) === Math.ceil(4500 / 3.5), 'English prose ≈ chars/3.5');
  ok(T.estimate('Καλημέρα σε όλους, τι κάνετε; '.repeat(100)) === Math.ceil(3000 / 2), 'Greek ≈ chars/2');
  ok(T.estimate(makeCode('a.js', 10000, 1), 'code') === 5000 && T.estimate(makeCode('a.js', 10000, 1)) === 5000, 'code ≈ chars/2 (by kind and by shape)');
  ok(limits.estimateTokens([{ role: 'user', content: PDF }]) >= realPdf, 'main-process fallback estimate (chars/2) is not below the simulated count');

  console.log('evidence 1: 34-page PDF, 51,070 chars, ~49% Greek — total never exceeds 32768');
  for (const loaded of [true, false]) {
    for (const histTok of [0, 6000]) {
      const H = harness({ loaded, chat: histChat(histTok) });
      const e = { id: 'a1', name: 'report.pdf', kind: 'pdf', state: 'ok', fastOk: true, text: PDF, hash: 'pdf1', stages: [] };
      H.Att.list = [e];
      await H.Att.measure(e);
      ok(e.tk.src === (loaded ? 'measured' : 'estimate') && (loaded ? e.tk.n === realPdf : e.tk.n === estPdf), `count source ${loaded ? 'μετρημένο (/tokenize)' : 'εκτίμηση'} (history ≈${histTok})`, e.tk);
      const tokCalls = H.calls.inv.filter(c => c[0] === 'ai:tokenize');
      ok(tokCalls.length === 1 && tokCalls[0][3] && tokCalls[0][3].onlyIfLoaded === true && tokCalls[0][3].model, 'one /tokenize request, only if the model is loaded', tokCalls.map(c => c[3]));
      await H.Att.measure(e);
      ok(H.calls.inv.filter(c => c[0] === 'ai:tokenize').length === (loaded ? 1 : 2), loaded ? 'second count is served from the per-hash cache' : 'not loaded → tries again next time (no cache of an estimate)');
      const pl = H.Att.plan([e]);
      const prior = H.ctx.Store.state.chat.map(m => ({ role: m.role, content: m.content }));
      const msgs = [{ role: 'system', content: SYS }, ...prior, { role: 'user', content: 'Τι λέει το έγγραφο;' + H.Att.context([e]) }];
      // what the main process returns from prepare: measured when /tokenize works, chars/2 estimate otherwise
      const count = (m) => loaded ? realPrompt(m) : limits.estimateTokens(m);
      const prep0 = { n_ctx: N_CTX, promptTokens: count(msgs), tokSrc: loaded ? 'tokenize' : 'estimate' };
      const notes = [];
      const f = await H.Att.fitPrompt(msgs, prep0, (k, m) => notes.push(m), async (m) => ({ n_ctx: N_CTX, promptTokens: count(m), tokSrc: prep0.tokSrc }));
      const final = realPrompt(msgs);
      ok(final + RESERVE <= N_CTX, `real prompt ${final} + reserve ${RESERVE} ≤ ${N_CTX} (${loaded ? 'measured' : 'estimate'}, history ≈${histTok})`, { final, sent: e.tokensSent, total: e.tokensTotal, plan: pl[e.id] && { send: pl[e.id].send, total: pl[e.id].total } });
      if (e.tokensSent < e.tokensTotal) {
        ok(/θα σταλούν|στάλθηκαν/.test(el['v2682.were_sent'] + el['v2682.will_send']) && (pl[e.id].over || (f && notes.length)), 'trimmed → chip is orange (plan.over) or a visible notice was shown', { over: pl[e.id].over, notes });
      }
      if (f) ok(notes.length === 1 && /κόπηκαν/.test(notes[0]), 'auto-trim at send is not silent', notes);
    }
  }

  console.log('evidence 2: zip 2.6.7→2.6.7.1 — old chip «35745 tok · όριο 22528» ✓, real 50,556 > 32,768');
  const files = [];
  let total = 0, i = 0;
  const sizes = [41000, 30000, 22000, 16000, 12000, 9000, 6000, 3500, 2200, 1280];
  for (const n of sizes) { const name = `src/part${++i}.js`; files.push({ name, size: n, kind: 'code', state: 'ok', text: makeCode(name, n, i) }); total += n; }
  files.push({ name: 'package.json', size: 900, kind: 'code', state: 'ok', text: JSON.stringify({ name: 'nyx-canvas', version: '2.6.7.1', description: 'x', main: 'boot.js', scripts: { start: 'electron .', test: 'node t.js' }, dependencies: { a: '^1', b: '^2' }, devDependencies: { electron: '45.2.3' } }, null, 2) });
  files.push({ name: 'CHANGELOG.json', size: 5000, kind: 'code', state: 'ok', text: JSON.stringify({ '2.6.7.1': { el: ['α'.repeat(800)], en: ['a'.repeat(800)] }, '2.6.7': { el: ['β'.repeat(800)] }, '2.6.6': { el: ['γ'] } }, null, 1) });
  files.push({ name: 'shots/a.png', size: 120000, kind: 'image', state: 'ok', text: '', note: 'media' });
  const zipText = files.map(f => `### ${f.name}\n${f.text}`).join('\n\n');
  ok(Math.abs(total - 142980) < 2000, 'zip fixture ≈ 143k chars of code (35,745 × 4)', total);
  ok(Math.ceil(total / 4) < N_CTX - Math.floor(N_CTX * 0.25) - RESERVE + 14000 && N_CTX - Math.floor(N_CTX * 0.25) - RESERVE === 22528, 'old cap was 22528 = 32768 − 25% history − 2048');
  for (const loaded of [true, false]) {
    const H = harness({ loaded });
    const e = { id: 'z1', name: 'nyx-2.6.7-to-2.6.7.1.zip', kind: 'zip', state: 'ok', fastOk: true, text: zipText, children: files, hash: 'zip1', stages: [] };
    H.Att.list = [e];
    await H.Att.measure(e);
    const pl = H.Att.plan([e])[e.id];
    ok(pl.over && pl.send < pl.total, `chip would be orange: «θα σταλούν ${pl.send} από ${pl.total}» (${pl.src === 'measured' ? 'μετρημένο' : 'εκτίμηση'})`, pl && { send: pl.send, total: pl.total, src: pl.src });
    const msgs = [{ role: 'system', content: SYS }, { role: 'user', content: 'Τι άλλαξε;' + H.Att.context([e]) }];
    const count = (m) => loaded ? realPrompt(m) : limits.estimateTokens(m);
    await H.Att.fitPrompt(msgs, { n_ctx: N_CTX, promptTokens: count(msgs), tokSrc: loaded ? 'tokenize' : 'estimate' }, () => {}, async (m) => ({ n_ctx: N_CTX, promptTokens: count(m) }));
    const final = realPrompt(msgs);
    ok(final + RESERVE <= N_CTX, `real prompt ${final} + reserve ≤ ${N_CTX} (${loaded ? 'measured' : 'estimate'}; was 50,556 in 2.6.7.1)`, final);
    const u = msgs[1].content;
    ok(files.every(f => u.includes('- ' + f.name + ' · ')), 'every file is in the list (path · size · tokens)');
    ok(/#### src\/part10\.js\n/.test(u) && !/#### src\/part1\.js\n/.test(u), 'smallest files in full, the biggest only listed');
    ok(/#### CHANGELOG\.json \(σύντομα\)/.test(u) || /#### CHANGELOG\.json\n/.test(u), 'CHANGELOG present (short digest when large)');
    ok(H.calls.llm.length === 0, 'no LLM call for a zip (no automatic summary)', H.calls.llm.length);
    ok(Array.isArray(e.files) && e.files.length === files.length && e.files.some(f => f.how === 'full') && e.files.some(f => f.how === 'listed'), 'chip file list knows full / listed per file');
  }

  console.log('zip manifest path (NyxTok.zipPlan)');
  {
    const rows = [
      { name: 'b.txt', size: 300, kind: 'text', text: 'x'.repeat(300) },
      { name: 'a.js', size: 100, kind: 'code', text: 'y'.repeat(100) },
      { name: 'img.png', size: 9000, kind: 'image', text: '' },
      { name: 'big.js', size: 90000, kind: 'code', text: 'z'.repeat(90000) },
      { name: 'package.json', size: 4000, kind: 'code', text: JSON.stringify({ name: 'n', version: '1', scripts: { a: 'b' }, dependencies: Object.fromEntries(Array.from({ length: 200 }, (_, k) => ['dep' + k, '^' + k])) }) },
      { name: 'CHANGELOG.md', size: 8000, kind: 'text', text: Array.from({ length: 300 }, (_, k) => '- change ' + k).join('\n') },
      { name: 'bad.bin', size: 5, kind: 'unknown', text: '', bad: true, error: 'binary' },
    ];
    const zp = T.zipPlan(rows, 2000, { fmt: b => b + ' B' });
    ok(rows.every(r => zp.manifest.includes(r.name)) && /a\.js · 100 B · 50 tok/.test(zp.manifest) && /bad\.bin · 5 B · ⚠ binary/.test(zp.manifest), 'manifest lists path · size · tokens for every file', zp.manifest);
    ok(zp.included[0] === 'a.js' && zp.included[1] === 'b.txt', 'smallest text/code files first', zp.included);
    ok(zp.digested.includes('package.json') && zp.digested.includes('CHANGELOG.md'), 'manifest and CHANGELOG as short digests', zp.digested);
    ok(zp.listed.includes('big.js') && !zp.included.includes('img.png'), 'files that do not fit are only listed; media is not inlined', zp.listed);
    ok(zp.used <= 2000, 'zip body stays within its share', zp.used);
    const d = T.metaDigest('package.json', rows[4].text);
    ok(/"version": "1"/.test(d) && /dep0@\^0/.test(d) && d.length <= 2400, 'package.json digest keeps name/version/deps');
  }

  console.log('send never waits for the heavy stage');
  {
    const H = harness({ loaded: true });
    const e = { id: 'v1', name: 'clip.mp4', kind: 'video', state: 'heavy', fastOk: true, stages: [] };
    const job = H.Att.llm('vision', [{ role: 'user', content: 'describe' }], {}, e);
    await sleep(10);
    ok(H.calls.llm.length === 1 && H.Att._bgStreams.size === 1, 'a background request is in flight');
    const bgId = H.calls.llm[0];
    ok(/^bg-/.test(bgId), 'background requests use their own stream id (never the Stop-button id)', bgId);
    // the user presses send
    H.Att.pauseHeavy();
    ok(H.calls.aborts.includes(bgId), 'send aborts the in-flight background request so the user request is first at the router (-np 1)', H.calls.aborts);
    const slow = { id: 's1', name: 'big.pdf', kind: 'pdf', state: 'work', stages: [], fastReady: new Promise(() => {}) };
    const done = { id: 's2', name: 'clip.mp4', kind: 'video', state: 'heavy', fastOk: true, stages: [], fastReady: Promise.resolve(), heavyDone: new Promise(() => {}) };
    H.Att.list = [slow, done];
    const t0 = Date.now(); const L = await H.Att.take(); const took = Date.now() - t0;
    ok(L.length === 2 && took < 700, 'take() returns with what the fast stage has (heavy and slow reads do not block)', took);
    const c = H.Att.context(L);
    ok(/η ανάγνωση συνεχίζεται/.test(c), 'not-yet-read files are marked, not waited for');
    await sleep(30);
    ok(H.calls.llm.length === 1, 'while the reply runs, the heavy stage does not queue another request', H.calls.llm.length);
    H.Att.resumeHeavy();
    const r = await job;
    ok(r === 'ok-after-resume' && H.calls.llm.length === 2, 'after the reply the heavy step runs again', { r, n: H.calls.llm.length });
  }
  {
    // over-budget text no longer starts background work (summary only via the button)
    const big = 'Μεγάλο κείμενο για δοκιμή. '.repeat(6000);
    const H = harness({ loaded: false, llmAnswer: 'σύνοψη', inv: (ch) => ch === 'att:inspect' ? { size: big.length, kind: 'text', text: big, mtime: 1 } : null });
    const e = { id: 'b1', path: '/tmp/big.txt', name: 'big.txt', state: 'wait', stages: [] };
    await H.Att.fast(e);
    ok(e.state === 'ok' && !e.heavyDone && H.calls.llm.length === 0, 'over-budget text: state ok, no heavy stage, no LLM', { state: e.state, llm: H.calls.llm.length });
    ok(H.Att.plan([e])[e.id].over, 'it is trimmed at send instead (orange chip)');
    await H.Att.summaryJob(e);
    ok(H.calls.llm.length > 0 && /σύνοψη/.test(e.summary || ''), '«Περίληψη» button runs the summary (only on request)', H.calls.llm.length);
  }
  const coreSrc = fs.readFileSync(path.join(R, 'app/js/v2/core.js'), 'utf8');
  const agSrc = fs.readFileSync(path.join(R, 'app/js/v25/agent.js'), 'utf8');
  ok(/if \(!body\._bg\) AI\._streamId = id/.test(coreSrc), 'background stream ids never replace the Stop-button stream id');
  ok(/Att\.fitPrompt\(msgs, prep/.test(coreSrc) && /tools: body\.tools/.test(coreSrc), 'chatTurn runs the pre-send fit and counts the tool list too');
  ok(/Att\.pauseHeavy\(\);[\s\S]{0,400}Att\.take\(\)[\s\S]{0,300}finally \{ Att\.resumeHeavy\(\); \}/.test(agSrc), 'send: pause heavy → take → reply → resume (finally)');

  console.log('main process: queued request aborted before it reaches the router; tokenize only if loaded; props ceiling');
  {
    const st = { chats: 0, tok: [], loaded: false };
    const srv = http.createServer((q, resp) => {
      const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
      if (q.url.startsWith('/v1/models')) return send(200, { data: [{ id: 'gemma', status: { value: st.loaded ? 'loaded' : 'unloaded' } }] });
      if (q.url.startsWith('/slots')) return send(200, []);
      if (q.url.startsWith('/tokenize') || q.url.startsWith('/v1/tokenize')) { let b = ''; q.on('data', d => b += d); q.on('end', () => { st.tok.push({ url: q.url, body: JSON.parse(b || '{}') }); send(200, { tokens: [1, 2, 3, 4, 5] }); }); return; }
      if (q.url.includes('chat/completions')) { st.chats++; return send(200, { choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }] }); }
      send(404, {});
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const p = { id: 'llama', base: `http://127.0.0.1:${srv.address().port}/v1`, kind: 'local' };
    const r1 = await ai.tokenize(p, 'κείμενο', { model: 'gemma', onlyIfLoaded: true });
    ok(r1.skipped === 'not_loaded' && st.tok.length === 0, 'not loaded → no /tokenize (never starts a load)', r1);
    st.loaded = true;
    const r2 = await ai.tokenize(p, 'κείμενο', { model: 'gemma', onlyIfLoaded: true });
    ok(r2.count === 5 && st.tok.length === 1 && st.tok[0].body.model === 'gemma' && /\?autoload=false/.test(st.tok[0].url), 'loaded → one /tokenize with the model id in the body + ?autoload=false (router b12230 reads the body)', st.tok);
    ok(ai.entryLoading({ id: 'x', status: { value: 'loaded' } }) === false && ai.entryLoading({ id: 'x', status: { value: 'loading' } }) === true, 'router status objects {value:…} are understood');
    const ctrl = new AbortController(); ctrl.abort();
    let err = null; try { await ai.chatStream(p, { model: 'gemma', messages: [{ role: 'user', content: 'x' }] }, { signal: ctrl.signal }); } catch (e) { err = e; }
    ok(err && err.code === 'ABORTED' && st.chats === 0, 'a request aborted while queued never reaches the router', { code: err && err.code, chats: st.chats });
    ok(ai.PROPS_MODEL_MS === 120000, '/props?model= waits at most 120 s (was: no ceiling)');
    srv.close();
  }

  console.log('copyable logs');
  ok(LC.decide({ key: 'c', ctrl: true, selText: 'line 1', inLog: true }) === 'native', 'Ctrl+C with a selection in a log → browser copy (not Clip.copy of cards)');
  ok(LC.decide({ key: 'c', ctrl: true, selText: 'x', inLog: false }) === 'native', 'Ctrl+C with selected text anywhere outside the cards → browser copy');
  ok(LC.decide({ key: 'c', ctrl: true, selText: 'x', selInCanvasItem: true, inLog: false }) === null, 'Ctrl+C with a selection inside a card → canvas copy as before');
  ok(LC.decide({ key: 'c', ctrl: true, selText: '', inLog: true }) === 'copyAll', 'Ctrl+C in a focused log without selection → copy the whole log');
  ok(LC.decide({ key: 'a', ctrl: true, inLog: true }) === 'selectLog', 'Ctrl+A in a log → select only that log');
  ok(LC.decide({ key: 'a', ctrl: true, inLog: false }) === null, 'Ctrl+A elsewhere → select all cards as before');
  ok(LC.decide({ key: 'delete', ctrl: false, inLog: true }) === 'pass' && LC.decide({ key: 'p', ctrl: false, inLog: true }) === 'pass', 'Delete / tool letters inside a log do nothing to the canvas');
  const appSrc = fs.readFileSync(path.join(R, 'app/js/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(R, 'app/index.html'), 'utf8');
  ok(/if \(typing\) return;\n\s*if \(typeof LogCopy !== 'undefined' && LogCopy\.key && LogCopy\.key\(e\)\) return;/.test(appSrc), 'App.keys asks LogCopy before the canvas shortcuts');
  ok(/js\/v26\/tokens\.js/.test(html) && /js\/v26\/logcopy\.js/.test(html), 'tokens.js and logcopy.js are loaded');
  const lcSrc = fs.readFileSync(path.join(R, 'app/js/v26/logcopy.js'), 'utf8');
  ok(/pre\.srv-log, pre\.logs/.test(lcSrc) && /v2682\.copy_all/.test(lcSrc) && /navigator\.clipboard\.writeText/.test(lcSrc), 'every engine/plugin log gets «Αντιγραφή όλων»');
  const asSrc = fs.readFileSync(path.join(R, 'app/js/v2/assistant.js'), 'utf8');
  // superseded in 2.6.9.3: Ctrl+Z in the assistant field never reaches the canvas, even when the field is empty
  ok(!/id: 'as-q'[^\n]*App\.undo/.test(asSrc) && /\['z', 'y'\]\.includes\(e\.key\.toLowerCase\(\)\)\) \{ e\.stopPropagation\(\); return; \}/.test(asSrc), 'Ctrl+Z in the assistant field never undoes the canvas (2.6.9.3)');

  console.log('rules');
  const attSrc = fs.readFileSync(path.join(R, 'app/js/v25/attach.js'), 'utf8');
  ok(!/\b12000\b|\b24000\b|length \/ 4\b/.test(attSrc), 'no fixed caps and no chars/4 in attach.js');
  const fastFn = attSrc.split('async fast(e)')[1].split('fits(text')[0];
  ok(!/summarize\(|this\.llm\(|this\.vision\(/.test(fastFn), 'fast stage calls no model');
  ok(!/ctx:\s*\d+/.test(attSrc) && !/servers\.llama\.ctx\s*=/.test(attSrc), 'n_ctx is only read, never raised');

  console.log(`\nv2.6.8.2 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
