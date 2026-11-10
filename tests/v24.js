// Nyx v2.4 end-to-end (headless): xvfb-run -a -s "-screen 0 2048x1280x24" node tests/v24.js
// pen / highlighter / eraser / shapes ON notes (attached, follow move+resize) · assistant never covers a side panel (3 window sizes,
// drag/resize clamped) · Greek speech text + voice picker + "no Greek voice" hint · vs-engine server test panel (fake engine) · Groq.
// Screenshots → shots/v24-*.png
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v24-home ')); const DATA = path.join(HOME, 'Δεδομένα Nyx'); fs.mkdirSync(DATA);
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT, '--autoplay-policy=no-user-gesture-required'], env: { ...process.env, HOME, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_CODE_DIR: path.join(DATA, 'app-code') } });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|ERR_ABORTED|net::|Failed to load resource|NotSupportedError|play\(\)/.test(m.text())) errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await size(app, win, 1440, 900);
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 25000 }); await win.waitForTimeout(500);
  return { app, win };
}
async function size(app, win, w, hh) { await app.evaluate(({ BrowserWindow }, [w, hh]) => { const b = BrowserWindow.getAllWindows()[0]; b.unmaximize(); b.setContentSize(w, hh); b.setPosition(0, 0); }, [w, hh]); await win.waitForTimeout(450); }
async function quit(app) { const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 20)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
const rect = (win, sel) => win.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } : null; }, sel);
const itemRect = (win, id) => win.evaluate((id) => { const r = Items.el(Store.get(id)).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, id);
async function stroke(win, tool, pts) { await win.evaluate((t) => Tools.pick(t), tool); await win.mouse.move(pts[0][0], pts[0][1]); await win.mouse.down(); for (const [x, y] of pts.slice(1)) await win.mouse.move(x, y, { steps: 5 }); await win.mouse.up(); await win.waitForTimeout(200); }
const newest = (win, type) => win.evaluate((type) => { const l = Store.items().filter(i => i.type === type); const i = l[l.length - 1]; return i ? { id: i.id, kind: i.kind, parent: i.parent || null, x: i.x, y: i.y, w: i.w, h: i.h, z: i.z } : null; }, type);
const zOrder = (win, a, b) => win.evaluate(([a, b]) => { const A = Items.el(Store.get(a)), B = Items.el(Store.get(b)); return +getComputedStyle(A).zIndex > +getComputedStyle(B).zIndex || (getComputedStyle(A).zIndex === getComputedStyle(B).zIndex && !!(B.compareDocumentPosition(A) & Node.DOCUMENT_POSITION_FOLLOWING)); }, [a, b]);

(async () => {
  let { app, win } = await launch();

  console.log('Highlighter / pen ON a note (the reported bug)');
  const sid = await win.evaluate(() => { const it = Features.addAtCenter({ type: 'sticky', html: 'Σημαντικό: λογαριασμός ρεύματος', w: 320, h: 240, paper: '#fff59d' }); Canvas.select([]); return it.id; });
  let sr = await itemRect(win, sid);
  await stroke(win, 'highlighter', [[sr.x + 30, sr.y + 60], [sr.x + 160, sr.y + 62], [sr.x + 280, sr.y + 64]]);
  const hl = await newest(win, 'ink');
  ok(hl && hl.kind === 'highlighter' && hl.parent === sid, 'highlighter stroke started on a note is attached to it', hl);
  ok(hl && await zOrder(win, hl.id, sid), 'highlighter is drawn ABOVE the note (visible), not hidden under it');
  ok(await win.evaluate((id) => { const cs = getComputedStyle(Items.el(Store.get(id))); return cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none' && (cs.boxShadow === 'none' || !cs.boxShadow); }, hl.id), 'no box/background around the highlighter stroke (only the stroke itself)');
  ok(await win.evaluate(([id, x, y]) => document.elementsFromPoint(x, y).some(e => e.closest?.('.item')?.dataset.id === id), [hl.id, sr.x + 160, sr.y + 62]), 'the stroke is really on screen over the note (hit-test)');
  await win.evaluate(() => Tools.pick('select')); await win.mouse.click(40, 860);
  await win.screenshot({ path: path.join(SHOTS, 'v24-highlighter-note.png') });
  await stroke(win, 'pen', [[sr.x + 40, sr.y + 150], [sr.x + 120, sr.y + 190], [sr.x + 220, sr.y + 150]]);
  const pen = await newest(win, 'ink');
  ok(pen && pen.kind === 'pen' && pen.parent === sid, 'pen stroke on a note is attached too', pen);
  // move the note → strokes follow
  sr = await itemRect(win, sid); const before = await win.evaluate(([a, b, s]) => [Store.get(a).x, Store.get(b).x, Store.get(s).x, Store.get(a).y, Store.get(s).y], [hl.id, pen.id, sid]);
  await win.evaluate(() => Tools.pick('select')); await win.mouse.move(sr.x + sr.w - 20, sr.y + 20); await win.mouse.down(); await win.mouse.move(sr.x + sr.w + 100, sr.y + 80, { steps: 8 }); await win.mouse.up(); await win.waitForTimeout(200);
  const after = await win.evaluate(([a, b, s]) => [Store.get(a).x, Store.get(b).x, Store.get(s).x, Store.get(a).y, Store.get(s).y], [hl.id, pen.id, sid]);
  const ds = after[2] - before[2];
  ok(Math.abs(ds) > 20 && Math.abs((after[0] - before[0]) - ds) < 0.5 && Math.abs((after[1] - before[1]) - ds) < 0.5 && Math.abs((after[3] - before[3]) - (after[4] - before[4])) < 0.5, 'moving the note moves its highlighter + pen strokes with it', { before, after });
  // resize the note (se handle) → strokes scale with it
  await win.evaluate((id) => Canvas.select([id]), sid); await win.waitForTimeout(150);
  const hd = await rect(win, '.hdl[data-h="se"]'); const w0 = await win.evaluate(([s, a]) => ({ sw: Store.get(s).w, aw: Store.get(a).w, ax: Store.get(a).x - Store.get(s).x }), [sid, hl.id]);
  await win.mouse.move(hd.x + hd.w / 2, hd.y + hd.h / 2); await win.mouse.down(); await win.mouse.move(hd.x + 120, hd.y + 60, { steps: 8 }); await win.mouse.up(); await win.waitForTimeout(200);
  const w1 = await win.evaluate(([s, a]) => ({ sw: Store.get(s).w, aw: Store.get(a).w, ax: Store.get(a).x - Store.get(s).x }), [sid, hl.id]);
  const sc = w1.sw / w0.sw;
  ok(sc > 1.1 && Math.abs(w1.aw / w0.aw - sc) < 0.03 && Math.abs(w1.ax / (w0.ax || 1) - sc) < 0.05, 'resizing the note scales its strokes with it', { w0, w1 });

  console.log('Bare canvas highlighter + eraser + shapes on a note');
  await win.mouse.click(40, 860);
  const other = await win.evaluate(() => { const it = Features.addAtCenter({ type: 'sticky', html: 'κάτω', w: 200, h: 160 }); Store.change(() => { it.x -= 700; it.y += 200; }); Items.mount(it); return it.id; });
  const free = await win.evaluate(() => { for (let y = innerHeight - 140; y > 200; y -= 40) for (let x = 140; x < innerWidth - 300; x += 40) { const ok = [0, 30, 60, 90].every(d => !document.elementsFromPoint(x + d, y).some(e => e.closest?.('.item, #dock, .floatbar, #minimap, .minimap, button'))); if (ok) return [x, y]; } return null; });
  await stroke(win, 'highlighter', [[free[0], free[1]], [free[0] + 90, free[1] + 2]]);
  const bare = await newest(win, 'ink');
  ok(bare && !bare.parent && bare.z <= await win.evaluate(() => Store.minZ()), 'highlighter on the empty canvas is unattached and stays under items', bare);
  // eraser over the note erases the ink on it, never the note
  sr = await itemRect(win, sid); const inkOn = await win.evaluate((s) => Store.items().filter(i => i.parent === s && i.type === 'ink').map(i => i.id), sid);
  const penId = await win.evaluate((ids) => ids.find(id => Store.get(id).kind === 'pen'), inkOn);
  const pp = await win.evaluate((id) => { const p = Items.el(Store.get(id)).querySelector('path'); const L = p.getTotalLength(); const q = p.getPointAtLength(L * 0.35); const m = p.getScreenCTM(); return [q.x * m.a + q.y * m.c + m.e, q.x * m.b + q.y * m.d + m.f]; }, penId);
  await stroke(win, 'eraser', [[pp[0], pp[1] - 12], [pp[0], pp[1]], [pp[0], pp[1] + 12]]);
  const left = await win.evaluate(([s, ids]) => ({ note: !!Store.get(s), ink: ids.filter(id => Store.get(id)).length }), [sid, inkOn]);
  ok(left.note && left.ink === 1, 'eraser over a note removes the pen stroke, the note stays', left);
  sr = await itemRect(win, sid);
  await win.evaluate(() => { Store.state.settings.shapeKind = 'ellipse'; }); await stroke(win, 'shape', [[sr.x + 40, sr.y + 40], [sr.x + 140, sr.y + 110]]);
  const shp = await newest(win, 'shape');
  ok(shp && shp.parent === sid, 'shape drawn on a note is attached to it', shp);
  sr = await itemRect(win, sid); await stroke(win, 'arrow', [[sr.x + 60, sr.y + sr.h - 40], [sr.x + 200, sr.y + sr.h - 60]]);
  const arr = await newest(win, 'arrow');
  ok(arr && arr.parent === sid, 'arrow drawn on a note is attached to it', arr);
  // ink drawn on the attached shape → nested attachment; deleting the shape with the eraser detaches it (no dangling parent)
  const sr2 = await itemRect(win, shp.id);
  await stroke(win, 'pen', [[sr2.cx - 10, sr2.cy], [sr2.cx + 10, sr2.cy + 5]]);
  const nest = await newest(win, 'ink');
  ok(nest.parent === shp.id || nest.parent === sid, 'pen on a shape on a note attaches (nested)', nest);
  const nkids = await win.evaluate((s) => Canvas.kids(new Set([s])).length, sid);
  ok(nkids >= 4, 'note → shape → ink: all attachments found recursively', nkids);
  ok(await win.evaluate(() => { const a = Store.items()[0]; const o = a.parent; a.parent = a.id; let r; try { r = Canvas.kids(new Set([a.id])).length >= 0; Items.place(Items.el(a), a); } catch (e) { r = false; } a.parent = o; return r; }), 'self-parent cycle does not hang kids()/place()');

  console.log('Assistant never covers a side panel');
  await win.evaluate(() => { Tools.pick('select'); document.querySelectorAll('#toasts .toast').forEach(t => t.remove()); });
  for (const [W, H, name] of [[1280, 800, '1280x800'], [1920, 1080, '1920x1080'], [700, 700, 'narrow 700x700']]) {
    await size(app, win, W, H);
    for (const kind of ['settings', 'ai']) {
      await win.evaluate((k) => { k === 'ai' ? Hub.open() : Panels.settings(); Assistant.show(); }, kind); await win.waitForTimeout(450);
      const dr = await rect(win, '#drawer'), as = await rect(win, '#assistant'), vw = await win.evaluate(() => [innerWidth, innerHeight]);
      const sep = dr && as && (as.r <= dr.x + 1 || as.x >= dr.r - 1 || as.b <= dr.y + 1 || as.y >= dr.b - 1);
      const inside = as && as.x >= 0 && as.y >= 0 && as.r <= vw[0] + 1 && as.b <= vw[1] + 1 && as.w >= 250 && as.h >= 200;
      ok(sep && inside, `${name} · ${kind}: assistant beside the panel, fully visible, usable size`, { dr, as, vw });
      if (W === 1280 && kind === 'settings') await win.screenshot({ path: path.join(SHOTS, 'v24-assistant-docked.png') });
      await win.evaluate(() => { Assistant.hide(); Panels.closeDrawer(); }); await win.waitForTimeout(250);
    }
  }
  await size(app, win, 1440, 900);
  ok(await win.evaluate(() => !document.querySelector('#drawer').style.width && !document.querySelector('#drawer').classList.contains('as-stacked')), 'panel width/stacking restored after the assistant closes');
  await win.evaluate(() => Assistant.show()); await win.waitForTimeout(350);
  let a0 = await rect(win, '#assistant'); const hd2 = await rect(win, '#assistant .as-head');
  await win.mouse.move(hd2.x + 60, hd2.y + hd2.h / 2); await win.mouse.down(); await win.mouse.move(hd2.x - 900, hd2.y - 600, { steps: 8 }); await win.mouse.up(); await win.waitForTimeout(200);
  let a1 = await rect(win, '#assistant');
  ok(a1.x < a0.x - 200 && a1.x >= 0 && a1.y >= 30, 'assistant can be dragged, but stays inside the window (clamped)', { a0, a1 });
  const rs = await rect(win, '#assistant .as-rs');
  await win.mouse.move(rs.x + 6, rs.y + 6); await win.mouse.down(); await win.mouse.move(rs.x - 3000, rs.y - 3000, { steps: 6 }); await win.mouse.up(); await win.waitForTimeout(200);
  const a2 = await rect(win, '#assistant'); const vw = await win.evaluate(() => [innerWidth, innerHeight]);
  ok(a2.w > a1.w && a2.x >= 0 && a2.y >= 30 && a2.r <= vw[0] && a2.b <= vw[1], 'resize handle grows it, clamped to the visible area', { a1, a2, vw });
  await win.evaluate(() => Panels.settings()); await win.waitForTimeout(400);
  const dr2 = await rect(win, '#drawer'), a3 = await rect(win, '#assistant');
  ok(a3.r <= dr2.x + 1, 'a user-placed/resized assistant still moves out of the way when Settings opens', { dr2, a3 });
  await win.evaluate(() => Panels.closeDrawer()); await win.waitForTimeout(200);
  await win.dblclick('#assistant .as-head h3, #assistant .as-head .as-title, #assistant .as-head', { position: { x: 120, y: 10 } }).catch(() => {}); await win.waitForTimeout(200);
  ok(await win.evaluate(() => !Store.state.settings.asRect), 'double-click on the title bar resets position/size');
  await win.evaluate(() => Assistant.hide());

  console.log('Speech: clean Greek text, voice by text language');
  const st = await win.evaluate(() => Speech.speechText('## Τίτλος\n- **Καλημέρα** 😀 [σύνδεσμος](https://x.y) `κώδικας`\n```js\nlet a=1\n```\nτέλος ✅'));
  ok(!/[#*`😀✅\[\]]|https?:/u.test(st) && /Καλημέρα/.test(st) && /σύνδεσμος/.test(st) && /τέλος/.test(st), 'markdown, links, code and emoji are not read aloud', st);
  ok(await win.evaluate(() => Speech.textLang('Γεια σου, τι κάνεις; OK') === 'el' && Speech.textLang('Hello there, how are you?') === 'en'), 'language comes from the text (Greek text → Greek voice)');
  ok(await win.evaluate(() => { const vs = [{ name: 'Microsoft David', lang: 'en-US', localService: true }, { name: 'Microsoft Stefanos', lang: 'el-GR', localService: true }, { name: 'Microsoft Athina Online (Natural) - Greek', lang: 'el-GR' }]; return Speech.pickWeb(vs, 'el', '')?.name === 'Microsoft Athina Online (Natural) - Greek' && Speech.pickWeb(vs.slice(0, 1), 'el', '') === null; }), 'picks a Greek (Natural first) voice; never an English one for Greek');
  // the voice picker: no voices here (Linux) → the Greek hint; with stubbed voices → grouped list
  await win.evaluate(() => { Speech._av = Speech.allVoices; Speech.allVoices = async () => [{ id: 'sapi:Microsoft Zira Desktop', name: 'Microsoft Zira Desktop', lang: 'en-US', src: 'sapi' }]; Store.state.settings.ai.tts.mode = 'system'; Panels.settings('speech'); }); await win.waitForSelector('#drawer .voice-sel'); await win.waitForTimeout(800);
  ok(await win.evaluate(() => !document.querySelector('#drawer .voice-hint').hidden && /Ελληνικά|Greek/.test(document.querySelector('#drawer .voice-hint').textContent)), 'no Greek voice installed → hint how to add one in Windows');
  await win.evaluate(() => { Speech.allVoices = async () => [{ id: 'onecore:Microsoft Stefanos', name: 'Microsoft Stefanos', lang: 'el-GR', src: 'onecore' }, { id: 'web:Microsoft Athina Online (Natural) - Greek (Greece)', name: 'Microsoft Athina Online (Natural) - Greek (Greece)', lang: 'el-GR', src: 'web' }, { id: 'sapi:Microsoft Zira Desktop', name: 'Microsoft Zira Desktop', lang: 'en-US', src: 'sapi' }, { id: 'web:Google UK English Female', name: 'Google UK English Female', lang: 'en-GB', src: 'web' }]; Panels.drawerKind = null; Panels.settings('speech'); });
  await win.waitForTimeout(700);
  const vp = await win.evaluate(() => { const s = document.querySelector('#drawer .voice-sel'); s.scrollIntoView({ block: 'center' }); return { groups: [...s.querySelectorAll('optgroup')].map(g => [g.label, g.children.length]), hint: document.querySelector('#drawer .voice-hint').hidden, rate: !!document.querySelector('#drawer .v24-rate'), pitch: !!document.querySelector('#drawer .v24-pitch'), txt: s.options[1]?.textContent }; });
  ok(vp.groups.length === 2 && vp.groups[0][1] === 2 && vp.hint && /el-GR/.test(vp.txt), 'voice picker: Greek voices first, each with its language; hint hidden', vp);
  ok(vp.rate && vp.pitch, 'rate + pitch sliders');
  await win.evaluate(() => { const s = document.querySelector('#drawer .voice-sel'); s.size = 7; s.style.height = 'auto'; }); await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(SHOTS, 'v24-voice-picker.png') });
  await win.evaluate(() => { const s = document.querySelector('#drawer .voice-sel'); s.size = 0; s.value = 'onecore:Microsoft Stefanos'; s.dispatchEvent(new Event('change')); const r = document.querySelector('#drawer .v24-rate'); r.value = 3; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); Speech.allVoices = Speech._av; });
  ok(await win.evaluate(() => Store.state.settings.ai.tts.voice === 'onecore:Microsoft Stefanos' && +Store.state.settings.ai.tts.rate === 3), 'chosen voice and rate are saved');
  // Windows speech request carries the voice + Greek language (stub the IPC, no PowerShell on Linux)
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('tts:sapi'); ipcMain.handle('tts:sapi', (e, ...a) => { global.__ttsGot = a; return { ok: false, noVoice: true, lang: 'el' }; }); });
  await win.evaluate(async () => { document.querySelectorAll('#toasts .toast').forEach(t => t.remove()); await Speech.speak('**Καλησπέρα** 👋'); }); await win.waitForTimeout(200);
  const req = { got: await app.evaluate(() => global.__ttsGot || null), toast: await win.evaluate(() => document.querySelector('#toasts')?.textContent || '') };
  ok(req.got && req.got[0] === 'Καλησπέρα' && req.got[1] === 'el' && req.got[2] === 3 && req.got[3]?.voice === 'Microsoft Stefanos' && req.got[3]?.src === 'onecore', 'Windows TTS gets clean text, el, the rate and the chosen OneCore voice', req.got);
  ok(/Ελληνικ|Greek/.test(req.toast), 'no Greek voice → clear Greek toast with a button to Windows settings', req.toast.slice(0, 200));
  await win.evaluate(() => { Store.state.settings.ai.tts.voice = ''; document.querySelectorAll('#toasts .toast').forEach(t => t.remove()); });

  console.log('vs-engine server mode (fake engine)');
  const vdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-vs-e2e-')); const m = path.join(vdir, 'omnivoice-base-Q8_0.gguf'), c = path.join(vdir, 'omnivoice-tokenizer-Q8_0.gguf'); fs.writeFileSync(m, 'x'); fs.writeFileSync(c, 'x');
  await win.evaluate(([exe, m, c]) => { Object.assign(Store.state.settings.ai.tts, { mode: 'vsserver', exe, model: m, tokenizer: c, device: 'Vulkan0', port: 0 }); Store.save(); Panels.drawerKind = null; Panels.settings('speech'); }, [path.join(__dirname, 'fixtures', 'fake-vs-engine.js'), m, c]);
  await win.waitForSelector('#drawer .vs-test'); await win.evaluate(() => document.querySelector('#drawer .vs-test').scrollIntoView({ block: 'center' }));
  await win.click('#drawer .vs-test');
  await win.waitForSelector('#drawer .vs-out audio, #drawer .vs-out .err', { timeout: 60000 });
  const vo = await win.evaluate(() => { const o = document.querySelector('#drawer .vs-out'); return { ok: !!o.querySelector('audio'), txt: o.innerText.slice(0, 1500), probe: o.querySelectorAll('.vs-probe details').length }; });
  ok(vo.ok && /\/v1\/audio\/speech/.test(vo.txt), 'Test starts vs-engine hidden with a token, finds POST /v1/audio/speech and plays the WAV', vo.txt);
  ok(vo.probe >= 3 && /\/health/.test(vo.txt) && /--codec/.test(vo.txt) && /VS_ENGINE_TOKEN/.test(vo.txt), 'Test panel shows the command, the token note and the raw probe answers', vo);
  ok(!/[A-Za-z0-9]{32}/.test(vo.txt.replace(/omnivoice[-\w.]*/g, '')), 'the token itself is never shown');
  await win.screenshot({ path: path.join(SHOTS, 'v24-vs-engine.png') });
  const sp = await win.evaluate(async () => { const r = await API.inv('tts:vsSpeak', Store.state.settings.ai.tts, 'Καλημέρα'); return r; });
  ok(sp.file && sp.endpoint === 'POST /v1/audio/speech', 'Speak in vs-engine mode uses the found endpoint', sp);
  await win.evaluate(() => API.inv('tts:vsStop')); await win.evaluate(() => { Store.state.settings.ai.tts.mode = 'system'; Store.save(); });

  console.log('Groq');
  const g = await win.evaluate(() => { const p = AI.prov('groq'); return p && { base: p.base, keyRef: p.keyRef, def: p.defModel, kind: p.kind }; });
  ok(g && g.base === 'https://api.groq.com/openai/v1' && g.keyRef === 'key:groq' && g.def === 'llama-3.3-70b-versatile', 'Groq provider preset present (OpenAI-compatible, key in safeStorage)', g);
  const pm = await win.evaluate(async () => { const C = AI.cfg(); const en = C.providers.map(p => p.enabled), tk = C.tasks; C.tasks = {}; C.providers.forEach(p => p.enabled = p.id === 'groq');
    const L = [{ id: 'whisper-large-v3' }, { id: 'meta-llama/llama-guard-4-12b' }, { id: 'playai-tts' }, { id: 'llama-3.1-8b-instant' }, { id: 'llama-3.3-70b-versatile' }];
    try { AI.modelCache.groq = { list: L, at: Date.now() }; const a = (await AI.pickModel('chat')).m; AI.modelCache.groq = { list: L.slice(0, 4), at: Date.now() }; const b = (await AI.pickModel('chat')).m; return [a, b]; }
    finally { C.providers.forEach((p, i) => p.enabled = en[i]); C.tasks = tk; delete AI.modelCache.groq; } });
  ok(pm[0] === 'llama-3.3-70b-versatile' && pm[1] === 'llama-3.1-8b-instant', 'Groq picks llama-3.3-70b-versatile, else a chat model (never whisper/tts/guard)', pm);
  await win.evaluate(() => { Panels.drawerKind = null; Panels.settings('speech'); }); await win.waitForTimeout(400);
  ok(await win.evaluate(() => [...document.querySelectorAll('#drawer select option')].some(o => o.value === 'groq')), 'STT engine offers Groq Whisper');
  ok(await win.evaluate(() => !/groq/i.test([...document.querySelectorAll('#drawer select')].find(s => [...s.options].some(o => o.value === 'vsserver'))?.innerText || '')), 'no Groq TTS offered (it has no Greek voice)');
  await win.evaluate(() => Panels.closeDrawer());

  ok(errors.length === 0, 'no renderer errors', errors);
  await quit(app);
  console.log(`\n${passes} passed, ${fails} failed`); console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
