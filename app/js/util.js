'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const debounce = (fn, ms) => { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const API = window.nyxAPI || null;

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv; } }
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) { if (typeof k === 'string' && __svgOut.has(k)) e.insertAdjacentHTML('beforeend', k); else e.append(k.nodeType ? k : document.createTextNode(k)); }
  return e;
}
const ICON_ALIAS = { 'music': 'eighth-notes', 'bold': 'type-outline', 'align-left': 'text-align-start', 'align-center': 'text-align-center', 'align-right': 'text-align-end', 'plus-square': 'square-plus', 'box-select': 'square-dashed', 'trash-2': 'trash', 'history': 'clock-arrow-up', 'github': 'git-branch', 'file-json': 'file-braces', 'smile-plus': 'face-slightly-smiling-plus', 'smile': 'face-slightly-smiling', 'frown': 'face-slightly-frowning', 'meh': 'face-neutral', 'angry': 'face-angry', 'laugh': 'face-grinning', 'edit': 'square-pen', 'edit-2': 'pencil', 'more-horizontal': 'ellipsis', 'more-vertical': 'ellipsis-vertical', 'help-circle': 'circle-question-mark', 'circle-help': 'circle-question-mark', 'alert-triangle': 'triangle-alert', 'check-circle': 'circle-check', 'x-circle': 'circle-x', 'play-circle': 'circle-play', 'stop-circle': 'circle-stop' };
const __svgOut = new Set(); // exact strings produced by iconSvg → h() renders them as markup (never arbitrary text)
function iconSvg(name, size = 18, extra = '') {
  const L = (window.NYX_DATA && NYX_DATA.lucide) || {};
  let d = L[name] || L[ICON_ALIAS[name]];
  if (!d) { (window.__missingIcons ||= new Set()).add(name); d = L['circle']; }
  const out = `<svg class="ico ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="var(--icon-sw,1.75)" stroke-linecap="round" stroke-linejoin="round">${d ? d[0] : ''}</svg>`;
  if (__svgOut.size < 5000) __svgOut.add(out);
  return out;
}
function icon(name, size) { const s = document.createElement('span'); s.className = 'i'; s.innerHTML = iconSvg(name, size); return s; }
function hydrateIcons(root = document) { for (const e of root.querySelectorAll('i[data-i]')) { e.outerHTML = `<span class="i">${iconSvg(e.dataset.i, +e.dataset.s || 18)}</span>`; } }
function hydrateText(root = document) {
  for (const e of root.querySelectorAll('[data-t]')) e.textContent = t(e.dataset.t);
  for (const e of root.querySelectorAll('[data-tip]')) e.setAttribute('aria-label', t(e.dataset.tip));
}

// sanitize rich text (keep basic formatting)
const ALLOWED = new Set(['B', 'I', 'U', 'S', 'STRONG', 'EM', 'BR', 'DIV', 'P', 'SPAN', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'A', 'FONT', 'STRIKE', 'BLOCKQUOTE', 'CODE', 'PRE', 'MARK']);
function sanitize(html) {
  const tpl = document.createElement('template'); tpl.innerHTML = html || '';
  const walk = (n) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 1) {
        if (!ALLOWED.has(c.tagName)) { if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(c.tagName)) c.remove(); else { walk(c); c.replaceWith(...c.childNodes); } continue; }
        for (const a of [...c.attributes]) { const k = a.name.toLowerCase(); if (!['style', 'href', 'color', 'face', 'size'].includes(k) || (k === 'href' && !/^https?:|^mailto:/i.test(a.value))) c.removeAttribute(a.name); }
        walk(c);
      } else if (c.nodeType !== 3) c.remove();
    }
  };
  walk(tpl.content); return tpl.innerHTML;
}
const plainText = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return (d.innerText || d.textContent || '').trim(); };

// time helpers
const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(d) { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtDate(d, withTime = true) { d = parseDay(d); if (isNaN(d)) return '—'; return d.toLocaleString(LANG === 'el' ? 'el-GR' : 'en-GB', withTime ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
// v2.3: day-first numeric dates everywhere (30/11 · 30/11/2026), independent of the OS locale
function ymd(d) { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDay(s) { if (s instanceof Date) return s; s = String(s || ''); const m = s.match(/^(\d{4})-(\d\d)-(\d\d)$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s); }
function fmtDM(d, year) { d = parseDay(d); if (isNaN(d)) return '—'; const y = year === true || (year !== false && d.getFullYear() !== new Date().getFullYear()); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` + (y ? '/' + d.getFullYear() : ''); }
function fmtDay(d) { d = parseDay(d); if (isNaN(d)) return '—'; return d.toLocaleDateString(LANG === 'el' ? 'el-GR' : 'en-GB', { weekday: 'short' }) + ' ' + fmtDM(d); }
function fmtCountdown(ms) {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
  const L = LANG === 'el' ? [t('util.001'), t('util.002'), t('util.003'), t('util.004')] : ['d', 'h', 'm', 's'];
  return { d, hh, mm, ss, text: d > 0 ? `${d}${L[0]} ${hh}${L[1]} ${mm}${L[2]}` : `${hh}${L[1]} ${mm}${L[2]} ${ss}${L[3]}` };
}
function relDays(dateStr) {
  const a = new Date(new Date().toDateString()), b = new Date(new Date(dateStr + (dateStr.length <= 10 ? 'T00:00:00' : '')).toDateString());
  const n = Math.round((b - a) / 864e5);
  return n === 0 ? t('today') : n === 1 ? t('tomorrow') : n === -1 ? t('v23.yesterday') : n < 0 ? t('v23.days_ago', { n: -n }) : t('days_left', { n });
}
// v2.5.1: the app window never loads remote http(s) itself — remote pictures go through main ("nyx-img:" scheme, images only)
function rimg(u) { u = String(u || ''); return /^https?:\/\//i.test(u) ? 'nyx-img://r/?u=' + encodeURIComponent(u) : u; }
const favicon = (url) => rimg('https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostOf(url)) + '&sz=32');
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }

// toasts & tips
// v2.2: never show raw Electron IPC prefixes / "Error:" noise to the user
function cleanErr(e) { return String(e?.message ?? e ?? '').replace(/Error invoking remote method '[^']*':\s*/g, '').replace(/^(?:[A-Z][A-Za-z]*Error|Error):\s*/, '').trim(); }
// v2.3: toasts always leave — auto-dismiss (errors stay longer), × button, click-to-dismiss, hover pauses,
// visibility-safe (a toast shown while the window was hidden/minimised still counts down once it is visible).
const TOAST_MS = { def: 3200, err: 9000, alarm: 15000 };
function toast(msg, opts = {}) {
  msg = String(msg ?? '').replace(/Error invoking remote method '[^']*':\s*(?:[A-Z][A-Za-z]*Error:\s*)?/g, '');
  const kind = opts.kind || (/^\s*(⚠️|✗)/.test(msg) ? 'err' : '');
  const box = $('#toasts'); if (!box) return null;
  const el = h('div', { class: 'toast ' + kind, role: kind === 'err' ? 'alert' : 'status' }, opts.icon ? icon(opts.icon, 16) : null, h('span', { class: 'tmsg' }, msg));
  let left = Math.max(1200, +opts.ms || TOAST_MS[kind] || TOAST_MS.def), last = Date.now(), paused = false, gone = false;
  const close = () => { if (gone) return; gone = true; clearInterval(iv); el.classList.remove('in'); el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  if (opts.action) el.append(h('button', { class: 'tact', onclick: (e) => { e.stopPropagation(); try { opts.action.fn(); } finally { close(); } } }, opts.action.label));
  el.append(h('button', { class: 'tx', 'aria-label': t('close'), title: t('close'), html: iconSvg('x', 14), onclick: (e) => { e.stopPropagation(); close(); } }));
  el.addEventListener('click', (e) => { if (!e.target.closest('button,a')) close(); });
  el.addEventListener('pointerenter', () => { paused = true; }); el.addEventListener('pointerleave', () => { paused = false; last = Date.now(); });
  const iv = setInterval(() => { const now = Date.now(); if (!paused && !document.hidden) left -= now - last; last = now; if (left <= 0) close(); }, 250);
  el._close = close; box.append(el);
  while (box.children.length > 4) { const f = box.firstElementChild; f._close ? f._close() : f.remove(); if (box.children.length > 4 && f.parentNode) f.remove(); }
  requestAnimationFrame(() => el.classList.add('in'));
  return close;
}
function dismissToasts() { for (const e of [...($('#toasts')?.children || [])]) e._close ? e._close() : e.remove(); }
(function tooltips() {
  let tm;
  document.addEventListener('pointerover', (e) => {
    const tgt = e.target.closest('[data-tip]'); const tip = document.getElementById('tip'); if (!tip) return;
    clearTimeout(tm);
    if (!tgt) { tip.hidden = true; return; }
    tm = setTimeout(() => {
      tip.textContent = (tgt.dataset.tipPre ? t(tgt.dataset.tipPre) + ': ' : '') + t(tgt.dataset.tip); // v2.6.12: optional prefix (paper kinds)
      // v2.6.11: flyout items 1–9 show their key only here, in the tooltip (data-fk)
      if (tgt.dataset.fk) { const k = document.createElement('kbd'); k.className = 'tip-key'; k.textContent = tgt.dataset.fk; tip.append(' ', k); }
      tip.hidden = false;
      const r = tgt.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let x = r.left + r.width / 2 - tr.width / 2, y = r.bottom + 8;
      if (tgt.closest('.dock')) { x = r.right + 10; y = r.top + r.height / 2 - tr.height / 2; }
      else if (tgt.closest('.flyout')) { const fr = tgt.closest('.flyout').getBoundingClientRect(); x = fr.right + 8; y = r.top + r.height / 2 - tr.height / 2; if (x + tr.width > innerWidth - 4) x = fr.left - tr.width - 8; }
      if (y + tr.height > innerHeight - 4) y = r.top - tr.height - 8;
      tip.style.left = clamp(x, 4, innerWidth - tr.width - 4) + 'px'; tip.style.top = y + 'px';
    }, 380);
  });
  // v2.3: a tooltip must never get stuck (pointer left the window, element removed, key press, blur, scroll)
  const hide = () => { clearTimeout(tm); const tip = document.getElementById('tip'); if (tip) tip.hidden = true; };
  document.addEventListener('pointerdown', hide); document.addEventListener('keydown', hide, true); document.addEventListener('wheel', hide, { passive: true, capture: true });
  document.documentElement.addEventListener('pointerleave', hide); addEventListener('blur', hide);
  setInterval(() => { const tip = document.getElementById('tip'); if (tip && !tip.hidden && !document.querySelector('[data-tip]:hover')) tip.hidden = true; }, 1500);
})();

// Sounds
const SOUNDS = { chime: t('util.005'), crystal: t('util.006'), soft: t('util.007'), alarm: t('util.008'), pop: t('util.009'), space: t('util.010') };
function soundSrc(name) {
  if (name && name.startsWith('custom:')) return (window.MEDIA_BASE || '') + name.slice(7);
  return 'assets/sounds/' + (SOUNDS[name] ? name : 'chime') + '.wav';
}
function playSound(name, vol = 0.9) { if (name === 'none') return; try { const a = new Audio(soundSrc(name)); a.volume = vol; a.play().catch(() => {}); } catch (e) {} }

// lazy scripts
const _loaded = {};
function loadScript(src) { return _loaded[src] ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); }); }

// CSP-safe replacement for inline onerror="" on images: <img data-err="remove|parent|hide">
document.addEventListener('error', (e) => { const t = e.target; if (!t || t.tagName !== 'IMG' || !t.dataset?.err) return; const m = t.dataset.err; if (m === 'remove') t.remove(); else if (m === 'parent') t.parentNode?.remove(); else t.style.visibility = 'hidden'; }, true);

// Lazy script loader (v2.1): panels that are not needed at startup are fetched on first use.
const _lazy = {};
function loadScript(src) { return _lazy[src] ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete _lazy[src]; rej(new Error('load ' + src)); }; document.head.append(s); }); }
