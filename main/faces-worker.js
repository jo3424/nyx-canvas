'use strict';
// v2.5 Faces worker (worker_thread): onnxruntime-web (WASM, CPU) + YuNet detector + SFace recognizer. Runs off the main thread.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const F = require('./faces-core');
let det = null, rec = null, ort = null;
async function init() {
  if (det) return;
  const dir = workerData.dir; ort = require(path.join(dir, 'ort.wasm.min.js'));
  ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = pathToFileURL(dir).href.replace(/\/?$/, '/'); ort.env.logLevel = 'error';
  det = await ort.InferenceSession.create(fs.readFileSync(path.join(dir, 'face_detection_yunet_2023mar.onnx')), { logSeverityLevel: 3 });
  rec = await ort.InferenceSession.create(fs.readFileSync(path.join(dir, 'face_recognition_sface_2021dec.onnx')), { logSeverityLevel: 3 });
}
async function analyze({ small, sw, sh, big, bw, bh, scaleSmall, score }) {
  await init();
  const inp = new ort.Tensor('float32', F.yunetInput(small, sw, sh), [1, 3, F.SIZE, F.SIZE]);
  const o = await det.run({ [det.inputNames[0]]: inp }); const outs = {}; for (const k of Object.keys(o)) outs[k] = o[k].data;
  // detections in «big» image coordinates (big = the ≤1280 px decode)
  const dets = F.decodeYunet(outs, { score: score || 0.8, scale: scaleSmall });
  const faces = [];
  for (const d of dets) {
    if (d.box[2] < 24 || d.box[3] < 24) continue; // too small to recognise reliably
    const t = new ort.Tensor('float32', F.sfaceInput(big, bw, bh, d.kps), [1, 3, 112, 112]);
    const r = await rec.run({ [rec.inputNames[0]]: t }); const emb = F.l2(r[rec.outputNames[0]].data);
    faces.push({ box: d.box.map(v => Math.round(v * 10) / 10), score: Math.round(d.score * 1000) / 1000, kps: d.kps, emb: F.toB64(emb) });
  }
  return faces;
}
parentPort.on('message', async (m) => {
  try { const r = m.op === 'init' ? (await init(), true) : await analyze(m); parentPort.postMessage({ id: m.id, ok: true, r }); }
  catch (e) { parentPort.postMessage({ id: m.id, ok: false, error: String(e && e.message || e) }); }
});
