// Nyx v2.5.1 security unit tests (plain node): central IPC guard (schemas, validators, sender check, install wrapper),
// signed code-folder verification at boot (tamper / unsigned / extra file), unpacked-file integrity, no insecure flags anywhere.
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const ROOT = path.join(__dirname, '..'); const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v251u-'));
const G = require('../main/ipc-guard'); const core = require('../main/update-core');
const WIN = process.platform === 'win32'; const ABS = WIN ? 'C:\\Users\\jonh\\a.png' : '/home/jonh/a.png';

console.log('IPC guard: every registered channel has a schema');
const src = ['main.js', ...fs.readdirSync(path.join(ROOT, 'main')).filter(f => f.endsWith('.js')).map(f => 'main/' + f)].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const used = new Set(); for (const m of src.matchAll(/(?:\bH|ipcMain\.(?:handle|on))\(\s*'([a-z0-9]+:[\w.-]+)'/gi)) used.add(m[1]);
const missing = [...used].filter(c => !G.SCHEMA[c]); ok(used.size > 100 && missing.length === 0, `all ${used.size} channels found in code have a schema`, missing);
const unknownTypes = Object.entries(G.SCHEMA).flatMap(([c, s]) => s.filter(t => !G.T[t.replace(/\?$/, '')]).map(t => c + ':' + t)); ok(unknownTypes.length === 0, 'every schema type exists', unknownTypes);

console.log('IPC guard: argument validators');
const chk = (ch, ...a) => G.checkArgs(ch, a);
ok(chk('open:external', 'https://example.com/x') === null, 'open:external accepts https');
ok(chk('open:external', 'mailto:me@example.com') === null, 'open:external accepts mailto');
for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'smb://host/share', 'ms-settings:', 'C:\\Windows\\calc.exe', 42]) ok(chk('open:external', bad) !== null, 'open:external rejects ' + JSON.stringify(bad));
ok(chk('web:fetch', 'file:///etc/passwd') !== null && chk('web:fetch', 'https://example.com') === null, 'web:fetch: http(s) only (file:// rejected)');
ok(chk('media:importPath', ABS) === null, 'absolute local path accepted');
for (const bad of ['relative/a.png', '../a.png', '\\\\server\\share\\a.png', '//server/share/a.png', ABS + '\u0000.png', 'a\nb', '', null, { p: ABS }]) ok(chk('media:importPath', bad) !== null, 'path rejected: ' + JSON.stringify(bad));
if (WIN) ok(chk('media:importPath', '\\\\?\\C:\\x') !== null, 'device path rejected');
ok(chk('upd:installFile', ABS.replace('.png', '.zip')) === null && chk('upd:installFile', ABS) !== null, 'upd:installFile: .zip only');
ok(chk('upd:installFile') === null, 'optional argument may be omitted');
ok(chk('upd:rollback', 1) !== null, 'extra arguments rejected');
ok(chk('upd:rollback', undefined) === null, 'trailing undefined tolerated');
ok(G.T.name('photo.png') && !G.T.name('../photo.png') && !G.T.name('a/b.png') && !G.T.name('..'), 'media names: basename only');
ok(!G.T.s('x'.repeat(3 * 1024 * 1024)), 'oversized string rejected');
let deep = {}; const d0 = deep; for (let i = 0; i < 100; i++) { deep.x = {}; deep = deep.x; } ok(!G.T.any(d0), 'absurdly deep objects rejected');
ok(!G.T.wc(0) && !G.T.wc(1.5) && G.T.wc(7), 'webContents id: positive integer');

console.log('IPC guard: sender check');
G.install({ handle() {}, on() {} }, { appDir: path.join(ROOT, 'app') }); // sets the page list (wrapper on a dummy)
const fileUrl = (p) => require('url').pathToFileURL(p).href;
const ev = (url, { type = 'window', parent = null, destroyed = false } = {}) => ({ sender: { isDestroyed: () => destroyed, getType: () => type }, senderFrame: { url, parent } });
ok(G.trustedSender(ev(fileUrl(path.join(ROOT, 'app', 'index.html')))), 'app index.html (top frame) trusted');
ok(G.trustedSender(ev(fileUrl(path.join(ROOT, 'app', 'widget.html')) + '?x=1#y')), 'widget.html with query trusted');
ok(!G.trustedSender(ev('https://evil.example/')), 'remote page rejected');
ok(!G.trustedSender(ev('data:text/html,hi')), 'data: page rejected');
ok(!G.trustedSender(ev(fileUrl(path.join(ROOT, 'app', 'vendor', 'x.html')))), 'other local file rejected');
ok(!G.trustedSender(ev(fileUrl(path.join(os.tmpdir(), 'index.html')))), 'index.html elsewhere rejected');
ok(!G.trustedSender(ev(fileUrl(path.join(ROOT, 'app', 'index.html')), { type: 'webview' })), 'webview guest rejected');
ok(!G.trustedSender(ev(fileUrl(path.join(ROOT, 'app', 'index.html')), { parent: {} })), 'sub-frame rejected');
ok(!G.trustedSender({ sender: null }), 'missing sender rejected');

console.log('IPC guard: install wraps handle/on');
{
  const reg = {}; const fake = { handle: (c, f) => { reg[c] = f; }, on: (c, f) => { reg[c] = f; }, addListener: null, once: null, handleOnce: null };
  // fresh module instance (install is once-per-process)
  delete require.cache[require.resolve('../main/ipc-guard')]; const G2 = require('../main/ipc-guard');
  G2.install(fake, { appDir: path.join(ROOT, 'app') });
  let threw = false; try { fake.handle('nope:x', () => 1); } catch (e) { threw = true; } ok(threw, 'unknown channel cannot be registered');
  threw = false; try { fake.handleOnce('upd:info', () => 1); } catch (e) { threw = true; } ok(threw, 'handleOnce refused');
  fake.handle('open:external', (e, u) => 'ran ' + u);
  const good = ev(fileUrl(path.join(ROOT, 'app', 'index.html')));
  ok(reg['open:external'](good, 'https://a.example/') === 'ran https://a.example/', 'valid call reaches the handler');
  threw = null; try { reg['open:external'](good, 'file:///etc/passwd'); } catch (e) { threw = e; } ok(threw && threw.code === 'IPC_REJECTED', 'bad argument → IPC_REJECTED, handler not run');
  threw = null; try { reg['open:external'](ev('https://evil.example/'), 'https://a.example/'); } catch (e) { threw = e; } ok(threw && /untrusted sender/.test(threw.message), 'untrusted sender → rejected');
  fake.on('state:saveSync', (e) => { e.returnValue = 'saved'; }); const se = ev('https://evil.example/'); reg['state:saveSync'](se, 'x');
  ok(se.returnValue && se.returnValue.ok === false, 'sync channel from untrusted sender gets {ok:false}');
}

console.log('Signed code folder verification (boot)');
{
  const priv = crypto.generateKeyPairSync('ed25519'); const PRIV = priv.privateKey.export({ type: 'pkcs8', format: 'pem' }); const PUB = priv.publicKey.export({ type: 'spki', format: 'pem' });
  const mk = (d, v) => { fs.mkdirSync(path.join(d, 'app'), { recursive: true }); fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'nyx-canvas', version: v, main: 'main.js' })); for (const f of ['main.js', 'preload.js', 'boot.js']) fs.writeFileSync(path.join(d, f), '// ' + f + ' ' + v); fs.writeFileSync(path.join(d, 'app', 'index.html'), '<!doctype html>' + v); return d; };
  const base = mk(path.join(TMP, 'b'), '9.0.0'), to = mk(path.join(TMP, 't'), '9.0.1');
  const E = process.versions.electron || '45.2.1';
  const P = core.buildPatch({ fromFiles: null, toDir: to, toVersion: '9.0.1', electron: E, privateKey: PRIV }); const zf = path.join(TMP, 'p.zip'); fs.writeFileSync(zf, P.zip);
  const root = path.join(TMP, 'code');
  core.applyPatch(zf, { root, currentDir: base, currentVersion: '9.0.0', electron: E, publicKey: PUB });
  const dir = path.join(root, '9.0.1');
  ok(fs.existsSync(path.join(dir, '.nyx-signed.json')), 'applied folder stores the signed manifest');
  ok(core.verifyCodeDir(dir, PUB, '9.0.1').ok, 'untouched folder verifies');
  const boot = (pk) => core.chooseBoot(root, { builtinVersion: '9.0.0', electron: E, publicKey: pk });
  ok(boot(PUB).version === '9.0.1', 'boot picks the verified folder');
  fs.appendFileSync(path.join(dir, 'main.js'), '\nrequire("child_process").exec("calc")');
  ok(core.verifyCodeDir(dir, PUB, '9.0.1').why === 'hash main.js', 'modified main.js detected');
  ok(boot(PUB).version === '9.0.0', 'tampered folder skipped → bundled version boots');
  core.applyPatch(zf, { root, currentDir: base, currentVersion: '9.0.0', electron: E, publicKey: PUB }); // reinstall
  ok(core.verifyCodeDir(dir, PUB, '9.0.1').ok, 'reinstall restores a valid folder');
  fs.writeFileSync(path.join(dir, 'app', 'evil.js'), 'x'); ok(core.verifyCodeDir(dir, PUB, '9.0.1').why === 'file set', 'extra file detected'); fs.rmSync(path.join(dir, 'app', 'evil.js'));
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  ok(core.verifyCodeDir(dir, other, '9.0.1').why === 'signature', 'wrong public key → signature fails');
  ok(core.verifyCodeDir(dir, PUB, '9.0.2').why === 'manifest', 'version mismatch detected');
  const rec = JSON.parse(fs.readFileSync(path.join(dir, '.nyx-signed.json'), 'utf8')); const m = JSON.parse(Buffer.from(rec.manifest, 'base64')); m.files['main.js'].sha256 = '0'.repeat(64);
  fs.writeFileSync(path.join(dir, '.nyx-signed.json'), JSON.stringify({ manifest: Buffer.from(JSON.stringify(m)).toString('base64'), sig: rec.sig }));
  ok(core.verifyCodeDir(dir, PUB, '9.0.1').why === 'signature', 'edited manifest (re-hashed file) → signature fails');
  fs.rmSync(path.join(dir, '.nyx-signed.json')); ok(core.verifyCodeDir(dir, PUB, '9.0.1').why === 'unsigned', 'folder from an older updater (no signed manifest) → not trusted');
}

console.log('Unpacked files integrity (app.asar.unpacked)');
{
  const ui = require('../main/unpacked-integrity');
  const H = require('../main/unpacked-sha256.json').files;
  ok(Object.keys(H).some(k => k.startsWith('app/plugins/')) && Object.keys(H).some(k => k.startsWith('main/res/')), 'hash table covers plugins + PowerShell helpers');
  const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-unpacked-hashes.js'), '--check']); ok(r.status === 0, 'hash table matches the shipped files', String(r.stderr));
  const fakeRoot = path.join(TMP, 'resources', 'app.asar.unpacked', 'main', 'res'); fs.mkdirSync(fakeRoot, { recursive: true });
  ok(ui.isUnpacked(path.join(fakeRoot, 'gpu.ps1')) && !ui.isUnpacked(path.join(ROOT, 'main', 'res', 'gpu.ps1')), 'only app.asar.unpacked paths are checked');
  // packaged layout: a plugin read through …/app.asar/app/plugins/… (Electron redirects it to app.asar.unpacked) is checked too
  const asarDir = path.join(TMP, 'pk', 'resources', 'app.asar'); fs.mkdirSync(path.join(asarDir, 'main'), { recursive: true }); fs.mkdirSync(path.join(asarDir, 'app', 'plugins', 'demo'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'main', 'unpacked-integrity.js'), path.join(asarDir, 'main', 'unpacked-integrity.js'));
  const man = path.join(asarDir, 'app', 'plugins', 'demo', 'manifest.json'); fs.writeFileSync(man, '{"id":"demo"}');
  fs.writeFileSync(path.join(asarDir, 'main', 'unpacked-sha256.json'), JSON.stringify({ files: { 'app/plugins/demo/manifest.json': require('crypto').createHash('sha256').update('{"id":"demo"}').digest('hex') } }));
  const ui2 = require(path.join(asarDir, 'main', 'unpacked-integrity.js'));
  ok(ui2.mustVerify(man) && String(ui2.readVerified(man)) === '{"id":"demo"}' && !ui2.mustVerify(path.join(asarDir, 'main', 'x.js')), 'packaged: plugin read via the app.asar path is hash-checked; other asar files are left to Electron');
  fs.writeFileSync(man, '{"id":"demo","evil":1}'); let thr = ''; try { ui2.readVerified(man); } catch (e) { thr = e.message; } ok(/modified file app\/plugins\/demo\/manifest\.json/.test(thr), 'packaged: modified plugin manifest → refused', thr);
  const extra = path.join(asarDir, 'app', 'plugins', 'demo', 'plugin.js'); fs.writeFileSync(extra, 'x'); thr = ''; try { ui2.readVerified(extra); } catch (e) { thr = e.message; } ok(/unknown unpacked file/.test(thr), 'packaged: extra file dropped into a built-in plugin → refused', thr);
}

console.log('No insecure switches anywhere');
{
  const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', 'dist', 'shots', 'vendor'].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|json|cjs|mjs|html|bat|sh|ps1)$/.test(e.name)) files.push(p); } };
  walk(ROOT); const me = path.resolve(__filename);
  const hits = files.filter(f => f !== me).filter(f => fs.readFileSync(f, 'utf8').split('\n').some(l => !/commandLine\.hasSwitch/.test(l) && /--no-sandbox|disable-web-security|webSecurity:\s*false|nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|allowRunningInsecureContent:\s*true|--disable-gpu-sandbox|chromiumSandbox:\s*false/.test(l))).map(f => path.relative(ROOT, f));
  ok(hits.length === 0, `no --no-sandbox / disabled web security / node in renderers (${files.length} files)`, hits);
  const launches = files.filter(f => /tests[\\/]/.test(f)).flatMap(f => (fs.readFileSync(f, 'utf8').match(/_electron\.launch\(\{[^\n]{0,60}/g) || []).map(m => [path.basename(f), m]));
  ok(launches.length > 10 && launches.every(([, m]) => /chromiumSandbox: true/.test(m)), `every Playwright launch keeps the Chromium sandbox (${launches.length} launches; Playwright adds --no-sandbox otherwise)`, launches.filter(([, m]) => !/chromiumSandbox: true/.test(m)));
  ok(/for \(const sw of \['no-sandbox', 'disable-web-security'/.test(fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8')), 'main.js refuses to start with sandbox / web-security switches');
  const pre = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  ok(/contextBridge\.exposeInMainWorld\('nyxAPI'/.test(pre) && !/exposeInMainWorld\([^)]*ipcRenderer\s*\)/.test(pre) && !/require\('(fs|child_process|path)'\)/.test(pre), 'preload exposes only wrapper functions (no ipcRenderer / Node modules)');
  for (const f of ['index.html', 'widget.html', 'sticky.html', 'capture.html']) { const h = fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'); const csp = (h.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || ''; ok(/default-src 'none'/.test(csp) && /object-src 'none'/.test(csp) && !/https?:|\*|unsafe-eval/.test(csp), f + ': strict CSP, no remote origins', csp); }
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nv2.5.1 unit: ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
