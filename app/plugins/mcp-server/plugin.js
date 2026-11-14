'use strict';
// Nyx MCP server (HTTP, 127.0.0.1 only, Bearer token). Tools are grouped:
// read / write / delete, each with its own checkbox in the plugin settings.
const GROUPS = {
  read: ['search_cards', 'read_cards', 'board_snapshot', 'list_reminders', 'get_agenda', 'list_boards', 'summarize_board'],
  write: ['create_card', 'update_card', 'move_card', 'create_reminder', 'create_board', 'add_tags', 'link_cards', 'batch', 'group_cards', 'organize_board', 'add_image'],
  del: ['delete_cards'],
};
const GROUP_OF = {};
for (const [g, names] of Object.entries(GROUPS)) for (const n of names) GROUP_OF[n] = g;

const str = { type: 'string' };
const idS = { type: 'string', description: 'Card id (full or unique prefix).' };
const idsS = { type: 'array', items: { type: 'string' }, description: 'Card ids.' };
const tagsS = { type: 'array', items: { type: 'string' } };
const queryS = { type: 'string', description: 'Search text if no id is given.' };
const isoS = { type: 'string', description: 'ISO 8601 date-time. If no time zone is given, Europe/Athens is used.' };
// v2.6.10 — card look (create_card / update_card). Ranges and lists are checked here and again inside Nyx.
const FONTS_L = ['Inter', 'Playpen Sans', 'Mansalva', 'Mynerve', 'Comic Relief', 'Caveat', 'Permanent Marker', 'Comfortaa', 'Arima', 'Noto Serif', 'Roboto Slab', 'Ubuntu', 'JetBrains Mono', 'Tektur', 'Handjet', 'Press Start 2P', 'Dela Gothic One', 'Orbitron'];
const colorS = (what) => ({ type: 'string', description: what + ': #rgb / #rrggbb, or a name (yellow, orange, pink, purple, blue, green, white, dark, red, or the Greek κίτρινο, πορτοκαλί, ροζ, μωβ, μπλε, γαλάζιο, πράσινο, άσπρο/λευκό, σκούρο/μαύρο, κόκκινο).' });
const STYLE_PROPS = {
  w: { type: 'number', minimum: 40, maximum: 3000, description: 'Card width in canvas pixels, 40–3000.' },
  h: { type: 'number', minimum: 30, maximum: 3000, description: 'Card height in canvas pixels, 30–3000.' },
  font: { type: 'string', enum: FONTS_L, description: 'Font family (notes, text, shapes, reminders).' },
  font_size: { type: 'number', minimum: 8, maximum: 160, description: 'Font size in px, 8–160.' },
  color: colorS('Card colour (note paper, shape outline, frame/countdown colour, text colour for text cards)'),
  text_color: colorS('Text colour (notes, text, shapes, reminders)'),
  fill: { type: 'string', description: 'Shape fill (shape cards) or background (text cards): #rgb / #rrggbb, a colour name, or none.' },
  shape: { type: 'string', enum: ['rect', 'ellipse', 'diamond', 'triangle', 'star', 'heart'], description: 'Shape outline (shape cards; create_card kind=shape).' },
  style: { type: 'string', enum: ['classic', 'lined', 'grid', 'dotted', 'kraft', 'index', 'torn', 'polaroid', 'pin', 'glass'], description: 'Paper style of a note (sticky).' },
  align: { type: 'string', enum: ['left', 'center', 'right'], description: 'Text alignment.' },
};

const TOOLS = [
  { name: 'search_cards', description: 'Search Nyx canvas cards (text, tags, captions, transcripts) on the active board or all boards.', inputSchema: { type: 'object', properties: { query: str, all_boards: { type: 'boolean' } }, required: ['query'] } },
  { name: 'read_cards', description: 'Read the full text of cards by ids or query.', inputSchema: { type: 'object', properties: { ids: idsS, id: idS, query: queryS } } },
  { name: 'board_snapshot', description: 'List all cards on the active board with positions, tags and text.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_boards', description: 'List every board (id, name, item counts).', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_reminders', description: 'List reminder cards in an optional date range (ISO). Times are shown in Europe/Athens as well as ISO.', inputSchema: { type: 'object', properties: { from: isoS, to: isoS } } },
  { name: 'get_agenda', description: 'Agenda notes and reminders in an optional date range (ISO). Dates are Europe/Athens; DD/MM is included in the result.', inputSchema: { type: 'object', properties: { from: isoS, to: isoS } } },
  { name: 'summarize_board', description: 'Return a text summary of a board. Changes nothing (no new card is created).', inputSchema: { type: 'object', properties: { board: { type: 'string', description: 'Board name or id; default is the active board.' } } } },
  { name: 'create_card', description: 'Create a card. kind: note|text|checklist|heading|link|reminder|code|frame|shape. Optional look: w/h (40–3000 / 30–3000 px), font, font_size (8–160), color, text_color, fill, shape, style, align. A value outside the range or list is an error (nothing is created). Fields that do not apply to the card type are listed in «ignored».', inputSchema: { type: 'object', properties: { kind: { type: 'string' }, text: str, title: str, url: str, date: isoS, at: isoS, tags: tagsS, x: { type: 'number' }, y: { type: 'number' }, ...STYLE_PROPS }, required: ['kind'] } },
  { name: 'update_card', description: 'Update a card’s text, tags and/or look: w/h (40–3000 / 30–3000 px), font, font_size (8–160), color, text_color, fill, shape, style, align. A value outside the range or list is an error (nothing changes). Never deletes a card.', inputSchema: { type: 'object', properties: { id: idS, ids: idsS, query: queryS, text: str, tags: tagsS, title: str, append: str, add_tags: tagsS, remove_tags: tagsS, ...STYLE_PROPS } } },
  { name: 'move_card', description: 'Move a card to another board and/or to an absolute position (x, y).', inputSchema: { type: 'object', properties: { id: idS, ids: idsS, query: queryS, board: { type: 'string', description: 'Target board name or id.' }, to_board: str, x: { type: 'number' }, y: { type: 'number' }, dx: { type: 'number' }, dy: { type: 'number' } } } },
  { name: 'create_reminder', description: 'Create a reminder card with an absolute date and time (ISO). Notifications fire through the existing Nyx reminder scheduler.', inputSchema: { type: 'object', properties: { text: str, title: str, at: isoS, date: isoS, board: str, tags: tagsS, repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'] }, x: { type: 'number' }, y: { type: 'number' } } } },
  { name: 'create_board', description: 'Create a new board. Does not switch to it unless switch=true.', inputSchema: { type: 'object', properties: { name: str, emoji: str, color: str, switch: { type: 'boolean' } }, required: ['name'] } },
  { name: 'add_tags', description: 'Add tags to one or more cards.', inputSchema: { type: 'object', properties: { id: idS, ids: idsS, query: queryS, tags: tagsS }, required: ['tags'] } },
  { name: 'link_cards', description: 'Connect two cards on the same board with an arrow (from → to).', inputSchema: { type: 'object', properties: { from: idS, to: idS, color: str, title: str }, required: ['from', 'to'] } },
  { name: 'group_cards', description: 'Wrap cards in a titled frame (non-destructive, undoable).', inputSchema: { type: 'object', properties: { ids: idsS, id: idS, query: queryS, tag: str, type: str, title: str, color: str } } },
  { name: 'organize_board', description: 'Lay out the board’s cards by type, tag or date. Does not delete or edit content; undoable.', inputSchema: { type: 'object', properties: { by: { type: 'string', enum: ['type', 'tag', 'date'] }, board: str } } },
  { name: 'add_image', description: 'Add an image card from a local file path (under the user profile or Nyx data folder, images only, 30 MB) or an http(s) URL (public addresses, images only, 30 MB). file:// is rejected.', inputSchema: { type: 'object', properties: { path: str, url: str, file: str, src: str, board: str, title: str, caption: str, tags: tagsS, x: { type: 'number' }, y: { type: 'number' } } } },
  { name: 'batch', description: 'Run several tool calls as one undo step. All actions are validated first. Each inner action must be allowed by the matching permission group. delete_cards still needs an in-Nyx confirmation. If an action fails after others ran, Nyx asks the user whether to roll back: rollback = rolled_back (user OK), kept (user said no) or kept_timeout (no answer: nothing is changed or deleted, the result says so in «note»). Cards are never deleted without the user’s explicit OK.', inputSchema: { type: 'object', properties: { actions: { type: 'array', items: { type: 'object', properties: { tool: str, arguments: { type: 'object' } }, required: ['tool'] } } }, required: ['actions'] } },
  { name: 'delete_cards', description: 'Delete cards after an in-Nyx confirmation dialog (the call waits; declined or timeout if the user does not confirm). Undoable with Ctrl+Z.', inputSchema: { type: 'object', properties: { ids: idsS, id: idS, query: queryS, type: str, tag: str } } },
];
const TOOL_MAP = Object.fromEntries(TOOLS.map(t => [t.name, t]));

function limitsFrom(cfg) {
  const mb = Math.max(0.001, Number(cfg && cfg.maxImageMb != null && cfg.maxImageMb !== '' ? cfg.maxImageMb : 30));
  const min = Math.max(0.1, Number(cfg && cfg.deleteConfirmMin != null && cfg.deleteConfirmMin !== '' ? cfg.deleteConfirmMin : 5));
  return { maxImageMb: mb, maxImageBytes: Math.round(mb * 1048576), deleteConfirmMin: min, deleteConfirmMs: Math.round(min * 60 * 1000) };
}
function fmtLimitMb(mb) {
  return Number.isInteger(mb) ? String(mb) : String(Math.round(mb * 10) / 10);
}
function listedTools(cfg) {
  const lim = limitsFrom(cfg);
  const mb = fmtLimitMb(lim.maxImageMb);
  const minutes = fmtLimitMb(lim.deleteConfirmMin);
  return TOOLS.filter(t => allowed(cfg, t.name)).map(t => {
    if (t.name === 'add_image') return { ...t, description: 'Add an image card from a local file path (under the user profile or Nyx data folder, images only, ' + mb + ' MB) or an http(s) URL (public addresses, images only, ' + mb + ' MB). file:// is rejected. The limit is set in the Nyx MCP plugin settings.' };
    if (t.name === 'delete_cards') return { ...t, description: 'Delete cards after an in-Nyx confirmation dialog (the call waits; declined or timeout after ' + minutes + ' minutes if the user does not confirm). Undoable with Ctrl+Z. The timeout is set in the Nyx MCP plugin settings.' };
    return t;
  });
}
function groupsOn(cfg) {
  return { read: cfg.read !== false, write: !!cfg.write, del: !!(cfg.del || cfg.delete) };
}
function groupOf(name) { return GROUP_OF[name] || null; }
function allowed(cfg, name) {
  const g = groupsOn(cfg);
  if (name === 'batch') return g.read || g.write || g.del;
  const k = groupOf(name);
  if (!k) return false;
  return !!g[k];
}
function denyMsg(name) {
  const k = groupOf(name) || 'write';
  const label = { read: 'Ανάγνωση', write: 'Γραφή', del: 'Διαγραφή' }[k] || k; // i18n-ignore
  return 'Permission denied: the "' + k + '" group (' + label + ') is off for tool ' + name + '. Enable it in the Nyx MCP plugin settings.';
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
function validate(schema, value, path) {
  path = path || '';
  if (!schema || typeof schema !== 'object') return null;
  if (schema.type) {
    const t = schema.type;
    if (t === 'object' && typeOf(value) !== 'object') return path + ': expected object, got ' + typeOf(value);
    if (t === 'array' && typeOf(value) !== 'array') return path + ': expected array, got ' + typeOf(value);
    if (t === 'string' && typeOf(value) !== 'string') return path + ': expected string, got ' + typeOf(value);
    if (t === 'number' && (typeOf(value) !== 'number' || !Number.isFinite(value))) return path + ': expected number, got ' + typeOf(value);
    if (t === 'boolean' && typeOf(value) !== 'boolean') return path + ': expected boolean, got ' + typeOf(value);
    if (t === 'integer' && (typeOf(value) !== 'number' || !Number.isInteger(value))) return path + ': expected integer, got ' + typeOf(value);
  }
  if (typeof value === 'number' && schema.minimum != null && value < schema.minimum) return path + ': must be ≥ ' + schema.minimum + ' (got ' + value + ')';
  if (typeof value === 'number' && schema.maximum != null && value > schema.maximum) return path + ': must be ≤ ' + schema.maximum + ' (got ' + value + ')';
  if (schema.enum && !schema.enum.includes(value)) return path + ': must be one of ' + schema.enum.join(', ');
  if (schema.type === 'object' || schema.properties) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(schema.required)) {
        for (const k of schema.required) if (value[k] === undefined) return (path ? path + '.' : '') + k + ' is required';
      }
      if (schema.properties) {
        for (const [k, v] of Object.entries(value)) {
          if (!schema.properties[k]) continue; // allow unknown keys (forward compatible)
          const err = validate(schema.properties[k], v, (path ? path + '.' : '') + k);
          if (err) return err;
        }
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = validate(schema.items, value[i], path + '[' + i + ']');
      if (err) return err;
    }
  }
  return null;
}
function validateCall(name, args) {
  const tool = TOOL_MAP[name];
  if (!tool) return 'Unknown tool ' + name;
  return validate(tool.inputSchema, args || {}, '');
}
function batchPerms(cfg, actions) {
  if (!Array.isArray(actions)) return 'actions must be an array';
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i] || {};
    const n = a.tool || a.name;
    if (!n) return 'actions[' + i + '] is missing a tool name';
    if (n === 'batch') return 'Nested batch is not allowed';
    if (!TOOL_MAP[n]) return 'Unknown tool ' + n + ' in actions[' + i + ']';
    if (!allowed(cfg, n)) return denyMsg(n) + ' (batch action ' + i + ')';
    const err = validateCall(n, a.arguments || a.args || {});
    if (err) return 'actions[' + i + '] (' + n + '): ' + err;
  }
  return null;
}

let token = '';
const rpc = (id, result) => ({ status: 200, body: { jsonrpc: '2.0', id, result } });
const rerr = (id, code, message, status) => ({ status: status || 200, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } });
const toolOk = (id, value) => rpc(id, { content: [{ type: 'text', text: JSON.stringify(value) }] });
const toolErr = (id, message) => rpc(id, { content: [{ type: 'text', text: String(message) }], isError: true });

async function dispatch(name, args, nyx) {
  const board = nyx.board;
  const opts = { limits: limitsFrom(nyx.config) };
  // search_cards defaults to all boards (same as 2.6.5.1: { all_boards: true, ...args }).
  // Prefer the McpBoard tool name so PluginOps does not fall through to Cmd (active board only, silent cap of 25).
  if (name === 'search_cards') {
    const a = Object.assign({ all_boards: true }, args || {});
    if (typeof board.search_cards === 'function') return await board.search_cards(a, opts);
    return await board.search(a, opts);
  }
  if (name === 'read_cards') {
    if (typeof board.read_cards === 'function') return await board.read_cards(args, opts);
    return await board.read(args, opts);
  }
  if (name === 'board_snapshot') {
    if (typeof board.board_snapshot === 'function') return await board.board_snapshot(args, opts);
    return await board.snapshot(opts);
  }
  if (typeof board[name] === 'function') return await board[name](args, opts);
  throw new Error('Unknown tool ' + name);
}

async function handle(req, nyx) {
  // Desktop MCP clients send no Origin; any Origin means a web page (incl. localhost pages) → refuse.
  if (req.headers.origin) return rerr(null, -32001, 'Forbidden origin', 403);
  // Host must be the loopback address we listen on (blocks DNS-rebinding hosts).
  const port = +nyx.config.port || 7801;
  const host = String(req.headers.host || '').toLowerCase();
  if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port && host !== '[::1]:' + port) return rerr(null, -32001, 'Forbidden host', 403);
  const auth = String(req.headers.authorization || '');
  if (!token || !nyx.safeEqual(auth, 'Bearer ' + token)) return rerr(null, -32001, 'Unauthorized', 401);
  if (!/^\/mcp\/?(\?.*)?$/.test(req.url)) return { status: 404, body: { error: 'use /mcp' } };
  if (req.method === 'GET') return { status: 405, body: { error: 'SSE not supported; use POST' } };
  let m; try { m = JSON.parse(req.body || '{}'); } catch (e) { return rerr(null, -32700, 'Parse error', 400); }
  if (Array.isArray(m)) return rerr(null, -32600, 'Batch not supported', 400);
  if (m.id === undefined) return { status: 202, body: '' };
  if (m.method === 'initialize') return rpc(m.id, { protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'nyx-canvas', version: nyx.appVersion || '2.6.6' } });
  if (m.method === 'ping') return rpc(m.id, {});
  if (m.method === 'tools/list') return rpc(m.id, { tools: listedTools(nyx.config) });
  if (m.method === 'tools/call') {
    const n = m.params && m.params.name, a = (m.params && m.params.arguments) || {};
    if (!n) return toolErr(m.id, 'Missing tool name');
    if (!TOOL_MAP[n]) return rerr(m.id, -32602, 'Unknown tool ' + n);
    if (!allowed(nyx.config, n)) return toolErr(m.id, denyMsg(n));
    if (n === 'batch') {
      const err = batchPerms(nyx.config, a.actions || a.calls || []);
      if (err) return toolErr(m.id, err);
    } else {
      const err = validateCall(n, a);
      if (err) return toolErr(m.id, 'Invalid arguments: ' + err);
    }
    try {
      const r = await dispatch(n, a, nyx);
      nyx.log('tool', n);
      return toolOk(m.id, r);
    } catch (e) { return toolErr(m.id, e.message || e); }
  }
  return rerr(m.id, -32601, 'Method not found');
}

function clientSnippet(url, tok) {
  return JSON.stringify({ mcpServers: { nyx: { url, headers: { Authorization: 'Bearer ' + tok } } } }, null, 2);
}

module.exports = {
  GROUPS, TOOLS, TOOL_MAP, groupsOn, groupOf, allowed, listedTools, limitsFrom, fmtLimitMb, denyMsg, validate, validateCall, batchPerms, handle,
  async activate(nyx) {
    token = nyx.secret.get('token');
    if (!token) { token = nyx.randomId(24); nyx.secret.set('token', token); }
    await nyx.serve(+nyx.config.port || 7801, (req) => handle(req, nyx));
  },
  actions: {
    // The token is shown only in a dialog with a copy button — never written into a canvas card (cards sync / export / reach the AI).
    async info(a, nyx) {
      const url = 'http://127.0.0.1:' + (+nyx.config.port || 7801) + '/mcp';
      return { show: { titleKey: 'v26.mcp_conn_title', noteKey: 'v26.mcp_conn_note', secret: true, text: clientSnippet(url, token) } };
    },
    async rotate(a, nyx) { token = nyx.randomId(24); nyx.secret.set('token', token); return { toastKey: 'v26.mcp_rotated' }; },
  },
};
