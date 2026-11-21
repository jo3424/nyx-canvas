'use strict';
// v2.6.12.2 unit: pointer-event dragging of board tabs — the pure helpers (dragStarted / dropPlan: the same order rules
// as 2.6.12.1, no board lost / added) and static checks: no HTML5 drag & drop left for board tabs (no draggable=true,
// no 'nyx/tab' dataTransfer) on the bar tabs, the «+N ▾» rows and «Διαχείριση πινάκων»; the WHOLE menu row is the handle;
// × / ⋯ / 🗑 / name field never start a drag; the menu has no close on pointerdown / dragstart; ONE delete path
// (App.deleteBoard); the order is saved by BoardTabs.applyOrder; files loaded; versions; Electron 45.2.3.
const fs = require('fs'), path = require('path');
const R = process.env.NYX_ROOT || path.join(__dirname, '..');
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const read = (f) => { try { return fs.readFileSync(path.join(R, f), 'utf8'); } catch (_) { return ''; } };
let V = {}; try { V = require(path.join(R, 'app/js/v26/ui26122.js')); } catch (e) { ok(false, 'app/js/v26/ui26122.js loads', String(e)); }
const has = typeof V.dropPlan === 'function' && typeof V.dragStarted === 'function';
ok(has, 'NyxUI.dragStarted / NyxUI.dropPlan exist');
if (has) {
  const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  ok(!V.dragStarted(0, 0) && !V.dragStarted(3, 3) && V.dragStarted(4, 4) && V.dragStarted(0, -5) && V.dragStarted(6, 0), 'dragStarted: < 5 px = a click, ≥ 5 px = a drag');
  ok(!V.dragStarted(7, 0, 8) && V.dragStarted(8, 0, 8), 'dragStarted: custom threshold');
  // menu (firstHidden = 4: a b c d in the bar, e f g in «+N ▾»)
  ok(V.dropPlan(IDS, 'g', { kind: 'menu', board: 'e', where: 'before', firstHidden: 4 }).join('') === 'abcdgef', 'menu: last menu row → above the first menu row');
  ok(V.dropPlan(IDS, 'e', { kind: 'menu', board: 'g', where: 'after', firstHidden: 4 }).join('') === 'abcdfge', 'menu: first menu row → after the last');
  ok(V.dropPlan(IDS, 'b', { kind: 'menu', board: 'f', where: 'before', firstHidden: 4 }).join('') === 'acdebfg', 'menu: a bar board dropped on a menu row lands IN the menu (menuDrop)');
  ok(V.dropPlan(IDS, 'b', { kind: 'menu', board: 'e', where: 'before', firstHidden: 4 }).join('') === 'acdebfg', 'menu: bar board before the first menu row');
  // bar
  ok(V.dropPlan(IDS, 'e', { kind: 'bar', board: 'b', where: 'before' }).join('') === 'aebcdfg', 'bar: menu board → before bar tab b');
  ok(V.dropPlan(IDS, 'e', { kind: 'bar', board: 'b', where: 'after' }).join('') === 'abecdfg', 'bar: menu board → after bar tab b');
  ok(V.dropPlan(IDS, 'a', { kind: 'bar', board: 'c', where: 'after' }).join('') === 'bcadefg', 'bar: bar → bar');
  // more / manage
  ok(V.dropPlan(IDS, 'c', { kind: 'more' }).join('') === 'abdefgc', '«+N ▾» button: to the end');
  ok(V.dropPlan(IDS, 'a', { kind: 'manage', board: 'c', where: 'after' }).join('') === 'bcadefg', 'manage: a after c');
  // no-ops
  ok(V.dropPlan(IDS, 'a', null).join('') === IDS.join('') && V.dropPlan(IDS, 'a', { kind: 'bar', board: 'a' }).join('') === IDS.join(''), 'no target / onto itself = unchanged');
  ok(V.dropPlan(IDS, 'zz', { kind: 'bar', board: 'a' }).join('') === IDS.join('') && V.dropPlan(IDS, 'a', { kind: 'what', board: 'b' }).join('') === IDS.join(''), 'unknown board / kind = unchanged');
  const o = IDS.slice(); V.dropPlan(IDS, 'a', { kind: 'more' }); ok(IDS.join() === o.join(), 'dropPlan does not mutate its input');
  let bad = 0; const kinds = ['menu', 'bar', 'manage', 'more'];
  for (let n = 0; n < 3000; n++) {
    const L = IDS.slice(0, 2 + (n % 6)); const id = L[n % L.length]; const tg = L[(n * 7) % L.length];
    const r = V.dropPlan(L, id, { kind: kinds[n % 4], board: tg, where: n % 3 ? 'before' : 'after', firstHidden: n % (L.length + 1) });
    if (r.length !== L.length || [...r].sort().join() !== [...L].sort().join()) bad++;
  }
  ok(bad === 0, 'dropPlan: 3000 random drops — never loses, duplicates or adds a board', bad);
}
// ---- static ----
const tabs = read('app/js/v26/tabs26121.js'), drag = read('app/js/v26/tabdrag26122.js'), panels = read('app/js/panels.js'), html = read('app/index.html'), css = read('app/v26122.css');
const tabFn = (panels.match(/const tab = h\('div'[\s\S]*?T\.append\(tab\);/) || [''])[0];
ok(drag.length > 0 && /const TabDrag = \{/.test(drag), 'tabdrag26122.js defines TabDrag');
ok(!/dataTransfer|draggable: 'true'|ondragstart|ondrop/.test(tabs), 'tabs26121.js: no HTML5 drag & drop left («+N ▾» rows, manage rows, «+N ▾» button)');
ok(tabFn && !/dataTransfer|ondragstart|ondragover|ondrop|draggable: 'true'/.test(tabFn) && /draggable: 'false'/.test(tabFn) && /'data-drag': 'bar'/.test(tabFn), 'bar tab: draggable=false, data-drag=bar, no HTML5 handlers');
ok(/class: 'tm-row', 'data-board': b\.id, 'data-drag': 'menu', draggable: 'false'/.test(tabs), '«+N ▾»: the WHOLE row (div.tm-row) is the drag handle — not the inner button');
ok(/'data-drag': 'manage', draggable: 'false'/.test(tabs) && /class: 'bm-grip'/.test(tabs), 'manage: the row (and its ⋮⋮ handle) drags');
ok(/setPointerCapture/.test(drag) && /addEventListener\('pointerdown'/.test(drag) && /'pointermove'/.test(drag) && /'pointerup'/.test(drag) && /'pointercancel'/.test(drag), 'pointer events + setPointerCapture');
ok(/NOT: '\.tm-x,\.tab-x,input,textarea,select,\[contenteditable\],\.bm-more,\.bm-del'/.test(drag), '× / ⋯ / 🗑 / text fields never start a drag');
ok(/elementFromPoint/.test(drag) && /#ctxmenu\[data-menu=tabs-more\] \.tm-row/.test(drag) && /#tabs \.tab/.test(drag) && /#drawer-body \.bm-row/.test(drag) && /#tabs-more/.test(drag), 'targets: menu rows, bar tabs, manage rows, «+N ▾»');
ok(!/closeMenu/.test((drag.match(/down\(e\) \{[\s\S]*?\n  \},/) || [''])[0]) && !/closeMenu/.test((drag.match(/start\(e\) \{[\s\S]*?\n  \},/) || [''])[0]), 'the menu is NOT closed on pointerdown or at drag start');
ok(/BoardTabs\.applyOrder\(order\)/.test(drag) && /NyxUI\.dropPlan/.test(drag) && /BoardTabs\.reopen\(d\.id\)/.test(drag), 'order saved by BoardTabs.applyOrder; the menu reopens after a drop in it');
ok(/addEventListener\('click', eat, true\)/.test(drag), 'the click after a drag is swallowed (no board switch on drop)');
ok(/e\.key === 'Escape'/.test(drag), 'Esc cancels a drag');
ok(/del\(b, from\) \{\n    Panels\.closeMenu\(\); App\.deleteBoard\(b\);/.test(tabs) && !/deleteBoard/.test(drag), 'ONE delete path (App.deleteBoard) — the drag code never deletes');
ok(/TabDrag\.init\(\)/.test(tabs), 'BoardTabs.init starts TabDrag');
const iU = html.indexOf('js/v26/ui26121.js'), iU2 = html.indexOf('js/v26/ui26122.js'), iD = html.indexOf('js/v26/tabdrag26122.js'), iT = html.indexOf('js/v26/tabs26121.js');
ok(iU > 0 && iU2 > iU && iD > iU2 && iT > iD && /href="v26122\.css"/.test(html), 'index.html loads v26122.css, ui26122.js, tabdrag26122.js (in order)');
ok(/-webkit-user-drag:none/.test(css) && /\.tab-ghost\{/.test(css) && /touch-action:none/.test(css), 'v26122.css: no native drag image, floating copy, touch');
const pkg = JSON.parse(read('package.json') || '{}'), lock = JSON.parse(read('package-lock.json') || '{}');
ok(['2.6.12.2', '2.6.13', '2.6.13.1', '2.7.0', '2.7.1', '2.7.1.1'].includes(pkg.version) && lock.version === pkg.version && (lock.packages && lock.packages[''] && lock.packages[''].version) === pkg.version, 'version 2.6.12.2 (package.json + package-lock)', [pkg.version, lock.version]);
ok(/"electron": "45\.2\.3"/.test(read('package.json')), 'Electron 45.2.3');
{ const CH = JSON.parse(read('CHANGELOG.json') || '{}'); ok(['2.6.12.2', '2.6.13', '2.6.13.1', '2.7.0', '2.7.1', '2.7.1.1'].includes(Object.keys(CH)[0]) && CH['2.6.12.2'].el.length === 1 && CH['2.6.12.2'].en.length === 1 && CH['2.6.12.1'], 'CHANGELOG 2.6.12.2 first (1 item el/en), 2.6.12.1 kept'); }
console.log(`\nv2.6.12.2 unit: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
