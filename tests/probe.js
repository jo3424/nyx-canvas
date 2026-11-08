const { _electron } = require('playwright-core'); const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'); const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-probe-'));
(async () => {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  app.process().stdout.on('data', d => process.stdout.write('[main] ' + d)); app.process().stderr.on('data', d => { const s = String(d); if (!/dbus|GPU|gpu|viz|Fontconfig|libva/.test(s)) process.stdout.write('[err] ' + s); });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console.' + m.type(), m.text()); });
  win.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack?.split('\n')[1]));
  try { await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 20000 }); console.log('V2 READY'); } catch (e) { console.log('NOT READY', await win.evaluate(() => ({ v1: window.__nyxReady, v2: window.__nyxV2Ready }))); }
  console.log(await win.evaluate(() => ({ missing: window.__missingIcons, btns: [...document.querySelectorAll('#titlebar button')].map(b => b.id).join(','), plugins: PluginStore.list.length })));
  await win.screenshot({ path: '/tmp/probe.png' });
  await app.close().catch(() => {}); process.exit(0);
})();
