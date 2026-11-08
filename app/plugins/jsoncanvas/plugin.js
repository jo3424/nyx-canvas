function toCanvas(snap) {
  const nodes = [], edges = []; const boxes = [];
  for (const i of snap.items) {
    if (i.type === 'arrow' || i.type === 'line') continue;
    const n = { id: i.id, x: i.x, y: i.y, width: Math.max(40, i.w), height: Math.max(40, i.h) };
    if (/^#[0-9a-f]{6}$/i.test(i.color || '')) n.color = i.color;
    if (i.type === 'frame') Object.assign(n, { type: 'group', label: i.title });
    else if ((i.type === 'link' || i.type === 'web') && i.url) Object.assign(n, { type: 'link', url: i.url });
    else Object.assign(n, { type: 'text', text: (i.type === 'image' || i.type === 'video' || i.type === 'audio' ? '![[' + (i.title || 'media') + ']]\n' : '') + (i.text || i.title || '') + (i.tags && i.tags.length ? '\n\n' + i.tags.map(t => '#' + t).join(' ') : '') });
    nodes.push(n); if (n.type !== 'group') boxes.push(n);
  }
  const hit = (x, y) => boxes.find(b => x >= b.x - 30 && x <= b.x + b.width + 30 && y >= b.y - 30 && y <= b.y + b.height + 30);
  for (const a of snap.items.filter(i => i.type === 'arrow')) { const f = hit(a.x1, a.y1), t = hit(a.x2, a.y2); if (f && t && f !== t) edges.push({ id: a.id, fromNode: f.id, toNode: t.id, toEnd: 'arrow' }); }
  return { nodes, edges };
}
module.exports = { toCanvas, actions: {
  async export(a, nyx) { const s = await nyx.board.snapshot(); const p = await nyx.saveFile((s.board || 'nyx').replace(/[\\/:*?"<>|]/g, '_') + '.canvas', JSON.stringify(toCanvas(s), null, 1)); return p ? 'Αποθηκεύτηκε: ' + p : 'Ακυρώθηκε'; },
  async import(a, nyx) { const f = await nyx.openFile([{ name: 'JSON Canvas', extensions: ['canvas', 'json'] }]); if (!f) return 'Ακυρώθηκε'; const r = await nyx.board.importJson(f.text); return `Νέος πίνακας: ${r.nodes} κάρτες, ${r.edges} βέλη`; },
} };
