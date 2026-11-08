// Nyx v2.5 — the user's acceptance sentence against the REAL web (needs internet). Not part of the CI run.
// xvfb-run -a -s "-screen 0 2048x1280x24" node tests/v25-realweb.js   → shots/v25-web-real.png + shots/v25-web-real.json
const { _electron } = require('playwright-core'); const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'); const SHOTS = path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v25r-home ')); const DATA = path.join(HOME, 'Δεδομένα Nyx'); fs.mkdirSync(DATA);
(async () => {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, HOME, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_CODE_DIR: path.join(DATA, 'app-code') } });
  const win = await app.firstWindow(); const errors = [];
  win.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.unmaximize(); b.setContentSize(1440, 900); b.setPosition(0, 0); });
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 25000 }); await win.waitForTimeout(600);
  await win.evaluate(() => { Store.state.settings.ai.providers.forEach(p => p.enabled = false); Store.save(true); Assistant.show?.(); }); // no AI at all: offline Greek intent + real tools
  const T = 'άνοιξε το web, ψάξε nature wallpapers, κατέβασε 2 εικόνες ή ένα βίντεο από κάπου και στείλ\' τα στον καμβά μου';
  const t0 = Date.now();
  const steps = []; const poll = setInterval(async () => { try { const s = await win.evaluate(() => [...document.querySelectorAll('#assistant .ag-live .ag-steps li')].map(l => l.innerText.replace(/\s+/g, ' ').trim())); if (s.length) steps.splice(0, steps.length, ...s); } catch (e) {} }, 400);
  await win.waitForTimeout(1500); await win.screenshot({ path: path.join(SHOTS, 'v25-web-real-live.png') }).catch(() => {});
  const res = await win.evaluate((T) => Assistant.send(T), T).catch(e => ({ error: e.message }));
  clearInterval(poll);
  const placed = await win.evaluate(() => Store.items().filter(i => ['image', 'video'].includes(i.type) && i.tags?.includes('web')).map(i => ({ type: i.type, file: i.file, caption: i.caption, source: i.source, w: Math.round(i.w), h: Math.round(i.h) })));
  await win.evaluate((ids) => { Canvas.fit?.(Store.items().filter(i => ids.includes(i.file))); }, placed.map(p => p.file)); await win.waitForTimeout(1200);
  await win.screenshot({ path: path.join(SHOTS, 'v25-web-real.png') });
  const sizes = placed.map(p => { try { return fs.statSync(path.join(DATA, 'media', p.file)).size; } catch (e) { return null; } });
  const out = { at: new Date().toISOString(), ms: Date.now() - t0, sentence: T, reply: res?.content, actions: res?.actions, placed, sizes, steps, errors };
  fs.writeFileSync(path.join(SHOTS, 'v25-web-real.json'), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
  await app.evaluate(({ app }) => setTimeout(() => app.quit(), 20)).catch(() => {}); setTimeout(() => process.exit(placed.length >= 2 ? 0 : 1), 3000);
})().catch(e => { console.error(e); process.exit(1); });
