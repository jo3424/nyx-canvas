function storyboard(s, secs) {
  const its = s.items.filter(i => !['arrow', 'line', 'ink'].includes(i.type)).sort((a, b) => a.y - b.y || a.x - b.x);
  let t = 0; const sc = its.map((i, n) => { const st = t; t += secs; return `## Σκηνή ${n + 1} · ${st}s–${t}s · ${i.type}\n\n**${i.title || ''}**\n\n${(i.text || '').slice(0, 600)}${i.src ? '\n\nΑρχείο μέσων: `' + i.src + '`' : ''}${i.url ? '\n\nURL: ' + i.url : ''}`; });
  return `# ${s.board} — storyboard από Nyx Canvas\n\nΣυνολική διάρκεια ≈ ${t}s, 1080×1920 (short) εκτός αν ζητηθεί αλλιώς.\nΚάθε σκηνή = μία κάρτα του καμβά, με τη σειρά που φαίνονται (πάνω→κάτω).\n\n` + sc.join('\n\n---\n\n') + '\n';
}
const q = (p) => '"' + String(p).replace(/"/g, '') + '"';
module.exports = { storyboard, actions: {
  async project(a, nyx) {
    const s = await nyx.board.snapshot(); const d = await nyx.saveToFolder([{ name: 'NYX-STORYBOARD.md', content: storyboard(s, +nyx.config.secs || 3) }]); if (!d) return 'Ακυρώθηκε';
    const proj = d + (nyx.platform === 'win32' ? '\\' : '/') + 'nyx-video'; nyx.storage.set('dir', proj);
    let out = ''; try { out = await nyx.exec('npx -y hyperframes init nyx-video', { cwd: d, timeout: 900000 }); } catch (e) { out = '⚠️ ' + e.message; }
    nyx.log(String(out).slice(-1500)); return { card: { kind: 'text', text: `🎬 Project: ${proj}\n\nΆνοιξε τον φάκελο στο Cursor/Claude Code και ζήτα: «Using /hyperframes, make the video from ../NYX-STORYBOARD.md». Μετά πάτα Render.\n\n${String(out).slice(-400)}`, tags: ['hyperframes'] } };
  },
  async preview(a, nyx) { const d = nyx.config.dir || nyx.storage.get('dir'); if (!d) throw new Error('Συμπλήρωσε τον φάκελο project στις ρυθμίσεις'); nyx.exec('npx hyperframes preview', { cwd: d }).catch(e => nyx.log(e.message)); return 'Ξεκίνησε το preview'; },
  async render(a, nyx) { const d = nyx.config.dir || nyx.storage.get('dir'); if (!d) throw new Error('Συμπλήρωσε τον φάκελο project στις ρυθμίσεις'); const out = await nyx.exec('npx hyperframes render', { cwd: d, timeout: 1800000 }); nyx.log(String(out).slice(-2000)); return 'Render ✓ — δες τον φάκελο ' + d; },
} };
