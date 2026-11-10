'use strict';
// v2.6.5 unit tests: max_tokens from context, length continuation, thinking params, no LM Studio auto-probe,
// Gemma 4 12B recommended ctx (computed, not measured).
const http = require('http');
const L = require('../main/limits');
const ai = require('../main/ai');
const procs = require('../main/procs');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };

console.log('max_tokens computation');
let r = L.computeMaxTokens({ nCtx: 8192, promptTokens: 1000, reserve: 64 });
ok(r.max_tokens === 7128 && !r.omitted && r.reason === 'n_ctx_minus_prompt', 'n_ctx − prompt − reserve', r);

r = L.computeMaxTokens({ nCtx: 8192, promptTokens: 8200, reserve: 64 });
ok(r.omitted && r.available === 0 && r.reason === 'prompt_overflow', 'prompt larger than context → omit + overflow', r);

r = L.computeMaxTokens({ nCtx: 8192, promptTokens: 1000, reserve: 64, override: 2000 });
ok(r.max_tokens === 2000 && r.reason === 'user_override' && !r.clamped, 'user override below available is kept', r);

r = L.computeMaxTokens({ nCtx: 8192, promptTokens: 7000, reserve: 64, override: 5000 });
ok(r.clamped && r.max_tokens === 1128 && r.override === 5000, 'override above available is clamped and reported', r);

r = L.computeMaxTokens({ nCtx: null, promptTokens: 10 });
ok(r.omitted && r.max_tokens == null && r.reason === 'unknown_ctx', 'unknown n_ctx → omit rather than cap at 2000', r);

r = L.computeMaxTokens({ kind: 'cloud', cloudMax: 32768, promptTokens: 100 });
ok(r.max_tokens === 32768 && r.reason === 'documented_cloud_max', 'cloud uses documented max output', r);

r = L.computeMaxTokens({ kind: 'cloud', promptTokens: 100 });
ok(r.omitted && r.reason === 'no_documented_max', 'cloud with no documented max → omit, never a silent lower cap', r);

ok(L.cloudMaxOutput({ id: 'groq' }, 'llama-3.3-70b-versatile') == null, 'unverified Groq model is not given an invented cap');

console.log('continuation');
ok(L.shouldContinue('length', 0, 8).continue && !L.shouldContinue('stop', 0, 8).continue, 'finish=length continues, stop does not');
ok(L.shouldContinue('max_tokens', 7, 8).continue && L.shouldContinue('length', 8, 8).reachedCap, 'round cap prevents an infinite loop and is visible', L.shouldContinue('length', 8, 8));
ok(L.nextContinueMessages([{ role: 'user', content: 'hi' }], 'Hello').slice(-1)[0].role === 'assistant', 'continuation uses assistant prefill');
ok(L.mergePieces(['Hello wor', 'world!']) === 'Hello world!', 'overlapping pieces are merged', L.mergePieces(['Hello wor', 'world!']));
ok(L.mergePieces(['abc', 'def']) === 'abcdef', 'non-overlapping pieces concatenate');

console.log('thinking params + stripThink');
let th = L.thinkingParams({ enabled: false });
ok(th.chat_template_kwargs && th.chat_template_kwargs.enable_thinking === false && !('reasoning_format' in th) && !('reasoning_effort' in th), 'thinking-off sends only enable_thinking:false, no reasoning_format', th);
th = L.thinkingParams({ enabled: true, budget: 512 });
ok(th.chat_template_kwargs.enable_thinking === true && th.reasoning_budget === 512 && !th.reasoning_format, 'thinking on sends budget, not a silent share of the answer', th);
ok(L.isUnknownParamError(new Error('unknown field: chat_template_kwargs')), 'unknown-field errors are detected for retry');
ok(L.stripThink('visible <think>secret</think> end') === 'visible  end', 'stripThink removes <think>');
ok(L.stripThink('hello', 'hidden chain') === 'hello', 'reasoning_content stays out of the visible text');
const ex = L.extractThink('<|channel|>thought\nplan\n<|channel|>final\nAnswer', null);
ok(ex.text === 'Answer' && /plan/.test(ex.reasoning), 'Gemma channel tags: thought vs final', ex);
ok(L.extractThink('<reasoning>r</reasoning>ok').text === 'ok', 'reasoning tags stripped');
// v2.6.5.1: Gemma 4 (llama-server b11936) closes thought with <channel|>
const gemma = L.extractThink('<|channel>thought\n<channel|>Hi there!', null);
ok(gemma.text === 'Hi there!' && gemma.reasoning === '', 'Gemma 4 <|channel>thought + <channel|> leaves the answer, empty thought', gemma);
const gemmaBody = L.extractThink('<|channel>thought\nplan here\n<channel|>Hi there!', null);
ok(gemmaBody.text === 'Hi there!' && gemmaBody.reasoning === 'plan here', 'open+close with thought body', gemmaBody);
const trunc = L.extractThink('<|channel>thought\nI was thinking about this', null);
ok(trunc.text === '' && trunc.reasoning === 'I was thinking about this' && L.emptiedByThink('<|channel>thought\nI was thinking about this', trunc), 'open without close is truncated thinking', trunc);
ok(L.extractThink('<think>secret</think>end').text === 'end' && L.extractThink('<think>secret</think>end').reasoning === 'secret', '<think> still works next to channel tests');
const multi = L.extractThink('<|channel>thought\na\n<channel|>A\n<|channel>thought\nb\n<channel|>B', null);
ok(multi.text === 'A\nB' && multi.reasoning === 'a\n\nb', 'multiple thought/answer blocks', multi);
ok(!L.emptiedByThink('<|channel>thought\n<channel|>Hi there!', gemma), 'emptiedByThink is false when the answer survived');

console.log('LM Studio probe policy');
ok(!L.mayAutoUse({ id: 'lmstudio', enabled: true, userOn: false }), 'enabled-by-default LM Studio is not auto-used');
ok(L.mayAutoUse({ id: 'lmstudio', enabled: true, userOn: true }), 'explicitly configured LM Studio may be used');
ok(L.mayAutoUse({ id: 'llama', enabled: true }), 'llama-server stays usable');
ok(!L.mayAutoUse({ id: 'llama', enabled: false }), 'disabled providers stay out');
const provs = [{ id: 'lmstudio', enabled: true, base: 'http://localhost:1234/v1' }, { id: 'llama', enabled: true }];
const mig = L.migrateLmStudio(provs, { chat: { p: '', m: '' } });
ok(mig.changed && provs[0].enabled === false, 'migration disables unconfigured LM Studio', mig);
const provs2 = [{ id: 'lmstudio', enabled: true, base: 'http://localhost:1234/v1' }];
const mig2 = L.migrateLmStudio(provs2, { chat: { p: 'lmstudio', m: 'x' } });
ok(provs2[0].userOn && provs2[0].enabled, 'a task pinned to LM Studio is treated as user-configured', mig2);

console.log('Gemma 4 12B recommended ctx (computed, not measured)');
const weights = 6.71 * 2 ** 30; // 6.71 GiB, inventory / 09/11/2026 bench
const rec = L.recommendCtx({ meta: L.GEMMA4_12B, weightsBytes: weights, vramGiB: 24, kvType: 'f16', fa: true });
ok(rec.ctx === 262144 && rec.fitsMax && rec.note === 'computed_not_measured', 'Q4_0 12B on 24 GB fits the 256K train ctx with f16 KV + FA (computed)', { ctx: rec.ctx, fitsMax: rec.fitsMax, kv: rec.kvF16max });
ok(rec.kvF16max.total < 8 * 2 ** 30, 'hybrid KV at 256K f16 is well under 8 GiB thanks to SWA + K=V on global layers', rec.kvF16max);
ok(L.looksGemma412B('gemma-4-12B-it-Q4_0.gguf', 48, 262144), 'filename is recognised as Gemma 4 12B');
ok(L.parseNctx({ default_generation_settings: { n_ctx: 8192 } }) === 8192, 'parse n_ctx from /props shape');
ok(L.parseNctx({ data: [{ meta: { n_ctx: 32768 } }] }) === 32768, 'parse n_ctx from /v1/models meta');

const cfg = { ctx: 0, model: 'x.gguf' };
const resolved = L.resolveLaunchCtx(cfg, rec);
ok(resolved.omitted && resolved.ctx === 0, 'Nyx launch auto omits -c and does not apply 262144', resolved);
ok(L.resolveLaunchCtx({ ctx: 4096, ctxUserSet: true }, rec).ctx === 4096, 'a user-set ctx is kept');
const flags = L.llamaExtraFlags({ fa: true, kvType: 'q8_0' });
ok(flags.includes('-fa') && flags.includes('on') && flags.includes('--cache-type-k'), 'default flags add -fa on and optional q8_0 KV', flags);
ok(!L.llamaExtraFlags({ extra: '-fa off', kvType: 'f16' }).includes('-fa'), 'does not duplicate -fa when already in extra');

console.log('procs.argsFor auto ctx');
const args = procs.argsFor('llama', { model: '/tmp/m.gguf', port: 8080, ngl: 99, _resolvedCtx: 131072, jinja: true, fa: true });
ok(args.includes('-c') && args[args.indexOf('-c') + 1] === '131072' && args.includes('-fa'), 'argsFor uses resolved ctx and -fa', args);
const args0 = procs.argsFor('llama', { model: '/tmp/m.gguf', port: 8080, ngl: 99, ctx: 0, fa: false });
ok(!args0.includes('-c') || args0[args0.indexOf('-c') + 1] !== '0', 'ctx 0 without resolved value does not pass -c 0 as a cap', args0);

console.log('ai.prepare / props / tokenize against a stub llama-server');
(async () => {
  let tokenizeHits = 0, chatBodies = [];
  const srv = http.createServer((q, resp) => {
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
    if (q.url === '/props') return send(200, { default_generation_settings: { n_ctx: 8192 } });
    if (q.url === '/tokenize' && q.method === 'POST') {
      tokenizeHits++; let b = ''; q.on('data', d => b += d); q.on('end', () => send(200, { tokens: new Array(20).fill(1) }));
      return;
    }
    if (q.url === '/v1/chat/completions') {
      let b = ''; q.on('data', d => b += d); q.on('end', () => {
        const j = JSON.parse(b); chatBodies.push(j);
        if (j.chat_template_kwargs && q.headers['x-reject-think'] ) return send(400, { error: { message: 'unknown field: chat_template_kwargs' } });
        send(200, { choices: [{ message: { role: 'assistant', content: 'ok', reasoning_content: 'thoughts' }, finish_reason: 'stop' }], model: 'stub' });
      });
      return;
    }
    if (q.url === '/v1/models') return send(200, { data: [{ id: 'stub', meta: { n_ctx: 8192 } }] });
    send(404, 'no');
  });
  await new Promise(res => srv.listen(0, '127.0.0.1', res));
  const port = srv.address().port;
  const p = { id: 'llama', kind: 'local', base: `http://127.0.0.1:${port}/v1` };
  const prep = await ai.prepare(p, { messages: [{ role: 'user', content: 'hi' }], thinking: false });
  ok(prep.n_ctx === 8192 && prep.ctxSrc === 'props' && prep.promptTokens === 20 && prep.tokSrc === 'tokenize', 'prepare reads /props and /tokenize', prep);
  ok(prep.max_tokens === 8192 - 20 - 64 && !prep.omitted, 'prepare max_tokens = n_ctx − prompt − 64', prep);

  const ch = await ai.chat(p, { model: 'stub', messages: [{ role: 'user', content: 'hi' }], ...prep.body });
  ok(ch.finish === 'stop' && ch.reasoning === 'thoughts' && ch.message.reasoning_content === 'thoughts', 'chat returns finish + reasoning_content', ch);
  ok(chatBodies[0].chat_template_kwargs && chatBodies[0].chat_template_kwargs.enable_thinking === false && !('reasoning_format' in chatBodies[0]) && !('reasoning_effort' in chatBodies[0]), 'thinking-off body has no reasoning_format', chatBodies[0]);

  // unknown thinking fields → retry without them
  const srv2 = http.createServer((q, resp) => {
    if (q.url !== '/v1/chat/completions') { resp.statusCode = 404; return resp.end(); }
    let b = ''; q.on('data', d => b += d); q.on('end', () => {
      const j = JSON.parse(b);
      if (j.chat_template_kwargs || j.reasoning_format) { resp.statusCode = 400; return resp.end(JSON.stringify({ error: { message: 'unknown field: chat_template_kwargs' } })); }
      resp.setHeader('content-type', 'application/json');
      resp.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'retried' }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise(res => srv2.listen(0, '127.0.0.1', res));
  const p2 = { id: 'llama', kind: 'local', base: `http://127.0.0.1:${srv2.address().port}/v1` };
  const ch2 = await ai.chat(p2, { model: 'stub', messages: [{ role: 'user', content: 'hi' }], chat_template_kwargs: { enable_thinking: false }, reasoning_format: 'none' });
  ok(ch2.message.content === 'retried' && ch2.thinkingIgnored, 'server that rejects thinking fields is retried without them, no crash', ch2);

  srv.close(); srv2.close();
  console.log(fails ? `FAILED ${fails}/${fails + passes}` : `ok ${passes}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
