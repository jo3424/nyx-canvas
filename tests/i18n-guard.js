'use strict';
// Guard: no hardcoded Greek in UI/main code (strings must live in app/locales/*.json),
// and en.json must cover every el.json key with the same {placeholders}.
const fs = require('fs'), path = require('path'), acorn = require('acorn');
const ROOT = path.join(__dirname, '..');
const GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]/;
const files = [
  ...fs.readdirSync(path.join(ROOT, 'app/js')).filter(f => f.endsWith('.js') && f !== 'i18n.js').map(f => 'app/js/' + f),
  ...fs.readdirSync(path.join(ROOT, 'app/js/v2')).filter(f => f.endsWith('.js')).map(f => 'app/js/v2/' + f),
  ...fs.readdirSync(path.join(ROOT, 'app/js/v25')).filter(f => f.endsWith('.js')).map(f => 'app/js/v25/' + f),
  'app/widget.js', 'app/capture.js', 'app/sticky.js', 'main.js', 'boot.js', 'preload.js',
  ...fs.readdirSync(path.join(ROOT, 'main')).filter(f => f.endsWith('.js')).map(f => 'main/' + f),
];
let fail = 0; const bad = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); const lines = src.split('\n');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true, allowReturnOutsideFunction: true });
  const walk = (n, parent) => {
    if (!n || typeof n.type !== 'string') return;
    let txt = null;
    if (n.type === 'Literal' && typeof n.value === 'string') txt = n.value;
    else if (n.type === 'TemplateElement') txt = n.value.cooked || '';
    if (txt && GREEK.test(txt)) {
      const isKey = parent && parent.type === 'Property' && parent.key === n && !parent.computed;
      const ln = n.loc.start.line;
      if (!isKey && !/i18n-ignore/.test(lines[ln - 1])) bad.push(`${f}:${ln} ${JSON.stringify(txt.slice(0, 60))}`);
    }
    for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(c => walk(c, n)); else if (v && typeof v.type === 'string') walk(v, n); }
  };
  walk(ast, null);
}
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
ok(!bad.length, `no hardcoded Greek in ${files.length} code files` + (bad.length ? '\n    ' + bad.slice(0, 30).join('\n    ') : ''));
const el = require('../app/locales/el.json'), en = require('../app/locales/en.json');
const miss = Object.keys(el).filter(k => !(k in en));
ok(!miss.length, `en.json covers all ${Object.keys(el).length} keys` + (miss.length ? ' — missing: ' + miss.slice(0, 20).join(', ') : ''));
const ph = s => (String(s).match(/\{[A-Za-z_0-9]+\}/g) || []).sort().join();
const phBad = Object.keys(el).filter(k => k in en && ph(el[k]) !== ph(en[k]));
ok(!phBad.length, 'placeholders match between el/en' + (phBad.length ? ': ' + phBad.join(', ') : ''));
const grEn = Object.keys(en).filter(k => GREEK.test(en[k]) && !/^panels\.029$/.test(k));
ok(grEn.length === 0, 'en.json has no Greek text' + (grEn.length ? ': ' + grEn.slice(0, 20).join(', ') : ''));
// every t('key') used in code exists in el.json
const used = new Set(); for (const f of files) for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/\btr?\('([a-z0-9_]+\.[a-z0-9_]+)'(?!\s*\+)/g)) used.add(m[1]);
const unk = [...used].filter(k => !(k in el));
ok(!unk.length, `all ${used.size} t() keys exist` + (unk.length ? ': ' + unk.join(', ') : ''));
// plugin manifests carry English
const pd = path.join(ROOT, 'app/plugins'); const noEn = fs.readdirSync(pd).filter(d => { try { const m = require(path.join(pd, d, 'manifest.json')); return !m.name_en || !m.description_en; } catch (e) { return false; } });
ok(!noEn.length, 'plugin manifests have name_en/description_en' + (noEn.length ? ': ' + noEn.join(', ') : ''));
console.log(fail ? `\n${fail} FAILED` : '\ni18n guard passed'); process.exit(fail ? 1 : 0);
