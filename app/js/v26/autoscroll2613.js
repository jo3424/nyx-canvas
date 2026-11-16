// v2.6.13 — auto-scroll of the tab bar while a tab is dragged (pointer-events drag of 2.6.12.2).
// Pure helpers (unit-tested in tests/v2613-unit.js); TabDrag drives them with requestAnimationFrame.
//  - speed(x, y, bar, opts): tabs / second. Negative = towards the start (left edge), positive = towards the end (right edge).
//    The edge zone is EDGE px wide; the closer the pointer is to the edge, the faster: from VMIN at the inner border of the
//    zone to VMAX at the edge (linear). Left: also up to EDGE px OUTSIDE the bar (the pointer can overshoot the edge).
//    Right: only INSIDE the bar — just past it sits «+N ▾», whose own hover (open the menu) must keep working.
//    Vertically: the bar's height ± VPAD px; elsewhere 0 (TabDrag also ignores the pointer over the open menu / a drawer). Scrolling starts after DWELL ms in the zone.
//  - step(acc, v, dt): integrates the speed over dt ms; returns whole tabs to move now and the remainder.
(function (root) {
  const EDGE = 40, VMIN = 1.5, VMAX = 12, VPAD = 12, DWELL = 250; // DWELL ms in the zone before it starts (a quick drop on the first / last tab never scrolls)
  function speed(x, y, bar, opts) {
    const o = opts || {}; const e = o.edge || EDGE; const vmin = o.vmin != null ? o.vmin : VMIN; const vmax = o.vmax || VMAX; const pad = o.vpad != null ? o.vpad : VPAD;
    if (!bar || !(bar.right > bar.left) || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
    if (y < bar.top - pad || y > bar.bottom + pad) return 0;
    const dl = x - bar.left, dr = bar.right - x;
    const near = (d) => vmin + (vmax - vmin) * (1 - Math.min(e, Math.max(0, d)) / e);
    const inL = dl < e && dl >= -e, inR = dr < e && dr >= 0;
    if (inL && inR) return dl <= dr ? -near(dl) : near(dr); // a very narrow bar: the nearer edge wins
    if (inL) return -near(dl);
    if (inR) return near(dr);
    return 0;
  }
  function step(acc, v, dt) {
    const a = (+acc || 0) + (+v || 0) * Math.max(0, Math.min(100, +dt || 0)) / 1000; // dt capped: a stalled frame never jumps far
    const n = a > 0 ? Math.floor(a) : Math.ceil(a);
    return { n, acc: a - n };
  }
  const api = { EDGE, VMIN, VMAX, VPAD, DWELL, speed, step };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NyxAutoScroll = api;
})(typeof window !== 'undefined' ? window : null);
