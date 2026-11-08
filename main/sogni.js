'use strict';
// v2.5 Sogni (optional, cloud, off until a key is saved). Wraps the vendored @sogni-ai/sogni-client (ISC, main/vendor/sogni.js).
// Three canvas actions: identity edit (same face, new scene), image→video (Wan 2.2 i2v), animate-move (photo follows a video's motion).
// Key lives only in safeStorage (secrets 'key:sogni'). Results are downloaded into Nyx media. Spends Spark credits — the UI says so.
const fs = require('fs'), crypto = require('crypto');
const MODELS = {
  identity: 'krea2_identity_edit_v1_2',
  i2v: 'wan_v2.2-14b-fp8_i2v_lightx2v',
  animate: 'wan_v2.2-14b-fp8_animate-move_lightx2v',
};
let factory = null; // tests inject a fake client factory
function setFactory(f) { factory = f; }
function fakeClient(file) { // NYX_SOGNI_FAKE=<image or video path>: offline stand-in used by the e2e test
  return { account: { refreshBalance: async () => ({ spark: { net: '400' }, sogni: { net: '0' } }) }, projects: { create: async (p) => ({ params: p, waitForCompletion: async () => ['file://' + file] }) }, dispose() {} };
}
async function client(apiKey) {
  if (factory) return factory(apiKey);
  if (process.env.NYX_SOGNI_FAKE) return fakeClient(process.env.NYX_SOGNI_FAKE);
  if (!apiKey) throw Object.assign(new Error('NO_KEY'), { code: 'NO_KEY' });
  const { SogniClient } = require('./vendor/sogni.js');
  return SogniClient.createInstance({ appId: 'nyx-' + crypto.randomBytes(6).toString('hex'), appSource: 'nyx', network: 'fast', apiKey });
}
function size(w, h, long) { const r = (w || 1) / (h || 1); let W, H; if (r >= 1) { W = long; H = Math.round(long / r / 16) * 16; } else { H = long; W = Math.round(long * r / 16) * 16; } return { width: W, height: H }; }
function params(kind, o) {
  const base = { modelId: o.model || MODELS[kind], numberOfMedia: 1, positivePrompt: String(o.prompt || '').slice(0, 2000), tokenType: o.tokenType || 'spark', appSource: 'nyx' };
  if (o.negative) base.negativePrompt = String(o.negative).slice(0, 1000);
  if (kind === 'identity') return { ...base, type: 'image', contextImages: o.images, steps: 10, guidance: 1, outputFormat: 'jpg', ...size(o.w, o.h, 1024), sizePreset: 'custom' };
  if (kind === 'i2v') return { ...base, type: 'video', referenceImage: o.images[0], duration: Math.min(10, Math.max(2, +o.seconds || 5)), fps: 16, ...size(o.w, o.h, 832) };
  if (kind === 'animate') return { ...base, type: 'video', referenceImage: o.images[0], referenceVideo: o.video, duration: Math.min(10, Math.max(2, +o.seconds || 5)), fps: 16, ...size(o.w, o.h, 832) };
  throw new Error('kind');
}
async function fetchResult(u) {
  if (u.startsWith('file://')) return fs.readFileSync(decodeURIComponent(u.slice(7)));
  const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer());
}
async function test(apiKey) { const c = await client(apiKey); try { const b = await c.account.refreshBalance(); return { ok: true, spark: b?.spark?.net ?? null, sogni: b?.sogni?.net ?? null }; } finally { try { c.dispose?.(); } catch (e) {} } }
async function run(apiKey, kind, o, onProgress) {
  const c = await client(apiKey);
  try {
    const p = params(kind, o); const proj = await c.projects.create(p); onProgress?.({ stage: 'queued' });
    proj.on?.('progress', (v) => onProgress?.({ stage: 'progress', v }));
    const urls = await proj.waitForCompletion(); if (!urls || !urls.length) throw new Error('no result');
    return { bufs: await Promise.all(urls.map(fetchResult)), ext: p.type === 'video' ? 'mp4' : 'jpg', model: p.modelId };
  } finally { try { c.dispose?.(); } catch (e) {} }
}
module.exports = { MODELS, params, run, test, setFactory, size };
