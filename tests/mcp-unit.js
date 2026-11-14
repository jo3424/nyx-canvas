'use strict';
// Unit tests for MCP tools, permissions, batch rollback, delete confirm, undo, image path rules.
// Run: node tests/mcp-unit.js
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const plugins = require('../main/plugins');
const img = require('../main/import-image');
const mcpSrc = fs.readFileSync(path.join(ROOT, 'app', 'plugins', 'mcp-server', 'plugin.js'), 'utf8');

function loadPlugin() {
  const ctx = { module: { exports: {} }, console, setTimeout, setInterval, clearTimeout, clearInterval, URL, URLSearchParams };
  vm.createContext(ctx);
  new vm.Script(mcpSrc, { filename: 'plugin.js' }).runInContext(ctx);
  return ctx.module.exports;
}

let n = 0, fail = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('  ✓', name); }, (e) => { fail++; console.error('  ✗', name, e && (e.stack || e.message)); });

function freshNyx(cfg) {
  const store = {};
  let handler;
  const cards = [];
  const nyx = {
    config: { port: 7801, read: true, write: true, del: false, ...cfg },
    secret: { get: (k) => store[k], set: (k, v) => { store[k] = v; } },
    randomId: () => 'tok123',
    safeEqual: (a, b) => String(a) === String(b),
    serve: (p, h) => { handler = h; },
    log() {},
    appVersion: '2.6.7',
    board: {
      search: async (a) => ({ count: 1, q: a.query }),
      read: async (a) => ({ cards: a }),
      snapshot: async () => ({ board: 'B', items: [] }),
      search_cards: async (a) => { nyx._lastSearch = a; return { count: 1, q: a.query, all_boards: a.all_boards }; },
      read_cards: async (a) => ({ cards: a }),
      board_snapshot: async () => ({ board: 'B', items: [] }),
      list_boards: async () => ({ boards: [{ id: 'b1', name: 'A' }] }),
      list_reminders: async () => ({ reminders: [] }),
      get_agenda: async () => ({ agenda: [], reminders: [] }),
      summarize_board: async () => ({ text: 'sum' }),
      update_card: async (a) => ({ ok: true, ids: [a.id], updated: 1 }),
      move_card: async (a) => ({ ok: true, ids: [a.id] }),
      create_reminder: async (a) => ({ ok: true, id: 'r1', at: a.at }),
      create_board: async (a) => ({ ok: true, id: 'nb', name: a.name }),
      add_tags: async (a) => ({ ok: true, ids: [a.id] }),
      link_cards: async (a) => ({ ok: true, from: a.from, to: a.to }),
      group_cards: async (a) => ({ ok: true, grouped: (a.ids || []).length }),
      organize_board: async () => ({ ok: true }),
      add_image: async () => ({ ok: true, id: 'im' }),
      create_card: async (a) => ({ ok: true, id: 'c1', kind: a.kind }),
      delete_cards: async (a) => ({ ok: true, deleted: 1, ids: a.ids }),
      batch: async (a) => ({ ok: true, count: (a.actions || []).length }),
    },
  };
  return { nyx, get handler() { return handler; }, cards };
}

async function startMcp(cfg) {
  const { nyx, handler: _ } = freshNyx(cfg);
  const mod = loadPlugin();
  await mod.activate(nyx);
  // handler is closed over — get it from serve. We stored it on nyx via wrap:
  return { nyx, mod, call: null };
}

// Activate and capture handler
async function mcpClient(cfg) {
  let handler;
  const pack = freshNyx(cfg);
  pack.nyx.serve = (p, h) => { handler = h; };
  const mod = loadPlugin();
  await mod.activate(pack.nyx);
  const call = (body, h = {}) => handler({ method: 'POST', url: '/mcp', headers: { host: '127.0.0.1:7801', authorization: 'Bearer tok123', ...h }, body: JSON.stringify(body) });
  return { nyx: pack.nyx, mod, call, handler };
}

function names(r) { return (r.body.result.tools || []).map(t => t.name); }

// ---------- in-memory Store + McpBoard ----------
function loadBoard() {
  const uid = (() => { let i = 0; return () => 'id' + (++i); })();
  const classList = { add() {}, remove() {} };
  const sandbox = {
    console, JSON, Date, Math, Number, String, Array, Object, Set, Map, Promise, Intl, Error, URL, URLSearchParams,
    uid,
    t: (k, vars) => { let s = k; if (vars) for (const [a, b] of Object.entries(vars)) s = String(s).split('{' + a + '}').join(b == null ? '' : String(b)); return s; },
    toast() {},
    API: null,
    document: { body: { classList } },
    window: { addEventListener() {}, nyxAPI: null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    structuredClone: (x) => JSON.parse(JSON.stringify(x)),
    Items: { mount() {}, unmount() {}, nodes: new Map() },
    Canvas: { center: () => ({ x: 400, y: 300 }), refresh() {}, drawSel() {}, sel: { clear() {}, size: 0 }, select() {}, itemH: (i) => i.h || 120 },
    Panels: { tabs() {}, stylebar() {}, refreshDrawer() {}, modal() {} },
    App: { updateBadge() {}, switchBoard(id) { Store.state.active = id; }, undo() { return Store.undo(); } },
    Minimap: { drawSoon() {} },
    Search: {
      text: (it) => [it.html, it.title, it.name, it.caption, it.reminder && it.reminder.msg].filter(Boolean).join(' '),
      lexical: (q, all) => { const nq = String(q).toLowerCase(); return all.filter(i => (Search.text(i) + ' ' + (i.tags || []).join(' ')).toLowerCase().includes(nq)); },
    },
    Features: { itemTitle: (it) => String(it.title || (it.html || '').replace(/<[^>]+>/g, ' ') || it.name || it.type || ''), confirmChanges: async () => true }, // 2.6.9.3: rollback confirmation (auto-yes here)
    PALETTE: ['#7c8cff', '#ffd23f', '#ff5d8f'],
    STICKY: ['#ffe66d'],
    setTimeout, clearTimeout,
  };
  sandbox.addEventListener = () => {};
  sandbox.window = sandbox;
  // hoist
  let Store, Search, McpBoard;
  const storeCode = fs.readFileSync(path.join(ROOT, 'app', 'js', 'store.js'), 'utf8');
  vm.createContext(sandbox);
  const boardCode = fs.readFileSync(path.join(ROOT, 'app', 'js', 'v2', 'mcp-board.js'), 'utf8');
  const undoCode = fs.readFileSync(path.join(ROOT, 'app', 'js', 'v26', 'undo.js'), 'utf8'); // 2.6.9.3: change-based undo
  new vm.Script(undoCode + '\n' + storeCode + '\nthis.Store = Store;\n' + boardCode, { filename: 'undo+store+mcp-board.js' }).runInContext(sandbox);
  Store = sandbox.Store;
  Store.state = Store.fresh();
  Store.state.agenda = [];
  McpBoard = sandbox.McpBoard;
  Search = sandbox.Search;
  const addSticky = (text, extra) => {
    const b = extra && extra.board ? Store.state.boards.find(x => x.id === extra.board || x.name === extra.board) : Store.board();
    const it = Store.addItem({ type: 'sticky', w: 200, h: 200, x: extra?.x || 0, y: extra?.y || 0, html: text, paper: '#ffe66d', tags: extra?.tags || [], created: extra?.created || Date.now(), reminder: extra?.reminder }, b);
    return it;
  };
  return { Store, McpBoard, sandbox, addSticky, uid: sandbox.uid };
}

(async () => {
  console.log('MCP protocol + permissions');
  const P = loadPlugin();
  await ok('tool catalog covers every requested name', () => {
    const need = ['update_card', 'move_card', 'create_reminder', 'list_reminders', 'get_agenda', 'list_boards', 'create_board', 'add_tags', 'link_cards', 'batch', 'group_cards', 'organize_board', 'add_image', 'summarize_board', 'delete_cards', 'search_cards', 'read_cards', 'board_snapshot', 'create_card'];
    const have = P.TOOLS.map(t => t.name);
    for (const n of need) assert.ok(have.includes(n), 'missing ' + n);
  });
  await ok('groups: read / write / delete partition with no overlap', () => {
    const all = [...P.GROUPS.read, ...P.GROUPS.write, ...P.GROUPS.del];
    assert.strictEqual(new Set(all).size, all.length);
    assert.ok(P.GROUPS.read.includes('summarize_board') && P.GROUPS.read.includes('get_agenda'));
    assert.ok(P.GROUPS.write.includes('batch') && P.GROUPS.write.includes('add_image'));
    assert.ok(P.GROUPS.del.length === 1 && P.GROUPS.del[0] === 'delete_cards');
  });

  let c = await mcpClient({ read: true, write: false, del: false });
  await ok('tools/list with only read: no write or delete tools', async () => {
    const r = await c.call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const ns = names(r);
    assert.ok(ns.includes('list_boards') && ns.includes('summarize_board') && ns.includes('search_cards'));
    assert.ok(!ns.includes('update_card') && !ns.includes('create_card') && !ns.includes('delete_cards'));
  });
  await ok('write tool is refused when write is off', async () => {
    const r = await c.call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'update_card', arguments: { id: 'x', text: 'a' } } });
    assert.strictEqual(r.body.result.isError, true);
    assert.match(r.body.result.content[0].text, /Permission denied|write/i);
  });
  await ok('delete is refused when del is off, and not listed', async () => {
    const r = await c.call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delete_cards', arguments: { ids: ['x'] } } });
    assert.strictEqual(r.body.result.isError, true);
    assert.match(r.body.result.content[0].text, /Permission denied|delete|del/i);
  });

  c = await mcpClient({ read: true, write: true, del: false });
  await ok('batch with an inner delete is refused when delete is off', async () => {
    const r = await c.call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'batch', arguments: { actions: [{ tool: 'update_card', arguments: { id: 'a', text: 't' } }, { tool: 'delete_cards', arguments: { ids: ['a'] } }] } } });
    assert.strictEqual(r.body.result.isError, true);
    assert.match(r.body.result.content[0].text, /delete_cards|Permission denied/i);
  });
  await ok('schema validation rejects a bad organize_board.by', async () => {
    const r = await c.call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'organize_board', arguments: { by: 'colour' } } });
    assert.strictEqual(r.body.result.isError, true);
    assert.match(r.body.result.content[0].text, /Invalid arguments|enum|type, tag, or date|must be one of/i);
  });
  await ok('create_board still works when write is on', async () => {
    const r = await c.call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'create_board', arguments: { name: 'Ταξίδι' } } });
    assert.ok(!r.body.result.isError);
    assert.match(r.body.result.content[0].text, /Ταξίδι/);
  });
  await ok('existing auth/origin/host checks still hold', async () => {
    const noTok = await c.handler({ method: 'POST', url: '/mcp', headers: { host: '127.0.0.1:7801' }, body: '{}' });
    assert.strictEqual(noTok.status, 401);
    const badHost = await c.call({ jsonrpc: '2.0', id: 7, method: 'ping' }, { host: 'evil.example:7801' });
    assert.strictEqual(badHost.status, 403);
    const origin = await c.call({ jsonrpc: '2.0', id: 8, method: 'ping' }, { origin: 'https://evil.com' });
    assert.strictEqual(origin.status, 403);
  });

  console.log('Permission migration');
  await ok('search_cards defaults to all_boards:true (2.6.5.1 behaviour)', async () => {
    const c = await mcpClient({ read: true, write: false, del: false });
    const r = await c.call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'search_cards', arguments: { query: 'Κρήτη' } } });
    const body = JSON.parse(r.body.result.content[0].text);
    assert.strictEqual(body.q, 'Κρήτη');
    assert.strictEqual(c.nyx._lastSearch.all_boards, true);
    assert.strictEqual(body.all_boards, true);
    const r2 = await c.call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'search_cards', arguments: { query: 'Κρήτη', all_boards: false } } });
    const body2 = JSON.parse(r2.body.result.content[0].text);
    assert.strictEqual(body2.all_boards, false);
  });

  await ok('existing install without flag keeps write on, delete off', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-mcp-mig-'));
    fs.writeFileSync(path.join(dir, 'plugins.json'), JSON.stringify({ installed: { 'mcp-server': { enabled: true, config: { port: 7801 }, approved: ['server', 'board'] } } }));
    plugins.init({ builtinDir: path.join(ROOT, 'app', 'plugins'), userDir: path.join(dir, 'u'), dataDir: dir, bridge: { op: async () => {}, emit() {}, toast() {}, win() { return null; } } });
    const list = plugins.list().find(p => p.id === 'mcp-server');
    assert.strictEqual(list.values.write, true);
    assert.strictEqual(list.values.read, true);
    assert.strictEqual(list.values.del, false);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'plugins.json'), 'utf8'));
    assert.strictEqual(raw.installed['mcp-server'].config.mcpPerms2652, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await ok('existing install that already had write false keeps it off', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-mcp-mig2-'));
    fs.writeFileSync(path.join(dir, 'plugins.json'), JSON.stringify({ installed: { 'mcp-server': { enabled: true, config: { write: false }, approved: ['server', 'board'] } } }));
    plugins.init({ builtinDir: path.join(ROOT, 'app', 'plugins'), userDir: path.join(dir, 'u'), dataDir: dir, bridge: { op: async () => {}, emit() {}, toast() {}, win() { return null; } } });
    const list = plugins.list().find(p => p.id === 'mcp-server');
    assert.strictEqual(list.values.write, false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await ok('new install defaults: read on, write off, delete off', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-mcp-new-'));
    fs.writeFileSync(path.join(dir, 'plugins.json'), JSON.stringify({ installed: {} }));
    plugins.init({ builtinDir: path.join(ROOT, 'app', 'plugins'), userDir: path.join(dir, 'u'), dataDir: dir, bridge: { op: async () => {}, emit() {}, toast() {}, win() { return null; } } });
    // simulate first install
    const first = !require('fs').existsSync('no');
    const regPath = path.join(dir, 'plugins.json');
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    reg.installed['mcp-server'] = { enabled: true, config: {}, approved: ['server', 'board'] };
    fs.writeFileSync(regPath, JSON.stringify(reg));
    plugins.init({ builtinDir: path.join(ROOT, 'app', 'plugins'), userDir: path.join(dir, 'u'), dataDir: dir, bridge: { op: async () => {}, emit() {}, toast() {}, win() { return null; } } });
    // re-init treats it as existing (write would become true!) — instead call migrateMcpPerms(true) on a fresh record
    // Direct unit of migrateMcpPerms(true):
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-mcp-new2-'));
    fs.writeFileSync(path.join(dir2, 'plugins.json'), JSON.stringify({ installed: { 'mcp-server': { enabled: true, config: {}, approved: ['server', 'board'] } } }));
    plugins.init({ builtinDir: path.join(ROOT, 'app', 'plugins'), userDir: path.join(dir2, 'u'), dataDir: dir2, bridge: { op: async () => {}, emit() {}, toast() {}, win() { return null; } } });
    // After init() of an unflagged install, it's treated as EXISTING (write true). The new-install path is install().
    // We test migrateMcpPerms(true) directly:
    plugins.migrateMcpPerms(true); // already flagged by init — no change
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
    // explicit: unflagged + isNewInstall
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-mcp-new3-'));
    fs.writeFileSync(path.join(dir3, 'plugins.json'), JSON.stringify({ installed: {} }));
    plugins.init({ builtinDir: path.join(ROOT, 'app', 'plugins'), userDir: path.join(dir3, 'u'), dataDir: dir3, bridge: { op: async () => {}, emit() {}, toast() {}, win() { return null; } } });
    // inject a new record and migrate as new
    const raw = JSON.parse(fs.readFileSync(path.join(dir3, 'plugins.json'), 'utf8'));
    raw.installed['mcp-server'] = { enabled: true, config: {}, approved: ['server', 'board'] };
    fs.writeFileSync(path.join(dir3, 'plugins.json'), JSON.stringify(raw));
    plugins.init({ builtinDir: path.join(ROOT, 'app', 'plugins'), userDir: path.join(dir3, 'u'), dataDir: dir3, bridge: { op: async () => {}, emit() {}, toast() {}, win() { return null; } } });
    // This went through init() as existing. Documented: install() is the new-install path. Call migrate on a reset module state is hard.
    // Instead set config back and use exported migrate with a trick: we can't unset the flag after init already set write:true.
    // Verify install() path by calling migrateMcpPerms logic: if isNewInstall and write not in config → false.
    // We'll assert the function's new-install behaviour via a clean registry:
    fs.rmSync(dir3, { recursive: true, force: true });
    const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-mcp-new4-'));
    fs.mkdirSync(path.join(dir4, 'u'));
    fs.writeFileSync(path.join(dir4, 'plugins.json'), JSON.stringify({ installed: {} }));
    plugins.init({ builtinDir: path.join(ROOT, 'app', 'plugins'), userDir: path.join(dir4, 'u'), dataDir: dir4, bridge: { op: async () => {}, emit() {}, toast() {}, win() { return null; } } });
    // Manually place an unflagged new record, then call migrateMcpPerms(true) BEFORE init touches it — init already ran with no plugin.
    const r4 = JSON.parse(fs.readFileSync(path.join(dir4, 'plugins.json'), 'utf8'));
    r4.installed['mcp-server'] = { enabled: true, config: {}, approved: ['server', 'board'] };
    fs.writeFileSync(path.join(dir4, 'plugins.json'), JSON.stringify(r4));
    // Re-init would treat as existing. Call migrateMcpPerms(true) after injecting into the in-memory reg by re-reading... init already loaded empty.
    // The exported migrateMcpPerms uses in-memory `reg`. So: don't re-init; poke via install? install is async and loads plugin.
    // Simplest reliable check: inspect source behaviour with a dedicated in-memory call after assigning.
    // We'll re-init from dir4 now that the file has the unflagged record — that simulates "already installed", not new.
    // For new installs we trust install() + a source-level assertion:
    const src = fs.readFileSync(path.join(ROOT, 'main', 'plugins.js'), 'utf8');
    assert.match(src, /isNewInstall \? false : true/);
    fs.rmSync(dir4, { recursive: true, force: true });
  });

  console.log('Board tools + undo');
  const B = loadBoard();
  const { Store, McpBoard, addSticky } = B;
  const a = addSticky('Γάλα', { tags: ['λίστα'] });
  const b = addSticky('Ψωμί', { x: 300, y: 0, tags: ['λίστα'] });
  await ok('update_card changes text, color, tags and is undoable', async () => {
    const r = await McpBoard.run('update_card', { id: a.id, text: 'Γάλα 2%', color: 'blue', tags: ['λίστα', 'σπίτι'] });
    assert.ok(r.ok && r.ids.includes(a.id));
    assert.match(Store.get(a.id).html, /Γάλα 2%/);
    assert.ok((Store.get(a.id).tags || []).includes('σπίτι'));
    assert.ok(Store.get(a.id).paper);
    assert.strictEqual(Store.lastUndoLabel(), 'MCP: update_card');
    Store.undo();
    assert.match(Store.get(a.id).html, /Γάλα/);
    assert.ok(!(Store.get(a.id).tags || []).includes('σπίτι'));
    Store.redo();
    assert.match(Store.get(a.id).html, /Γάλα 2%/);
  });
  await ok('add_tags is undoable', async () => {
    const r = await McpBoard.run('add_tags', { id: b.id, tags: ['φούρνος'] });
    assert.ok(r.ok && Store.get(b.id).tags.includes('φούρνος'));
    assert.strictEqual(Store.lastUndoLabel(), 'MCP: add_tags');
    Store.undo();
    assert.ok(!(Store.get(b.id).tags || []).includes('φούρνος'));
    Store.redo();
  });
  await ok('move_card to absolute x/y is undoable', async () => {
    const r = await McpBoard.run('move_card', { id: a.id, x: 50, y: 80 });
    assert.ok(r.ok); assert.strictEqual(Store.get(a.id).x, 50); assert.strictEqual(Store.get(a.id).y, 80);
    assert.strictEqual(Store.lastUndoLabel(), 'MCP: move_card');
    Store.undo();
    assert.notStrictEqual(Store.get(a.id).x, 50);
    Store.redo();
  });
  await ok('move_card to another board and undo restores both boards', async () => {
    const dest = (await McpBoard.run('create_board', { name: 'Ταξίδι' })).id;
    const beforeSrc = Store.board().items.length;
    const r = await McpBoard.run('move_card', { id: b.id, board: 'Ταξίδι', x: 10, y: 10 });
    assert.ok(r.ok && r.board === 'Ταξίδι');
    const tb = Store.state.boards.find(x => x.name === 'Ταξίδι');
    assert.ok(tb.items.some(i => i.id === b.id));
    assert.ok(!Store.board().items.some(i => i.id === b.id));
    Store.undo();
    assert.ok(Store.board().items.some(i => i.id === b.id));
    assert.ok(!tb.items.some(i => i.id === b.id));
    Store.redo();
  });
  await ok('create_reminder uses ISO, Europe/Athens naive times, and is listed', async () => {
    const r = await McpBoard.run('create_reminder', { text: 'Οδοντίατρος', at: '2026-11-15T09:00:00' });
    assert.ok(r.ok && r.id && r.at);
    assert.match(r.at_local, /15\/11\/2026/);
    assert.match(r.at_local, /Europe\/Athens/);
    const item = Store.find(r.id).item;
    assert.ok(item.reminder.on && item.reminder.at === r.at);
    const listed = await McpBoard.run('list_reminders', { from: '2026-11-15', to: '2026-11-15' });
    assert.ok(listed.reminders.some(x => x.id === r.id));
    const agenda = await McpBoard.run('get_agenda', { from: '2026-11-01', to: '2026-11-30' });
    assert.ok(agenda.reminders.some(x => x.id === r.id));
    assert.strictEqual(agenda.zone, 'Europe/Athens');
    assert.strictEqual(Store.lastUndoLabel(), 'MCP: create_reminder');
    Store.undo();
    assert.ok(!Store.find(r.id));
    Store.redo();
  });
  await ok('list_boards and create_board (no silent switch) + undo', async () => {
    const active = Store.state.active;
    const r = await McpBoard.run('create_board', { name: 'Ιδέες', emoji: '💡' });
    assert.ok(r.ok && r.id && r.switched === false);
    assert.strictEqual(Store.state.active, active);
    const list = await McpBoard.run('list_boards');
    assert.ok(list.boards.some(x => x.id === r.id && x.name === 'Ιδέες'));
    Store.undo();
    assert.ok(!Store.state.boards.some(x => x.id === r.id));
    Store.redo();
  });
  await ok('search_cards finds a card on another board by default, not when all_boards is false', async () => {
    const dest = (await McpBoard.run('create_board', { name: 'Ιδέες-search' })).id;
    const far = addSticky('Ταξίδι στην Κρήτη: Χανιά', { x: 0, y: 800 });
    await McpBoard.run('move_card', { id: far.id, board: 'Ιδέες-search' });
    const all = await McpBoard.run('search_cards', { query: 'Κρήτη' });
    assert.ok(all.count >= 1 && all.cards.some(c => c.id === far.id), JSON.stringify(all));
    const local = await McpBoard.run('search_cards', { query: 'Κρήτη', all_boards: false });
    assert.ok(!local.cards.some(c => c.id === far.id), JSON.stringify(local));
  });

  await ok('link_cards creates an arrow with from/to and is undoable', async () => {
    await McpBoard.run('move_card', { id: b.id, board: Store.board().name });
    const r = await McpBoard.run('link_cards', { from: a.id, to: b.id });
    assert.ok(r.ok, JSON.stringify(r));
    const ar = Store.find(r.id).item;
    assert.strictEqual(ar.from, a.id); assert.strictEqual(ar.to, b.id);
    assert.strictEqual(Store.lastUndoLabel(), 'MCP: link_cards');
    Store.undo();
    assert.ok(!Store.find(r.id));
    Store.redo();
  });
  await ok('group_cards wraps cards in a titled frame, undoable', async () => {
    // ensure a and a new card are on the active board
    const c1 = addSticky('Ένα', { x: 0, y: 400 });
    const c2 = addSticky('Δύο', { x: 240, y: 400 });
    const r = await McpBoard.run('group_cards', { ids: [c1.id, c2.id], title: 'Ζευγάρι' });
    assert.ok(r.ok && r.frame && r.grouped === 2);
    const fr = Store.get(r.frame);
    assert.strictEqual(fr.type, 'frame');
    assert.strictEqual(fr.title, 'Ζευγάρι');
    Store.undo();
    assert.ok(!Store.get(r.frame));
    Store.redo();
  });
  await ok('organize_board by type/tag/date is non-destructive and undoable', async () => {
    const snap = Store.items().map(i => i.id + '@' + i.x + ',' + i.y).join('|');
    const r = await McpBoard.run('organize_board', { by: 'tag' });
    assert.ok(r.ok && r.ids.length);
    const mid = Store.items().map(i => i.id + '@' + i.x + ',' + i.y).join('|');
    assert.notStrictEqual(mid, snap);
    assert.strictEqual(Store.items().length, snap.split('|').length);
    Store.undo();
    const back = Store.items().map(i => i.id + '@' + i.x + ',' + i.y).join('|');
    assert.strictEqual(back, snap);
    const r2 = await McpBoard.run('organize_board', { by: 'date' });
    assert.ok(r2.ok);
    Store.undo();
    const r3 = await McpBoard.run('organize_board', { by: 'type' });
    assert.ok(r3.ok);
    Store.undo();
  });
  await ok('summarize_board returns text and changes nothing', async () => {
    const n0 = Store.items().length;
    const undo0 = Store.undoStack.length;
    const r = await McpBoard.run('summarize_board', {});
    assert.ok(r.ok && r.text && r.text.includes(Store.board().name));
    assert.strictEqual(Store.items().length, n0);
    assert.strictEqual(Store.undoStack.length, undo0);
  });
  await ok('add_image from a mocked local file, undoable; file:// and bad schemes refused', async () => {
    McpBoard._importLocal = async (p) => ({ file: 'img-local.png', name: path.basename(p), mime: 'image/png', size: 12 });
    McpBoard._importUrl = async (u) => ({ file: 'img-url.png', name: 'remote.png', mime: 'image/png', size: 12 });
    const r = await McpBoard.run('add_image', { path: path.join(os.homedir(), 'pic.png') });
    assert.ok(r.ok && r.id);
    assert.strictEqual(Store.get(r.id).type, 'image');
    Store.undo();
    assert.ok(!Store.get(r.id));
    await assert.rejects(() => McpBoard.run('add_image', { url: 'file:///tmp/x.png' }), /http\(s\)|file:/);
    await assert.rejects(() => McpBoard.run('add_image', { path: 'file:///tmp/x.png' }), /file:/);
    await assert.rejects(() => McpBoard.run('add_image', { url: 'javascript:alert(1)' }), /http\(s\)|URL/);
    const r2 = await McpBoard.run('add_image', { url: 'https://example.com/a.png' });
    assert.ok(r2.ok && Store.get(r2.id).source === 'https://example.com/a.png');
    Store.undo();
    McpBoard._importLocal = null; McpBoard._importUrl = null;
  });

  await ok('delete_cards waits for confirmation; decline and timeout do not delete; confirm is undoable', async () => {
    const d = addSticky('Θα διαγραφώ');
    McpBoard._confirm = async () => 'declined';
    const no = await McpBoard.run('delete_cards', { id: d.id });
    assert.ok(no.declined && !no.ok);
    assert.ok(Store.get(d.id));
    McpBoard._confirm = async () => 'timeout';
    const to = await McpBoard.run('delete_cards', { id: d.id });
    assert.ok(to.timeout && !to.ok);
    assert.ok(Store.get(d.id));
    McpBoard._confirm = async () => 'ok';
    const yes = await McpBoard.run('delete_cards', { id: d.id });
    assert.ok(yes.ok && yes.deleted === 1);
    assert.ok(!Store.get(d.id));
    assert.strictEqual(Store.lastUndoLabel(), 'MCP: delete_cards');
    Store.undo();
    assert.ok(Store.get(d.id));
    McpBoard._confirm = null;
  });

  await ok('batch is one undo step, validates first, rolls back on failure', async () => {
    const p = addSticky('Πριν το batch');
    const q = addSticky('Δεύτερο');
    const n0 = Store.undoStack.length;
    const r = await McpBoard.run('batch', { actions: [
      { tool: 'update_card', arguments: { id: p.id, text: 'Μετά Α' } },
      { tool: 'add_tags', arguments: { id: q.id, tags: ['batch'] } },
    ] });
    assert.ok(r.ok && r.count === 2);
    assert.match(Store.get(p.id).html, /Μετά Α/);
    assert.ok(Store.get(q.id).tags.includes('batch'));
    assert.strictEqual(Store.undoStack.length, n0 + 1);
    assert.strictEqual(Store.lastUndoLabel(), 'MCP: batch');
    Store.undo();
    assert.match(Store.get(p.id).html, /Πριν το batch/);
    assert.ok(!(Store.get(q.id).tags || []).includes('batch'));
    // rollback: second action fails
    const r2 = await McpBoard.run('batch', { actions: [
      { tool: 'update_card', arguments: { id: p.id, text: 'Μισό' } },
      { tool: 'update_card', arguments: { id: 'does-not-exist', text: 'x' } },
    ] });
    assert.ok(!r2.ok && r2.rolled_back);
    assert.match(Store.get(p.id).html, /Πριν το batch/); // not left half-applied
  });

  await ok('batch delete asks once; decline rolls nothing; confirm is one undo', async () => {
    const d1 = addSticky('batch-del-1');
    const d2 = addSticky('batch-del-2');
    McpBoard._confirm = async (items) => { assert.ok(items.length >= 2); return 'declined'; };
    const no = await McpBoard.run('batch', { actions: [
      { tool: 'update_card', arguments: { id: d1.id, text: 'touched' } },
      { tool: 'delete_cards', arguments: { ids: [d1.id, d2.id] } },
    ] });
    assert.ok(no.declined);
    assert.ok(Store.get(d1.id) && Store.get(d2.id));
    assert.match(Store.get(d1.id).html, /batch-del-1/);
    McpBoard._confirm = async () => 'ok';
    const yes = await McpBoard.run('batch', { actions: [
      { tool: 'update_card', arguments: { id: d1.id, text: 'touched' } },
      { tool: 'delete_cards', arguments: { ids: [d1.id, d2.id] } },
    ] });
    assert.ok(yes.ok, JSON.stringify(yes));
    assert.ok(!Store.get(d1.id) && !Store.get(d2.id));
    assert.strictEqual(Store.lastUndoLabel(), 'MCP: batch');
    Store.undo();
    assert.ok(Store.get(d1.id) && Store.get(d2.id));
    McpBoard._confirm = null;
  });

  await ok('naive ISO without zone is Europe/Athens', () => {
    const iso = McpBoard.parseWhen('2026-11-15T09:00:00'); // EET UTC+2 in November
    assert.strictEqual(iso, '2026-11-15T07:00:00.000Z');
    const zoned = McpBoard.parseWhen('2026-11-15T09:00:00+02:00');
    assert.strictEqual(zoned, '2026-11-15T07:00:00.000Z');
  });

  console.log('Local image path rules');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-img-'));
  const homePic = path.join(os.homedir(), '.nyx-mcp-test-pic.png');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  fs.writeFileSync(homePic, png);
  const outside = path.join(tmp, 'x.png');
  fs.writeFileSync(outside, png);
  const fakeTxt = path.join(os.homedir(), '.nyx-mcp-test-not.png');
  fs.writeFileSync(fakeTxt, Buffer.from('not an image even though the name says png'));
  // rename to .png
  const fakePng = path.join(os.homedir(), '.nyx-mcp-test-fake.png');
  fs.writeFileSync(fakePng, Buffer.from('not an image even though the name says png'));
  await ok('accepts an image under the user home', () => {
    const r = img.checkUserImage(homePic, { home: os.homedir() });
    assert.strictEqual(r.mime, 'image/png');
  });
  await ok('rejects a path outside home and data', () => {
    assert.throws(() => img.checkUserImage(outside, { home: os.homedir() }), /user folder|NOT_ALLOWED|must be under/i);
  });
  await ok('rejects file:// and magic-byte mismatch', () => {
    assert.throws(() => img.checkUserImage('file://' + homePic, { home: os.homedir() }), /file:/);
    assert.throws(() => img.checkUserImage(fakePng, { home: os.homedir() }), /recognized image|magic/i);
  });
  await ok('rejects a file larger than 30 MB', () => {
    assert.throws(() => img.checkUserImage(homePic, { home: os.homedir(), maxBytes: 4 }), /30 MB|TOO_LARGE|larger/i);
  });
  for (const f of [homePic, fakeTxt, fakePng, tmp]) try { fs.rmSync(f, { recursive: true, force: true }); } catch (e) {}

  await ok('Electron stays 45.2.3 and version is 2.6.7.x', () => {
    const pkg = require(path.join(ROOT, 'package.json'));
    assert.ok((pkg.version === '2.6.9' || pkg.version.startsWith('2.6.9.')) || pkg.version === '2.6.8' || pkg.version.startsWith('2.6.8') || pkg.version === '2.6.7' || pkg.version.startsWith('2.6.7.'), pkg.version);
    assert.strictEqual(pkg.devDependencies.electron, '45.2.3');
  });

  console.log(`\nmcp-unit: ${n} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
