'use strict';
// API keys & tokens — kept out of nyx.json, encrypted with the OS keychain (Windows DPAPI via safeStorage).
// v2.6: crash-safe writes (tmp + fsync + rename, previous copy as .bak) and no silent plaintext fallback:
// if the OS encryption is unavailable the value is still stored (base64, 'p:') but the user is warned.
const { safeStorage } = require('electron');
const fs = require('fs'), path = require('path');
const { writeFileAtomicSync } = require('./fsutil');
let FILE = null, cache = {}, warn = () => {}, warnedPlain = false;
function readJson(f) { const o = JSON.parse(fs.readFileSync(f, 'utf8')); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('bad'); return o; }
function init(dir) {
  FILE = path.join(dir, 'secrets.json');
  if (!fs.existsSync(FILE)) { cache = {}; return; }
  try { cache = readJson(FILE); }
  catch (e) { // keep the damaged file, fall back to the last good copy
    try { fs.copyFileSync(FILE, FILE + '.corrupt-' + Date.now()); } catch (e2) {}
    try { cache = readJson(FILE + '.bak'); } catch (e3) { cache = {}; }
    console.warn('secrets.json unreadable — kept a .corrupt copy');
  }
}
function setWarn(fn) { warn = typeof fn === 'function' ? fn : () => {}; }
function available() { try { return !!safeStorage.isEncryptionAvailable(); } catch (e) { return false; } }
function enc(v) {
  try { if (available()) return 'e:' + safeStorage.encryptString(v).toString('base64'); } catch (e) { console.warn('safeStorage', e.message); }
  if (!warnedPlain) { warnedPlain = true; try { warn(require('./i18n').t('v26.secrets_plain')); } catch (e) {} console.warn('secrets: OS encryption unavailable — stored without encryption'); }
  return 'p:' + Buffer.from(v).toString('base64');
}
function dec(v) { if (!v) return ''; try { if (v.startsWith('e:')) return safeStorage.decryptString(Buffer.from(v.slice(2), 'base64')); if (v.startsWith('p:')) return Buffer.from(v.slice(2), 'base64').toString(); } catch (e) {} return ''; }
function get(k) { return dec(cache[k]); }
function set(k, v) {
  const next = { ...cache }; if (v) next[k] = enc(String(v)); else delete next[k];
  writeFileAtomicSync(FILE, JSON.stringify(next, null, 1), { backup: true, mode: 0o600 });
  cache = next;
}
function has(k) { return !!cache[k]; }
function list() { return Object.keys(cache); }
module.exports = { init, get, set, has, list, setWarn, available };
