'use strict';
// v2.5: GGUF header reader (metadata only, never the weights) + model table helpers:
// quant, params, context, layers, KV-cache estimate, «fits in N GB VRAM», split shards, duplicates.
const fs = require('fs'), fsp = fs.promises, path = require('path'), crypto = require('crypto');
const FTYPE = { 0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1', 10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 19: 'IQ2_XXS', 20: 'IQ2_XS', 21: 'Q2_K_S', 22: 'IQ3_XS', 23: 'IQ3_XXS', 24: 'IQ1_S', 25: 'IQ4_NL', 26: 'IQ3_S', 27: 'IQ3_M', 28: 'IQ2_S', 29: 'IQ2_M', 30: 'IQ4_XS', 31: 'IQ1_M', 32: 'BF16', 36: 'TQ1_0', 37: 'TQ2_0', 38: 'MXFP4' };
const QRE = /(?:^|[-_.])((?:UD-)?(?:I?Q\d(?:_[0-9KSMLXN]+)*|F16|BF16|F32|MXFP4(?:_MOE)?|TQ\d_\d))(?=[-_.]|$)/i;
class Reader {
  constructor(fd, size) { this.fd = fd; this.size = size; this.pos = 0; this.buf = Buffer.alloc(0); this.bufAt = 0; }
  need(n) {
    if (this.pos + n > this.size) throw new Error('GGUF: truncated');
    if (this.pos >= this.bufAt && this.pos + n <= this.bufAt + this.buf.length) return;
    const len = Math.max(n, 1 << 20); const b = Buffer.alloc(Math.min(len, this.size - this.pos)); fs.readSync(this.fd, b, 0, b.length, this.pos); this.buf = b; this.bufAt = this.pos;
  }
  take(n) { this.need(n); const o = this.pos - this.bufAt; this.pos += n; return this.buf.subarray(o, o + n); }
  u8() { return this.take(1)[0]; } u16() { return this.take(2).readUInt16LE(0); } i16() { return this.take(2).readInt16LE(0); }
  u32() { return this.take(4).readUInt32LE(0); } i32() { return this.take(4).readInt32LE(0); } f32() { return this.take(4).readFloatLE(0); }
  u64() { return Number(this.take(8).readBigUInt64LE(0)); } i64() { return Number(this.take(8).readBigInt64LE(0)); } f64() { return this.take(8).readDoubleLE(0); }
  str() { const n = this.u64(); if (n > 1 << 24) throw new Error('GGUF: bad string'); return this.take(n).toString('utf8'); }
  skip(n) { this.pos += n; if (this.pos > this.size) throw new Error('GGUF: truncated'); }
}
const SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
function val(r, type, keep) {
  switch (type) {
    case 0: return r.u8(); case 1: return r.take(1).readInt8(0); case 2: return r.u16(); case 3: return r.i16(); case 4: return r.u32(); case 5: return r.i32(); case 6: return r.f32(); case 7: return !!r.u8(); case 8: return r.str();
    case 10: return r.u64(); case 11: return r.i64(); case 12: return r.f64();
    case 9: { const at = r.u32(), n = r.u64(); if (!keep || n > 4096) { if (SIZE[at]) r.skip(SIZE[at] * n); else for (let i = 0; i < n; i++) val(r, at, false); return { array: n }; } const a = []; for (let i = 0; i < n; i++) a.push(val(r, at, true)); return a; }
    default: throw new Error('GGUF: type ' + type);
  }
}
// Reads the header + all metadata (arrays > 4096 entries such as tokenizer vocab are skipped, only their length is kept).
function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size; const r = new Reader(fd, size);
    if (r.take(4).toString('latin1') !== 'GGUF') throw new Error('not a GGUF file');
    const version = r.u32(); const tensors = r.u64(); const kvn = r.u64(); if (kvn > 100000) throw new Error('GGUF: bad header');
    const kv = {}; for (let i = 0; i < kvn; i++) { const k = r.str(); const ty = r.u32(); kv[k] = val(r, ty, true); }
    return { version, tensors, kv, size };
  } finally { fs.closeSync(fd); }
}
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : Array.isArray(x) ? Math.max(...x.filter(v => typeof v === 'number')) : 0);
// Model summary + VRAM estimate. kvCache: f16 K+V per layer × ctx × kv heads × head dim.
function summarize(file, h, { ctx = 8192, vramGB = 24, totalSize } = {}) {
  const kv = h.kv; const arch = String(kv['general.architecture'] || ''); const A = (k) => kv[arch + '.' + k];
  const nameQ = (path.basename(file).match(QRE) || [])[1];
  const quant = nameQ ? nameQ.toUpperCase() : (FTYPE[kv['general.file_type']] || (kv['general.file_type'] != null ? 'type ' + kv['general.file_type'] : '?'));
  const layers = num(A('block_count')); const embd = num(A('embedding_length')); const heads = num(A('attention.head_count')); const kvHeads = num(A('attention.head_count_kv')) || heads;
  const kDim = num(A('attention.key_length')) || (heads ? embd / heads : 0); const vDim = num(A('attention.value_length')) || kDim;
  const maxCtx = num(A('context_length'));
  const weights = totalSize || h.size;
  const kvPerTok = layers * kvHeads * (kDim + vDim) * 2; // bytes per token (f16)
  const useCtx = Math.min(ctx, maxCtx || ctx);
  const overhead = 0.55 * 2 ** 30 + weights * 0.02;
  const need = weights + kvPerTok * useCtx + overhead;
  const budget = vramGB * 2 ** 30 * 0.94;
  const fit = need <= budget ? 'yes' : weights + overhead <= budget ? 'ctx' : 'no';
  const ctxFit = kvPerTok ? Math.max(0, Math.floor((budget - weights - overhead) / kvPerTok / 1024) * 1024) : 0;
  return { arch, name: kv['general.name'] || '', sizeLabel: kv['general.size_label'] || '', quant, layers, maxCtx, kvPerTok, weights, need, fit, ctxFit: maxCtx ? Math.min(ctxFit, maxCtx) : ctxFit, vision: arch === 'clip' || /mmproj/i.test(path.basename(file)), experts: num(A('expert_count')) || 0, version: h.version };
}
const SPLIT = /-(\d{5})-of-(\d{5})\.gguf$/i;
async function quickHash(file, size) {
  const fd = await fsp.open(file, 'r'); try { const n = Math.min(1 << 20, size); const a = Buffer.alloc(n), b = Buffer.alloc(n); await fd.read(a, 0, n, 0); await fd.read(b, 0, n, Math.max(0, size - n)); return crypto.createHash('sha1').update(a).update(b).update(String(size)).digest('hex').slice(0, 16); } finally { await fd.close(); }
}
// files: [{path,size}] → table rows (split shards merged, duplicates flagged with wasted GB)
async function table(files, opts = {}) {
  const groups = new Map();
  for (const f of files) { const m = f.path.match(SPLIT); const key = m ? f.path.replace(SPLIT, '') : f.path; const g = groups.get(key) || { path: f.path, size: 0, parts: 0, first: f.path }; g.size += f.size; g.parts++; if (m && +m[1] === 1) g.first = f.path; groups.set(key, g); }
  const rows = [];
  for (const g of groups.values()) {
    let s = null, err = '';
    try { s = summarize(g.first, readHeader(g.first), { ...opts, totalSize: g.size }); } catch (e) { err = e.message; }
    rows.push({ path: g.first, file: path.basename(g.first), dir: path.dirname(g.first), size: g.size, parts: g.parts, ...(s || { quant: (path.basename(g.first).match(QRE) || [])[1] || '?', fit: '?' }), error: err });
  }
  const bySize = new Map(); for (const r of rows) { const k = r.size; (bySize.get(k) || bySize.set(k, []).get(k)).push(r); }
  let dupBytes = 0;
  for (const list of bySize.values()) {
    if (list.length < 2) continue;
    const byHash = new Map(); for (const r of list) { try { r.hash = await quickHash(r.path, Math.min(r.size, fs.statSync(r.path).size)); } catch (e) { continue; } (byHash.get(r.hash) || byHash.set(r.hash, []).get(r.hash)).push(r); }
    for (const same of byHash.values()) if (same.length > 1) { same.sort((a, b) => a.path.length - b.path.length); same.forEach((r, i) => { r.dupOf = i ? same[0].path : null; r.dupGroup = same[0].hash; }); dupBytes += same.slice(1).reduce((a, r) => a + r.size, 0); }
  }
  rows.sort((a, b) => (a.vision - b.vision) || b.size - a.size);
  return { rows, dupBytes, vramGB: opts.vramGB || 24, ctx: opts.ctx || 8192 };
}
module.exports = { readHeader, summarize, table, quickHash, FTYPE, QRE };
