'use strict';
const { t, tr } = require('./i18n');
// Detect installed tools (PATH + known locations), versions, and launch them.
const { execFile, spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const nyxPath = require('./paths');
const WIN = process.platform === 'win32';
const E = (p) => nyxPath.expandVars(p);
const HOME = nyxPath.userHome();
const GVS = (rel) => nyxPath.gvs(rel);
const PF = ['%ProgramFiles%', '%ProgramFiles(x86)%', '%LOCALAPPDATA%\\Programs'];

const TOOLS = [
  { id: 'vulkan', name: 'Vulkan (vulkaninfo)', cat: 'GPU', cmds: ['vulkaninfo'], paths: ['%VULKAN_SDK%\\Bin\\vulkaninfo.exe', 'C:\\Windows\\System32\\vulkaninfoSDK.exe', 'C:\\Windows\\System32\\vulkaninfo.exe'], ver: ['--summary'], parse: /(Vulkan Instance Version: [\d.]+|apiVersion\s*=\s*[\d.]+[^\n]*|deviceName\s*=\s*[^\n]+)/g, kind: 'cli' },
  { id: 'ffmpeg', name: 'FFmpeg', cat: 'Media', cmds: ['ffmpeg'], paths: ['C:\\ffmpeg\\bin\\ffmpeg.exe', '%ProgramFiles%\\ffmpeg\\bin\\ffmpeg.exe', '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\ffmpeg.exe'], ver: ['-version'], parse: /ffmpeg version (\S+)/, kind: 'cli' },
  { id: 'ffprobe', name: 'FFprobe', cat: 'Media', cmds: ['ffprobe'], paths: ['C:\\ffmpeg\\bin\\ffprobe.exe'], ver: ['-version'], parse: /ffprobe version (\S+)/, kind: 'cli' },
  { id: 'ffplay', name: 'FFplay', cat: 'Media', cmds: ['ffplay'], paths: ['C:\\ffmpeg\\bin\\ffplay.exe'], ver: ['-version'], parse: /ffplay version (\S+)/, kind: 'cli' },
  { id: 'ghidra', name: 'Ghidra', cat: 'Dev', cmds: ['ghidraRun'], paths: ['%USERPROFILE%\\ghidra\\ghidraRun.bat', 'C:\\ghidra\\ghidraRun.bat', '%ProgramFiles%\\ghidra\\ghidraRun.bat'], globs: [[HOME, /^ghidra/i, 'ghidraRun.bat'], ['C:\\', /^ghidra/i, 'ghidraRun.bat'], [path.join(HOME, 'Downloads'), /^ghidra/i, 'ghidraRun.bat'], [path.join(HOME, 'Desktop'), /^ghidra/i, 'ghidraRun.bat']], kind: 'gui' },
  { id: 'git', name: 'Git', cat: 'Dev', cmds: ['git'], paths: ['%ProgramFiles%\\Git\\cmd\\git.exe'], ver: ['--version'], parse: /git version (\S+)/, kind: 'cli' },
  { id: 'node', name: 'Node.js', cat: 'Dev', cmds: ['node'], paths: ['%ProgramFiles%\\nodejs\\node.exe'], ver: ['--version'], parse: /v?([\d.]+)/, kind: 'cli' },
  { id: 'java', name: 'Java', cat: 'Dev', cmds: ['java'], paths: [], ver: ['-version'], parse: /version "([^"]+)"|openjdk ([\d.]+)/, kind: 'cli' },
  { id: 'python', name: 'Python', cat: 'Dev', cmds: WIN ? ['python', 'python3', 'py', 'python3.13t'] : ['python3', 'python'], paths: ['%LOCALAPPDATA%\\Programs\\Python\\Python313\\python3.13t.exe', '%LOCALAPPDATA%\\Programs\\Python\\Python313\\python.exe', '%ProgramFiles%\\Python313\\python.exe'], ver: ['--version'], parse: /Python ([\d.]+\S*)/, kind: 'cli' },
  { id: 'vs', name: 'Visual Studio', cat: 'Dev', special: 'vswhere', kind: 'gui' },
  { id: 'telegram', name: 'Telegram Desktop', cat: 'Apps', cmds: [], paths: ['%APPDATA%\\Telegram Desktop\\Telegram.exe', '%ProgramFiles%\\Telegram Desktop\\Telegram.exe'], kind: 'gui' },
  { id: 'hermes', name: 'Hermes agent', cat: 'AI', cmds: ['hermes'], paths: ['%LOCALAPPDATA%\\Programs\\Hermes\\Hermes.exe', '%LOCALAPPDATA%\\Programs\\hermes\\Hermes.exe', '%ProgramFiles%\\Hermes\\Hermes.exe', '%USERPROFILE%\\.hermes\\hermes-agent\\venv\\Scripts\\hermes.exe'], kind: 'gui', noteKey: 'systools.001' },
  { id: 'lmstudio', name: 'LM Studio', cat: 'AI', cmds: ['lms'], paths: ['%LOCALAPPDATA%\\Programs\\LM Studio\\LM Studio.exe', '%LOCALAPPDATA%\\Programs\\lm-studio\\LM Studio.exe', '%ProgramFiles%\\LM Studio\\LM Studio.exe'], kind: 'gui', http: 'http://localhost:1234/v1/models' },
  { id: 'llama', name: 'llama-server', cat: 'AI', cmds: ['llama-server'], paths: [GVS('third_party\\llama\\llama-server.exe')], ver: ['--version'], parse: /version: (\S+)/, kind: 'cli' },
  { id: 'whisper', name: 'whisper-server', cat: 'AI', cmds: ['whisper-server'], paths: [GVS('third_party\\whisper.cpp\\build-vulkan\\bin\\Release\\whisper-server.exe')], kind: 'cli' },
  { id: 'vsengine', name: 'vs-engine (TTS)', cat: 'AI', cmds: [], paths: [GVS('vs-engine\\engine\\build-vulkan\\Release\\vs-engine.exe')], kind: 'cli' },
  { id: 'ollama', name: 'Ollama', cat: 'AI', cmds: ['ollama'], paths: ['%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe'], ver: ['--version'], parse: /version is (\S+)|(\d+\.\d+\.\d+)/, kind: 'cli', http: 'http://localhost:11434/api/version' },
  { id: 'tesseract', name: 'Tesseract OCR', cat: 'Media', cmds: ['tesseract'], paths: ['%ProgramFiles%\\Tesseract-OCR\\tesseract.exe'], ver: ['--version'], parse: /tesseract v?(\S+)/i, kind: 'cli' },
  { id: 'syncthing', name: 'Syncthing', cat: 'Apps', cmds: ['syncthing'], paths: ['%LOCALAPPDATA%\\Programs\\Syncthing\\syncthing.exe'], ver: ['--version'], parse: /syncthing (v\S+)/, kind: 'cli' },
];
const FILES = [
  { id: 'f-whisper-model', name: 'Whisper model large-v3-turbo q5_0', p: GVS('third_party\\whisper.cpp\\models\\ggml-large-v3-turbo-q5_0.bin') },
  { id: 'f-whisper-model2', nameKey: 'systools.002', p: GVS('models\\ggml-large-v3-turbo-q5_0.bin') },
  { id: 'f-krikri', name: 'Llama-Krikri 8B q8_0', p: GVS('models\\llama-krikri-8b-instruct-q8_0.gguf') },
  { id: 'f-omni', name: 'OmniVoice base Q8_0', p: path.join(HOME, 'OmniVoice-Vulkan', 'models', 'omnivoice-base-Q8_0.gguf') },
  { id: 'f-omnitok', name: 'OmniVoice tokenizer Q8_0', p: path.join(HOME, 'OmniVoice-Vulkan', 'models', 'omnivoice-tokenizer-Q8_0.gguf') },
];
const exists = (p) => { try { return !!p && fs.existsSync(p); } catch (e) { return false; } };
function run(cmd, args, timeout = 5000) {
  return new Promise((res) => { try { execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 << 20, shell: WIN && /\.(bat|cmd)$/i.test(cmd) }, (err, out, er) => res({ err, out: String(out || '') + String(er || '') })); } catch (e) { res({ err: e, out: '' }); } });
}
async function which(name) { const r = await run(WIN ? 'where' : 'which', [name], 3000); if (r.err) return null; const l = r.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean); return l.find(x => exists(x)) || null; }
function globFind(dir, re, file) { try { for (const d of fs.readdirSync(dir)) { if (re.test(d)) { const p = path.join(dir, d, file); if (exists(p)) return p; } } } catch (e) {} return null; }
async function vswhere() {
  const vw = E('%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\vswhere.exe');
  if (!exists(vw)) return null;
  const r = await run(vw, ['-latest', '-products', '*', '-format', 'json'], 6000);
  try { const j = JSON.parse(r.out)[0]; return j ? { path: j.productPath || j.installationPath, version: `${j.displayName || ''} ${j.catalog?.productDisplayVersion || j.installationVersion || ''}`.trim() } : null; } catch (e) { return null; }
}
async function httpUp(url) { try { const c = new AbortController(); setTimeout(() => c.abort(), 1500); const r = await fetch(url, require('./routerkey').withAuth(url, { signal: c.signal })); return r.ok; } catch (e) { return false; } }
async function detectOne(t, overrides = {}) {
  const res = { id: t.id, name: t.name, cat: t.cat, kind: t.kind, note: t.noteKey ? tr(t.noteKey) : (t.note || ''), found: false, path: '', version: '' };
  if (t.special === 'vswhere') { const v = await vswhere(); if (v) Object.assign(res, { found: true, path: v.path, version: v.version }); return res; }
  let p = overrides[t.id] && exists(overrides[t.id]) ? overrides[t.id] : null;
  if (!p) for (const c of t.cmds || []) { p = await which(c); if (p) break; }
  if (!p) for (const k of t.paths || []) { const q = E(k); if (exists(q)) { p = q; break; } }
  if (!p && t.globs) for (const [d, re, f] of t.globs) { p = globFind(d, re, f); if (p) break; }
  if (p) { res.found = true; res.path = p; }
  if (p && t.ver) { const r = await run(p, t.ver); const m = t.parse && (t.parse.global ? r.out.match(t.parse) : r.out.match(t.parse)); res.version = m ? (t.parse.global ? [...new Set(m)].slice(0, 3).join(' · ') : (m[1] || m[2] || m[0])) : (r.out.split(/\r?\n/)[0] || '').slice(0, 80); }
  if (t.http) res.serving = await httpUp(t.http);
  return res;
}
async function detectAll(overrides = {}) {
  const tools = await Promise.all(TOOLS.map(t => detectOne(t, overrides).catch(e => ({ id: t.id, name: t.name, cat: t.cat, found: false, error: String(e) }))));
  const files = FILES.map(f => { let size = 0; try { size = fs.statSync(f.p).size; } catch (e) {} return { ...f, name: f.nameKey ? tr(f.nameKey) : f.name, exists: exists(f.p), size }; });
  return { tools, files, platform: process.platform, at: Date.now() };
}
function launch(p, kind) {
  if (!exists(p)) throw new Error(t('systools.003') + p);
  if (kind === 'cli' && WIN) { spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `"${p}" --help`], { detached: true, windowsHide: false }).unref(); return true; }
  const ch = spawn(p, [], { detached: true, stdio: 'ignore', cwd: path.dirname(p), shell: /\.(bat|cmd)$/i.test(p) }); ch.on('error', () => {}); ch.unref(); return true;
}
module.exports = { detectAll, launch, which, GVS, HOME, TOOLS };
