'use strict';
// v2.6.11 unit tests (plain node, no screen): appearance only.
//  - tab strip: fit → shrink to a minimum → «+N ▾»; active always visible; wheel; never wider than the strip (no wrap)
//  - flyouts: touch their button, clamped inside the window at every edge, flip at the right edge, inner scroll if too tall
//  - keys 1–9: only while a flyout is open, never while typing (input / textarea / contenteditable), never with Ctrl/Alt/Meta
//  - Hub counters from real data: «1 / 1 · μέγιστο 1 · 3 στον φάκελο» for the user's setup, other inputs give other numbers
//  - contrast: WCAG formula, «Γυαλί» only ≥ 4.5:1 (every built-in theme measured, a failing theme is refused), 5 fixed styles ≥ 4.5:1
//  - static: scripts/CSS loaded, Bin out of the zoom bar, defaults untouched (no forced style), Electron 45.2.3, no keys in the tree
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const U = require('../app/js/v26/ui2611.js');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 700) : '')); c ? passes++ : fails++; };
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const el = JSON.parse(read('app/locales/el.json')), en = JSON.parse(read('app/locales/en.json'));
const tEl = (k, v) => { let s = el[k] ?? k; for (const [a, b] of Object.entries(v || {})) s = s.split('{' + a + '}').join(String(b)); return s; };
const tEn = (k, v) => { let s = en[k] ?? k; for (const [a, b] of Object.entries(v || {})) s = s.split('{' + a + '}').join(String(b)); return s; };

console.log('Tabs');
{
  const W = (n, w = 150) => Array.from({ length: n }, () => w);
  let L = U.tabLayout({ widths: W(3), avail: 900, active: 1 });
  ok(L.mode === 'fit' && L.visible.length === 3 && !L.hidden.length, '3 tabs in 900 px: all at natural width', L);
  L = U.tabLayout({ widths: W(8), avail: 900, active: 0 });
  const sum = (L) => L.visible.reduce((a, i) => a + L.width[i], 0) + U.TAB_GAP * (L.visible.length - 1) + (L.hidden.length ? U.MORE_W + U.TAB_GAP : 0);
  ok(L.mode === 'shrink' && L.visible.length === 8 && L.visible.every((i) => L.width[i] >= U.TAB_MIN && L.width[i] < 150) && sum(L) <= 900, '8 tabs: all visible, shrunk but ≥ minimum ' + U.TAB_MIN + ' px', { w: L.width, sum: sum(L) });
  for (const n of [12, 25, 40, 120]) for (const avail of [300, 640, 900, 1500]) for (const active of [0, Math.floor(n / 2), n - 1]) {
    L = U.tabLayout({ widths: Array.from({ length: n }, (_, i) => 90 + (i * 37) % 140), avail, active });
    const good = L.visible.includes(active) && sum(L) <= avail + 0.5 && L.visible.length + L.hidden.length === n && L.visible.every((i) => L.width[i] >= U.TAB_MIN) && (L.hidden.length === 0 || L.mode === 'overflow');
    if (!good) { ok(false, `n=${n} avail=${avail} active=${active}`, { L, sum: sum(L) }); }
  }
  ok(true, 'n ∈ {12,25,40,120} × width ∈ {300…1500} × active ∈ {first,middle,last}: active visible, every tab ≥ minimum, strip never wider than its space (no wrap), visible+hidden = all');
  L = U.tabLayout({ widths: W(40), avail: 900, active: 33 });
  ok(L.mode === 'overflow' && L.hidden.length === 40 - L.visible.length && L.visible.includes(33) && L.hidden.length > 0, '40 tabs in 900 px → «+' + L.hidden.length + ' ▾», active #34 visible', { k: L.k, start: L.start });
  // wheel: moves the window one tab per notch, clamped; the active one stays (pinned) even when scrolled away
  let s = L.start; const max = L.maxStart;
  s = U.wheelStart(s, 100, 0, max); ok(s === Math.min(L.start + 1, max), 'wheel down → one tab further');
  ok(U.wheelStart(0, -100, 0, max) === 0 && U.wheelStart(max, 100, 0, max) === max, 'wheel clamped at both ends');
  const L2 = U.tabLayout({ widths: W(40), avail: 900, active: 33, start: 0, follow: false });
  ok(L2.start === 0 && L2.visible.includes(33) && L2.visible.includes(0) && L2.visible.length === L.visible.length, 'scrolled to the start: active tab still shown (pinned at the end)', L2.visible);
  const L3 = U.tabLayout({ widths: W(40), avail: 900, active: 33, start: 0, follow: true });
  ok(L3.visible.includes(33) && L3.start > 0, 'switching board (follow) → the window moves to the active tab', L3.start);
  const L4 = U.tabLayout({ widths: W(2), avail: 60, active: 1 });
  ok(L4.visible.length === 1 && L4.visible[0] === 1 && L4.hidden[0] === 0, 'tiny strip: at least the active tab, the rest in «+N»', L4);
}

console.log('Flyouts');
{
  const win = { left: 0, top: 40, right: 1440, bottom: 900 };
  const btn = (y, x = 14, s = 40) => ({ left: x, right: x + s, top: y, bottom: y + s });
  let p = U.clampFlyout(btn(430), { w: 84, h: 210 }, win);
  ok(p.left === 54 && p.touch && p.side === 'right' && p.top <= 430 + 20 && p.top + p.h >= 430 + 20, 'shapes flyout: left edge on the button edge (touching), centred on it', p);
  p = U.clampFlyout(btn(850), { w: 84, h: 420 }, win);
  ok(p.top + p.h <= 900 - 8 && p.top >= 48 && p.touch && p.top < 850 + 36 && p.top + p.h > 850 + 4, 'button at the bottom edge: flyout clamped inside, still overlaps the button', p);
  p = U.clampFlyout(btn(44), { w: 84, h: 420 }, win);
  ok(p.top >= 48 && p.touch && p.top <= 44 + 36, 'button at the top edge (under the title bar): clamped below the bar', p);
  p = U.clampFlyout({ left: 1396, right: 1436, top: 400, bottom: 440 }, { w: 160, h: 200 }, win);
  ok(p.side === 'left' && p.left + p.w === 1396 && p.touch && p.left >= 8, 'button at the right edge → flips to the left side, still touching', p);
  p = U.clampFlyout(btn(300), { w: 84, h: 700 }, { left: 0, top: 40, right: 800, bottom: 560 });
  ok(p.maxH === 560 - 40 - 16 && p.top === 48 && p.top + p.h <= 552 && p.touch, 'window shorter than the flyout → maxH + inner scroll, inside the window', p);
  let all = true;
  for (let y = 40; y <= 860; y += 20) for (const h of [120, 300, 480, 900]) { const q = U.clampFlyout(btn(y), { w: 84, h }, win); if (!(q.top >= 48 && q.top + q.h <= 892 && q.touch && q.left >= 8 && q.left + q.w <= 1432)) { all = false; ok(false, 'edge sweep', { y, h, q }); break; } }
  ok(all, 'sweep: every button position × 4 heights → inside the window and touching');
}

console.log('Keys 1–9');
{
  const k = (key, code, o = {}) => ({ key, code, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, typing: false, ...o });
  ok(U.flyoutDigit(k('4', 'Digit4'), true, 6) === 3, 'flyout open: «4» → 4th item');
  ok(U.flyoutDigit(k('4', 'Digit4'), false, 6) === -1, 'flyout closed: «4» does nothing');
  ok(U.flyoutDigit(k('4', 'Digit4', { typing: true }), true, 6) === -1, 'typing (input / contenteditable): «4» is typed, not picked');
  ok(U.flyoutDigit(k('4', 'Digit4', { ctrlKey: true }), true, 6) === -1, 'Ctrl+4 stays «board 4» (not a flyout key)');
  ok(U.flyoutDigit(k('4', 'Digit4', { altKey: true }), true, 6) === -1 && U.flyoutDigit(k('4', 'Digit4', { metaKey: true }), true, 6) === -1, 'Alt / Meta: nothing');
  ok(U.flyoutDigit(k('!', 'Digit1', { shiftKey: true }), true, 6) === -1, 'Shift+1 («!» = fit) untouched');
  ok(U.flyoutDigit(k('7', 'Digit7'), true, 6) === -1, 'digit beyond the items: nothing');
  ok(U.flyoutDigit(k('9', 'Numpad9'), true, 9) === 8 && U.flyoutDigit(k('0', 'Digit0'), true, 9) === -1, 'Numpad 9 → 9th; 0 never');
  ok(U.flyoutDigit(k('1', 'Digit1'), true, 16) === 0, 'Greek layout: digits keep key «1» / code Digit1 → 1st (code is used, layout-independent)');
  const fake = (tag, extra = {}) => ({ tagName: tag, type: extra.type, isContentEditable: !!extra.ce, closest: () => (extra.inCe ? {} : null) });
  ok(U.isTyping(fake('INPUT', { type: 'text' })) && U.isTyping(fake('INPUT', { type: 'search' })) && U.isTyping(fake('TEXTAREA')) && U.isTyping(fake('DIV', { ce: true })) && U.isTyping(fake('SPAN', { inCe: true })), 'typing = text inputs, textarea, contenteditable (and inside it)');
  ok(!U.isTyping(fake('BUTTON')) && !U.isTyping(fake('INPUT', { type: 'checkbox' })) && !U.isTyping(fake('DIV')) && !U.isTyping(null), 'not typing = buttons, checkboxes, canvas');
}

console.log('Hub counters');
{
  const m = (id, v) => ({ id, status: { value: v } });
  const user = [m('Qwen3.8-27B-UD-Q4_K_XL', 'loaded'), m('gemma-4-12B-it-Q4_0', 'unloaded'), m('llama-krikri-8b-instruct-q8_0', 'unloaded')];
  let r = U.hubCounts(user, 1, tEl);
  ok(r.line === '1 / 1 · μέγιστο 1 · 3 στον φάκελο', 'user setup (models-max 1, 3 in the folder): «1 / 1 · μέγιστο 1 · 3 στον φάκελο»', r);
  r = U.hubCounts(user, 1, tEn); ok(r.line === '1 / 1 · max 1 · 3 in the folder', 'English: «1 / 1 · max 1 · 3 in the folder»', r);
  r = U.hubCounts([m('a', 'loaded'), m('b', 'loaded'), m('c', 'unloaded'), m('d', 'sleeping')], 2, tEl);
  ok(r.line === '2 / 2 · μέγιστο 2 · 4 στον φάκελο', 'other data → other numbers (2 / 2 · μέγιστο 2 · 4) — nothing hard-coded', r);
  r = U.hubCounts([m('a', 'unloaded'), m('b', 'unloaded'), m('c', 'unloaded')], 1, tEl);
  ok(r.line === '0 / 1 · μέγιστο 1 · 3 στον φάκελο', 'nothing loaded → 0 / 1', r);
  r = U.hubCounts([{ id: 'a' }, { id: 'b' }], null, tEl);
  ok(r.line === '— · 2 στον φάκελο' && r.loaded === null, 'router without status / max → «—», never a guessed number', r);
  r = U.hubCounts([{ id: 'a', loaded: true, state: 'ready' }, { id: 'b', loaded: false, state: 'unloaded' }], 1, tEl);
  ok(r.loaded === 1, 'normalised ai.js shape (loaded / state) counted the same');
  ok(U.modelState(m('x', 'loaded')) === 'loaded' && U.modelState(m('x', 'loading')) === 'loading' && U.modelState(m('x', 'unloaded')) === 'disk' && U.modelState({ id: 'x' }) === 'disk', 'model state → φορτωμένο / φορτώνει / στον δίσκο');
  ok(el['v2611.m_loaded'] === 'φορτωμένο' && el['v2611.m_disk'] === 'στον δίσκο' && el['v2611.st_on'] === 'σε λειτουργία' && el['v2611.st_off'] === 'σταματημένο' && el['v2611.live_pages'] === 'Ζωντανές σελίδες', 'Greek labels: σε λειτουργία / σταματημένο, φορτωμένο / στον δίσκο, Ζωντανές σελίδες');
  const ht = read('app/js/v2/hub-tabs.js');
  ok(/HubHead\.set\(models, liveMax\)/.test(ht) && !/1 \/ 1 · /.test(ht + read('app/js/v26/look2611.js')), 'Hub header filled from the router answers (models + live max), no fixed «1 / 1» in code');
  ok(!/webview/i.test(Object.entries(el).filter(([k]) => k.startsWith('v2611.')).map(([, v]) => v).join(' ')), 'no «webviews» in the new Greek texts');
}

console.log('Contrast');
{
  ok(Math.abs(U.contrast('#000000', '#ffffff') - 21) < 1e-9, 'black on white = 21:1');
  ok(Math.abs(U.contrast('#777777', '#ffffff') - 4.478) < 0.01, '#777 on white = 4,48:1 (WCAG reference)');
  ok(U.contrast('#ffffff', '#ffffff') === 1, 'same colour = 1:1');
  global.t = (k) => k;
  const src = read('app/js/themes.js');
  const THEMES = new Function('t', src.slice(src.indexOf('const THEMES ='), src.indexOf('const ICON_SW')) + '; return THEMES;')(global.t);
  const res = THEMES.map((th) => ({ id: th.id, ...U.glassCheck(th.vars) }));
  ok(res.length === 16 && res.every((r) => r.ok && r.text >= 4.5 && r.muted >= 4.5), 'Γυαλί on all 16 themes: text and muted text ≥ 4,5:1 on the worst backdrop (black, white, theme bg/card)', res.map((r) => r.id + ' ' + r.min.toFixed(2)));
  const bad = { bg: '#777777', bg2: '#888888', card: '#999999', 'panel-solid': '#808080', text: '#9a9a9a', muted: '#a0a0a0' };
  const g = U.glassCheck(bad);
  ok(!g.ok && g.min < 4.5 && U.styleCss('glass', bad) === '', 'low-contrast theme → Γυαλί refused (no CSS applied)', g);
  ok(/background:rgba\(18,22,40,0\.82\)/.test(U.styleCss('glass', THEMES[0].vars)) && /--muted:#/.test(U.styleCss('glass', THEMES[0].vars)), 'Γυαλί CSS uses the measured panel and the adjusted muted colour');
  const fixed = U.UI_STYLES.filter((s) => !s.glass).map((s) => ({ id: s.id, ...U.paletteCheck(s) }));
  ok(U.UI_STYLES.length === 6 && fixed.length === 5 && fixed.every((r) => r.ok), '6 styles; the 5 fixed ones have text and muted ≥ 4,5:1', fixed.map((r) => r.id + ' ' + r.min.toFixed(2)));
  ok(U.styleCss('', THEMES[0].vars) === '' && U.styleCss('nope', THEMES[0].vars) === '', 'no style / unknown style → no CSS (the theme look)');
  ok(U.UI_STYLES.every((s) => el[s.key] && en[s.key]), 'style names in el/en');
}

console.log('Static');
{
  const html = read('app/index.html');
  ok(/js\/v26\/ui2611\.js/.test(html) && /js\/v26\/look2611\.js/.test(html) && /v2611\.css/.test(html) && html.indexOf('ui2611.js') < html.indexOf('js/panels.js'), 'ui2611.js (before panels), look2611.js and v2611.css loaded');
  ok(/id="tabs-more"/.test(html) && /role="tablist"/.test(html) && /aria-haspopup="menu"/.test(html), '«+N ▾» button and tablist in the title bar');
  const css = read('app/v2611.css');
  ok(/#tabs\.tabs\{[^}]*flex-wrap:nowrap/.test(css) && /#drawer \.seg\.lib-tabs\{[^}]*flex-wrap:nowrap/.test(css), 'board tabs and Library tabs: nowrap');
  const bin = read('app/js/v26/bin-ui.js');
  ok(/bin-corner/.test(bin) && !/zoombar/.test(bin.split('init()')[1].split('badge()')[0]), 'Bin button lives in #bin-corner, not in the zoom bar');
  const panels = read('app/js/panels.js');
  ok(/libCount\(more, i, list\.length\)/.test(panels) && /v2611\.lib_shown/.test(panels) && /v2611\.lib_total/.test(panels), 'Library counter = shown / real total');
  const store = read('app/js/store.js');
  ok(!/uiStyle/.test(store), 'no forced default style in the store defaults (absent = theme look)');
  const look = read('app/js/v26/look2611.js');
  ok(/delete S\.uiStyle/.test(look) && !/Store\.state\.(boards|subs|bin)\s*=/.test(look) && !/removeItems|splice\(/.test(look), 'look2611 only adds/removes its own setting; never touches boards, subscriptions or the bin');
  const pkg = JSON.parse(read('package.json'));
  ok(pkg.version === '2.6.11' && pkg.devDependencies.electron === '45.2.3', 'version 2.6.11, Electron 45.2.3 exact');
  const cl = JSON.parse(read('CHANGELOG.json'));
  ok(cl['2.6.11'] && cl['2.6.11'].el.length === 5 && cl['2.6.11'].en.length === 5, 'CHANGELOG 2.6.11 el/en');
  const git = require('child_process').execSync('git ls-files', { cwd: R }).toString().split('\n');
  let pk = ''; try { pk = require('child_process').execSync('git grep -l -I -E "BEGIN [A-Z ]*PRIVATE KEY" -- . ":!tests/v2611-unit.js"', { cwd: R }).toString().trim(); } catch (e) { pk = ''; }
  ok(!git.some((f) => /\.(pem|key)$/i.test(f) || /nebula-keys/i.test(f)) && !pk, 'no key files and no private key text tracked in the repo', pk);
  ok(!/\.ctx\s*=|modelsMax\s*=|servers\.llama|proc:start|ai:chat/.test(look + read('app/js/v26/ui2611.js')), 'the 2.6.11 files never write ctx / models-max and never start a router or a chat');
  ok(fs.existsSync(path.join(R, 'tools/accept/ΑΛΛΑΓΕΣ-v2.6.11.txt')) && fs.existsSync(path.join(R, 'tools/accept/ΔΟΚΙΜΗ-ΑΠΟΔΟΧΗΣ-v2.6.11.txt')), 'Greek docs in tools/accept');
}

console.log(`\nv2.6.11 unit: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
