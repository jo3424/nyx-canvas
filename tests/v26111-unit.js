'use strict';
// v2.6.11.1 unit: tab layout anchored to the end, pen-flyout helpers (hex, recent colours, px, opacity, eyedropper fallback colour),
// static checks (arrow/line in the shapes flyout, size dots, tooltip, versions, zoom limits, no main-process/IPC change)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const R = path.join(__dirname, '..');
const U = require('../app/js/v26/ui2611.js');
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const W = (n, w = 120) => Array.from({ length: n }, () => w);

// ---- a) tabs anchored to the end ----
{
  let L = U.tabLayout({ widths: W(40), avail: 900, active: 0, anchor: 'end' });
  ok(L.mode === 'overflow' && L.visible[0] === 0 && L.visible.includes(39) && L.visible.includes(38), 'active = first: visible = active + the LAST tabs', L.visible);
  ok(L.hidden[0] === 1 && L.hidden.every((i) => i < Math.min(...L.visible.filter((v) => v !== 0))), 'hidden («+N ▾») = the FIRST tabs, in order', L.hidden);
  ok(L.visible.length === L.k && L.hidden.length === 40 - L.k, 'k tabs visible, the rest hidden (none lost)', { k: L.k, v: L.visible.length, h: L.hidden.length });
  L = U.tabLayout({ widths: W(40), avail: 900, active: 39, anchor: 'end' });
  ok(L.start === L.maxStart && L.visible.at(-1) === 39 && L.visible[0] === 40 - L.k, 'active = last (new board): the last k tabs', L.visible);
  L = U.tabLayout({ widths: W(40), avail: 900, active: 20, anchor: 'end' });
  ok(L.visible.includes(20) && L.visible.includes(39) && L.visible.length === L.k, 'active in the middle: pinned with the last tabs', L.visible);
  L = U.tabLayout({ widths: W(40), avail: 900, active: 0, anchor: 'end', start: 3, follow: false });
  ok(L.start === 3 && L.visible.includes(0), 'wheel (explicit start) moves the window; active still pinned', L.visible);
  L = U.tabLayout({ widths: W(5), avail: 900, active: 0, anchor: 'end' });
  ok(L.mode !== 'overflow' && L.hidden.length === 0, 'when everything fits nothing is hidden', L);
  const old = U.tabLayout({ widths: W(40), avail: 900, active: 33 });
  ok(old.visible.includes(33), 'without anchor: 2.6.11 behaviour kept (tests of 2.6.11 still valid)');
  const look = read('app/js/v26/look2611.js');
  ok(/anchor: 'start'/.test(look) && !/this\.start = null;/.test(look), '2.6.12: TabStrip uses anchor start (first tabs stay; re-renders keep the wheel position)');
  ok(/Store\.state\.boards\.push\(b\)/.test(read('app/js/app.js')), '«+» (App.newBoard) adds the board at the END of the list');
}

// ---- c) pen helpers ----
{
  ok(U.toHex('#ff8800') === '#FF8800' && U.toHex('ff8800') === '#FF8800' && U.toHex('#abc') === '#AABBCC', 'toHex: #rrggbb, rrggbb, #rgb');
  ok(U.toHex('rgb(255, 136, 0)') === '#FF8800' && U.toHex('rgba(18,52,86,1)') === '#123456', 'toHex: rgb()/rgba()');
  ok(U.toHex('rgba(0, 0, 0, 0)') === null && U.toHex('#11223300') === null, 'toHex: fully transparent → null (EyeDropper on a blank capture → fallback)');
  ok(['zz12', '', null, '#12345', 'rgb(300,0,0)', 'red'].every((x) => U.toHex(x) === null), 'toHex: invalid → null');
  let r = U.pushRecent([], '#ff8800'); r = U.pushRecent(r, '#123456'); r = U.pushRecent(r, '#FF8800');
  ok(r.join() === '#FF8800,#123456', 'recent: newest first, no duplicates (case-insensitive)', r);
  for (const c of ['#111111', '#222222', '#333333']) r = U.pushRecent(r, c);
  ok(r.length === 4 && r[0] === '#333333' && !r.includes('#123456'), 'recent: at most 4, oldest drops', r);
  ok(U.pushRecent(['#FFFFFF'], 'bad').join() === '#FFFFFF' && U.pushRecent(undefined, '#000').join() === '#000000', 'recent: invalid colour ignored, missing list ok');
  ok(U.PEN_PX_MIN === 1 && U.PEN_PX_MAX === 40 && U.clampInt(99, 1, 40, 4) === 40 && U.clampInt(0, 1, 40, 4) === 1 && U.clampInt('x', 1, 40, 4) === 4 && U.clampInt('7.4', 1, 40, 4) === 7, 'px clamped to 1–40');
  ok(U.inkOpacity('highlighter') === 0.38 && U.inkOpacity('pen') === 1 && U.inkOpacity('marker') === 1, 'opacity defaults: highlighter 38 %, pen/marker 100 % (as before)');
  ok(U.inkOpacity('pen', 50) === 0.5 && U.inkOpacity('pen', 0) === 0.01 && U.inkOpacity('pen', 300) === 1 && U.inkOpacity('highlighter', '') === 0.38, 'opacity % clamped 1–100');
  ok(U.itemColor({ type: 'ink', color: '#ff0000' }) === '#FF0000' && U.itemColor({ type: 'sticky', paper: '#a5d6a7' }) === '#A5D6A7' && U.itemColor({ type: 'shape', fill: '', stroke: '#00ff00' }) === '#00FF00' && U.itemColor({ type: 'arrow', stroke: '' }) === '#7C8CFF' && U.itemColor({ type: 'image' }) === null && U.itemColor(null) === null,
    'eyedropper fallback: colour of stroke / note / shape / arrow; none for an image');
}

// ---- user additions (15/11): tab order, key 0 for the 10th paper kind ----
{
  const k = (key, code, o = {}) => Object.assign({ key, code }, o);
  ok(U.flyoutDigit(k('0', 'Digit0'), true, 10) === 9 && U.flyoutDigit(k('0', 'Numpad0'), true, 10) === 9, 'flyout with 10 items: «0» (row or numpad) → 10th');
  ok(U.flyoutDigit(k('0', 'Digit0'), true, 9) === -1 && U.flyoutDigit(k('0', 'Digit0'), true, 8) === -1, 'flyouts with ≤ 9 items: «0» does nothing');
  ok(U.flyoutDigit(k('0', 'Digit0'), false, 10) === -1, 'flyout closed: «0» does nothing');
  ok(U.flyoutDigit(k('0', 'Digit0', { typing: true }), true, 10) === -1, 'typing: «0» is typed, not picked');
  ok(U.flyoutDigit(k('0', 'Digit0', { ctrlKey: true }), true, 10) === -1 && U.flyoutDigit(k(')', 'Digit0', { shiftKey: true }), true, 10) === -1, 'Ctrl+0 (zoom 100 %) and Shift+0 untouched');
  ok(U.flyoutDigit(k('0', 'Digit0'), true, 10) === 9 && U.flyoutDigit(k('9', 'Digit9'), true, 10) === 8 && U.flyoutDigit(k('1', 'Digit1'), true, 10) === 0, 'keys 1–9 unchanged next to 0');
  const tools = read('app/js/tools.js');
  ok(/const num = \(el, ten\) => \{ if \(fk < 9 \|\| \(ten && fk === 9\)\)/.test(tools) && /String\(fk % 10\)/.test(tools), 'num(): only callers that pass «ten» get a 10th item with data-fk «0»');
  const tenCalls = (tools.match(/\), true\)\)\)/g) || []).length; // 2.6.12: the paper grid lost its label span (one paren less)
  ok(tenCalls === 1 && /iconSvg\(ic, 18\)\), true\)\)\)/.test(tools), 'only the paper kinds pass «ten» (pen/shapes keep 1–9 / 1–8)');
  const html = read('app/index.html'); const z = html.slice(html.indexOf('id="tabs-zone"'), html.indexOf('</div>', html.indexOf('id="tabs-zone"') + 200) + 400);
  const iT = z.indexOf('id="tabs"'), iA = z.indexOf('id="btn-add-tab"'), iM = z.indexOf('id="tabs-more"');
  ok(iT > 0 && iT < iA && iA < iM, 'title bar order like the mockup: tabs → «+» → «+N ▾»', { iT, iA, iM });
}

// ---- static checks ----
{
  const tools = read('app/js/tools.js');
  const defs = tools.slice(tools.indexOf('const TOOL_DEFS'), tools.indexOf('];', tools.indexOf('const TOOL_DEFS')));
  ok(!/\['arrow'/.test(defs) && !/\['line'/.test(defs) && /\['shape'/.test(defs) && /\['frame'/.test(defs), 'dock: arrow and line are no separate buttons');
  ok(/const SHAPE_LINES = \[\['arrow', 'move-up-right'\], \['line', 'minus'\]\]/.test(tools) && /\.\.\.shapeBtns, h\('div', \{ class: 'fo-mini-sep'/.test(tools), 'shapes flyout: 6 shapes then arrow + line (8 items)');
  ok(/a: 'arrow', l: 'line'/.test(read('app/js/app.js')), 'keys A / L still pick arrow / line');
  ok(/dockOf\(id\) \{ return id === 'arrow' \|\| id === 'line' \? 'shape' : id; \}/.test(tools) && /Tools\.dockOf/.test(read('app/js/v26/look2611.js')), 'arrow/line: flyout and highlight at the shapes button');
  ok(/h\('i', \{ style: \{ width: Math\.min\(22, sz \+ 2\)/.test(tools) && !/class: 'szb'[^\n]*h\('span'/.test(tools), 'size dots are <i> (styles.css `.szb i`) → visible');
  ok(/new EyeDropper\(\)\.open\(\)/.test(tools) && /this\.pickFromCanvas\(apply\)/.test(tools) && !/capturePage/.test(tools), 'eyedropper: EyeDropper first, then click-a-card fallback; no capturePage');
  ok(/opacity: op,/.test(tools) && /NyxUI\.inkOpacity\(kind, S\[kind \+ 'Opacity'\]\)/.test(tools), 'strokes use the opacity setting');
  ok(/'v26111\.lib_tip'/.test(tools), 'library button uses the tooltip key');
  const el = JSON.parse(read('app/locales/el.json')), en = JSON.parse(read('app/locales/en.json'));
  const keys = Object.keys(el).filter((k) => k.startsWith('v26111.'));
  ok(el['v26111.lib_tip'] === 'Βιβλιοθήκη (Ctrl+E)' && keys.length >= 10 && keys.every((k) => en[k]), 'locales: «Βιβλιοθήκη (Ctrl+E)» + all v26111 keys in el and en', keys);
  ok(el.t_library === JSON.parse(cp.execSync('git show b271669:app/locales/el.json', { cwd: R }).toString()).t_library, 't_library unchanged (used by the insert menu)');
  ok(/MINZ: 0\.05, MAXZ: 8/.test(read('app/js/canvas.js')), 'zoom stays 5 %–800 %');
  const pkg = JSON.parse(read('package.json')); const lock = JSON.parse(read('package-lock.json'));
  ok(['2.6.11.1', '2.6.12', '2.6.12.1'].includes(pkg.version) && pkg.devDependencies.electron === '45.2.3', 'version 2.6.11.1, Electron 45.2.3', pkg.version);
  ok(['2.6.11.1', '2.6.12', '2.6.12.1'].includes(lock.version) && lock.packages[''].version === lock.version, 'package-lock version 2.6.11.1', [lock.version, lock.packages[''].version]);
  const lockDiff = cp.execSync('git diff b271669 -- package-lock.json', { cwd: R }).toString().split('\n').filter((l) => /^[+-]\s/.test(l));
  ok(lockDiff.length <= 4 && lockDiff.every((l) => /"version": "2\.6\.(5\.1|11\.1|12|12\.1)"/.test(l)), 'package-lock: only the version fields changed', lockDiff);
  const CH = JSON.parse(read('CHANGELOG.json'));
  ok(['2.6.11.1', '2.6.12', '2.6.12.1'].includes(Object.keys(CH)[0]) && CH['2.6.11.1'].el.length === 3 && CH['2.6.11.1'].en.length === 3 && CH['2.6.11'], 'CHANGELOG 2.6.11.1 first (3 items), 2.6.11 kept');
  const mainDiff = cp.execSync('git diff --name-only b271669 -- main main.js preload.js boot.js', { cwd: R }).toString().trim();
  ok(mainDiff === '', 'no change in main process / preload / IPC / permissions', mainDiff);
  ok(cp.execSync('git diff b271669 -- main/update-key.js', { cwd: R }).toString() === '', 'trusted update keys unchanged');
  let pk = ''; try { pk = cp.execSync('git grep -l -I -E "BEGIN [A-Z ]*PRIVATE KEY" -- . ":!tests"', { cwd: R }).toString().trim(); } catch (e) { pk = ''; }
  ok(pk === '', 'no private key in the repo', pk);
  ok(fs.existsSync(path.join(R, 'tools/accept/ΑΛΛΑΓΕΣ-v2.6.11.1.txt')) && fs.existsSync(path.join(R, 'tools/accept/ΔΟΚΙΜΗ-ΑΠΟΔΟΧΗΣ-v2.6.11.1.txt')), 'Greek docs in tools/accept');
  const ch = fs.existsSync(path.join(R, 'tools/accept/ΑΛΛΑΓΕΣ-v2.6.11.1.txt')) ? read('tools/accept/ΑΛΛΑΓΕΣ-v2.6.11.1.txt') : '';
  ok(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14'].every((n) => ch.includes('| ' + n + ' ')), 'ΑΛΛΑΓΕΣ has a table row for each of the 14 mockup screens');
}
console.log(`\nv2.6.11.1 unit: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
