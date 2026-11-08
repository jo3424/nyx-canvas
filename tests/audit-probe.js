// Audit probe: click through every panel, collect console errors, page errors, missing icons, overflow, untranslated strings.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'Νέος φάκελος nyx '));
const errors = []; const findings = [];
const lang = process.argv[2] || 'el';
(async () => {
  if (lang === 'en') { fs.mkdirSync(path.join(DATA, 'data'), { recursive: true }); }
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  app.process().stdout.on('data', d => { const s = String(d); if (/\[renderer\]|Error|error|uncaught|unhandled/i.test(s)) errors.push('main: ' + s.trim().slice(0, 400)); });
  app.process().stderr.on('data', d => { const s = String(d); if (/uncaught|unhandled|TypeError|ReferenceError/i.test(s)) errors.push('stderr: ' + s.trim().slice(0, 400)); });
  let win = await app.firstWindow();
  const hook = (w) => { w.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)); }); w.on('pageerror', e => errors.push('pageerror: ' + e.message)); };
  hook(win);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 800); });
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 25000 });
  if (lang === 'en') { await win.evaluate(() => { setNyxLang('en'); Store.state.settings.lang = 'en'; Store.save(true); location.reload(); }); await win.waitForTimeout(1500); await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 25000 }); }
  await win.waitForTimeout(800);
  const step = async (name, fn) => { const n = errors.length; try { await fn(); } catch (e) { errors.push('STEP ' + name + ' threw: ' + e.message.slice(0, 300)); } await win.waitForTimeout(600);
    const chk = await win.evaluate((lang) => {
      const out = []; const vw = innerWidth;
      for (const sel of ['#drawer', '#modal', '.assistant', '#cmdk', '.browser', '.video-player']) {
        const root = document.querySelector(sel); if (!root || root.hidden || !root.offsetParent && getComputedStyle(root).position !== 'fixed') continue;
        const R = root.getBoundingClientRect(); if (!R.width) continue;
        for (const e of root.querySelectorAll('button, input, select, .pchk, label, b, span')) { const r = e.getBoundingClientRect(); if (r.width && r.right > R.right + 2 && getComputedStyle(e).visibility !== 'hidden') out.push('overflow ' + sel + ': ' + (e.className || e.tagName) + ' ' + (e.textContent || e.placeholder || '').trim().slice(0, 30) + ' right=' + Math.round(r.right) + '>' + Math.round(R.right)); }
        if (lang === 'en') { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const s = n.textContent.trim(); if (/[\u0370-\u03ff\u1f00-\u1fff]{3,}/.test(s) && !n.parentElement.closest('[contenteditable], textarea, input, .user, code, .chat-msg, .board-name')) out.push('greek in en ' + sel + ': ' + s.slice(0, 60)); } }
      }
      const raw = [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).filter(t => /invoking remote|undefined|\[object|NaN/.test(t)); for (const r of raw) out.push('raw toast: ' + r.slice(0, 200));
      const keys = []; const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n2; while ((n2 = w2.nextNode())) { const s = n2.textContent.trim(); if (/^[a-z]+\.\d{3}$/.test(s) || /\{v\d\}|\{\w+\}/.test(s)) keys.push(s.slice(0, 60)); } for (const k of [...new Set(keys)].slice(0, 10)) out.push('i18n key/placeholder visible: ' + k);
      return out;
    }, lang);
    for (const c of [...new Set(chk)].slice(0, 25)) findings.push(name + ' | ' + c);
    for (const e of errors.slice(n)) findings.push(name + ' | ERR ' + e);
    await win.screenshot({ path: `/tmp/audit-${lang}-${name.replace(/\W+/g, '_')}.png` }).catch(() => {});
  };
  const esc = async () => { await win.keyboard.press('Escape'); await win.waitForTimeout(200); await win.evaluate(() => { try { Panels.closeDrawer?.(); } catch (e) {} const M = document.querySelector('#modal'); if (M && !M.hidden) M.querySelector('.btn.ghost')?.click(); }); };
  await step('canvas', async () => { await win.mouse.dblclick(500, 400); await win.waitForTimeout(300); await win.keyboard.type('hello'); await esc(); });
  await step('hub', async () => win.evaluate(() => Hub.open())); 
  await win.evaluate(() => { const d = document.querySelector('#drawer .drawer-body, #drawer'); d.scrollTop = 900; }); await step('hub-servers', async () => {}); await win.evaluate(() => { const d = document.querySelector('#drawer .drawer-body, #drawer'); d.scrollTop = 1600; }); await step('hub-speech', async () => {});
  await esc();
  for (const tab of ['general', 'update', 'tools']) { await step('settings-' + tab, async () => win.evaluate((t) => { Panels.drawerKind = null; Panels.settings(t); }, tab)); }
  await esc();
  await step('assistant', async () => win.evaluate(() => Assistant.show ? Assistant.show() : Assistant.open())); await esc(); await win.evaluate(() => Assistant.hide?.());
  await step('ctrlk', async () => { await win.keyboard.press('Control+k'); await win.waitForTimeout(300); await win.keyboard.type('σημ'); }); await esc();
  await step('browser', async () => win.evaluate(() => Browser.show ? Browser.show() : Browser.open())); await win.evaluate(() => Browser.hide?.());
  await step('store', async () => win.evaluate(() => PluginStore.open())); await esc();
  await step('automations', async () => win.evaluate(() => Automations.open?.())); await esc();
  await step('themes', async () => win.evaluate(() => Panels.themes())); await esc();
  const themes = await win.evaluate(() => (typeof THEMES !== 'undefined' ? Object.keys(THEMES) : Theme.list ? Theme.list().map(x => x.id || x) : []));
  for (const th of themes) await step('theme-' + th, async () => win.evaluate((th) => Theme.apply ? Theme.apply(th) : (Store.state.settings.theme = th), th));
  await step('reminders', async () => win.click('#btn-reminders')); await esc();
  await step('subs', async () => win.click('#btn-subs')); await esc();
  // click every visible toolbar / dock button once
  const btns = await win.evaluate(() => [...document.querySelectorAll('.dock button, .topbar button, #topbar button, .tools button, .v2bar button')].filter(b => b.offsetParent && b.id !== 'btn-widget').map((b, i) => { b.dataset.probe = 'p' + i; return { id: 'p' + i, tip: b.dataset.tip || b.title || b.id || b.textContent.trim().slice(0, 20) }; }));
  for (const b of btns) { await step('btn-' + b.tip, async () => { await win.evaluate((id) => document.querySelector(`[data-probe="${id}"]`)?.click(), b.id); }); await esc(); await win.evaluate(() => { Browser.hide?.(); Assistant.hide?.(); }); }
  await step('widget', async () => { await win.evaluate(() => API.toggleWidget(true)); await win.waitForTimeout(1500); const ws = app.windows(); for (const w of ws) if (w !== win) { hook(w); await w.screenshot({ path: `/tmp/audit-${lang}-widget.png` }).catch(() => {}); } });
  await win.evaluate(() => API.toggleWidget(false)).catch(() => {});
  const miss = await win.evaluate(() => [...(window.__missingIcons || [])]); if (miss.length) findings.push('missing icons: ' + miss.join(','));
  console.log(JSON.stringify({ buttons: btns.length, themes: themes.length }));
  console.log([...new Set(findings)].join('\n') || 'NO FINDINGS');
  await app.evaluate(({ app }) => app.quit()).catch(() => {}); setTimeout(() => process.exit(0), 3000);
})().catch(e => { console.error('PROBE FAIL', e); process.exit(1); });
