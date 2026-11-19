'use strict';
// v2.6.13.1 unit: the 2.6.13 local voice is gone and Nyx never starts vs-engine / omnivoice-tts by itself.
// (α) the voice files / IPC / settings code are removed; (β) every launcher left in main refuses a local-voice exe
// with child_process spied (no spawn at all); (γ) the migration «vs-engine / omnivoice command / 2.6.13 voice» →
// «Χωρίς φωνή» with a record, idempotent; (δ) static guards: main diff vs 2.6.13 only removals + the guard, no new URL,
// no new spawn, autoscroll and the «+N» menu fix kept; versions / CHANGELOG.
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), cp = require('child_process');
const R = process.env.NYX_ROOT || path.join(__dirname, '..');
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const read = (f) => { try { return fs.readFileSync(path.join(R, f), 'utf8'); } catch (_) { return ''; } };
const git = (a) => { try { return cp.execSync('git ' + a, { cwd: R, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (e) { return null; } };
const walk = (d, out = []) => { for (const e of fs.readdirSync(path.join(R, d), { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) { if (!/node_modules|vendor|plugins/.test(p)) walk(p, out); } else if (/\.(js|html|css)$/.test(e.name)) out.push(p); } return out; };

// spy every way main can start a process — installed BEFORE main modules are required
const spawned = [];
for (const k of ['spawn', 'execFile', 'exec', 'fork', 'spawnSync', 'execFileSync', 'execSync']) {
  const orig = cp[k];
  cp[k] = function (...a) { spawned.push(k + ' ' + String(a[0]).slice(0, 200)); if (k.endsWith('Sync')) return orig.apply(this, a); const e = new (require('events'))(); e.stdout = new (require('events'))(); e.stderr = new (require('events'))(); e.kill = () => {}; e.unref = () => {}; e.pid = 0; setImmediate(() => e.emit('error', new Error('spied'))); return e; };
}

(async () => {
  console.log('(α) the 2.6.13 voice is removed');
  for (const f of ['main/vsengine.js', 'main/voice2613.js', 'app/js/v26/voice2613.js', 'app/js/v26/voicehub2613.js', 'tests/v2613-engine.js', 'tests/v2613.js', 'tests/fixtures/personas-ster.json'])
    ok(!fs.existsSync(path.join(R, f)), '(α) removed: ' + f);
  const src = [...walk('main'), ...walk('app')].filter((f) => !/main\/novoice\.js$/.test(f));
  const bad = (re) => src.filter((f) => re.test(read(f)));
  ok(!bad(/require\(['"]\.\/vsengine['"]\)|vsengine\.(start|speak|probe)/).length, '(α) nothing requires / calls vsengine', bad(/require\(['"]\.\/vsengine['"]\)/));
  ok(!bad(/tts:vs(Start|Speak|Test|Probe|Status|Stop)|tts:voice\w*2613/).length, '(α) no tts:vs* / tts:voice*2613 IPC left (main + renderer)', bad(/tts:vs|tts:voice\w*2613/));
  ok(!bad(/personas\.json|GPU Voice Studio[\\/]+personas|\/v1\/synthesize|\/v1\/status|OMNIVOICE_HERMES_TOKEN|:7802|ref_rvq_b64/).length, '(α) no personas.json / 7802 / /v1/status / /v1/synthesize / OMNIVOICE_HERMES_TOKEN in code', bad(/personas\.json|\/v1\/synthesize|\/v1\/status|OMNIVOICE_HERMES_TOKEN|:7802|ref_rvq_b64/));
  ok(!bad(/vsVoice|VoiceHub|NyxVoice|speakVoice|v2613-voice|v2613\.(?!css)/).length || bad(/vsVoice|VoiceHub|NyxVoice|speakVoice|v2613-voice/).every((f) => f === 'app/js/v2/core.js' && !/speakVoice|NyxVoice|VoiceHub/.test(read(f))), '(α) no «Φωνή απάντησης» UI / sentence pipeline left (core.js only moves the old vsVoice key)', bad(/vsVoice|VoiceHub|NyxVoice|speakVoice|v2613-voice/));
  const guard = read('main/ipc-guard.js'); ok(!/'tts:vs|voice\w*2613/.test(guard), '(α) ipc-guard: no tts:vs* / voice*2613 schemas');
  const el = JSON.parse(read('app/locales/el.json')), en = JSON.parse(read('app/locales/en.json'));
  ok(!Object.keys(el).some((k) => k.startsWith('v2613.')) && !Object.keys(en).some((k) => k.startsWith('v2613.')), '(α) the 40 v2613.* voice strings are gone (el + en)');
  for (const k of ['v26131.mode_off', 'v26131.off_note', 'v26131.off_try', 'v26131.migrated', 'v26131.blocked']) ok(el[k] && en[k], '(α) string ' + k + ' (el + en)');
  ok(el['v26131.mode_off'] === 'Χωρίς φωνή' && /μία φορά|Χωρίς φωνή/.test(el['v26131.migrated']) && /Τίποτε άλλο δεν άλλαξε/.test(el['v26131.migrated']), '(α) «Χωρίς φωνή» + the migration message says nothing else changed');
  const hub = read('app/js/v2/hub.js'), tabs = read('app/js/v2/hub-tabs.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'), core = read('app/js/v2/core.js');
  ok(!/\['vsserver'/.test(hub) && /\['off', t\('v26131\.mode_off'\)\]/.test(hub) && !/vsRows\(T\) \{/.test(hub), '(α) Ομιλία: «Τοπικός server: vs-engine» is not offered; «Χωρίς φωνή» is; vsRows removed');
  ok(!/vsengine:|omnivoice:/.test(hub.slice(hub.indexOf('TTS_PRESETS'), hub.indexOf('TTS_PRESETS') + 600)), '(α) no vs-engine / omnivoice «Εντολή» presets');
  ok(!/OmniVoice'\)|· OmniVoice|use-omnivoice|data-tts-engine|startTtsEngine|ttsAdv/.test(tabs), '(α) Hub: no «Κείμενο → φωνή · OmniVoice» row / card / «Χρήση OmniVoice» warning / advanced TTS paths');
  ok(/NyxLimits\.vramWarn\(snap, \{ ignoreGvs: true \}\)/.test(hub), '(α) Hub VRAM line: no «Voice Studio» warning (ignoreGvs)');
  ok(/if \(T\.mode === 'off' \|\| T\.mode === 'vsserver'\) return null;/.test(core) && !/tts:vsSpeak/.test(core), '(α) Speech: «Χωρίς φωνή» (and a leftover vs-engine mode) never reaches main');

  console.log('(β) every launcher in main refuses vs-engine / omnivoice-tts — child_process spied');
  const NV = require(path.join(R, 'main/novoice.js'));
  for (const p of ['C:\\Users\\jo\\GPU-Voice-Studio\\vs-engine\\engine\\build-vulkan\\Release\\vs-engine.exe', 'vs-engine', '"C:\\x\\vs-engine.exe"', '/opt/vs-engine', 'C:\\OmniVoice-Vulkan\\omnivoice-tts.exe', 'omnivoice-tts', 'OmniVoice.exe', 'VS-ENGINE.EXE'])
    ok(NV.isLocalVoiceExe(p), '(β) local voice exe: ' + p);
  for (const p of ['C:\\piper\\piper.exe', 'C:\\OmniVoice-Vulkan\\piper.exe', 'C:\\llama-router\\llama-server.exe', 'C:\\x\\whisper-server.exe', '', null, 'C:\\GPU-Voice-Studio\\third_party\\llama\\llama-server.exe'])
    ok(!NV.isLocalVoiceExe(p), '(β) not a local voice exe: ' + p);
  ok(NV.mentionsLocalVoice('"C:\\x\\vs-engine.exe" --text-file {text_file}') && NV.mentionsLocalVoice('omnivoice-tts --model {model}') && !NV.mentionsLocalVoice('{exe} --model "C:\\OmniVoice-Vulkan\\models\\omnivoice-base-Q8_0.gguf" -o {out}') && !NV.mentionsLocalVoice('{exe} -m {model} -f {out}'), '(β) a template naming vs-engine / omnivoice-tts is caught; a model file path is not');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx26131u-'));
  const vsExe = path.join(tmp, 'vs-engine.exe'), ovExe = path.join(tmp, 'omnivoice-tts.exe'), model = path.join(tmp, 'm.gguf');
  for (const f of [vsExe, ovExe]) { fs.writeFileSync(f, '#!/bin/sh\ntouch "' + path.join(tmp, 'RAN') + '"\n'); fs.chmodSync(f, 0o755); } fs.writeFileSync(model, 'x');
  const ai = require(path.join(R, 'main/ai.js'));
  spawned.length = 0;
  const r1 = await ai.tts({ mode: 'command', exe: vsExe, template: '{exe} --model {model} --codec {tokenizer} --text-file {text_file} --output {out}', model, tokenizer: model }, 'Καλημέρα', tmp, { report: true });
  ok(r1 && r1.ok === false && /2\.6\.13\.1|vs-engine/.test(r1.error), '(β) TTS «Εντολή» with vs-engine.exe → refused', r1);
  const r2 = await ai.tts({ mode: 'command', exe: ovExe, template: '{exe} --model {model} --codec {tokenizer} --lang Greek -o {out} < {text_file}', model, tokenizer: model }, 'Καλημέρα', tmp, { report: true });
  ok(r2 && r2.ok === false, '(β) TTS «Εντολή» with omnivoice-tts.exe → refused', r2);
  const r3 = await ai.tts({ mode: 'command', exe: '', template: '"' + vsExe + '" --text-file {text_file} --output {out}' }, 'Καλημέρα', tmp, { report: true });
  ok(r3 && r3.ok === false, '(β) TTS «Εντολή» naming vs-engine only inside the template → refused', r3);
  let thrown = null; try { await ai.tts({ mode: 'command', exe: vsExe, template: '{exe} {text_file} {out}' }, 'x', tmp); } catch (e) { thrown = e; } ok(thrown && /2\.6\.13\.1|vs-engine/.test(thrown.message), '(β) the speak path (tts:run, no report) throws the same clear message');
  const h1 = await ai.exeHelp(vsExe); ok(h1 && h1.ok === false, '(β) «--help» of vs-engine.exe → refused', h1);
  const sys = require(path.join(R, 'main/systools.js'));
  let sErr = null; try { sys.launch(vsExe, 'cli'); } catch (e) { sErr = e; } ok(sErr && sErr.code === 'local_voice_off', '(β) sys:launch of vs-engine.exe → refused (local_voice_off)', sErr && sErr.message);
  let sErr2 = null; try { sys.launch(ovExe, 'gui'); } catch (e) { sErr2 = e; } ok(sErr2 && sErr2.code === 'local_voice_off', '(β) sys:launch of omnivoice-tts.exe → refused');
  ok(!sys.TOOLS.some((t) => t.id === 'vsengine' || /vs-engine/i.test(JSON.stringify(t.paths || []))), '(β) Εργαλεία συστήματος: no «vs-engine (TTS)» entry');
  const procs = require(path.join(R, 'main/procs.js'));
  let pErr = null; try { await procs.start('whisper', { exe: vsExe, model, port: 59871 }); } catch (e) { pErr = e; } ok(pErr && /2\.6\.13\.1|vs-engine/.test(pErr.message), '(β) proc:start with vs-engine.exe as a server exe → refused', pErr && pErr.message);
  let pErr2 = null; try { await procs.start('sd', { exe: ovExe, port: 59872 }); } catch (e) { pErr2 = e; } ok(pErr2 && /2\.6\.13\.1|OmniVoice/.test(pErr2.message), '(β) proc:start with omnivoice-tts.exe → refused');
  await new Promise((r) => setTimeout(r, 300));
  ok(spawned.length === 0, '(β) child_process: not a single spawn / exec in all the paths above', spawned);
  ok(!fs.existsSync(path.join(tmp, 'RAN')), '(β) the fake vs-engine.exe / omnivoice-tts.exe never ran');
  // a normal engine still works through the same path (the guard is not a blanket block)
  const r4 = await ai.tts({ mode: 'command', exe: '', template: 'echo hi > {out}' }, 'x', tmp, { report: true }).catch((e) => ({ ok: false, error: e.message }));
  ok(spawned.length === 1 && /spawn/.test(spawned[0]), '(β) a non-voice «Εντολή» (e.g. piper) still runs (spawn reached once)', { spawned, r4 });

  console.log('(γ) migration → «Χωρίς φωνή»');
  const coreSrc = read('app/js/v2/core.js'); const grab = (n) => { const i = coreSrc.indexOf(n); if (i < 0) throw new Error('missing ' + n); return i; };
  const ctx = { console, Math, Date, Object, Array, String, Number, RegExp, Error, JSON, localStorage: { getItem: () => null, setItem() {} }, t: (k) => k };
  vm.createContext(ctx); vm.runInContext(coreSrc.slice(grab('const NyxLimits = {'), grab('function stripThink(s, r)')) + '\nthis.NyxLimits = NyxLimits;', ctx);
  const L = ctx.NyxLimits;
  const cases = [
    [{ mode: 'vsserver', exe: 'C:\\G\\vs-engine.exe', model: 'm', device: 'Vulkan0', speak: true, rate: 1, voice: 'sapi:Stefanos' }, 'vsserver'],
    [{ mode: 'vsserver', vsVoice: 'ster', exe: 'C:\\G\\vs-engine.exe' }, 'vsserver'],
    [{ mode: 'command', exe: 'C:\\G\\vs-engine.exe', template: '{exe} --model {model}' }, 'command'],
    [{ mode: 'command', exe: 'C:\\OmniVoice-Vulkan\\omnivoice-tts.exe', template: '{exe} --model {model} --lang Greek -o {out} < {text_file}' }, 'command'],
    [{ mode: 'command', exe: '', template: '"C:\\G\\vs-engine.exe" --text-file {text_file}' }, 'command'],
  ];
  for (const [T0, from] of cases) {
    const T = JSON.parse(JSON.stringify(T0)); const changed = L.migrateLocalVoice(T, 1234);
    const keep = Object.keys(T0).filter((k) => k !== 'mode' && k !== 'vsVoice').every((k) => JSON.stringify(T[k]) === JSON.stringify(T0[k]));
    ok(changed && T.mode === 'off' && T._migratedLocalVoiceOff.from === from && T._migratedLocalVoiceOff.at === 1234 && keep && !('vsVoice' in T), `(γ) ${T0.mode}${T0.vsVoice ? ' + vsVoice ' + T0.vsVoice : ''} (${String(T0.exe || T0.template).split(/[\\/]/).pop().slice(0, 30)}) → off; everything else in tts kept`, T);
    if (T0.vsVoice) ok(T._migratedLocalVoiceOff.vsVoice === 'ster', '(γ) the 2.6.13 «Φωνή απάντησης» (ster) is kept in the record, not lost');
    const again = JSON.stringify(T); ok(!L.migrateLocalVoice(T, 9999) && JSON.stringify(T) === again, '(γ) a second load changes nothing (idempotent; the notice flag lives next to it)');
  }
  for (const T0 of [{ mode: 'system', voice: 'sapi:Stefanos' }, { mode: 'command', exe: 'C:\\piper\\piper.exe', template: '{exe} -m {model} -f {out}' }, { mode: 'off' }, { mode: 'command', exe: 'C:\\x\\tts.exe', template: '{exe} --model "C:\\OmniVoice-Vulkan\\models\\omnivoice-base-Q8_0.gguf"' }]) {
    const T = JSON.parse(JSON.stringify(T0)); ok(!L.migrateLocalVoice(T) && JSON.stringify(T) === JSON.stringify(T0), '(γ) untouched: ' + T0.mode + ' ' + (T0.exe || T0.voice || '').split(/[\\/]/).pop());
  }
  const T5 = { mode: 'system', vsVoice: 'ster' }; ok(!L.migrateLocalVoice(T5) && T5.mode === 'system' && !('vsVoice' in T5), '(γ) Windows voice + a stale vsVoice: mode unchanged (no notice), the dead key dropped');
  ok(L.migrateLocalVoice(null) === false, '(γ) no tts settings → no crash');
  ok(/NyxLimits\.migrateLocalVoice\(S\.ai\.tts\);/.test(coreSrc), '(γ) the migration runs when settings load (core.js)');
  const v25 = read('app/js/v25/core.js');
  ok(/tts\._migratedLocalVoiceOff && !tts\._localVoiceOffNoticeShown\) \{\s*tts\._localVoiceOffNoticeShown = Date\.now\(\); Store\.save\(\);\s*toast\('🔇 ' \+ t\('v26131\.migrated'\)/.test(v25), '(γ) one-time notice: shown when the record exists and the flag is not set; the flag is saved first');

  console.log('(δ) static guards');
  const base = 'd8d6b9e';
  const haveBase = git('cat-file -e ' + base) !== null;
  if (haveBase) {
    const names = git(`diff --name-status ${base} -- main`).trim().split('\n').filter(Boolean);
    const allowed = { 'D\tmain/vsengine.js': 1, 'D\tmain/voice2613.js': 1, 'A\tmain/novoice.js': 1, 'M\tmain/v2.js': 1, 'M\tmain/ipc-guard.js': 1, 'M\tmain/ai.js': 1, 'M\tmain/systools.js': 1, 'M\tmain/procs.js': 1 };
    ok(names.every((n) => allowed[n]), '(δ) main/ vs 2.6.13: only the voice removals + main/novoice.js + the guard lines', names);
    const add = git(`diff -U0 ${base} -- main app/js app/index.html`).split('\n').filter((l) => /^\+(?!\+\+)/.test(l));
    ok(!add.some((l) => /https?:\/\//.test(l)), '(δ) no new URL in the added lines', add.filter((l) => /https?:\/\//.test(l)));
    ok(!add.some((l) => /\b(spawn|execFile|exec|fork)\s*\(/.test(l) && !/^\+\s*\/\//.test(l)), '(δ) no new spawn / exec in the added lines', add.filter((l) => /\b(spawn|execFile|exec|fork)\s*\(/.test(l)));
    for (const f of ['main/ai.js', 'main/systools.js', 'main/procs.js']) { const d = git(`diff -U0 ${base} -- ${f}`).split('\n').filter((l) => /^[-+](?![-+])/.test(l)); ok(d.filter((l) => l[0] === '-').every((l) => /vsengine|vs-engine|exe --help/.test(l)) && d.filter((l) => l[0] === '+').every((l) => /novoice|2\.6\.13\.1/.test(l)), `(δ) ${f}: only the novoice guard added`, d); }
    const keep = git(`diff ${base} -- app/js/v26/autoscroll2613.js app/js/v26/tabdrag26122.js app/js/v26/tabs26121.js tests/v2613-autoscroll.js`);
    ok(keep === '', '(δ) kept from 2.6.13 unchanged: auto-scroll (autoscroll2613.js, tabdrag26122.js), «+N» menu fix (tabs26121.js), its Playwright/xdotool test');
  } else ok(false, '(δ) base commit d8d6b9e not in this checkout');
  ok(/m\.style\.top = Math\.max\(8, Math\.min\(r\.bottom \+ 4, innerHeight - mr\.height - 8\)\)/.test(read('app/js/v26/tabs26121.js')), '(δ) the «+N» menu stays inside the window (25+ boards)');
  ok(/autoscroll2613\.js/.test(read('app/index.html')) && !/voice2613\.js|voicehub2613\.js/.test(read('app/index.html')), '(δ) index.html: autoscroll2613.js kept, voice scripts gone');
  ok(!/v2613-(box|voice|err|log)/.test(read('app/v2613.css')) && /#tabs\.as-left/.test(read('app/v2613.css')), '(δ) v2613.css: only the auto-scroll edge glow left');
  const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json')), CH = JSON.parse(read('CHANGELOG.json'));
  ok(['2.6.13.1', '2.7.0'].includes(pkg.version) && lock.version === pkg.version && lock.packages[''].version === pkg.version, '(δ) version 2.6.13.1 (package.json + package-lock)');
  ok(pkg.devDependencies.electron === '45.2.3', '(δ) Electron 45.2.3');
  ok(['2.6.13.1', '2.7.0'].includes(Object.keys(CH)[0]) && CH['2.6.13.1'].el.length === 5 && CH['2.6.13.1'].en.length === 5 && /^\[Αφαιρέθηκε στην 2\.6\.13\.1\]/.test(CH['2.6.13'].el[0]) && CH['2.6.12.2'], '(δ) CHANGELOG 2.6.13.1 first (5 items); the 2.6.13 voice items marked «Αφαιρέθηκε στην 2.6.13.1»');
  ok(!/vsserver/.test(JSON.stringify(read('app/js/v2/core.js').match(/tts: \{[^}]*\}/))), '(δ) the default speech mode is not vs-engine');
  console.log(`\nv2.6.13.1 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
