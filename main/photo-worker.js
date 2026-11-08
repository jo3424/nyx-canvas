'use strict';
// v2.5 batch enhance (classic, non-generative): auto-levels, gentle vibrance, unsharp mask. BGRA in → BGRA out. Runs in a worker_thread.
const { parentPort } = require('worker_threads');
function enhance(px, w, h, o = {}) {
  const n = w * h; const clip = o.clip ?? 0.004; const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < n; i++) { hist[0][px[i * 4]]++; hist[1][px[i * 4 + 1]]++; hist[2][px[i * 4 + 2]]++; }
  const lut = hist.map(hh => { let lo = 0, hi = 255, s = 0; while (lo < 255 && (s += hh[lo]) < n * clip) lo++; s = 0; while (hi > 0 && (s += hh[hi]) < n * clip) hi--; if (hi - lo < 32) { lo = 0; hi = 255; } const L = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) L[v] = (v - lo) * 255 / (hi - lo); return L; });
  // same stretch for all channels (keeps white balance): use the mildest per-channel stretch
  const levels = o.levels !== false; const vib = o.vibrance ?? 0.12;
  const out = Buffer.from(px);
  for (let i = 0; i < n; i++) {
    let b = px[i * 4], g = px[i * 4 + 1], r = px[i * 4 + 2];
    if (levels) { b = lut[0][b]; g = lut[1][g]; r = lut[2][r]; }
    if (vib) { const mx = Math.max(r, g, b), avg = (r + g + b) / 3; const amt = vib * (1 - (mx - Math.min(r, g, b)) / 255); r += (r - avg) * amt; g += (g - avg) * amt; b += (b - avg) * amt; }
    out[i * 4] = b < 0 ? 0 : b > 255 ? 255 : b; out[i * 4 + 1] = g < 0 ? 0 : g > 255 ? 255 : g; out[i * 4 + 2] = r < 0 ? 0 : r > 255 ? 255 : r;
  }
  const amt = o.sharpen ?? 0.6; if (amt > 0) { // unsharp mask, 3×3 box blur on luminance-ish per channel
    const src = Buffer.from(out);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[i + (dy * w + dx) * 4 + c]; const v = src[i + c] + amt * (src[i + c] - s / 9); out[i + c] = v < 0 ? 0 : v > 255 ? 255 : v; } }
  }
  return out;
}
if (parentPort) parentPort.on('message', (m) => { try { const r = enhance(Buffer.from(m.px), m.w, m.h, m.o); parentPort.postMessage({ id: m.id, ok: true, px: r }); } catch (e) { parentPort.postMessage({ id: m.id, ok: false, error: String(e.message || e) }); } });
module.exports = { enhance };
