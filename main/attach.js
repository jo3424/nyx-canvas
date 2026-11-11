'use strict';
// v2.5 — assistant attachments (main side). Local only: classifies files, extracts text from
// txt/md/code/csv/json/docx/xlsx/pptx/odt, and extracts ZIPs safely (zip-slip guard, size/count/ratio/depth limits).
// Images/audio/video/pdf are imported into media by the renderer and handled there (vision/OCR, whisper, pdf.js).
const fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os'), crypto = require('crypto');
const zip = require('./zip');

const LIMITS = { zipMax: 512 * 1024 * 1024, totalMax: 1024 * 1024 * 1024, fileMax: 256 * 1024 * 1024, files: 2000, depth: 2, ratio: 200, textMax: 4 * 1024 * 1024 };
const EXT = {
  image: /^(jpe?g|png|webp|gif|bmp|tiff?|heic|avif)$/, audio: /^(mp3|wav|m4a|aac|ogg|oga|opus|flac|wma)$/, video: /^(mp4|mov|mkv|webm|avi|m4v|wmv|mts|m2ts|3gp)$/,
  pdf: /^pdf$/, docx: /^(docx|docm|dotx)$/, xlsx: /^(xlsx|xlsm)$/, pptx: /^(pptx|pptm)$/, odt: /^(odt|ods|odp)$/, zip: /^zip$/, csv: /^(csv|tsv)$/,
  text: /^(txt|md|markdown|log|rtf|ini|cfg|conf|toml|ya?ml|json|jsonl|xml|html?|srt|vtt|env\.example)$/,
  code: /^(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|sh|bash|ps1|bat|cmd|sql|lua|swift|r|m|scala|dart|vue|svelte|css|scss|less|gradle|cmake|makefile|dockerfile)$/,
};
function kindOf(name) {
  const b = path.basename(String(name)).toLowerCase(); const ext = b.includes('.') ? b.split('.').pop() : b;
  if (/^(makefile|dockerfile|readme|license|changelog)$/.test(b)) return 'text';
  for (const k of Object.keys(EXT)) if (EXT[k].test(ext)) return k;
  return 'unknown';
}

// ---- text decoding: UTF-8 / UTF-16 BOM / Greek legacy (windows-1253) fallback; binary detection
function isBinary(buf) { const n = Math.min(buf.length, 8000); let z = 0, ctl = 0; for (let i = 0; i < n; i++) { const c = buf[i]; if (c === 0) z++; else if (c < 9 || (c > 13 && c < 32)) ctl++; } return z > 0 || ctl / Math.max(1, n) > 0.1; }
function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) {}
  try { return new TextDecoder('windows-1253').decode(buf); } catch (e) { return buf.toString('latin1'); }
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function unxml(s) { return String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m)); }
function stripTags(s) { return unxml(String(s).replace(/<[^>]+>/g, '')); }

// ---- Office formats (ZIP + XML; no external libraries)
function docxText(z) {
  const parts = ['word/document.xml', ...z.names.filter(n => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(n))].filter(n => z.has(n));
  if (!parts.length) throw new Error('not a Word document');
  return parts.map(n => z.get(n).toString('utf8').replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n'))
    .map(stripTags).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function colIdx(ref) { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
function xlsxText(z, maxRows = 3000) {
  const shared = []; if (z.has('xl/sharedStrings.xml')) { const x = z.get('xl/sharedStrings.xml').toString('utf8'); for (const m of x.matchAll(/<si>([^]*?)<\/si>/g)) shared.push(stripTags(m[1].replace(/<rPh[^]*?<\/rPh>/g, ''))); }
  const names = {}; if (z.has('xl/workbook.xml')) { const wb = z.get('xl/workbook.xml').toString('utf8'); let i = 1; for (const m of wb.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)) names['sheet' + (i++)] = unxml(m[1]); }
  const sheets = z.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  if (!sheets.length) throw new Error('not an Excel workbook');
  const out = []; let rows = 0;
  for (const s of sheets) {
    const key = path.basename(s, '.xml'); out.push('## ' + (names[key] || key));
    const x = z.get(s).toString('utf8');
    for (const r of x.matchAll(/<row\b[^>]*>([^]*?)<\/row>/g)) {
      if (rows++ >= maxRows) { out.push('…'); break; }
      const cells = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([^]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] || ''; const ref = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1]; const tt = (/\bt="(\w+)"/.exec(attrs) || [])[1];
        let v = (/<v>([^]*?)<\/v>/.exec(body) || [])[1]; if (tt === 's' && v != null) v = shared[+v] ?? ''; else if (tt === 'inlineStr') v = stripTags((/<is>([^]*?)<\/is>/.exec(body) || [])[1] || ''); else if (v != null) v = unxml(v);
        cells[ref ? colIdx(ref) : cells.length] = v ?? '';
      }
      const line = Array.from(cells, v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
      if (line.replace(/,/g, '').trim()) out.push(line);
    }
  }
  return out.join('\n');
}
function pptxText(z) {
  const slides = z.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  if (!slides.length) throw new Error('not a PowerPoint file');
  return slides.map((s, i) => '## ' + (i + 1) + '\n' + [...z.get(s).toString('utf8').matchAll(/<a:t>([^]*?)<\/a:t>/g)].map(m => unxml(m[1])).join(' ')).join('\n');
}
function odtText(z) { if (!z.has('content.xml')) throw new Error('not an OpenDocument file'); return stripTags(z.get('content.xml').toString('utf8').replace(/<text:tab\/>/g, '\t').replace(/<\/text:(p|h)>/g, '\n').replace(/<\/table:table-row>/g, '\n').replace(/<\/table:table-cell>/g, ',')).replace(/\n{3,}/g, '\n\n').trim(); }

function extractBuf(kind, buf) {
  if (kind === 'docx') return docxText(zip.read(buf));
  if (kind === 'xlsx') return xlsxText(zip.read(buf));
  if (kind === 'pptx') return pptxText(zip.read(buf));
  if (kind === 'odt') return odtText(zip.read(buf));
  if (isBinary(buf)) { const e = new Error('binary'); e.code = 'BINARY'; throw e; }
  return decode(buf);
}

// ---- safe ZIP extraction
function safeRel(name) {
  const n = String(name).replace(/\\/g, '/');
  if (!n || n.includes('\0') || n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return null;
  const parts = n.split('/').filter(p => p && p !== '.'); if (!parts.length || parts.some(p => p === '..')) return null;
  return parts.join('/');
}
function inside(root, p) { const r = path.resolve(root) + path.sep; const q = path.resolve(p); return q.startsWith(r); }
function tmpRoot(dataDir) { return path.join(dataDir || os.tmpdir(), 'tmp', 'attachments'); }
async function unzipSafe(src, dest, opts = {}, depth = 0, acc = { total: 0, files: 0 }) {
  const L = { ...LIMITS, ...(opts.limits || {}) };
  const st = await fsp.stat(src); if (st.size > L.zipMax) throw new Error('zip too large');
  const z = zip.read(await fsp.readFile(src));
  const tree = [], skipped = [];
  await fsp.mkdir(dest, { recursive: true });
  for (const name of z.names) {
    const rel = safeRel(name); const inf = z.info(name);
    if (!rel) { skipped.push({ rel: name, reason: 'unsafe-path' }); continue; }
    const out = path.join(dest, rel);
    if (!inside(dest, out)) { skipped.push({ rel: name, reason: 'unsafe-path' }); continue; }
    if (/(^|\/)(__MACOSX|\.DS_Store$)/.test(rel)) continue;
    if (inf.encrypted) { skipped.push({ rel, reason: 'encrypted' }); continue; }
    if (acc.files + 1 > L.files) { skipped.push({ rel, reason: 'too-many-files' }); continue; }
    if (inf.usize > L.fileMax) { skipped.push({ rel, reason: 'file-too-large' }); continue; }
    if (acc.total + inf.usize > L.totalMax) { skipped.push({ rel, reason: 'total-too-large' }); continue; }
    if (inf.csize > 0 && inf.usize / inf.csize > L.ratio && inf.usize > 1024 * 1024) { skipped.push({ rel, reason: 'zip-bomb' }); continue; }
    let data; try { data = z.get(name); } catch (e) { skipped.push({ rel, reason: 'corrupt' }); continue; }
    await fsp.mkdir(path.dirname(out), { recursive: true });
    try { await fsp.writeFile(out, data, { flag: 'wx' }); } catch (e) { if (e.code === 'EEXIST') { skipped.push({ rel, reason: 'duplicate' }); continue; } throw e; }
    acc.total += data.length; acc.files++;
    const kind = kindOf(rel); const node = { rel, path: out, size: data.length, kind };
    if (kind === 'zip') {
      if (depth + 1 > L.depth) node.note = 'nested-too-deep';
      else { try { const sub = await unzipSafe(out, out + '.d', opts, depth + 1, acc); node.children = sub.tree; skipped.push(...sub.skipped.map(s => ({ ...s, rel: rel + '/' + s.rel }))); } catch (e) { node.note = 'zip-error: ' + e.message; } }
    }
    tree.push(node);
  }
  return { dir: dest, tree, skipped, total: acc.total, files: acc.files };
}
function flat(tree, out = []) { for (const n of tree) { out.push(n); if (n.children) flat(n.children, out); } return out; }
function treeText(tree, ind = '') { return tree.map(n => ind + n.rel.split('/').pop() + (n.children ? '/  (zip)' : '') + '  ' + fmtSize(n.size) + (n.children ? '\n' + treeText(n.children, ind + '  ') : '')).join('\n'); }
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? Math.round(b / 1024) + ' KB' : b + ' B'; }

// inspect(file) → { name, size, kind, text?, truncated?, error?, code? }
async function inspect(file, opts = {}) {
  const L = { ...LIMITS, ...(opts.limits || {}) };
  const st = await fsp.stat(file); const name = path.basename(file); const kind = kindOf(name);
  const r = { path: file, name, size: st.size, kind };
  if (['image', 'audio', 'video', 'pdf', 'zip'].includes(kind)) return r;
  try {
    if (['docx', 'xlsx', 'pptx', 'odt'].includes(kind)) { if (st.size > L.fileMax) throw Object.assign(new Error('too large'), { code: 'TOOBIG' }); r.text = extractBuf(kind, await fsp.readFile(file)); }
    else {
      const fd = await fsp.open(file, 'r'); const n = Math.min(st.size, L.textMax); const buf = Buffer.alloc(n);
      try { await fd.read(buf, 0, n, 0); } finally { await fd.close(); }
      try { r.text = extractBuf(kind === 'unknown' ? 'text' : kind, buf); if (kind === 'unknown') r.kind = 'text'; }
      catch (e) { if (e.code === 'BINARY') { r.error = 'unsupported'; r.code = 'BINARY'; return r; } throw e; }
      if (/\.(html?|xml|svg)$/i.test(name)) r.text = stripTags(r.text.replace(/<(script|style)[^]*?<\/\1>/gi, ''));
      if (st.size > n) r.truncated = true;
    }
  } catch (e) { r.error = e.message; r.code = r.code || 'READ'; }
  return r;
}

function runWorker(workerData) {
  return new Promise((res, rej) => {
    let Worker;
    try { ({ Worker } = require('worker_threads')); } catch (e) { return rej(e); }
    const w = new Worker(path.join(__dirname, 'attach-worker.js'), { workerData });
    w.once('message', (msg) => { w.terminate().catch(() => {}); if (msg && msg.error && msg.code === 'WORKER') return rej(Object.assign(new Error(msg.error), { code: msg.code })); res(msg); });
    w.once('error', rej);
    w.once('exit', (c) => { if (c) rej(new Error('worker exit ' + c)); });
  });
}
async function inspectAsync(file, opts = {}) {
  try { return await runWorker({ op: 'inspect', file: String(file), opts }); }
  catch (e) { return inspect(file, opts); }
}
async function unzipAsync(src, dest, opts = {}) {
  try { return await runWorker({ op: 'unzip', src: String(src), dest: String(dest), opts }); }
  catch (e) { return unzipSafe(src, dest, opts); }
}

function wire(H, C) {
  const root = () => tmpRoot(C.DATA_ROOT && C.DATA_ROOT());
  H('att:inspect', (p) => inspectAsync(String(p)));
  H('att:unzip', async (p) => { const dest = path.join(root(), crypto.randomBytes(6).toString('hex')); const r = await unzipAsync(String(p), dest); return { ...r, text: treeText(r.tree), all: flat(r.tree).map(n => ({ rel: n.rel, path: n.path, size: n.size, kind: n.kind, note: n.note })) }; });
  H('att:pick', async () => { const { dialog, BrowserWindow } = require('electron'); const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || C.mainWin(), { properties: ['openFile', 'multiSelections'] }); return r.canceled ? [] : r.filePaths; });
  H('att:cleanup', () => cleanup(root(), 0));
  setTimeout(() => cleanup(root(), 3600e3).catch(() => {}), 15000);
}
async function cleanup(dir, olderThan) {
  let n = 0; for (const d of await fsp.readdir(dir).catch(() => [])) { const p = path.join(dir, d); const st = await fsp.stat(p).catch(() => null); if (st && Date.now() - st.mtimeMs >= olderThan) { await fsp.rm(p, { recursive: true, force: true }); n++; } }
  return n;
}

module.exports = { wire, inspect, inspectAsync, unzipSafe, unzipAsync, runWorker, safeRel, kindOf, decode, isBinary, docxText, xlsxText, pptxText, odtText, treeText, flat, cleanup, LIMITS };
