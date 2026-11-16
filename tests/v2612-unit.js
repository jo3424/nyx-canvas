'use strict';
// v2.6.12 unit: tabs anchored to the START (first tabs stay, last/new ones in «+N ▾», active never pins), palette helpers,
// Library keyboard helpers, Hub chips / log redaction (no secret ever shown), static checks (palette root-cause fix in place,
// key card without the key, no «--models-max» text, one «Εργαλεία v2.5», paper icons only, versions, Electron 45.2.3)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const R = path.join(__dirname, '..');
const U = require('../app/js/v26/ui2611.js');
const V = require('../app/js/v26/ui2612.js');
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const W = (n, w = 120) => Array.from({ length: n }, () => w);

// ---- 1) tabs: anchor 'start' ----
{
  let L = U.tabLayout({ widths: W(40), avail: 900, active: 0, anchor: 'start' });
  ok(L.mode === 'overflow' && L.visible.every((v, i) => v === i) && L.hidden[0] === L.k, 'start: the FIRST k tabs are visible, «+N ▾» holds the rest in order', { v: L.visible, h: L.hidden.slice(0, 3) });
  ok(L.visible.length + L.hidden.length === 40 && !L.activeHidden, 'no tab lost; active (first) visible', L);
  const k = L.k;
  L = U.tabLayout({ widths: W(40), avail: 900, active: 39, anchor: 'start' });
  ok(L.visible.every((v, i) => v === i) && L.activeHidden && L.hidden.includes(39), 'active = last (new board): the first tabs stay, the active is in «+N ▾» (activeHidden)', { v: L.visible, ah: L.activeHidden });
  // fill the bar, then 3 new tabs → those 3 are in the menu
  const n0 = k; L = U.tabLayout({ widths: W(n0 + 3), avail: 900, active: n0 + 2, anchor: 'start' });
  ok([n0, n0 + 1, n0 + 2].every((i) => L.hidden.includes(i)) && L.visible.every((v, i) => v === i), 'bar full + 3 new tabs → the 3 new ones are in «+N ▾», the first ones unchanged', { k: n0, v: L.visible, h: L.hidden });
  L = U.tabLayout({ widths: W(40), avail: 900, active: 39, anchor: 'start', start: 3 });
  ok(L.start === 3 && L.visible[0] === 3, 'the wheel position (start) is kept on re-layout', L.start);
  L = U.tabLayout({ widths: W(40), avail: 900, active: 0, anchor: 'start', start: 999 });
  ok(L.start === L.maxStart && L.visible.at(-1) === 39, 'start clamped to maxStart', { s: L.start, m: L.maxStart });
  L = U.tabLayout({ widths: W(3), avail: 900, active: 2, anchor: 'start' });
  ok(L.mode === 'fit' && L.hidden.length === 0, 'few boards: everything fits, no «+N ▾»', L.mode);
  L = U.tabLayout({ widths: W(40), avail: 900, active: 0, anchor: 'end' });
  ok(L.visible.includes(39) && L.visible[0] === 0, 'anchor «end» still available in the API (2.6.11.1 behaviour)', L.visible);
  const look = read('app/js/v26/look2611.js');
  ok(/anchor: 'start'/.test(look) && /has-active/.test(look) && /tabs_active_in_menu/.test(look), 'TabStrip: anchor start, «+N ▾» highlighted (has-active) + aria text when the active board is in it');
  // 2.6.12.1: the «+N ▾» rows moved to tabs26121.js (× / right-click / drag); the same marks are checked there
  const tabs = fs.existsSync(path.join(R, 'app/js/v26/tabs26121.js')) ? read('app/js/v26/tabs26121.js') : look;
  ok(/tm-item' \+ \(b\.id === act \? ' on' : ''\)/.test(tabs) && /title: b\.name/.test(tabs) && /aria-current/.test(tabs), 'menu: active row marked (.on, aria-current), full name in the tooltip');
  ok(/more\.addEventListener\('keydown'[\s\S]{0,260}has-active[\s\S]{0,200}nav\(e, i, false\)/.test(look), 'keyboard: ←/→/Home/End keep working on «+N ▾» when the active board is in it');
  const css = read('app/v2612.css');
  ok(/\.mi[^{]*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis|text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/.test(css), 'menu titles: one line + ellipsis (CSS)');
  ok(/\.tab\.narrow\.on \.tab-count\{display:inline-flex\}/.test(css), 'narrow active tab keeps its card count');
  const zone = read('app/index.html');
  ok(/id="tabs"[\s\S]*id="btn-add-tab"[\s\S]*id="tabs-more"/.test(zone), 'order kept: tabs → «+» → «+N ▾»');
}

// ---- 2) palette ----
{
  ok(V.hsvToHex(0, 1, 1) === '#FF0000' && V.hsvToHex(120, 1, 1) === '#00FF00' && V.hsvToHex(240, 1, 1) === '#0000FF' && V.hsvToHex(0, 0, 1) === '#FFFFFF' && V.hsvToHex(0, 0, 0) === '#000000', 'hsvToHex: primaries, white, black');
  const rt = ['#FF4D6D', '#22D3EE', '#9BE15D', '#7C8CFF', '#A0522D', '#123456'].every((c) => { const x = V.hexToHsv(c); return V.hsvToHex(x.h, x.s, x.v) === c; });
  ok(rt, 'hexToHsv → hsvToHex round trip');
  ok(V.hexToHsv('bad') === null && V.hexToHsv('#ABC').v === 0xCC / 255 && V.hexToHsv('') === null, 'hexToHsv: invalid → null, #RGB accepted');
  ok(U.toHex('bad') === null && U.toHex('#abc') === '#AABBCC', '3-digit hex needs «#» (pushRecent(\'bad\') no longer becomes #BBAADD)');
  const tools = read('app/js/tools.js');
  const pen = tools.slice(tools.indexOf('penOpts('), tools.indexOf('openPicker('));
  ok(pen.length > 500 && !/this\.opts\(\)/.test(pen.slice(pen.indexOf('const setColor'), pen.indexOf('const setColor') + 1600)), 'root-cause fix: setColor never calls this.opts() (the flyout is not rebuilt while picking)');
  ok(/opts\.recent === false/.test(tools) && /fillRecent/.test(tools) && /refresh\(/.test(tools), 'in-place refresh: live change vs final change (recent list updated once)');
  ok(/openPicker\(/.test(tools) && /closePicker\(/.test(tools) && /pk-sv/.test(tools) && /pk-hue/.test(tools), 'in-app palette (SV square + hue) that stays open next to the flyout');
  ok(/if \(this\._picker\) this\.closePicker\(\);/.test(tools), 'switching tool closes the palette');
  ok(/re-place it when the recent row appears/.test(tools) && /Flyout\.place\(\)/.test(tools), 'the flyout is re-placed when the recent row appears (in place, no rebuild)');
  ok(/colorInput\(/.test(read('app/js/panels.js')) || /colorInput\(/.test(tools), 'colorInput() kept for the card colour pop (not affected: its input stays connected)');
}

// ---- 3) Library keyboard ----
{
  ok(V.libGridMove(-1, 100, 8, 'ArrowRight') === 0 && V.libGridMove(0, 100, 8, 'ArrowDown') === 8 && V.libGridMove(8, 100, 8, 'ArrowUp') === 0 && V.libGridMove(0, 100, 8, 'ArrowUp') === 0, 'grid: → / ↓ / ↑ with 8 columns');
  ok(V.libGridMove(99, 100, 8, 'ArrowRight') === 99 && V.libGridMove(95, 100, 8, 'ArrowDown') === 95 && V.libGridMove(5, 100, 8, 'End') === 99 && V.libGridMove(50, 100, 8, 'Home') === 0, 'grid: edges, Home / End');
  ok(V.libGridMove(3, 100, 8, 'x') === 3 && V.libGridMove(0, 0, 8, 'ArrowRight') === -1, 'non-nav keys / empty grid');
  const d = { drawerOpen: true };
  ok(V.libShortcut({ ...d, key: '/' }) === 'focus-search' && V.libShortcut({ ...d, key: '/', typingElsewhere: true }) === null && V.libShortcut({ key: '/' }) === null, '«/» focuses search only with the drawer open and nobody typing elsewhere');
  ok(V.libShortcut({ ...d, key: 'Enter' }) === 'insert' && V.libShortcut({ ...d, key: 'ArrowDown', inSearch: true }) === 'nav' && V.libShortcut({ ...d, key: 'Home', inSearch: true }) === null && V.libShortcut({ ...d, key: 'Enter', ctrlKey: true }) === null, 'Enter inserts; arrows navigate from the search; Home stays in the text field; Ctrl+Enter untouched');
  const panels = read('app/js/panels.js'); const css = read('app/v2612.css');
  ok(/lib-slash/.test(panels) && /aria-keyshortcuts/.test(panels) && /lib-enter/.test(panels) && /data-lib-count/.test(panels), 'Library: «/» hint, aria-keyshortcuts, «Enter εισαγωγή» and the counter in the footer');
  ok(/grid-template-columns:repeat\(8,/.test(css) && /\.lib-tabs2/.test(css) && /nowrap/.test(css), 'Library CSS: 8 columns, tabs never wrap');
}

// ---- 4) Hub ----
{
  const KEY = 'nyx-7f3a9c2b5d8e1f40ab3f';
  const log = [
    'srv  load_model: loading model Qwen3.8-27B-UD-Q4_K_XL',
    'main: server is listening on http://127.0.0.1:8080 --api-key ' + KEY,
    'request: POST /v1/chat/completions Authorization: Bearer ' + KEY,
    'args: --api-key-file C:\\Users\\jo\\AppData\\Roaming\\Nyx\\router.key -c 32768 --models-max 1',
    'GET /v1/models?api_key=' + KEY + '&x=1', 'token=' + KEY + ' password: hunter22', 'hf_abcdefghijklmnop sk-abcdefghijklmnop ghp_abcdefghijkl1234',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGHijkl', 'x-api-key: ' + KEY,
  ].join('\n');
  const red = V.redactLog(log, '[κρυφό]');
  ok(!red.includes(KEY) && !red.includes('ab3f') && !/hunter22|hf_abc|sk-abc|ghp_abc|eyJhbGci/.test(red), 'router log: no key, no part of it (not even the last 4), no tokens / passwords / JWT', red);
  ok(/loading model Qwen3\.8/.test(red) && /-c 32768/.test(red) && /\[κρυφό\]/.test(red) && red.split('\n').length === log.split('\n').length, 'router log: normal lines kept, lines not dropped, translated mark');
  ok(!/router\.key/.test(red), '--api-key-file path hidden too');
  ok(V.quantOf('Qwen3.8-27B-UD-Q4_K_XL.gguf') === 'Q4_K_XL' && V.quantOf('llama-krikri-8b-instruct-q8_0') === 'Q8_0' && V.quantOf('gemma-4-12B-it-Q4_0') === 'Q4_0' && V.quantOf('x-IQ3_XXS') === 'IQ3_XXS' && V.quantOf('model-BF16') === 'BF16' && V.quantOf('plain') === null, 'quantOf: Q4_K_XL, Q8_0, Q4_0, IQ3_XXS, BF16, none');
  let c = V.modelChips({ id: 'Qwen3.8-27B-UD-Q4_K_XL', bytes: 16.2e9, ctx: 32768, tps: 58.2, vramGB: 18.2, port: 8080, loaded: true }, 'el');
  ok(c.map((x) => x.v).join('|') === 'Q4_K_XL|16,2 GB|ctx 32K|58,2 t/s|VRAM 18,2|:8080', 'chips from real data (loaded: + port)', c.map((x) => x.v));
  c = V.modelChips({ id: 'unknown-model', bytes: 0 }, 'el');
  ok(c.every((x) => /—/.test(x.v) && !x.known) && c.length === 5, 'unknown values → «—» (never invented), no port for unloaded', c.map((x) => x.v));
  c = V.modelChips({ id: 'mmproj-Qwen3.8-27B.gguf', mmproj: true, bytes: 0.9e9 }, 'el');
  ok(c.map((x) => x.v).join('|') === 'mmproj|0,9 GB', 'mmproj card: «mmproj» + GB only', c.map((x) => x.v));
  const hub = read('app/js/v2/hub-tabs.js');
  ok(/data-router-key-card/.test(hub) && /proc:routerKeyCopy/.test(hub) && /data-router-port/.test(hub), 'key card (Copy via main) + port card');
  const kc = hub.slice(hub.indexOf('const keyCard ='), hub.indexOf('const routerLog ='));
  ok(kc.length > 100 && !/\.key\b|slice\(-4\)|••••|\u2022/.test(kc), 'key card code never reads or shows the key or a tail of it', kc.match(/\.key\b|slice\(-4\)|••••/g));
  ok(/redactLog/.test(hub) && /data-st[=:]?\s*['"]?router-log|'router-log'/.test(hub), 'router log passes through redactLog');
  ok(/hub-mmproj/.test(hub) && /data-vision-hint/.test(hub) && /hub-chips/.test(hub), 'model cards: chips, vision indicator, mmproj cards');
  const el = JSON.parse(read('app/locales/el.json')), en = JSON.parse(read('app/locales/en.json'));
  const all = JSON.stringify(el) + JSON.stringify(en);
  ok(!/μέγιστο --models-max|max --models-max/.test(el['v2691.stat_loaded_of'] + en['v2691.stat_loaded_of']), 'no «--models-max» in the loaded/max stat', [el['v2691.stat_loaded_of'], en['v2691.stat_loaded_of']]);
  ok(Object.keys(el).filter((k) => k.startsWith('v2612.')).every((k) => en[k]) && Object.keys(el).filter((k) => k.startsWith('v2612.')).length >= 20, 'v2612.* keys in el and en');
  const css = read('app/v2612.css');
  ok(/\.hub-head\{display:none\}/.test(css), 'duplicate Hub head line hidden (the first stat card already says it)');
  ok(all.length > 0, 'locales parse');
}

// ---- 5) flyouts / paper / tooltip ----
{
  const tools = read('app/js/tools.js'); const util = read('app/js/util.js');
  ok(/'data-tip-pre': 'v23\.paper_kind'/.test(tools) && !/fo-label/.test(tools.slice(tools.indexOf("'fo-grid fo-paper'") - 200, tools.indexOf("'fo-grid fo-paper'") + 200)), 'paper kinds: icons only, label in the tooltip (data-tip-pre)');
  ok(/tipPre|data-tip-pre|dataset\.tipPre/.test(util), 'tooltip supports a prefix');
  const ui = read('app/js/v26/ui2611.js');
  ok(/function clampFlyout/.test(ui) && /centred on the\s*\n?\s*\/\/?\s*button|centred on the button/.test(ui), 'flyout centred vertically on its button, clamped (clampFlyout)');
}

// ---- 6) versions / safety ----
{
  const pkg = JSON.parse(read('package.json')); const lock = JSON.parse(read('package-lock.json'));
  ok(['2.6.12', '2.6.12.1', '2.6.12.2', '2.6.13'].includes(pkg.version) && pkg.devDependencies.electron === '45.2.3', 'version 2.6.12, Electron 45.2.3', pkg.version);
  ok(['2.6.12', '2.6.12.1', '2.6.12.2', '2.6.13'].includes(lock.version) && lock.packages[''].version === lock.version, 'package-lock version 2.6.12');
  const CH = JSON.parse(read('CHANGELOG.json'));
  ok(['2.6.12', '2.6.12.1', '2.6.12.2', '2.6.13'].includes(Object.keys(CH)[0]) && CH['2.6.12'].el.length === 3 && CH['2.6.12'].en.length === 3 && CH['2.6.11.1'], 'CHANGELOG 2.6.12 first (3 items), 2.6.11.1 kept');
  let diff = '';
  try { diff = cp.execSync('git diff --name-only fd0e31f -- main/ preload.js app/preload.js 2>/dev/null', { cwd: R }).toString().trim(); } catch (e) { diff = 'ERR'; }
  const V2613 = ['main/voice2613.js', 'main/v2.js', 'main/ipc-guard.js']; // 2.6.13 answer voice: own test (v2613-unit) checks these are additive
  ok(diff.split('\n').filter((f) => f && !V2613.includes(f)).length === 0, 'no main-process / preload change (router & model behaviour untouched; 2.6.13 voice files excepted)', diff);
  const html = read('app/index.html');
  ok(/v2611\.css[\s\S]*v2612\.css/.test(html) && /ui2611\.js[\s\S]*ui2612\.js/.test(html), 'v2612.css / ui2612.js loaded after 2.6.11');
  const files = cp.execSync('git ls-files', { cwd: R }).toString().split('\n').filter((f) => /\.(js|json|css|html|txt|md)$/.test(f) && !f.startsWith('node_modules'));
  const priv = files.filter((f) => { try { return /-----BEGIN (?:EC |ENCRYPTED )?PRIVATE KEY-----/.test(read(f)) && !/tests\//.test(f); } catch (e) { return false; } });
  ok(priv.length === 0, 'no private key in the repo', priv);
  const ch = fs.existsSync(path.join(R, 'tools/accept/ΑΛΛΑΓΕΣ-v2.6.12.txt')) ? read('tools/accept/ΑΛΛΑΓΕΣ-v2.6.12.txt') : '';
  ok(['02', '03', '04', '05', '06', '07', 'καρτέλες'].every((n) => ch.includes(n)) && /μπήκε/.test(ch) && /λείπει/.test(ch) && /αποκλίνει/.test(ch), 'ΑΛΛΑΓΕΣ-v2.6.12: per-screen table «μπήκε / λείπει / αποκλίνει»');
  ok(/αιτία|ΑΙΤΙΑ/.test(ch) && /opts\(\)/.test(ch), 'ΑΛΛΑΓΕΣ-v2.6.12 documents the palette root cause');
}
console.log(`\nv2.6.12 unit: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
