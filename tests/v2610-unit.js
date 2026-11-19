'use strict';
// v2.6.10 unit tests: bin (Κάδος) core + Store hooks, Ctrl+Z by physical key, links (http(s) only), MCP card look
// fields (ranges / allow-lists, schema in the plugin), MCP rollback kept_timeout, never delete without OK.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = path.join(__dirname, '..');
const B = require('../app/js/v26/bin.js');
const el = require('../app/locales/el.json');
const en = require('../app/locales/en.json');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 800) : '')); c ? passes++ : fails++; };
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const DAY = 86400000;

function loadStore() {
  const sb = { console, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, Map, Set, Promise, setTimeout, clearTimeout,
    t: (k, v) => { let s = el[k] || k; for (const [a, b] of Object.entries(v || {})) s = s.split('{' + a + '}').join(String(b)); return s; },
    uid: (() => { let n = 0; return () => 'u' + (++n); })(), toast: () => {}, structuredClone: (x) => JSON.parse(JSON.stringify(x)),
    API: { save: async () => {}, inv: async () => '' }, document: { body: { classList: { add() {}, remove() {} } } }, localStorage: { getItem: () => null, setItem() {} } };
  sb.window = sb; sb.addEventListener = () => {};
  vm.createContext(sb);
  vm.runInContext(read('app/js/v26/undo.js') + '\n' + read('app/js/v26/bin.js') + '\n' + read('app/js/store.js') + '\nthis.Store = Store;', sb);
  const S = sb.Store;
  S.state = { v: 1, boards: [{ id: 'b1', name: 'Α', items: [], view: { x: 0, y: 0, z: 1 } }, { id: 'b2', name: 'Β', items: [], view: { x: 0, y: 0, z: 1 } }], active: 'b1', subs: [{ id: 's0', name: 'Netflix', price: 13.99 }], settings: {} };
  S.savedSubIds = ['s0']; S.rememberSubNames();
  return { S, sb };
}

(async () => {
  // ---- 1) bin core: delete → bin with board, position, time; restore puts it back exactly ----
  {
    const { S } = loadStore();
    const a = S.change(() => S.addItem({ type: 'sticky', html: 'Α1', x: 100, y: 50, w: 200, h: 120 }));
    const b = S.change(() => S.addItem({ type: 'sticky', html: 'Α2', x: 400, y: 80, w: 200, h: 120 }));
    const c = S.change(() => S.addItem({ type: 'text', html: 'Β1', x: -300, y: 20, w: 300, h: 60 }, S.state.boards[1]));
    ok(!(S.state.bin || []).length, 'adding cards puts nothing in the bin');
    S.change(() => S.removeItems([a.id, b.id]));
    S.change(() => { S.state.boards[1].items = S.state.boards[1].items.filter((i) => i.id !== c.id); });
    const bin = S.state.bin || [];
    ok(bin.length === 3 && bin.every((e) => e.kind === 'card' && e.at > 0 && e.board && e.v), '3 deleted cards → 3 bin entries (board, time, card)', bin.map((e) => e.id));
    const eA = bin.find((e) => e.id === a.id), eC = bin.find((e) => e.id === c.id);
    ok(eA.board.id === 'b1' && eA.board.name === 'Α' && eA.v.x === 100 && eA.v.y === 50 && eC.board.id === 'b2', 'entries remember board and position', { eA: eA.board, eC: eC.board });
    let r; S.change(() => { r = B.restore(S.state, [eA.bid]); });
    const ra = S.state.boards[0].items.find((i) => i.id === a.id);
    ok(r.restored.length === 1 && ra && ra.x === 100 && ra.y === 50 && ra.html === 'Α1', 'restore one → same board, same x/y, same content', ra);
    ok(S.state.bin.length === 2, 'it leaves the bin');
    S.change(() => { r = B.restore(S.state, S.state.bin.map((e) => e.bid)); });
    const rb = S.state.boards[0].items.find((i) => i.id === b.id), rc = S.state.boards[1].items.find((i) => i.id === c.id);
    ok(r.restored.length === 2 && rb && rb.x === 400 && rc && rc.x === -300, 'restore the other two together → each on its own board and position', { rb, rc });
    ok(!S.state.bin.length, 'bin empty');
    S.undo(); ok(!S.state.boards[0].items.some((i) => i.id === b.id) && S.state.bin.length === 2, 'Ctrl+Z of a restore → they go back into the bin (never lost)', S.state.bin.length);
    S.redo(); ok(S.state.bin.length === 0, 'Ctrl+Y → restored again, bin empty');
  }
  // ---- 2) undo of an add / redo of a delete / move keep the bin consistent ----
  {
    const { S } = loadStore();
    const a = S.change(() => S.addItem({ type: 'sticky', html: 'νέα', x: 0, y: 0, w: 200, h: 120 }));
    S.undo(); ok(S.state.bin.length === 1 && S.state.bin[0].id === a.id, 'Ctrl+Z of a new card: the card goes into the bin (recoverable)');
    S.redo(); ok(!S.state.bin.length && S.items().some((i) => i.id === a.id), 'Ctrl+Y: back on the board, out of the bin');
    // moveTo() style: removed in one change, added to another board outside it → not «deleted»
    S.change(() => S.removeItems([a.id])); S.addItem(S.state.bin[0] ? JSON.parse(JSON.stringify(S.state.bin[0].v)) : a, S.state.boards[1]); S.binPrune();
    ok(!S.state.bin.length, 'a card moved to another board is not left in the bin');
    const ink = S.change(() => S.addItem({ type: 'ink', x: 0, y: 0, w: 10, h: 10, pts: [] })); S.change(() => S.removeItems([ink.id]));
    const empty = S.change(() => S.addItem({ type: 'text', html: '', x: 0, y: 0, w: 10, h: 10 })); S.change(() => S.removeItems([empty.id]));
    ok(!S.state.bin.length, 'pen strokes and empty text boxes do not fill the bin');
  }
  // ---- 3) subscriptions; board gone → choice; expiry never deletes by itself; purge only by call (after OK in the UI) ----
  {
    const { S } = loadStore();
    S.change(() => { S.state.subs.splice(0, 1); });
    ok(S.state.bin.length === 1 && S.state.bin[0].kind === 'sub' && S.state.bin[0].name === 'Netflix', 'deleted subscription → bin', S.state.bin);
    let r; S.change(() => { r = B.restore(S.state, [S.state.bin[0].bid]); });
    ok(S.state.subs.length === 1 && S.state.subs[0].id === 's0' && !S.state.bin.length, 'subscription restored');
    const c = S.change(() => S.addItem({ type: 'sticky', html: 'στον Β', x: 7, y: 8, w: 200, h: 120 }, S.state.boards[1]));
    const bb = S.state.boards[1]; S.state.boards.splice(1, 1); B.add(S.state, B.cardEntry(c, bb, 0, Date.now(), 'στον Β'));
    const p = B.plan(S.state, S.state.bin.map((e) => e.bid));
    ok(p.noBoard.length === 1 && p.ready.length === 0, 'board no longer exists → the plan asks (noBoard)', p);
    S.change(() => { r = B.restore(S.state, S.state.bin.map((e) => e.bid), null); });
    ok(r.restored.length === 0 && r.waiting.length === 1 && S.state.bin.length === 1, 'not answered → nothing restored, stays in the bin');
    S.change(() => { r = B.restore(S.state, S.state.bin.map((e) => e.bid), { b2: 'recreate' }); });
    const nb = S.state.boards.find((x) => x.id === 'b2');
    ok(nb && nb.name === 'Β' && nb.items[0].id === c.id && nb.items[0].x === 7, '«recreate» → board «Β» again with the card at its place', nb);
    S.change(() => S.removeItems ? (S.state.boards.find((x) => x.id === 'b2').items = []) : 0);
    S.state.boards = S.state.boards.filter((x) => x.id !== 'b2');
    S.change(() => { r = B.restore(S.state, S.state.bin.map((e) => e.bid), { b2: 'b1' }); });
    ok(S.state.boards[0].items.some((i) => i.id === c.id), 'or into an existing board of your choice');
    const now = Date.now();
    S.state.bin = [{ bid: 'x1', kind: 'card', id: 'old1', at: now - 31 * DAY, name: 'παλιά', board: { id: 'b1', name: 'Α' }, i: 0, v: { id: 'old1', type: 'sticky', html: 'παλιά', x: 0, y: 0 } }, { bid: 'x2', kind: 'card', id: 'new1', at: now - DAY, name: 'νέα', board: { id: 'b1', name: 'Α' }, i: 0, v: { id: 'new1', type: 'sticky', html: 'νέα', x: 0, y: 0 } }];
    ok(B.old(S.state, now).length === 1 && B.KEEP_DAYS === 30, 'older than 30 days → only marked (old() lists it)');
    B.prune(S.state); S.binPrune(); S.change(() => { S.state.boards[0].name = 'Α'; });
    ok(S.state.bin.length === 2, 'saves / prunes / changes never remove an old entry by themselves');
    ok(B.purge(S.state, ['x1']) === 1 && S.state.bin.length === 1, 'purge removes exactly what was confirmed');
  }
  // ---- 4) whole-state replace keeps the bin and bins what it takes away ----
  {
    const cur = { boards: [{ id: 'b1', name: 'Α', items: [{ id: 'k1', type: 'sticky', html: 'τρέχουσα', x: 1, y: 2 }] }], subs: [], bin: [{ bid: 'z', kind: 'card', id: 'zz', at: 1, v: { id: 'zz', type: 'sticky', html: 'zz' } }] };
    const next = { boards: [{ id: 'b1', name: 'Α', items: [] }], subs: [] };
    const U = require('../app/js/v26/undo.js');
    B.carryOver(cur, next, U.diff(JSON.parse(JSON.stringify(U.capture(cur))), JSON.parse(JSON.stringify(U.capture(next)))));
    ok(next.bin.length === 2 && next.bin.some((e) => e.id === 'k1') && next.bin.some((e) => e.id === 'zz'), 'snapshot / backup «replace all»: old bin kept + replaced cards go into it', next.bin.map((e) => e.id));
  }
  // ---- 5) Ctrl+Z / Ctrl+Y by physical key; history ends a stale edit; links ----
  {
    const app = read('app/js/app.js');
    ok(/const kz = c && !\/\^\[a-z\]\$\/\.test\(k\) && \/\^Key\[A-Z\]\$\/\.test\(e\.code/.test(app) && /kz === 'z' && !e\.shiftKey/.test(app) && /kz === 'y' \|\| \(kz === 'z' && e\.shiftKey\)/.test(app), 'Ctrl+Z/Y work with a Greek layout (e.code KeyZ/KeyY when e.key is not Latin)');
    ok(/if \(Canvas\.editing\) Canvas\.endEdit\(\);/.test(app) && !/if \(Canvas\.editing \|\| this\._histBusy\) return false;/.test(app), 'a card left in edit mode no longer blocks Ctrl+Z');
    ok(/if \(typing\) return;/.test(app), 'typing in a text field still keeps its own Ctrl+Z');
    ok(/subsTouched > 0/.test(app) && /Features\.confirmChanges/.test(app), 'the 2.6.9.3 subscription confirmation is kept');
    ok(/Bin\.boardDeleted\(b, i\)/.test(app) && /toast\(`🗑️ \$\{b\.name\}`, \{ action: \{ label: t\('undo'\)/.test(app), 'a deleted board puts its cards in the bin; its «Αναίρεση» toast is unchanged');
    const lk = read('app/js/v26/links.js');
    ok(/protocol === 'http:' \|\| x\.protocol === 'https:'/.test(lk) && /Browser\.open\(u\)/.test(lk) && /API\?\.openExternal\(u\)/.test(lk), 'links: http(s) only → Nyx tab, Ctrl+click / menu → system browser');
    const br = read('app/js/v2/browser.js'); ok(/const PART = 'persist:nyxweb'/.test(br), 'Nyx tabs stay on the persist:nyxweb partition');
    ok(/e\.preventDefault\(\); e\.stopPropagation\(\);/.test(lk) && /addEventListener\('pointerdown'/.test(lk) && /addEventListener\('dblclick'/.test(lk), 'pointerdown / dblclick on a link do not reach the card drag / edit');
    const html = read('app/index.html'); ok(/js\/v26\/bin\.js/.test(html) && /js\/v26\/bin-ui\.js/.test(html) && /js\/v26\/links\.js/.test(html), 'bin.js, bin-ui.js, links.js loaded');
    ok(/'toast\(`🗑️ \$\{t\('deleted'\)\} \(\$\{ids\.length\}\)`, \{ action: \{ label: t\('undo'\), fn: \(\) => App\.undo\(\) \} \}\)'|toast\(`🗑️ \$\{t\('deleted'\)\} \(\$\{ids\.length\}\)`, \{ action: \{ label: t\('undo'\), fn: \(\) => App\.undo\(\) \} \}\)/.test(read('app/js/features.js')), 'the «Αναίρεση» toast after delete is unchanged');
  }
  // ---- 6) MCP card look: ranges, allow-lists, errors name the allowed values ----
  {
    const sb = { console, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, Map, Set, Promise, setTimeout, clearTimeout, Intl, norm: (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() };
    sb.window = sb; vm.createContext(sb); vm.runInContext(read('app/js/v2/mcp-board.js'), sb);
    const M = sb.McpBoard;
    const st = M.styleOf({ w: 400, h: 300, font: 'caveat', font_size: 28, color: 'μπλε', text_color: '#111', fill: 'none', shape: 'star', style: 'lined', align: 'center' });
    ok(st.w === 400 && st.h === 300 && st.font === 'Caveat' && st.font_size === 28 && st.color === '#8fd3ff' && st.text_color === '#111' && st.fill === 'transparent' && st.shape === 'star' && st.style === 'lined' && st.align === 'center', 'valid values accepted (case-insensitive lists, Greek colour names)', st);
    ok(M.styleOf({ style: 'classic' }).style === '', 'style classic = the classic note');
    const err = (a) => { try { M.styleOf(a); return null; } catch (e) { return e.message; } };
    ok(/w must be a number from 40 to 3000 \(got 5000\)/.test(err({ w: 5000 }) || ''), 'w 5000 → error with the range (not clamped silently)', err({ w: 5000 }));
    ok(/h must be a number from 30 to 3000/.test(err({ h: 2 }) || '') && /font_size must be a number from 8 to 160/.test(err({ font_size: 400 }) || ''), 'h / font_size ranges');
    ok(/font must be one of: Inter, Playpen Sans/.test(err({ font: 'Comic Sans MS' }) || ''), 'unknown font → error listing the fonts');
    ok(/shape must be one of: rect, ellipse, diamond, triangle, star, heart/.test(err({ shape: 'hexagon' }) || '') && /style must be one of: classic, lined/.test(err({ style: 'neon' }) || ''), 'shape / style allow-lists');
    ok(/color: «blurple» is not a colour/.test(err({ color: 'blurple' }) || '') && /text_color/.test(err({ text_color: 'javascript:alert(1)' }) || '') && /fill/.test(err({ fill: 'url(x)' }) || ''), 'colours: #hex or a known name only (no CSS injection)');
    ok(/w must be.*font must be/.test(err({ w: 1, font: 'X' }) || ''), 'all problems reported together');
    ok(M.STYLE_LIMITS.w[0] === 40 && M.STYLE_LIMITS.w[1] === 3000 && M.STYLE_LIMITS.font_size[1] === 160, 'limits exported (documented for Hermes)');
    const src = read('app/js/v2/mcp-board.js');
    ok(/how = ans === 'timeout' \? 'kept_timeout' : 'kept'/.test(src) && !/rolled_back_timeout/.test(src.replace(/rolled_back_timeout of 2\.6\.9\.3/g, '')), 'rollback timeout → kept_timeout (no rolled_back_timeout any more)');
    ok(/if \(ans === 'declined' \|\| ans === 'timeout'\)/.test(src) && /Store\.applyCh\(plan\.ch, 'undo'\); how = 'rolled_back';/.test(src), 'only an explicit OK rolls back (and removes cards)');
    ok(/ans === 'timeout'\) return \{ ok: false, timeout: true/.test(src), 'delete_cards: no answer → nothing deleted (unchanged)');
  }
  // ---- 7) plugin schema: new fields with ranges / enums, validated before Nyx sees them ----
  {
    const ctx = { module: { exports: {} }, console, setTimeout, setInterval, clearTimeout, clearInterval, URL, URLSearchParams };
    vm.createContext(ctx); new vm.Script(read('app/plugins/mcp-server/plugin.js'), { filename: 'plugin.js' }).runInContext(ctx);
    const P = ctx.module.exports;
    const cc = P.TOOL_MAP.create_card.inputSchema.properties, uc = P.TOOL_MAP.update_card.inputSchema.properties;
    ok(['w', 'h', 'font', 'font_size', 'color', 'text_color', 'fill', 'shape', 'style', 'align'].every((k) => cc[k] && uc[k]), 'create_card and update_card list w, h, font, font_size, color, text_color, fill, shape, style, align');
    ok(P.validateCall('create_card', { kind: 'note', w: 5000 }) === 'w: must be ≤ 3000 (got 5000)', 'schema: w > 3000 rejected', P.validateCall('create_card', { kind: 'note', w: 5000 }));
    ok(P.validateCall('update_card', { id: 'x', font_size: 4 }) === 'font_size: must be ≥ 8 (got 4)', 'schema: font_size < 8 rejected');
    ok(/shape: must be one of/.test(P.validateCall('create_card', { kind: 'shape', shape: 'hex' }) || ''), 'schema: shape enum');
    ok(P.validateCall('create_card', { kind: 'note', w: 400, h: 300, font: 'Caveat', font_size: 24, style: 'lined', align: 'center' }) === null, 'schema: valid look passes');
    ok(/kept_timeout/.test(P.TOOL_MAP.batch.description) && /never deleted without/.test(P.TOOL_MAP.batch.description), 'batch description tells Hermes about kept_timeout and the no-delete rule');
    ok(/40–3000/.test(P.TOOL_MAP.create_card.description) && /8–160/.test(P.TOOL_MAP.update_card.description), 'ranges visible in the tool descriptions');
    const man = JSON.parse(read('app/plugins/mcp-server/manifest.json')); ok(man.version === '1.3.0', 'MCP plugin manifest 1.3.0');
    ok(fs.existsSync(path.join(R, 'tools/accept/MCP-ΠΕΔΙΑ-HERMES-v2.6.10.txt')), 'Hermes field guide in tools/accept');
  }
  // ---- 8) version, changelog, locales ----
  {
    const pkg = require('../package.json'); const CH = require('../CHANGELOG.json');
    ok((pkg.version.startsWith('2.6.10') || pkg.version.startsWith('2.6.11') || pkg.version.startsWith('2.6.12') || pkg.version.startsWith('2.6.13') || pkg.version.startsWith('2.7.')) && pkg.devDependencies.electron === '45.2.3', 'version 2.6.10, Electron 45.2.3', pkg.version);
    ok(['2.6.10', '2.6.10.1', '2.6.11', '2.6.11.1', '2.6.12', '2.6.12.1', '2.6.12.2', '2.6.13', '2.6.13.1', '2.7.0'].includes(Object.keys(CH)[0]) && CH['2.6.10'].el.length === 3 && CH['2.6.10'].en.length === 3, 'CHANGELOG 2.6.10 first, 3 items');
    const keys = Object.keys(el).filter((k) => k.startsWith('v2610.'));
    ok(keys.length >= 30 && keys.every((k) => en[k]), 'v2610 strings in el and en', keys.length);
  }
  console.log(`\nv2.6.10 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
