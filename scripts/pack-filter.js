'use strict';
// Single source of truth for "what is app code": used by pack.js (electron packager ignore) and make-patch.js.
const fs = require('fs'), path = require('path');
const IGNORE = [/^\/(node_modules|tests|shots|dist|scripts|build|\.git)(\/|$)/, /\.md$/, /^\/\.gitignore$/, /^\/package-lock\.json$/];
const ignored = (rel) => { const p = '/' + rel.replace(/\\/g, '/'); return IGNORE.some(r => r.test(p)); };
// Copy the app-code part of srcDir into outDir (fresh).
function copyFiltered(srcDir, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(srcDir, rel), { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name; if (ignored(r) || ignored(r + '/')) continue;
      if (e.isDirectory()) walk(r); else if (e.isFile()) { const o = path.join(outDir, r); fs.mkdirSync(path.dirname(o), { recursive: true }); fs.copyFileSync(path.join(srcDir, r), o); }
    }
  };
  walk(''); return outDir;
}
module.exports = { IGNORE, ignored, copyFiltered };
