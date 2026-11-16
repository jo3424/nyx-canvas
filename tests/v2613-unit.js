'use strict';
// v2.6.13 «φωνή ster» unit: (α) personas.json with a ster fixture (DUMMY base64, never a real voice code), read only,
// refFile ignored; (β) the /v1/synthesize body with the ref fields — ref_text is required with ref_rvq_b64;
// (γ) the sentence splitter (19,90 / 09:45 / κ.λπ. / π.χ. / κ.ά. / δηλ. …); (δ) missing file / schema / persona → an error
// code for the UI, no engine started, no request, no silent change; redaction; static checks (no new spawn, 127.0.0.1 only,
// IPC schemas, the renderer never gets the voice code), versions.
const fs = require('fs'), path = require('path'), os = require('os');
const R = process.env.NYX_ROOT || path.join(__dirname, '..');
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const read = (f) => { try { return fs.readFileSync(path.join(R, f), 'utf8'); } catch (_) { return ''; } };
const VM = require(path.join(R, 'main/voice2613.js'));
const NV = require(path.join(R, 'app/js/v26/voice2613.js'));
const FX = path.join(__dirname, 'fixtures', 'personas-ster.json');
const fxText = fs.readFileSync(FX, 'utf8'); const fxJson = JSON.parse(fxText);
const DUMMY = fxJson[0].voice.rvq.b64, REF = fxJson[0].voice.refText;

(async () => {
  // ---- (α) parsing ----
  const P = VM.parsePersonas(fxText);
  ok(P.ok && P.personas.length === 4, '(α) the fixture parses: 4 personas', P.error);
  const ster = P.personas.find((p) => p.name === 'ster');
  ok(ster && ster.id === '91456a431e6f' && ster.type === 'clone' && ster.ready, '(α) ster: id 91456a431e6f, clone, ready', ster && VM._pub(ster));
  ok(ster && ster.rvq === DUMMY && ster.refText === REF && ster.steps === 48 && ster.guidance === 2.5, '(α) ster: rvq.b64 + refText + steps 48 + guidance_scale 2.5');
  ok(ster && !('refFile' in ster) && !JSON.stringify(ster).includes('Administrator'), '(α) voice.refFile (old C:\\Users\\Administrator path) is ignored');
  const n2 = P.personas.find((p) => p.name === 'Νίκος'); ok(n2 && n2.ready && n2.steps === null && n2.guidance === null, '(α) a clone without tts settings: ready, steps/guidance not sent');
  ok(P.personas.find((p) => p.name === 'Αφηγητής').reason === 'type' && P.personas.find((p) => p.name === 'μισό').reason === 'no_ref_text', '(α) not ready: non-clone (type) / clone without refText (no_ref_text)');
  ok(VM.parsePersonas(JSON.stringify({ personas: fxJson })).ok, '(α) also accepts { personas: [...] }');
  ok(VM.parsePersonas('\uFEFF' + fxText).ok, '(α) a UTF-8 BOM is fine');
  for (const [bad, why] of [['{oops', 'broken JSON'], ['{"version":2,"items":[]}', 'no list'], ['[{"title":"x"}]', 'entries without name'], ['"x"', 'a string']]) {
    const r = VM.parsePersonas(bad); ok(!r.ok && r.error.code === 'personas_schema', `(α) schema change (${why}) → personas_schema, no crash`, r);
  }
  const bad64 = JSON.parse(fxText); bad64[0].voice.rvq.b64 = 'not base64 !!'; ok(VM.parsePersonas(JSON.stringify(bad64)).personas[0].reason === 'no_rvq', '(α) an invalid rvq.b64 → not ready (no_rvq)');
  // path through the existing paths helper
  ok(VM.personasFile({ env: { APPDATA: 'C:\\Users\\jo\\AppData\\Roaming' }, platform: 'win32' }) === 'C:\\Users\\jo\\AppData\\Roaming\\GPU Voice Studio\\personas.json', '(α) %APPDATA%\\GPU Voice Studio\\personas.json (paths.expandVars)');
  ok(VM.personasFile({ env: { USERPROFILE: 'C:\\Users\\jo' }, platform: 'win32' }) === 'C:\\Users\\jo\\AppData\\Roaming\\GPU Voice Studio\\personas.json', '(α) without APPDATA: <home>\\AppData\\Roaming');
  // read only: the file is opened with flag 'r' and never written
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx2613u-')); const f = path.join(tmp, 'personas.json'); fs.writeFileSync(f, fxText);
  fs.chmodSync(f, 0o444); const st0 = fs.statSync(f);
  const calls = []; const rf = (p) => { calls.push(p); return fs.promises.readFile(p, { encoding: 'utf8', flag: 'r' }); };
  const rr = await VM.readPersonas({ file: f, readFile: rf });
  const st1 = fs.statSync(f);
  ok(rr.ok && calls.length === 1 && st1.mtimeMs === st0.mtimeMs && fs.readFileSync(f, 'utf8') === fxText, '(α) read only: one read, file unchanged (read-only file on disk works)');
  const rr2 = await VM.readPersonas({ file: f }); ok(rr2.ok, '(α) default reader works on a read-only file');
  const src = read('main/voice2613.js');
  ok(/flag: 'r'/.test(src) && !/writeFile\(\s*file|writeFileSync|appendFile|fsp\.open\([^)]*'w|rename\(|unlink\(/.test(src.replace(/writeFile = deps\.writeFile[^\n]*/, '')), '(α) static: personas.json opened with flag r; no write / rename / delete');
  const miss = await VM.readPersonas({ file: path.join(tmp, 'nope.json') }); ok(!miss.ok && miss.error.code === 'personas_missing', '(α) missing file → personas_missing');

  // ---- (β) body ----
  const B = VM.synthBody('Καλημέρα.', ster, 'el');
  ok(B.text === 'Καλημέρα.' && B.language === 'el' && B.ref_rvq_b64 === DUMMY && B.ref_text === REF && B.steps === 48 && B.guidance_scale === 2.5, '(β) body {text, language:"el", ref_rvq_b64, ref_text, steps:48, guidance_scale:2.5}', Object.keys(B));
  ok(Object.keys(B).sort().join() === 'guidance_scale,language,ref_rvq_b64,ref_text,steps,text', '(β) no other fields (no refFile / ref_audio)');
  const Bn = VM.synthBody('x', n2, 'el'); ok(!('steps' in Bn) && !('guidance_scale' in Bn) && Bn.ref_text === 'DUMMY-REF-2', '(β) no steps/guidance in the persona → not sent (engine defaults)');
  let thrown = null; try { VM.synthBody('x', { ...ster, refText: '' }, 'el'); } catch (e) { thrown = e.code; } ok(thrown === 'bad_reference', '(β) ref_rvq_b64 without ref_text is never sent (bad_reference before the request)');
  const G = VM.synthBody('x', null, 'el'); ok(Object.keys(G).sort().join() === 'language,text', '(β) «Γενική γυναικεία» = no ref fields');
  ok(VM.synthBody('x', null, 'en').language === 'en' && VM.synthBody('x', null, 'zz').language === 'el', '(β) language el (en only for English text)');

  // ---- (γ) splitter ----
  const S = (s) => NV.splitSentences(s);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(eq(S('Κοστίζει 19,90 €. Ανοίγει στις 09:45 κάθε μέρα.'), ['Κοστίζει 19,90 €.', 'Ανοίγει στις 09:45 κάθε μέρα.']), '(γ) 19,90 and 09:45 are not cut', S('Κοστίζει 19,90 €. Ανοίγει στις 09:45 κάθε μέρα.'));
  ok(eq(S('Φέρε φρούτα, λαχανικά κ.λπ. και γάλα. Μετά πάμε σπίτι!'), ['Φέρε φρούτα, λαχανικά κ.λπ. και γάλα.', 'Μετά πάμε σπίτι!']), '(γ) «κ.λπ.» is not a sentence end');
  ok(eq(S('Π.χ. το 3.5 είναι μικρό; Ναι.'), ['Π.χ. το 3.5 είναι μικρό;', 'Ναι.']), '(γ) «Π.χ.», 3.5, Greek question mark ;');
  ok(eq(S('Ήρθαν όλοι κ.ά. Μετά φύγαμε.'), ['Ήρθαν όλοι κ.ά. Μετά φύγαμε.']), '(γ) «κ.ά.» followed by a capital: not cut (abbreviation wins)');
  ok(eq(S('Είναι ακριβό, δηλ. 19.90 ευρώ. Εντάξει;'), ['Είναι ακριβό, δηλ. 19.90 ευρώ.', 'Εντάξει;']), '(γ) «δηλ.» and 19.90');
  ok(eq(S('Στις 16.11.2026 ο Γ. Παπαδόπουλος ήρθε... Τι λες;'), ['Στις 16.11.2026 ο Γ. Παπαδόπουλος ήρθε...', 'Τι λες;']), '(γ) a date, an initial «Γ.», «...»');
  ok(eq(S('Βλ. σελ. 4 για λεπτομέρειες. Τέλος.'), ['Βλ. σελ. 4 για λεπτομέρειες.', 'Τέλος.']), '(γ) «Βλ.», «σελ.»');
  ok(eq(S('Είπε «Γεια.» Και έφυγε.'), ['Είπε «Γεια.»', 'Και έφυγε.']), '(γ) closing quotes stay with their sentence');
  ok(eq(S('Πρώτη γραμμή\nΔεύτερη γραμμή'), ['Πρώτη γραμμή', 'Δεύτερη γραμμή']), '(γ) a new line is a break');
  ok(eq(S('It costs 19.90 e.g. today. Fine!'), ['It costs 19.90 e.g. today.', 'Fine!']), '(γ) English «e.g.»');
  ok(S('λέξη '.repeat(200)).every((x) => x.length <= 401) && S('λέξη '.repeat(200)).join(' ').split(/\s+/).length === 200, '(γ) a very long sentence is cut at a space, nothing lost');
  ok(S('').length === 0 && S('   ').length === 0, '(γ) empty text → nothing');

  // ---- (δ) missing persona → UI error, nothing started, nothing sent ----
  const spy = { start: 0, req: 0 };
  const eng = VM.create({ vsengine: { start: async () => { spy.start++; return { port: 50123 }; }, token: () => 'OWN-TOKEN-0123456789abcdef', status: () => ({ running: false }), stop: () => {} }, secrets: {}, env: { OMNIVOICE_HERMES_TOKEN: 'HERMES-TOKEN-SECRET-123456' }, req: async () => { spy.req++; return { status: 200, ctype: 'audio/wav', buf: Buffer.alloc(100) }; } });
  const noSter = JSON.stringify(fxJson.filter((p) => p.name !== 'ster')); const f2 = path.join(tmp, 'p2.json'); fs.writeFileSync(f2, noSter);
  let b = await eng.begin({}, '', { file: f2 });
  ok(!b.ok && b.code === 'persona_missing' && b.voice === 'ster' && spy.start === 0 && spy.req === 0, '(δ) ster missing → persona_missing; no engine started, no request (no fallback)', { b, spy });
  b = await eng.begin({}, 'μισό', { file: f }); ok(!b.ok && b.code === 'persona_not_ready' && spy.req === 0, '(δ) a persona that is not ready → persona_not_ready');
  b = await eng.begin({}, 'ster', { file: path.join(tmp, 'nope.json') }); ok(!b.ok && b.code === 'personas_missing' && spy.req === 0, '(δ) no personas.json → personas_missing');
  fs.writeFileSync(path.join(tmp, 'bad.json'), '{"v":3}'); b = await eng.begin({}, 'ster', { file: path.join(tmp, 'bad.json') }); ok(!b.ok && b.code === 'personas_schema' && spy.req === 0, '(δ) schema changed → personas_schema');
  b = await eng.begin({}, 'generic', { file: path.join(tmp, 'nope.json') }); ok(b.ok && b.voice.id === 'generic', '(δ) «Γενική γυναικεία» works without personas.json — only when chosen');
  const lst = await eng.list({ file: f, probe: false });
  ok(lst.ok && lst.personas.length === 4 && !JSON.stringify(lst).includes(DUMMY) && !JSON.stringify(lst).includes('DUMMY-REF'), '(δ) the list for the renderer: names / ids / ready — no rvq, no reference text');
  ok(lst.def === 'ster' && lst.generic === 'generic', '(δ) default voice ster');
  const core = read('app/js/v2/core.js'), hub = read('app/js/v26/voicehub2613.js');
  for (const c of ['personas_missing', 'personas_schema', 'persona_missing', 'persona_not_ready', 'engine_start', 'engine_down', 'engine_token', 'bad_reference']) ok(core.includes(`'${c}'`), `(δ) UI message for ${c}`);
  ok(/v2613\.err_missing/.test(hub) && /v2613\.no_fallback/.test(hub) && /role: 'alert'/.test(hub), '(δ) Hub: error box (role=alert) + «no fallback» note');
  const el = JSON.parse(read('app/locales/el.json')), en = JSON.parse(read('app/locales/en.json'));
  const keys = Object.keys(el).filter((k) => k.startsWith('v2613.')); ok(keys.length >= 30 && keys.every((k) => en[k]), 'locales: v2613.* in el + en', keys.length);
  ok(el['v2613.generic'] === 'Γενική γυναικεία' && el['v2613.voice'] === 'Φωνή απάντησης' && el['v2613.engine_hermes'] === 'OmniVoice του Hermes (7802)' && /δικός μου vs-engine/.test(el['v2613.engine_own']), 'labels: «Φωνή απάντησης», «Γενική γυναικεία», «OmniVoice του Hermes (7802)», «δικός μου vs-engine»');

  // ---- redaction ----
  const rd = VM.redactor(['HERMES-TOKEN-SECRET-123456', DUMMY, REF]);
  const line = rd(`Bearer HERMES-TOKEN-SECRET-123456 body ${DUMMY} ${REF} Authorization: Bearer xyz`);
  ok(!line.includes('HERMES-TOKEN') && !line.includes(DUMMY) && !line.includes('DUMMY-REF') && !/Bearer xyz/.test(line), 'redaction: token / rvq / reference text / any Bearer value → ***', line);

  // ---- static ----
  ok(!/child_process|spawn\(|exec\(|execFile/.test(src), 'main/voice2613.js: no new process (the own engine is started by vsengine.start, unchanged)');
  const urls = (src.match(/https?:\/\/[^\s'"`]+/g) || []); ok(urls.every((u) => u.startsWith('http://127.0.0.1')), 'only 127.0.0.1 URLs (no new external URL)', urls);
  ok(/\/v1\/status/.test(src) && /HERMES_PORT = 7802/.test(src) && /OMNIVOICE_HERMES_TOKEN/.test(src) && /\/v1\/synthesize/.test(src), 'probe GET 127.0.0.1:7802/v1/status with OMNIVOICE_HERMES_TOKEN; POST /v1/synthesize');
  ok(!/reg(\.exe)?['"]?\s*,\s*\[\s*['"]query|HKCU/.test(src), 'no registry read (token from the environment or a file only — no new spawn)');
  ok(!/cfg\.[A-Za-z]*token|\bsettings\b|\bStore\./.test(src.replace(/^\s*\/\/.*$/gm, '')) && /OMNIVOICE_HERMES_TOKEN_FILE/.test(src), 'the OmniVoice token never comes from / goes to Nyx settings (env or file only)');
  { const v2 = read('main/v2.js'); const h = v2.slice(v2.indexOf("H('tts:voiceList2613'"), v2.indexOf("H('tts:voiceCancel2613'") + 80);
    ok(h.length > 80 && !/OMNIVOICE|token/i.test(h), 'the voice IPC handlers never pass a token to the renderer'); }
  ok(/if \(\+ownCfg\.port === HERMES_PORT\) ownCfg\.port = ''/.test(src), 'the own vs-engine never takes port 7802');
  const guard = read('main/ipc-guard.js');
  ok(/'tts:voiceList2613': \['o\?'\], 'tts:voiceBegin2613': \['o\?', 's\?'\], 'tts:voiceSpeak2613': \['n', 's', 's\?'\], 'tts:voiceCancel2613': \[\]/.test(guard), 'IPC channels validated in ipc-guard like the others');
  ok(/require\('\.\/vsengine'\)/.test(read('main/v2.js')) && read('main/vsengine.js') === require('child_process').execSync('git show c79c15e:main/vsengine.js', { cwd: R }).toString(), 'main/vsengine.js unchanged (start, port, token as before)');
  { const cpx = require('child_process'); const names = cpx.execSync('git diff --name-only c79c15e -- main main.js preload.js app/preload.js boot.js', { cwd: R }).toString().trim().split('\n').filter(Boolean);
    ok(names.sort().join(',') === 'main/ipc-guard.js,main/v2.js,main/voice2613.js', 'main-process change limited to voice2613.js + v2.js + ipc-guard.js (preload / router / models untouched)', names);
    const rem = cpx.execSync('git diff -U0 c79c15e -- main/v2.js main/ipc-guard.js', { cwd: R }).toString().split('\n').filter((l) => /^-[^-]/.test(l));
    ok(rem.length === 0, 'v2.js / ipc-guard.js: lines only added (existing IPC and handlers kept)', rem); }
  ok(/if \(T\.mode === 'vsserver'\) return this\.speakVoice\(text, T\)/.test(core) && /tts:voiceCancel2613/.test(core), 'Speech: vs-engine mode speaks with the chosen voice; stop / a new answer cancels the queue');
  const html = read('app/index.html'); ok(html.indexOf('js/v26/voice2613.js') > 0 && html.indexOf('js/v26/voice2613.js') < html.indexOf('js/v2/core.js') && /v2613\.css/.test(html) && /voicehub2613\.js/.test(html), 'index.html loads voice2613.js (before core.js), voicehub2613.js, v2613.css');
  const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json')); const CH = JSON.parse(read('CHANGELOG.json'));
  ok(pkg.version === '2.6.13' && lock.version === '2.6.13' && lock.packages[''].version === '2.6.13', 'version 2.6.13 (package.json + package-lock)');
  ok(Object.keys(CH)[0] === '2.6.13' && CH['2.6.13'].el.length === 1 && CH['2.6.12.2'], 'CHANGELOG 2.6.13 first, 2.6.12.2 kept');
  ok(pkg.devDependencies.electron === '45.2.3', 'Electron 45.2.3');
  console.log(`\nv2.6.13 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
