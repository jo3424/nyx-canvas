'use strict';
// v2.6.10.1 UI (Electron 45, Chromium sandbox on): router API key end to end with a REAL llama-server (Linux build of
// llama.cpp, router mode) started by Nyx — Nyx works normally with the key, a call without the key gets 401, the Hub shows
// «Κλειδί router: ενεργό» + «Αντιγραφή» (clipboard = the working key), a page in the Nyx browser (persist:nyxweb) cannot
// use the router, a router started outside Nyx without a key → yellow warning and NO restart. Falls back to a fake
// llama-server (same --api-key rules) when the binary / model are missing, and says so.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), net = require('net');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v26101-'));
let fails = 0, passes = 0;
const T0 = Date.now(); const ok = (c, m, x) => { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's ' + (c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const BIN = process.env.NYX_LLAMA_SERVER || '/workspace/llama-build/bin/llama-b12387/llama-server';
const GGUF = process.env.NYX_TEST_GGUF || '/tmp/rmodels/stories260K.gguf';
const REAL = fs.existsSync(BIN) && fs.existsSync(GGUF);
async function waitUp(port, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch('http://127.0.0.1:' + port + '/health'); if (r.status < 500) return true; } catch (e) {} await sleep(250); } return false; }

async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA, NYX_STARTUP_DIR: path.join(DATA, 'Startup') } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true || window.__nyxV25Ready === true, null, { timeout: 30000 });
  await win.waitForTimeout(500);
  return { app, win };
}
async function quit(app) { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }

(async () => {
  console.log(REAL ? 'REAL llama-server: ' + BIN : 'NO llama-server binary/model on this machine → fake server with the same --api-key rules');
  const mdir = path.join(DATA, 'models'); fs.mkdirSync(mdir, { recursive: true }); if (REAL) fs.copyFileSync(GGUF, path.join(mdir, path.basename(GGUF)));
  const exe = REAL ? BIN : path.join(DATA, 'llama-server'); if (!REAL) { fs.writeFileSync(exe, '#!/usr/bin/env node\n' + fakeServerSrc(), { mode: 0o755 }); }
  const port = await freePort();
  let { app, win } = await launch();
  const ver = await win.evaluate(() => (Store.info && Store.info.version) || '');
  ok(ver === '2.6.10.1', 'app version 2.6.10.1', ver);
  const cfg = { exe, modelsDir: mdir, port, ngl: '', fa: false, np: 1, ctx: 512, extra: '' };
  await win.evaluate(([cfg, port]) => {
    const A = Store.state.settings.ai; Object.assign(A.servers.llama, cfg);
    const L = A.providers.find((p) => p.id === 'llama'); L.enabled = true; L.base = 'http://127.0.0.1:' + port + '/v1';
    Store.save();
  }, [cfg, port]);
  // 1) start from Nyx (same IPC as the Hub's Έναρξη)
  const st = await win.evaluate(async () => { try { return await API.inv('proc:start', 'llama', Store.state.settings.ai.servers.llama); } catch (e) { return { err: String(e.message || e) }; } });
  ok(st && st.running, 'router started by Nyx', st);
  ok(await waitUp(port), 'router answers /health');
  const r0 = await fetch('http://127.0.0.1:' + port + '/v1/models'); ok(r0.status === 401, 'a call WITHOUT the key → 401', r0.status);
  const r0b = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"model":"stories260K","messages":[{"role":"user","content":"x"}],"max_tokens":2}' });
  ok(r0b.status === 401, 'chat WITHOUT the key → 401', r0b.status);
  // 2) Nyx works normally (models, chat) — through the renderer IPC like the assistant / Hub
  const nyx = await win.evaluate(async () => {
    const p = Store.state.settings.ai.providers.find((x) => x.id === 'llama');
    const out = {};
    try { const m = await API.inv('ai:models', p); out.models = Array.isArray(m) ? m.map((x) => x.id) : m; } catch (e) { out.models = 'ERR ' + e.message; }
    try { const c = await API.inv('ai:chat', p, { model: 'stories260K', messages: [{ role: 'user', content: 'Once upon a time' }], max_tokens: 8 }); out.chat = JSON.stringify(c).slice(0, 300); } catch (e) { out.chat = 'ERR ' + e.message; }
    try { const h = await API.inv('proc:health', 'http://127.0.0.1:' + p.base.split(':')[2].split('/')[0] + '/health', 2000); out.health = h; } catch (e) { out.health = 'ERR ' + e.message; }
    return out;
  });
  ok(Array.isArray(nyx.models) && nyx.models.some((m) => /stories260K/.test(m)), 'Nyx → /v1/models works with the key', nyx.models);
  ok(nyx.chat && !/^ERR/.test(nyx.chat) && /choices|content/.test(nyx.chat), 'Nyx → chat works with the key (model loads in a child)', nyx.chat);
  ok(nyx.health && nyx.health.ok, 'Hub health dot works', nyx.health);
  // 3) Hub: «Κλειδί router: ενεργό» + «Αντιγραφή»
  await win.evaluate(() => { Hub.tab = 'engines'; Hub.open(); });
  await win.waitForSelector('[data-router-key] [data-rk=line]', { timeout: 10000 }).catch(() => {});
  await sleep(1500);
  const hub = await win.evaluate(() => { const b = document.querySelector('[data-router-key]'); return b ? { line: b.querySelector('[data-rk=line]').textContent, copy: b.querySelector('[data-rk=copy]').textContent, warn: b.querySelector('[data-rk=warn]').hidden, state: b.dataset.state } : null; });
  ok(hub && /Κλειδί router: ενεργό/.test(hub.line) && hub.copy === 'Αντιγραφή', 'Hub shows «Κλειδί router: ενεργό» + «Αντιγραφή»', hub);
  ok(hub && hub.state === 'ok' && hub.warn === true, 'router started by Nyx → state ok, no warning', hub);
  await app.evaluate(({ clipboard }) => clipboard.writeText('x'));
  const cb = await win.$('[data-router-key] [data-rk=copy]'); await cb.click(); await sleep(400);
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  ok(/^[A-Za-z0-9_-]{43}$/.test(clip), 'click «Αντιγραφή» → the key is in the clipboard', clip.length);
  const r1 = await fetch('http://127.0.0.1:' + port + '/v1/models', { headers: { Authorization: 'Bearer ' + clip } });
  ok(r1.status === 200, 'the copied key works against the router (what Hermes would use)', r1.status);
  const dom = await win.evaluate(() => document.documentElement.outerHTML);
  ok(!dom.includes(clip), 'the key is not anywhere in the renderer DOM');
  const disk = fs.readdirSync(DATA).filter((f) => /\.json$/.test(f)).map((f) => [f, fs.readFileSync(path.join(DATA, f), 'utf8')]);
  const nyxj = [path.join(DATA, 'data', 'nyx.json'), path.join(DATA, 'nyx.json')].filter((f) => fs.existsSync(f)).map((f) => [f, fs.readFileSync(f, 'utf8')]); ok(nyxj.length && nyxj.every(([, s]) => !s.includes(clip)), 'nyx.json does not contain the key', disk.map((d) => d[0]));
  const sec = disk.find(([f]) => f === 'secrets.json'); ok(sec && /router\.apiKey/.test(sec[1]) && !sec[1].includes(clip), 'secrets.json holds router.apiKey, encoded (not the plain key)', sec && sec[1].slice(0, 120));
  const logTxt = await win.evaluate(() => API.inv('proc:status', 'llama').then((s) => (s.cmd || '') + '\n' + (s.log || []).join('\n')));
  ok(!logTxt.includes(clip), 'router command line + log shown in the Hub: no key');
  if (REAL) {
    const lines = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map((d) => { try { return fs.readFileSync('/proc/' + d + '/cmdline', 'utf8').replace(/\0/g, ' '); } catch (e) { return ''; } }).filter((l) => l.includes(BIN));
    ok(lines.length >= 1 && lines.every((l) => !l.includes(clip) && !/--api-key\b/.test(l)), 'OS process list (router + child): key not in any command line', lines.map((l) => l.slice(0, 140)));
  }
  await win.evaluate(() => { try { Hub.close ? Hub.close() : document.querySelector('#modal-close')?.click(); } catch (e) {} });
  // 4) a web page in the Nyx browser (persist:nyxweb) tries to use the router
  const pagePort = await freePort();
  const page = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><title>start</title><script>
    (async () => { const out = [];
      try { const r = await fetch('http://127.0.0.1:${port}/v1/models'); out.push('models:' + r.status); } catch (e) { out.push('models:ERR'); }
      try { const r = await fetch('http://127.0.0.1:${port}/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'stories260K', messages: [{ role: 'user', content: 'hi' }], max_tokens: 4 }) }); out.push('chat:' + r.status); } catch (e) { out.push('chat:ERR'); }
      try { const r = await fetch('http://127.0.0.1:${port}/completion', { method: 'POST', body: JSON.stringify({ prompt: 'hi', n_predict: 4 }) }); out.push('completion:' + r.status); } catch (e) { out.push('completion:ERR'); }
      document.title = 'done ' + out.join(' '); })();
  </script>`); });
  await new Promise((r) => page.listen(pagePort, '127.0.0.1', r));
  await win.evaluate((u) => Browser.open(u), 'http://127.0.0.1:' + pagePort + '/attack.html');
  let title = ''; for (let i = 0; i < 40 && !/^done/.test(title); i++) { await sleep(250); title = await app.evaluate(({ webContents }) => { const w = webContents.getAllWebContents().find((x) => x.getType() === 'webview' && /attack\.html/.test(x.getURL())); return w ? w.getTitle() : ''; }); }
  const part = await win.evaluate(() => Browser.cur && Browser.cur.wv && Browser.cur.wv.getAttribute('partition'));
  ok(part === 'persist:nyxweb', 'the page is in the Nyx browser (persist:nyxweb)', part);
  ok(/^done/.test(title) && !/:(200|201)\b/.test(title), 'page fetch to the router fails (no 200 for /v1/models, chat, /completion): ' + title.replace(/^done /, ''), title);
  page.close();
  await win.evaluate(() => { try { Browser.hide ? Browser.hide() : 0; } catch (e) {} });
  // 5) stop; a router started OUTSIDE Nyx without key → yellow warning, no restart
  await win.evaluate(() => API.inv('proc:stopWait', 'llama', 8000));
  await sleep(500);
  const ext = spawn(exe, ['--models-dir', mdir, '--host', '127.0.0.1', '--port', String(port), '-np', '1'], { stdio: 'ignore', env: { ...process.env, LLAMA_API_KEY: '' } });
  ok(await waitUp(port), 'router started outside Nyx (no key) is up');
  const extPid = ext.pid;
  await win.evaluate(() => { Hub.tab = 'engines'; Hub.open(); });
  await sleep(6000);
  const hub2 = await win.evaluate(() => { const b = document.querySelector('[data-router-key]'); const w = b && b.querySelector('[data-rk=warn]'); return b ? { state: b.dataset.state, hidden: w.hidden, text: w.textContent, color: getComputedStyle(w).color } : null; });
  ok(hub2 && hub2.state === 'open' && !hub2.hidden && /χωρίς κλειδί/.test(hub2.text), 'Hub: yellow warning «απαντά χωρίς κλειδί»', hub2);
  ok(hub2 && /rgb\(210, 153, 34\)/.test(hub2.color), 'warning is yellow', hub2 && hub2.color);
  await sleep(3000);
  const stillSame = ext.exitCode == null && (() => { try { process.kill(extPid, 0); return true; } catch (e) { return false; } })();
  const mine = await win.evaluate(() => API.inv('proc:status', 'llama').then((s) => s.running));
  ok(stillSame && !mine, 'no automatic restart: the outside router keeps running, Nyx did not start its own', { stillSame, mine });
  ext.kill(); await new Promise((r) => ext.once('exit', r));
  // 6) Windows autostart script (Startup dir redirected to the test folder)
  const aut = await win.evaluate(async () => { try { return await API.inv('proc:winAutostart', { on: true, cfg: Store.state.settings.ai.servers.llama }); } catch (e) { return { err: e.message }; } });
  const vbs = fs.readFileSync(path.join(DATA, 'Startup', 'Nyx-llama-router.vbs'), 'utf8');
  ok(aut.on && aut.keyed && /--api-key-file/.test(vbs) && !vbs.includes(clip), 'autostart script uses --api-key-file, key not in the script', aut);
  const kf = path.join(DATA, 'router-api-key.txt'); ok(fs.existsSync(kf) && fs.readFileSync(kf, 'utf8').trim() === clip, 'key file next to the Nyx data (for the autostart only)');
  await win.evaluate(() => API.inv('proc:winAutostart', { on: false }));
  ok(!fs.existsSync(kf), 'autostart off → key file removed');
  // 7) restart Nyx: same key (created once)
  await quit(app); ({ app, win } = await launch());
  await app.evaluate(({ clipboard }) => clipboard.writeText('x'));
  await win.evaluate(() => { Hub.tab = 'engines'; Hub.open(); });
  await win.waitForSelector('[data-router-key] [data-rk=copy]', { timeout: 10000 }).catch(() => {});
  await (await win.$('[data-router-key] [data-rk=copy]')).click(); await sleep(400);
  const clip2 = await app.evaluate(({ clipboard }) => clipboard.readText());
  ok(clip2 === clip, 'after a Nyx restart the key is the same (generated once)');
  await quit(app);
  console.log(`\nv2.6.10.1 UI: ${passes} passed, ${fails} failed` + (REAL ? ' (real llama-server)' : ' (fake llama-server)'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function fakeServerSrc() {
  return `const http=require('http');const a=process.argv;const port=+a[a.indexOf('--port')+1];const key=process.env.LLAMA_API_KEY||'';
http.createServer((q,s)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{s.setHeader('Access-Control-Allow-Origin','*');s.setHeader('Content-Type','application/json');
if(q.method==='OPTIONS'){s.setHeader('Access-Control-Allow-Headers','*');return s.end();}
const pub=/^\\/(v1\\/)?health$/.test(q.url);if(key&&!pub&&q.headers.authorization!=='Bearer '+key){s.writeHead(401);return s.end('{"error":{"message":"Invalid API Key","code":401}}');}
if(/health/.test(q.url))return s.end('{"status":"ok"}');if(/models/.test(q.url))return s.end('{"data":[{"id":"stories260K"}]}');
s.end('{"choices":[{"message":{"role":"assistant","content":"hi"}}]}');});}).listen(port,'127.0.0.1');`;
}
