'use strict';
// v2.6.8.2 — token counting without guessing low.
// Real count: llama-server /tokenize when the model is already loaded (one request per attachment, cached per hash).
// Without a loaded model: a conservative estimate — Greek or code ≈ chars/2, English prose ≈ chars/3.5, CJK ≈ 1/char.
// The old chars/4 counted a 51,070-char half-Greek PDF as 12.8k tokens; the server counted ~30.4k with the prompt.
// Pure functions only: the renderer uses window.NyxTok, the unit tests require() this file.
(function (root) {
  const GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]/g;
  const CJK = /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g;
  const LETTER = /\p{L}/gu;
  const SYM = /[{}[\]();=<>/\\:"'`|&*+#$_~^%@!?,.-]/g;
  const CODE_KINDS = new Set(['code', 'zip', 'json', 'csv']);
  const PER_TOKEN = { dense: 2, prose: 3.5 };
  const count = (s, re) => { const m = s.match(re); return m ? m.length : 0; };
  function sample(s) { return s.length > 60000 ? s.slice(0, 20000) + s.slice(Math.floor(s.length / 2) - 10000, Math.floor(s.length / 2) + 10000) + s.slice(-20000) : s; }
  function isCodeLike(text) {
    const s = sample(String(text || '')); if (!s.length) return false;
    const sym = count(s, SYM);
    const lines = s.split('\n'); const indented = lines.filter(l => /^( {2,}|\t)/.test(l)).length;
    return sym / s.length >= 0.07 || (lines.length > 8 && indented / lines.length > 0.3);
  }
  function greekShare(text) {
    const s = sample(String(text || '')); const letters = count(s, LETTER); if (!letters) return 0;
    return count(s, GREEK) / letters;
  }
  // How many chars per token this text gets. Lower = more tokens = safer.
  function charsPerToken(text, kind) {
    if (CODE_KINDS.has(kind)) return PER_TOKEN.dense;
    if (greekShare(text) >= 0.1) return PER_TOKEN.dense;
    if (isCodeLike(text)) return PER_TOKEN.dense;
    return PER_TOKEN.prose;
  }
  function estimate(text, kind) {
    const s = String(text || ''); if (!s.length) return 0;
    const cjk = count(sample(s), CJK) * (s.length / Math.max(1, sample(s).length));
    const rest = Math.max(0, s.length - cjk);
    return Math.ceil(cjk + rest / charsPerToken(s, kind));
  }
  function estimateMessages(messages, tools) {
    let n = 0;
    for (const m of messages || []) {
      const c = m && m.content;
      const s = typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => (p && (p.text || p.content)) || '').join('\n') : (c == null ? '' : JSON.stringify(c));
      n += estimate(s) + 8; // role + template tokens per message
      if (m && m.tool_calls) n += estimate(JSON.stringify(m.tool_calls), 'json');
    }
    if (tools && tools.length) n += estimate(JSON.stringify(tools), 'json');
    return n;
  }
  // Water-filling: small items get all of their tokens, big ones share what is left equally.
  function allocate(items, cap) {
    const out = {}; let left = Math.max(0, Math.floor(cap));
    const L = items.slice().sort((a, b) => a.tokens - b.tokens);
    for (let i = 0; i < L.length; i++) {
      const share = Math.floor(left / (L.length - i));
      const give = Math.max(0, Math.min(L[i].tokens, share));
      out[L[i].id] = give; left -= give;
    }
    return out;
  }
  // Keep the start of a text so it is ≤ want tokens (proportional to a known total; cut at a line end when close).
  function sliceToTokens(text, want, total) {
    const s = String(text || ''); total = Math.max(1, total || estimate(s));
    if (want >= total) return s;
    if (want <= 0) return '';
    let keep = Math.floor(s.length * (want / total) * 0.98);
    const nl = s.lastIndexOf('\n', keep);
    if (nl > keep * 0.9) keep = nl;
    return s.slice(0, keep);
  }
  const META_RE = /(^|[\\/])(package\.json|manifest\.json|[^\\/]*\.manifest|app\.json|composer\.json|cargo\.toml|pyproject\.toml|changelog[^\\/]*|changes[^\\/]*|history\.md|releases?\.md)$/i;
  const TEXT_KINDS = new Set(['text', 'code', 'csv', 'json']);
  function isMetaFile(name) { return META_RE.test(String(name || '')); }
  // Short, LLM-free digest of a manifest / CHANGELOG: the fields and the newest entries.
  function metaDigest(name, text, maxLines) {
    const s = String(text || ''); maxLines = maxLines || 24;
    if (/\.json$/i.test(name)) {
      let j = null; try { j = JSON.parse(s); } catch (e) {}
      if (j && typeof j === 'object') {
        if (/changelog/i.test(name)) {
          const keys = Object.keys(j); const top = keys.slice(0, 2);
          return top.map(k => k + ': ' + JSON.stringify(j[k]).slice(0, 600)).join('\n') + (keys.length > 2 ? `\n(+${keys.length - 2} versions: ${keys.slice(2, 12).join(', ')}${keys.length > 12 ? ', …' : ''})` : '');
        }
        const pick = {};
        for (const k of ['name', 'productName', 'version', 'description', 'main', 'type', 'license', 'engines']) if (j[k] != null) pick[k] = j[k];
        for (const k of ['scripts', 'dependencies', 'devDependencies', 'build']) if (j[k] && typeof j[k] === 'object') pick[k] = Object.keys(j[k]).map(x => x + (typeof j[k][x] === 'string' && k !== 'scripts' ? '@' + j[k][x] : '')).join(', ');
        return JSON.stringify(pick, null, 1).slice(0, 2400);
      }
    }
    const lines = s.split('\n');
    return lines.slice(0, maxLines).join('\n') + (lines.length > maxLines ? `\n(+${lines.length - maxLines} lines)` : '');
  }
  // Zip / folder: file list (path, size, tokens), then full files that fit — text/code first, smallest first.
  // manifest / CHANGELOG get a short digest. Nothing is summarized by an LLM here.
  function zipPlan(files, cap, opts) {
    opts = opts || {}; const fmt = opts.fmt || (b => b + ' B');
    const rows = files.map(f => ({ name: f.name, size: f.size || 0, kind: f.kind || '', tokens: f.tokens != null ? f.tokens : estimate(f.text || '', f.kind), text: f.text || '', bad: !!f.bad, error: f.error || '' }));
    const listLine = r => `- ${r.name} · ${fmt(r.size)} · ${r.bad ? '⚠ ' + (r.error || '') : (r.tokens + ' tok')}`;
    const manifest = rows.map(listLine).join('\n');
    let left = Math.max(0, cap - estimate(manifest, 'code') - 32);
    const cands = rows.filter(r => !r.bad && r.text);
    const rank = r => (TEXT_KINDS.has(r.kind) ? 0 : 1);
    cands.sort((a, b) => rank(a) - rank(b) || a.tokens - b.tokens || a.name.localeCompare(b.name));
    const included = [], digested = [], listed = [];
    const parts = [];
    for (const r of cands) {
      if (isMetaFile(r.name)) {
        const d = metaDigest(r.name, r.text); const dt = estimate(d, 'code');
        if (r.tokens <= Math.min(left, 400)) { parts.push({ r, body: r.text, how: 'full' }); left -= r.tokens; included.push(r.name); continue; }
        if (dt <= left) { parts.push({ r, body: d, how: 'digest' }); left -= dt; digested.push(r.name); continue; }
        listed.push(r.name); continue;
      }
      if (r.tokens <= left) { parts.push({ r, body: r.text, how: 'full' }); left -= r.tokens; included.push(r.name); }
      else listed.push(r.name);
    }
    return { rows, manifest, parts, included, digested, listed, used: cap - left };
  }
  // Shrink attachment bodies inside built messages until the prompt fits. blocks: [{ body, tokens }]
  function shrinkBlocks(messages, blocks, overTokens, note) {
    let need = Math.ceil(overTokens * 1.08) + 16; let changed = false;
    const order = blocks.filter(b => b.tokens > 0).sort((a, b) => b.tokens - a.tokens);
    for (const b of order) {
      if (need <= 0) break;
      const cut = Math.min(b.tokens, need);
      const want = b.tokens - cut;
      const nb = sliceToTokens(b.body, want, b.tokens) + (note ? note(want, b.total || b.tokens) : '');
      for (const m of messages) {
        if (m && typeof m.content === 'string' && m.content.includes(b.body)) { m.content = m.content.replace(b.body, () => nb); changed = true; break; }
      }
      b.body = nb; need -= cut; b.tokens = want;
    }
    return { changed, remaining: Math.max(0, need) };
  }
  // Pause / resume for the background stage. A paused job awaits wait() before its next model call.
  function Pauser() {
    let paused = false, waiters = [];
    return {
      get paused() { return paused; },
      pause() { paused = true; },
      resume() { paused = false; const w = waiters; waiters = []; w.forEach(f => f()); },
      wait() { return paused ? new Promise(r => waiters.push(r)) : Promise.resolve(); },
    };
  }
  const api = { estimate, estimateMessages, charsPerToken, greekShare, isCodeLike, allocate, sliceToTokens, isMetaFile, metaDigest, zipPlan, shrinkBlocks, Pauser, PER_TOKEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NyxTok = api;
})(typeof window !== 'undefined' ? window : globalThis);
