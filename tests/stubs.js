// Stub servers for headless tests: OpenAI-compatible LLM (+embeddings), whisper.cpp /inference, and a tiny website.
const http = require('http');
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function listen(handler) { return new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r({ server: s, port: s.address().port })); }); }
const body = (req) => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const json = (res, o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const log = { chat: [], embed: 0, whisper: 0 };
function embedVec(t) { const v = new Array(64).fill(0); for (const w of norm(t).split(/[^a-z0-9\u0370-\u03ff]+/).filter(Boolean)) { let h = 7; for (const ch of w.slice(0, 5)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; v[h % 64] += 1; } const L = Math.hypot(...v) || 1; return v.map(x => x / L); }
const call = (name, args, i = 0) => ({ id: 'call_' + name + i, type: 'function', function: { name, arguments: JSON.stringify(args) } });
function intent(text) {
  const n = norm(text); let m;
  if ((m = text.match(/^φτιάξε σημείωση για (.+)$/i))) return [call('create_card', { kind: 'note', text: m[1], color: 'yellow' })];
  if ((m = text.match(/^φτιάξε λίστα (.+)$/i))) return [call('create_card', { kind: 'checklist', title: 'Λίστα', text: m[1] })];
  if ((m = text.match(/^σβήσε (?:τις |τα |την |το )?(?:σημειώσεις |σημείωση |κάρτες )?(?:για |με )?(.+)$/i))) return [call('delete_cards', { query: m[1] })];
  if ((m = text.match(/^μάζεψε (?:τα |τις )?(?:σχετικά με |για )?(.+)$/i))) return [call('group_cards', { query: m[1], title: m[1] })];
  if (/^τακτοποίησε/.test(text)) return [call('tidy_board', { by: 'type' })];
  if ((m = text.match(/^δείξε (?:μου )?(?:την |το )?(.+)$/i))) return [call('show_card', { query: m[1] })];
  if ((m = text.match(/^άλλαξε (.+?) σε (.+)$/i))) return [call('update_card', { query: m[1], text: m[2] })];
  if ((m = text.match(/^πρότεινε (\d+) ιδέες για (.+)$/i))) return [call('create_cards', { frame_title: 'Ιδέες: ' + m[2], cards: Array.from({ length: +m[1] }, (_, i) => ({ kind: 'note', text: `Ιδέα ${i + 1} για ${m[2]}` })) })];
  if (/^ψάξε/.test(text)) return [call('search_cards', { query: text.replace(/^ψάξε\s*/, '') })];
  return null;
}
async function startLLM() {
  return listen(async (req, res) => {
    const u = req.url.replace(/^\/v1/, '');
    if (req.method === 'GET' && u === '/models') return json(res, { data: [{ id: 'stub-qwen3.6-35b-a3b' }, { id: 'stub-embed-bge-m3' }] });
    if (u === '/embeddings') { const j = JSON.parse(await body(req)); log.embed++; const inp = Array.isArray(j.input) ? j.input : [j.input]; return json(res, { data: inp.map((t, i) => ({ index: i, embedding: embedVec(t) })) }); }
    if (u === '/chat/completions') {
      const j = JSON.parse(await body(req)); log.chat.push(j); const msgs = j.messages; const last = msgs[msgs.length - 1];
      const reply = (message) => json(res, { model: j.model, choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] });
      if (Array.isArray(last.content) && last.content.some(c => c.type === 'image_url')) return reply({ content: '<think>βλέπω</think>```json\n{"caption":"Μια μπλε τετράγωνη εικόνα δοκιμής","tags":["δοκιμή","μπλε","τετράγωνο"],"text":"NYX"}\n```' });
      if (last.role === 'tool') return reply({ content: 'Έγινε ✓ (' + msgs.filter(m => m.role === 'tool').map(m => m.name).join(', ') + ')' });
      const user = String(last.content || '');
      if (/Αποτελέσματα εργαλείων/.test(user)) return reply({ content: '{"say":"Βρήκα τα αποτελέσματα.","actions":[]}' });
      if (/Μεταγραφή βίντεο με χρόνους/.test(user)) return reply({ content: '[{"t0":0.5,"t1":1.5,"label":"Αρχή"}]' });
      if (/περίληψη|Σύνοψη|συνόψισε/i.test(user) && !j.tools) return reply({ content: 'Περίληψη (stub): ' + user.slice(0, 60) });
      const sys = String(msgs[0]?.content || '');
      // JSON-only mode (no tools sent) — answer with {"say","actions"}
      if (!j.tools && /ΔΕΝ έχεις native tools/.test(sys)) { const calls = intent(user.replace(/^[a-z]+: /, "")) || []; return reply({ content: '```json\n' + JSON.stringify({ say: 'Έγινε (JSON).', actions: calls.map(c => ({ tool: c.function.name, args: JSON.parse(c.function.arguments) })) }) + '\n```' }); }
      if (/^qwen: /.test(user)) { const calls = intent(user.slice(6)) || []; return reply({ content: calls.map(c => `<tool_call>\n{"name":"${c.function.name}","arguments":${c.function.arguments}}\n</tool_call>`).join('\n') }); }
      if (/^json: /.test(user)) { const calls = intent(user.slice(6)) || []; return reply({ content: JSON.stringify({ say: 'Έγινε μέσω JSON fallback.', actions: calls.map(c => ({ tool: c.function.name, args: JSON.parse(c.function.arguments) })) }) }); }
      if (/^notools: /.test(user) && j.tools) return json(res, { error: { message: 'tools not supported by this model' } }, 400);
      const calls = j.tools ? intent(user) : null;
      if (calls) return reply({ content: '', tool_calls: calls });
      return reply({ content: '<think>σκέφτομαι</think>Γεια! Είμαι ο stub βοηθός. Είπες: «' + user.slice(0, 80) + '»' });
    }
    json(res, { error: 'not found' }, 404);
  });
}
async function startWhisper(text = 'φτιάξε σημείωση για το ψωμί') {
  return listen(async (req, res) => {
    if (req.url === '/inference' && req.method === 'POST') { const b = await body(req); log.whisper++; log.lastWhisperBytes = b.length; return json(res, { text: ' ' + text, language: 'el', segments: [{ t0: 0, t1: 120, text: ' Πρώτο κομμάτι.' }, { t0: 120, t1: 250, text: ' Δεύτερο κομμάτι με ' + text + '.' }] }); }
    if (req.url === '/health') return json(res, { status: 'ok' });
    json(res, { error: 'nf' }, 404);
  });
}
async function startSite() {
  return listen((req, res) => {
    if (req.url.startsWith('/login')) { res.writeHead(302, { 'Set-Cookie': 'sess=ok; Path=/; Max-Age=86400', Location: '/' }); return res.end(); }
    const logged = /sess=ok/.test(req.headers.cookie || '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Stub Tracker</title></head><body style="font:16px sans-serif;background:#fff;color:#111;padding:24px"><h1>📦 Stub Tracker</h1><p id="st">${logged ? 'Συνδεδεμένος ✓ — Δέμα: Σε διανομή' : 'Δεν είσαι συνδεδεμένος'}</p><p class="price">Τιμή: 42,00 €</p><a href="/login">Σύνδεση</a></body></html>`);
  });
}
module.exports = { startLLM, startWhisper, startSite, log, embedVec };
if (require.main === module) (async () => { const a = await startLLM(), b = await startWhisper(), c = await startSite(); console.log('llm', a.port, 'whisper', b.port, 'site', c.port); })();
