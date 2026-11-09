'use strict';
const path = require('path');
const P = require('../main/paths');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); c ? passes++ : fails++; };

const HOME = 'C:\\Users\\admin';
const ENV = { USERPROFILE: HOME, SystemRoot: 'C:\\Windows' };
const opts = { env: ENV, platform: 'win32', home: HOME, pathMod: path.win32 };

console.log('paths (v2.6.5)');

ok(P.userHome(opts) === HOME, 'userHome prefers USERPROFILE on win32', P.userHome(opts));
ok(P.userHome({ env: { HOME: 'C:\\Users\\other' }, platform: 'win32' }) === 'C:\\Users\\other', 'userHome falls back to HOME if USERPROFILE missing');
ok(P.userHome({ env: { USERPROFILE: 'C:\\Users\\admin', HOME: 'C:\\Users\\other' }, platform: 'win32' }) === 'C:\\Users\\admin', 'USERPROFILE wins over HOME on win32');

ok(P.expandVars('%USERPROFILE%\\GPU-Voice-Studio\\models', opts) === HOME + '\\GPU-Voice-Studio\\models', 'expands %USERPROFILE%');
ok(P.expandVars('%userprofile%\\x', opts) === HOME + '\\x', 'expands %userprofile% case-insensitively');
ok(P.expandVars('D:\\keep\\me', opts) === 'D:\\keep\\me', 'leaves paths without vars alone');
ok(P.expandVars('%MISSING%\\x', opts) === '%MISSING%\\x', 'keeps unknown env vars');

ok(P.gvs('models\\ggml-large-v3-turbo-q5_0.bin', opts) === HOME + '\\GPU-Voice-Studio\\models\\ggml-large-v3-turbo-q5_0.bin', 'gvs models default');
ok(P.gvs('third_party\\llama\\llama-server.exe', opts) === HOME + '\\GPU-Voice-Studio\\third_party\\llama\\llama-server.exe', 'gvs llama-server default');
ok(P.gvs('third_party\\whisper.cpp\\build-vulkan\\bin\\Release\\whisper-server.exe', opts).endsWith('\\whisper-server.exe'), 'gvs whisper-server default');
ok(P.omni('models', opts) === HOME + '\\OmniVoice-Vulkan\\models', 'omni models default');

ok(P.looksAdminUserPath('C:\\Users\\Administrator\\GPU-Voice-Studio\\models\\a.gguf'), 'detects Administrator path');
ok(P.looksAdminUserPath('C:/Users/Administrator/GPU-Voice-Studio'), 'detects Administrator with forward slashes');
ok(!P.looksAdminUserPath('C:\\Users\\admin\\GPU-Voice-Studio\\models\\a.gguf'), 'does not flag C:\\Users\\admin');
ok(!P.looksAdminUserPath('C:\\Users\\administrator2\\x'), 'does not flag administrator2');

const present = new Set([
  'C:\\Users\\admin\\GPU-Voice-Studio\\models\\ggml-large-v3-turbo-q5_0.bin',
  'C:\\Users\\Administrator\\still-here.exe',
].map(s => s.toLowerCase()));
const exists = (p) => present.has(String(p).replace(/\//g, '\\').toLowerCase());
const mopts = Object.assign({}, opts, { exists });

let r = P.migrateAdminPath('C:\\Users\\Administrator\\GPU-Voice-Studio\\models\\ggml-large-v3-turbo-q5_0.bin', mopts);
ok(r.migrated && r.path === HOME + '\\GPU-Voice-Studio\\models\\ggml-large-v3-turbo-q5_0.bin', 'migrates missing Administrator path when target exists', r);

r = P.migrateAdminPath('C:\\Users\\Administrator\\still-here.exe', mopts);
ok(!r.migrated && r.path === 'C:\\Users\\Administrator\\still-here.exe', 'does not overwrite an Administrator path that still exists', r);

r = P.migrateAdminPath('C:\\Users\\Administrator\\GPU-Voice-Studio\\missing.bin', mopts);
ok(!r.migrated && /Administrator/.test(r.path), 'does not migrate when the rewritten path is also missing', r);

r = P.migrateAdminPath('C:\\Users\\admin\\GPU-Voice-Studio\\models\\ggml-large-v3-turbo-q5_0.bin', mopts);
ok(!r.migrated && r.path.startsWith(HOME), 'leaves a saved admin-user path untouched', r);

r = P.migrateAdminPath('%USERPROFILE%\\GPU-Voice-Studio\\models\\ggml-large-v3-turbo-q5_0.bin', mopts);
ok(!r.migrated && r.path === HOME + '\\GPU-Voice-Studio\\models\\ggml-large-v3-turbo-q5_0.bin', 'expands %USERPROFILE% without calling it a migration', r);

const bag = P.migrateAiPaths({
  'whisper.model': 'C:\\Users\\Administrator\\GPU-Voice-Studio\\models\\ggml-large-v3-turbo-q5_0.bin',
  'llama.exe': 'C:\\Users\\admin\\GPU-Voice-Studio\\third_party\\llama\\llama-server.exe',
}, mopts);
ok(bag.migrated && bag.paths['whisper.model'].startsWith(HOME) && bag.paths['llama.exe'].startsWith(HOME), 'migrateAiPaths rewrites only the stale field', bag);

const ai = { servers: { llama: { exe: 'C:\\Users\\Administrator\\GPU-Voice-Studio\\third_party\\llama\\llama-server.exe', model: 'keep-me' }, whisper: {} }, tts: {} };
// target exe does not exist in `present` → no migrate
const bag2 = P.migrateAiPaths(P.flattenAiPaths(ai), mopts);
ok(!bag2.migrated && /Administrator/.test(bag2.paths['llama.exe']) && bag2.paths['llama.model'] === 'keep-me', 'flatten+migrate leaves missing target and unrelated fields', bag2);

const cfg = P.resolveCfgPaths({ exe: '%USERPROFILE%\\GPU-Voice-Studio\\third_party\\llama\\llama-server.exe', model: 'C:\\Users\\admin\\x.gguf' }, ['exe', 'model'], opts);
ok(cfg.exe === HOME + '\\GPU-Voice-Studio\\third_party\\llama\\llama-server.exe', 'resolveCfgPaths expands exe', cfg);

console.log(fails ? `FAILED ${fails}/${fails + passes}` : `ok ${passes}`);
process.exit(fails ? 1 : 0);
