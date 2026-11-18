'use strict';
// v2.6.13.1 UI (Electron, Chromium sandbox on, real app):
//  1) a profile left at «Τοπικός server: vs-engine» (+ the 2.6.13 «Φωνή απάντησης» ster) with boards / cards / subscriptions
//     → after restart: «Χωρίς φωνή», a one-time message (visible), the flag saved; boards / cards / subscriptions and every
//     other setting byte-identical. Restart again → no message. Same for an «Εντολή» pointing at vs-engine.exe.
//  2) NO spawn of vs-engine in any path: a FAKE vs-engine.exe / omnivoice-tts.exe (a script that leaves a marker file if run)
//     is configured everywhere; app start, Hub (all tabs), Ρυθμίσεις → Ομιλία, every mode change, speak, «Δοκιμή»,
//     tts:run / tts:help / sys:launch / proc:start / sys:detect, the removed tts:vs* IPC → the marker never appears, no process.
//  3) Hub: no «Κείμενο → φωνή · OmniVoice» row / card, no «Voice Studio» warning; the speech form offers «Χωρίς φωνή»
//  4) screenshots normal 1440×900 and small 1024×700 (Hub, «Χωρίς φωνή», the message, the «+N ▾» menu with 30 hidden boards)
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const ROOT = process.env.NYX_ROOT || path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v26131-'));
const BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v26131-bin-'));
const SHOTS = process.env.NYX_SHOTS || path.join(ROOT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const MARK = path.join(BIN, 'VS-ENGINE-RAN');
const VS = path.join(BIN, 'vs-engine.exe'), OV = path.join(BIN, 'omnivoice-tts.exe'), MODEL = path.join(BIN, 'omnivoice-base-Q8_0.gguf');
for (const f of [VS, OV]) { fs.writeFileSync(f, '#!/bin/sh\necho "$0 $*" >> "' + MARK + '"\nsleep 30\n'); fs.chmodSync(f, 0o755); } fs.writeFileSync(MODEL, 'x');
let fails = 0, passes = 0; const fl = [];
const T0 = Date.now(); const ok = (c, m, x) => { const line = ((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 700) : ''); process.stdout.write(line + '\n'); c ? passes++ : (fails++, fl.push(m)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psVoice = () => { try { return cp.execSync('ps -eo args', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').filter((l) => /vs-engine\.exe|omnivoice-tts\.exe/.test(l) && !/ps -eo/.test(l)); } catch (e) { return []; } };
async function launch(w = 1440, hh = 900) {
  const env = { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA };
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT], env });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const x = BrowserWindow.getAllWindows()[0]; x.setSize(w, h); x.center(); }, [w, hh]);
  await win.waitForFunction(() => (window.__nyxV2Ready === true || window.__nyxV25Ready === true) && window.__nyxLook2611 === true, null, { timeout: 30000 });
  await win.waitForTimeout(900); return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (_) {} }
const setSize = async (app, w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]); await sleep(700); };
const shot = (win, name) => win.screenshot({ path: path.join(SHOTS, name) }).then(() => path.join(SHOTS, name)).catch(() => '');
const toasts = (win) => win.evaluate(() => [...document.querySelectorAll('.toast, #toasts > *')].map((x) => x.textContent));
const clearToasts = (win) => win.evaluate(() => document.querySelectorAll('#toasts > *, .toast').forEach((t) => t.remove()));
const openSpeech = async (win) => { await clearToasts(win); await win.evaluate(() => { Panels.settings('speech'); }); await sleep(900); await win.evaluate(() => document.querySelector('.speech-form hr')?.scrollIntoView({ block: 'start' })); await sleep(300); };
const speechSel = (win) => win.evaluate(() => { const f = document.querySelector('.speech-form'); if (!f) return null; const s = [...f.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'system')); return s && { value: s.value, text: s.options[s.selectedIndex].textContent, opts: [...s.options].map((o) => o.value + '=' + o.textContent), note: !f.querySelector('[data-st=tts-off]')?.hidden ? f.querySelector('[data-st=tts-off]').textContent : '' }; });
const openHub = async (win, tab) => { await clearToasts(win); if (!(await win.evaluate(() => !!document.querySelector('#drawer.open .hub-tabs, .drawer.open .hub-tabs') || !!(document.querySelector('.hub-tabs') && document.querySelector('.hub-tabs').offsetParent)))) { await win.evaluate(() => Hub.open()); await sleep(1200); } await win.evaluate((tb) => document.querySelector(`[data-hub-tab=${tb}]`)?.click(), tab); await sleep(1500); };
const hubText = (win) => win.evaluate(() => document.querySelector('#drawer')?.innerText || document.body.innerText);
const withoutTts = (ser) => { const s = JSON.parse(ser); delete s.settings.ai.tts; return JSON.stringify(s); };
const diffPaths = (a, b, p = '', out = []) => { if (JSON.stringify(a) === JSON.stringify(b)) return out; if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], p + '.' + k, out); } else out.push(p + ': ' + JSON.stringify(a)?.slice(0, 80) + ' → ' + JSON.stringify(b)?.slice(0, 80)); return out; };

(async () => {
  // ---------- run 1: a 2.6.13 profile: vs-engine mode + ster + real content ----------
  let { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(String(ver) === '2.6.13.1', 'app version 2.6.13.1', ver);
  await win.evaluate(([vs, model]) => {
    const B = Store.state.boards; for (let i = 0; i < 30; i++) B.push({ id: 'mb' + i, name: 'Πίνακας ' + (i + 4), emoji: '📁', color: '#7c8cff', view: { x: 0, y: 0, z: 1 }, items: i < 3 ? [{ id: 'it' + i, type: 'note', x: 10 * i, y: 20, w: 200, h: 120, text: 'κάρτα ' + i }] : [] });
    Store.state.subs.push({ id: 'sub-netflix', name: 'Netflix', price: 13.99, cycle: 'monthly', next: '2026-12-01' }, { id: 'sub-spotify', name: 'Spotify', price: 10.99, cycle: 'monthly', next: '2026-12-05' });
    const T = Store.state.settings.ai.tts; Object.assign(T, { mode: 'vsserver', vsVoice: 'ster', exe: vs, model, tokenizer: model, device: 'Vulkan0', port: 0, speak: true });
    Store.save(true);
  }, [VS, MODEL]);
  await sleep(500);
  const before = await win.evaluate(() => Store.serialize());
  const bCount = await win.evaluate(() => ({ boards: Store.state.boards.length, items: Store.state.boards.reduce((a, b) => a + b.items.length, 0), subs: Store.state.subs.length }));
  ok(bCount.boards >= 33 && bCount.subs === 2 && bCount.items >= 3, 'profile with 33 boards, cards and 2 subscriptions; speech = «Τοπικός server: vs-engine», voice ster', bCount);
  await quit(app);

  // ---------- run 2: migration + the one-time message ----------
  ({ app, win } = await launch());
  await sleep(1500);
  let ts = await toasts(win);
  const msg = ts.find((x) => /Χωρίς φωνή/.test(x) && /αφαιρέθηκε στην 2\.6\.13\.1/.test(x));
  ok(!!msg, 'restart: the one-time message is visible («Η ομιλία γύρισε σε «Χωρίς φωνή» …»)', ts);
  ok(msg && /Τίποτε άλλο δεν άλλαξε/.test(msg) && /Ομιλία/.test(msg), 'the message says nothing else changed and offers «Ομιλία»', msg);
  await shot(win, 'v26131-normal-01-migration-message.png');
  const after = await win.evaluate(() => Store.serialize());
  const T2 = JSON.parse(after).settings.ai.tts;
  ok(T2.mode === 'off', 'speech setting → «Χωρίς φωνή» (mode off)', T2.mode);
  ok(T2._migratedLocalVoiceOff && T2._migratedLocalVoiceOff.from === 'vsserver' && T2._migratedLocalVoiceOff.vsVoice === 'ster' && !('vsVoice' in T2), 'the previous values are kept in a record (from vs-engine, voice ster); the 2.6.13 vsVoice key moved there', T2._migratedLocalVoiceOff);
  ok(!!T2._localVoiceOffNoticeShown, 'the «shown» flag is saved');
  ok(withoutTts(after) === withoutTts(before), 'boards, cards, subscriptions and every other setting are identical (only settings.ai.tts changed)', diffPaths(JSON.parse(withoutTts(before)), JSON.parse(withoutTts(after))));
  const Tb = JSON.parse(before).settings.ai.tts;
  ok(Object.keys(Tb).filter((k) => !['mode', 'vsVoice'].includes(k)).every((k) => JSON.stringify(Tb[k]) === JSON.stringify(T2[k])), 'inside tts only mode (and the dead vsVoice key) changed — exe / model / speak / rate kept');
  { const disk = (() => { try { return fs.readFileSync(path.join(DATA, 'data', 'nyx.json'), 'utf8'); } catch (e) { return ''; } })();
    ok(/"_localVoiceOffNoticeShown"/.test(disk) && /"mode":\s*"off"/.test(disk), 'on disk: mode off + the flag (persisted)', disk.length); }
  await setSize(app, 1024, 700); await sleep(300);
  await shot(win, 'v26131-small-01-migration-message.png'); await setSize(app, 1440, 900);

  // ---------- speech settings: «Χωρίς φωνή» ----------
  await openSpeech(win);
  let s = await speechSel(win);
  ok(s && s.value === 'off' && s.text === 'Χωρίς φωνή', 'Ρυθμίσεις → Ομιλία shows «Χωρίς φωνή»', s);
  ok(s && !s.opts.some((o) => /^vsserver=|vs-engine/.test(o)) && s.opts.join('|') === 'off=Χωρίς φωνή|system=' + s.opts[1].split('=')[1] + '|command=' + s.opts[2].split('=')[1], '«Τοπικός server: vs-engine» is not offered (options: Χωρίς φωνή / Windows / Εντολή)', s && s.opts);
  ok(s && /αφαιρέθηκε στην 2\.6\.13\.1/.test(s.note), 'a short note under it explains «Χωρίς φωνή»', s && s.note);
  { const html = await win.evaluate(() => document.querySelector('.speech-form')?.innerText || ''); ok(!/Φωνή απάντησης|personas|Voice Studio|7802|OmniVoice του Hermes|vs-engine\.exe/.test(html), 'no «Φωνή απάντησης» / personas / Voice Studio / 7802 / vs-engine rows in the speech form'); }
  await shot(win, 'v26131-normal-02-speech-no-voice.png');
  await setSize(app, 1024, 700); await openSpeech(win); await shot(win, 'v26131-small-02-speech-no-voice.png'); await setSize(app, 1440, 900);

  // ---------- Hub: no OmniVoice row / card, no «Voice Studio» warning ----------
  await openHub(win, 'status');
  let ht = await hubText(win);
  ok(!/OmniVoice/.test(ht), 'Hub «Κατάσταση»: no «Κείμενο → φωνή (OmniVoice)» row', ht.split('\n').filter((l) => /OmniVoice|φωνή/i.test(l)));
  // a measured snapshot with Voice Studio on the GPU: the Hub no longer warns about it
  const vw = await win.evaluate(() => { const snap = { gpu: { adapter: { total: 24 * 2 ** 30, used: 22.6 * 2 ** 30 }, procs: [{ pid: 11, name: 'llama-server', path: 'C:\\Users\\jo\\GPU-Voice-Studio\\third_party\\llama\\llama-server.exe', vram: 4 * 2 ** 30 }, { pid: 12, name: 'vs-engine', vram: 3 * 2 ** 30 }], shared: 0 } }; const el = document.createElement('p'); const w = Hub.paintVramWarn(el, snap); return { st: w.state, hidden: el.hidden, txt: el.textContent }; });
  ok(vw.hidden && !/Voice Studio/.test(vw.txt) && vw.st !== 'gvs', 'Hub VRAM line: Voice Studio holding VRAM → no «Τρέχει και το Voice Studio» warning', vw);
  await shot(win, 'v26131-normal-03-hub-status.png');
  await openHub(win, 'engines');
  ht = await hubText(win);
  ok(!/OmniVoice|Χρήση OmniVoice|Voice Studio/.test(ht) && !(await win.evaluate(() => !!document.querySelector('[data-srv=tts], [data-tts-engine], [data-act=use-omnivoice]'))), 'Hub «Μηχανές»: no «Κείμενο → φωνή · OmniVoice» card, no «Χρήση OmniVoice», no Voice Studio text', ht.split('\n').filter((l) => /OmniVoice|Voice Studio/.test(l)));
  await win.evaluate(() => { const d = document.querySelector('details.hub-adv'); if (d) d.open = true; }); await sleep(300);
  ht = await win.evaluate(() => document.querySelector('details.hub-adv')?.innerText || '?'); ok(!/vs-engine|omnivoice/i.test(ht), 'Hub «Για προχωρημένους»: no vs-engine / OmniVoice paths', (ht.match(/.{0,80}(vs-engine|omnivoice).{0,80}/gi) || []).slice(0, 4));
  await win.evaluate(() => { const d = document.querySelector('details.hub-adv'); if (d) d.open = false; document.querySelector('#drawer .drawer-body, #drawer')?.scrollTo?.(0, 0); }); await sleep(200);
  await shot(win, 'v26131-normal-04-hub-engines.png');
  await setSize(app, 1024, 700); await openHub(win, 'status'); await shot(win, 'v26131-small-03-hub-status.png'); await openHub(win, 'engines'); await shot(win, 'v26131-small-04-hub-engines.png'); await setSize(app, 1440, 900);

  // ---------- no spawn in any path ----------
  const noRun = (where) => { const ps = psVoice(); ok(!fs.existsSync(MARK) && ps.length === 0, 'no vs-engine / omnivoice-tts started: ' + where, { mark: fs.existsSync(MARK) ? fs.readFileSync(MARK, 'utf8') : '', ps }); };
  noRun('app start (profile had vs-engine mode + exe), Hub, Ρυθμίσεις → Ομιλία');
  let r = await win.evaluate(() => Speech.speak('Καλημέρα σας. Δοκιμή.')); await sleep(800);
  ok(r === null, '«Χωρίς φωνή»: speak returns nothing (no sound, no engine)', r); noRun('speak in «Χωρίς φωνή»');
  r = await win.evaluate(() => { const T = Store.state.settings.ai.tts; T.mode = 'vsserver'; return Speech.speak('Καλημέρα.'); }); await sleep(800);
  ok(r === null, 'even a leftover vs-engine mode in memory: speak returns nothing'); noRun('speak with mode vsserver in memory');
  // every mode through the real select (settings change)
  await win.evaluate(() => { Store.state.settings.ai.tts.mode = 'off'; Store.save(); }); await openSpeech(win);
  for (const v of ['system', 'command', 'off', 'command', 'system', 'off']) { await win.evaluate((v) => { const s = [...document.querySelectorAll('.speech-form select')].find((x) => [...x.options].some((o) => o.value === 'system')); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v); await sleep(250); }
  noRun('every mode change in Ρυθμίσεις → Ομιλία');
  await clearToasts(win);
  await win.evaluate(() => document.querySelector('.tts-try')?.click()); await sleep(600);
  ts = await toasts(win); ok(ts.some((x) => /Χωρίς φωνή/.test(x)), '«Δοκιμή φωνής» in «Χωρίς φωνή» → «δεν μιλάω»', ts);
  // «Εντολή» mode pointing at vs-engine.exe → refused with a message, nothing started
  await clearToasts(win);
  r = await win.evaluate(([vs]) => { Object.assign(Store.state.settings.ai.tts, { mode: 'command', exe: vs, template: '{exe} --model {model} --codec {tokenizer} --text-file {text_file} --output {out}' }); return Speech.speak('Καλημέρα.'); }, [VS]); await sleep(1200);
  ts = await toasts(win); ok(r === null && ts.some((x) => /2\.6\.13\.1/.test(x)), '«Εντολή» with vs-engine.exe: speak → a clear message, nothing spoken', ts); noRun('speak in «Εντολή» with vs-engine.exe');
  const ipc = await win.evaluate(async ([vs, ov, model]) => {
    const T = Store.state.settings.ai.tts; const o = {};
    const tr = async (k, f) => { try { o[k] = await f(); } catch (e) { o[k] = 'ERR ' + String(e.message || e).slice(0, 160); } };
    await tr('run', () => API.inv('tts:run', T, 'x'));
    await tr('test', () => API.inv('tts:test', { ...T, exe: ov, template: '{exe} --model {model} -o {out} < {text_file}' }, 'x'));
    await tr('help', () => API.inv('tts:help', vs));
    await tr('launchCli', () => API.inv('sys:launch', vs, 'cli'));
    await tr('launchGui', () => API.inv('sys:launch', ov, 'gui'));
    await tr('procWhisper', () => API.inv('proc:start', 'whisper', { exe: vs, model, port: 59811 }));
    await tr('vsStart', () => API.inv('tts:vsStart', T));
    await tr('vsSpeak', () => API.inv('tts:vsSpeak', T, 'x'));
    await tr('vsTest', () => API.inv('tts:vsTest', T, 'x'));
    await tr('voiceBegin', () => API.inv('tts:voiceBegin2613', T, 'ster'));
    await tr('detect', async () => { const d = await API.inv('sys:detect', {}, false); return (d.tools || []).filter((t) => /vs-engine/i.test(t.name || t.id)).length; });
    return o;
  }, [VS, OV, MODEL]);
  await sleep(1500);
  ok(/2\.6\.13\.1/.test(ipc.run) && ipc.test && ipc.test.ok === false && ipc.help && ipc.help.ok === false, 'tts:run / tts:test (omnivoice-tts) / tts:help → refused', ipc);
  ok(/ERR/.test(ipc.launchCli) && /ERR/.test(ipc.launchGui) && /ERR/.test(ipc.procWhisper), 'sys:launch (cli + gui) / proc:start with vs-engine.exe → refused', { a: ipc.launchCli, b: ipc.launchGui, c: ipc.procWhisper });
  ok(['vsStart', 'vsSpeak', 'vsTest', 'voiceBegin'].every((k) => /ERR/.test(String(ipc[k]))), 'the removed tts:vs* / tts:voiceBegin2613 channels do not exist any more', { a: ipc.vsStart, b: ipc.voiceBegin });
  ok(ipc.detect === 0, 'Εργαλεία συστήματος: no «vs-engine (TTS)» entry', ipc.detect);
  noRun('tts:run, tts:test, tts:help, sys:launch, proc:start, sys:detect, tts:vs*');
  await win.evaluate(() => { Store.state.settings.ai.tts.mode = 'off'; Store.save(true); }); await sleep(400);
  await quit(app);

  // ---------- run 3: no second message ----------
  ({ app, win } = await launch());
  await sleep(1500);
  ts = await toasts(win);
  ok(!ts.some((x) => /Χωρίς φωνή/.test(x)), 'restart again: the message is NOT shown a second time', ts);
  ok(await win.evaluate(() => Store.state.settings.ai.tts.mode === 'off' && !!Store.state.settings.ai.tts._localVoiceOffNoticeShown), 'still «Χωρίς φωνή», flag kept');
  noRun('second restart');
  // a later «Εντολή» with vs-engine typed by hand → on the next start: off again, and a message again (never silent)
  await win.evaluate(([vs]) => { Object.assign(Store.state.settings.ai.tts, { mode: 'command', exe: vs, template: '{exe} --text-file {text_file} --output {out}' }); Store.save(true); }, [VS]); await sleep(400);
  await quit(app);
  ({ app, win } = await launch());
  await sleep(1500);
  ts = await toasts(win);
  ok(ts.some((x) => /Χωρίς φωνή/.test(x)) && await win.evaluate(() => Store.state.settings.ai.tts.mode === 'off' && Store.state.settings.ai.tts._migratedLocalVoiceOff.from === 'command'), '«Εντολή» with vs-engine.exe → «Χωρίς φωνή» + message (once more, because this is a new change)', ts);
  await quit(app);
  ({ app, win } = await launch());
  await sleep(1500);
  ts = await toasts(win); ok(!ts.some((x) => /Χωρίς φωνή/.test(x)), '…and again only once', ts);
  noRun('all runs');

  // ---------- the «+N ▾» menu with 30 hidden boards (kept from 2.6.13) ----------
  for (const [w, hh, tag] of [[1440, 900, 'normal'], [1024, 700, 'small']]) {
    await setSize(app, w, hh); await clearToasts(win); await win.evaluate(() => Panels.closeMenu?.()); await sleep(300);
    await win.evaluate(() => document.querySelector('#tabs-more')?.click()); await sleep(600);
    const mb = await win.evaluate(() => { const m = document.querySelector('#ctxmenu[data-menu=tabs-more]'); if (!m) return null; const r = m.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, ih: innerHeight, rows: m.querySelectorAll('.tm-row').length, more: document.querySelector('#tabs-more')?.textContent.trim() }; });
    ok(mb && mb.rows >= 25 && mb.top >= 0 && mb.bottom <= mb.ih, `${tag}: «+N ▾» menu with ${mb && mb.rows} hidden boards opens inside the window`, mb);
    await shot(win, `v26131-${tag}-05-plusN-menu-${mb ? mb.rows : 0}-boards.png`);
    await win.evaluate(() => Panels.closeMenu?.()); await sleep(200);
  }
  await quit(app);
  ok(!fs.existsSync(MARK) && psVoice().length === 0, 'end: the fake vs-engine.exe / omnivoice-tts.exe never ran in any path');
  process.stdout.write(`\nv2.6.13.1 UI: ${passes} passed, ${fails} failed\n`); if (fails) process.stdout.write('FAILED: ' + fl.join(' | ') + '\n');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
