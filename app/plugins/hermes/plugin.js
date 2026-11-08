async function call(nyx, prompt) {
  const base = String(nyx.config.url || '').replace(/\/$/, ''); const H = { 'Content-Type': 'application/json' }; if (nyx.config.key) H.Authorization = 'Bearer ' + nyx.config.key;
  const r = await nyx.fetch(base + '/chat/completions', { method: 'POST', headers: H, body: JSON.stringify({ model: nyx.config.model || 'hermes-agent', messages: [{ role: 'user', content: prompt }], stream: false }) });
  if (!r.ok) throw new Error('Hermes HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200)); const j = await r.json(); return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : JSON.stringify(j).slice(0, 2000);
}
module.exports = { actions: {
  async ask(a, nyx) { const t = await call(nyx, String(a.prompt || '')); return { card: { kind: 'text', text: '**Hermes:** ' + t, tags: ['hermes'] } }; },
  async ping(a, nyx) { const base = String(nyx.config.url || '').replace(/\/$/, ''); const r = await nyx.fetch(base + '/models'); return 'HTTP ' + r.status; },
} };
