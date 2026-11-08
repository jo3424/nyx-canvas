'use strict';
// Main-process translations. Same locale files as the renderer (app/locales/*.json).
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'app', 'locales');
let lang = 'el'; const cache = {};
function dict(l) { if (!cache[l]) { try { cache[l] = JSON.parse(fs.readFileSync(path.join(DIR, l + '.json'), 'utf8')); } catch (e) { cache[l] = {}; } } return cache[l]; }
function t(k, vars) {
  let s = dict(lang)[k] ?? dict('el')[k] ?? k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(String(b ?? ''));
  return s.replace(/｛/g, '{').replace(/｝/g, '}');
}
const setLang = (l) => { lang = l === 'en' ? 'en' : 'el'; };
module.exports = { t, tr: t, setLang, getLang: () => lang, dict, DIR };
// Renderer access: ipcRenderer.sendSync('i18n:get', lang) → locale object.
let wired = false;
module.exports.wire = (ipcMain) => {
  if (wired) return; wired = true;
  ipcMain.on('i18n:get', (e, l) => { e.returnValue = dict(l === 'en' ? 'en' : 'el'); });
};
