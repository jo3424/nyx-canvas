// Nyx v2.6.3 security unit checks (no Electron needed): node tests/v263-unit.js
//  • every ipcMain channel in main.js / main/*.js has an argument schema (the guard throws otherwise)
//  • the v2.6 drag-out / drop-in payloads pass the guard; hostile ones do not
//  • dnd.plan never leaves the media folder and only writes http(s) shortcuts
//  • the single session onBeforeRequest listener keeps BOTH rules (v2.6 B-14 script folder + v2.5.1 remote block)
//  • both update signing keys are trusted
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto'), Module = require('module');
const ROOT = path.join(__dirname, '..');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); c ? passes++ : fails++; };

// ---- electron stub (only what secure.js touches at load / in wireSession)
const listeners = []; const stubElectron = {
  app: { on() {} }, shell: { openExternal() {} }, net: {},
  protocol: { handle() {}, registerSchemesAsPrivileged() {} },
  session: { defaultSession: { webRequest: { onBeforeRequest: (filter, fn) => listeners.push({ filter, fn }) } } },
};
const load0 = Module._load; Module._load = function (req, ...r) { return req === 'electron' ? stubElectron : load0.call(this, req, ...r); };

const guard = require(path.join(ROOT, 'main', 'ipc-guard.js'));
console.log('IPC schema coverage');
const files = [path.join(ROOT, 'main.js'), ...fs.readdirSync(path.join(ROOT, 'main')).filter(f => f.endsWith('.js')).map(f => path.join(ROOT, 'main', f))];
const chans = new Set();
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:ipcMain\.(?:handle|on)|\bH|\bOn)\(\s*['"`]([a-zA-Z0-9]+:[a-zA-Z0-9:_-]+)['"`]/g)) chans.add(m[1]);
const missing = [...chans].filter(c => !Object.hasOwn(guard.SCHEMA, c));
ok(chans.size > 150 && missing.length === 0, `all ${chans.size} registered channels have a schema`, missing);
ok(!Object.hasOwn(guard.SCHEMA, 'photo:attach') && !chans.has('photo:attach'), 'photo:attach (removed in v2.6, B-24) is gone from code and schema');
for (const c of ['drag:start', 'web:dropImage', 'file:importImage', 'plugins:installPending']) ok(Object.hasOwn(guard.SCHEMA, c), 'v2.6 channel guarded: ' + c);

console.log('Drag & drop payloads');
const chk = (ch, args) => { try { return guard.checkArgs(ch, args) !== false; } catch (e) { return false; } };
const r0 = guard.checkArgs('drag:start', [[{ file: 'abcde-a1b2c3-photo.png', name: 'photo.png' }]]);
const passOk = (ch, args) => { const r = (() => { try { return guard.checkArgs(ch, args); } catch (e) { return e; } })(); return !(r instanceof Error) && r !== false && !(typeof r === 'string'); };
ok(passOk('drag:start', [[{ file: 'abcde-a1b2c3-photo.png', name: 'photo.png' }, { url: 'https://example.com/a', name: 'example.com' }, { text: 'hello\nworld', name: 'hello.txt' }, 'abcde-a1b2c3-x.jpg']]), 'drag-out list (media / link / text / bare media name) accepted', r0);
ok(passOk('drag:start', [[{ file: 'abcde-a1b2c3-v.mp4', name: '' }]]), 'media card without a title accepted');
ok(!passOk('drag:start', [[{ url: 'file:///etc/passwd' }]]), 'file: link rejected');
ok(!passOk('drag:start', [[{ url: 'javascript:alert(1)' }]]), 'javascript: link rejected');
ok(!passOk('drag:start', [[{ name: 'x' }]]), 'item without file/url/text rejected');
ok(!passOk('drag:start', [[{ file: 'a.png', exec: 'calc' }]]), 'unknown keys rejected');
ok(!passOk('drag:start', ['abcde-a1b2c3-x.jpg']), 'non-array rejected');
ok(!passOk('drag:start', [[{ text: 'x'.repeat(8 * 1024 * 1024 + 1) }]]), 'text over 8 MB rejected');
ok(passOk('file:importImage', ['photo.png', new Uint8Array([137, 80, 78, 71])]) && passOk('file:importImage', [undefined, new Uint8Array(4)]), 'file:importImage(name, bytes) accepted');
ok(!passOk('file:importImage', ['a\0b', new Uint8Array(4)]) && !passOk('file:importImage', ['a.png', 'not bytes']), 'file:importImage with NUL name / non-bytes rejected');
ok(passOk('web:dropImage', ['https://example.com/i.jpg', { referer: 'https://example.com/', hint: 'web' }]), 'web:dropImage(https, opts) accepted');
ok(!passOk('web:dropImage', ['file:///C:/Windows/win.ini']) && !passOk('web:dropImage', ['data:image/png;base64,AA==']), 'web:dropImage with file:/data: rejected');

console.log('dnd.plan stays in the media folder');
const dnd = require(path.join(ROOT, 'main', 'dnd.js'));
const MD = path.join(os.tmpdir(), 'nyx-media-x');
const pl = dnd.plan([{ file: '../../../etc/passwd' }, { file: 'C:\\Windows\\system32\\cmd.exe' }, { url: 'file:///etc/passwd' }, { url: 'https://a.example/x' }, { text: 'hi', name: '../../evil.bat' }], MD);
ok(pl.filter(s => s.kind === 'file').every(s => path.dirname(s.src) === MD), 'file sources are basenames inside the media folder', pl);
ok(pl.filter(s => /\.url$/.test(s.name)).length === 1 && pl.every(s => !/file:/.test(s.content || '')), 'only http(s) links become .url shortcuts', pl);
ok(pl.every(s => !/[\\/]/.test(s.name)) && pl.some(s => s.name === 'evil.bat.txt'), 'written names are sanitised (no folders, text stays .txt)', pl.map(s => s.name));

console.log('Session request filter (one listener, both rules)');
const secure = require(path.join(ROOT, 'main', 'secure.js'));
const APPDIR = path.join(ROOT, 'app');
secure.wireSession({ scriptDir: APPDIR });
ok(listeners.length === 1, 'exactly one onBeforeRequest listener registered', listeners.length);
const L = listeners[0];
ok(['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file:///*'].every(u => L.filter.urls.includes(u)), 'filter covers http(s), ws(s) and file:', L.filter.urls);
const run = (d) => new Promise(res => L.fn(d, res));
const furl = (p) => require('url').pathToFileURL(p).href;
(async () => {
  const warn0 = console.warn; console.warn = () => {};
  const a = await run({ url: furl(path.join(APPDIR, 'js', 'app.js')), resourceType: 'script', webContentsId: 1 });
  const b = await run({ url: furl(path.join(os.tmpdir(), 'evil.js')), resourceType: 'script', webContentsId: 1 });
  const c = await run({ url: furl(path.join(APPDIR, '..', 'main', 'secure.js')), resourceType: 'script', webContentsId: 1 });
  const d = await run({ url: furl(path.join(os.tmpdir(), 'pic.png')), resourceType: 'image', webContentsId: 1 });
  const e = await run({ url: 'https://example.com/x.js', resourceType: 'script', webContentsId: 99999 });
  console.warn = warn0;
  ok(!a.cancel, 'app-folder script allowed', a);
  ok(b.cancel === true && c.cancel === true, 'file: scripts outside app/ blocked (B-14 kept)', [b, c]);
  ok(!d.cancel, 'non-script file: resources (local media) still load', d);
  ok(!e.cancel, 'http(s) from a non-app webContents (in-app browser) not blocked by this rule', e);
  console.log('Update keys');
  const keys = require(path.join(ROOT, 'main', 'update-key.js'));
  ok(Array.isArray(keys) && keys.length === 2 && Object.isFrozen(keys) && keys.every(k => crypto.createPublicKey(k).asymmetricKeyType === 'ed25519'), 'two trusted Ed25519 update keys (v2.5 + v2.6), frozen');
  const { verifySig } = (() => { try { return require(path.join(ROOT, 'main', 'update-core.js')); } catch (e) { return {}; } })();
  if (typeof verifySig === 'function') {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); const msg = Buffer.from('x');
    const sig = crypto.sign(null, msg, privateKey).toString('base64');
    let threw = false, res; try { res = verifySig(msg, sig, keys); } catch (e) { threw = true; }
    ok(!res, 'a signature by an unknown key is rejected', { res, threw });
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    ok(verifySig(msg, sig, [keys[0], pubPem]) === true || !!verifySig(msg, sig, [keys[0], pubPem]), 'verifySig accepts a key list (any trusted key verifies)');
  } else ok(false, 'verifySig exported by main/update-core.js');
  console.log(`\nv2.6.3 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
