const TRACK = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|si|ref_src|ref_url|_hsenc|_hsmi|mkt_tok|yclid|vero_id|oly_anon_id|oly_enc_id|rb_clickid|s_cid|spm|scm|share_id|feature|pp|ttclid|twclid|li_fat_id|epik|__s)$/i;
function cleanUrl(u) { try { const x = new URL(u); let n = 0; for (const k of [...x.searchParams.keys()]) if (TRACK.test(k) && !(k === 'feature' && !/youtu/.test(x.host)) && !(k === 'si' && !/youtu|spotify/.test(x.host)) && !(k === 'pp' && !/youtu/.test(x.host))) { x.searchParams.delete(k); n++; } return n ? x.toString().replace(/\?$/, '') : u; } catch (e) { return u; } }
function cat(t) {
  const s = t.trim();
  if (/^https?:\/\/\S+$/i.test(s)) return 'link';
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(s)) return 'email';
  if (/^\+?[\d\s()-]{8,18}$/.test(s) && (s.match(/\d/g) || []).length >= 8) return 'phone';
  if (/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(s)) return 'color';
  if (/^-?[\d.,\s€$%]+$/.test(s)) return 'number';
  if (/[{};]\s*$|^\s*(const|let|var|function|def|class|import|from|#include|public|SELECT|<\w+)/m.test(s) || /=>|\)\s*\{/.test(s)) return 'code';
  return 'text';
}
const ICON = { link: '🔗', email: '✉️', phone: '📞', color: '🎨', number: '🔢', code: '💻', text: '📝' };
let iv, last = '';
const secretish = (s, nyx) => /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[bp]-|AKIA[0-9A-Z]{16}|eyJ[\w-]{20,}\.)/.test(s) || String(nyx.config.ignore || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).some(w => s.toLowerCase().includes(w));
let busy = false;
async function tick(nyx) {
  if (busy) return; busy = true;
  try { await tick2(nyx); } catch (e) { nyx.log('σφάλμα: ' + (e && e.message)); } finally { busy = false; }
}
async function tick2(nyx) {
  let t; try { t = await nyx.clipboard.readText(); } catch (e) { return; } if (typeof t !== 'string' || !t || t === last || t.length > 20000) return; last = t;
  if (secretish(t, nyx)) { nyx.log('αγνοήθηκε (μοιάζει με κωδικό/token)'); return; }
  let c = cat(t), v = t.trim(), stripped = false;
  if (c === 'link') { const cl = cleanUrl(v); if (cl !== v) { stripped = true; v = cl; if (nyx.config.strip) { last = cl; await nyx.clipboard.writeText(cl); } } }
  const h = nyx.storage.get('h', []).filter(x => x.v !== v); h.unshift({ v, c, at: Date.now(), stripped }); nyx.storage.set('h', h.slice(0, 300));
  try { nyx.setShared('clip', ICON[c] + ' ' + (stripped ? 'καθαρό link' : v.slice(0, 28))); } catch (e) {}
}
module.exports = {
  cleanUrl, cat,
  async activate(nyx) { try { last = (await nyx.clipboard.readText()) || ''; } catch (e) {} iv = setInterval(() => tick(nyx), 1200); },
  deactivate() { clearInterval(iv); },
  cards: { inbox: { async refresh(cfg, nyx) { const h = nyx.storage.get('h', []); const counts = {}; h.forEach(x => counts[x.c] = (counts[x.c] || 0) + 1);
    return { title: '📋 Clipboard Inbox', text: Object.entries(counts).map(([k, n]) => ICON[k] + ' ' + n).join('  ') || 'Αντίγραψε κάτι…', rows: h.slice(0, 25).map(x => ({ icon: ICON[x.c], label: x.v.slice(0, 140), url: x.c === 'link' ? x.v : undefined, sub: new Date(x.at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }) + (x.stripped ? ' · 🧹 καθαρίστηκε tracking' : '') })), footer: h.length + ' στοιχεία' }; } } },
  actions: {
    async toBoard(a, nyx) { const h = nyx.storage.get('h', []).slice(0, 10); for (const x of h.reverse()) await nyx.board.addCard(x.c === 'link' ? { kind: 'link', url: x.v } : x.c === 'code' ? { kind: 'code', text: x.v } : { kind: 'note', text: x.v, tags: ['clip-' + x.c] }); return h.length + ' κάρτες'; },
    async list(a, nyx) { return nyx.storage.get('h', []).slice(0, +(a && a.n) || 50); },
    async clear(a, nyx) { nyx.storage.set('h', []); return 'Καθαρίστηκε'; },
    async clean(a) { return cleanUrl(String(a.url || '')); },
  },
};
