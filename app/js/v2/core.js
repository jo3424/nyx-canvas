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
const AI_TASKS = [['chat', t('core.001'), 'message-circle'], ['commands', t('core.002'), 'terminal'], ['greek', t('v267.task_greek'), 'flag'], ['private', t('v266.task_private'), 'venetian-mask'], ['vision', t('core.003'), 'scan-eye'], ['summarize', t('core.004'), 'list-collapse'], ['embed', t('core.005'), 'binary']];
function aiDefaults(info) {
  const g = (r) => info?.gvs ? info.gvs.replace(/[\\/]$/, '') + '\\' + r : '';
  const home = info?.home || '';
  return {
    providers: structuredClone(PROVIDERS_DEFAULT),
    tasks: { chat: { p: '', m: '' }, commands: { p: '', m: '' }, greek: { p: '', m: '' }, vision: { p: '', m: '' }, summarize: { p: '', m: '' }, embed: { p: '', m: '' }, private: { p: '', m: '' } }, // v2.3: '' = first enabled; v2.6.6 private; v2.6.7 greek
    servers: { llama: { exe: home ? home + '\\llama-router\\llama-server.exe' : '', model: g(GVS_REL.llamaModel), port: 8080, ngl: 99, ctx: 0, fa: true, kvType: 'f16', extra: '', autoStart: false, modelsDir: info?.gvs ? info.gvs.replace(/[\\/]$/, '') + '\\models' : '', modelsMax: 2, diskBudgetGB: 70 }, whisper: { exe: g(GVS_REL.whisperExe), model: g(GVS_REL.whisperModel), port: 8178, language: 'el', extra: '', autoStart: false } },
    stt: { kind: 'whispercpp', base: 'http://127.0.0.1:8178', language: 'el', autoSend: true, groqModel: 'whisper-large-v3-turbo' },
    tts: { mode: 'system', rate: 0, pitch: 0, device: 'Vulkan0', port: 0, refAudio: '', endpoint: '', exe: g(GVS_REL.tts), model: home ? home + '\\OmniVoice-Vulkan\\models\\omnivoice-base-Q8_0.gguf' : '', tokenizer: home ? home + '\\OmniVoice-Vulkan\\models\\omnivoice-tokenizer-Q8_0.gguf' : '', voice: '', template: '{exe} --model {model} --codec {tokenizer} --text-file {text_file} --output {out}', speak: false },
    assistant: { mode: 'auto', confirm: true, canvasConfirm: true, temperature: 0.3, extra: '', maxRounds: 6, thinking: false, thinkingBudget: 0, maxTokens: 0, maxContinue: 8, historyPct: 25, attachReserve: 2048, loadRetries: 10 },
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
  if (S.ai.assistant && S.ai.assistant.canvasConfirm == null) S.ai.assistant.canvasConfirm = true;
  if (S.ai.assistant && (S.ai.assistant.attachReserve == null || S.ai.assistant.attachReserve === '')) S.ai.assistant.attachReserve = 2048;
  if (S.ai.tasks && !S.ai.tasks.greek) S.ai.tasks.greek = { p: '', m: '' };
  const Llm = S.ai.servers && S.ai.servers.llama;
  if (Llm) {
    if (Llm.diskBudgetGB == null || Llm.diskBudgetGB === '') Llm.diskBudgetGB = 70;
    if (Llm.modelsMax == null || Llm.modelsMax === '' || +Llm.modelsMax === 0) { Llm.modelsMax = 2; S.ai._migratedModelsMax2 = true; }
    if (Llm.modelsDir == null) Llm.modelsDir = '';
    const gvsLlama = /GPU-Voice-Studio[\\/]third_party[\\/]llama[\\/]llama-server(?:\.exe)?$/i;
    if (!Llm.exe || gvsLlama.test(String(Llm.exe))) {
      const home = (V2.info && (V2.info.home || V2.info.userProfile)) || '';
      if (home) { Llm.exe = String(home).replace(/[\\/]$/, '') + '\\llama-router\\llama-server.exe'; S.ai._migratedLlamaRouterExe = true; }
    }
  }
  S.ai.rentedGpu ||= { enabled: false, capUsd: 10, endpoint: '', extra: '' };
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
    const c = (this.cfg().tasks || {})[task] || {};
    if (!c.m && (task === 'private' || c.p)) {
      const name = ((typeof AI_TASKS !== 'undefined' && AI_TASKS.find(x => x[0] === task)) || [task, task])[1];
      const err = new Error(t('v2671.need_model', { v0: name }));
      err.code = 'NOMODEL';
      toast('⚠️ ' + err.message, { kind: 'err', ms: 8000 });
      throw err;
    }
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
  last: {}, lastPrep: null, lastTimings: null, lastRequest: null,
  noteRequest(partial) {
    const prev = this.lastRequest || {};
    const tm = (partial && (partial.timings || partial._timings)) || this.lastTimings || {};
    const prep = (partial && (partial._prep || partial.prep)) || this.lastPrep || {};
    const o = {
      at: Date.now(),
      model: (partial && partial.model) || prev.model || '',
      n_ctx: prep.n_ctx != null ? prep.n_ctx : prev.n_ctx,
      prompt_n: tm.prompt_n != null ? tm.prompt_n : (prep.promptTokens != null ? prep.promptTokens : prev.prompt_n),
      prompt_ms: tm.prompt_ms != null ? tm.prompt_ms : prev.prompt_ms,
      predicted_n: tm.predicted_n != null ? tm.predicted_n : prev.predicted_n,
      predicted_ms: tm.predicted_ms != null ? tm.predicted_ms : prev.predicted_ms,
      cache_n: tm.cache_n != null ? tm.cache_n : (tm.cached_n != null ? tm.cached_n : prev.cache_n),
      truncated: !!(partial && (partial.truncated || partial.finish === 'length')),
      failed: !!(partial && (partial.failed || partial.error)),
      error: (partial && (partial.error || partial.errMsg)) || (partial && partial.failed ? String(partial.message || '') : '') || '',
      cpu: !!(partial && partial.cpu),
      finish: (partial && partial.finish) || prev.finish || '',
    };
    this.lastRequest = o;
    return o;
  },
  async prepare(p, messages, extra = {}) {
    const A = this.cfg().assistant || {};
    const r = await API.inv('ai:prepare', p, { messages, model: extra.model, thinking: extra.thinking ?? A.thinking, thinkingBudget: extra.thinkingBudget ?? A.thinkingBudget, maxTokensOverride: extra.maxTokensOverride ?? A.maxTokens, reserve: extra.reserve, tools: extra.tools && extra.tools.length ? extra.tools : undefined });
    this.lastPrep = r; return r;
  },
  _streamId: null,
  abort() { const id = this._streamId; if (id) API.inv('ai:chatAbort', id).catch(() => {}); },
  async chatTurn(p, body, onNotice, onDelta) { return chatTurn(p, body, onNotice, onDelta); },
  // v2.6.9 fix (2.6.8.x bug): the callbacks were spread into the IPC body → «An object could not be cloned» on the JSON path
  async chat(task, messages, opts = {}) { const { onNotice, onDelta, ...rest } = opts; const { p, m } = await this.pickModel(task); return await this.chatTurn(p, { model: m, messages, ...rest }, onNotice, onDelta); },
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
  // v2.6.9: a model that cannot do tool calls (router 500 «peg-native format») — detected from the message text
  isToolFormatError(msg) { return /peg-native|does not match the expected .{0,40}format|failed to parse tool|tool[_ ]?call[s]? (?:are |is )?not supported|tools? (?:are |is )?not supported|unable to (?:parse|generate) tool/i.test(String((msg && msg.message) || msg || '')); },
  // known from the user's test 12–13/11 (llama-server b12230): Krikri answers tool calls with 500 peg-native
  KNOWN_NO_TOOLS: [/krikri/i],
  _toolCaps() { try { return JSON.parse(localStorage.getItem('nyx.toolCaps') || '{}') || {}; } catch (e) { return {}; } },
  toolCap(model) {
    const id = String(model || ''); if (!id) return { state: 'unknown' };
    const k = id.split(/[\\/]/).pop().toLowerCase(); const rec = this._toolCaps()[k];
    if (rec && rec.ok === false) return { state: 'no', at: rec.at, err: rec.err || '', seen: true };
    if (rec && rec.ok === true) return { state: 'ok', at: rec.at, seen: true };
    if (this.KNOWN_NO_TOOLS.some((re) => re.test(id))) return { state: 'no', known: true };
    return { state: 'unknown' };
  },
  noteTools(model, ok, err) {
    const id = String(model || ''); if (!id) return;
    try { const all = this._toolCaps(); all[id.split(/[\\/]/).pop().toLowerCase()] = { ok: !!ok, at: Date.now(), err: ok ? '' : String(err || '').slice(0, 200) }; localStorage.setItem('nyx.toolCaps', JSON.stringify(all)); } catch (e) {}
  },
  // MTP / speculative decoding from the server's own timings (draft_n / draft_n_accepted); null = server said nothing
  mtpOf(tm) {
    if (!tm || typeof tm !== 'object') return { state: 'unknown' };
    const n = tm.draft_n != null ? +tm.draft_n : null; const a = tm.draft_n_accepted != null ? +tm.draft_n_accepted : null;
    if (n != null && n > 0) return { state: 'on', draft: n, accepted: a, rate: a != null ? a / n : null };
    if (tm.predicted_n != null || tm.predicted_ms != null) return { state: 'off' };
    return { state: 'unknown' };
  },
  speedOf(tm) { return tm && tm.predicted_n != null && tm.predicted_ms > 0 ? tm.predicted_n / (tm.predicted_ms / 1000) : null; },
  // VRAM warning only from a real measurement (perf snapshot); Voice Studio found by process name or path
  GVS_PROC: /voice.?studio|gpu-voice|vs-engine|omnivoice/i,
  vramWarn(snap, opts) {
    opts = opts || {};
    const ad = snap && snap.gpu && snap.gpu.adapter;
    if (!ad || !ad.total || ad.used == null) return { state: 'none' };
    const pct = ad.used / ad.total;
    const procs = (snap.gpu.procs || []).filter((x) => x && x.vram > 0);
    const gvs = procs.filter((x) => this.GVS_PROC.test(String(x.name || '') + ' ' + String(x.path || '')));
    const others = procs.filter((x) => !gvs.includes(x) && !x.owner && !/llama-server|llama-router/i.test(String(x.name || '')) && x.vram >= (opts.otherMin || 512 * 1048576));
    const high = pct >= (opts.highPct || 0.9);
    return { state: gvs.length ? 'gvs' : high ? 'high' : 'ok', pct, used: ad.used, total: ad.total, gvs, others, high };
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
function newStreamId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
async function invokeChat(p, body, onNotice, onDelta) {
  const useStream = body.stream !== false;
  if (!useStream) return API.inv('ai:chat', p, body);
  const id = body._streamId || newStreamId();
  // v2.6.8.2: background (attachment) requests keep their own id so Stop and send-pause never mix them up.
  if (!body._bg) AI._streamId = id;
  const unsub = (typeof API !== 'undefined' && API.onAiStream) ? API.onAiStream((ev) => {
    if (!ev || ev.id !== id) return;
    if (ev.type === 'load' || ev.notice) { if (onNotice) onNotice('load', ev.notice || ev.text || t('v268.loading_model')); }
    if ((ev.type === 'delta' || ev.type === 'timings') && onDelta) onDelta(ev);
  }) : null;
  try {
    return await API.inv('ai:chatStream', p, { ...body, _streamId: id });
  } finally {
    if (typeof unsub === 'function') unsub();
    if (AI._streamId === id) AI._streamId = null;
  }
}
async function chatTurn(p, body, onNotice, onDelta) {
  const A = Store.state.settings.ai.assistant || {};
  const maxC = A.maxContinue ?? 8;
  const origin = body.messages;
  let pieces = []; const reasons = []; let rawPieces = [];
  let lastPrep = null, shownNoCap = false;
  const hasTools = !!(body.tools && body.tools.length);
  // v2.6.9: thinking cap from the user's setting (visible chip + Hub field); 0 = no separate cap. Never changed by code.
  let thinkOn = !!(body.thinking ?? A.thinking);
  const capOf = () => thinkOn ? Math.max(0, Math.floor(+(body.thinkingBudget ?? A.thinkingBudget) || 0)) : 0;
  let retriedNoThink = false, thinkCapHit = false, reasonN = 0;
  const finishTurn = (r, i, extra = {}) => {
    const merged = NyxLimits.mergePieces(pieces);
    const rawMerged = NyxLimits.mergePieces(rawPieces);
    const emptied = NyxLimits.emptiedByThink(rawMerged, { text: merged });
    if (emptied && onNotice) onNotice('warn', t('v265.empty_after_clean'));
    // v2.6.9: nothing silent — an empty answer always carries a visible notice
    const emptyFinal = !String(merged || '').trim() && !(r.message && r.message.tool_calls && r.message.tool_calls.length);
    if (emptyFinal && onNotice) onNotice('warn', t('v269.empty_final'));
    r.message = { ...(r.message || {}), content: merged, reasoning_content: reasons.join('\n\n') || undefined };
    r.reasoning = reasons.join('\n\n'); r._prep = lastPrep; r.continued = i; r._timings = r._timings || r.timings || AI.lastTimings;
    AI.noteRequest({ model: r.model, timings: r._timings, _prep: lastPrep, truncated: !!r.truncated || r.finish === 'length', finish: r.finish });
    if (emptied) { r.emptyAfterClean = true; r.rawContent = rawMerged; }
    if (emptyFinal) { r.emptyFinal = true; r.emptyAfterClean = true; r.rawContent = rawMerged || r.reasoning || ''; }
    r.thinkCapHit = thinkCapHit; r.retriedNoThink = retriedNoThink; r.reasoning_n = reasonN;
    return Object.assign(r, extra);
  };
  for (let i = 0; i <= maxC; i++) {
    const msgs = i === 0 ? origin : NyxLimits.nextContinueMessages(origin, NyxLimits.mergePieces(pieces));
    let prep = {};
    const prepOpts = { model: body.model, tools: body.tools, thinking: thinkOn, thinkingBudget: body.thinkingBudget ?? A.thinkingBudget, maxTokensOverride: body.max_tokens || body.maxTokensOverride || A.maxTokens };
    try { prep = await AI.prepare(p, msgs, prepOpts); lastPrep = prep; }
    catch (e) { if (e && e.code === 'ABORTED') throw e; if (onNotice) onNotice('err', t('v265.prep_fail', { v0: cleanErr(e) })); prep = {}; }
    // v2.6.8.2: pre-send check — system + history + attachments + reserve ≤ n_ctx. Trim attachments, never send over the limit.
    if (i === 0 && typeof Att !== 'undefined' && Att.fitPrompt) {
      try { const f = await Att.fitPrompt(msgs, prep, onNotice, (m) => AI.prepare(p, m, prepOpts)); if (f) { prep = f; lastPrep = f; } }
      catch (e) { if (e && e.code === 'ABORTED') throw e; }
    }
    if (prep.reason === 'prompt_overflow') throw new Error(t('v265.prompt_overflow', { v0: prep.n_ctx, v1: prep.promptTokens }));
    if (prep.omitted && !shownNoCap && onNotice) { shownNoCap = true; onNotice('info', t('v265.no_cap', { v0: prep.reason })); }
    if (prep.warnings && onNotice) for (const w of prep.warnings) if (w.code === 'tokenize_fail' || w.code === 'props_fail') onNotice('info', t('v265.warn_' + (w.code === 'tokenize_fail' ? 'tokenize' : 'props')));
    let r;
    const cap = capOf();
    try { r = await invokeChat(p, { ...body, messages: msgs, ...(prep.body || {}), ...(cap ? { think_cap: cap } : {}), loadRetries: body.loadRetries ?? A.loadRetries ?? 10 }, onNotice, onDelta); }
    catch (e) { AI.markBlocked(p, e, true); AI.noteRequest({ failed: true, error: cleanErr(e), model: body.model }); throw e; }
    if (r && !r.message && r.error && r.status === 403) { const e = new Error(r.error); e.status = 403; AI.markBlocked(p, e, true); throw e; }
    if (r.timings || r.usage) { AI.lastTimings = r.timings || null; r._timings = r.timings || null; }
    if (r.thinkingIgnored && onNotice) onNotice('info', t('v265.think_ignored'));
    if (r.reasoning_n) reasonN += r.reasoning_n;
    const calls = r.message?.tool_calls;
    if (hasTools && calls && calls.length) { r._prep = prep; r.continued = i; r.thinkCapHit = thinkCapHit; r.retriedNoThink = retriedNoThink; NyxLimits.noteTools(body.model, true); return r; }
    const rawPiece = r.message?.content || '';
    const ex = NyxLimits.extractThink(rawPiece, r.message?.reasoning_content || r.reasoning);
    // v2.6.9: thinking used up the budget (or the answer limit) and left no answer → ask again without thinking, visibly.
    const noAnswerYet = !NyxLimits.mergePieces([...pieces, ex.text]).trim();
    const lenStop = NyxLimits.shouldContinue(r.finish, 0, 1).length;
    if (thinkOn && !retriedNoThink && noAnswerYet && (r.finish === 'think_cap' || lenStop || !!ex.reasoning)) {
      if (ex.reasoning) reasons.push(ex.reasoning);
      if (r.finish === 'think_cap') { thinkCapHit = true; if (onNotice) onNotice('warn', t('v269.think_hit_cap', { v0: cap })); }
      else if (onNotice) onNotice('warn', t('v269.think_empty_retry', { v0: lenStop ? t('v269.think_len') : t('v269.think_nothing') }));
      thinkOn = false; retriedNoThink = true; pieces = []; rawPieces = [];
      i = -1; continue;
    }
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
