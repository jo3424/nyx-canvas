'use strict';
// v2.6.9.2 unit tests: background requests without thinking (vision/frames/summaries), real cause on the chip,
// Embeddings → chat model warning, VRAM yellow only on Shared-GPU spill / speed drop (never from the % alone).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = path.join(__dirname, '..');
const el = require('../app/locales/el.json');
const en = require('../app/locales/en.json');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 800) : '')); c ? passes++ : fails++; };
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const GB = 1073741824;

const coreSrc = read('app/js/v2/core.js');
const grab = (name) => { const i = coreSrc.indexOf(name); if (i < 0) throw new Error('missing ' + name); return i; };
const ctx = { console, Math, Date, Object, Array, String, Number, RegExp, Error, JSON, localStorage: { getItem: () => null, setItem() {} }, t: (k) => k };
vm.createContext(ctx);
vm.runInContext(coreSrc.slice(grab('const NyxLimits = {'), grab('function stripThink(s, r)')) + '\nthis.NyxLimits = NyxLimits;', ctx);
const L = ctx.NyxLimits;
const snap = (used, shared, procs) => ({ gpu: { adapter: { total: 24 * GB, used: used * GB }, shared: shared == null ? null : shared * GB, procs: procs || [{ pid: 1, name: 'llama-server', vram: 22 * GB }] } });

// ---- VRAM ----
L._shared0 = null; L._speeds = {}; L._lastSpeedModel = null;
let w = L.vramWarn(snap(23.7, 0.3));
ok(w.state === 'ok' && w.high === true, '23,7/24 GB (99%) with Qwen+MTP+mmproj+32K → ok (percentage alone never warns)', w);
ok(L._shared0 === 0.3 * GB, 'first Shared GPU memory reading is the session baseline');
ok(L.vramWarn(snap(23.7, 0.6)).state === 'ok', '+0,3 GB shared → still ok (below +512 MB)');
w = L.vramWarn(snap(23.7, 1.0));
ok(w.state === 'spill' && Math.round(w.spill / 1048576) === 717, '+0,7 GB shared → spill', w);
ok(L.vramWarn(snap(23.7, 0.1)).state === 'ok' && L._shared0 === 0.1 * GB, 'lower shared reading becomes the new baseline');
ok(L.vramWarn(snap(23.7, null)).state === 'ok', 'no shared counter (Linux) → no spill guess');
L.noteSpeed('C:/m/Qwen3.8-27B-UD-Q4_K_XL.gguf', { predicted_n: 770, predicted_ms: 10000 });
ok(L.vramWarn(snap(23.7, 0.1)).state === 'ok', 'one speed sample → no judgement');
L.noteSpeed('Qwen3.8-27B-UD-Q4_K_XL.gguf', { predicted_n: 630, predicted_ms: 10000 });
ok(L.vramWarn(snap(23.7, 0.1)).state === 'ok', '77 → 63 t/s (82%) → ok (normal MTP variation)');
L.noteSpeed('Qwen3.8-27B-UD-Q4_K_XL.gguf', { predicted_n: 300, predicted_ms: 10000 });
w = L.vramWarn(snap(23.7, 0.1));
ok(w.state === 'slow' && Math.round(w.speed.best) === 77 && Math.round(w.speed.last) === 30, '77 → 30 t/s for the same model → slow', w);
ok(L.vramWarn(snap(20, 0.1, [{ pid: 2, name: 'llama-server', path: 'C:\\GPU-Voice-Studio\\llama-server.exe', vram: 4 * GB }])).state === 'gvs', 'Voice Studio on the GPU still warns');
ok(L.vramWarn({ gpu: { adapter: null } }).state === 'none' && L.vramWarn(null).state === 'none', 'no measurement → none');

// ---- Embeddings ----
for (const m of ['bge-m3-Q8_0.gguf', 'nomic-embed-text-v1.5', 'Qwen3-Embedding-0.6B-Q8_0', 'multilingual-e5-small', 'all-MiniLM-L6-v2', 'jina-embeddings-v3', 'mxbai-embed-large', 'snowflake-arctic-embed-m']) ok(L.isEmbedModel(m), 'embedding model: ' + m);
for (const m of ['Qwen3.8-27B-UD-Q4_K_XL', 'llama-krikri-8b-instruct-q8_0', 'gemma-4-12b-it', 'Qwen3.6-35B-A3B']) ok(!L.isEmbedModel(m), 'chat model flagged: ' + m);

// ---- attach.js wiring (static) ----
const at = read('app/js/v25/attach.js');
ok(/chat_template_kwargs: \{ enable_thinking: false \}/.test(at), 'background requests send chat_template_kwargs {enable_thinking:false}');
ok(/max_tokens: 0 \}/.test(at) && /if \(opts\.max_tokens !== 0\) body\.max_tokens/.test(at), 'empty → one re-ask without the max_tokens limit');
ok(!/catch \(er\) \{ if \(!e\.cancelHeavy\) e\.note = t\('v25\.at_novision'\)/.test(at) && !/d = await this\.vision\([^)]*\), e\); \} catch \(er\) \{\}/.test(at), 'vision / frame errors are no longer swallowed');
ok((at.match(/t\('v25\.at_novision'\)/g) || []).length === 1 && /er\.code === 'NOMODEL'\) return t\('v25\.at_novision'\)/.test(at), '«ρύθμισε τη θέση Όραση» only when the slot is empty (NOMODEL)');
ok(/data-note/.test(at), 'cause written on the chip (not only in the tooltip)');
ok(/hit && \(hit\.text \|\| hit\.summary\)\)/.test(at), 'failed image description is not served from the cache');
const hb = read('app/js/v2/hub.js');
ok(/embed-chat/.test(hb) && /isEmbedModel/.test(hb), 'Hub task row warns for a chat model in Embeddings');
ok(/v2692\.vram_rule_tip/.test(hb), 'VRAM tooltip states the rule (+512 MB / 70%)');
ok(/shared: g\.shared \?\? null/.test(read('main/perf.js')), 'perf snapshot passes Shared GPU memory through');
ok(/NyxLimits\.noteSpeed\(/.test(coreSrc), 'chat replies record t/s per model');
const ks = Object.keys(el).filter((k) => k.startsWith('v2692.'));
ok(ks.length === 10 && ks.every((k) => en[k]), 'el/en strings (10)', ks);

const pkg = require('../package.json');
ok(['2.6.9.2', '2.6.9.3', '2.6.10', '2.6.10.1', '2.6.11', '2.6.11.1'].includes(pkg.version) && pkg.devDependencies.electron === '45.2.3', 'version 2.6.9.2(+), Electron 45.2.3', pkg.version);
const CH = require('../CHANGELOG.json'); ok(['2.6.9.2', '2.6.9.3', '2.6.10', '2.6.10.1', '2.6.11', '2.6.11.1'].includes(Object.keys(CH)[0]) && CH['2.6.9.2'].el.length === 3 && CH['2.6.9.2'].en.length === 3, 'CHANGELOG 2.6.9.2 first, 3 items');
console.log(`\nv2.6.9.2 unit: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
