'use strict';
// Reports t('key') calls where `t` is shadowed by a local binding (would call the wrong thing).
const fs = require('fs'), acorn = require('acorn');
let bad = 0;
function bindsT(pattern) { if (!pattern) return false; switch (pattern.type) { case 'Identifier': return pattern.name === 't'; case 'ObjectPattern': return pattern.properties.some(p => bindsT(p.value || p.argument)); case 'ArrayPattern': return pattern.elements.some(bindsT); case 'AssignmentPattern': return bindsT(pattern.left); case 'RestElement': return bindsT(pattern.argument); } return false; }
function scopeDeclaresT(node) {
  // function params, block-level declarations directly in this node's body
  if (/Function/.test(node.type) && node.params.some(bindsT)) return true;
  if (node.type === 'CatchClause' && bindsT(node.param)) return true;
  const body = node.type === 'BlockStatement' || node.type === 'Program' ? node.body : /Function/.test(node.type) && node.body.type === 'BlockStatement' ? node.body.body : (node.type === 'ForStatement' || node.type === 'ForOfStatement' || node.type === 'ForInStatement') ? [node.init || node.left].filter(Boolean) : null;
  if (!body) return false;
  for (const s of body) { if (s && s.type === 'VariableDeclaration' && s.declarations.some(d => bindsT(d.id))) return true; if (s && s.type === 'FunctionDeclaration' && s.id && s.id.name === 't') return true; }
  return false;
}
function walk(node, stack, file, isGlobal) {
  if (!node || typeof node.type !== 'string') return;
  const pushes = node.type !== 'Program' && scopeDeclaresT(node);
  if (pushes) stack.push(node);
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 't' && node.arguments[0] && node.arguments[0].type === 'Literal' && /^[a-z0-9]+\.\d{3}$/.test(node.arguments[0].value) && stack.length) { bad++; console.log(file + ':' + node.loc.start.line, 'shadowed t →', node.arguments[0].value); }
  for (const k of Object.keys(node)) { const v = node[k]; if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, stack, file)); else if (v && typeof v.type === 'string') walk(v, stack, file); }
  if (pushes) stack.pop();
}
for (const f of process.argv.slice(2)) { const src = fs.readFileSync(f, 'utf8'); walk(acorn.parse(src, { ecmaVersion: 'latest', locations: true, allowHashBang: true }), [], f); }
console.log(bad ? bad + ' problems' : 'ok'); process.exit(bad ? 1 : 0);
