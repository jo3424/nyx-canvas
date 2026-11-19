'use strict';
// v2.6.9.2 UI (Electron, Chromium sandbox on) against a fake llama-server router that ENFORCES Qwen3.8's thinking:
// unless chat_template_kwargs.enable_thinking === false it streams reasoning_content first («preserving reasoning
// enabled») and the content only after REASON_N tokens — so with max_tokens 400 the content is empty (finish_reason length).
const { _electron } = require('playwright-core');
const http = require('http');
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2692-'));
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QWEN = 'Qwen3.8-27B-UD-Q4_K_XL';
const REASON_N = 600; // thinking tokens Qwen spends before the answer
const DESC = 'Μια κόκκινη κούπα πάνω σε ξύλινο τραπέζι, δίπλα σε ένα ανοιχτό σημειωματάριο με χειρόγραφο κείμενο.';
// real jpg files (different pixels → different hashes)
const JPG = (n, rgb) => { const f = path.join(DATA, n); execFileSync('python3', ['-c', `from PIL import Image; Image.new('RGB',(64,48),(${rgb})).save(r'${f}','JPEG')`]); return f; };
const IMG = [JPG('κούπα.jpg', '200,30,30'), JPG('reask.jpg', '30,200,30'), JPG('err.jpg', '30,30,200'), JPG('noslot.jpg', '90,90,90')];

function startRouter() {
  const st = { chats: [], mode: 'enforce', ignoreKw: false };
  const srv = http.createServer((q, resp) => {
    const send = (code, obj) => { resp.statusCode = code; resp.setHeader('content-type', 'application/json'); resp.end(JSON.stringify(obj)); };
    const u = new URL(q.url, 'http://x'); const model = u.searchParams.get('model');
    if (u.pathname === '/v1/models' || u.pathname === '/models') return send(200, { object: 'list', data: [{ id: QWEN, object: 'model', owned_by: 'llamacpp', status: { value: 'loaded', args: ['llama-server', '-c', '32768'] } }] });
    if (u.pathname === '/health') return send(200, { status: 'ok' });
    if (u.pathname === '/props' && q.method === 'GET') return model ? send(200, { default_generation_settings: { n_ctx: 32768 }, total_slots: 1, model_alias: model }) : send(200, { role: 'router', default_generation_settings: { n_ctx: 0 } });
    let b = ''; q.on('data', (d) => b += d); q.on('end', () => {
      let body = {}; try { body = JSON.parse(b); } catch (e) {}
      if (u.pathname === '/tokenize' || u.pathname === '/v1/tokenize') return send(200, { tokens: Array.from({ length: Math.ceil(String(body.content || '').length / 3) }, () => 1) });
      if (/chat\/completions/.test(u.pathname)) {
        const msgs = body.messages || []; const last = msgs[msgs.length - 1] || {};
        const hasImage = Array.isArray(last.content) && last.content.some((p) => p.type === 'image_url');
        const thinking = st.ignoreKw || !(body.chat_template_kwargs && body.chat_template_kwargs.enable_thinking === false);
        st.chats.push({ hasImage, kw: body.chat_template_kwargs || null, max_tokens: body.max_tokens ?? null, thinking });
        if (st.mode === 'err') return send(500, { error: { code: 500, message: 'failed to process image: mmproj not loaded for this model', type: 'server_error' } });
        resp.writeHead(200, { 'content-type': 'text/event-stream' });
        const w = (o) => resp.write('data: ' + JSON.stringify(o) + '\n\n');
        let used = 0; const max = body.max_tokens || Infinity;
        if (thinking) { // log: «preserving reasoning enabled»
          while (used < REASON_N && used < max) { const n = Math.min(50, REASON_N - used, max - used); w({ choices: [{ delta: { reasoning_content: 'σκέψη '.repeat(n) } }] }); used += n; }
          if (used >= max) { w({ choices: [{ delta: {}, finish_reason: 'length' }], timings: { prompt_n: 300, prompt_ms: 90, predicted_n: used, predicted_ms: 5000 } }); return resp.end('data: [DONE]\n\n'); }
        }
        const text = hasImage ? DESC : 'Περίληψη: εντάξει.';
        w({ choices: [{ delta: { content: text }, finish_reason: 'stop' }], timings: { prompt_n: 300, prompt_ms: 90, predicted_n: used + 40, predicted_ms: 600 } });
        return resp.end('data: [DONE]\n\n');
      }
      send(404, { error: 'no' });
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port, st })));
}
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true || window.__nyxV25Ready === true, null, { timeout: 30000 });
  await win.waitForTimeout(400);
  return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
async function addImage(win, file) {
  await win.evaluate(() => { for (const e of [...Att.list]) Att.remove(e.id); });
  await win.evaluate((p) => Att.add([p]), file);
  await win.waitForFunction(() => { const e = Att.list[0]; return e && e.state === 'ok' && (e.stages || []).some((s) => s.id === 'heavy'); }, null, { timeout: 30000 }).catch(() => {});
  return win.evaluate(() => { const e = Att.list[0]; const c = document.querySelector('#as-att .at-chip'); const hv = (e.stages || []).find((s) => s.id === 'heavy');
    return { state: e.state, text: e.text || '', note: e.note || '', heavyTok: hv ? hv.tokens : null, chip: c ? c.innerText : '', chipNote: c && c.querySelector('[data-note]') ? c.querySelector('[data-note]').textContent : '' }; });
}

(async () => {
  const router = await startRouter();
  const { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(['2.6.9.2', '2.6.9.3', '2.6.10', '2.6.10.1', '2.6.11', '2.6.11.1', '2.6.12', '2.6.12.1', '2.6.12.2', '2.6.13', '2.6.13.1', '2.7.0'].includes(String(ver)), 'app version 2.6.9.2(+)', ver);
  await win.evaluate((a) => {
    const A = Store.state.settings.ai; const L = A.providers.find((p) => p.id === 'llama');
    L.enabled = true; L.base = 'http://127.0.0.1:' + a.port + '/v1';
    for (const k of ['commands', 'chat', 'vision', 'summarize']) A.tasks[k] = { p: 'llama', m: a.QWEN };
    Object.assign(A.servers.llama, { ctx: 32768, port: a.port });
    for (const p of A.providers) if (p.id === 'groq') p.enabled = false;
    Store.save(); Assistant.show(); Assistant.render();
  }, { port: router.port, QWEN });

  // 1) jpg + Qwen (thinking enforced by the router) → description, tok > 0, no «ρύθμισε τη θέση Όραση»
  let n0 = router.st.chats.length;
  const r1 = await addImage(win, IMG[0]);
  const req1 = router.st.chats.slice(n0).filter((c) => c.hasImage);
  ok(req1.length === 1 && req1[0].kw && req1[0].kw.enable_thinking === false && req1[0].max_tokens === 400, 'vision request sends chat_template_kwargs {enable_thinking:false} (max_tokens 400 kept)', req1);
  ok(r1.text.includes(DESC), 'jpg → image description from Qwen', r1);
  ok(r1.heavyTok > 0 && !/\b0 tok\b/.test(r1.chip), `chip «Βαρύ»: ${r1.heavyTok} tok (> 0)`, r1);
  ok(!/ρύθμισε τη θέση/.test(r1.chip + r1.note), 'no «ρύθμισε τη θέση Όραση» when the slot is set', r1);

  // 2) server ignores enable_thinking → empty (length) → asked again without max_tokens, said on the chip
  router.st.ignoreKw = true; n0 = router.st.chats.length;
  const r2 = await addImage(win, IMG[1]);
  const req2 = router.st.chats.slice(n0).filter((c) => c.hasImage);
  ok(req2.length === 2 && req2[0].max_tokens === 400 && req2[1].max_tokens === null, 'empty answer → one re-ask without the max_tokens limit (2 requests, no more)', req2);
  ok(r2.text.includes(DESC) && /κενή απάντηση \(finish_reason: length/.test(r2.chipNote) && /ξαναρωτήθηκε χωρίς όριο max_tokens/.test(r2.chipNote), 'description arrives; chip says «κενή απάντηση (finish_reason: length …) → ξαναρωτήθηκε»', r2);
  router.st.ignoreKw = false;

  // 3) router error → the real error on the chip (not swallowed into «χωρίς ανάλυση»)
  router.st.mode = 'err';
  const r3 = await addImage(win, IMG[2]);
  ok(/σφάλμα από τον Router: .*mmproj not loaded/.test(r3.chipNote) && !/ρύθμισε τη θέση/.test(r3.chipNote), 'router 500 → chip «σφάλμα από τον Router: … mmproj not loaded»', r3);
  router.st.mode = 'enforce';

  // 4) slot really empty → only then «ρύθμισε τη θέση Όραση»
  await win.evaluate(() => { Store.state.settings.ai.tasks.vision = { p: 'llama', m: '' }; Store.save(); });
  const r4 = await addImage(win, IMG[3]);
  ok(/ρύθμισε τη θέση «Όραση»/.test(r4.chipNote), 'empty Vision slot → «ρύθμισε τη θέση Όραση»', r4);
  await win.evaluate((m) => { Store.state.settings.ai.tasks.vision = { p: 'llama', m }; Store.save(); for (const e of [...Att.list]) Att.remove(e.id); }, QWEN);

  // 5) summaries / background text also go without thinking
  n0 = router.st.chats.length;
  const sum = await win.evaluate(async () => { try { return { ok: true, txt: await Att.llm('summarize', [{ role: 'user', content: 'Σύνοψη: α, β, γ' }], {}) }; } catch (e) { return { ok: false, err: String(e.message || e) }; } });
  const req5 = router.st.chats.slice(n0);
  ok(sum.ok && /Περίληψη/.test(sum.txt) && req5.length === 1 && req5[0].kw && req5[0].kw.enable_thinking === false, 'summary request: enable_thinking:false, answer arrives', { sum, req5 });

  // 6) Hub: Embeddings → chat model warning; VRAM yellow only on spill / speed drop
  await win.evaluate((m) => { Store.state.settings.ai.tasks.embed = { p: 'llama', m }; Store.save(); try { Assistant.hide(); } catch (e) {} Hub.open(); }, QWEN);
  await win.waitForTimeout(500);
  await win.evaluate(() => document.querySelector('[data-hub-tab=tasks]')?.click() || document.querySelector('[data-hub-tab=engines]')?.click());
  await win.waitForFunction(() => !!document.querySelector('[data-tools=embed-chat]'), null, { timeout: 10000 }).catch(() => {});
  const emb = await win.evaluate(() => { const e = document.querySelector('[data-tools=embed-chat]'); return e ? { txt: e.textContent, tip: e.title, hidden: e.hidden } : null; });
  ok(emb && !emb.hidden && /μοντέλο συνομιλίας στα Embeddings/.test(emb.txt) && /Qwen3\.8-27B/.test(emb.tip) && /Δεν κατεβάζω/.test(emb.tip), 'Embeddings → Qwen 27B: visible warning, nothing downloaded', emb);
  const embStore = await win.evaluate(() => Store.state.settings.ai.tasks.embed.m);
  ok(embStore === QWEN, 'the Embeddings setting was not changed by the warning', embStore);
  const vr = await win.evaluate(() => {
    const GB = 1073741824; const L = NyxLimits; L._shared0 = null; L._speeds = {}; L._lastSpeedModel = null;
    const el = document.createElement('div'); document.body.append(el);
    const snap = (used, shared) => ({ gpu: { adapter: { name: 'AMD Radeon RX 7900 XTX', total: 24 * GB, used: used * GB }, shared: shared * GB, procs: [{ pid: 4100, name: 'llama-server', vram: 22 * GB }] } });
    const out = {};
    Hub.paintVramWarn(el, snap(23.7, 0.3)); out.high = { hidden: el.hidden, st: el.getAttribute('data-vram') };
    Hub.paintVramWarn(el, snap(23.7, 1.5)); out.spill = { hidden: el.hidden, st: el.getAttribute('data-vram'), txt: el.textContent, tip: el.title };
    L._shared0 = null; L.noteSpeed(Store.state.settings.ai.tasks.chat.m, { predicted_n: 720, predicted_ms: 10000 }); L.noteSpeed(Store.state.settings.ai.tasks.chat.m, { predicted_n: 400, predicted_ms: 10000 });
    Hub.paintVramWarn(el, snap(23.7, 0.3)); out.slow = { hidden: el.hidden, st: el.getAttribute('data-vram'), txt: el.textContent };
    el.remove(); return out;
  });
  ok(vr.high.hidden && vr.high.st === 'ok', '23,7/24 GB (99%) alone → no yellow warning', vr.high);
  ok(!vr.spill.hidden && vr.spill.st === 'spill' && /Shared GPU memory/.test(vr.spill.txt) && /\+512 MB/.test(vr.spill.tip), 'Shared GPU memory +1,2 GB → yellow, rule in the tooltip', vr.spill);
  ok(!vr.slow.hidden && vr.slow.st === 'slow' && /40 t\/s/.test(vr.slow.txt) && /72 t\/s/.test(vr.slow.txt), 't/s 72 → 40 for the same model → yellow', vr.slow);

  await quit(app);
  router.srv.close();
  console.log(`\nv2.6.9.2 UI: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
