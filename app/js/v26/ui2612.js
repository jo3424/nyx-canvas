// v2.6.12 — pure helpers (no DOM), unit-tested in tests/v2612-unit.js; the renderer gets them on window.NyxUI.
//  - hsvToHex / hexToHsv: the in-flyout palette (saturation/value square + hue slider) that stays open
//  - libGridMove:         keyboard navigation in the Library grid (arrows / Home / End / PageUp / PageDown)
//  - libShortcut:         «/» focuses the Library search, Enter inserts — never while typing in another field
//  - redactLog:           the router log shown in the Hub, with secrets removed (Authorization, keys, tokens)
//  - modelChips:          quant / GB / ctx / t/s / VRAM / port / vision chips from real data, «—» when unknown
(function (root) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // h 0–360, s 0–1, v 0–1 → '#RRGGBB'
  function hsvToHex(h, s, v) {
    h = ((Number(h) % 360) + 360) % 360; s = clamp(Number(s) || 0, 0, 1); v = clamp(Number(v) || 0, 0, 1);
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  // '#RRGGBB' (or #RGB) → { h, s, v }; null for anything else
  function hexToHsv(hex) {
    let m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) { const m3 = /^#([0-9a-f]{3})$/i.exec(String(hex || '').trim()); if (!m3) return null; m = [0, m3[1].split('').map((c) => c + c).join('')]; }
    const n = parseInt(m[1], 16); const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return { h: Math.round(h * 10) / 10, s: mx ? d / mx : 0, v: mx };
  }

  // ---------------- Library ----------------
  // i: current index (-1 = none), n: items, cols: columns; key: KeyboardEvent.key → new index (or i if not a nav key)
  function libGridMove(i, n, cols, key, page) {
    if (n <= 0) return -1; cols = Math.max(1, cols | 0); page = Math.max(1, page | 0 || cols * 4);
    if (i < 0 || i >= n) return ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(key) ? (key === 'End' ? n - 1 : 0) : i;
    switch (key) {
      case 'ArrowRight': return Math.min(n - 1, i + 1);
      case 'ArrowLeft': return Math.max(0, i - 1);
      case 'ArrowDown': return i + cols < n ? i + cols : i;
      case 'ArrowUp': return i - cols >= 0 ? i - cols : i;
      case 'Home': return 0;
      case 'End': return n - 1;
      case 'PageDown': return Math.min(n - 1, i + page);
      case 'PageUp': return Math.max(0, i - page);
      default: return i;
    }
  }
  // e: {key, ctrlKey, altKey, metaKey, typingElsewhere, inSearch, drawerOpen}
  // → 'focus-search' | 'insert' | 'nav' | null. «/» only when nobody types in another field; Enter/arrows only in the drawer.
  function libShortcut(e) {
    if (!e || !e.drawerOpen || e.ctrlKey || e.altKey || e.metaKey) return null;
    if (e.typingElsewhere) return null;
    if (e.key === '/' && !e.inSearch) return 'focus-search';
    if (e.key === 'Enter') return 'insert';
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'PageDown', 'PageUp'].includes(e.key)) return 'nav';
    if ((e.key === 'Home' || e.key === 'End') && !e.inSearch) return 'nav';
    return null;
  }

  // ---------------- Hub ----------------
  const RED = '[redacted]'; // the Hub passes the translated mark (v2612.redacted)
  // removes secrets from router log lines: Authorization headers, Bearer tokens, --api-key values, key=/token= params,
  // sk-… / hf_… / ghp_… style tokens, long hex/base64 blobs after «key»/«token»/«secret»/«password»
  function redactLog(text, mark) {
    const R = mark || RED;
    return String(text == null ? '' : text).split(/\r?\n/).map((ln) => ln
      .replace(/(authorization\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:bearer|basic|token)\s+\S+|\S+)/ig, '$1' + R)
      .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+\/=-]{6,}/ig, '$1 ' + R)
      .replace(/(--api-key(?:-file)?(?:\s+|=))("[^"]*"|'[^']*'|\S+)/ig, '$1' + R)
      .replace(/(\b(?:x-api-key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|pwd)\b["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,;"']+)/ig, '$1' + R)
      .replace(/([?&](?:key|api_key|apikey|token|access_token|auth|sig|signature)=)[^&\s]+/ig, '$1' + R)
      .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g, R)
      .replace(/\b(?:hf|ghp|gho|ghs|ghu|github_pat|xox[abpr])_[A-Za-z0-9_]{8,}\b/g, R)
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, R)
    ).join('\n');
  }
  const DASH = '—';
  const nf1 = (n, lang) => Number(n).toLocaleString(lang === 'en' ? 'en-GB' : 'el-GR', { maximumFractionDigits: 1, minimumFractionDigits: n < 100 && n % 1 ? 1 : 0 });
  // quant from a GGUF name: Q4_K_XL, Q8_0, IQ3_XXS, F16, BF16, MXFP4 …
  function quantOf(name) {
    const m = /(?:^|[-_.])((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4))(?=$|[-_.])/i.exec(String(name || '').replace(/\.gguf$/i, ''));
    return m ? m[1].replace(/^UD-/i, '').toUpperCase() : null;
  }
  // m: { id, bytes, ctx, tps, vramGB, port, mmproj, loaded }; every value that is not known → «—» (never invented)
  function modelChips(m, lang) {
    const o = m || {}; const q = quantOf(o.id);
    const gb = o.bytes > 0 ? nf1(o.bytes / 1e9, lang) + ' GB' : null;
    const ctx = o.ctx > 0 ? 'ctx ' + (o.ctx >= 1024 ? Math.round(o.ctx / 1024) + 'K' : String(o.ctx)) : null;
    const tps = o.tps > 0 ? nf1(o.tps, lang) + ' t/s' : null;
    const vram = o.vramGB > 0 ? 'VRAM ' + nf1(o.vramGB, lang) : null;
    const port = o.port ? ':' + o.port : null;
    const chips = [
      { k: 'quant', v: o.mmproj ? 'mmproj' : (q || DASH), known: !!(o.mmproj || q) },
      { k: 'gb', v: gb || DASH, known: !!gb },
      { k: 'ctx', v: o.mmproj ? null : (ctx || 'ctx ' + DASH), known: !!ctx },
      { k: 'tps', v: o.mmproj ? null : (tps || 't/s ' + DASH), known: !!tps },
      { k: 'vram', v: o.mmproj ? null : (vram || 'VRAM ' + DASH), known: !!vram },
    ].filter((c) => c.v != null);
    if (port && o.loaded) chips.push({ k: 'port', v: port, known: true });
    return chips;
  }
  const api = { hsvToHex, hexToHsv, libGridMove, libShortcut, redactLog, quantOf, modelChips, REDACTED: RED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NyxUI = Object.assign(root.NyxUI || {}, api);
})(typeof window !== 'undefined' ? window : null);
