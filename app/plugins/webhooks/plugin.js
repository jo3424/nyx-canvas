let token = '';
module.exports = {
  activate(nyx) {
    token = nyx.secret.get('token'); if (!token) { token = nyx.randomId(20); nyx.secret.set('token', token); }
    nyx.serve(+nyx.config.port || 7802, async (req) => {
      if (req.headers.origin) return { status: 403, body: { error: 'forbidden' } };
      if ((req.headers.authorization || '') !== 'Bearer ' + token) return { status: 401, body: { error: 'unauthorized' } };
      if (req.method !== 'POST') return { status: 405, body: { error: 'POST only' } };
      let b = {}; try { b = JSON.parse(req.body || '{}'); } catch (e) { b = { text: req.body }; }
      if (/^\/note/.test(req.url)) { const r = await nyx.board.addCard({ kind: b.kind || (b.url ? 'link' : 'note'), text: String(b.text || ''), url: b.url, tags: ['webhook', ...(b.tags || [])] }); return { body: r }; }
      return { status: 404, body: { error: 'use /note' } };
    });
    nyx.on('card', async (c) => { const u = nyx.config.out; if (!u || !/^https?:/.test(u)) return; try { await nyx.fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'card', card: c }) }); } catch (e) { nyx.log('out', e.message); } });
  },
  actions: { async info(a, nyx) { return { card: { kind: 'code', text: `curl -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d "{\\"text\\":\\"Γεια από webhook\\"}" http://127.0.0.1:${+nyx.config.port || 7802}/note`, tags: ['webhook'] } }; } },
};
