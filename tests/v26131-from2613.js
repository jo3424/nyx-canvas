'use strict';
// v2.6.13.1 — upgrade from a REAL 2.6.13 profile (the user's PC is on 2.6.13):
//  1) run the 2.6.13 app (NYX_BASE_2613, default /tmp/base2613 = release/2.6.13 d8d6b9e) on a fresh data folder; in ITS UI
//     (Ρυθμίσεις → Ομιλία) pick «Τοπικός server: vs-engine» and «Φωνή απάντησης» = ster (personas.json fixture); add boards / cards /
//     subscriptions; quit
//  2) run 2.6.13.1 on the SAME data folder → «Χωρίς φωνή», the one-time message, the 2.6.13 voice choice kept in the record,
//     everything else identical; no vs-engine started; 3) again → no message
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const BASE = process.env.NYX_BASE_2613 || '/tmp/base2613';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v26131-up-'));
const APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v26131-up-appdata-'));
const SHOTS = process.env.NYX_SHOTS || path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0, passes = 0;
const ok = (c, m, x) => { process.stdout.write((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '') + '\n'); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(path.join(BASE, 'main', 'voice2613.js'))) { console.log('2.6.13 base not found at ' + BASE + ' (set NYX_BASE_2613)'); console.log('\nv2.6.13.1 upgrade from 2.6.13: 0 passed, 1 failed'); process.exit(1); }
// the 2.6.13 personas fixture (dummy base64, as in the 2.6.13 tests)
const fx = cp.execSync('git show d8d6b9e:tests/fixtures/personas-ster.json', { cwd: ROOT }).toString();
const PF = path.join(APPDATA, 'GPU Voice Studio', 'personas.json'); fs.mkdirSync(path.dirname(PF), { recursive: true }); fs.writeFileSync(PF, fx);
const psVoice = () => { try { return cp.execSync('ps -eo args', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').filter((l) => /vs-engine|omnivoice-tts/.test(l) && !/ps -eo/.test(l)); } catch (e) { return []; } };
async function launch(root) {
  const env = { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA, APPDATA }; delete env.OMNIVOICE_HERMES_TOKEN;
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [root], env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const x = BrowserWindow.getAllWindows()[0]; x.setSize(1440, 900); x.center(); });
  await win.waitForFunction(() => (window.__nyxV2Ready === true || window.__nyxV25Ready === true) && window.__nyxLook2611 === true, null, { timeout: 30000 });
  await win.waitForTimeout(1500); return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (_) {} }
const toasts = (win) => win.evaluate(() => [...document.querySelectorAll('.toast, #toasts > *')].map((x) => x.textContent));
const withoutTts = (ser) => { const s = JSON.parse(ser); delete s.settings.ai.tts; return JSON.stringify(s); };

(async () => {
  // ---- 1) the real 2.6.13 app ----
  let { app, win } = await launch(BASE);
  ok(await win.evaluate(() => Store.info && Store.info.version) === '2.6.13', '2.6.13 app started on a fresh data folder');
  await win.evaluate(() => {
    const B = Store.state.boards; for (let i = 0; i < 5; i++) B.push({ id: 'ub' + i, name: 'Πίνακας ' + (i + 4), emoji: '📁', color: '#7c8cff', view: { x: 0, y: 0, z: 1 }, items: [{ id: 'uc' + i, type: 'note', x: 5, y: 5, w: 200, h: 120, text: 'κάρτα ' + i }] });
    Store.state.subs.push({ id: 'sub-a', name: 'Netflix', price: 13.99, cycle: 'monthly', next: '2026-12-01' }); Store.save(true);
    Panels.settings('speech');
  });
  await sleep(1000);
  // its own UI: «Σύνθεση φωνής» → «Τοπικός server: vs-engine», then «Φωνή απάντησης» → ster
  await win.evaluate(() => { const s = [...document.querySelectorAll('.speech-form select')].find((x) => [...x.options].some((o) => o.value === 'vsserver')); s.value = 'vsserver'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(1500);
  const pick = await win.evaluate(() => { const s = document.querySelector('.v2613-voice'); if (!s) return null; const o = [...s.options].find((x) => /^ster/.test(x.textContent)); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return { v: s.value, t: o.textContent }; });
  await sleep(500);
  const T13 = await win.evaluate(() => { Store.save(true); return JSON.parse(JSON.stringify(Store.state.settings.ai.tts)); });
  ok(pick && T13.mode === 'vsserver' && T13.vsVoice === pick.v && /^ster/.test(pick.t), '2.6.13 UI: «Τοπικός server: vs-engine» + «Φωνή απάντησης» = ster saved (mode vsserver, vsVoice ' + (pick && pick.v) + ')', { pick, mode: T13.mode, vsVoice: T13.vsVoice });
  await win.screenshot({ path: path.join(SHOTS, 'v26131-from2613-00-before-2.6.13-speech.png') });
  await sleep(400);
  const before = await win.evaluate(() => Store.serialize());
  await quit(app);
  // ---- 2) 2.6.13.1 on the same data ----
  ({ app, win } = await launch(ROOT));
  ok(await win.evaluate(() => Store.info && Store.info.version) === '2.6.13.1', '2.6.13.1 started on the same data folder');
  let ts = await toasts(win);
  ok(ts.some((x) => /Χωρίς φωνή/.test(x) && /2\.6\.13\.1/.test(x)), 'the one-time message is shown', ts);
  await win.screenshot({ path: path.join(SHOTS, 'v26131-from2613-01-after-message.png') });
  const after = await win.evaluate(() => Store.serialize()); const T = JSON.parse(after).settings.ai.tts;
  ok(T.mode === 'off' && !('vsVoice' in T), '«Χωρίς φωνή»; the 2.6.13 vsVoice key moved out of the settings', { mode: T.mode });
  ok(T._migratedLocalVoiceOff && T._migratedLocalVoiceOff.from === 'vsserver' && T._migratedLocalVoiceOff.vsVoice === T13.vsVoice, 'record keeps what it was (vs-engine, ster id)', T._migratedLocalVoiceOff);
  ok(withoutTts(after) === withoutTts(before), 'boards, cards, subscriptions and all other settings identical to the 2.6.13 profile');
  ok(Object.keys(T13).filter((k) => !['mode', 'vsVoice'].includes(k)).every((k) => JSON.stringify(T13[k]) === JSON.stringify(T[k])), 'inside tts only mode / vsVoice changed');
  ok(psVoice().length === 0, 'no vs-engine / omnivoice-tts process', psVoice());
  await quit(app);
  ({ app, win } = await launch(ROOT));
  ts = await toasts(win); ok(!ts.some((x) => /Χωρίς φωνή/.test(x)), 'next start: no second message', ts);
  ok(await win.evaluate(() => Store.state.settings.ai.tts.mode === 'off'), 'still «Χωρίς φωνή»');
  await quit(app);
  process.stdout.write(`\nv2.6.13.1 upgrade from 2.6.13: ${passes} passed, ${fails} failed\n`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
