'use strict';
// v2.6.5 — context-derived limits, thinking params, continuation, Gemma 4 KV estimate, LM Studio probe policy.
// Pure helpers (+ optional GGUF read). No silent caps. Numbers are labelled with their source.

const DEFAULT_RESERVE = 64;
const DEFAULT_MAX_CONTINUE = 8;
const GVS_SMALL_CTX = 16384;
const LMS_DEFAULT_BASE = 'http://localhost:1234/v1';

// Official Gemma 4 12B text config, fetched 10/11/2026 (Europe/Athens) from
// https://huggingface.co/google/gemma-4-12B-it/raw/main/config.json
const GEMMA4_12B = {
  id: 'gemma-4-12B',
  source: 'https://huggingface.co/google/gemma-4-12B-it/raw/main/config.json',
  checked: '2026-11-10',
  layers: 48,
  slidingWindow: 1024,
  swaLayers: 40,
  fullLayers: 8,
  swaKvHeads: 8,
  swaHeadDim: 256,
  fullKvHeads: 1,
  fullHeadDim: 512,
  kEqV: true,
  maxCtx: 262144,
};

const KV_BYTES = { f32: 4, f16: 2, bf16: 2, q8_0: 1, q5_0: 1, q5_1: 1, q4_0: 0.5, q4_1: 0.5 };

// Groq documented max output tokens. If a model is not listed, omit max_tokens rather than invent a lower cap.
// Values left empty on purpose when not verified this turn (10/11/2026).
const CLOUD_MAX_OUT = {
  groq: {
    // source to be filled when a specific model card is opened this turn
  },
};

function isLocalLlama(p) {
  if (!p) return false;
  if (p.id === 'llama') return true;
  try { const u = new URL(p.base || ''); return (p.kind === 'local' || /127\.|localhost|\[::1\]/.test(u.hostname)) && (u.port === '8080' || /llama/i.test(p.name || p.id || '')); } catch (e) { return false; }
}

function nativeBase(base) {
  return String(base || '').replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function parseNctx(j) {
  if (!j || typeof j !== 'object') return null;
  const cands = [
    j.n_ctx, j.n_ctx_train, j.ctx,
    j.default_generation_settings?.n_ctx,
    j.default_generation_settings?.params?.n_ctx,
    j.default_generation_settings?.n_predict && j.default_generation_settings?.n_ctx,
    Array.isArray(j) ? j[0]?.n_ctx : null,
    j.data?.[0]?.meta?.n_ctx, j.data?.[0]?.n_ctx,
  ];
  for (const x of cands) { const n = +x; if (Number.isFinite(n) && n > 0) return n; }
  return null;
}

function estimateTokens(messages, tools) {
  const text = requestToText(messages, tools);
  // conservative char/2 for Greek + Latin mix (over-estimate prompt so max_tokens stays safe)
  return Math.max(1, Math.ceil(String(text).length / 2));
}

function requestToText(messages, tools) {
  const msg = messagesToText(messages);
  if (!tools || !tools.length) return msg;
  return msg + '\n' + JSON.stringify(tools);
}

function messagesToText(messages) {
  return (messages || []).map((m) => {
    const c = m?.content;
    if (typeof c === 'string') return (m.role || '') + '\n' + c;
    if (Array.isArray(c)) return (m.role || '') + '\n' + c.map(p => p?.text || p?.content || '').join('\n');
    return (m.role || '') + '\n' + (c == null ? '' : JSON.stringify(c));
  }).join('\n');
}

function computeMaxTokens({ nCtx, promptTokens, reserve = DEFAULT_RESERVE, override, cloudMax, kind } = {}) {
  const res = Math.max(0, +reserve || 0);
  const prompt = (promptTokens == null || !Number.isFinite(+promptTokens)) ? null : Math.max(0, Math.floor(+promptTokens));
  const ctx = (nCtx == null || !Number.isFinite(+nCtx) || +nCtx <= 0) ? null : Math.floor(+nCtx);
  const available = (ctx != null && prompt != null) ? Math.max(0, ctx - prompt - res) : null;
  const ov = (override == null || override === '' || !Number.isFinite(+override) || +override <= 0) ? null : Math.floor(+override);

  if (ov != null) {
    if (available != null && ov > available) {
      return { max_tokens: available || 1, omitted: false, clamped: true, available, override: ov, reason: 'override_clamped_to_available' };
    }
    return { max_tokens: ov, omitted: false, clamped: false, available, override: ov, reason: 'user_override' };
  }
  if (available != null) {
    if (available < 1) return { max_tokens: null, omitted: true, clamped: false, available: 0, reason: 'prompt_overflow' };
    return { max_tokens: available, omitted: false, clamped: false, available, reason: 'n_ctx_minus_prompt' };
  }
  if (cloudMax && Number.isFinite(+cloudMax) && +cloudMax > 0) {
    return { max_tokens: Math.floor(+cloudMax), omitted: false, clamped: false, available: Math.floor(+cloudMax), reason: 'documented_cloud_max' };
  }
  return { max_tokens: null, omitted: true, clamped: false, available, reason: kind === 'cloud' ? 'no_documented_max' : 'unknown_ctx' };
}

function cloudMaxOutput(p, model) {
  const tab = CLOUD_MAX_OUT[p?.id] || {};
  const id = String(model || p?.defModel || '');
  if (tab[id]) return tab[id];
  return null;
}

function thinkingParams({ enabled = false, budget = null, effort = null } = {}) {
  const body = {
    chat_template_kwargs: { enable_thinking: !!enabled },
  };
  // Thinking off: only enable_thinking:false. reasoning_format:"none" made Gemma 4
  // (llama-server b11936 --jinja) emit <|channel>thought… which then looked empty.
  if (enabled) {
    if (effort) body.reasoning_effort = effort;
    if (budget != null && Number.isFinite(+budget) && +budget > 0) body.reasoning_budget = Math.floor(+budget);
  }
  return body;
}

function dropUnsupported(body, unsupported = []) {
  const out = { ...body };
  const kw = { ...(out.chat_template_kwargs || {}) };
  for (const k of unsupported) {
    if (k === 'chat_template_kwargs' || k === 'enable_thinking') delete out.chat_template_kwargs;
    else delete out[k];
  }
  if (out.chat_template_kwargs && !Object.keys(kw).length) delete out.chat_template_kwargs;
  return out;
}

function isUnknownParamError(err) {
  const s = String(err?.message || err || '');
  return /unknown( |_)?(field|parameter|argument)|unexpected property|not allowed|unrecognized|json schema/i.test(s);
}

const CHANNEL_MARK = /<\|channel\|>|<\|channel>|<channel\|>/i;
function extractThink(s, reasoningContent) {
  let text = String(s || '');
  const parts = [];
  if (reasoningContent) parts.push(String(reasoningContent).trim());
  const take = (re) => { text = text.replace(re, (_, t) => { if (t && String(t).trim()) parts.push(String(t).trim()); return ''; }); };
  take(/<think>([\s\S]*?)<\/think>/gi);
  take(/<thought>([\s\S]*?)<\/thought>/gi);
  take(/<reasoning>([\s\S]*?)<\/reasoning>/gi);
  // unclosed <think> at the start of the string (truncated thought)
  if (/^\s*<think>/i.test(text)) { parts.push(text.replace(/^\s*<think>/i, '').trim()); text = ''; }
  // Channel tags:
  //   <|channel>  / <|channel|>  open (Gemma 4, llama.cpp)
  //   <channel|>                 Gemma 4 close of the thought block — text after it is the answer
  //   <|channel|>thought … <|channel|>final …  (labelled channels)
  // Open without a close is treated as truncated thinking (no visible answer).
  if (CHANNEL_MARK.test(text)) {
    const chunks = text.split(CHANNEL_MARK);
    const visible = [];
    for (const ch of chunks) {
      if (!ch) continue;
      const think = ch.match(/^(thought|reasoning|analysis)\b\s*/i);
      if (think) { const body = ch.slice(think[0].length).trim(); if (body) parts.push(body); continue; }
      const vis = ch.match(/^(final|response)\b\s*/i);
      if (vis) { const body = ch.slice(vis[0].length).trim(); if (body) visible.push(body); continue; }
      const body = ch.trim();
      if (body) visible.push(body);
    }
    text = visible.join('\n');
  }
  return { text: text.trim(), reasoning: parts.filter(Boolean).join('\n\n') };
}
function emptiedByThink(raw, extracted) {
  return !!String(raw || '').trim() && !String((extracted && extracted.text) || '').trim();
}

function stripThink(s, reasoningContent) { return extractThink(s, reasoningContent).text; }

function shouldContinue(finish, round, maxContinue = DEFAULT_MAX_CONTINUE) {
  const f = String(finish || '').toLowerCase();
  const length = f === 'length' || f === 'max_tokens' || f === 'max_completion_tokens';
  const cap = Math.max(0, Math.floor(+maxContinue || 0));
  return { length, continue: length && round < cap, reachedCap: length && round >= cap, round, maxContinue: cap };
}

function nextContinueMessages(messages, partial) {
  return [...(messages || []), { role: 'assistant', content: String(partial || '') }];
}

function mergePieces(pieces) {
  let out = '';
  for (const raw of pieces || []) {
    const p = String(raw || '');
    if (!p) continue;
    if (!out) { out = p; continue; }
    let k = Math.min(out.length, p.length, 80);
    while (k > 0 && out.slice(-k) !== p.slice(0, k)) k--;
    out += p.slice(k);
  }
  return out;
}

function mayAutoUse(p) {
  if (!p || !p.enabled) return false;
  if (p.id !== 'lmstudio') return true;
  return !!p.userOn;
}

function migrateLmStudio(providers, tasks) {
  const p = (providers || []).find(x => x.id === 'lmstudio');
  if (!p) return { changed: false };
  const used = Object.values(tasks || {}).some(t => t && t.p === 'lmstudio');
  const custom = !!(p.base && String(p.base).replace(/\/+$/, '') !== LMS_DEFAULT_BASE);
  if (p.userOn || used || custom) {
    if ((used || custom) && p.enabled && !p.userOn) { p.userOn = true; return { changed: true, reason: 'mark_user_configured' }; }
    return { changed: false };
  }
  if (p.enabled) { p.enabled = false; return { changed: true, reason: 'disable_unconfigured_lmstudio' }; }
  return { changed: false };
}

function kvTypeBytes(kvType) {
  const k = String(kvType || 'f16').toLowerCase();
  return KV_BYTES[k] != null ? KV_BYTES[k] : 2;
}

function hybridKvBytes(meta, nCtx, kvType) {
  const b = kvTypeBytes(kvType);
  const swaTok = Math.min(Math.max(0, nCtx), meta.slidingWindow || nCtx);
  const swa = (meta.swaLayers || 0) * (meta.swaKvHeads || 0) * ((meta.swaHeadDim || 0) * 2) * b * swaTok;
  const fullEl = (meta.fullHeadDim || 0) * (meta.kEqV ? 1 : 2);
  const full = (meta.fullLayers || 0) * (meta.fullKvHeads || 0) * fullEl * b * Math.max(0, nCtx);
  return { swa, full, total: swa + full, bytesPerEl: b };
}

function genericKvBytes({ layers, kvHeads, kDim, vDim }, nCtx, kvType) {
  const b = kvTypeBytes(kvType);
  const perTok = (layers || 0) * (kvHeads || 0) * ((kDim || 0) + (vDim || 0)) * b;
  return { swa: 0, full: perTok * nCtx, total: perTok * nCtx, bytesPerEl: b };
}

function recommendCtx({ meta, weightsBytes, vramGiB = 24, kvType = 'f16', fa = true, overheadGiB } = {}) {
  const maxCtx = meta?.maxCtx || 131072;
  const vram = (+vramGiB || 24) * 2 ** 30;
  const budget = vram * 0.94;
  const overhead = ((overheadGiB != null ? +overheadGiB : (fa ? 1.0 : 2.0))) * 2 ** 30;
  const weights = Math.max(0, +weightsBytes || 0);
  const avail = budget - weights - overhead;
  const note = 'computed_not_measured';
  const assumptions = {
    vramGiB: +vramGiB || 24,
    kvType,
    fa: !!fa,
    overheadGiB: overhead / 2 ** 30,
    budgetFraction: 0.94,
    kEqV: !!(meta && meta.kEqV),
    source: meta?.source || 'gguf-or-generic',
    checked: meta?.checked || null,
  };
  if (!(avail > 0) || !meta) {
    return { ctx: 0, fits: false, reason: 'no_budget', note, assumptions, kvAt: {}, maxCtx };
  }
  const kvAt = (n, typ) => (meta.swaLayers != null ? hybridKvBytes(meta, n, typ) : genericKvBytes(meta, n, typ));
  let lo = 0, hi = maxCtx, best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const kv = kvAt(mid, kvType);
    if (kv.total <= avail) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  // snap down to a multiple of 1024 when large
  if (best >= 2048) best = Math.floor(best / 1024) * 1024;
  const kvF16 = kvAt(best || maxCtx, 'f16');
  const kvQ8 = kvAt(best || maxCtx, 'q8_0');
  const atMaxF16 = kvAt(maxCtx, 'f16');
  const fitsMax = atMaxF16.total <= avail;
  const ctx = fitsMax ? maxCtx : best;
  return {
    ctx, fits: ctx > 0, fitsMax, maxCtx, note, assumptions,
    availableBytes: avail, weightsBytes: weights,
    kvAtCtx: kvAt(ctx, kvType), kvF16: kvAt(ctx, 'f16'), kvQ8: kvAt(ctx, 'q8_0'),
    kvF16max: atMaxF16, kvQ8max: kvAt(maxCtx, 'q8_0'),
  };
}

function looksGemma412B(name, layers, maxCtx) {
  const s = String(name || '');
  if (/gemma-?4-?12b/i.test(s)) return true;
  if (layers === 48 && maxCtx === 262144 && /gemma-?4/i.test(s)) return true;
  return false;
}

function metaFromGgufKv(kv, fileName) {
  const arch = String(kv['general.architecture'] || '');
  const A = (k) => kv[arch + '.' + k];
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : Array.isArray(x) ? (x.find(v => typeof v === 'number') ?? d) : d);
  const layers = num(A('block_count'), 0);
  const heads = num(A('attention.head_count'), 0);
  const kvHeads = num(A('attention.head_count_kv'), heads);
  const embd = num(A('embedding_length'), 0);
  const kDim = num(A('attention.key_length'), heads ? embd / heads : 0);
  const vDim = num(A('attention.value_length'), kDim);
  const maxCtx = num(A('context_length'), 0);
  const name = kv['general.name'] || fileName || '';
  const swPat = A('attention.sliding_window_pattern') || A('attention.layer_types') || kv['layer_types'];
  const swa = num(A('attention.sliding_window'), 0) || num(A('sliding_window'), 0);
  if (looksGemma412B(name, layers, maxCtx) || arch === 'gemma4') {
    const meta = { ...GEMMA4_12B, name, arch, layers: layers || GEMMA4_12B.layers, maxCtx: maxCtx || GEMMA4_12B.maxCtx };
    if (Array.isArray(swPat) && swPat.length) {
      const isFull = (x) => x === false || x === 'full_attention' || x === 'full' || x === 0;
      meta.fullLayers = swPat.filter(isFull).length;
      meta.swaLayers = swPat.length - meta.fullLayers;
    }
    if (swa) meta.slidingWindow = swa;
    const kSwa = num(A('attention.key_length_swa'), 0);
    if (kSwa) meta.swaHeadDim = kSwa;
    const kFull = num(A('attention.key_length'), 0);
    if (kFull && kFull !== meta.swaHeadDim) meta.fullHeadDim = kFull;
    if (A('attention_k_eq_v') != null || A('attention.k_eq_v') != null) meta.kEqV = !!(A('attention_k_eq_v') ?? A('attention.k_eq_v'));
    return meta;
  }
  return { name, arch, layers, kvHeads, kDim, vDim, maxCtx: maxCtx || 131072, source: 'gguf-header' };
}

function recommendFromGguf(file, opts = {}) {
  let weights = 0, meta = null, err = '';
  try {
    const gguf = require('./gguf');
    const fs = require('fs');
    const path = require('path');
    const st = fs.statSync(file);
    weights = st.size;
    const h = gguf.readHeader(file);
    meta = metaFromGgufKv(h.kv, path.basename(file));
  } catch (e) { err = String(e.message || e); }
  if (!meta && looksGemma412B(file, 0, 0)) meta = { ...GEMMA4_12B, name: file };
  const rec = recommendCtx({ meta, weightsBytes: weights || (opts.weightsBytes || 0), vramGiB: opts.vramGiB || 24, kvType: opts.kvType || 'f16', fa: opts.fa !== false });
  if (err) rec.readError = err;
  rec.meta = meta;
  rec.file = file;
  return rec;
}

function gvsCtxInfo(nCtx, rec) {
  const n = +nCtx || 0;
  const small = n > 0 && n < GVS_SMALL_CTX;
  return { n_ctx: n, small, threshold: GVS_SMALL_CTX, recommended: rec?.ctx || null, recommendNote: rec?.note || null };
}

function fallbackAutoCtx() {
  return { ctx: 32768, fallback: true, note: 'fallback_no_metadata' };
}

function resolveLaunchCtx(cfg, rec) {
  // v2.6.6: never invent or auto-raise -c (the 262144 figure is a computed fit, not a launch default).
  // A positive ctx is used as-is. 0 / empty / "auto" omits -c so the running server keeps its own value.
  const raw = cfg?.ctx;
  if (raw != null && raw !== '' && raw !== 'auto' && Number.isFinite(+raw) && +raw > 0) {
    return { ctx: Math.floor(+raw), auto: false, source: 'user', rec };
  }
  return { ctx: 0, auto: true, source: 'omit', omitted: true, rec };
}

function llamaExtraFlags(cfg) {
  const extra = String(cfg?.extra || '');
  const args = [];
  if (cfg?.fa !== false && !/(^|\s)(-fa|--flash-attn)\b/.test(extra)) args.push('-fa', 'on');
  if ((cfg?.kvType === 'q8_0' || cfg?.kvCache === 'q8_0') && !/--cache-type-k\b/.test(extra)) args.push('--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0');
  return args;
}

module.exports = {
  DEFAULT_RESERVE, DEFAULT_MAX_CONTINUE, GVS_SMALL_CTX, LMS_DEFAULT_BASE, GEMMA4_12B, CLOUD_MAX_OUT, KV_BYTES,
  isLocalLlama, nativeBase, parseNctx, estimateTokens, messagesToText, requestToText,
  computeMaxTokens, cloudMaxOutput, thinkingParams, dropUnsupported, isUnknownParamError,
  extractThink, stripThink, emptiedByThink, shouldContinue, nextContinueMessages, mergePieces,
  mayAutoUse, migrateLmStudio,
  kvTypeBytes, hybridKvBytes, genericKvBytes, recommendCtx, looksGemma412B, metaFromGgufKv,
  recommendFromGguf, gvsCtxInfo, fallbackAutoCtx, resolveLaunchCtx, llamaExtraFlags,
};
