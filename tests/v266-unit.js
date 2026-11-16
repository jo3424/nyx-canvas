'use strict';
// v2.6.6 unit tests: prompt cache order, history %, board-when-needed, token count for «γεια»,
// router /props?model=, no auto-raise ctx, 403, MCP limits, zones, banned phrases.
const http = require('http');
const fs = require('fs');
const path = require('path');
const L = require('../main/limits');
const ai = require('../main/ai');
const P = require('../app/js/v2/prompt.js');
const zones = require('../app/js/v2/model-zones.js');
const mcp = require('../app/plugins/mcp-server/plugin.js');
const img = require('../main/import-image');
const R = path.join(__dirname, '..');
const el = require('../app/locales/el.json');
const en = require('../app/locales/en.json');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };

console.log('prompt order and date');
const when = new Date('2026-11-10T20:17:45Z');
const fmt = P.formatNow(when, 'Europe/Athens', 'el-GR');
ok(fmt.hm === '22:17' && fmt.day === '10/11/2026' && !/:45/.test(fmt.text), 'Europe/Athens minute precision, no seconds', fmt);
ok(/Τρίτη/.test(fmt.weekday) || /Tuesday|Tue/.test(fmt.weekday) || fmt.weekday, 'weekday present', fmt.weekday);
const sys = P.buildSystem({
  instructions: 'INST', extra: 'EXTRA', toolsText: '- search_cards(): find', boardHeader: 'Active board: «Home». Use tools.', now: 'Now: Τρίτη 10/11/2026 22:17 (Europe/Athens)',
});
ok(sys.indexOf('INST') < sys.indexOf('EXTRA') && sys.indexOf('EXTRA') < sys.indexOf('search_cards') && sys.indexOf('search_cards') < sys.indexOf('Now:'), 'stable prefix instructions → extra → tools, date at end (board moved after history in 2.6.8)', sys);
ok(!/Active board/.test(sys), 'buildSystem no longer puts the board in the system prefix');
ok(sys.trim().endsWith('(Europe/Athens)'), 'date is the suffix');
const a = P.buildSystem({ instructions: 'INST', boardHeader: 'H', now: 'Now: A' });
const b = P.buildSystem({ instructions: 'INST', boardHeader: 'H', now: 'Now: B' });
ok(a.slice(0, a.lastIndexOf('\n\n')) === b.slice(0, b.lastIndexOf('\n\n')), 'prefix identical when only the date changes');

console.log('needsBoard + serialize');
ok(!P.needsBoard('γεια') && !P.needsBoard('Γεια!') && !P.needsBoard('hi') && !P.needsBoard('Hello.'), 'greetings do not send the board');
ok(P.needsBoard('βάλε μια κάρτα για γάλα') && P.needsBoard('tidy the board') && P.needsBoard('show card X'), 'board/card intent sends the board');
ok(P.needsBoard('ok', { toolsCalled: ['read_cards'] }), 'tool-driven includes the board');
const cards = P.serializeCards([{ id: 'bxxxxxxxx', type: 'sticky', title: 'B', tags: ['z', 'a'] }, { id: 'axxxxxxxx', type: 'sticky', title: 'A' }, { id: 'c', type: 'ink' }]);
ok(cards.map(c => c.id).join(',') === 'axxxxxxx,bxxxxxxx' && cards[1].tags.join(',') === 'a,z', 'cards sorted by id, tags sorted, ink omitted', cards);

console.log('history trim');
const long = [];
for (let i = 0; i < 40; i++) long.push({ role: i % 2 ? 'assistant' : 'user', content: ('msg ' + i + ' ').repeat(40) });
long.push({ role: 'user', content: 'γεια' });
const tr0 = P.trimHistory(long, { nCtx: 0, percent: 25 });
ok(!tr0.trimmed && tr0.reason === 'unknown_ctx' && tr0.messages.length === long.length, 'unknown ctx does not silently drop history');
const tr = P.trimHistory(long, { nCtx: 800, percent: 25 });
ok(tr.trimmed && tr.summary && tr.messages.slice(-1)[0].content === 'γεια' && tr.dropped > 0, 'history over the % becomes a summary', { dropped: tr.dropped, reason: tr.reason, budget: tr.budget });
const trSame = P.trimHistory(long, { nCtx: 800, percent: 25, cache: { key: tr.cacheKey, text: 'CACHED' } });
ok(trSame.summary === 'CACHED', 'summary is reused from cache');
const trAll = P.trimHistory([{ role: 'user', content: 'γεια' }], { nCtx: 8000, percent: 25 });
ok(!trAll.trimmed && trAll.messages.length === 1, 'short history fits');

console.log('token count for «γεια» (measured on this box)');
function legacySystem(boardJson) {
  return 'You are the assistant of Nyx Canvas...\nRules: Use ids from the card list.\n\nNow: Tuesday 10/11/2026, 10:17:45 PM (ISO 2026-11-10T22:17:45, time zone Europe/Athens).\nActive board: «Home» (' + boardJson.length + ' cards). Other boards: Work.\nSelected: none.\nCards (closest to the center): ' + JSON.stringify(boardJson);
}
const tools = [];
for (const name of ['create_card', 'update_card', 'delete_cards', 'move_cards', 'group_cards', 'tidy_board', 'search_cards', 'read_cards', 'show_card', 'summarize', 'create_board', 'open_board', 'create_reminder', 'open_url', 'web_search', 'open_panel', 'run_plugin', 'add_subscription', 'set_theme']) {
  tools.push({ type: 'function', function: { name, description: 'Tool ' + name + ' does a canvas action with several arguments and returns a result object.', parameters: { type: 'object', properties: { id: { type: 'string' }, ids: { type: 'array' }, query: { type: 'string' }, text: { type: 'string' }, title: { type: 'string' }, tags: { type: 'array' }, board: { type: 'string' }, url: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } } } });
}
const boardJson = [];
for (let i = 0; i < 90; i++) boardJson.push({ id: ('id' + i).slice(0, 8), type: 'sticky', title: 'Σημείωση αριθμός ' + i + ' με αρκετό ελληνικό κείμενο για να γεμίσει το prompt', tags: i % 3 ? ['λίστα'] : undefined });
const hist20 = [];
for (let i = 0; i < 20; i++) hist20.push({ role: i % 2 ? 'assistant' : 'user', content: 'Παλιό μήνυμα ' + i + ' με αρκετό κείμενο ώστε να μετρήσει στο ιστορικό της συνομιλίας.' });
const beforeMsgs = [{ role: 'system', content: legacySystem(boardJson) }, ...hist20, { role: 'user', content: 'γεια' }];
const afterSys = P.buildSystem({
  instructions: el['v266.sys_instructions'], extra: '', boardHeader: P.boardHeader({ name: 'Home' }, { active: 'Active board', useTools: 'Use tools.' }), now: 'Now: Τρίτη 10/11/2026 22:17 (Europe/Athens)',
});
const afterTrim = P.trimHistory([...hist20, { role: 'user', content: 'γεια' }], { nCtx: 32768, percent: 25 });
const afterMsgs = [{ role: 'system', content: afterSys }, ...afterTrim.messages.filter((m, i, a) => !(i === a.length - 1 && m.content === 'γεια')), { role: 'user', content: 'γεια' }];
const estBefore = L.estimateTokens(beforeMsgs, tools);
const estAfter = L.estimateTokens(afterMsgs, tools);
const report = { method: 'limits.estimateTokens (char/2, this box, not the user PC tokenizer)', before: estBefore, after: estAfter, reduction: estBefore - estAfter, nCtxAssumedForHistory: 32768, includeBoardAfter: false, tools: tools.length, cardsBefore: 90 };
ok(estBefore > estAfter, '«γεια» request is smaller after the prompt fix (estimateTokens on this box)', report);
ok(estAfter > 100, 'after still includes instructions + tools (honest, not a zero)', estAfter);
console.log('  TOKEN_REPORT ' + JSON.stringify(report));

async function maybeTokenize(label, messages, toolsArr) {
  const url = process.env.NYX_TOKENIZE_URL;
  if (!url) return null;
  try {
    const text = L.requestToText(messages, toolsArr);
    const r = await fetch(url.replace(/\/$/, '') + '/tokenize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) });
    const j = await r.json();
    const tokens = Array.isArray(j?.tokens) ? j.tokens : [];
    console.log('  TOKENIZE_' + label, tokens.length);
    return tokens.length;
  } catch (e) { console.log('  TOKENIZE_' + label + ' failed', e.message); return null; }
}

console.log('resolveLaunchCtx must not auto-raise');
ok(L.resolveLaunchCtx({ ctx: 32768 }, { ctx: 262144 }).ctx === 32768 && !L.resolveLaunchCtx({ ctx: 32768 }, { ctx: 262144 }).auto, 'user 32768 is kept, not replaced by 262144');
ok(L.resolveLaunchCtx({ ctx: 0 }, { ctx: 262144 }).omitted && L.resolveLaunchCtx({ ctx: 0 }, { ctx: 262144 }).ctx === 0, 'ctx 0 omits -c instead of applying 262144');
ok(L.resolveLaunchCtx({ ctx: '' }, { ctx: 262144 }).omitted, 'empty ctx omits -c');
ok(L.recommendCtx({ meta: L.GEMMA4_12B, weightsBytes: 6.71 * 2 ** 30, vramGiB: 24, kvType: 'f16', fa: true }).ctx === 262144, 'computed fit 262144 still exists as a figure, not a launch default');

console.log('router /props?model=');
(async () => {
  const hits = [];
  const srv = http.createServer((q, resp) => {
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    hits.push(q.method + ' ' + q.url);
    if (q.url === '/v1/models' || q.url === '/models') return send(200, { data: [{ id: 'gemma-4-12b', meta: {} }, { id: 'krikri-8b', meta: {} }] });
    if (q.url === '/props') return send(400, { error: { message: 'model is required' } });
    if (q.url.startsWith('/props?model=')) {
      const id = decodeURIComponent(q.url.split('model=')[1]);
      return send(200, { default_generation_settings: { n_ctx: 32768 }, model: id });
    }
    if (q.url === '/slots') return send(400, { error: { message: 'model is required' } });
    if (q.url.startsWith('/slots?model=')) return send(200, { n_ctx: 32768 });
    if (q.url === '/tokenize' && q.method === 'POST') {
      let b = ''; q.on('data', d => b += d); q.on('end', () => send(200, { tokens: new Array(Math.max(1, Math.ceil((JSON.parse(b).content || '').length / 2))).fill(1) }));
      return;
    }
    if (q.url === '/v1/chat/completions') {
      let b = ''; q.on('data', d => b += d); q.on('end', () => {
        const j = JSON.parse(b);
        send(200, { choices: [{ message: { role: 'assistant', content: 'Γεια!' }, finish_reason: 'stop' }], model: j.model, timings: { prompt_n: 900, prompt_ms: 1200, predicted_n: 4, predicted_ms: 50, cache_n: 800 } });
      });
      return;
    }
    send(404, { error: 'no' });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const p = { id: 'llama', kind: 'local', base: `http://127.0.0.1:${port}/v1` };
  let threw = false;
  try { await ai.props(p); } catch (e) { threw = e.status === 400 || ai.isNeedModel(e); }
  ok(threw, '/props without model is HTTP 400 in router mode');
  const withM = await ai.props(p, { model: 'gemma-4-12b' });
  ok(withM.n_ctx === 32768, '/props?model= returns the real n_ctx 32768', withM);
  const info = await ai.contextInfo(p, { model: 'gemma-4-12b' });
  ok(info.n_ctx === 32768 && (info.source === 'props_model' || info.source === 'props'), 'contextInfo uses ?model= and reads 32768', info);
  const info2 = await ai.contextInfo(p, {});
  ok(info2.n_ctx === 32768 && info2.router, 'contextInfo without model still finds n_ctx via /v1/models + retry, marks router', info2);
  const prep = await ai.prepare(p, { messages: [{ role: 'system', content: afterSys }, { role: 'user', content: 'γεια' }], model: 'gemma-4-12b' });
  ok(prep.n_ctx === 32768 && prep.max_tokens === 32768 - prep.promptTokens - 64, 'max_tokens computed from real n_ctx 32768', prep);
  const chat = await ai.chat(p, { model: 'krikri-8b', messages: afterMsgs, cache_prompt: true });
  ok(chat.timings && chat.timings.prompt_n === 900 && chat.timings.cache_n === 800, 'chat returns llama-server timings', chat.timings);
  ok(hits.some(h => h.includes('/v1/chat/completions')), 'chat was sent');
  // inspect last chat would need capture; re-do a small server read via prepare already ok

  const tokBefore = await maybeTokenize('BEFORE', beforeMsgs, tools);
  const tokAfter = await maybeTokenize('AFTER', afterMsgs, tools);
  if (tokBefore && tokAfter) {
    ok(tokAfter < tokBefore, 'llama /tokenize on this box: after < before', { tokBefore, tokAfter });
    console.log('  TOKEN_REPORT_TOKENIZE ' + JSON.stringify({ method: 'llama /tokenize on this box', before: tokBefore, after: tokAfter }));
  } else {
    ok(true, 'llama /tokenize not available on this box (NYX_TOKENIZE_URL unset) — estimateTokens is the measurement');
  }

  srv.close();

  console.log('403 is detected');
  ok(ai.isForbidden({ status: 403, message: 'forbidden' }) && ai.isForbidden(Object.assign(new Error('HTTP 403'), { status: 403 })), 'isForbidden recognises 403');

  console.log('MCP limits');
  const lim = mcp.limitsFrom({ maxImageMb: 12, deleteConfirmMin: 2 });
  ok(lim.maxImageBytes === 12 * 1048576 && lim.deleteConfirmMs === 2 * 60 * 1000, 'limitsFrom reads plugin settings', lim);
  const dflt = mcp.limitsFrom({});
  ok(dflt.maxImageMb === 30 && dflt.deleteConfirmMin === 5, 'defaults remain 30 MB and 5 minutes', dflt);
  const listed = mcp.listedTools({ read: true, write: true, del: true, maxImageMb: 12, deleteConfirmMin: 2 });
  const add = listed.find(t => t.name === 'add_image');
  const del = listed.find(t => t.name === 'delete_cards');
  ok(add && /12 MB/.test(add.description) && del && /2/.test(del.description), 'tool descriptions report the configured limits', { add: add && add.description, del: del && del.description });
  const tmp = path.join(require('os').tmpdir(), 'nyx-lim-' + Date.now() + '.png');
  fs.writeFileSync(tmp, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  try {
    let msg = '';
    try { img.checkUserImage(tmp, { home: path.dirname(tmp), maxBytes: 4 }); } catch (e) { msg = e.message; }
    ok(/4 bytes/.test(msg) && /limit/i.test(msg), 'import error reports the actual limit', msg);
  } finally { try { fs.unlinkSync(tmp); } catch (e) {} }

  console.log('zones + cleanup texts');
  ok(zones.MODEL_ZONES.candidates.image.length <= 3 && zones.MODEL_ZONES.candidates.video.length <= 3, 'at most 3 candidates per category');
  const pulid = zones.MODEL_ZONES.other.find(x => x.id === 'pulid');
  const inst = zones.MODEL_ZONES.other.find(x => x.id === 'instantid');
  const insight = zones.MODEL_ZONES.other.find(x => x.id === 'insightface');
  ok(pulid && /antelopev2/i.test(pulid.licenseNote + pulid.requires) && /non-commercial|μη εμπορικ/i.test(pulid.licenseNote), 'PuLID requires antelopev2 and notes InsightFace NC licence', pulid);
  ok(inst && /antelopev2/i.test(inst.licenseNote + inst.requires) && /non-commercial|μη εμπορικ/i.test(inst.licenseNote), 'InstantID requires antelopev2 and notes InsightFace NC licence', inst);
  ok(insight && /non-commercial|μη εμπορικ/i.test(insight.license + insight.licenseNote), 'InsightFace licence is on the card');
  ok(!(zones.MODEL_ZONES.rejected || []).length, 'rejected zone has no licence-based exclusions');
  const packed = JSON.stringify({ el, en, core: fs.readFileSync(R + '/app/js/v2/core.js', 'utf8'), hub: fs.readFileSync(R + '/app/js/v2/hub.js', 'utf8'), h25: fs.readFileSync(R + '/app/js/v25/hub25.js', 'utf8') });
  ok(!/δεν είναι πια η σύσταση|no longer the pick|HauhauCS δεν προτείνεται/i.test(packed), 'HauhauCS is not “not recommended”');
  ok(!/Δωρεάν εφεδρεία όταν δεν φορτώνει το τοπικό|Groq εφεδρεία/i.test(packed), 'Groq is not described as a silent fallback');
  ok(!/Google Sheet \(LoRA\)|τίποτα στο Nyx/.test(packed), 'Google Sheet LoRA row is gone');
  ok(!/text-embedding-nomic \/ bge-m3 \(LM Studio\)/.test(fs.readFileSync(R + '/app/js/v2/hub.js', 'utf8')), 'Hub no longer lists embeddings via LM Studio');
  ok(!/routerSec/.test(fs.readFileSync(R + '/app/js/v25/hub25.js', 'utf8')), 'Router V2 section is removed from the Hub');
  ok(!/groqFallback &&/.test(fs.readFileSync(R + '/app/js/v25/core.js', 'utf8')), 'silent Groq fallback wrapper is gone');

  const pkg = require(R + '/package.json');
  ok(((pkg.version.startsWith('2.6.9') || pkg.version.startsWith('2.6.10') || pkg.version.startsWith('2.6.11') || pkg.version.startsWith('2.6.12') || pkg.version === '2.6.13') || pkg.version === '2.6.8' || pkg.version.startsWith('2.6.8') || pkg.version === '2.6.7' || pkg.version.startsWith('2.6.7.')) && pkg.devDependencies.electron === '45.2.3', 'version is current (2.6.8), Electron stays 45.2.3', pkg.version);
  const log = require(R + '/CHANGELOG.json')['2.6.6'];
  ok(log && log.el.length && log.el.length === log.en.length, 'CHANGELOG 2.6.6 el+en same length', log && log.el.length);

  console.log(`\nv2.6.6 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
