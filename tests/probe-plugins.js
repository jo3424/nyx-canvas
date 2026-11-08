const { _electron } = require('playwright-core'); const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-pp-'));
const T = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT ' + l)), ms))]);
(async () => {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  app.process().stdout.on('data', d => process.stdout.write('[main] ' + d));
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error') console.log('console.err', m.text()); });
  win.on('pageerror', e => console.log('PAGEERROR', e.message));
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 20000 });
  if (process.env.RCLIP) { await win.bringToFront(); console.log('rclip', await win.evaluate(() => navigator.clipboard.writeText('renderer text').then(() => 'ok', e => e.message))); }
  if (process.env.CLIP) await app.evaluate(({ clipboard }) => clipboard.writeText('hello from nyx'));
  for (const id of (process.argv[2] || 'eortologio,clipboard-inbox,pomodoro,jsoncanvas').split(',')) {
    const t0 = Date.now();
    try {
      const pr = win.evaluate((id) => PluginStore.install(PluginStore.get(id)).then(() => 'ok', e => 'ERR ' + e.message), id);
      await T(win.waitForFunction(() => { const M = document.querySelector('#modal'); return !M.hidden && M.classList.contains('in'); }), 5000, 'modal');
      await win.evaluate(() => document.querySelector('#modal .btn.primary').click());
      console.log(id, await T(pr, 15000, 'install'), Date.now() - t0, 'ms', 'windows', app.windows().length, await T(win.evaluate(() => new Promise(r => requestAnimationFrame(() => r('raf ok')))), 3000, 'raf').catch(e => e.message));
    } catch (e) { console.log(id, 'FAIL', e.message, await win.evaluate(() => ({ modal: document.querySelector('#modal').className, hidden: document.querySelector('#modal').hidden, title: document.querySelector('#modal-title')?.textContent })).catch(e => e.message)); }
  }
  await new Promise(r => setTimeout(r, 5000)); console.log('after 5s', await T(win.evaluate(() => 1), 5000, 'eval').catch(e => e.message));
  await app.close().catch(() => {}); process.exit(0);
})();
