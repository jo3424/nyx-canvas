let off = 0, busy = false, iv = null;
async function api(nyx, method, body) {
  const t = nyx.config.token; if (!t) throw new Error('Βάλε το bot token στις ρυθμίσεις');
  const r = await nyx.fetch('https://api.telegram.org/bot' + t + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json(); if (!j.ok) throw new Error(j.description || 'Telegram error'); return j.result;
}
const allowed = (nyx) => String(nyx.config.chatId || '').split(',').map(s => s.trim()).filter(Boolean);
async function poll(nyx) {
  if (busy || !nyx.config.token) return; busy = true;
  try {
    const ups = await api(nyx, 'getUpdates', { offset: off, timeout: 0, allowed_updates: ['message'] });
    for (const u of ups) {
      off = u.update_id + 1; nyx.storage.set('off', off);
      const m = u.message; if (!m || !m.text) continue;
      const ok = allowed(nyx);
      if (!ok.includes(String(m.chat.id))) { nyx.log('αγνοήθηκε chat', m.chat.id); if (!ok.length) await api(nyx, 'sendMessage', { chat_id: m.chat.id, text: 'Το chat id σου: ' + m.chat.id + '\nΒάλ\' το στις ρυθμίσεις του plugin στο Nyx.' }); continue; }
      const t = m.text.trim(); let reply;
      if (/^\/start/.test(t)) reply = '👋 Nyx εδώ. Γράψε σημείωση ή /ask <εντολή>.';
      else if (/^\/(ask|nyx)\b/i.test(t) || nyx.config.mode === 'assistant') { const r = await nyx.assistant(t.replace(/^\/(ask|nyx)\s*/i, '')); reply = (r && r.content) || '✓'; }
      else { await nyx.board.addCard({ kind: 'note', text: t, tags: ['telegram'] }); reply = '📌 Αποθηκεύτηκε στο Nyx'; nyx.notify('Telegram', t.slice(0, 80)); }
      await api(nyx, 'sendMessage', { chat_id: m.chat.id, text: String(reply).slice(0, 4000), reply_to_message_id: m.message_id });
    }
  } catch (e) { nyx.log('poll:', e.message); } finally { busy = false; }
}
module.exports = {
  activate(nyx) { off = nyx.storage.get('off', 0); iv = setInterval(() => poll(nyx), 4000); poll(nyx); },
  deactivate() { clearInterval(iv); },
  actions: {
    async send(a, nyx) { const id = allowed(nyx)[0]; if (!id) throw new Error('Βάλε chat id'); await api(nyx, 'sendMessage', { chat_id: id, text: String(a.text || '').slice(0, 4000) }); return 'Στάλθηκε ✓'; },
    async test(a, nyx) { const me = await api(nyx, 'getMe'); return 'OK: @' + me.username; },
  },
};
