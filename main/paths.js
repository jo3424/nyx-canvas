'use strict';
// v2.6.5: resolve %USERPROFILE% / env vars, and migrate stale \Users\Administrator\ paths
// only when the saved path is missing and the rewritten path exists.
const fs = require('fs');
const path = require('path');
const os = require('os');

function userHome(opts = {}) {
  const env = opts.env || process.env;
  const plat = opts.platform || process.platform;
  if (plat === 'win32') {
    const p = env.USERPROFILE || env.HOME || (opts.home != null ? opts.home : os.homedir());
    return p ? String(p) : '';
  }
  return String(opts.home != null ? opts.home : (env.HOME || os.homedir() || ''));
}

function expandVars(p, opts = {}) {
  if (p == null || p === '') return p;
  const env = Object.assign({}, opts.env || process.env);
  const home = userHome(opts);
  if (home) {
    if (env.USERPROFILE == null || env.USERPROFILE === '') env.USERPROFILE = home;
    if (env.HOME == null || env.HOME === '') env.HOME = home;
  }
  return String(p).replace(/%([^%]+)%/g, (m, k) => {
    if (env[k] != null && String(env[k]) !== '') return String(env[k]);
    const up = env[k.toUpperCase()];
    if (up != null && String(up) !== '') return String(up);
    const low = env[k.toLowerCase()];
    if (low != null && String(low) !== '') return String(low);
    return m;
  });
}

function looksAdminUserPath(p) {
  const s = String(p || '').replace(/\//g, '\\');
  return /(?:^|[\\])Users\\Administrator(?:[\\]|$)/i.test(s);
}

function rewriteAdminToHome(p, home) {
  if (!home) return String(p);
  // "C:\Users\Administrator\..." or ".../Users/Administrator/..." → home + rest
  return String(p).replace(/([A-Za-z]:[\\/])?Users[\\/]Administrator(?=[\\/]|$)/i, () => home);
}

function exists(p, existsFn) {
  if (!p) return false;
  try { return existsFn ? !!existsFn(p) : fs.existsSync(p); } catch (e) { return false; }
}

function migrateAdminPath(p, opts = {}) {
  const log = [];
  const expanded = expandVars(p, opts);
  if (expanded == null || expanded === '') return { path: expanded, migrated: false, from: p, log };
  if (!looksAdminUserPath(expanded)) return { path: expanded, migrated: false, from: p, log };
  const ex = (x) => exists(x, opts.exists);
  if (ex(expanded)) {
    log.push('kept existing Administrator path: ' + expanded);
    return { path: expanded, migrated: false, from: p, log };
  }
  const home = userHome(opts);
  if (!home) return { path: expanded, migrated: false, from: p, log };
  const next = rewriteAdminToHome(expanded, home);
  if (!next || next === expanded) return { path: expanded, migrated: false, from: p, log };
  if (ex(next)) {
    log.push('migrated missing Administrator path: ' + expanded + ' → ' + next);
    return { path: next, migrated: true, from: expanded, to: next, log };
  }
  log.push('did not migrate Administrator path (target missing): ' + expanded + ' ↛ ' + next);
  return { path: expanded, migrated: false, from: p, log };
}

function resolveForUse(p, opts = {}) {
  return migrateAdminPath(p, opts).path;
}

function gvs(rel, opts = {}) {
  const home = userHome(opts);
  const pth = opts.pathMod || path;
  return rel ? pth.join(home, 'GPU-Voice-Studio', rel) : pth.join(home, 'GPU-Voice-Studio');
}

function omni(rel, opts = {}) {
  const home = userHome(opts);
  const pth = opts.pathMod || path;
  return rel ? pth.join(home, 'OmniVoice-Vulkan', rel) : pth.join(home, 'OmniVoice-Vulkan');
}

const AI_PATH_FIELDS = [
  ['llama.exe', ['servers', 'llama', 'exe']],
  ['llama.model', ['servers', 'llama', 'model']],
  ['whisper.exe', ['servers', 'whisper', 'exe']],
  ['whisper.model', ['servers', 'whisper', 'model']],
  ['sd.exe', ['servers', 'sd', 'exe']],
  ['sd.modelDir', ['servers', 'sd', 'modelDir']],
  ['sd.loraDir', ['servers', 'sd', 'loraDir']],
  ['sd.upscaleDir', ['servers', 'sd', 'upscaleDir']],
  ['tts.exe', ['tts', 'exe']],
  ['tts.model', ['tts', 'model']],
  ['tts.tokenizer', ['tts', 'tokenizer']],
  ['tts.refAudio', ['tts', 'refAudio']],
];

function getDeep(obj, keys) {
  let o = obj;
  for (const k of keys) { if (!o || typeof o !== 'object') return undefined; o = o[k]; }
  return o;
}
function setDeep(obj, keys, val) {
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = val;
}

function flattenAiPaths(ai) {
  const bag = {};
  if (!ai) return bag;
  for (const [id, keys] of AI_PATH_FIELDS) {
    const v = getDeep(ai, keys);
    if (typeof v === 'string') bag[id] = v;
  }
  return bag;
}

function migrateAiPaths(bag, opts = {}) {
  const out = { paths: {}, log: [], migrated: false };
  for (const [k, v] of Object.entries(bag || {})) {
    const r = migrateAdminPath(v, opts);
    out.paths[k] = r.path;
    if (r.log && r.log.length) out.log.push(...r.log);
    if (r.migrated) out.migrated = true;
  }
  return out;
}

function applyMigratedAi(ai, result) {
  if (!ai || !result || !result.paths) return ai;
  for (const [id, keys] of AI_PATH_FIELDS) {
    if (result.paths[id] != null) setDeep(ai, keys, result.paths[id]);
  }
  return ai;
}

function resolveCfgPaths(cfg, keys, opts = {}) {
  if (!cfg) return cfg;
  const out = Object.assign({}, cfg);
  for (const k of keys) {
    if (typeof out[k] === 'string' && out[k]) out[k] = resolveForUse(out[k], opts);
  }
  return out;
}

module.exports = {
  userHome, expandVars, looksAdminUserPath, rewriteAdminToHome,
  migrateAdminPath, resolveForUse, gvs, omni,
  flattenAiPaths, migrateAiPaths, applyMigratedAi, resolveCfgPaths, AI_PATH_FIELDS,
};
