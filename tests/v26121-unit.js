'use strict';
// v2.6.12.1 unit: board order helpers for the tabs in «+N ▾» (boardMove / menuDrop / boardStep — only the ORDER changes,
// no board lost, duplicated or added), dropWhere, the menu keys, and static checks: ONE right-click menu source
// (Panels.tabMenuRows), ONE delete (App.deleteBoard — unchanged: empty → at once, with items → «Διαγραφή πίνακα με N
// στοιχεία;», cards → Bin, «Αναίρεση»), no second delete path, files loaded, locales, versions, Electron 45.2.3.
const fs = require('fs'), path = require('path');
const R = process.env.NYX_ROOT || path.join(__dirname, '..');
const V = require(path.join(R, 'app/js/v26/ui26121.js'));
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

// ---- boardMove ----
ok(V.boardMove(IDS, 'f', 'b', 'before').join('') === 'afbcdeg', 'boardMove: f before b');
ok(V.boardMove(IDS, 'b', 'e', 'after').join('') === 'acdebfg', 'boardMove: b after e (forward)');
ok(V.boardMove(IDS, 'b', 'e', 'before').join('') === 'acdbefg', 'boardMove: b before e (forward)');
ok(V.boardMove(IDS, 'c', null, 'end').join('') === 'abdefgc', 'boardMove: to the end');
ok(V.boardMove(IDS, 'c', 'c', 'before').join('') === IDS.join(''), 'boardMove: onto itself = unchanged');
ok(V.boardMove(IDS, 'zz', 'a', 'before').join('') === IDS.join('') && V.boardMove(IDS, 'a', 'zz', 'after').join('') === IDS.join(''), 'boardMove: unknown id / target = unchanged');
ok(V.boardMove(IDS, 'a', null, 'before').join('') === IDS.join(''), 'boardMove: no target and not «end» = unchanged');
const orig = IDS.slice(); V.boardMove(IDS, 'a', 'g', 'after'); ok(IDS.join() === orig.join(), 'boardMove does not mutate its input');
// random: never loses / duplicates
{
  let bad = 0; const W = ['before', 'after', 'end'];
  for (let n = 0; n < 3000; n++) { const id = IDS[n % 7], tg = IDS[(n * 3 + 1) % 7], w = W[n % 3]; const o = V.boardMove(IDS, id, tg, w); if (!same(o, IDS)) bad++; const o2 = V.menuDrop(IDS, id, tg, w, n % 8); if (!same(o2, IDS)) bad++; const o3 = V.boardStep(IDS, id, n % 2 ? 1 : -1); if (!same(o3, IDS)) bad++; }
  ok(bad === 0, '9000 random moves: always the same boards, none lost or duplicated', bad);
}
// ---- menuDrop (bar shows a..d, menu e..g → firstHidden 4) ----
ok(V.menuDrop(IDS, 'b', 'e', 'before', 4).join('') === 'acdebfg', 'menuDrop: bar board b above the first menu row → FIRST in the menu (e fills the bar slot)');
ok(V.menuDrop(IDS, 'b', 'f', 'after', 4).join('') === 'acdefbg', 'menuDrop: bar board b below row f → right after f, in the menu');
ok(V.menuDrop(IDS, 'b', 'g', 'after', 4).join('') === 'acdefgb', 'menuDrop: bar board below the last row → last');
ok(V.menuDrop(IDS, 'g', 'e', 'before', 4).join('') === V.boardMove(IDS, 'g', 'e', 'before').join(''), 'menuDrop: a board already in the menu = a plain boardMove (reorder in the menu)');
{ const r = V.menuDrop(IDS, 'b', 'e', 'before', 4); ok(r.indexOf('b') >= 4, 'menuDrop: after a bar → menu drop the board sits at an index ≥ firstHidden (i.e. in the menu)', r); }
// ---- boardStep ----
ok(V.boardStep(IDS, 'c', -1).join('') === 'acbdefg' && V.boardStep(IDS, 'c', 1).join('') === 'abdcefg', 'boardStep: Alt+↑ / Alt+↓');
ok(V.boardStep(IDS, 'a', -1).join('') === IDS.join('') && V.boardStep(IDS, 'g', 1).join('') === IDS.join(''), 'boardStep: unchanged at the ends');
// ---- dropWhere ----
const rc = { left: 100, top: 10, width: 200, height: 30 };
ok(V.dropWhere(rc, { x: 150, y: 12 }, 'y') === 'before' && V.dropWhere(rc, { x: 150, y: 30 }, 'y') === 'after', 'dropWhere: upper half = before, lower = after (rows)');
ok(V.dropWhere(rc, { x: 120, y: 20 }, 'x') === 'before' && V.dropWhere(rc, { x: 260, y: 20 }, 'x') === 'after', 'dropWhere: left / right half (tabs)');
// ---- keys ----
const K = (key, o = {}, typing = false) => V.tabMenuKey({ key, ...o }, typing);
ok(K('ArrowDown') === 'next' && K('ArrowUp') === 'prev' && K('Home') === 'first' && K('End') === 'last', 'keys: ↑/↓ Home/End move the focus');
ok(K('ArrowUp', { altKey: true }) === 'move-up' && K('ArrowDown', { altKey: true }) === 'move-down', 'keys: Alt+↑/↓ move the board');
ok(K('Delete') === 'delete' && K('Backspace') === 'delete' && K('F2') === 'rename' && K('ContextMenu') === 'menu' && K('F10', { shiftKey: true }) === 'menu' && K('Enter') === 'open', 'keys: Delete, F2, ContextMenu / Shift+F10, Enter');
ok(K('Delete', {}, true) === null && K('ArrowUp', { altKey: true }, true) === null && K('Escape', {}, true) === 'close', 'keys: nothing while typing in a field (only Escape)');
ok(K('z', { ctrlKey: true }) === null && K('Delete', { ctrlKey: true }) === null, 'keys: Ctrl combinations are left alone (Ctrl+Z / Y stay global)');

// ---- static ----
const panels = read('app/js/panels.js'), tabs = read('app/js/v26/tabs26121.js'), look = read('app/js/v26/look2611.js'), appjs = read('app/js/app.js'), html = read('app/index.html');
ok(/tabMenuRows\(b\)\s*\{/.test(panels) && /this\.menu\(e\.clientX, e\.clientY, this\.tabMenuRows\(b\)\)/.test(panels) && /Panels\.menu\(x, y, Panels\.tabMenuRows\(b\)\)/.test(tabs), 'ONE right-click menu: the bar tab and the «+N ▾» rows / list both use Panels.tabMenuRows');
const rows = panels.slice(panels.indexOf('tabMenuRows(b) {'), panels.indexOf('tabMenuRows(b) {') + 900);
ok(/t\('rename'\)/.test(rows) && /t\('duplicate'\)/.test(rows) && /sw-row/.test(rows) && /App\.deleteBoard\(b\)/.test(rows), 'the tab menu = rename, duplicate, colours, delete (App.deleteBoard)');
ok((tabs.match(/App\.deleteBoard\(/g) || []).length === 1 && /del\(b, from\) \{\s*Panels\.closeMenu\(\); App\.deleteBoard\(b\);/.test(tabs), 'tabs26121: exactly one delete call — App.deleteBoard (via BoardTabs.del)');
ok(!/boards\.splice|Bin\.boardDeleted|items\s*=\s*\[\]|\.items\.length\s*=\s*0|NyxBin\.(add|purge)/.test(tabs), 'tabs26121: no second delete path (no splice, no Bin writes, no item clearing)');
ok(/boardDeleted\(b, i\)/.test(appjs) && /if \(!b\.items\.length\) return go\(\);/.test(appjs) && /t\('app\.003'/.test(appjs) && /label: t\('undo'\)/.test(appjs), 'App.deleteBoard unchanged: empty → at once, with items → question, cards → Bin, «Αναίρεση»');
const el = JSON.parse(read('app/locales/el.json')), en = JSON.parse(read('app/locales/en.json'));
ok(el['app.003'] === 'Διαγραφή πίνακα με {length} στοιχεία;', 'the question is «Διαγραφή πίνακα με N στοιχεία;»', el['app.003']);
ok(/S\.boards\.sort\(/.test(tabs) && /order\.some\(\(id\) => !cur\.includes\(id\)\)/.test(tabs) && /order\.length !== cur\.length/.test(tabs), 'applyOrder only re-sorts the same board objects (length and ids checked first)');
const keys = ['v26121.manage', 'v26121.manage_hint', 'v26121.drag', 'v26121.items', 'v26121.open', 'v26121.menu'];
ok(keys.every((k) => el[k] && en[k]) && el['v26121.manage'] === 'Διαχείριση πινάκων', 'locales el / en: all new keys', keys.filter((k) => !el[k] || !en[k]));
const iU = html.indexOf('js/v26/ui26121.js'), iL = html.indexOf('js/v26/look2611.js'), iT = html.indexOf('js/v26/tabs26121.js'), iP = html.indexOf('js/panels.js');
ok(iU > 0 && iT > iL && iU < iL && html.includes('href="v26121.css"'), 'index.html loads ui26121.js, tabs26121.js (after look2611.js) and v26121.css', { iU, iL, iT, iP });
ok(/BoardTabs\.init\(\)/.test(look) && /openMore\(\) \{ if \(typeof BoardTabs !== 'undefined'\) BoardTabs\.openMore\(\); \}/.test(look), 'look2611: «+N ▾» opens the BoardTabs menu');
ok(/boards: \(\) => BoardTabs\.manage\(\)/.test(panels), '«Διαχείριση πινάκων» refreshes like the other drawers');
const css = read('app/v26121.css');
ok(!/#[0-9a-f]{3,6}\b/i.test(css.replace(/#ff6b81/gi, '')), 'v26121.css: no new colours (theme tokens; the delete hover = the existing .danger red)');
// versions / invariants
const pkg = JSON.parse(read('package.json')); const CH = JSON.parse(read('CHANGELOG.json'));
ok(['2.6.12.1', '2.6.12.2', '2.6.13'].includes(pkg.version) && ['2.6.12.1', '2.6.12.2', '2.6.13'].includes(Object.keys(CH)[0]) && CH['2.6.12.1'].el.length === 3 && CH['2.6.12.1'].en.length === 3, 'version 2.6.12.1 + changelog el/en');
ok(/^\^?~?45\.2\.3$/.test(String((pkg.devDependencies || {}).electron || (pkg.dependencies || {}).electron)), 'Electron 45.2.3', (pkg.devDependencies || {}).electron);
console.log(`\nv2.6.12.1 unit: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
