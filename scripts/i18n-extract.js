'use strict';
// One-shot codemod: replace Greek string/template literals in renderer + main code with t('key', {...}).
// Usage: node scripts/i18n-extract.js [--write]   (report → build/i18n-report.json)
// Lines containing "i18n-ignore" are left alone (e.g. Greek keyword lists used to parse user input).
const fs = require('fs'), path = require('path'), acorn = require('acorn');
const ROOT = path.join(__dirname, '..');
const GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]/;
const FILES = process.argv.filter(a => a.endsWith('.js') && !a.includes('i18n-extract'));
const write = process.argv.includes('--write');
const prefixOf = (f) => path.basename(f, '.js').replace(/[^a-z0-9]/gi, '');
const existing = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'app/locales/el.json'), 'utf8')); } catch (e) { return {}; } })();
const byText = new Map(Object.entries(existing).map(([k, v]) => [v, k]));
const out = { ...existing }; const report = [];
const counters = {};
function keyFor(prefix, text) {
  if (byText.has(text)) return byText.get(text);
  counters[prefix] = (counters[prefix] || 0);
  let k; do { k = `${prefix}.${String(++counters[prefix]).padStart(3, '0')}`; } while (out[k] !== undefined);
  out[k] = text; byText.set(text, k); return k;
}
function walk(node, parent, cb) {
  if (!node || typeof node.type !== 'string') return;
  cb(node, parent);
  for (const key of Object.keys(node)) { if (key === 'parent') continue; const v = node[key]; if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, node, cb)); else if (v && typeof v.type === 'string') walk(v, node, cb); }
}
const isTCall = (p) => p && p.type === 'CallExpression' && p.callee.type === 'Identifier' && p.callee.name === 't';
for (const rel of FILES) {
  const file = path.join(ROOT, rel); const src = fs.readFileSync(file, 'utf8'); const lines = src.split('\n');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
  const edits = []; const prefix = prefixOf(rel);
  walk(ast, null, (n, p) => {
    if (isTCall(p)) return;
    const line = lines[n.loc.start.line - 1] || '';
    if (/i18n-ignore/.test(line)) return;
    if (n.type === 'Literal' && typeof n.value === 'string' && !n.regex && GREEK.test(n.value)) {
      if (p && p.type === 'Property' && p.key === n && !p.computed) return; // object key
      if (p && (p.type === 'ImportDeclaration' || p.type === 'ExpressionStatement' && p.directive)) return;
      const k = keyFor(prefix, n.value);
      edits.push({ s: n.start, e: n.end, r: `t('${k}')`, k, text: n.value, line: n.loc.start.line });
    } else if (n.type === 'TemplateLiteral' && n.quasis.some(q => GREEK.test(q.value.cooked)) && !(p && p.type === 'TaggedTemplateExpression')) {
      const names = []; let text = '';
      n.quasis.forEach((q, i) => {
        text += q.value.cooked.replace(/[{}]/g, (c) => c === '{' ? '｛' : '｝');
        if (i < n.expressions.length) {
          const ex = n.expressions[i]; let nm = ex.type === 'Identifier' ? ex.name : ex.type === 'MemberExpression' && !ex.computed ? ex.property.name : 'v' + i;
          while (names.find(x => x.nm === nm)) nm += i;
          names.push({ nm, code: src.slice(ex.start, ex.end) }); text += '{' + nm + '}';
        }
      });
      const k = keyFor(prefix, text);
      const vars = names.length ? `, { ${names.map(x => (x.code === x.nm ? x.nm : `${x.nm}: ${x.code}`)).join(', ')} }` : '';
      edits.push({ s: n.start, e: n.end, r: `t('${k}'${vars})`, k, text, line: n.loc.start.line, tpl: true });
    }
  });
  // drop nested edits (template inside an already-replaced template expression)
  edits.sort((a, b) => a.s - b.s);
  const flat = []; for (const e of edits) { const last = flat[flat.length - 1]; if (last && e.s < last.e) { if (e.e - e.s > last.e - last.s) flat[flat.length - 1] = e; continue; } flat.push(e); }
  // nested templates inside replaced template: expressions keep original code incl. inner Greek literals → second pass handles them
  let res = src; for (const e of flat.slice().reverse()) res = res.slice(0, e.s) + e.r + res.slice(e.e);
  for (const e of flat) report.push({ file: rel, line: e.line, key: e.k, text: e.text, ctx: lines[e.line - 1].trim().slice(0, 200) });
  if (write) fs.writeFileSync(file, res);
  console.log(rel, flat.length);
}
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build/i18n-report.json'), JSON.stringify(report, null, 1));
if (write) { fs.mkdirSync(path.join(ROOT, 'app/locales'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'app/locales/el.json'), JSON.stringify(out, null, 1)); }
console.log('strings', Object.keys(out).length - Object.keys(existing).length, 'new; edits', report.length);
