'use strict';
// v2.6.10.1 unit/integration tests: router API key.
//  - key: random, created once, kept in Nyx secrets (fake store here), never in nyx.json / args / logs
//  - every router call carries «Authorization: Bearer <key>» (models, chat, stream, props, tokenize, embeddings, retries,
//    health, plugin fetch), other servers never get it
//  - router start: LLAMA_API_KEY env (not in the command line), autostart script: --api-key-file (key not in the script)
//  - probe(): open / ok / mismatch / down
//  - REAL llama-server (Linux build of llama.cpp, router mode --models-dir) when NYX_LLAMA_SERVER (or the default path) and
//    a small GGUF exist: no key → 401, Nyx with key → models + chat work, key not in /proc/<pid>/cmdline of router + child.
//    Otherwise a fake server that mimics llama-server's --api-key rules is used (and the run says so).
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os'), net = require('net');
const R = path.join(__dirname, '..');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-26101-'));
// fake secrets store (same API as main/secrets.js) — records writes
const store = {}; let writes = 0;
const fakeSecrets = { get: (k) => store[k] || '', set: (k, v) => { writes++; if (v) store[k] = String(v); else delete store[k]; }, has: (k) => !!store[k] };
const rk = require('../main/routerkey');
rk.init(TMP, { secrets: fakeSecrets });
// ai.js loads main/secrets.js → make it use the same fake store for p.keyRef lookups
const realSecrets = require('../main/secrets'); Object.assign(realSecrets, { get: fakeSecrets.get, set: fakeSecrets.set, has: fakeSecrets.has });
const ai = require('../main/ai');
const procs = require('../main/procs');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

// fake llama-server with --api-key: /health public, every other path needs «Bearer <key>» (401 otherwise)
function fakeRouter(port, apiKey) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => body += d); req.on('end', () => {
      const auth = req.headers.authorization || '';
      seen.push({ url: req.url, method: req.method, auth });
      const pub = /^\/(v1\/)?health$/.test(req.url.split('?')[0]);
      if (apiKey && !pub && auth !== 'Bearer ' + apiKey) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"Invalid API Key","type":"authentication_error","code":401}}'); }
      const u = req.url.split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (/health$/.test(u)) return res.end('{"status":"ok"}');
      if (/models$/.test(u)) return res.end(JSON.stringify({ data: [{ id: 'm1', object: 'model', status: { value: 'loaded', args: ['--ctx-size', '4096'] } }] }));
      if (u === '/props') return res.end(JSON.stringify({ default_generation_settings: { n_ctx: 4096 }, model_path: 'm1' }));
      if (u === '/tokenize') return res.end(JSON.stringify({ tokens: [1, 2, 3] }));
      if (/embeddings$/.test(u)) return res.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }));
      if (/chat\/completions$/.test(u)) {
        const j = JSON.parse(body || '{}');
        if (j.stream) { res.setHeader('Content-Type', 'text/event-stream'); res.write('data: {"choices":[{"delta":{"content":"γεια"}}]}\n\n'); res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'); return res.end('data: [DONE]\n\n'); }
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'γεια' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ srv, seen, close: () => new Promise((c) => { srv.close(c); srv.closeAllConnections(); }) })));
}

(async () => {
  console.log('1) the key');
  const k1 = rk.key(), k2 = rk.key();
  ok(/^[A-Za-z0-9_-]{43}$/.test(k1), 'random 32-byte key, base64url (43 chars)', k1.length);
  ok(k1 === k2 && writes === 1 && store[rk.NAME] === k1, 'created once, kept in Nyx secrets under router.apiKey (one write)', { writes });
  ok(rk.active(), 'active() = a key exists');
  ok(!/routerkey|router\.apiKey/.test(read('app/js/store.js') + read('app/js/v2/core.js')), 'not part of the app state (nyx.json is written by the renderer store, which never sees it)');
  ok(!/router\.apiKey|LLAMA_API_KEY/.test(read('app/js/v2/hub-tabs.js')) && /proc:routerKeyCopy/.test(read('app/js/v2/hub-tabs.js')), 'renderer never reads the key: Hub uses proc:routerKey (state) + proc:routerKeyCopy (clipboard in main)');
  ok(/H\('proc:routerKeyCopy', async \(\) => \{ await clipboard\.writeText\(routerkey\.key\(\)\); return true; \}\)/.test(read('main/v2.js')), 'copy is done in main (returns only true)');
  ok(/\/\^router\\\.\/i\.test\(k\)/.test(read('main/v2.js')), 'renderer cannot overwrite router.* secrets (secret:set refuses)');
  ok(!/console\.(log|warn|error)\([^)]*key\(\)/.test(read('main/routerkey.js')), 'the key is never passed to console.*');

  console.log('2) which URLs get it');
  rk.setPort(8080);
  ok(rk.isRouterUrl('http://127.0.0.1:8080/v1/models') && rk.isRouterUrl('http://localhost:8080/health') && rk.isRouterUrl('http://[::1]:8080/props'), 'router port on loopback (127.0.0.1 / localhost / ::1)');
  ok(!rk.isRouterUrl('http://127.0.0.1:1234/v1') && !rk.isRouterUrl('http://192.168.1.5:8080/v1') && !rk.isRouterUrl('https://api.openai.com/v1') && !rk.isRouterUrl('http://evil.example:8080/'), 'not other ports, not LAN, not remote hosts');
  ok(rk.isRouterProvider({ id: 'llama', base: 'http://127.0.0.1:9090/v1' }) && !rk.isRouterProvider({ id: 'llama', base: 'http://10.0.0.2:8080/v1' }) && !rk.isRouterProvider({ id: 'lmstudio', base: 'http://127.0.0.1:1234/v1' }), 'provider «llama» on loopback (any port) or the router URL');
  const w1 = rk.withAuth('http://127.0.0.1:8080/v1/models', { headers: { 'Content-Type': 'application/json' } });
  ok(w1.headers.Authorization === 'Bearer ' + k1 && w1.headers['Content-Type'] === 'application/json', 'withAuth adds Bearer and keeps other headers');
  ok(rk.withAuth('http://127.0.0.1:8080/x', { headers: { authorization: 'Bearer user' } }).headers.authorization === 'Bearer user', 'an Authorization set by the caller is kept');
  ok(!('Authorization' in (rk.withAuth('https://api.example.com/x', { headers: {} }).headers)), 'never sent to other servers');
  const hh = rk.withAuth('http://127.0.0.1:8080/x', { headers: new Headers({ a: '1' }) }).headers; ok(hh.get('authorization') === 'Bearer ' + k1 && hh.get('a') === '1', 'works with a Headers object');

  console.log('3) start args / env / autostart script');
  const cfgR = { exe: '/x/llama-server', modelsDir: TMP, port: 8080, extra: '' };
  const args = procs.argsFor('llama', procs.resolveLlamaCfg({ ...cfgR }));
  ok(!args.join(' ').includes(k1) && !args.includes('--api-key'), 'argsFor (= command line) has no key', args);
  const env = rk.routerEnv(cfgR, { PATH: '/bin' });
  ok(env.LLAMA_API_KEY === k1 && env.PATH === '/bin', 'router env: LLAMA_API_KEY = key (llama-server reads it as --api-key)');
  ok(!('LLAMA_API_KEY' in rk.routerEnv({ ...cfgR, extra: '--api-key mine' }, {})) && !('LLAMA_API_KEY' in rk.routerEnv({ ...cfgR, extra: '--api-key-file C:\\k.txt' }, {})), 'user --api-key / --api-key-file in extra → Nyx does not add its own');
  ok(/env = rk\.routerEnv\(c\)/.test(read('main/procs.js')) && /shell: true, env \}/.test(read('main/procs.js')) && /windowsHide: true, env \}\)/.test(read('main/procs.js')), 'procs.start passes the env to both spawn paths (.exe and .bat)');
  const vbs0 = procs.startupVbs({ ...cfgR, np: 1 });
  ok(!/api-key/.test(vbs0) && /-np 1/.test(vbs0), 'startupVbs without a key file: as before (the -np 1 path unchanged)');
  const vbs1 = procs.startupVbs({ ...cfgR, np: 1 }, { keyFile: path.join(TMP, 'router-api-key.txt') });
  ok(/--api-key-file/.test(vbs1) && !vbs1.includes(k1) && /-np 1/.test(vbs1), 'autostart script: --api-key-file <file>, the key itself is not in the script');
  // winAutostartSet / Get with a temp startup dir
  process.env.NYX_STARTUP_DIR = path.join(TMP, 'Startup');
  const exe = path.join(TMP, 'llama-server.exe'); fs.writeFileSync(exe, 'x');
  const on = procs.winAutostartSet(true, { exe, modelsDir: TMP, port: 8080, np: 1 });
  const kf = path.join(TMP, 'router-api-key.txt');
  ok(on.on && on.keyed && fs.existsSync(kf) && fs.readFileSync(kf, 'utf8').trim() === k1, 'autostart on → key file in the Nyx data folder + script keyed');
  if (process.platform !== 'win32') ok((fs.statSync(kf).mode & 0o077) === 0, 'key file readable only by the user (0600)', (fs.statSync(kf).mode & 0o777).toString(8));
  ok(procs.winAutostartGet().keyed === true, 'winAutostartGet().keyed = true');
  fs.writeFileSync(path.join(process.env.NYX_STARTUP_DIR, procs.STARTUP_NAME), vbs0);
  ok(procs.winAutostartGet().on && procs.winAutostartGet().keyed === false, 'a 2.6.10 script (no key) → keyed = false → the Hub warns and offers a rewrite');
  const off = procs.winAutostartSet(false, {});
  ok(!off.on && !fs.existsSync(kf), 'autostart off → script and key file removed');
  const wk = rk.writeKeyFile; rk.writeKeyFile = () => { throw new Error('router key: no data folder'); };
  const on2 = procs.winAutostartSet(true, { exe, modelsDir: TMP, port: 8080, np: 1 });
  rk.writeKeyFile = wk;
  ok(on2.on && on2.keyed === false && procs.winAutostartGet().keyed === false, 'key file cannot be written → script still written, keyed = false (Hub warns, not silent)', on2);
  procs.winAutostartSet(false, {});

  console.log('4) every router call carries the key (fake llama-server with --api-key)');
  const port = await freePort(); rk.setPort(port);
  const F = await fakeRouter(port, k1);
  const p = { id: 'llama', base: 'http://127.0.0.1:' + port + '/v1', kind: 'local' };
  const noKey = await fetch('http://127.0.0.1:' + port + '/v1/models'); ok(noKey.status === 401, 'without key → 401 (fake server)');
  const ms = await ai.models(p); ok(Array.isArray(ms) && ms[0].id === 'm1', '/v1/models with key → OK', ms);
  const ch = await ai.chat(p, { model: 'm1', messages: [{ role: 'user', content: 'γεια' }] }); ok(/γεια/.test(JSON.stringify(ch)), 'chat → OK');
  let streamed = ''; try { await ai.chatStream(p, { model: 'm1', messages: [{ role: 'user', content: 'x' }] }, { onDelta: (d) => { streamed += typeof d === 'string' ? d : JSON.stringify(d); } }); } catch (e) { streamed = 'ERR ' + e.message; }
  ok(/γεια/.test(streamed), 'chat stream → OK', streamed);
  const pr = await ai.props(p, { model: 'm1' }).catch((e) => ({ err: e.message })); ok(pr && pr.n_ctx === 4096, '/props?model= → OK', pr);
  const tk = ai.tokenize ? await ai.tokenize(p, 'abc', { model: 'm1' }).catch((e) => ({ err: e.message })) : null; ok(!tk || !tk.err, '/tokenize → OK', tk);
  const em = await ai.embed(p, 'm1', 'κείμενο').catch((e) => ({ err: e.message })); ok(em && !em.err, '/v1/embeddings → OK', em);
  const ri = await ai.routerInfo(p, { timeout: 2000 }).catch((e) => ({ err: e.message })); ok(ri && !ri.err, 'routerInfo (Hub) → OK', ri);
  const ping = await ai.ping(p); ok(ping.ok, 'ping (Hub «Δοκιμή») → OK', ping);
  const routerCalls = F.seen.filter((s) => !/health/.test(s.url) && s.auth !== '');
  ok(routerCalls.length >= 5 && routerCalls.every((s) => s.auth === 'Bearer ' + k1), 'every Nyx request carried «Bearer <key>»', F.seen.map((s) => s.method + ' ' + s.url + ' ' + (s.auth ? 'auth' : '-')));
  ok(F.seen.filter((s) => s.auth === '').length === 1, 'only the test\'s own keyless request arrived without the key', F.seen.filter((s) => !s.auth).map((s) => s.url));
  // a provider with its own key keeps it
  store['key:mine'] = 'user-key-123';
  const seen0 = F.seen.length; await ai.models({ ...p, keyRef: 'key:mine' }).catch(() => {}); ok(F.seen.slice(seen0).every((s) => s.auth === 'Bearer user-key-123'), 'provider with its own keyRef → its own key is sent (not replaced)');
  // health (Hub dot) and plugin fetch
  ok(/routerkey\.withAuth\(url, \{ signal: c\.signal \}\)/.test(read('main/v2.js')), 'proc:health sends the key to the router URL');
  ok(/fetch\(url, require\('\.\/routerkey'\)\.withAuth\(url, opts\)\)/.test(read('main/plugins.js')), 'plugin nyx.fetch to the router URL gets the key (MCP / Hermes plugin paths)');
  ok(/opts = routerkey\.withAuth\(url, opts\)/.test(read('main/ai.js')), 'jfetch (every ai.js call incl. 429 retries, vision, embeddings) adds it');
  // retries: 429 then OK → both carry the key
  await F.close();
  let n429 = 0; const seenR = [];
  const s429 = http.createServer((req, res) => { seenR.push(req.headers.authorization || ''); if (n429++ === 0) { res.writeHead(429, { 'retry-after': '0.2', 'Content-Type': 'application/json' }); return res.end('{}'); } res.setHeader('Content-Type', 'application/json'); res.end('{"data":[{"id":"m1"}]}'); });
  const port429 = await freePort(); rk.setPort(port429);
  await new Promise((r) => s429.listen(port429, '127.0.0.1', r));
  await ai.models({ ...p, base: 'http://127.0.0.1:' + port429 + '/v1' }).catch(() => {});
  ok(seenR.length === 2 && seenR.every((a) => a === 'Bearer ' + k1), 'retry after 429 carries the key too', seenR.map((a) => a ? 'auth' : '-'));
  await new Promise((r) => { s429.close(r); s429.closeAllConnections(); });

  console.log('5) probe: open / ok / mismatch / down');
  const p2 = await freePort();
  const open = await fakeRouter(p2, ''); ok((await rk.probe(p2)).state === 'open', 'router WITHOUT key → open (warning, no restart)'); await open.close();
  const good = await fakeRouter(p2, k1); ok((await rk.probe(p2)).state === 'ok', 'router with Nyx key → ok'); await good.close();
  const other = await fakeRouter(p2, 'someone-elses-key'); ok((await rk.probe(p2)).state === 'mismatch', 'router with another key → mismatch'); await other.close();
  ok((await rk.probe(p2)).state === 'down', 'nothing listening → down');
  ok(!/procs\.(start|stop)|proc:start|proc:stop/.test(read('main/routerkey.js')) && !/proc:(start|stop)/.test((read('app/js/v2/hub-tabs.js').match(/const keyRow[\s\S]*?\}\)\(\);/) || [''])[0]), 'warning path never starts/stops the router (no automatic restart)');

  // ---- 6) REAL llama-server ----
  const BIN = process.env.NYX_LLAMA_SERVER || '/workspace/llama-build/bin/llama-b12387/llama-server';
  const GGUF = process.env.NYX_TEST_GGUF || '/tmp/rmodels/stories260K.gguf';
  if (fs.existsSync(BIN) && fs.existsSync(GGUF)) {
    console.log('6) REAL llama-server (' + path.basename(path.dirname(BIN)) + ', router mode --models-dir) started by procs.start');
    const mdir = path.join(TMP, 'models'); fs.mkdirSync(mdir, { recursive: true }); fs.copyFileSync(GGUF, path.join(mdir, path.basename(GGUF)));
    const rp = await freePort(); rk.setPort(rp);
    const cfg = { exe: BIN, modelsDir: mdir, port: rp, ngl: '', fa: false, np: 1, ctx: 512 };
    let st = null; try { st = await procs.start('llama', cfg, null, { settleMs: 2500 }); } catch (e) { st = { err: e.message }; }
    ok(st && st.running, 'procs.start(llama) → running', st);
    for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:' + rp + '/health'); if (r.ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
    const pp = { id: 'llama', base: 'http://127.0.0.1:' + rp + '/v1', kind: 'local' };
    const r0 = await fetch('http://127.0.0.1:' + rp + '/v1/models'); ok(r0.status === 401, 'real router: GET /v1/models without key → 401', r0.status);
    const r1 = await fetch('http://127.0.0.1:' + rp + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"model":"stories260K","messages":[{"role":"user","content":"x"}]}' }); ok(r1.status === 401, 'real router: chat without key → 401', r1.status);
    const r2 = await fetch('http://127.0.0.1:' + rp + '/v1/models', { headers: { Authorization: 'Bearer wrong' } }); ok(r2.status === 401, 'real router: wrong key → 401', r2.status);
    const mm = await ai.models(pp).catch((e) => ({ err: e.message })); ok(Array.isArray(mm) && mm.some((m) => /stories260K/.test(m.id)), 'Nyx → real router /v1/models works', mm);
    const cc = await ai.chat(pp, { model: 'stories260K', messages: [{ role: 'user', content: 'Once upon a time' }], max_tokens: 8 }).catch((e) => ({ err: e.message }));
    ok(cc && !cc.err && JSON.stringify(cc).length > 20, 'Nyx → real router chat (loads the model in a child) works', cc);
    const px = await ai.props(pp, { model: 'stories260K' }).catch((e) => ({ err: e.message })); ok(px && px.n_ctx > 0, 'Nyx → real router /props?model= works', px);
    ok((await rk.probe(rp)).state === 'ok', 'probe(real router) → ok');
    // command lines of the router and its child(ren): no key
    const pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d));
    const lines = pids.map((d) => { try { return fs.readFileSync('/proc/' + d + '/cmdline', 'utf8').replace(/\0/g, ' '); } catch (e) { return ''; } }).filter((l) => l.includes(BIN) && l.includes(String(rp)) || (l.includes(BIN) && l.includes(mdir)));
    ok(lines.length >= 2 && lines.every((l) => !l.includes(k1) && !/--api-key\b/.test(l)), 'router + model child: the key is NOT in their command lines', lines.map((l) => l.slice(0, 160)));
    const stx = procs.status('llama'); ok(!String(stx.cmd).includes(k1) && !stx.log.join('\n').includes(k1), 'Nyx log / shown command line: no key');
    await procs.stopWait('llama', 5000);
    // a router started OUTSIDE Nyx without a key
    const { spawn } = require('child_process');
    const ext = spawn(BIN, ['--models-dir', mdir, '--host', '127.0.0.1', '--port', String(rp), '-np', '1'], { stdio: 'ignore', env: { ...process.env, LLAMA_API_KEY: '' } });
    for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:' + rp + '/health'); if (r.ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
    ok((await rk.probe(rp)).state === 'open', 'real router started outside Nyx without key → probe says open (Hub warning)');
    ext.kill(); await new Promise((r) => ext.once('exit', r));
    console.log('  (real llama-server used: ' + BIN + ')');
  } else {
    console.log('6) SKIPPED real llama-server — binary or GGUF missing (' + BIN + ', ' + GGUF + '); only the fake server above was used');
  }

  // ---- 7) docs / version ----
  const pkg = require('../package.json'); const CH = require('../CHANGELOG.json');
  ok(['2.6.10.1', '2.6.11', '2.6.11.1', '2.6.12', '2.6.12.1', '2.6.12.2', '2.6.13', '2.6.13.1'].includes(pkg.version) && pkg.devDependencies.electron === '45.2.3', 'version 2.6.10.1, Electron 45.2.3', pkg.version);
  ok(['2.6.10.1', '2.6.11', '2.6.11.1', '2.6.12', '2.6.12.1', '2.6.12.2', '2.6.13', '2.6.13.1'].includes(Object.keys(CH)[0]) && CH['2.6.10.1'].el.length === 1 && CH['2.6.10.1'].en.length === 1, 'CHANGELOG 2.6.10.1 first, 1 item');
  const el = require('../app/locales/el.json'), en = require('../app/locales/en.json');
  ok(['key_active', 'copy', 'key_copied', 'warn_open', 'warn_mismatch', 'warn_autostart', 'autostart_rewrite', 'autostart_rewritten'].every((k) => el['v26101.' + k] && en['v26101.' + k]), 'Greek + English texts');
  ok(el['v26101.key_active'] === 'Κλειδί router: ενεργό' && el['v26101.copy'] === 'Αντιγραφή', 'Hub labels «Κλειδί router: ενεργό» / «Αντιγραφή»');
  ok(fs.existsSync(path.join(R, 'tools/accept/ΑΛΛΑΓΕΣ-v2.6.10.1.txt')) && fs.existsSync(path.join(R, 'tools/accept/ΔΟΚΙΜΗ-ΑΠΟΔΟΧΗΣ-v2.6.10.1.txt')), 'Greek docs in tools/accept');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nv2.6.10.1 unit: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
