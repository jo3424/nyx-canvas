'use strict';
// v2.2: find model / exe files on disk (bounded, async, never blocks the UI) for local servers and TTS.
const fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os');
const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'env', '$recycle.bin', 'system volume information', 'cmakefiles', '.cache-pip', 'site-packages', 'appdata', 'windows', 'obj', 'include', 'src', 'tests', 'docs', 'examples']);
// kind → filename matcher
const KINDS = {
  whisper: (n) => /^ggml-.*\.bin$/i.test(n) && !/silero|vad/i.test(n),
  llama: (n) => /\.gguf$/i.test(n) && !/mmproj|omnivoice|tokenizer|vocab|whisper|silero|embed/i.test(n),
  'tts-model': (n) => /\.gguf$/i.test(n) && /omnivoice|tts|voice/i.test(n) && !/tokenizer|codec/i.test(n),
  'tts-tokenizer': (n) => /\.gguf$/i.test(n) && /tokenizer|codec/i.test(n),
  gguf: (n) => /\.gguf$/i.test(n),
  wav: (n) => /\.(wav|flac|mp3|ogg)$/i.test(n) && /ref|voice|speaker|sample|clone/i.test(n),
  exe: (n) => /\.exe$/i.test(n) || (!path.extname(n) && process.platform !== 'win32'),
};
function defaultRoots(home, gvs, extra = []) {
  home = home || os.homedir();
  const r = [gvs, ...extra, path.join(home, 'GPU-Voice-Studio'), path.join(home, 'OmniVoice-Vulkan'), path.join(home, 'omnivoice.cpp'), path.join(home, '.lmstudio', 'models'), path.join(home, '.cache', 'lm-studio', 'models'), path.join(home, 'models'), path.join(home, 'Downloads'), path.join(home, 'Desktop')];
  const seen = new Set(); const out = [];
  for (const d of r) { if (!d) continue; const k = path.resolve(d).toLowerCase(); if (seen.has(k)) continue; seen.add(k); try { if (fs.statSync(d).isDirectory()) out.push(d); } catch (e) {} }
  return out;
}
// Walk breadth-first with depth / entry / time limits. Returns [{path,name,size,mtime,score}] best first.
async function find({ kind = 'gguf', want = '', names = [], roots = [], maxDepth = 6, maxEntries = 60000, budgetMs = 6000, limit = 40 } = {}) {
  const match = KINDS[kind] || KINDS.gguf; const wantBase = path.basename(String(want || '').replace(/\\/g, '/')).toLowerCase();
  const wanted = new Set([wantBase, ...names.map(n => n.toLowerCase())].filter(Boolean));
  const t0 = Date.now(); let seen = 0; const hits = []; const visited = new Set();
  const queue = roots.map(r => [r, 0]);
  while (queue.length && seen < maxEntries && Date.now() - t0 < budgetMs) {
    const [dir, depth] = queue.shift();
    let real; try { real = (await fsp.realpath(dir)).toLowerCase(); } catch (e) { continue; }
    if (visited.has(real)) continue; visited.add(real);
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      seen++; const p = path.join(dir, e.name); const low = e.name.toLowerCase();
      if (e.isDirectory()) { if (depth < maxDepth && !SKIP.has(low) && !(low.startsWith('.') && depth > 0)) queue.push([p, depth + 1]); continue; }
      if (!e.isFile() && !e.isSymbolicLink()) continue;
      if (!(wanted.has(low) || match(e.name))) continue;
      let st; try { st = await fsp.stat(p); } catch (err) { continue; }
      if (!st.isFile() || (kind !== 'exe' && st.size < 1 << 20)) continue; // real models are > 1 MB
      let score = 0; if (wanted.has(low)) score += 1000;
      if (wantBase) { const stem = wantBase.replace(/\.[^.]+$/, ''); for (const tok of stem.split(/[-_.]+/)) if (tok.length > 1 && low.includes(tok)) score += 10; }
      hits.push({ path: p, name: e.name, size: st.size, mtime: st.mtimeMs, score });
    }
  }
  hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return { files: hits.slice(0, limit), scanned: seen, ms: Date.now() - t0, truncated: queue.length > 0, roots };
}
module.exports = { find, defaultRoots, KINDS };
