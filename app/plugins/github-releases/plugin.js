module.exports = { cards: { rel: { async refresh(cfg, nyx) {
  const repos = String(nyx.config.repos || '').split(/\s+/).filter(r => /^[\w.-]+\/[\w.-]+$/.test(r)).slice(0, 20); const seen = nyx.storage.get('seen', {}); const rows = [];
  const H = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'NyxCanvas' }; if (nyx.config.token) H.Authorization = 'Bearer ' + nyx.config.token;
  for (const r of repos) { try { const res = await nyx.fetch(`https://api.github.com/repos/${r}/releases?per_page=1`, { headers: H }); const j = await res.json(); const x = Array.isArray(j) ? j[0] : null; if (!x) { rows.push({ label: r, value: '—', sub: j && j.message ? j.message : 'χωρίς releases' }); continue; }
    const isNew = seen[r] && seen[r] !== x.tag_name; if (isNew) nyx.notify('Νέα έκδοση ' + r, x.tag_name); seen[r] = x.tag_name;
    rows.push({ icon: isNew ? '🆕' : '📦', label: r, value: x.tag_name, url: x.html_url, sub: new Date(x.published_at).toLocaleDateString('el-GR') + (x.prerelease ? ' · pre' : '') }); } catch (e) { rows.push({ label: r, value: '⚠️', sub: e.message }); } }
  nyx.storage.set('seen', seen); return { title: '🐙 Releases', rows };
} } } };
