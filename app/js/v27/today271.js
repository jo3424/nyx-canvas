'use strict';
// v2.7.1 — «Σήμερα» widget, Variant C «Μίνιμαλ» (approved mockup 2.7.1-plan/v3). Pure: status in → HTML string out.
// No animation, no blur, no canvas, no timers here: the main process refreshes every 30′ (main/today271.js) and the
// existing 60 s widget repaint picks the cached values up (and the name day at midnight).
// Exported for the unit tests; in the renderer it is window.NyxToday271. Text comes through tr(key, vars) (locales).
(function (root) {
  const C = '<path d="M7.2 19h9.9a4.1 4.1 0 0 0 .5-8.17 5.6 5.6 0 0 0-10.6-1.5A4.85 4.85 0 0 0 7.2 19z"/>';
  // one static sprite (flat SVG symbols), added once to the page
  const SPRITE = `<svg class="t271-sprite" aria-hidden="true" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden">
<symbol id="t271-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.6" fill="#f5b83d"/><g stroke="#f5b83d" stroke-width="1.9" stroke-linecap="round"><path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.35 5.35l1.6 1.6M17.05 17.05l1.6 1.6M5.35 18.65l1.6-1.6M17.05 6.95l1.6-1.6"/></g></symbol>
<symbol id="t271-moon" viewBox="0 0 24 24"><path fill="#c9cef5" d="M15.6 3.4a8.6 8.6 0 1 0 5 11.9A7 7 0 0 1 15.6 3.4z"/></symbol>
<symbol id="t271-cloud" viewBox="0 0 24 24"><g fill="#aeb6d6">${C}</g></symbol>
<symbol id="t271-pcd" viewBox="0 0 24 24"><circle cx="8.6" cy="8.4" r="3.6" fill="#f5b83d"/><g stroke="#f5b83d" stroke-width="1.6" stroke-linecap="round"><path d="M8.6 1.9v1.5M2.1 8.4h1.5M4 3.8l1.1 1.1M13.2 3.8l-1.1 1.1M4 13l1.1-1.1"/></g><g fill="#c3c9e4" transform="translate(2.2 2.4) scale(.86)">${C}</g></symbol>
<symbol id="t271-pcn" viewBox="0 0 24 24"><path fill="#c9cef5" d="M10.4 2.6a6 6 0 1 0 2.9 9.6A5 5 0 0 1 10.4 2.6z"/><g fill="#aeb6d6" transform="translate(2.2 2.4) scale(.86)">${C}</g></symbol>
<symbol id="t271-rain" viewBox="0 0 24 24"><g fill="#9aa3c7" transform="translate(0 -3)">${C}</g><g stroke="#5aa9ff" stroke-width="1.9" stroke-linecap="round"><path d="M8.2 18.2l-1 2.6M12.2 18.2l-1 2.6M16.2 18.2l-1 2.6"/></g></symbol>
<symbol id="t271-storm" viewBox="0 0 24 24"><g fill="#8b93b8" transform="translate(0 -3)">${C}</g><path fill="#f5c542" d="M12.8 13.2 9.4 18.4h2.5l-1.2 4.2 3.9-5.6h-2.6l1.4-3.8z"/></symbol>
<symbol id="t271-fog" viewBox="0 0 24 24"><g fill="#9aa3c7" transform="translate(0 -4)">${C}</g><g stroke="#aeb6d6" stroke-width="1.8" stroke-linecap="round"><path d="M4.5 17.6h15M6.5 21h11"/></g></symbol>
<symbol id="t271-snow" viewBox="0 0 24 24"><g fill="#aeb6d6" transform="translate(0 -3)">${C}</g><g fill="#e6ecff"><circle cx="8" cy="19.4" r="1.3"/><circle cx="12" cy="21" r="1.3"/><circle cx="16" cy="19.4" r="1.3"/></g></symbol>
</svg>`;
  const SIZE = { s: { w: 380, h: 204 }, m: { w: 480, h: 186 }, l: { w: 600, h: 186 } };
  // accent: 'nyx' keeps the theme accent (default); the others are the mockup's swatches
  const ACC = { nyx: '', teal: '#2fbfb2', amber: '#e3a33b', rose: '#e0607a' };
  const STALE_MS = 60 * 60000, DROP_MS = 24 * 3600000;
  // WMO weather_code → [icon, locale key]; night variants by is_day
  function wmo(code, day) {
    const c = +code;
    if (c === 0) return day ? ['sun', 'v271.w_clear'] : ['moon', 'v271.w_clear_n'];
    if (c === 1) return [day ? 'pcd' : 'pcn', 'v271.w_mainly'];
    if (c === 2) return [day ? 'pcd' : 'pcn', 'v271.w_partly'];
    if (c === 3) return ['cloud', 'v271.w_overcast'];
    if (c === 45 || c === 48) return ['fog', 'v271.w_fog'];
    if (c >= 51 && c <= 55) return ['rain', 'v271.w_drizzle'];
    if (c === 56 || c === 57) return ['rain', 'v271.w_fdrizzle'];
    if (c === 61) return ['rain', 'v271.w_rain_l'];
    if (c === 63) return ['rain', 'v271.w_rain'];
    if (c === 65) return ['rain', 'v271.w_rain_h'];
    if (c === 66 || c === 67) return ['rain', 'v271.w_frain'];
    if (c >= 71 && c <= 77) return ['snow', 'v271.w_snow'];
    if (c >= 80 && c <= 82) return ['rain', 'v271.w_showers'];
    if (c === 85 || c === 86) return ['snow', 'v271.w_snow_sh'];
    if (c === 95) return ['storm', 'v271.w_storm'];
    if (c === 96 || c === 99) return ['storm', 'v271.w_storm_h'];
    return ['cloud', 'v271.w_unknown'];
  }
  const DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const dir8 = (deg) => DIRS[Math.round((((+deg % 360) + 360) % 360) / 45) % 8];
  const pad = (n) => String(n).padStart(2, '0');
  const hourKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`; };
  const hm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 8 boxes every 3 hours from the current hour: first hour's icon + temperature, the highest rain % of the three
  function strip(hours, now) {
    const k0 = hourKey(now); const hs = (hours || []).filter((x) => x.time >= k0); const out = [];
    for (let k = 0; k < hs.length && out.length < 8; k += 3) {
      const w = hs.slice(k, k + 3); const f = w[0];
      out.push({ time: f.time, label: f.time.slice(11, 16), now: f.time === k0, code: f.code, day: f.day, t: Math.round(f.t), pop: Math.max(...w.map((x) => x.pop || 0)) });
    }
    return out;
  }
  // status (from main) → what to show. online: navigator.onLine.
  function view(st, now, online) {
    st = st || {}; const has = !!(st.ok && st.data && st.data.cur); const age = has ? now - st.fetchedAt : Infinity;
    const cells = has ? strip(st.data.hours, now) : [];
    const down = !has || age > DROP_MS || !cells.length;
    const offline = online === false || st.lastErr === 'net';
    return { down, offline, stale: !down && age > STALE_MS, cells, cur: has ? st.data.cur : null, fetchedAt: st.fetchedAt || 0,
      retryMin: st.nextAt ? Math.max(1, Math.ceil((st.nextAt - now) / 60000)) : 10, names: st.names || '' };
  }
  const ic = (n, cls) => `<svg class="t271-i${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#t271-${n}"/></svg>`;
  // header pieces (icon + inline current + «Χωρίς σύνδεση») and body, for one widget
  function parts(st, o, tr) {
    const V = view(st, o.now, o.online);
    let ico = ic('cloud'), inl = '';
    if (!V.down) {
      const c = V.cur; const [i, k] = wmo(c.code, c.day); ico = ic(i);
      inl = `<span class="t271-inl${V.stale ? ' t271-dim' : ''}" data-t271-cur="1"><b>${Math.round(c.t)}°</b> ${esc(tr(k))} <span class="t271-mu">· ${esc(tr('v271.wind', { v0: Math.round(c.ws), v1: tr('v271.d_' + dir8(c.wd)) }))}</span></span>`;
    }
    const off = V.offline && !V.down ? `<span class="t271-off" data-t271-off="1">${esc(tr('v271.offline'))}</span>` : '';
    const pop = (p) => p >= 10 ? `<span class="t271-pop">${p}%</span>` : '<span class="t271-pop t271-z"></span>';
    const cells = V.cells.map((x) => { const [i, k] = wmo(x.code, x.day); return `<div class="t271-c${x.now ? ' t271-cur' : ''}" data-t271-cell="${esc(x.time)}" title="${esc(x.label + ' · ' + tr(k))}"><span class="t271-hl">${x.now ? esc(tr('v271.now')) : esc(x.label)}</span>${ic(i)}<b>${x.t}°</b>${pop(x.pop)}</div>`; }).join('');
    const nd = `<span class="t271-nd" data-t271-names="${V.names ? 1 : 0}"><span class="t271-ndl">${esc(tr('v271.nameday'))}</span>${V.names ? `<b>${esc(V.names)}</b>` : `<span class="t271-none">${esc(tr('v271.no_names'))}</span>`}</span>`;
    const fresh = V.stale ? `<span class="t271-old" data-t271-stale="1">${esc(tr('v271.stale', { v0: hm(V.fetchedAt) }))}</span>` : `<span data-t271-fresh="1">${esc(tr('v271.updated', { v0: hm(V.fetchedAt) }))}</span>`;
    // CC BY attribution as text (no link: no new URLs besides the one weather API)
    const om = '<span class="t271-om">Weather data by Open-Meteo.com</span>';
    const dot = '<span class="t271-dot">·</span>';
    const downBox = `<div class="t271-down" data-t271-down="1"><div><b>${esc(tr('v271.down'))}</b><span>${esc(tr(V.offline ? 'v271.down_off' : 'v271.down_srv', { n: V.retryMin }))}</span></div><button type="button" class="t271-btn act live" data-act="w-retry">${esc(tr('v270.retry'))}</button></div>`;
    const body = (V.down ? downBox : `<div class="t271-wx${V.stale ? ' t271-dim' : ''}"><div class="t271-strip">${cells}</div></div>`)
      + `<div class="t271-ft">${nd}${dot}${V.down ? '' : fresh + dot}${om}</div>`;
    return { V, ico, inl, off, body, state: V.down ? 'down' : V.stale ? 'stale' : 'ok' };
  }
  const api = { SPRITE, SIZE, ACC, STALE_MS, wmo, dir8, strip, view, parts, hourKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NyxToday271 = api;
})(typeof window !== 'undefined' ? window : globalThis);
