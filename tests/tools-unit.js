'use strict';
// Tool detection unit tests against a mocked Windows file system + mocked process exec (no real disk/PATH used).
const path = require('path'), fs = require('fs'), os = require('os');
const td = require('../main/tooldetect');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); c ? passes++ : fails++; };
const W = path.win32; const GB = 1024 ** 3, MB = 1024 ** 2;

// ---- in-memory FS (win32 paths, case-insensitive like NTFS) ----
function mockFs(files) {
  const F = new Map(), D = new Map(); const k = (p) => W.normalize(p).replace(/\\+$/, '').toLowerCase();
  const addDir = (p) => { const key = k(p); if (!D.has(key)) { D.set(key, { name: W.basename(p) || p, kids: new Map() }); const par = W.dirname(p); if (par !== p) { addDir(par); D.get(k(par)).kids.set(W.basename(p).toLowerCase(), { name: W.basename(p), dir: true }); } } };
  for (const [p, v] of Object.entries(files)) {
    if (p.endsWith('\\')) { addDir(p.slice(0, -1) || p); continue; }
    const o = typeof v === 'number' ? { size: v, data: '' } : { size: Buffer.byteLength(String(v)), data: String(v) };
    F.set(k(p), o); addDir(W.dirname(p)); D.get(k(W.dirname(p))).kids.set(W.basename(p).toLowerCase(), { name: W.basename(p), dir: false });
  }
  const calls = { readdir: 0 };
  const stat = (p) => { const key = k(p); if (F.has(key)) return { isDirectory: () => false, isFile: () => true, size: F.get(key).size }; if (D.has(key)) return { isDirectory: () => true, isFile: () => false, size: 0 }; const e = new Error('ENOENT ' + p); e.code = 'ENOENT'; throw e; };
  const readdir = (p) => { calls.readdir++; const d = D.get(k(p)); if (!d) { const e = new Error('ENOENT ' + p); e.code = 'ENOENT'; throw e; } return [...d.kids.values()]; };
  const ent = (x) => ({ name: x.name, isDirectory: () => x.dir, isFile: () => !x.dir });
  return {
    calls,
    fs: { existsSync: (p) => F.has(k(p)) || D.has(k(p)), statSync: stat, readdirSync: (p) => readdir(p).map(x => x.name), readFileSync: (p) => { const f = F.get(k(p)); if (!f) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return f.data; } },
    fsp: { readdir: async (p, o) => readdir(p).map(x => o && o.withFileTypes ? ent(x) : x.name), stat: async (p) => stat(p) },
  };
}
// ---- mocked exec: "where", "--version", py launcher, registry ----
function mockExec(table, log = []) {
  return async (cmd, args) => {
    const key = [W.basename(cmd).toLowerCase(), ...args].join(' '); log.push(key);
    for (const [re, out] of table) if (re.test(key) || re.test(cmd + ' ' + args.join(' '))) return typeof out === 'function' ? out() : { err: null, out };
    return { err: new Error('not found: ' + key), out: '' };
  };
}
const H = 'C:\\Users\\jonh', LA = H + '\\AppData\\Local';
const FILES = {
  'C:\\ffmpeg\\bin\\ffmpeg.exe': 120 * MB, 'C:\\ffmpeg\\bin\\ffprobe.exe': 110 * MB,
  'C:\\Windows\\System32\\vulkan-1.dll': 1500000,
  'C:\\VulkanSDK\\1.3.290.0\\Bin\\vulkaninfo.exe': 900000, 'C:\\VulkanSDK\\1.4.304.1\\Bin\\vulkaninfo.exe': 900000,
  'C:\\Python312\\python.exe': 100000, [LA + '\\Programs\\Python\\Python311\\python.exe']: 100000, [LA + '\\Microsoft\\WindowsApps\\python.exe']: 0,
  'C:\\Program Files\\Git\\cmd\\git.exe': 50000,
  [H + '\\GPU-Voice-Studio\\third_party\\llama\\llama-server.exe']: 9 * MB,
  [H + '\\GPU-Voice-Studio\\third_party\\whisper.cpp\\build-vulkan\\bin\\Release\\whisper-server.exe']: 4 * MB,
  [H + '\\GPU-Voice-Studio\\models\\ggml-large-v3-turbo.bin']: 1.6 * GB,
  'C:\\ComfyUI\\main.py': 'print()', 'C:\\ComfyUI\\comfyui_version.py': '__version__ = "0.3.40"\n',
  'C:\\ComfyUI\\models\\checkpoints\\sdxl.safetensors': 6.9 * GB, 'C:\\ComfyUI\\models\\vae\\vae.safetensors': 300 * MB,
  [H + '\\.lmstudio\\settings.json']: JSON.stringify({ downloadsFolder: 'D:\\LLM\\lmstudio' }),
  'D:\\LLM\\lmstudio\\lmstudio-community\\Qwen3-8B-GGUF\\Qwen3-8B-Q4_K_M.gguf': 5 * GB,
  'D:\\LLM\\lmstudio\\bartowski\\gemma-3-12b\\gemma-3-12b-Q4_K_M.gguf': 7 * GB,
  [LA + '\\Programs\\Ollama\\ollama.exe']: 30 * MB,
  [H + '\\.ollama\\models\\manifests\\registry.ollama.ai\\library\\llama3.1\\8b']: '{}', [H + '\\.ollama\\models\\manifests\\registry.ollama.ai\\library\\qwen3\\8b']: '{}',
  'E:\\hf\\hub\\models--Qwen--Qwen3-8B\\snapshots\\abc\\model.safetensors': 4 * GB, 'E:\\hf\\hub\\models--openai--whisper-large-v3\\x': 1,
  'E:\\Models\\deep\\a\\b\\c\\mistral-7b.Q5_K_M.gguf': 5 * GB, 'E:\\Models\\tiny.gguf': 10 * MB, 'E:\\Models\\notes.txt': 'x',
  'E:\\Windows\\skip\\hidden.gguf': 3 * GB, 'E:\\proj\\node_modules\\x\\bad.gguf': 3 * GB, 'C:\\$Recycle.Bin\\old.gguf': 3 * GB,
  'D:\\SD\\ggml-model-q8.bin': 200 * MB,
};
const ENV = { SystemRoot: 'C:\\Windows', LOCALAPPDATA: LA, ProgramFiles: 'C:\\Program Files', HF_HOME: 'E:\\hf', USERPROFILE: H };
const EXEC = [
  [/^where ffmpeg$/, 'C:\\ffmpeg\\bin\\ffmpeg.exe\r\n'],
  [/^ffmpeg\.exe -version/, 'ffmpeg version 7.1.1-full_build-www.gyan.dev Copyright (c) 2000-2025\r\nbuilt with gcc'],
  [/^ffprobe\.exe -version/, 'ffprobe version 7.1.1-full_build-www.gyan.dev'],
  [/^where python$/, 'C:\\Python312\\python.exe\r\n' + LA + '\\Microsoft\\WindowsApps\\python.exe\r\n'],
  [/^py -0p$/, ' -V:3.12 *        C:\\Python312\\python.exe\r\n -V:3.11          ' + LA + '\\Programs\\Python\\Python311\\python.exe\r\n'],
  [/^reg query HKCU\\Software\\Python/, 'HKEY_CURRENT_USER\\Software\\Python\\PythonCore\\3.11\\InstallPath\r\n    ExecutablePath    REG_SZ    ' + LA + '\\Programs\\Python\\Python311\\python.exe\r\n'],
  [/^reg query HKLM\\SOFTWARE\\Khronos/, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Khronos\\Vulkan\\Drivers\r\n    C:\\Windows\\System32\\DriverStore\\FileRepository\\u0400000.inf_amd64\\amdvlk64.json    REG_DWORD    0x0\r\n'],
  [/Python311.*--version$/, 'Python 3.11.9'],
  [/^C:\\Python312\\python\.exe --version$/, 'Python 3.12.4'],
  [/^git\.exe --version$/, 'git version 2.47.1.windows.1'],
  [/^llama-server\.exe --version$/, 'version: 6123 (abcdef0)\nbuilt with MSVC'],
  [/^whisper-server\.exe --help$/, 'usage: whisper-server [options]'],
  [/^ollama\.exe --version$/, 'ollama version is 0.12.3'],
];
(async () => {
  console.log('detection (mocked Windows box)');
  const M = mockFs(FILES); const log = [];
  const over = { fs: M.fs, fsp: M.fsp, platform: 'win32', env: ENV, home: H, exec: mockExec(EXEC, log), http: async (u) => /11434/.test(u) };
  const r = await td.detect(over, {}); const T = Object.fromEntries(r.tools.map(x => [x.id, x]));
  ok(T.ffmpeg.found && T.ffmpeg.path === 'C:\\ffmpeg\\bin\\ffmpeg.exe' && /^7\.1\.1/.test(T.ffmpeg.version) && T.ffmpeg.size === 120 * MB, 'ffmpeg: PATH, version, size', T.ffmpeg);
  ok(T.ffprobe.found && T.ffprobe.path === 'C:\\ffmpeg\\bin\\ffprobe.exe', 'ffprobe via known folder (not on PATH)', T.ffprobe);
  ok(T['vulkan-rt'].found && /vulkan-1\.dll$/.test(T['vulkan-rt'].path) && /1 ICD/.test(T['vulkan-rt'].version) && T['vulkan-rt'].items[0].name === 'amdvlk64.json', 'Vulkan runtime: vulkan-1.dll + ICD drivers from registry', T['vulkan-rt']);
  ok(T['vulkan-sdk'].found && T['vulkan-sdk'].path === 'C:\\VulkanSDK\\1.4.304.1' && T['vulkan-sdk'].version === '1.4.304.1', 'Vulkan SDK detected separately (newest of two SDKs)', T['vulkan-sdk']);
  const py = T.python; const pyPaths = py.items.map(i => i.path);
  ok(py.found && py.items.length === 2, 'Python: 2 real interpreters (PATH + py launcher + registry + folder), de-duplicated; Store stub hidden (v2.3)', py.items);
  ok(py.items[0].primary && py.items[0].path === 'C:\\Python312\\python.exe' && py.path === py.items[0].path && py.items.filter(i => i.primary).length === 1, 'v2.3: exactly one primary = first real on PATH', py.items);
  ok(py.items[0].version === '3.12.4' && py.items.some(i => i.version === '3.11.9'), 'Python versions read and sorted newest first', py.items);
  ok(!py.items.some(i => /WindowsApps/.test(i.path)), 'v2.3: Store alias stub not listed when a real Python exists');
  ok(!log.some(l => /windowsapps/i.test(l) && /--version/.test(l)), 'Store alias never executed');
  ok(py.items.find(i => /Python311/.test(i.path)).note.includes('registry') && py.items.find(i => /Python311/.test(i.path)).note.includes('py'), 'sources merged per interpreter (py, registry, folder)', py.items);
  ok(T.git.found && T.git.version === '2.47.1.windows.1', 'git via Program Files', T.git);
  ok(T.llama.found && /llama-server\.exe$/.test(T.llama.path), 'llama.cpp (GPU-Voice-Studio bundle)', T.llama);
  ok(T.whisper.found && /whisper-server\.exe$/.test(T.whisper.path), 'whisper.cpp (Vulkan build)', T.whisper);
  ok(T.comfyui.found && T.comfyui.version === '0.3.40' && T.comfyui.items.length === 2 && T.comfyui.size > 7 * GB, 'ComfyUI: version file + models counted', T.comfyui);
  ok(T['lmstudio-models'].found && T['lmstudio-models'].path === 'D:\\LLM\\lmstudio' && T['lmstudio-models'].items.length === 2, 'LM Studio models dir from settings.json downloadsFolder', T['lmstudio-models']);
  ok(T.ollama.found && T.ollama.version === '0.12.3' && T.ollama.items.length === 2 && T.ollama.serving === true, 'Ollama: exe, version, model manifests, server running', T.ollama);
  ok(T['hf-cache'].found && T['hf-cache'].path === 'E:\\hf\\hub' && T['hf-cache'].items.map(i => i.name).sort().join() === 'Qwen/Qwen3-8B,openai/whisper-large-v3', 'HF cache via HF_HOME, repos listed', T['hf-cache']);
  ok(T.everything && !T.everything.found, 'missing tool reported as not found (no crash)');

  console.log('overrides + missing tools');
  const M2 = mockFs({ 'X:\\tools\\my-ffmpeg.exe': 5 * MB }); const log2 = [];
  const r2 = await td.detect({ fs: M2.fs, fsp: M2.fsp, platform: 'win32', env: ENV, home: H, exec: mockExec([[/my-ffmpeg\.exe -version/, 'ffmpeg version 6.0']], log2), http: async () => false }, { ffmpeg: 'X:\\tools\\my-ffmpeg.exe', git: 'X:\\nope\\git.exe' });
  const T2 = Object.fromEntries(r2.tools.map(x => [x.id, x]));
  ok(T2.ffmpeg.found && T2.ffmpeg.path === 'X:\\tools\\my-ffmpeg.exe' && T2.ffmpeg.version === '6.0', 'user override path wins', T2.ffmpeg);
  ok(!T2.git.found, 'override pointing to a missing file is ignored');
  ok(r2.tools.filter(x => x.found).length === 1, 'empty machine: everything else not found', r2.tools.filter(x => x.found).map(x => x.id));
  ok(!log2.some(l => /^where /.test(l) && false) && r2.tools.every(x => typeof x.name === 'string'), 'rows are well-formed');
  // exec throwing / hanging-style errors must not break detection
  const r3 = await td.detect({ fs: M.fs, fsp: M.fsp, platform: 'win32', env: ENV, home: H, exec: async () => ({ err: new Error('ETIMEDOUT'), out: '' }), http: async () => false }, {});
  ok(r3.tools.find(x => x.id === 'ffmpeg').found && r3.tools.find(x => x.id === 'ffmpeg').path === 'C:\\ffmpeg\\bin\\ffmpeg.exe', 'exec failures (timeouts) → still found via known folders');

  console.log('deep scan');
  const M3 = mockFs(FILES); const prog = [];
  const s = await td.deepScan({ fs: M3.fs, fsp: M3.fsp, platform: 'win32', env: ENV, home: H, exec: async () => ({ err: new Error('no es'), out: '' }) }, { onProgress: (p) => prog.push(p) });
  const names = s.items.map(i => i.name);
  ok(s.roots.join() === 'C:\\,D:\\,E:\\', 'scans every existing drive', s.roots);
  ok(names.includes('sdxl.safetensors') && names.includes('Qwen3-8B-Q4_K_M.gguf') && names.includes('mistral-7b.Q5_K_M.gguf') && names.includes('ggml-model-q8.bin') && names.includes('ggml-large-v3-turbo.bin'), 'finds .gguf/.safetensors/ggml-*.bin everywhere (deep folders too)', names);
  ok(!names.includes('tiny.gguf'), 'ignores files under the size threshold');
  ok(!names.includes('hidden.gguf') && !names.includes('bad.gguf') && !names.includes('old.gguf'), 'skips Windows, node_modules, $Recycle.Bin', names);
  ok(s.items[0].name === 'gemma-3-12b-Q4_K_M.gguf' || s.items[0].size >= s.items[1].size, 'sorted by size, largest first');
  ok(!s.cancelled && s.via === 'walk', 'walk completed');
  // cancellation: a big tree, cancel after the first progress tick
  const big = {}; for (let i = 0; i < 3000; i++) big[`F:\\d${i}\\x.txt`] = 1; big['F:\\d2999\\m.gguf'] = GB;
  const M4 = mockFs(big); const sig = { cancelled: false };
  const s4 = await td.deepScan({ fs: M4.fs, fsp: M4.fsp, platform: 'win32', env: ENV, home: H, exec: async () => ({ err: new Error('x'), out: '' }) }, { roots: ['F:\\'], signal: sig, onProgress: () => { sig.cancelled = true; } });
  ok(s4.cancelled === true && s4.dirs < 3001, 'scan can be cancelled mid-way', { dirs: s4.dirs, c: s4.cancelled });
  // Everything (es.exe) fast path
  const s5 = await td.deepScan({ fs: mockFs({ 'C:\\Program Files\\Everything\\es.exe': 1, 'C:\\x': 1 }).fs, fsp: M3.fsp, platform: 'win32', env: ENV, home: H, exec: mockExec([[/^where es$/, 'C:\\Program Files\\Everything\\es.exe'], [/^es\.exe -size/, '7,516,192,768 D:\\LLM\\a.gguf\r\n1,024 D:\\LLM\\small.gguf\r\n']]) }, {});
  ok(s5.via === 'everything' && s5.items.length === 1 && s5.items[0].size === 7516192768, 'uses Everything (es.exe) when installed', s5);

  console.log('cache (no re-detect on startup)');
  const ti = require('../main/toolindex'), systools = require('../main/systools');
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-ti-')); const H2 = {}; let nDetect = 0, nLegacy = 0;
  const realD = td.detect, realL = systools.detectAll;
  td.detect = async () => { nDetect++; return { tools: [{ id: 'ffmpeg', name: 'FFmpeg', cat: 'Media', found: true, version: '7.1', path: 'C:\\ffmpeg\\bin\\ffmpeg.exe', items: [] }] }; };
  systools.detectAll = async () => { nLegacy++; return { tools: [{ id: 'ffmpeg', name: 'FFmpeg', cat: 'Media', kind: 'cli', found: true }, { id: 'vulkan', name: 'old vulkan' }], files: [] }; };
  ti.wire({ DATA_ROOT: () => DATA, mainWin: () => null }, (ch, fn) => { H2[ch] = fn; });
  const a = await H2['sys:detect']({}); const b = await H2['sys:detect']({});
  ok(nDetect === 1 && a.cached === false && b.cached === true, 'second call served from cache', { nDetect, a: a.cached, b: b.cached });
  ok(fs.existsSync(path.join(DATA, 'cache', 'tools-index.json')), 'cache persisted to <data>/cache/tools-index.json');
  ok(a.tools.find(x => x.id === 'ffmpeg').kind === 'cli' && !a.tools.some(x => x.id === 'vulkan'), 'merge keeps launch kind, replaces old vulkan row');
  await H2['sys:detect']({}, true); ok(nDetect === 2, '«Rescan» (force) re-detects');
  await H2['sys:detect']({ ffmpeg: 'X:\\f.exe' }); ok(nDetect === 3, 'changing a path override invalidates the cache');
  await Promise.all([H2['sys:detect']({}, true), H2['sys:detect']({}, true)]); ok(nDetect === 4, 'concurrent detections are coalesced');
  td.detect = realD; systools.detectAll = realL; fs.rmSync(DATA, { recursive: true, force: true });

  console.log('startup cost');
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'main', 'v2.js'), 'utf8');
  ok(!/afterReady[\s\S]{0,400}(sys:detect|detectAll|deepScan)\(/.test(src), 'no tool detection / scan in the startup path');

  console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
