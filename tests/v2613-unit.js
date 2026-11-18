'use strict';
// v2.6.13 unit — since 2.6.13.1 only the part that stays: (ε) the tab-bar auto-scroll while dragging.
// (The 2.6.13 voice tests (α)–(δ) were removed with the voice; tests/v26131-unit.js checks that it is gone.)
const fs = require('fs'), path = require('path');
const R = process.env.NYX_ROOT || path.join(__dirname, '..');
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const read = (f) => { try { return fs.readFileSync(path.join(R, f), 'utf8'); } catch (_) { return ''; } };

(async () => {
  // ---- (ε) tab-bar auto-scroll while dragging ----
  { const AS = require(path.join(R, 'app/js/v26/autoscroll2613.js')); const bar = { left: 100, right: 900, top: 10, bottom: 46 }; const y = 28;
    ok(AS.speed(500, y, bar) === 0, '(ε) pointer in the middle of the bar → no scroll');
    const l = [39, 30, 20, 5, 0, -30].map((d) => AS.speed(100 + d, y, bar)); const r = [39, 30, 20, 5, 1].map((d) => AS.speed(900 - d, y, bar));
    ok(l.every((v) => v < 0) && r.every((v) => v > 0), '(ε) left edge → towards the start (−), right edge → towards the end (+)', { l, r });
    ok(l.slice(0, 5).every((v, k) => k === 0 || Math.abs(v) > Math.abs(l[k - 1])) && r.every((v, k) => k === 0 || v > r[k - 1]), '(ε) speed grows as the pointer gets closer to the edge (proportional)', { l, r });
    ok(Math.abs(Math.abs(AS.speed(100, y, bar)) - AS.VMAX) < 1e-9 && Math.abs(AS.speed(100 + AS.EDGE - 0.001, y, bar)) > AS.VMIN - 0.01 && Math.abs(AS.speed(100 + AS.EDGE - 0.001, y, bar)) < AS.VMIN + 0.05, '(ε) VMAX at the edge, VMIN at the inner border of the zone');
    ok(AS.speed(100 - 30, y, bar) === -AS.VMAX && AS.speed(100 - AS.EDGE - 1, y, bar) === 0, '(ε) left: overshooting the edge keeps full speed, far outside → 0');
    ok(AS.speed(905, y, bar) === 0, '(ε) right: past the bar (over «+N ▾») → 0, so its own hover still opens the menu');
    ok(AS.speed(102, bar.top - 40, bar) === 0 && AS.speed(102, bar.bottom + 40, bar) === 0 && AS.speed(102, bar.bottom + 10, bar) < 0, '(ε) only at the height of the bar (± a few px)');
    ok(AS.speed(110, y, { left: 100, right: 160, top: 10, bottom: 46 }) < 0 && AS.speed(150, y, { left: 100, right: 160, top: 10, bottom: 46 }) > 0, '(ε) a narrow bar: the nearer edge wins');
    let acc = 0, n = 0; for (let k = 0; k < 60; k++) { const s = AS.step(acc, 6, 1000 / 60); acc = s.acc; n += s.n; }
    ok(n === 6 || n === 5, '(ε) step: 6 tabs/s for 1 s ≈ 6 tabs (whole tabs, the rest carried)', n);
    ok(AS.step(0, 12, 5000).n === 1, '(ε) step: a stalled frame (5 s) never jumps more than ~1 tab');
    ok(AS.step(0, -12, 100).n === -1 && AS.step(-0.5, -6, 100).n === -1, '(ε) step: negative speed moves towards the start');
    const td = read('app/js/v26/tabdrag26122.js');
    ok(/end\(apply\) \{\s*const d = this\.d; if \(!d\) return; this\.d = null; this\.stopAuto\(\);/.test(td) && /e\.key === 'Escape'[^\n]*this\.end\(false\)/.test(td), '(ε) release and Esc both end the drag → stopAuto() (no scrolling after)');
    ok(/TabStrip\.start = ns; TabStrip\.layout\(\{ follow: false \}\)/.test(td) && !/scrollLeft/.test(td), '(ε) scrolls the same window as the mouse wheel (TabStrip.start), no DOM scrolling');
    ok(/requestAnimationFrame/.test(td) && !/setInterval/.test(td) && /NyxAutoScroll\.DWELL/.test(td) && AS.DWELL >= 200 && AS.EDGE <= 48, '(ε) driven by requestAnimationFrame; starts after a short dwell (250 ms) in a narrow (40 px) zone');
    const ix = read('app/index.html'); ok(ix.indexOf('autoscroll2613.js') > 0 && ix.indexOf('autoscroll2613.js') < ix.indexOf('tabdrag26122.js'), '(ε) autoscroll2613.js loads before tabdrag26122.js'); }
  console.log(`\nv2.6.13 unit (auto-scroll): ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
