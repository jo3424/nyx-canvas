'use strict';
// v2.6.11 — appearance only. Pure functions (no DOM) so they are unit-tested in node and used by the renderer:
//  - tabLayout:   board tabs shrink to a useful minimum, then «+N ▾» holds the rest; the active tab is always visible
//  - clampFlyout: a flyout touches its dock button and stays inside the window (flips / clamps at the edges)
//  - flyoutDigit: keys 1–9 (and 0 = 10th, since 2.6.11.1) pick an item only while a flyout is open, never while typing, never with Ctrl/Alt/Meta
//  - hubCounts:   «loaded / max · μέγιστο max · N στον φάκελο» from real router data (no fixed numbers)
//  - contrast:    WCAG 2.x contrast ratio; «Γυαλί» is offered only when every text colour reaches ≥ 4.5:1
//  - UI_STYLES:   the 6 optional panel styles (the default look stays the default)
// The renderer uses window.NyxUI; the unit tests require() this file.
(function (root) {
  // ---------------- tabs ----------------
  const TAB_MIN = 96;   // px: emoji + ~6 letters + close — still readable and clickable
  const TAB_MAX = 200;  // px: same max-width as before 2.6.11
  const TAB_GAP = 4;
  const MORE_W = 58;    // px: «+N ▾» button
  // fill widths up to a common cap so that sum(min(w_i, cap)) + gaps <= avail (largest cap); returns the cap
  function capFor(widths, avail, gap) {
    const n = widths.length; if (!n) return Infinity;
    const room = avail - gap * (n - 1);
    const s = widths.slice().sort((a, b) => a - b);
    let used = 0;
    for (let i = 0; i < n; i++) {
      const left = n - i; const cap = (room - used) / left;
      if (s[i] >= cap) return Math.floor(cap);
      used += s[i];
    }
    return Infinity; // everything fits at its natural width
  }
  // widths: natural width of each tab (px); active: index of the active tab; start: first tab of the visible window
  // (changed by the mouse wheel). Returns { mode, visible:[idx], hidden:[idx], width:{idx:px}, start, maxStart, k }.
  function tabLayout(o) {
    const n = (o.widths || []).length; const minW = o.minW || TAB_MIN; const maxW = o.maxW || TAB_MAX; const gap = o.gap != null ? o.gap : TAB_GAP; const moreW = o.moreW || MORE_W;
    const avail = Math.max(0, Math.floor(o.avail || 0));
    const nat = (o.widths || []).map((w) => Math.min(maxW, Math.max(minW, Math.ceil(w || 0))));
    const active = Math.min(Math.max(0, o.active | 0), Math.max(0, n - 1));
    const out = { mode: 'fit', visible: [], hidden: [], width: {}, start: 0, maxStart: 0, k: n };
    if (!n) return out;
    let cap = capFor(nat, avail, gap);
    if (cap >= minW) { // A: everything fits, shrinking down to (not below) the minimum
      out.mode = cap === Infinity ? 'fit' : 'shrink';
      for (let i = 0; i < n; i++) { out.visible.push(i); out.width[i] = Math.min(nat[i], cap); }
      return out;
    }
    // B: k tabs at ≥ minW plus «+N ▾»
    const k = Math.max(1, Math.min(n - 1, Math.floor((avail - moreW - gap + gap) / (minW + gap))));
    const maxStart = n - k;
    // v2.6.11.1: anchor 'end' (the app's default) → the window sits at the END (the last tabs, where «+» adds new boards);
    // the active tab is pinned into it when it is further left, and the FIRST tabs go into «+N ▾». Without anchor: 2.6.11 behaviour.
    const endAnchor = o.anchor === 'end' && o.start == null;
    let start = Math.min(Math.max(0, o.start == null ? (endAnchor ? maxStart : active - Math.floor(k / 2)) : o.start | 0), maxStart);
    if (!endAnchor && (o.start == null || o.follow)) { if (active < start) start = active; if (active >= start + k) start = active - k + 1; }
    start = Math.min(Math.max(0, start), maxStart);
    let vis = []; for (let i = start; i < start + k; i++) vis.push(i);
    if (!vis.includes(active)) { if (active < start) vis[0] = active; else vis[k - 1] = active; vis.sort((a, b) => a - b); } // pinned
    out.mode = 'overflow'; out.k = k; out.start = start; out.maxStart = maxStart; out.visible = vis;
    out.hidden = []; for (let i = 0; i < n; i++) if (!vis.includes(i)) out.hidden.push(i);
    cap = capFor(vis.map((i) => nat[i]), avail - moreW - gap, gap);
    for (const i of vis) out.width[i] = Math.max(minW, Math.min(nat[i], cap));
    return out;
  }
  // wheel over the strip: one tab per notch, clamped
  function wheelStart(start, deltaY, deltaX, maxStart) {
    const d = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
    if (!d) return start;
    return Math.min(Math.max(0, start + (d > 0 ? 1 : -1)), Math.max(0, maxStart));
  }

  // ---------------- flyouts ----------------
  // btn / bounds: {left, top, right, bottom}; fly: {w, h}. The flyout's near edge sits exactly on the button's edge
  // (gap 0 = touching) on the right side; if there is no room it flips to the left side. Vertically it is centred on the
  // button, then clamped inside bounds; it always overlaps the button's height. Too tall → maxH and inner scroll.
  function clampFlyout(btn, fly, bounds, opts = {}) {
    const m = opts.margin != null ? opts.margin : 8; const gap = opts.gap || 0;
    const B = { left: bounds.left || 0, top: bounds.top || 0, right: bounds.right, bottom: bounds.bottom };
    const availH = Math.max(40, B.bottom - B.top - 2 * m);
    const h = Math.min(fly.h, availH); const w = Math.min(fly.w, Math.max(40, B.right - B.left - 2 * m));
    let side = 'right'; let left = btn.right + gap;
    if (left + w > B.right - m) { const l2 = btn.left - gap - w; if (l2 >= B.left + m) { side = 'left'; left = l2; } else left = B.right - m - w; }
    left = Math.max(B.left + m, left);
    const cy = (btn.top + btn.bottom) / 2;
    let top = Math.round(cy - h / 2);
    top = Math.min(Math.max(B.top + m, top), B.bottom - m - h);
    // keep at least part of the button's height covered (button near a window edge)
    if (top > btn.bottom - 4) top = Math.max(B.top + m, btn.bottom - 4 - Math.min(h, 24));
    if (top + h < btn.top + 4) top = Math.min(B.bottom - m - h, btn.top + 4);
    const touch = side === 'right' ? Math.abs(left - btn.right) <= gap : Math.abs(left + w - btn.left) <= gap;
    return { left: Math.round(left), top: Math.round(top), w, h, maxH: h < fly.h ? h : null, side, touch };
  }
  // e: {key, code, ctrlKey, altKey, metaKey, shiftKey, typing}; returns 0-based index or -1
  function flyoutDigit(e, open, count) {
    if (!open || !e || e.typing || e.ctrlKey || e.altKey || e.metaKey) return -1;
    let d = 0;
    const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
    if (m) d = +m[1]; else if (/^[0-9]$/.test(e.key || '')) d = +e.key;
    if ((m || /^[0-9]$/.test(e.key || '')) && d === 0) d = 10; // v2.6.11.1: «0» = 10th item (only flyouts that have one: note paper kinds)
    if (!d || e.shiftKey && !/^Numpad/.test(e.code || '')) return -1; // Shift+1 = «!» = fit to screen, untouched
    return d <= count ? d - 1 : -1;
  }
  // is the event target a text field / editable (input, textarea, select, contenteditable)?
  function isTyping(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !/^(button|checkbox|radio|range|color|submit|reset|image|file)$/i.test(el.type || 'text');
    return !!(el.closest && el.closest('[contenteditable=""],[contenteditable=true],[contenteditable=plaintext-only]'));
  }

  // ---------------- Hub ----------------
  // models: router /v1/models list (status.value / loaded); max: live --models-max (router /props) or the configured one
  function hubCounts(models, max, tr) {
    const list = Array.isArray(models) ? models : [];
    const st = (m) => (m && m.status && m.status.value) || (m && m.state) || (m && m.loaded === true ? 'loaded' : m && m.loaded === false ? 'unloaded' : '');
    const known = list.some((m) => m && (m.loaded === true || m.loaded === false || m.state || (m.status && m.status.value)));
    const isLoaded = (m) => !!m && (m.loaded === true || (m.loaded !== false && /^(loaded|ready|ok)$/i.test(st(m))));
    const loaded = known ? list.filter(isLoaded).length : null;
    const mx = max != null && Number.isFinite(+max) && +max >= 0 ? Math.floor(+max) : null;
    const folder = list.length;
    const T = tr || ((k, v) => k + (v ? ' ' + JSON.stringify(v) : ''));
    const parts = [];
    parts.push(loaded == null ? '—' : (mx != null ? loaded + ' / ' + mx : String(loaded)));
    if (mx != null) parts.push(T('v2611.hub_max', { v0: mx }));
    parts.push(T('v2611.hub_folder', { v0: folder }));
    return { loaded, max: mx, folder, line: parts.join(' · ') };
  }
  // per-model state for the cards: loaded / loading / on disk
  function modelState(m) {
    const v = (m && m.status && m.status.value) || (m && m.state) || '';
    if ((m && m.loaded === true) || /^(loaded|ready|ok)$/i.test(v)) return 'loaded';
    if (/^loading$/i.test(v)) return 'loading';
    return 'disk';
  }

  // ---------------- contrast ----------------
  function parseColor(s) {
    s = String(s || '').trim();
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
      let x = m[1]; if (x.length === 3 || x.length === 4) x = x.split('').map((c) => c + c).join('');
      const n = parseInt(x.slice(0, 6), 16); const a = x.length === 8 ? parseInt(x.slice(6), 16) / 255 : 1;
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; }
    return null;
  }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  function luminance(c) {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrast(a, b) {
    const A = typeof a === 'string' ? parseColor(a) : a, Bc = typeof b === 'string' ? parseColor(b) : b;
    const la = luminance(A), lb = luminance(Bc);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  const MIN_CONTRAST = 4.5;
  // Glass: the panel colour at GLASS_ALPHA over the worst backdrop that can be behind it (theme bg/bg2/card and pure
  // black and white, because cards, images and webpages can sit under a panel). Text and muted text both need ≥ 4.5:1.
  const GLASS_ALPHA = 0.82;
  const mix = (a, b, t) => ({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t), a: 1 });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function worstRatio(fg, pane, backs) { return Math.min(...backs.map((bk) => { const bg = over(pane, bk); return contrast(over(fg, bg), bg); })); }
  // the glass palette for a theme: panel at GLASS_ALPHA, the theme's text, and its muted text moved towards the text colour
  // just enough (steps of 10%) to reach 4.5:1 on the worst backdrop. Then everything is measured again (glassCheck).
  function glassVars(vars, alpha = GLASS_ALPHA) {
    const solid = parseColor(vars['panel-solid'] || '#121628') || { r: 18, g: 22, b: 40, a: 1 };
    const pane = { ...solid, a: alpha };
    const backs = [vars.bg, vars.bg2, vars.card, '#000000', '#ffffff'].map(parseColor).filter(Boolean).map((c) => over(c, { r: 0, g: 0, b: 0, a: 1 }));
    const text = parseColor(vars.text || '#ffffff') || { r: 255, g: 255, b: 255, a: 1 };
    const muted0 = parseColor(vars.muted || vars.text || '#ffffff') || text;
    let muted = { ...muted0, a: 1 };
    for (let t = 0; t <= 1.0001 && worstRatio(muted, pane, backs) < MIN_CONTRAST; t += 0.1) muted = mix(muted0, text, Math.min(1, t + 0.1));
    return { pane, backs, text: { ...text, a: 1 }, muted, panel: `rgba(${solid.r},${solid.g},${solid.b},${alpha})`, textHex: hex(text), mutedHex: hex(muted) };
  }
  function glassCheck(vars, alpha = GLASS_ALPHA) {
    const g = glassVars(vars || {}, alpha);
    const text = worstRatio(g.text, g.pane, g.backs), muted = worstRatio(g.muted, g.pane, g.backs);
    const min = Math.min(text, muted);
    return { ok: min >= MIN_CONTRAST, text, muted, min, alpha, need: MIN_CONTRAST, mutedHex: g.mutedHex, panel: g.panel };
  }
  // fixed palette check (the other 5 styles): text and muted on the opaque panel
  function paletteCheck(s) { const text = contrast(s.text, s.panel), muted = contrast(s.muted, s.panel); return { ok: Math.min(text, muted) >= MIN_CONTRAST, text, muted, min: Math.min(text, muted) }; }

  // ---------------- the 6 optional panel styles ----------------
  // Applied only to flyouts, the right drawer (Library, Hub, …) and the Hub cards. '' = the theme's own look (default).
  // Fixed palettes are checked by the unit test (text and muted ≥ 4.5:1 on their panel); «Γυαλί» is derived from the
  // active theme and offered only when glassCheck() passes.
  const UI_STYLES = [
    { id: 'glass', key: 'v2611.st_glass', glass: true },
    { id: 'neon', key: 'v2611.st_neon', panel: '#0b0612', text: '#fff0fb', muted: '#d6a6cc', border: 'rgba(255,46,160,.6)', accent: '#ff2ea0', glow: '0 0 0 1px rgba(255,46,160,.55),0 0 22px -6px #ff2ea0' },
    { id: 'terminal', key: 'v2611.st_terminal', panel: '#000a03', text: '#b8ffca', muted: '#6fd08a', border: 'rgba(51,255,102,.45)', accent: '#33ff66', font: "'JetBrains Mono',monospace", radius: '2px' },
    { id: 'paper', key: 'v2611.st_paper', panel: '#f6f1e6', text: '#1f1b16', muted: '#5a5246', border: 'rgba(60,45,20,.18)', accent: '#7a4b12', font: "'Noto Serif',serif" },
    { id: 'bold', key: 'v2611.st_bold', panel: '#17141f', text: '#ffffff', muted: '#c9c3dc', border: 'rgba(255,214,61,.45)', accent: '#ffd63d', radius: '18px' },
    { id: 'space', key: 'v2611.st_space', panel: '#0d0b24', text: '#eceaff', muted: '#aaa6d8', border: 'rgba(160,150,255,.28)', accent: '#9d8cff', glow: '0 0 30px -10px #7c6cff' },
  ];
  // CSS for the active style (scoped; nothing else in the app changes)
  const SCOPE = 'body[data-ui-style="{id}"] :is(#toolopts.flyout,#drawer)';
  function styleCss(id, themeVars) {
    const s = UI_STYLES.find((x) => x.id === id); if (!s) return '';
    const sel = SCOPE.replace('{id}', id);
    if (s.glass) {
      const g = glassCheck(themeVars || {}); if (!g.ok) return '';
      return `${sel}{--muted:${g.mutedHex};background:${g.panel}!important;backdrop-filter:blur(22px) saturate(1.35)!important;border-color:color-mix(in srgb,var(--text) 18%,transparent)!important}`;
    }
    return `${sel}{--panel:${s.panel};--panel-solid:${s.panel};--text:${s.text};--muted:${s.muted};--border:${s.border};--accent:${s.accent};color:${s.text};background:${s.panel}!important;backdrop-filter:none!important;border-color:${s.border}!important;${s.font ? 'font-family:' + s.font + ';' : ''}${s.radius ? 'border-radius:' + s.radius + ';' : ''}${s.glow ? 'box-shadow:' + s.glow + '!important;' : ''}}`;
  }

  // ---------------- v2.6.11.1: pen flyout (hex, eyedropper, opacity %, px, recent colours) ----------------
  const PEN_PX_MIN = 1, PEN_PX_MAX = 40, RECENT_MAX = 4;
  // '#abc' / '#aabbcc' / 'rgb(…)' / 'rgba(…)' → '#AABBCC'; null when invalid or fully transparent (EyeDropper on a blank capture)
  function toHex(v) {
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^#([0-9a-f]{3})$/i); // 3 digits only with «#» (a word like «bad» is not a colour)
    if (m) return ('#' + m[1].split('').map((c) => c + c).join('')).toUpperCase();
    m = s.match(/^#?([0-9a-f]{6})$/i); if (m) return ('#' + m[1]).toUpperCase();
    m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i); if (m) return parseInt(m[2], 16) === 0 ? null : ('#' + m[1]).toUpperCase();
    m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
    if (m) {
      if (m[4] != null) { const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); if (!(a > 0)) return null; }
      const c = [m[1], m[2], m[3]].map(Number); if (c.some((x) => x > 255)) return null;
      return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    return null;
  }
  // newest first, no duplicates (case-insensitive), at most `max`
  function pushRecent(list, color, max) {
    const c = toHex(color); const arr = Array.isArray(list) ? list.map(toHex).filter(Boolean) : [];
    if (!c) return arr.slice(0, max || RECENT_MAX);
    return [c, ...arr.filter((x) => x !== c)].slice(0, max || RECENT_MAX);
  }
  function clampInt(v, lo, hi, def) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; }
  // opacity % of each drawing tool; the highlighter keeps its 38 % default (as before 2.6.11.1)
  const INK_OPACITY_DEF = { pen: 100, marker: 100, highlighter: 38 };
  function inkOpacity(kind, pct) { const d = INK_OPACITY_DEF[kind] || 100; return clampInt(pct == null || pct === '' ? d : pct, 1, 100, d) / 100; }
  // colour of a card / stroke for the eyedropper fallback (click on the canvas) — read-only, nothing is changed
  function itemColor(it) {
    if (!it) return null;
    const pick = (...xs) => { for (const x of xs) { const c = toHex(x); if (c) return c; } return null; };
    switch (it.type) {
      case 'ink': return pick(it.color);
      case 'arrow': case 'line': return pick(it.stroke, '#7C8CFF');
      case 'shape': return pick(it.fill, it.stroke);
      case 'sticky': return pick(it.paper, it.color);
      case 'frame': return pick(it.color);
      default: return pick(it.color, it.fill, it.stroke, it.paper);
    }
  }

  const api = { PEN_PX_MIN, PEN_PX_MAX, RECENT_MAX, toHex, pushRecent, clampInt, INK_OPACITY_DEF, inkOpacity, itemColor, TAB_MIN, TAB_MAX, TAB_GAP, MORE_W, capFor, tabLayout, wheelStart, clampFlyout, flyoutDigit, isTyping, hubCounts, modelState, parseColor, over, luminance, contrast, MIN_CONTRAST, GLASS_ALPHA, glassVars, glassCheck, paletteCheck, UI_STYLES, styleCss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NyxUI = api;
})(typeof window !== 'undefined' ? window : globalThis);
