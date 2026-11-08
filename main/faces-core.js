'use strict';
// v2.5 Faces: pure maths shared by the worker and the tests — YuNet decode + NMS, 5-point similarity alignment, SFace input, clustering.
const SIZE = 640, STRIDES = [8, 16, 32];
const TEMPLATE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
// BGRA bitmap (w×h) letterboxed (already resized so max side = 640) → Float32 NCHW BGR 0..255 [1,3,640,640]
function yunetInput(bgra, w, h) {
  const out = new Float32Array(3 * SIZE * SIZE); const P = SIZE * SIZE;
  for (let y = 0; y < h && y < SIZE; y++) for (let x = 0; x < w && x < SIZE; x++) { const i = (y * w + x) * 4, o = y * SIZE + x; out[o] = bgra[i]; out[P + o] = bgra[i + 1]; out[2 * P + o] = bgra[i + 2]; }
  return out;
}
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
function iou(a, b) { const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]); const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1); return i / (a[2] * a[3] + b[2] * b[3] - i || 1); }
// outs: { cls_8, obj_8, bbox_8, kps_8, … } Float32Arrays. scale: original px per network px.
function decodeYunet(outs, { score = 0.8, nms = 0.3, scale = 1, topK = 50 } = {}) {
  const dets = [];
  for (const s of STRIDES) {
    const cols = SIZE / s, rows = SIZE / s; const cls = outs['cls_' + s], obj = outs['obj_' + s], bb = outs['bbox_' + s], kp = outs['kps_' + s];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c; const sc = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i])); if (sc < score) continue;
      const cx = (c + bb[i * 4]) * s, cy = (r + bb[i * 4 + 1]) * s, w = Math.exp(bb[i * 4 + 2]) * s, hh = Math.exp(bb[i * 4 + 3]) * s;
      const kps = []; for (let n = 0; n < 5; n++) kps.push([(kp[i * 10 + 2 * n] + c) * s * scale, (kp[i * 10 + 2 * n + 1] + r) * s * scale]);
      dets.push({ box: [(cx - w / 2) * scale, (cy - hh / 2) * scale, w * scale, hh * scale], score: sc, kps });
    }
  }
  dets.sort((a, b) => b.score - a.score); const keep = [];
  for (const d of dets) { if (keep.every(k => iou(k.box, d.box) <= nms)) keep.push(d); if (keep.length >= topK) break; }
  return keep;
}
// least-squares similarity (Umeyama, no reflection) mapping src points → dst points: returns [a, b, tx, ty] with x' = a x − b y + tx, y' = b x + a y + ty
function similarity(src, dst) {
  const n = src.length; let mx = 0, my = 0, ux = 0, uy = 0;
  for (let i = 0; i < n; i++) { mx += src[i][0]; my += src[i][1]; ux += dst[i][0]; uy += dst[i][1]; } mx /= n; my /= n; ux /= n; uy /= n;
  let sxx = 0, sxy = 0, v = 0;
  for (let i = 0; i < n; i++) { const x = src[i][0] - mx, y = src[i][1] - my, X = dst[i][0] - ux, Y = dst[i][1] - uy; sxx += x * X + y * Y; sxy += x * Y - y * X; v += x * x + y * y; }
  const a = sxx / (v || 1), b = sxy / (v || 1);
  return [a, b, ux - (a * mx - b * my), uy - (b * mx + a * my)];
}
// aligned 112×112 RGB crop → Float32 NCHW RGB 0..255 (SFace input), bilinear sampling with the inverse transform
function sfaceInput(bgra, w, h, kps) {
  const [a, b, tx, ty] = similarity(kps, TEMPLATE); const d = a * a + b * b || 1;
  const out = new Float32Array(3 * 112 * 112); const P = 112 * 112;
  for (let y = 0; y < 112; y++) for (let x = 0; x < 112; x++) {
    const X = x - tx, Y = y - ty; const sx = (a * X + b * Y) / d, sy = (-b * X + a * Y) / d;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0; const o = y * 112 + x;
    for (let ch = 0; ch < 3; ch++) {
      const px = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0 : bgra[(yy * w + xx) * 4 + (2 - ch)]; // RGB from BGRA
      out[ch * P + o] = px(x0, y0) * (1 - fx) * (1 - fy) + px(x0 + 1, y0) * fx * (1 - fy) + px(x0, y0 + 1) * (1 - fx) * fy + px(x0 + 1, y0 + 1) * fx * fy;
    }
  }
  return out;
}
function l2(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); }
function cos(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
const SAME = 0.363; // OpenCV SFace cosine threshold
// greedy assignment to the closest person centroid (≥ thr) else a new cluster. people: {pid:{c:Float32Array,n}}
function assign(emb, people, thr = SAME) { let best = null, bs = -1; for (const [pid, p] of Object.entries(people)) { if (!p.c) continue; const s = cos(emb, p.c); if (s > bs) { bs = s; best = pid; } } return bs >= thr ? { pid: best, sim: bs } : { pid: null, sim: bs }; }
function centroid(embs) { if (!embs.length) return null; const c = new Float32Array(embs[0].length); for (const e of embs) for (let i = 0; i < c.length; i++) c[i] += e[i]; return l2(c); }
const toB64 = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');
const fromB64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
module.exports = { SIZE, TEMPLATE, yunetInput, decodeYunet, similarity, sfaceInput, l2, cos, SAME, assign, centroid, toB64, fromB64, iou };
