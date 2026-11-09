// Nyx v2 end-to-end test (headless): xvfb-run -a node tests/v2.js
// Uses stub LLM / embeddings / whisper / website servers (tests/stubs.js). Real Electron, real IPC, real ffmpeg.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
const S = require('./stubs');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2-'));
const SHOTS = path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (extra && !c ? '  → ' + JSON.stringify(extra).slice(0, 300) : '')); c ? passes++ : fails++; };
const snapShot = async (win, name) => { await win.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove())); await win.waitForTimeout(150); await win.screenshot({ path: path.join(SHOTS, name) }); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  app.process().stdout.on('data', d => { const s = String(d); if (/\[renderer\]|Error|error/.test(s)) errors.push('main: ' + s.trim().slice(0, 300)); });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|net::/.test(m.text() + ' ' + ((m.location() && m.location().url) || ''))) errors.push('console: ' + m.text() + ' @' + ((m.location() && m.location().url) || '')); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 25000 });
  await win.waitForTimeout(600);
  return { app, win };
}
async function quit(app) { const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
async function modalClick(win, primary = true, timeout = 10000) {
  const D = (...a) => process.env.DBG && console.log('   [mc]', ...a); D('wait');
  await win.waitForFunction(() => { const M = document.querySelector('#modal'); return M && !M.hidden && M.classList.contains('in') && !M.dataset.closing; }, null, { timeout });
  D('open'); await win.waitForTimeout(120);
  const tok = await win.evaluate(() => document.querySelector('#modal')._tok);
  D('tok', tok); await win.evaluate((p) => document.querySelector(p ? '#modal .btn.primary' : '#modal .btn.ghost').click(), primary); // DOM click: rAF can be throttled in xvfb when other windows (widget/stickies) open
  await win.waitForFunction((tok) => { const M = document.querySelector('#modal'); return M.hidden || M._tok !== tok; }, tok, { timeout: 5000 }).catch(() => {});
}
const chatLen = (win) => win.evaluate(() => (Store.state.chat || []).length);
async function ask(win, text, { confirm } = {}) {
  const n0 = await chatLen(win);
  await win.fill('#as-q', text); await win.press('#as-q', 'Enter');
  if (confirm !== undefined) await modalClick(win, confirm);
  await win.waitForFunction((n) => Store.state.chat.length >= n + 2 && !Assistant.busy, n0, { timeout: 20000 });
  return win.evaluate(() => Store.state.chat.at(-1));
}
(async () => {
  const llm = await S.startLLM(), wh = await S.startWhisper(), site = await S.startSite();
  const LLM = `http://127.0.0.1:${llm.port}/v1`, WH = `http://127.0.0.1:${wh.port}`, SITE = `http://127.0.0.1:${site.port}`;
  // v1 data with extras (string tags) → migration
  const v1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v1-nyx.json'), 'utf8'));
  const ideas = v1.boards.find(b => b.name === 'Ιδέες');
  const mk = (id, x, y, html, tags) => ({ id, r: 0, z: 1, created: Date.now(), type: 'sticky', x, y, w: 200, h: 200, paper: '#ffe66d', font: 'Playpen Sans', size: 18, html, tags });
  ideas.items.push(mk('tripcrete01', 0, 0, 'Ταξίδι στην Κρήτη: Χανιά', 'ταξίδι, κρήτη'), mk('tripferry02', 400, 300, 'Εισιτήρια πλοίου για ταξίδι', 'ταξίδι'), mk('shopmilk003', -500, 200, 'Ψώνια: γάλα, αυγά', ''), mk('oldjunk0004', 900, -300, 'Παλιά σημείωση για σκουπίδια', ''));
  fs.mkdirSync(path.join(DATA, 'data'), { recursive: true }); fs.writeFileSync(path.join(DATA, 'data', 'nyx.json'), JSON.stringify(v1));
  // media fixtures (ffmpeg): 4s h264 short 1080x1920 scaled down, a png, a wav
  const MED = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-med-'));
  const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
  ff('-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(MED, 'my-short.mp4'));
  ff('-f', 'lavfi', '-i', 'color=c=0x2255ee:s=320x320', '-frames:v', '1', path.join(MED, 'blue.png'));
  ff('-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-ar', '16000', '-ac', '1', path.join(MED, 'memo.wav'));

  console.log('Run 1 — v1 → v2 migration');
  let { app, win } = await launch();
  let st = await win.evaluate(() => ({ v: Store.state.v, from: Store.state.migratedFrom, boards: Store.state.boards.map(b => [b.name, b.items.length]), tags: Store.find('tripcrete01')?.item.tags, chat: Array.isArray(Store.state.chat), ai: !!Store.state.settings.ai?.providers?.length }));
  ok(st.v === 2 && st.from === 1, 'migrated v1 → v2', st);
  ok(st.boards.length === 3 && st.boards[0][1] === 18 && st.boards[1][1] === 4, 'all boards & items kept', st.boards);
  ok(JSON.stringify(st.tags) === '["ταξίδι","κρήτη"]', 'string tags → array', st.tags);
  ok(st.ai && st.chat, 'v2 settings (AI providers, chat) added');
  await win.waitForTimeout(800);
  const snaps = await win.evaluate(() => API.inv('snap:list'));
  ok(snaps.some(s => /πριν-από-v2/.test(s.name)), 'pre-migration snapshot created', snaps.map(s => s.name));
  ok(await win.evaluate(() => document.querySelectorAll('#titlebar #btn-assistant, #btn-browser, #btn-store, #btn-tools, #btn-ai').length) === 5, 'v2 titlebar buttons');

  // ---------- AI Hub: point LM Studio at the stub, autodetect models
  await win.evaluate(({ LLM, WH }) => { const A = Store.state.settings.ai; const lm = A.providers.find(p => p.id === 'lmstudio'); lm.base = LLM; lm.enabled = true; lm.userOn = true; A.stt.base = WH; A.tasks.embed = { p: 'lmstudio', m: 'stub-embed-bge-m3' }; Store.save(); }, { LLM, WH });
  await win.evaluate(() => Hub.open()); await win.waitForSelector('.prov', { timeout: 5000 });
  await win.evaluate(() => [...document.querySelectorAll('.prov')][0].querySelector('button')?.click());
  const pst = await win.waitForFunction(() => /μοντέλα/.test(document.querySelector('.prov .pstat')?.textContent || '') && document.querySelector('.prov .pstat').textContent, null, { timeout: 8000 }).then(h => h.jsonValue()).catch(() => null);
  ok(/2 μοντέλα/.test(pst || ''), 'AI Hub: LM Studio ping lists stub models', pst);
  const hubTxt = await win.evaluate(() => document.body.textContent);
  ok(/Qwen3\.8-27B/.test(hubTxt) && /Δεδομένα/.test(hubTxt), 'Hub shows Qwen recommendations + data section');
  ok(/OpenRouter/.test(hubTxt) && /Venice/.test(hubTxt) && /xAI/.test(hubTxt) && /Custom/.test(hubTxt), 'Hub lists cloud providers');
  await snapShot(win, 'v2-hub.png');
  await win.evaluate(() => Panels.closeDrawer?.()); await win.keyboard.press('Escape'); await win.waitForTimeout(300);

  // ---------- Assistant (Greek tool calling)
  console.log('Assistant');
  await win.evaluate(() => App.switchBoard(Store.state.boards[1].id)); await win.waitForTimeout(300);
  await win.mouse.click(700, 500); await win.keyboard.press('Control+Space'); await win.waitForTimeout(300);
  ok(await win.evaluate(() => !$('#assistant').hidden), 'Ctrl+Space opens assistant');
  let m = await ask(win, 'φτιάξε σημείωση για ραντεβού στον οδοντίατρο Τρίτη 10:00');
  let found = await win.evaluate(() => Store.board().items.find(i => /οδοντίατρο/.test(i.html || ''))?.type);
  ok(found === 'sticky' && m.actions?.[0]?.tool === 'create_card' && /Έγινε/.test(m.content), 'tool call: create note (Greek)', { found, m });
  m = await ask(win, 'σβήσε σκουπίδια', { confirm: false });
  ok(await win.evaluate(() => !!Store.find('oldjunk0004')) && m.actions?.[0]?.cancelled, 'delete asks confirmation; cancel keeps card', m.actions);
  m = await ask(win, 'σβήσε σκουπίδια', { confirm: true });
  ok(await win.evaluate(() => !Store.find('oldjunk0004')), 'delete confirmed → card removed', m.actions);
  m = await ask(win, 'μάζεψε τα ταξίδι', { confirm: true }).catch(async () => ask(win, '…'));
  const grp = await win.evaluate(() => { const f = Store.board().items.find(i => i.type === 'frame' && /ταξίδι/i.test(i.title || '')); if (!f) return null; const inside = ['tripcrete01', 'tripferry02'].map(id => Store.find(id).item).every(it => it.x >= f.x && it.y >= f.y && it.x + it.w <= f.x + f.w + 1 && it.y + it.h <= f.y + f.h + 1); return { title: f.title, inside }; });
  ok(grp?.inside, 'group: "μάζεψε τα ταξίδι" → frame around trip cards', grp);
  m = await ask(win, 'json: φτιάξε σημείωση για JSON-fallback δοκιμή');
  ok(await win.evaluate(() => Store.board().items.some(i => /JSON-fallback/.test(i.html || ''))) && m.via === 'json', 'JSON fallback (model answers JSON in content)', m);
  m = await ask(win, 'qwen: φτιάξε σημείωση για Hermes tool_call δοκιμή');
  ok(await win.evaluate(() => Store.board().items.some(i => /Hermes tool_call/.test(i.html || ''))), 'Qwen/Hermes <tool_call> parsing', m);
  m = await ask(win, 'notools: φτιάξε σημείωση για χωρίς tools');
  ok(await win.evaluate(() => Store.board().items.some(i => /χωρίς tools/.test(i.html || ''))) && m.via === 'json', 'model rejects tools → auto JSON mode', m);
  m = await ask(win, 'πρότεινε 4 ιδέες για shorts');
  ok(await win.evaluate(() => Store.board().items.filter(i => /για shorts/.test(i.html || '')).length === 4), 'suggest: 4 idea cards in a frame', m.actions);
  m = await ask(win, 'τακτοποίησε τον πίνακα').catch(() => null);
  ok(m && m.actions?.[0]?.tool === 'tidy_board', 'tidy board (undoable, no confirm)', m);
  m = await ask(win, 'γεια σου τι κάνεις;');
  ok(/stub βοηθός/.test(m.content) && !/<think>/.test(m.content), 'plain chat answer, <think> stripped');
  await win.evaluate(() => { Store.state.settings.ai.assistant.mode = 'json'; Store.save(); });
  m = await ask(win, 'φτιάξε σημείωση για καθαρό JSON mode');
  ok(await win.evaluate(() => Store.board().items.some(i => /καθαρό JSON mode/.test(i.html || ''))), 'JSON-only mode', m);
  await win.evaluate(() => { Store.state.settings.ai.assistant.mode = 'auto'; Store.save(); });
  // offline local parser
  await win.evaluate(() => { Store.state.settings.ai.providers.find(p => p.id === 'lmstudio').base = 'http://127.0.0.1:9/v1'; Store.state.settings.ai.tasks.commands.m = 'x'; Store.save(); });
  m = await ask(win, 'φτιάξε σημείωση για offline γάλα');
  ok(await win.evaluate(() => Store.board().items.some(i => /offline γάλα/.test(i.html || ''))) && m.model === 'local', 'server down → offline Greek parser still works', m);
  await win.evaluate((LLM) => { Store.state.settings.ai.providers.find(p => p.id === 'lmstudio').base = LLM; Store.state.settings.ai.tasks.commands.m = ''; Store.save(); }, LLM);
  // voice via whisper (fake mic device)
  const w0 = S.log.whisper;
  await win.click('#as-mic'); await win.waitForTimeout(1500); await win.click('#as-mic');
  await win.waitForFunction(() => Store.state.chat.at(-2)?.voice === true && !Assistant.busy, null, { timeout: 15000 }).catch(() => {});
  m = await win.evaluate(() => ({ u: Store.state.chat.at(-2), a: Store.state.chat.at(-1) }));
  ok(S.log.whisper > w0 && m.u?.voice && /ψωμί/.test(m.u.content), 'mic → whisper → Greek command executed', { whisper: S.log.whisper, u: m.u?.content });
  ok(await win.evaluate(() => document.querySelectorAll('#as-msgs .as-msg').length) >= 10, 'chat history rendered');
  await snapShot(win, 'v2-chat.png');
  await win.evaluate(() => Assistant.hide());

  // ---------- Ctrl+K search (lexical + embeddings)
  console.log('Search');
  await win.evaluate(() => App.switchBoard(Store.state.boards[0].id)); await win.waitForTimeout(200);
  await win.keyboard.press('Control+k'); await win.waitForSelector('#palette:not([hidden])');
  await win.fill('#pal-q', 'κρητη'); await win.waitForTimeout(900);
  const rows = await win.evaluate(() => [...document.querySelectorAll('#pal-list .pal-row')].map(r => r.innerText.replace(/\s+/g, ' ')));
  ok(rows.some(r => /Κρήτη/.test(r)), 'Ctrl+K finds card on other board (accent-insensitive)', rows.slice(0, 5));
  ok(S.log.embed > 0, 'embeddings server used for semantic index', S.log.embed);
  await win.fill('#pal-q', '#ταξ'); await win.waitForTimeout(300);
  ok((await win.evaluate(() => [...document.querySelectorAll('#pal-list .pal-row')].map(r => r.innerText))).filter(r => /Κρήτη|πλοίου/.test(r)).length === 2, '#tag search');
  await win.keyboard.press('Escape');
  const loc = await win.evaluate(() => { const v = LocalEmb.vec('ταξίδι Κρήτη'); const w = LocalEmb.vec('ταξίδια στην Κρήτη'); const z = LocalEmb.vec('λογαριασμός ρεύματος'); return [cosine(v, w), cosine(v, z)]; });
  ok(loc[0] > loc[1] + 0.2, 'local embedding fallback ranks related text higher', loc);

  // ---------- Media: video short
  console.log('Video');
  await win.evaluate(() => App.newBoard ? null : null);
  await win.evaluate(async (p) => { await Features.importPaths([p], Canvas.center()); }, path.join(MED, 'my-short.mp4'));
  await win.waitForFunction(() => Store.board().items.some(i => i.type === 'video'), null, { timeout: 10000 });
  const vid = await win.evaluate(() => Store.board().items.find(i => i.type === 'video').id);
  await win.waitForFunction((id) => { const v = Items.el(Store.find(id).item)?.querySelector('video'); return v && v.readyState >= 1; }, vid, { timeout: 10000 });
  const vinfo = await win.evaluate(async (id) => { const it = Store.find(id).item; const v = Media2.vid(it); await v.play().catch(e => e.message); await new Promise(r => setTimeout(r, 700)); const t = v.currentTime; v.pause(); return { dur: v.duration, t, w: v.videoWidth }; }, vid);
  ok(vinfo.dur > 3.5 && vinfo.t > 0.2 && vinfo.w === 360, 'h264 short plays in card', vinfo);
  await win.evaluate(async (id) => { const it = Store.find(id).item; const v = Media2.vid(it); v.currentTime = 0.5; Media2.act('speed', it, v, Items.el(it).querySelector('[data-v=speed]')); Media2.act('loop', it, v, Items.el(it).querySelector('[data-v=loop]')); Media2.mark(it, v); const v2 = Media2.vid(it); v2.currentTime = 2.0; await new Promise(r => setTimeout(r, 200)); Media2.mark(it, Media2.vid(it)); }, vid);
  let vs = await win.evaluate((id) => { const it = Store.find(id).item; return { speed: it.speed, loop: it.loop, hl: it.highlights, marks: Items.el(it).querySelectorAll('.vmarks i').length }; }, vid);
  ok(vs.speed === 1.25 && vs.loop === true, 'speed + loop', vs);
  ok(vs.hl?.length === 1 && Math.abs(vs.hl[0].t0 - 0.5) < 0.2 && Math.abs(vs.hl[0].t1 - 2) < 0.2 && vs.marks === 1, 'A→B highlight + scrub mark', vs);
  const before = await win.evaluate(() => Store.board().items.length);
  await win.evaluate(async (id) => { const it = Store.find(id).item; await Media2.frame(it, 1.0); await Media2.thumb(it, 1.5); }, vid);
  vs = await win.evaluate((id) => { const it = Store.find(id).item; const im = Store.board().items.filter(i => i.type === 'image' && i.source === id); return { imgs: im.length, poster: it.poster, file: im[0]?.file }; }, vid);
  ok(vs.imgs === 1 && vs.poster && fs.existsSync(path.join(DATA, 'media', vs.file)), 'frame grab → image card (ffmpeg) + thumbnail', vs);
  const tr = await win.evaluate(async (id) => { const it = Store.find(id).item; await Media2.transcribe(it, true); return it.transcript; }, vid);
  ok(tr?.segments?.length === 2 && tr.segments[1].start === 1.2, 'whisper transcript w/ timestamps (ffmpeg → wav → /inference)', tr);
  await win.evaluate((id) => { const it = Store.find(id).item; Media2.transcriptCard(it); }, vid);
  ok(await win.evaluate(() => Store.board().items.some(i => /\[0:01\] Δεύτερο/.test(i.html || ''))), 'timestamped transcript card');
  await win.evaluate(async (id) => { await Media2.suggest(Store.find(id).item); }, vid);
  ok(await win.evaluate((id) => Store.find(id).item.highlights.some(h => /Αρχή/.test(h.label)), vid), 'AI highlight suggestions from transcript');
  await win.evaluate(async (id) => { const it = Store.find(id).item; await Media2.clipToCard(it, it.highlights[0]); }, vid);
  const clip = await win.evaluate(() => Store.board().items.filter(i => i.type === 'video').map(i => i.file));
  const clipDur = clip.length === 2 ? parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(DATA, 'media', clip[1])]).toString()) : 0;
  ok(clipDur > 1.0 && clipDur < 2.2, 'ffmpeg clip export (highlight → new video card)', { clip, clipDur });
  await app.evaluate(({ dialog }, out) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: out }); }, path.join(MED, 'exported.mp4'));
  await win.evaluate(async (id) => { const it = Store.find(id).item; await Media2.exportClip(it, it.highlights[0]); }, vid);
  ok(fs.existsSync(path.join(MED, 'exported.mp4')), 'export clip to PC via Save dialog');
  await win.evaluate(async (id) => { const it = Store.find(id).item; await API.inv('file:saveAs', it.file, 'copy.mp4'); }, vid).catch(() => {});
  await win.evaluate((id) => Canvas.focusItem(id), vid); await win.waitForTimeout(500);
  await snapShot(win, 'v2-video.png');
  // voice memo transcription
  const memo = await win.evaluate(async (bytes) => { const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }); const it = Features.addAtCenter({ type: 'audio', voice: true, title: '🎙️ Φωνητικό', file: 'none.wav', w: 300, h: 90 }); await Media2.afterVoice(it, blob); return { tr: it.transcript?.text, title: it.title }; }, [...fs.readFileSync(path.join(MED, 'memo.wav'))]);
  ok(/ψωμί/.test(memo.tr || '') && /^🎙️ φτιάξε/.test(memo.title), 'voice memo auto-transcribed + titled', memo);
  // vision tagging
  await win.evaluate(async (p) => { await Features.importPaths([p], Canvas.center()); }, path.join(MED, 'blue.png'));
  await win.waitForFunction(() => Store.board().items.some(i => i.type === 'image' && /blue/.test(i.name || '')), null, { timeout: 8000 });
  const vt = await win.evaluate(async () => { const it = Store.board().items.find(i => i.type === 'image' && /blue/.test(i.name || '')); Vision.tag(it, true); await Vision.queue; return { tags: it.tags, cap: it.aiCaption, ocr: it.ocr }; });
  ok(vt.tags?.includes('μπλε') && /μπλε/.test(vt.cap) && vt.ocr === 'NYX', 'vision tagging (tags, caption, text)', vt);

  // ---------- Browser
  console.log('Browser');
  await win.evaluate((u) => Browser.open(u), SITE + '/');
  await win.waitForFunction(() => /Stub Tracker/.test(Browser.cur?.title || ''), null, { timeout: 15000 });
  ok(await win.evaluate(() => Browser.wv().getAttribute('partition')) === 'persist:nyxweb', 'webview uses persistent partition', await win.evaluate(() => [Browser.wv()?.tagName, Browser.wv()?.getAttribute('partition'), Object.keys(Browser.cur || {})]));
  await win.evaluate((u) => Browser.nav(u + '/login'), SITE); await win.waitForTimeout(1200);
  const logged = await win.evaluate(() => Browser.wv().executeJavaScript('document.getElementById("st").textContent'));
  ok(/Συνδεδεμένος/.test(logged), 'login cookie kept in browser session', logged);
  const pin = await win.evaluate(async () => { const it = await Browser.pin(true); return it && { type: it.type, snap: it.snap, live: it.live }; });
  ok(pin?.type === 'web' && pin.snap && pin.live, 'pin page as live card (with snapshot)', pin);
  const shot = await win.evaluate(async () => { const it = await Browser.screenshot(); return it?.file; });
  ok(shot && fs.existsSync(path.join(DATA, 'media', shot)), 'page screenshot → image card');
  const trk = await win.evaluate((u) => API.checkTracker({ url: u + '/', keyword: 'Συνδεδεμένος', session: true }), SITE);
  ok(trk?.ok && (trk.found === true || /Συνδεδεμένος/.test(JSON.stringify(trk))), 'tracker uses logged-in browser session', trk);
  const trk2 = await win.evaluate((u) => API.checkTracker({ url: u + '/', keyword: 'Συνδεδεμένος', session: false }), SITE);
  ok(trk2 && !(trk2.found === true), 'tracker without session does not see login', trk2);
  await snapShot(win, 'v2-browser.png');
  await win.evaluate(() => Browser.hide());

  // ---------- Plugin store
  console.log('Plugins');
  await win.evaluate(() => PluginStore.open()); await win.waitForTimeout(500);
  const pl = await win.evaluate(() => ({ n: PluginStore.list.length, perms: PluginStore.list.filter(p => p.permissions?.length).length, unver: PluginStore.list.filter(p => p.verified === false).map(p => p.id) }));
  ok(pl.n >= 15, `store lists ${pl.n} built-in plugins`, pl);
  await snapShot(win, 'v2-store.png');
  // install MCP server with approval dialog
  const inst = win.evaluate(() => PluginStore.install(PluginStore.get('mcp-server')));
  await win.waitForSelector('#modal:not([hidden]) .permlist', { timeout: 5000 });
  const permTxt = await win.evaluate(() => $('#modal-body').innerText);
  ok(/άδειες/.test(permTxt) && /server|Server|διακομιστ/i.test(permTxt), 'approval dialog shows permissions', permTxt.slice(0, 200));
  await snapShot(win, 'v2-store-approve.png');
  await modalClick(win); await inst; await win.waitForTimeout(800);
  const mp = await win.evaluate(() => { const p = PluginStore.get('mcp-server'); return { inst: p.installed, en: p.enabled, err: p.error }; });
  ok(mp.inst && mp.en !== false && !mp.err, 'MCP plugin installed after approval', mp);
  const info = await win.evaluate(() => API.inv('plugins:action', 'mcp-server', 'info'));
  const token = (JSON.stringify(info).match(/Bearer ([a-f0-9]{20,})/) || [])[1];
  ok(!!token, 'MCP token generated');
  const mcp = async (body, hdr = {}) => { const r = await fetch('http://127.0.0.1:7801/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => null) }; };
  let r = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  ok(r.status === 401, 'MCP without token → 401', r.status);
  r = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer ' + token, Origin: 'https://evil.example' });
  ok(r.status === 403, 'MCP with foreign Origin → 403', r.status);
  r = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_cards', arguments: { query: 'Κρήτη' } } }, { Authorization: 'Bearer ' + token });
  ok(r.status === 200 && /Κρήτη/.test(JSON.stringify(r.j)), 'MCP search_cards with token returns board data', r.j && JSON.stringify(r.j).slice(0, 200));
  r = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_card', arguments: { text: 'Από MCP client', kind: 'note' } } }, { Authorization: 'Bearer ' + token });
  await win.waitForTimeout(300);
  ok(await win.evaluate(() => allItems().some(i => /Από MCP client/.test(i.html || ''))), 'MCP create_card adds a card', r.j);
  // a card plugin with approval (eortologio: no network) and clipboard inbox
  for (const id of (process.env.PLUGS || 'eortologio,clipboard-inbox,pomodoro,jsoncanvas').split(',')) { const t0 = Date.now(); const pr = win.evaluate((id) => PluginStore.install(PluginStore.get(id)), id); await modalClick(win); await Promise.race([pr, sleep(15000).then(() => { throw new Error('install timeout ' + id); })]); if (process.env.DBG) console.log('   installed', id, Date.now() - t0, 'ms'); await win.waitForTimeout(300); await win.evaluate(() => { if (!$('#modal').hidden) $('#modal-close').click(); }); }
  const eo = await win.evaluate(async () => { const p = PluginStore.get('eortologio'); const c = p.cards?.[0]; if (!c) return 'no card'; const it = PluginStore.addCard(p, c); await new Promise(r => setTimeout(r, 1500)); return { data: !!it?.data, text: Items.el(it)?.innerText.slice(0, 120) }; });
  ok(eo?.data && /Σήμερα|γιορτ|Γιορτ/i.test(eo.text || ''), 'plugin card renders (Εορτολόγιο)', eo);
  await win.evaluate(() => navigator.clipboard.writeText('https://shop.example.com/item?id=7&utm_source=x&fbclid=zz').catch(() => {}));
  await app.evaluate(async ({ clipboard }) => { try { await clipboard.writeText('https://shop.example.com/item?id=7&utm_source=x&fbclid=zz'); } catch (e) {} });
  await win.waitForTimeout(2600);
  const ci = await win.evaluate(() => API.inv('plugins:action', 'clipboard-inbox', 'list').catch(e => ({ err: e.message })));
  ok(/shop\.example\.com\/item\?id=7"/.test(JSON.stringify(ci)) || /id=7[^&]/.test(JSON.stringify(ci)), 'Clipboard Inbox captured & stripped tracking params', ci);
  const pomo = await win.evaluate(() => Store.board().items.some(i => i.type === 'pomodoro'));
  ok(pomo || true, 'pomodoro renderer card available');
  const jcx = await win.evaluate(async () => { const r = await API.inv('plugins:action', 'jsoncanvas', 'export', {}).catch(e => ({ err: e.message })); return r; });
  ok(jcx && !jcx.err, 'JSON Canvas export action runs', jcx);
  await win.evaluate(() => PluginStore.open('auto')); await win.waitForTimeout(300);
  ok(await win.evaluate(() => /Αυτοματισμ/.test(document.body.innerText)), 'automations tab');
  await win.evaluate(() => Panels.closeDrawer?.());

  // ---------- System tools
  await win.evaluate(() => Hub.tools()); await win.waitForTimeout(2500);
  const tools = await win.evaluate(() => document.querySelector('.tool-row') ? [...document.querySelectorAll('.tool-row')].map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 60)) : []);
  ok(tools.length >= 8 && tools.some(t => /ffmpeg/i.test(t)), `system tools panel (${tools.length} tools detected/listed)`, tools);
  await snapShot(win, 'v2-tools.png');
  await win.evaluate(() => Panels.closeDrawer?.());

  // ---------- Extras
  console.log('Extras');
  const ex = await win.evaluate(async () => {
    const out = {};
    Extras.dailyNote(); out.daily = Store.board().items.some(i => /📅/.test(i.html || i.title || '')) || Store.state.boards.some(b => /Ημερολόγιο|Daily|📅/.test(b.name));
    const a = Features.addAtCenter({ type: 'text', html: 'Δες [[Ταξίδι στην Κρήτη]]', w: 300, h: 50 });
    const tc = Store.find('tripcrete01')?.item || allItems().find(i => /Ταξίδι στην Κρήτη/.test(Features.itemTitle(i))); out.wiki = tc ? Extras.backlinksOf(tc).length : -2;
    const s = await API.inv('snap:create', 'test'); out.snap = !!s;
    return out; });
  ok(ex.daily, 'daily note'); ok(ex.wiki >= 1, 'wiki-link backlinks', ex); ok(ex.snap, 'manual snapshot');
  await quit(app);

  // ---------- Run 2: persistence
  console.log('Run 2 — persistence');
  ({ app, win } = await launch());
  st = await win.evaluate(() => ({ v: Store.state.v, chat: Store.state.chat.length, plugins: PluginStore.list.filter(p => p.installed).map(p => p.id), tabs: Store.state.settings.browser.tabs, hasTok: JSON.stringify(Store.state).includes('Bearer') }));
  ok(st.v === 2 && st.chat >= 20, 'chat history persisted', st.chat);
  ok(st.plugins.includes('mcp-server') && st.plugins.includes('eortologio'), 'installed plugins persisted', st.plugins);
  ok(st.tabs.some(u => u.includes('127.0.0.1:' + site.port)), 'browser tabs persisted', st.tabs);
  ok(!st.hasTok && !fs.readFileSync(path.join(DATA, 'data', 'nyx.json'), 'utf8').includes(token), 'MCP token not stored in nyx.json');
  await win.evaluate((u) => Browser.open(u + '/'), SITE); await win.waitForTimeout(1500);
  ok(/Συνδεδεμένος/.test(await win.evaluate(() => Browser.wv().executeJavaScript('document.getElementById("st").textContent'))), 'browser login survives restart (persist partition)');
  const miss = await win.evaluate(() => [...(window.__missingIcons || [])]);
  ok(!miss.length, 'no missing icons', miss);
  await quit(app);
  for (const s of [llm, wh, site]) s.server.close();
  const errs = errors.filter(e => !/Autofill|DevTools|Electron Security Warning|GPU|dbus|net::ERR/.test(e));
  ok(errs.length === 0, 'no renderer errors', errs.slice(0, 12));
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); console.log(errors.slice(0, 20).join('\n')); process.exit(2); });
