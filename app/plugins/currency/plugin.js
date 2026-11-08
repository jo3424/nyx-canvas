async function get(nyx, from, to) {
  for (const base of ['https://api.frankfurter.dev/v1/latest', 'https://api.frankfurter.app/latest']) { try { const r = await nyx.fetch(`${base}?base=${from}&symbols=${to}`); if (r.ok) return await r.json(); } catch (e) { nyx.log(base, e.message); } }
  throw new Error('Δεν απαντά το Frankfurter');
}
module.exports = {
  cards: { rates: { async refresh(cfg, nyx) { const b = (nyx.config.base || 'EUR').toUpperCase(); const j = await get(nyx, b, String(nyx.config.to || 'USD').toUpperCase().replace(/\s/g, '')); return { title: '💱 1 ' + b, rows: Object.entries(j.rates).map(([k, v]) => ({ label: k, value: v.toLocaleString('el-GR', { maximumFractionDigits: 4 }) })), footer: 'ΕΚΤ · ' + j.date }; } } },
  actions: { async convert(a, nyx) { const f = String(a.from || 'EUR').toUpperCase(), t = String(a.to || 'USD').toUpperCase(); const j = await get(nyx, f, t); const v = (+a.amount || 0) * j.rates[t]; return `${a.amount} ${f} = ${v.toLocaleString('el-GR', { maximumFractionDigits: 2 })} ${t}`; } },
};
