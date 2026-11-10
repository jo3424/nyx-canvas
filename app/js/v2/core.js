'use strict';
// Nyx v2 core: migration v1→v2, AI config, AI client, speech (whisper STT / TTS), small helpers.
const V2 = { info: null, viewer: null };
const GVS_REL = { llamaExe: 'third_party\\llama\\llama-server.exe', llamaModel: 'models\\llama-krikri-8b-instruct-q8_0.gguf', whisperExe: 'third_party\\whisper.cpp\\build-vulkan\\bin\\Release\\whisper-server.exe', whisperModel: 'models\\ggml-large-v3-turbo-q5_0.bin', tts: 'vs-engine\\engine\\build-vulkan\\Release\\vs-engine.exe' };
const PROVIDERS_DEFAULT = [
  { id: 'lmstudio', name: 'LM Studio', kind: 'local', base: 'http://localhost:1234/v1', enabled: false, icon: 'monitor' },
  { id: 'llama', name: 'llama-server', kind: 'local', base: 'http://127.0.0.1:8080/v1', enabled: true, icon: 'cpu' },
  { id: 'ollama', name: 'Ollama', kind: 'local', base: 'http://localhost:11434/v1', enabled: false, icon: 'box' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'cloud', base: 'https://openrouter.ai/api/v1', keyRef: 'key:openrouter', enabled: false, icon: 'route' },
  // v2.4: Groq (free plan works; fast Llama/Qwen/GPT-OSS with tool calling + Whisper STT). Groq has no Greek TTS.
  { id: 'groq', name: 'Groq', kind: 'cloud', base: 'https://api.groq.com/openai/v1', keyRef: 'key:groq', enabled: false, icon: 'zap', defModel: 'llama-3.3-70b-versatile' },
  { id: 'venice', name: 'Venice AI', kind: 'cloud', base: 'https://api.venice.ai/api/v1', keyRef: 'key:venice', enabled: false, icon: 'venetian-mask' },
  { id: 'xai', name: 'xAI', kind: 'cloud', base: 'https://api.x.ai/v1', keyRef: 'key:xai', enabled: false, icon: 'sparkle' },
  { id: 'openai', name: 'OpenAI', kind: 'cloud', base: 'https://api.openai.com/v1', keyRef: 'key:openai', enabled: false, icon: 'bot' },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', kind: 'cloud', base: '', keyRef: 'key:custom', enabled: false, icon: 'plug' },
];
const AI_TASKS = [['chat', t('core.001'), 'message-circle'], ['commands', t('core.002'), 'terminal'], ['vision', t('core.003'), 'scan-eye'], ['summarize', t('core.004'), 'list-collapse'], ['embed', t('core.005'), 'binary'], ['private', t('v266.task_private'), 'venetian-mask']];
// v2.6.3: recommendations for RX 7900 XTX 24 GB (Windows 11, llama-server/whisper-server on Vulkan).
// Only links + exact file names/sizes (checked on Hugging Face 02/11/2026). Nyx never downloads models by itself.
const HF_URL = 'https://huggingface.co/';
const MODEL_RECS = [
  { id: 'fast', star: true, name: 'Qwen3.8-27B · unsloth UD-Q4_K_M', role: t('core.007'), note: t('core.008'), why: t('core.r_fast_why'), url: HF_URL + 'unsloth/Qwen3.8-27B-GGUF',
    files: [['Qwen3.8-27B-UD-Q4_K_M.gguf', 16.46], ['MTP/mtp-Qwen3.8-27B-Q4_0.gguf', 1.37, 'opt']] },
  { id: 'vision', name: 'Qwen3.8-27B + mmproj-F16', role: t('core.009'), note: t('core.010'), why: t('core.r_vision_why'), url: HF_URL + 'unsloth/Qwen3.8-27B-GGUF',
    files: [['Qwen3.8-27B-UD-Q4_K_M.gguf', 16.46, 'same'], ['mmproj-F16.gguf', 0.93]] },
  { id: 'uncensored', name: 'orcarouter Qwen3.8-27B-Uncensored · Q4_K_M', role: t('core.011'), note: t('core.012'), why: t('core.r_unc_why'), url: HF_URL + 'orcarouter/Qwen3.8-27B-Uncensored-GGUF',
    files: [['Qwen3.8-27B-Uncensored-Q4_K_M.gguf', 16.81], ['mmproj-Qwen3.8-27B-Uncensored-f16.gguf', 0.93, 'opt']],
    alt: { name: 'huihui-ai Huihui-Qwen3.8-27B-abliterated · UD-DW-Q4_K_M', note: t('core.r_unc_alt'), url: HF_URL + 'huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF', files: [['Huihui-Qwen3.8-27B-abliterated-UD-DW-Q4_K_M.gguf', 16.55], ['mmproj-model-bf16.gguf', 0.93, 'opt']] } },
  { id: 'greek', name: 'Llama-Krikri-8B-Instruct · q4_k_m', role: t('core.013'), note: t('core.014'), why: t('core.r_greek_why'), url: HF_URL + 'ilsp/Llama-Krikri-8B-Instruct-GGUF',
    files: [['llama-krikri-8b-instruct-q4_k_m.gguf', 5.04], ['llama-krikri-8b-instruct-q8_0.gguf', 8.72, 'opt']] },
  { id: 'stt', name: 'whisper.cpp · ggml-large-v3', role: t('core.r_stt_role'), note: t('core.r_stt_note'), why: t('core.r_stt_why'), url: HF_URL + 'ggerganov/whisper.cpp',
    files: [['ggml-large-v3.bin', 3.10], ['ggml-large-v3-turbo.bin', 1.62, 'alt']] },
  { id: 'embed', name: 'text-embedding-nomic / bge-m3 (LM Studio)', role: 'Embeddings', note: t('core.015') },
];
const MODEL_FIT_NOTE = t('core.r_fit');
function aiDefaults(info) {
  const g = (r) => info?.gvs ? info.gvs.replace(/[\\/]$/, '') + '\\' + r : '';
  const home = info?.home || '';
  return {
    providers: structuredClone(PROVIDERS_DEFAULT),
    tasks: { chat: { p: '', m: '' }, commands: { p: '', m: '' }, vision: { p: '', m: '' }, summarize: { p: '', m: '' }, embed: { p: '', m: '' }, private: { p: '', m: '' } }, // v2.3: '' = first enabled & reachable provider; v2.6.6 adds private
    servers: { llama: { exe: g(GVS_REL.llamaExe), model: g(GVS_REL.llamaModel), port: 8080, ngl: 99, ctx: 0, fa: true, kvType: 'f16', extra: '', autoStart: false }, whisper: { exe: g(GVS_REL.whisperExe), model: g(GVS_REL.whisperModel), port: 8178, language: 'el', extra: '', autoStart: false } },
    stt: { kind: 'whispercpp', base: 'http://127.0.0.1:8178', language: 'el', autoSend: true, groqModel: 'whisper-large-v3-turbo' },
    tts: { mode: 'system', rate: 0, pitch: 0, device: 'Vulkan0', port: 0, refAudio: '', endpoint: '', exe: g(GVS_REL.tts), model: home ? home + '\\OmniVoice-Vulkan\\models\\omnivoice-base-Q8_0.gguf' : '', tokenizer: home ? home + '\\OmniVoice-Vulkan\\models\\omnivoice-tokenizer-Q8_0.gguf' : '', voice: '', template: '{exe} --model {model} --codec {tokenizer} --text-file {text_file} --output {out}', speak: false },
    assistant: { mode: 'auto', confirm: true, temperature: 0.3, extra: '', maxRounds: 6, thinking: false, thinkingBudget: 0, maxTokens: 0, maxContinue: 8, historyPct: 25 },
    autoTag: false,
  };
}
function migrate(s) {
  const from = s.v || 1;
  if (from < 2) { s.v = 2; s.migratedFrom = from; s.migratedAt = new Date().toISOString(); }
  s.chat ||= []; s.automations ||= []; s.shared ||= {}; s.templates ||= []; s.clipCats ||= null;
  for (const b of s.boards) { for (const it of b.items || []) { if (it.tags && !Array.isArray(it.tags)) it.tags = String(it.tags).split(',').map(x => x.trim()).filter(Boolean); } }
  return from;
}
// wrap Store.load to migrate + add v2 settings
const _storeLoad = Store.load.bind(Store);
Store.load = async function () {
  V2.viewer = API?.query?.().viewer || null;
  await _storeLoad();
  try { V2.info = API ? await API.inv('sys:info') : {}; } catch (e) { V2.info = {}; }
  const s = this.state; const from = migrate(s);
  const def = aiDefaults(V2.info); const S = s.settings;
  S.ai = { ...def, ...(S.ai || {}) };
  for (const k of ['tasks', 'servers', 'stt', 'tts', 'assistant']) S.ai[k] = { ...def[k], ...(S.ai[k] || {}) };
  for (const k of ['llama', 'whisper']) S.ai.servers[k] = { ...def.servers[k], ...(S.ai.servers[k] || {}) };
  for (const p of S.ai.providers || []) { const d = def.providers.find(x => x.id === p.id); if (d?.defModel && !p.defModel) p.defModel = d.defModel; }
  const have = new Set((S.ai.providers || []).map(p => p.id)); for (const p of def.providers) if (!have.has(p.id)) S.ai.providers.push(p);
  // v2.3: a task pinned to a provider that is now switched off falls back to «auto» (first enabled) instead of failing
  for (const k of Object.keys(S.ai.tasks)) { const tk = S.ai.tasks[k] ||= { p: '', m: '' }; const pv = S.ai.providers.find(p => p.id === tk.p); if (tk.p && (!pv || !pv.enabled)) { tk.p = ''; tk.m = ''; } }
  // v2.6.5: do not auto-probe LM Studio unless the user turned it on or pinned a task to it
  NyxLimits.migrateLmStudio(S.ai.providers, S.ai.tasks);
  // v2.6.5: 8192 was the old silent default — treat it as auto (omit -c) unless the user set ctxUserSet.
  // v2.6.6: auto no longer means "raise to the computed 262144"; 0/empty omits -c and the running server keeps its ctx.
  const L = S.ai.servers.llama; if (L && !L.ctxUserSet && (+L.ctx === 8192 || L.ctx === '' || L.ctx == null)) { L.ctx = 0; S.ai._migratedCtxAuto = true; }
  if (S.ai.assistant && (S.ai.assistant.historyPct == null || S.ai.assistant.historyPct === '')) S.ai.assistant.historyPct = 25;
  // v2.6.6: «Μοντέλο ανά εργασία» is the only place a model is set, including Ιδιωτικό.
  if (!S.ai.tasks.private) {
    const Pv = S.ai.private || {};
    S.ai.tasks.private = { p: Pv.provider || '', m: (Pv.model && !/[\\/]|\.gguf$/i.test(Pv.model) ? Pv.model : '') };
    S.ai._migratedPrivateTask = true;
  }
  for (const k of Object.keys(S.ai.tasks)) {
    const tk = S.ai.tasks[k];
    if (tk && tk.m && /[\\/]|\.gguf$/i.test(tk.m)) { tk._fromPath = String(tk.m).split(/[\\/]/).pop(); tk.m = ''; }
  }
  // v2.6.6: STT defaults to local whisper-server. If Groq was selected, switch and show a one-time notice (nothing silent).
  if (S.ai.stt && S.ai.stt.kind === 'groq' && !S.ai.stt.userKeptGroq) {
    S.ai.stt.kind = 'whispercpp';
    if (!S.ai.stt.base) S.ai.stt.base = 'http://127.0.0.1:8178';
    S.ai.stt._migratedFromGroq = true;
  }
  S.tools ||= {}; S.browser ||= { home: 'https://duckduckgo.com', search: 'https://duckduckgo.com/?q=%s', tabs: [] };
  try {
    if (API && !V2.viewer && S.ai) {
      const bag = {};
      const take = (id, o, f) => { if (o && typeof o[f] === 'string') bag[id] = o[f]; };
      take('llama.exe', S.ai.servers && S.ai.servers.llama, 'exe');
      take('llama.model', S.ai.servers && S.ai.servers.llama, 'model');
      take('whisper.exe', S.ai.servers && S.ai.servers.whisper, 'exe');
      take('whisper.model', S.ai.servers && S.ai.servers.whisper, 'model');
      take('sd.exe', S.ai.servers && S.ai.servers.sd, 'exe');
      take('sd.modelDir', S.ai.servers && S.ai.servers.sd, 'modelDir');
      take('sd.loraDir', S.ai.servers && S.ai.servers.sd, 'loraDir');
      take('sd.upscaleDir', S.ai.servers && S.ai.servers.sd, 'upscaleDir');
      take('tts.exe', S.ai.tts, 'exe');
      take('tts.model', S.ai.tts, 'model');
      take('tts.tokenizer', S.ai.tts, 'tokenizer');
      take('tts.refAudio', S.ai.tts, 'refAudio');
      const r = await API.inv('sys:migrateAiPaths', bag);
      if (r && r.paths) {
        const put = (id, o, f) => { if (o && r.paths[id] != null) o[f] = r.paths[id]; };
        put('llama.exe', S.ai.servers && S.ai.servers.llama, 'exe');
        put('llama.model', S.ai.servers && S.ai.servers.llama, 'model');
        put('whisper.exe', S.ai.servers && S.ai.servers.whisper, 'exe');
        put('whisper.model', S.ai.servers && S.ai.servers.whisper, 'model');
        put('sd.exe', S.ai.servers && S.ai.servers.sd, 'exe');
        put('sd.modelDir', S.ai.servers && S.ai.servers.sd, 'modelDir');
        put('sd.loraDir', S.ai.servers && S.ai.servers.sd, 'loraDir');
        put('sd.upscaleDir', S.ai.servers && S.ai.servers.sd, 'upscaleDir');
        put('tts.exe', S.ai.tts, 'exe');
        put('tts.model', S.ai.tts, 'model');
        put('tts.tokenizer', S.ai.tts, 'tokenizer');
        put('tts.refAudio', S.ai.tts, 'refAudio');
        if (r.migrated) {
          console.log('[nyx] path migrate:', (r.log || []).join(' | '));
          Store.save(true);
        } else if (r.log && r.log.length) {
          console.log('[nyx] path migrate:', r.log.join(' | '));
        }
      }
    }
  } catch (e) { console.warn('path migrate', e); }
  if (from < 2 && API && !V2.viewer) { API.inv('snap:create', t('core.016')).catch(() => {}); setTimeout(() => toast(t('core.017'), { ms: 6000 }), 1500); }
};
// viewer windows are read-only
const _storeSave = Store.save.bind(Store);
Store.save = function (now) { if (V2.viewer) return; return _storeSave(now); };

// ---------------- AI client ----------------
// v2.4: model ids that are not chat models (Groq/OpenAI lists mix them in)
const NOT_CHAT = /embed|whisper|tts|orpheus|playai|guard|distil-whisper|moderation|dall-e|prompt-guard/i;
const AI = {
  cfg() { return Store.state.settings.ai; },
  prov(id) { return this.cfg().providers.find(p => p.id === id); },
  // v2.3: never use a disabled provider. Order: task's provider (if enabled) → chat's provider (if enabled) → first enabled.
  blocked: {}, // provider id → { status, reason, at }  — 403 is never reused silently
  isBlocked(id) { return !!(id && this.blocked[id] && this.blocked[id].status === 403); },
  markBlocked(p, err, visible) {
    if (!p) return;
    const status = +(err && (err.status || err.code === 'http' && /\b403\b/.test(String(err.message || '')))) || (/\b403\b/.test(String((err && err.message) || err || '')) ? 403 : 0);
    if (status !== 403 && !(err && err.status === 403)) return false;
    const reason = cleanErr(err);
    this.blocked[p.id] = { status: 403, reason, at: Date.now() };
    if (visible !== false) toast('🚫 ' + t('v266.forbidden', { v0: p.name, v1: reason }), { kind: 'err', ms: 9000 });
    return true;
  },
  clearBlocked(id) { if (id) delete this.blocked[id]; },
  enabled() { return (this.cfg().providers || []).filter(p => NyxLimits.mayAutoUse(p) && /^https?:\/\//i.test(p.base || '') && !this.isBlocked(p.id)); },
  task(t) {
    const T = this.cfg().tasks || {}; const c = T[t] || {}; const fb = T.chat || {}; const on = (id) => { const p = id && this.prov(id); return p && p.enabled && !this.isBlocked(p.id) ? p : null; };
    const p = on(c.p) || on(fb.p) || this.enabled()[0] || null;
    const m = (p && p.id === c.p ? c.m : '') || (p && p.id === fb.p && t !== 'embed' && t !== 'private' ? fb.m : '') || '';
    return { p, m, auto: !c.p || !p || p.id !== c.p };
  },
  modelCache: {},
  async models(pid, force) { const c = this.modelCache[pid]; if (!force && c && Date.now() - c.at < 60e3) return c.list; const p = this.prov(pid); if (!p) throw new Error(t('v23.no_provider_short')); const r = await API.inv('ai:models', p); if (r && !Array.isArray(r) && r.error && r.code) { const e = new Error(r.error); e.code = r.code; e.status = r.status; if (e.status === 403) this.markBlocked(p, e); throw e; } this.modelCache[pid] = { list: r, at: Date.now() }; return r; },
  // v2.6.6: try the resolved provider, then other enabled ones. A 403 provider is marked red and never reused silently. Any fallback is visible.
  async pickModel(task) {
    const { p, m } = this.task(task);
    if (p && m) return { p, m };
    const cands = [p, ...this.enabled().filter(x => x !== p)].filter(Boolean); const errs = [];
    let firstFail = null;
    for (const c of cands) {
      try {
        const ms = await this.models(c.id);
        const want = this.cfg().tasks?.[task]?._fromPath;
        const byName = want && ms.find(x => String(x.id).toLowerCase().includes(String(want).replace(/\.gguf$/i, '').toLowerCase()));
        const pick = (task === 'embed' ? ms.find(x => /embed|bge|e5|minilm/i.test(x.id)) : byName || (c.defModel && ms.find(x => x.id === c.defModel)) || ms.find(x => !NOT_CHAT.test(x.id))) || (task === 'embed' ? null : ms[0]);
        if (pick) {
          if (firstFail) toast('↪️ ' + t('v266.fallback_visible', { v0: firstFail, v1: c.name + ' · ' + pick.id }), { ms: 7000 });
          this.last[task] = c.id; return { p: c, m: pick.id };
        }
        // single-model llama-server with an empty /v1/models list may still accept any name
        if (c.id === 'llama' && task !== 'embed' && (!ms || !ms.length)) { this.last[task] = c.id; return { p: c, m: 'default' }; }
        errs.push(c.name + ': ' + t('v23.no_models'));
      } catch (e) {
        this.markBlocked(c, e, true);
        const msg = cleanErr(e);
        errs.push(c.name + ': ' + msg);
        if (!firstFail) firstFail = c.name + (e.status === 403 ? ' (403)' : '');
      }
    }
    const err = new Error(cands.length ? t('v23.no_provider', { task: AI_TASKS.find(x => x[0] === task)?.[1] || task, v0: errs.join(' · ') }) : t('v23.no_enabled'));
    err.code = 'NOPROV'; throw err;
  },
  last: {}, lastPrep: null, lastTimings: null,
  async prepare(p, messages, extra = {}) {
    const A = this.cfg().assistant || {};
    const r = await API.inv('ai:prepare', p, { messages, model: extra.model, thinking: extra.thinking ?? A.thinking, thinkingBudget: extra.thinkingBudget ?? A.thinkingBudget, maxTokensOverride: extra.maxTokensOverride ?? A.maxTokens, reserve: extra.reserve });
    this.lastPrep = r; return r;
  },
  async chatTurn(p, body, onNotice) { return chatTurn(p, body, onNotice); },
  async chat(task, messages, opts = {}) { const { p, m } = await this.pickModel(task); return await this.chatTurn(p, { model: m, messages, ...opts }, opts.onNotice); },
  async text(task, prompt, system) { const r = await this.chat(task, [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }], { temperature: 0.3 }); return stripThink(r.message.content || '', r.message?.reasoning_content || r.reasoning); },
  async vision(file, prompt) {
    const url = await API.inv('ai:imageData', file);
    const r = await this.chat('vision', [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] }], { temperature: 0.2 });
    return stripThink(r.message.content || '', r.message?.reasoning_content || r.reasoning);
  },
  async embed(texts) { const { p, m } = this.task('embed'); if (!m || !p) return null; try { return await API.inv('ai:embed', p, m, texts); } catch (e) { console.warn('embed', e); return null; } },
};
const NyxLimits = {
  mayAutoUse(p) { if (!p || !p.enabled) return false; if (p.id !== 'lmstudio') return true; return !!p.userOn; },
  migrateLmStudio(providers, tasks) {
    const p = (providers || []).find(x => x.id === 'lmstudio'); if (!p) return { changed: false };
    const used = Object.values(tasks || {}).some(t => t && t.p === 'lmstudio');
    const custom = !!(p.base && String(p.base).replace(/\/+$/, '') !== 'http://localhost:1234/v1');
    if (p.userOn || used || custom) { if ((used || custom) && p.enabled && !p.userOn) { p.userOn = true; return { changed: true }; } return { changed: false }; }
    if (p.enabled) { p.enabled = false; return { changed: true }; } return { changed: false };
  },
  extractThink(s, reasoningContent) {
    let text = String(s || ''); const parts = []; if (reasoningContent) parts.push(String(reasoningContent).trim());
    const take = (re) => { text = text.replace(re, (_, t) => { if (t && String(t).trim()) parts.push(String(t).trim()); return ''; }); };
    take(/<think>([\s\S]*?)<\/think>/gi); take(/<thought>([\s\S]*?)<\/thought>/gi); take(/<reasoning>([\s\S]*?)<\/reasoning>/gi);
    if (/^\s*<think>/i.test(text)) { parts.push(text.replace(/^\s*<think>/i, '').trim()); text = ''; }
    // <|channel> / <|channel|> open; Gemma 4 closes thought with <channel|>; text after that is the answer.
    const chanMark = /<\|channel\|>|<\|channel>|<channel\|>/i;
    if (chanMark.test(text)) {
      const chunks = text.split(chanMark); const visible = [];
      for (const ch of chunks) {
        if (!ch) continue;
        const think = ch.match(/^(thought|reasoning|analysis)\b\s*/i);
        if (think) { const body = ch.slice(think[0].length).trim(); if (body) parts.push(body); continue; }
        const vis = ch.match(/^(final|response)\b\s*/i);
        if (vis) { const body = ch.slice(vis[0].length).trim(); if (body) visible.push(body); continue; }
        const body = ch.trim(); if (body) visible.push(body);
      }
      text = visible.join('\n');
    }
    return { text: text.trim(), reasoning: parts.filter(Boolean).join('\n\n') };
  },
  emptiedByThink(raw, extracted) { return !!String(raw || '').trim() && !String((extracted && extracted.text) || '').trim(); },
  stripThink(s, r) { return this.extractThink(s, r).text; },
  shouldContinue(finish, round, maxContinue) {
    const f = String(finish || '').toLowerCase();
    const length = f === 'length' || f === 'max_tokens' || f === 'max_completion_tokens';
    const cap = Math.max(0, Math.floor(+maxContinue || 0));
    return { length, continue: length && round < cap, reachedCap: length && round >= cap, round, maxContinue: cap };
  },
  nextContinueMessages(messages, partial) { return [...(messages || []), { role: 'assistant', content: String(partial || '') }]; },
  mergePieces(pieces) {
    let out = '';
    for (const raw of pieces || []) {
      const x = String(raw || ''); if (!x) continue; if (!out) { out = x; continue; }
      let k = Math.min(out.length, x.length, 80); while (k > 0 && out.slice(-k) !== x.slice(0, k)) k--; out += x.slice(k);
    }
    return out;
  },
};
function stripThink(s, r) { return NyxLimits.stripThink(s, r); }
async function chatTurn(p, body, onNotice) {
  const A = Store.state.settings.ai.assistant || {};
  const maxC = A.maxContinue ?? 8;
  const origin = body.messages;
  const pieces = []; const reasons = []; const rawPieces = [];
  let lastPrep = null, shownNoCap = false;
  const hasTools = !!(body.tools && body.tools.length);
  const finishTurn = (r, i, extra = {}) => {
    const merged = NyxLimits.mergePieces(pieces);
    const rawMerged = NyxLimits.mergePieces(rawPieces);
    const emptied = NyxLimits.emptiedByThink(rawMerged, { text: merged });
    if (emptied && onNotice) onNotice('warn', t('v265.empty_after_clean'));
    r.message = { ...(r.message || {}), content: merged, reasoning_content: reasons.join('\n\n') || undefined };
    r.reasoning = reasons.join('\n\n'); r._prep = lastPrep; r.continued = i; r._timings = r._timings || r.timings || AI.lastTimings;
    if (emptied) { r.emptyAfterClean = true; r.rawContent = rawMerged; }
    return Object.assign(r, extra);
  };
  for (let i = 0; i <= maxC; i++) {
    const msgs = i === 0 ? origin : NyxLimits.nextContinueMessages(origin, NyxLimits.mergePieces(pieces));
    let prep = {};
    try { prep = await AI.prepare(p, msgs, { model: body.model, thinking: body.thinking ?? A.thinking, thinkingBudget: body.thinkingBudget ?? A.thinkingBudget, maxTokensOverride: body.max_tokens || body.maxTokensOverride || A.maxTokens }); lastPrep = prep; }
    catch (e) { if (onNotice) onNotice('err', t('v265.prep_fail', { v0: cleanErr(e) })); prep = {}; }
    if (prep.reason === 'prompt_overflow') throw new Error(t('v265.prompt_overflow', { v0: prep.n_ctx, v1: prep.promptTokens }));
    if (prep.omitted && !shownNoCap && onNotice) { shownNoCap = true; onNotice('info', t('v265.no_cap', { v0: prep.reason })); }
    if (prep.warnings && onNotice) for (const w of prep.warnings) if (w.code === 'tokenize_fail' || w.code === 'props_fail') onNotice('info', t('v265.warn_' + (w.code === 'tokenize_fail' ? 'tokenize' : 'props')));
    let r;
    try { r = await API.inv('ai:chat', p, { ...body, messages: msgs, ...(prep.body || {}) }); }
    catch (e) { AI.markBlocked(p, e, true); throw e; }
    if (r && !r.message && r.error && r.status === 403) { const e = new Error(r.error); e.status = 403; AI.markBlocked(p, e, true); throw e; }
    if (r.timings || r.usage) { AI.lastTimings = r.timings || null; r._timings = r.timings || null; }
    if (r.thinkingIgnored && onNotice) onNotice('info', t('v265.think_ignored'));
    const calls = r.message?.tool_calls;
    if (hasTools && calls && calls.length) { r._prep = prep; r.continued = i; return r; }
    const rawPiece = r.message?.content || '';
    const ex = NyxLimits.extractThink(rawPiece, r.message?.reasoning_content || r.reasoning);
    if (ex.reasoning) reasons.push(ex.reasoning);
    pieces.push(ex.text);
    rawPieces.push(rawPiece);
    const sc = NyxLimits.shouldContinue(r.finish, i, maxC);
    if (!sc.length) return finishTurn(r, i);
    if (sc.reachedCap) {
      if (onNotice) onNotice('warn', t('v265.cont_cap', { v0: maxC }));
      return finishTurn(r, i, { truncated: true });
    }
    if (onNotice) onNotice('cont', t('v265.cont_notice', { v0: i + 1, v1: maxC }));
  }
}

function parseJsonLoose(s) {
  s = String(s); const cands = []; const fen = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (fen) cands.push(fen[1]);
  for (const [o, c] of [['{', '}'], ['[', ']']]) { const a = s.indexOf(o), b = s.lastIndexOf(c); if (a >= 0 && b > a) cands.push(s.slice(a, b + 1)); }
  if (cands.length > 1 && !fen) cands.sort((x, y) => s.indexOf(x) - s.indexOf(y));
  for (const body of cands) { try { return JSON.parse(body); } catch (e) { try { return JSON.parse(body.replace(/,\s*([}\]])/g, '$1')); } catch (e2) {} } }
  return null;
}

// ---------------- Local embeddings fallback (hashed char-trigrams + words) ----------------
const LocalEmb = {
  D: 512,
  vec(text) { const v = new Float32Array(this.D); const n = ' ' + norm(text).replace(/[^\p{L}\p{N}]+/gu, ' ') + ' '; const add = (s, w) => { let hsh = 2166136261; for (let i = 0; i < s.length; i++) { hsh ^= s.charCodeAt(i); hsh = Math.imul(hsh, 16777619); } v[(hsh >>> 0) % this.D] += w; };
    for (const w of n.split(' ').filter(Boolean)) { add('w:' + w, 2); if (w.length > 4) add('p:' + w.slice(0, 5), 1.5); } for (let i = 0; i < n.length - 2; i++) add(n.slice(i, i + 3), 1);
    let L = 0; for (const x of v) L += x * x; L = Math.sqrt(L) || 1; for (let i = 0; i < v.length; i++) v[i] /= L; return v; },
};
function cosine(a, b) { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / (Math.sqrt(na * nb) || 1); }

// ---------------- Speech ----------------
const Speech = {
  rec: null, chunks: [], stream: null,
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.chunks = []; this.rec = new MediaRecorder(this.stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '' });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data); this.rec.start(250);
  },
  stop() { return new Promise((res) => { if (!this.rec) return res(null); this.rec.onstop = () => { this.stream?.getTracks().forEach(t => t.stop()); const b = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' }); this.rec = null; res(b); }; this.rec.stop(); }); },
  get active() { return !!this.rec; },
  async toWav(blob) {
    const buf = await blob.arrayBuffer(); const ac = new AudioContext(); const audio = await ac.decodeAudioData(buf.slice(0)); ac.close();
    const sr = 16000; const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * sr)), sr); const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start(); const out = await off.startRendering();
    return encodeWav(out.getChannelData(0), sr);
  },
  async transcribeBlob(blob) { const wav = blob.type === 'audio/wav' ? new Uint8Array(await blob.arrayBuffer()) : await this.toWav(blob); return API.inv('stt:buffer', Store.state.settings.ai.stt, wav, 'audio.wav', {}); },
  async transcribeMedia(file) { return API.inv('stt:media', Store.state.settings.ai.stt, file, {}); },
  // v2.3: system voice that really speaks — waits for async voice list, detects a silent engine (no onstart in 2.5 s / error /
  // no voices) and falls back to Windows SAPI via PowerShell (hidden). Errors are shown, never swallowed. Returns how it spoke.
  voices(ms = 1500) { const v = speechSynthesis.getVoices(); if (v.length) return Promise.resolve(v); return new Promise(res => { const done = () => { clearTimeout(tm); speechSynthesis.removeEventListener('voiceschanged', done); res(speechSynthesis.getVoices()); }; const tm = setTimeout(done, ms); speechSynthesis.addEventListener('voiceschanged', done); }); },
  // v2.4: what a voice should read — no markdown symbols, links, code fences or emoji
  speechText(src) {
    let x = plainText(String(src || '').includes('<') ? src : String(src || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    x = x.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ').replace(/^\s{0,3}(#{1,6}|>|[-*+•]|\d+[.)])\s+/gm, '').replace(/(\*\*|__|~~|\*|_)(?=\S)([^*_~]+?)\1/g, '$2').replace(/[*_~#|]{1,}/g, ' ')
      .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D\u20E3]/gu, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    return x;
  },
  // language of the TEXT (not of the UI): Greek letters → el
  textLang(x) { const g = (x.match(/[\u0370-\u03ff\u1f00-\u1fff]/g) || []).length, l = (x.match(/[a-z]/gi) || []).length; return g && g >= l * 0.3 ? 'el' : l ? 'en' : (LANG === 'en' ? 'en' : 'el'); },
  // chosen voice in settings: '' = auto, 'web:Name', 'sapi:Name', 'onecore:Name'
  pickWeb(vs, lang, want) {
    if (want?.startsWith('web:')) { const v = vs.find(v => v.name === want.slice(4)); if (v) return v; }
    const L = vs.filter(v => (v.lang || '').toLowerCase().replace('_', '-').startsWith(lang));
    return L.find(v => /natural|online/i.test(v.name)) || L.find(v => v.localService) || L[0] || null;
  },
  noVoiceHint(lang) { if (lang !== 'el') return; toast('🗣️ ' + t('v24.no_greek_voice'), { kind: 'err', ms: 14000, action: { label: t('v24.open_lang'), fn: () => API.inv('sys:winSettings', 'speech').catch(() => {}) } }); },
  async speak(text, { report = false } = {}) {
    const T = Store.state.settings.ai.tts; text = this.speechText(text).slice(0, 1200); if (!text) return null;
    const lang = this.textLang(text); const want = T.voice || ''; const rate = +T.rate || 0, pitch = +T.pitch || 0;
    this.stopSpeak();
    const play = async (file, via, voice) => { const a = this._audio = new Audio(Store.media(file)); await a.play(); return { via, voice }; };
    if (T.mode === 'command') { try { const f = await API.inv('tts:run', T, text); return await play(f, 'command', ''); } catch (e) { toast('⚠️ TTS: ' + cleanErr(e), { kind: 'err' }); return null; } }
    if (T.mode === 'vsserver') { try { const r = await API.inv('tts:vsSpeak', T, text); return await play(r.file, 'vsserver', r.endpoint || ''); } catch (e) { toast('⚠️ vs-engine: ' + cleanErr(e), { kind: 'err', ms: 9000, action: { label: t('v23.open_ai'), fn: () => Hub.open() } }); return null; } }
    const win = async (why) => {
      try {
        const o = want.startsWith('sapi:') || want.startsWith('onecore:') ? { voice: want.slice(want.indexOf(':') + 1), src: want.split(':')[0], pitch } : { pitch };
        const r = await API.inv('tts:sapi', text, lang, rate, o);
        if (r.noVoice) { this.noVoiceHint(lang); return null; }
        return await play(r.file, r.src === 'onecore' ? 'onecore' : 'sapi', r.voice);
      } catch (e) { toast('⚠️ ' + t('v23.tts_fail', { v0: why || '', v1: cleanErr(e) }), { kind: 'err', action: { label: t('v23.open_ai'), fn: () => Hub.open() } }); return null; }
    };
    if (T.engine === 'sapi' || want.startsWith('sapi:') || want.startsWith('onecore:')) return win('');
    if (!window.speechSynthesis) return win('no speechSynthesis');
    const vs = await this.voices();
    const v = this.pickWeb(vs, lang, want);
    // no voice for this language in Chromium → Windows voices (OneCore has Greek «Stefanos»); never read Greek with an English voice
    if (!v) return V2.info?.platform?.startsWith('Windows') || navigator.userAgent.includes('Windows') ? win(t('v23.no_voices')) : (this.noVoiceHint(lang), null);
    const u = new SpeechSynthesisUtterance(text); u.lang = v.lang || (lang === 'el' ? 'el-GR' : 'en-GB'); u.voice = v;
    u.rate = Math.max(0.5, Math.min(2, 1 + rate / 10)); u.pitch = Math.max(0, Math.min(2, 1 + pitch / 10));
    return new Promise((res) => {
      let started = false; const fail = (why) => { if (started === null) return; started = null; clearTimeout(tm); speechSynthesis.cancel(); win(why).then(res); };
      const tm = setTimeout(() => !started && fail('timeout'), 2500);
      u.onstart = () => { if (started === null) return; started = true; clearTimeout(tm); res({ via: 'web', voice: v.name }); };
      u.onerror = (e) => { if (e.error === 'interrupted' || e.error === 'canceled') return; started ? toast('⚠️ TTS: ' + e.error, { kind: 'err' }) : fail(e.error); };
      setTimeout(() => speechSynthesis.speak(u), 60); // cancel() → speak() in the same tick is dropped by Chromium
    });
  },
  // all voices for the picker: Chromium + Windows (SAPI5 + OneCore), each with its language
  async allVoices(fresh) {
    const web = window.speechSynthesis ? (await this.voices()).map(v => ({ id: 'web:' + v.name, name: v.name, lang: v.lang || '', src: 'web' })) : [];
    const w = await API.inv('tts:voices', fresh).catch(() => []);
    return web.concat(w.map(v => ({ id: v.src + ':' + v.name, name: v.name, lang: v.lang, src: v.src })));
  },
  stopSpeak() { try { speechSynthesis.cancel(); } catch (e) {} try { this._audio?.pause(); } catch (e) {} this._audio = null; API.inv('tts:sapiStop').catch(() => {}); },
};
function encodeWav(samples, sr) {
  const b = new ArrayBuffer(44 + samples.length * 2); const d = new DataView(b); const w = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); d.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); d.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Uint8Array(b);
}
const fmtTime = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), x = Math.floor(s % 60); return `${m}:${String(x).padStart(2, '0')}`; };

const BoardOf = new WeakMap();
function allItems() { const out = []; for (const b of Store.state.boards) for (const i of b.items) { BoardOf.set(i, b); out.push(i); } return out; }

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u || '').slice(0, 40); } }
