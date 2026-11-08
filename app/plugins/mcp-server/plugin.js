const TOOLS = [
  { name: 'search_cards', description: 'Search Nyx canvas cards (text, tags, captions, transcripts).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, all_boards: { type: 'boolean' } }, required: ['query'] } },
  { name: 'read_cards', description: 'Read full text of cards by ids or query.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, query: { type: 'string' } } } },
  { name: 'board_snapshot', description: 'List all cards on the active board with positions.', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_card', description: 'Create a card. kind: note|text|checklist|heading|link|reminder|code.', inputSchema: { type: 'object', properties: { kind: { type: 'string' }, text: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' }, date: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['kind'] } },
];
let token = '';
const rpc = (id, result) => ({ status: 200, body: { jsonrpc: '2.0', id, result } });
const rerr = (id, code, message, status) => ({ status: status || 200, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } });
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
  if (m.method === 'initialize') return rpc(m.id, { protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'nyx-canvas', version: nyx.appVersion || '2.6.0' } });
  if (m.method === 'ping') return rpc(m.id, {});
  if (m.method === 'tools/list') return rpc(m.id, { tools: TOOLS.filter(t => t.name !== 'create_card' || nyx.config.write) });
  if (m.method === 'tools/call') {
    const n = m.params && m.params.name, a = (m.params && m.params.arguments) || {}; let r;
    try {
      if (n === 'search_cards') r = await nyx.board.search({ all_boards: true, ...a }); else if (n === 'read_cards') r = await nyx.board.read(a); else if (n === 'board_snapshot') r = await nyx.board.snapshot();
      else if (n === 'create_card' && nyx.config.write) r = await nyx.board.addCard(a); else return rerr(m.id, -32602, 'Unknown tool ' + n);
      nyx.log('tool', n); return rpc(m.id, { content: [{ type: 'text', text: JSON.stringify(r) }] });
    } catch (e) { return rpc(m.id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true }); }
  }
  return rerr(m.id, -32601, 'Method not found');
}
module.exports = {
  async activate(nyx) { token = nyx.secret.get('token'); if (!token) { token = nyx.randomId(24); nyx.secret.set('token', token); } await nyx.serve(+nyx.config.port || 7801, (req) => handle(req, nyx)); },
  actions: {
    // The token is shown only in a dialog with a copy button — never written into a canvas card (cards sync / export / reach the AI).
    async info(a, nyx) { const url = 'http://127.0.0.1:' + (+nyx.config.port || 7801) + '/mcp'; return { show: { titleKey: 'v26.mcp_conn_title', noteKey: 'v26.mcp_conn_note', secret: true, text: JSON.stringify({ mcpServers: { nyx: { url, headers: { Authorization: 'Bearer ' + token } } } }, null, 2) } }; },
    async rotate(a, nyx) { token = nyx.randomId(24); nyx.secret.set('token', token); return { toastKey: 'v26.mcp_rotated' }; },
  },
};
