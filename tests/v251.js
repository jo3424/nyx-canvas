// Nyx v2.5.1 security e2e (headless, Chromium sandbox on; Playwright is told chromiumSandbox: true): xvfb-run -a node tests/v251.js
// webPreferences of every window, no Node in renderers, CSP, window.open / navigation / external links, remote content
// blocked in the app window (nyx-img proxy works), central IPC guard (untrusted sender + bad arguments), <webview> still
// works and has no Nyx API, pdf.js 6 renders, About shows the runtime versions.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v251-'));
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function png1() { // 1×1 red PNG
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(1, 0); ih.writeUInt32BE(1, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
}
function pdf1(text) { // minimal one-page PDF with a text line
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
  const s = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`; objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`); objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n'; const offs = []; objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
(async () => {
  const hits = []; const PNG = png1();
  const srv = http.createServer((q, r) => {
    hits.push(q.url);
    if (q.url.startsWith('/img.png')) { r.setHeader('content-type', 'image/png'); return r.end(PNG); }
    if (q.url.startsWith('/notimage')) { r.setHeader('content-type', 'text/html'); return r.end('<script>alert(1)</script>'); }
    if (q.url.startsWith('/page.html')) { r.setHeader('content-type', 'text/html'); return r.end('<!doctype html><title>Plain page</title><h1>hello</h1>'); }
    r.statusCode = 404; r.end();
  }); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${srv.address().port}`;

  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  app.process().stdout.on('data', d => { const s = String(d); if (/\[renderer\]|Error/.test(s)) errors.push('main: ' + s.trim().slice(0, 300)); });
  const win = await app.firstWindow();
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 30000 }); await win.waitForTimeout(800);
  await app.evaluate(({ shell }) => { global.__ext = []; shell.openExternal = async (u) => { global.__ext.push(u); }; });
  const ext = () => app.evaluate(() => global.__ext.slice());

  console.log('Runtime');
  const V = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, noSandboxSwitch: process.mainModule.require('electron').app.commandLine.hasSwitch('no-sandbox'), argv: process.argv.slice(1) }));
  console.log('     process.versions.electron = ' + V.electron + ', process.versions.chrome = ' + V.chrome + ', node = ' + V.node);
  ok(V.electron === require('electron/package.json').version && V.noSandboxSwitch === false, 'running Electron ' + V.electron + ' with the Chromium sandbox switch untouched', V.argv);
  // Linux: getAppMetrics().sandboxed is macOS/Windows-only, so look at the kernel's view of each renderer:
  // a sandboxed Chromium renderer runs under seccomp-bpf (Seccomp: 2) in its own PID namespace.
  const mets = await app.evaluate(({ app }) => ({ main: process.pid, tabs: app.getAppMetrics().filter(m => m.type === 'Tab').map(m => m.pid) }));
  const nsOf = (pid, ns) => { try { return fs.readlinkSync(`/proc/${pid}/ns/${ns}`); } catch (e) { return 'n/a'; } };
  const sbx = mets.tabs.map(pid => { let sc = '?'; try { sc = (fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^Seccomp:\s*(\d)/m) || [])[1]; } catch (e) {} return { pid, seccomp: sc, ownPidNs: nsOf(pid, 'pid') !== nsOf(mets.main, 'pid') }; });
  ok(sbx.length > 0 && sbx.every(x => x.seccomp === '2' && x.ownPidNs), 'every renderer process is OS-sandboxed (seccomp-bpf + own PID namespace)', sbx);

  console.log('Renderer isolation + CSP');
  const r = await win.evaluate(() => ({ req: typeof require, proc: typeof process, mod: typeof module, buf: typeof Buffer, api: typeof window.nyxAPI, keys: Object.keys(window.nyxAPI), csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '' }));
  ok(r.req === 'undefined' && r.proc === 'undefined' && r.mod === 'undefined' && r.buf === 'undefined', 'no require / process / module / Buffer in the page', r);
  ok(r.api === 'object' && !r.keys.some(k => /^(ipcRenderer|invoke|send|require|electron)$/.test(k)), 'only the nyxAPI bridge is exposed (' + r.keys.length + ' functions, no raw ipcRenderer)', r.keys);
  ok(/default-src 'none'/.test(r.csp) && /frame-src 'none'/.test(r.csp) && !/https?:/.test(r.csp), 'strict CSP meta present', r.csp);
  // DevTools' own Runtime.evaluate may compile strings, so test a string timer, which the page itself compiles later.
  const evalBlocked = await win.evaluate(() => new Promise(res => { window.__ev = 0; const v = []; document.addEventListener('securitypolicyviolation', e => v.push(e.violatedDirective), { once: true }); try { setTimeout('window.__ev=1', 0); } catch (e) {} setTimeout(() => res({ blocked: window.__ev === 0, v }), 300); }));
  ok(evalBlocked.blocked, 'string-eval (setTimeout("code")) blocked by CSP', evalBlocked);
  const inlineBlocked = await win.evaluate(() => new Promise(res => { window.__inl = 0; const s = document.createElement('script'); s.textContent = 'window.__inl=1'; document.head.appendChild(s); setTimeout(() => res(window.__inl === 0), 200); }));
  ok(inlineBlocked, 'inline <script> blocked by CSP');

  console.log('Windows: webPreferences');
  await app.evaluate(({ app }) => { global.__seen = []; app.on('web-contents-created', (e, wc) => { const rec = () => { const p = wc.getLastWebPreferences() || {}; global.__seen.push({ type: wc.getType(), url: wc.getURL().replace(/^.*\//, '').slice(0, 40), ci: p.contextIsolation, sb: p.sandbox, ni: p.nodeIntegration, nis: p.nodeIntegrationInSubFrames, ws: p.webSecurity, ins: p.allowRunningInsecureContent }); }; wc.once('did-finish-load', rec); }); });
  await win.evaluate(async () => { await nyxAPI.inv('sticky:open', { id: 'sec-1', text: 'x' }); await nyxAPI.inv('capture:open'); await nyxAPI.toggleWidget(true); });
  await sleep(2500);
  const prefs = await app.evaluate(({ BrowserWindow, webContents }) => webContents.getAllWebContents().map(wc => { const p = wc.getLastWebPreferences() || {}; return { type: wc.getType(), url: wc.getURL().replace(/^.*\//, '').slice(0, 40), ci: p.contextIsolation, sb: p.sandbox, ni: p.nodeIntegration, nis: p.nodeIntegrationInSubFrames, ws: p.webSecurity, ins: p.allowRunningInsecureContent }; }));
  const seen = await app.evaluate(() => global.__seen.slice()); // the sticky window closes itself for an unknown card, so also use what was recorded at load
  prefs.push(...seen);
  const pages = prefs.map(p => p.url.replace(/\?.*/, ''));
  ok(['index.html', 'sticky.html', 'capture.html', 'widget.html'].every(f => pages.includes(f)), 'main, widget, sticky, capture windows open', pages);
  const badPrefs = prefs.filter(p => !(p.ci === true && p.sb === true && p.ni === false && p.ws === true && p.ins === false && !p.nis));
  ok(badPrefs.length === 0, `all ${prefs.length} webContents: contextIsolation + sandbox on, nodeIntegration off, webSecurity on`, badPrefs);

  console.log('window.open / navigation / external links');
  const n0 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const wo = await win.evaluate((u) => [window.open(u), window.open('file:///etc/passwd'), window.open('javascript:alert(1)')].map(x => x === null), BASE + '/page.html?open');
  await sleep(600);
  ok(wo.every(Boolean) && await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) === n0, 'window.open never creates a window', wo);
  let e1 = await ext(); ok(e1.includes(BASE + '/page.html?open') && !e1.some(u => /^(file|javascript):/.test(u)), 'http(s) link from window.open → system browser; file:/javascript: dropped', e1);
  await win.evaluate((u) => { const a = document.createElement('a'); a.href = u; document.body.appendChild(a); a.click(); a.remove(); }, BASE + '/page.html?nav');
  await sleep(800);
  ok(/index\.html/.test(win.url()) && (await ext()).includes(BASE + '/page.html?nav'), 'navigating the app window to a web page is blocked → opened externally', [win.url(), await ext()]);
  await win.evaluate(() => { location.href = 'file:///etc/hostname'; }).catch(() => {}); await sleep(600);
  ok(/index\.html/.test(win.url()) && !(await ext()).some(u => u.startsWith('file:')), 'navigation to another local file blocked (not opened)', win.url());
  await win.evaluate(() => nyxAPI.openExternal ? nyxAPI.openExternal('mailto:me@example.com') : nyxAPI.inv('web:open', 'mailto:me@example.com')).catch(() => {});

  console.log('Remote content in the app window');
  const imgs = await win.evaluate(async ({ base }) => {
    const load = (src) => new Promise(res => { const i = new Image(); i.onload = () => res('load:' + i.naturalWidth); i.onerror = () => res('error'); i.src = src; setTimeout(() => res('timeout'), 8000); });
    return { direct: await load(base + '/img.png?direct'), proxy: await load('nyx-img://r/?u=' + encodeURIComponent(base + '/img.png?proxy')), html: await load('nyx-img://r/?u=' + encodeURIComponent(base + '/notimage')), file: await load('nyx-img://r/?u=' + encodeURIComponent('file:///etc/passwd')),
      fetch: await fetch(base + '/page.html?fetch').then(() => 'ok', () => 'blocked') };
  }, { base: BASE });
  ok(imgs.direct === 'error' && !hits.includes('/img.png?direct'), 'direct remote <img> blocked before any request', imgs);
  ok(imgs.proxy === 'load:1' && hits.includes('/img.png?proxy'), 'nyx-img proxy loads the image', imgs);
  ok(imgs.html === 'error' && imgs.file === 'error', 'nyx-img refuses non-images and file: URLs', imgs);
  ok(imgs.fetch === 'blocked' && !hits.includes('/page.html?fetch'), 'fetch() to the web from the app window blocked', imgs);

  console.log('Central IPC guard');
  const bad = await win.evaluate(async () => { const r = async (p) => { try { await p; return 'ok'; } catch (e) { return String(e.message || e); } };
    return { fetchFile: await r(nyxAPI.fetch('file:///etc/passwd')), relPath: await r(nyxAPI.importPath('relative/x.png')), unc: await r(nyxAPI.importPath('\\\\evil\\share\\x.png')), unknown: await r(nyxAPI.inv('upd:nope')), extra: await r(nyxAPI.inv('upd:rollback', 1, 2)), good: await r(nyxAPI.inv('upd:info')) }; });
  ok(/IPC rejected/.test(bad.fetchFile) && /IPC rejected/.test(bad.relPath) && /IPC rejected/.test(bad.unc) && /IPC rejected/.test(bad.extra), 'bad arguments rejected centrally (file:// fetch, relative / UNC path, extra args)', bad);
  ok(bad.good === 'ok' && !/^ok$/.test(bad.unknown), 'valid call works; unknown channel fails', bad);
  const untrusted = await app.evaluate(async ({ BrowserWindow }, { base }) => {
    const secure = process.mainModule.require(process.cwd() + '/main/secure.js');
    const out = {};
    for (const [k, url] of [['data', 'data:text/html,<title>x</title>'], ['web', base + '/page.html?ipc']]) {
      const w = new BrowserWindow({ show: false, webPreferences: secure.appPrefs() }); await w.loadURL(url).catch(() => {});
      out[k] = await w.webContents.executeJavaScript(`(async () => { try { await nyxAPI.inv('upd:info'); return 'ok'; } catch (e) { return String(e.message); } })()`).catch(e => 'exec:' + e.message);
      out[k + 'Sync'] = await w.webContents.executeJavaScript(`JSON.stringify(nyxAPI.locale('el'))`).catch(e => 'exec:' + e.message).then(s => String(s).slice(0, 80));
      w.destroy();
    }
    return out;
  }, { base: BASE }).catch(e => ({ err: e.message }));
  ok(/untrusted sender/.test(untrusted.data) && /untrusted sender/.test(untrusted.web), 'page that is not an app page (data: / web) cannot call IPC even with the preload', untrusted);
  ok(/"ok":false/.test(untrusted.dataSync) && /"ok":false/.test(untrusted.webSync), 'sync IPC from an untrusted page refused', untrusted);

  console.log('<webview> browser still works (frame-src none does not affect it)');
  await win.evaluate((u) => Browser.open(u), BASE + '/page.html?wv'); await sleep(2500);
  const wv = await app.evaluate(async ({ webContents }) => { const g = webContents.getAllWebContents().find(w => w.getType() === 'webview' && /page\.html\?wv/.test(w.getURL())); if (!g) return null; const p = g.getLastWebPreferences(); return { title: await g.executeJavaScript('document.title'), api: await g.executeJavaScript('typeof nyxAPI + "/" + typeof require + "/" + typeof process'), ci: p.contextIsolation, sb: p.sandbox, ni: p.nodeIntegration, ws: p.webSecurity, preload: !!p.preload }; });
  ok(wv && wv.title === 'Plain page', 'web page loads in a browser tab', wv);
  ok(wv && wv.api === 'undefined/undefined/undefined' && wv.ci && wv.sb && !wv.ni && wv.ws && !wv.preload, 'guest page: no Nyx API, no Node, sandboxed, no preload', wv);

  console.log('pdf.js 6');
  const pdfB64 = pdf1('Nyx PDF test 2.5.1').toString('base64');
  const pdf = await win.evaluate(async (b64) => { const lib = await Extras.pdfjs(); const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const doc = await lib.getDocument({ data, isEvalSupported: false }).promise; const pg = await doc.getPage(1); const tc = await pg.getTextContent(); const vp = pg.getViewport({ scale: 1 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await pg.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 128) dark++; return { v: lib.version, pages: doc.numPages, text: tc.items.map(x => x.str).join(' '), dark }; }, pdfB64).catch(e => ({ err: e.message }));
  ok(pdf.v && pdf.v.startsWith('6.') && pdf.pages === 1 && /Nyx PDF test/.test(pdf.text) && pdf.dark > 20, 'pdf.js ' + pdf.v + ' parses + renders a PDF (worker under CSP)', pdf);

  console.log('Settings → About');
  await win.evaluate(() => { Panels.drawerKind = null; Panels.settings('update'); }); await win.waitForTimeout(800);
  const rt = await win.evaluate(() => document.querySelector('[data-testid=upd-runtime]')?.textContent || '');
  ok(rt.includes('Electron ' + V.electron) && rt.includes('Chromium ' + V.chrome), 'About shows ' + rt, rt);

  const blockedIpc = await app.evaluate(() => process.mainModule.require(process.cwd() + '/main/ipc-guard.js').blocked().length);
  ok(blockedIpc >= 4, 'IPC guard logged the rejected calls (' + blockedIpc + ')');
  const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {}
  srv.close();
  const errs = errors.filter(e => !/blocked remote load|ipc blocked|Autofill|DevTools|GPU|dbus|net::ERR|Content Security Policy|Failed to load resource/.test(e));
  ok(errs.length === 0, 'no unexpected errors', errs.slice(0, 8));
  fs.writeFileSync(path.join(os.tmpdir(), 'nyx-v251-versions.json'), JSON.stringify(V));
  console.log(`\nv2.5.1 security: ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
