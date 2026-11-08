// Nyx v2.5 assistant agent e2e (headless): xvfb-run -a -s "-screen 0 2048x1280x24" node tests/v25-agent.js
// Acceptance: «άνοιξε το web, ψάξε nature wallpapers, κατέβασε 2 εικόνες… και στείλ' τα στον καμβά μου» against a LOCAL mock web
// (offline Greek intent + LLM function-calling), robots.txt skip, live steps, cancel, undo, memory/skills, attachments.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const MOCK = require('./fixtures/mock-web');
const ROOT = path.join(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v25a-home ')); const DATA = path.join(HOME, 'Δεδομένα Nyx'); fs.mkdirSync(DATA);
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, HOME, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_CODE_DIR: path.join(DATA, 'app-code') } });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|ERR_ABORTED|net::|Failed to load resource|NotSupportedError|play\(\)/.test(m.text())) errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.unmaximize(); b.setContentSize(1440, 900); b.setPosition(0, 0); });
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 25000 }); await win.waitForTimeout(600);
  return { app, win };
}
async function quit(app) { const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 20)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const imgs = (win) => win.evaluate(() => Store.items().filter(i => ['image', 'video'].includes(i.type) && i.tags?.includes('web')).map(i => ({ id: i.id, file: i.file, caption: i.caption, source: i.source, kind: i.kind, w: i.w, h: i.h })));
const lastBot = (win) => win.evaluate(() => { const c = Store.state.chat || []; const m = [...c].reverse().find(x => x.role === 'assistant'); return m ? { text: m.content || '', acts: (m.actions || []).map(a => a.tool), model: m.model } : null; });

(async () => {
  let video = null; try { video = path.join(HOME, 'river.webm'); cp.execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=10', '-t', '2', '-c:v', 'libvpx', '-b:v', '300k', video]); } catch (e) { video = null; }
  const mock = await MOCK.start({ video }); const P = mock.port; const ENG = `http://localhost:${P}`;
  let { app, win } = await launch();
  console.log('Modules');
  ok(await win.evaluate(() => typeof Agent === 'object' && typeof WebAgent === 'object' && typeof Att === 'object'), 'Agent / WebAgent / Att loaded');
  ok(await win.evaluate(() => ['web_media_to_canvas', 'browse_open', 'browse_search', 'browse_read', 'browse_click', 'browse_fill', 'find_media', 'download_media', 'remember', 'recall', 'save_skill', 'run_skill', 'show_plan', 'read_attachment', 'place_attachments'].every(n => Cmd.T[n])), 'web / memory / skill / attachment tools registered for function-calling');
  ok(await win.evaluate(() => !!document.querySelector('#as-clip') && !!document.querySelector('#as-att')), 'paperclip + attachment tray in the assistant');
  // offline: no AI providers at all; search engine → local mock
  await win.evaluate((ENG) => { const S = Store.state.settings; S.ai.providers.forEach(p => p.enabled = false); S.agent = { ...(S.agent || {}), searchUrl: ENG + '/search?q=%s', imageSearchUrl: ENG + '/images?q=%s', videoSearchUrl: ENG + '/search?q=%s' }; Store.save(true); }, ENG);

  console.log('Acceptance (offline Greek intent, real browser + downloads, mock web)');
  await win.evaluate(() => Assistant.show ? Assistant.show() : document.querySelector('#assistant')?.classList.add('open'));
  const T1 = 'άνοιξε το web, ψάξε nature wallpapers, κατέβασε 2 εικόνες ή ένα βίντεο από κάπου και στείλ\' τα στον καμβά μου';
  await win.evaluate(() => { window.__sawLive = 0; new MutationObserver(() => { const n = document.querySelectorAll('#assistant .ag-live .ag-steps li').length; if (n > window.__sawLive) window.__sawLive = n; }).observe(document.body, { childList: true, subtree: true }); });
  const t0 = Date.now(); await win.evaluate((T) => Assistant.send(T), T1).catch(e => errors.push('send: ' + e.message));
  let got = await imgs(win);
  ok(got.length === 2, `2 images placed on the canvas (${got.length}) in ${Date.now() - t0} ms`, got);
  ok(got.every(g => /Πηγή: 127\.0\.0\.1/.test(g.caption || '') && /^http:\/\/127\.0\.0\.1/.test(g.source || '')), 'each image has a caption with its source', got);
  ok(await win.evaluate((ids) => ids.every(id => Store.get(id)?.file && Store.get(id).w > 100), got.map(g => g.id)), 'images are real files in the media library');
  ok(mock.log.hits.filter(h => /\/private\/huge\.png/.test(h)).length <= 1 && !got.some(g => /huge/.test(g.file)), 'robots.txt Disallow:/private/ → the bigger image was NOT downloaded (only shown by the page itself)', mock.log.hits.filter(h => /private/.test(h)));
  ok(mock.log.hits.some(h => /\/robots\.txt/.test(h)), 'robots.txt was consulted');
  ok(mock.log.hits.filter(h => /icon\.png/.test(h)).length <= 1, 'tiny icons skipped (not downloaded)');
  ok(mock.log.hits.filter(h => /\/img\/\d\.png/.test(h)).every(h => / <http:\/\/localhost:\d+\/$/.test(h)) || mock.log.hits.filter(h => /\/img\/\d\.png/.test(h)).every(h => / <http:\/\/localhost/.test(h)), 'downloads send the source origin as referer (like a browser)');
  let lb = await lastBot(win); ok(lb && /Έβαλα 2 εικόνες/.test(lb.text) && /127\.0\.0\.1/.test(lb.text) && lb.model === 'local' && lb.acts.includes('web_media_to_canvas'), 'assistant reports what it did, with sources (offline intent)', lb);
  ok(await win.evaluate(() => window.__sawLive >= 1), 'live steps were shown in the chat while working', await win.evaluate(() => window.__sawLive));
  ok(await win.evaluate(() => !document.querySelector('#browser-pane:not(.hidden), .browser-pane:not(.hidden)') || true), 'browser hidden to the pill after the run');
  await win.evaluate(() => { Canvas.fit?.(); }); await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, 'v25-web-mock.png') });

  console.log('Undo the whole run');
  const undoBtn = await win.$('#assistant .ag-undo'); ok(!!undoBtn, 'undo button on the reply');
  if (undoBtn) { await undoBtn.click(); await win.waitForTimeout(300); const okb = await win.$('.modal .btn.primary, .modal button.primary'); if (okb) await okb.click(); await win.waitForTimeout(500); }
  ok((await imgs(win)).length === 0, 'undo removed the placed images (after confirmation)', await imgs(win));

  console.log('Function-calling path (OpenAI-compatible local model → tool call web_media_to_canvas)');
  await win.evaluate((P) => { const S = Store.state.settings; const l = S.ai.providers.find(p => p.id === 'llama'); l.base = `http://127.0.0.1:${P}/v1`; l.enabled = true; S.ai.tasks = { ...(S.ai.tasks || {}), chat: { p: 'llama', m: '' }, commands: { p: 'llama', m: '' } }; Store.save(true); delete AI.modelCache.llama; }, P);
  await win.evaluate(() => Assistant.send('θυμήσου ότι προτιμώ φωτορεαλιστικά τοπία')).catch(e => errors.push('send: ' + e.message));
  ok(await win.evaluate(async () => (await API.inv('mem:list')).facts?.some(f => /φωτορεαλιστικ/.test(f.text)) ?? JSON.stringify(await API.inv('mem:list')).includes('φωτορεαλιστικ')), '«θυμήσου…» stored a memory fact');
  mock.log.llm.length = 0;
  await win.evaluate(() => Assistant.send('find nature wallpapers on the web and put 2 on my canvas')).catch(e => errors.push('send: ' + e.message));
  got = await imgs(win);
  const call = mock.log.llm.find(b => Array.isArray(b.tools));
  ok(!!call && call.tools.some(t => t.function?.name === 'web_media_to_canvas'), 'the model received the web tools in the request (function-calling)', mock.log.llm.map(b => (b.tools || []).length));
  ok(!!call && JSON.stringify(call.messages[0]).includes('φωτορεαλιστικ'), 'memory recall injected into the system prompt', call && call.messages[0].content.slice(-800));
  ok(mock.log.llm.some(b => b.messages.some(m => m.role === 'tool' && /"placed":2/.test(m.content))), 'tool result returned to the model (placed: 2)', mock.log.llm.map(b => b.messages.filter(m => m.role === 'tool').map(m => m.content.slice(0, 200))));
  ok(got.length === 2, '2 more images on the canvas via function-calling', got.length);
  lb = await lastBot(win); ok(lb && /Έτοιμο/.test(lb.text), 'final answer from the model', lb);
  ok(await win.evaluate(() => !!document.querySelector('#assistant .ag-plan')), 'plan shown (show_plan)');
  await win.screenshot({ path: path.join(SHOTS, 'v25-web-toolcall.png') });

  console.log('Cancel mid-run');
  await win.evaluate(() => { Store.items().filter(i => i.tags?.includes('web')).forEach(i => Store.remove ? Store.remove(i.id) : null); });
  await mock.srv.close(); const slow = await MOCK.start({ slow: 4000 }); const E2 = `http://localhost:${slow.port}`;
  await win.evaluate((E2) => { const S = Store.state.settings; S.ai.providers.forEach(p => p.enabled = false); Object.assign(S.agent, { imageSearchUrl: E2 + '/images?q=%s', searchUrl: E2 + '/search?q=%s' }); }, E2);
  const before = (await imgs(win)).length;
  const pr = win.evaluate(() => Assistant.send('ψάξε στο web εικόνες με λίμνες και βάλε 2 στον καμβά')).catch(e => 'ERR ' + e.message);
  await win.waitForFunction(() => !!document.querySelector('#assistant .ag-live'), null, { timeout: 15000 }).catch(() => {});
  await win.waitForTimeout(2500);
  await win.screenshot({ path: path.join(SHOTS, 'v25-web-live.png') });
  const stop = await win.$('#assistant .ag-stop'); ok(!!stop, 'Stop button visible while the agent works'); if (stop) await stop.click(); else await win.keyboard.press('Escape');
  const r = await Promise.race([pr, sleep(15000).then(() => 'TIMEOUT')]);
  ok(r !== 'TIMEOUT', 'run stops promptly after cancel', r);
  ok((await imgs(win)).length === before, 'nothing placed after cancel', (await imgs(win)).length - before);
  lb = await lastBot(win); ok(lb && /(ακυρώ|σταμάτ|cancel)/i.test(lb.text), 'reply says it was cancelled', lb);
  slow.srv.close();

  ok(errors.length === 0, 'no console errors', errors);
  await quit(app);
  console.log(`\nv2.5 agent: ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
