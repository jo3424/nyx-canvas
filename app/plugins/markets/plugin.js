module.exports = { cards: { prices: { async refresh(cfg, nyx) {
  const ids = String(nyx.config.ids || 'bitcoin').replace(/\s/g, ''); const vs = nyx.config.vs || 'eur';
  const j = await (await nyx.fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${vs}&include_24hr_change=true`)).json();
  const sym = vs === 'eur' ? '€' : '$';
  const rows = Object.entries(j).map(([k, v]) => { const ch = v[vs + '_24h_change']; return { label: k, value: sym + Number(v[vs]).toLocaleString('el-GR', { maximumFractionDigits: v[vs] < 10 ? 4 : 0 }), sub: ch != null ? (ch >= 0 ? '▲ ' : '▼ ') + ch.toFixed(2) + '% 24ω' : '', color: ch >= 0 ? '#4ade80' : '#ff6b81' }; });
  if (nyx.config.pill && rows[0]) try { nyx.setShared('markets', '₿ ' + rows[0].value + ' ' + (rows[0].sub.split(' ')[1] || '')); } catch (e) {}
  return { title: '📈 Αγορές', rows, footer: 'CoinGecko' };
} } } };
