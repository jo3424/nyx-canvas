module.exports = { cards: { models: { async refresh(cfg, nyx) {
  let u = 'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=20'; if (nyx.config.filter) u += '&filter=' + encodeURIComponent(nyx.config.filter); if (nyx.config.search) u += '&search=' + encodeURIComponent(nyx.config.search);
  const j = await (await nyx.fetch(u)).json(); if (!Array.isArray(j)) throw new Error(j.error || 'HF error');
  const k = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0);
  return { title: '🤗 Trending' + (nyx.config.filter ? ' · ' + nyx.config.filter : ''), rows: j.map(m => ({ label: m.id || m.modelId, url: 'https://huggingface.co/' + (m.id || m.modelId), value: '♥ ' + k(m.likes), sub: [m.pipeline_tag, '⬇ ' + k(m.downloads)].filter(Boolean).join(' · ') })) };
} } } };
