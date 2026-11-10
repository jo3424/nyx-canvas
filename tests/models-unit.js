// v2.6.3 «Μοντέλα & οδηγίες»: static checks of the in-app model picks and hint texts (no Electron needed).
const fs = require('fs'), path = require('path'), vm = require('vm');
const R = path.join(__dirname, '..');
const el = require(R + '/app/locales/el.json'), en = require(R + '/app/locales/en.json');
let pass = 0, fail = 0; const ok = (n, c) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };
// evaluate MODEL_RECS from core.js with a fake t()
const src = fs.readFileSync(R + '/app/js/v2/core.js', 'utf8');
const block = src.slice(src.indexOf('const HF_URL'), src.indexOf('function aiDefaults'));
const ctx = { t: (k) => el[k] === undefined ? '<<missing ' + k + '>>' : el[k] }; vm.createContext(ctx);
vm.runInContext(block + ';this.MODEL_RECS=MODEL_RECS;this.MODEL_FIT_NOTE=MODEL_FIT_NOTE;', ctx);
const recs = ctx.MODEL_RECS, by = Object.fromEntries(recs.map(r => [r.id, r]));
const files = (r) => (r.files || []).map(f => f[0]);
ok('no missing locale keys in MODEL_RECS', !JSON.stringify(recs).includes('<<missing') && !ctx.MODEL_FIT_NOTE.includes('<<missing'));
ok('fast = unsloth Qwen3.8-27B UD-Q4_K_M + optional MTP', by.fast?.star && by.fast.url === 'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF' && files(by.fast).includes('Qwen3.8-27B-UD-Q4_K_M.gguf') && by.fast.files.some(f => f[0] === 'MTP/mtp-Qwen3.8-27B-Q4_0.gguf' && f[2] === 'opt'));
ok('vision = same file + mmproj-F16', files(by.vision).includes('Qwen3.8-27B-UD-Q4_K_M.gguf') && files(by.vision).includes('mmproj-F16.gguf'));
ok('uncensored = orcarouter Q4_K_M, alt huihui UD-DW', by.uncensored?.url.endsWith('orcarouter/Qwen3.8-27B-Uncensored-GGUF') && files(by.uncensored).includes('Qwen3.8-27B-Uncensored-Q4_K_M.gguf') && by.uncensored.alt.files[0][0] === 'Huihui-Qwen3.8-27B-abliterated-UD-DW-Q4_K_M.gguf');
ok('greek = Krikri 8B', /Krikri/.test(by.greek?.name) && files(by.greek).includes('llama-krikri-8b-instruct-q4_k_m.gguf'));
ok('stt = ggml-large-v3 first, turbo as alt', by.stt?.files[0][0] === 'ggml-large-v3.bin' && by.stt.files[1][0] === 'ggml-large-v3-turbo.bin');
ok('sizes are numbers in GB', recs.every(r => (r.files || []).every(f => typeof f[1] === 'number' && f[1] > 0 && f[1] < 30)));
ok('every slot has a plain-language explanation (why)', ['fast', 'vision', 'uncensored', 'greek', 'stt'].every(k => (by[k].why || '').length > 80));
ok('only https Hugging Face links', recs.every(r => !r.url || r.url.startsWith('https://huggingface.co/')));
ok('fit note: fast + uncensored swap', /δεν χωράνε/.test(ctx.MODEL_FIT_NOTE) && /Router/.test(ctx.MODEL_FIT_NOTE) && /δεν κατεβάζει/.test(ctx.MODEL_FIT_NOTE));
for (const [L, d] of [['el', el], ['en', en]]) {
  ok(L + ': vision hints no longer point to Gemma', !/gemma/i.test(d['v25.rt_vision_d'] + d['v25.at_novision'] + d['core.009'] + d['core.010']));
  ok(L + ': vision hint mentions mmproj', /mmproj/.test(d['v25.rt_vision_d']) && /mmproj/.test(d['v25.rt_nommproj']));
  ok(L + ': fast hint = Qwen3.8-27B', /Qwen3\.8-27B/.test(d['v25.rt_fast_d']) && !/Qwen3\.6/.test(d['v25.rt_fast_d']));
  ok(L + ': uncensored hint = orcarouter', /orcarouter/.test(d['v25.rt_uncensored_d']));
  ok(L + ': HauhauCS is not called not-recommended', Object.values(d).filter(v => /hauhau/i.test(v)).every(v => !/(δεν είναι πια η σύσταση|no longer the pick|δεν προτείνεται)/.test(v)));
  ok(L + ': no Markdown backticks in pick texts', Object.entries(d).filter(([k]) => k.startsWith('core.r_')).every(([, v]) => !v.includes('`')));
}
const hub = fs.readFileSync(R + '/app/js/v2/hub.js', 'utf8');
ok('hub cards open the page in the browser, never download', /API\.openExternal\(url\)/.test(hub.slice(hub.indexOf('recCard'), hub.indexOf('  build(body) {'))) && !/download|fetch\(/i.test(hub.slice(hub.indexOf('recFiles'), hub.indexOf('  build(body) {'))));
ok('package.json version 2.6.6', require(R + '/package.json').version === '2.6.6');
ok('CHANGELOG has 2.6.5 el+en', (() => { const c = require(R + '/CHANGELOG.json')['2.6.5']; return c && c.el.length && c.el.length === c.en.length; })());
ok('CHANGELOG has 2.6.5.1 el+en', (() => { const c = require(R + '/CHANGELOG.json')['2.6.5.1']; return c && c.el.length && c.el.length === c.en.length; })());
ok('CHANGELOG has 2.6.5.2 el+en', (() => { const c = require(R + '/CHANGELOG.json')['2.6.5.2']; return c && c.el.length && c.el.length === c.en.length; })());
ok('CHANGELOG has 2.6.6 el+en', (() => { const c = require(R + '/CHANGELOG.json')['2.6.6']; return c && c.el.length && c.el.length === c.en.length; })());
console.log(`models-unit: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
