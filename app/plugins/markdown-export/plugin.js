const safe = (s) => String(s || 'κάρτα').replace(/[\\/:*?"<>|#\n\r]/g, ' ').trim().slice(0, 60) || 'κάρτα';
const body = (i) => (i.type === 'link' || i.type === 'web') && i.url ? `[${i.title || i.url}](${i.url})` : (i.text || i.title || '');
module.exports = { actions: {
  async one(a, nyx) { const s = await nyx.board.snapshot(); const its = s.items.filter(i => !['arrow', 'line', 'frame'].includes(i.type)).sort((a, b) => a.y - b.y || a.x - b.x);
    const md = `# ${s.board}\n\n` + its.map(i => `## ${safe(i.title)}\n\n${body(i)}${i.tags.length ? '\n\n' + i.tags.map(t => '#' + t).join(' ') : ''}`).join('\n\n---\n\n') + '\n';
    const p = await nyx.saveFile(safe(s.board) + '.md', md); return p ? 'Αποθηκεύτηκε ✓' : 'Ακυρώθηκε'; },
  async folder(a, nyx) { const s = await nyx.board.snapshot(); const used = {}; const files = s.items.filter(i => !['arrow', 'line', 'frame'].includes(i.type)).map(i => { let n = safe(i.title); if (used[n]) n += ' ' + (++used[n]); else used[n] = 1;
      return { name: n + '.md', content: `---\nnyx_id: ${i.id}\ntype: ${i.type}\ntags: [${i.tags.join(', ')}]\n---\n\n${body(i)}\n` }; });
    const d = await nyx.saveToFolder(files); return d ? files.length + ' αρχεία → ' + d : 'Ακυρώθηκε'; },
} };
