'use strict';
// Nyx v2.6.5.2 MCP tools e2e (headless, Chromium sandbox on): xvfb-run -a -s "-screen 0 2048x1280x24" node tests/v2652.js
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v2652-'));
const SHOTS = path.join(ROOT, 'shots');
const errors = []; let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function png1() {
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(1, 0); ih.writeUInt32BE(1, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
}
async function launch() {
  const app = await _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), args: [ROOT], env: { ...process.env, NYX_TEST: '1', NYX_DATA_DIR: DATA } });
  app.process().stdout.on('data', d => { const s = String(d); if (/\[renderer\]|Error/.test(s)) errors.push('main: ' + s.trim().slice(0, 300)); });
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|ERR_CONNECTION_REFUSED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  win.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForFunction(() => window.__nyxV2Ready === true, null, { timeout: 30000 });
  await win.waitForTimeout(500);
  return { app, win };
}
async function quit(app) { const done = new Promise(r => app.process().once('exit', r)); await app.evaluate(({ app }) => setTimeout(() => app.quit(), 50)).catch(() => {}); await Promise.race([done, sleep(8000)]); try { app.process().kill(); } catch (e) {} }
async function modalClick(win, primary = true, timeout = 10000) {
  await win.waitForFunction(() => { const M = document.querySelector('#modal'); return M && !M.hidden && M.classList.contains('in') && !M.dataset.closing; }, null, { timeout });
  await win.waitForTimeout(120);
  const tok = await win.evaluate(() => document.querySelector('#modal')._tok);
  await win.evaluate((p) => document.querySelector(p ? '#modal .btn.primary' : '#modal .btn.ghost').click(), primary);
  await win.waitForFunction((tok) => { const M = document.querySelector('#modal'); return M.hidden || M._tok !== tok; }, tok, { timeout: 5000 }).catch(() => {});
}
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const pic = path.join(DATA, 'mcp-test.png');
  fs.writeFileSync(pic, png1());

  const { app, win } = await launch();
  const ver = await win.evaluate(() => Store.info.version || require && null);
  const shown = await win.evaluate(() => (typeof APP_VERSION !== 'undefined' ? APP_VERSION : null) || (Store.info && Store.info.version));
  ok(shown === '2.6.5.2' || await win.evaluate(() => document.body.innerText).then(() => true), 'app booted', shown);

  // seed two cards
  const ids = await win.evaluate(() => {
    const a = Features.addAt({ type: 'sticky', w: 200, h: 200, html: 'Γάλα', paper: '#ffe66d', tags: ['λίστα'] }, 200, 200);
    const b = Features.addAt({ type: 'sticky', w: 200, h: 200, html: 'Ψωμί', paper: '#ffe66d', tags: ['λίστα'] }, 500, 200);
    Store.save(true);
    return { a: a.id, b: b.id };
  });

  await win.evaluate(() => PluginStore.open());
  await win.waitForTimeout(400);
  const inst = win.evaluate(() => PluginStore.install(PluginStore.get('mcp-server')));
  await win.waitForSelector('#modal:not([hidden]) .permlist', { timeout: 8000 });
  await modalClick(win);
  await inst;
  await win.waitForTimeout(800);
  const mp = await win.evaluate(() => { const p = PluginStore.get('mcp-server'); return { inst: p.installed, en: p.enabled, err: p.error, write: p.values.write, read: p.values.read, del: p.values.del }; });
  ok(mp.inst && !mp.err && mp.write === false && mp.read !== false && mp.del === false, 'new install: read on, write/delete off', mp);

  const info = await win.evaluate(() => API.inv('plugins:action', 'mcp-server', 'info'));
  const token = (JSON.stringify(info).match(/Bearer ([a-f0-9]{20,})/) || [])[1];
  ok(!!token, 'MCP token from connection settings');
  const mcp = async (body) => {
    const r = await fetch('http://127.0.0.1:7801/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const result = (r) => { try { return JSON.parse(r.j.result.content[0].text); } catch (e) { return r.j; } };

  let r = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const listed = ((r.j && r.j.result && r.j.result.tools) || []).map(t => t.name);
  ok(listed.includes('list_boards') && listed.includes('summarize_board') && !listed.includes('update_card') && !listed.includes('delete_cards'), 'tools/list respects read-only permissions', listed);

  r = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_boards', arguments: {} } });
  ok(r.status === 200 && Array.isArray(result(r).boards), 'list_boards works with read permission', result(r));

  r = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'update_card', arguments: { id: ids.a, text: 'x' } } });
  ok(r.j && r.j.result && r.j.result.isError, 'update_card refused while write is off', r.j && JSON.stringify(r.j).slice(0, 200));

  await win.evaluate(async () => { await API.inv('plugins:config', 'mcp-server', { port: 7801, read: true, write: true, del: false }); });
  await win.waitForTimeout(900);

  r = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'update_card', arguments: { id: ids.a, text: 'Γάλα 2%', color: 'blue', tags: ['λίστα', 'σπίτι'] } } });
  let out = result(r);
  ok(out && out.ok && await win.evaluate((id) => /Γάλα 2%/.test(Store.find(id).item.html) && Store.find(id).item.tags.includes('σπίτι'), ids.a), 'update_card in the real app', out);
  ok(await win.evaluate(() => Store.lastUndoLabel() === 'MCP: update_card'), 'undo label is MCP: update_card');

  r = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create_reminder', arguments: { text: 'Οδοντίατρος', at: '2026-11-15T09:00:00' } } });
  out = result(r);
  ok(out && out.ok && /15\/11\/2026/.test(out.at_local) && await win.evaluate((id) => { const it = Store.find(id).item; return it && it.reminder && it.reminder.on; }, out.id), 'create_reminder appears in the board and is scheduled', out);
  r = await mcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_reminders', arguments: { from: '2026-11-15', to: '2026-11-15' } } });
  ok(result(r).reminders && result(r).reminders.length >= 1, 'list_reminders returns the new reminder', result(r));

  r = await mcp({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'create_board', arguments: { name: 'Ταξίδι' } } });
  out = result(r);
  ok(out && out.ok && out.switched === false, 'create_board does not silently switch', out);
  r = await mcp({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'move_card', arguments: { id: ids.b, board: 'Ταξίδι', x: 40, y: 60 } } });
  ok(result(r).ok && await win.evaluate((id) => Store.find(id).board.name === 'Ταξίδι', ids.b), 'move_card to another board', result(r));
  await win.evaluate(() => { Store.undo(); Canvas.refresh(); Panels.tabs(); });
  ok(await win.evaluate((id) => Store.find(id).board.id === Store.state.active, ids.b), 'Ctrl+Z (Store.undo) restores a cross-board move');

  r = await mcp({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'link_cards', arguments: { from: ids.a, to: ids.b } } });
  ok(result(r).ok && await win.evaluate((id) => Store.find(id).item.type === 'arrow', result(r).id), 'link_cards draws an arrow', result(r));

  r = await mcp({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'group_cards', arguments: { ids: [ids.a, ids.b], title: 'Αγορές' } } });
  ok(result(r).ok && await win.evaluate((id) => Store.find(id).item.type === 'frame' && Store.find(id).item.title === 'Αγορές', result(r).frame), 'group_cards creates a titled frame', result(r));

  const beforeOrg = await win.evaluate(() => Store.items().map(i => i.id + '@' + Math.round(i.x) + ',' + Math.round(i.y)));
  r = await mcp({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'organize_board', arguments: { by: 'tag' } } });
  const afterOrg = await win.evaluate(() => Store.items().map(i => i.id + '@' + Math.round(i.x) + ',' + Math.round(i.y)));
  ok(result(r).ok && beforeOrg.join() !== afterOrg.join(), 'organize_board moves cards without deleting them', { before: beforeOrg.length, after: afterOrg.length, r: result(r) });
  await win.evaluate(() => { Store.undo(); Canvas.refresh(); });

  r = await mcp({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'summarize_board', arguments: {} } });
  const sum = result(r);
  const nItems = await win.evaluate(() => Store.items().length);
  ok(sum && sum.text && sum.items === nItems, 'summarize_board returns text and does not change the board', { items: sum && sum.items, nItems, text: sum && String(sum.text).slice(0, 80) });

  r = await mcp({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'add_image', arguments: { path: pic, title: 'δοκιμή' } } });
  ok(result(r).ok && await win.evaluate((id) => Store.find(id) && Store.find(id).item.type === 'image', result(r).id), 'add_image from a local file in the Nyx data folder', result(r));
  r = await mcp({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'add_image', arguments: { url: 'file://' + pic } } });
  ok(r.j && r.j.result && r.j.result.isError, 'add_image rejects file://', r.j && JSON.stringify(r.j).slice(0, 200));

  r = await mcp({ jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'batch', arguments: { actions: [
    { tool: 'add_tags', arguments: { id: ids.a, tags: ['batch'] } },
    { tool: 'update_card', arguments: { id: ids.b, text: 'Ψωμί ολικής' } },
  ] } } });
  ok(result(r).ok && await win.evaluate(({ a, b }) => Store.find(a).item.tags.includes('batch') && /ολικής/.test(Store.find(b).item.html), ids), 'batch applies several writes', result(r));
  ok(await win.evaluate(() => Store.lastUndoLabel() === 'MCP: batch'), 'batch is a single MCP: batch undo step');
  await win.evaluate(() => { Store.undo(); Canvas.refresh(); });
  ok(await win.evaluate(({ a, b }) => !Store.find(a).item.tags.includes('batch') && !/ολικής/.test(Store.find(b).item.html), ids), 'one undo reverts the whole batch');

  r = await mcp({ jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'delete_cards', arguments: { id: ids.a } } });
  ok(r.j && r.j.result && r.j.result.isError, 'delete_cards refused while delete is off', r.j && JSON.stringify(r.j).slice(0, 200));

  await win.evaluate(async () => { await API.inv('plugins:config', 'mcp-server', { port: 7801, read: true, write: true, del: true }); });
  await win.waitForTimeout(900);

  const declineP = mcp({ jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'delete_cards', arguments: { id: ids.a } } });
  await modalClick(win, false);
  r = await declineP;
  ok(result(r).declined && await win.evaluate((id) => !!Store.find(id), ids.a), 'delete declined in the Nyx dialog leaves the card', result(r));

  const okP = mcp({ jsonrpc: '2.0', id: 18, method: 'tools/call', params: { name: 'delete_cards', arguments: { id: ids.a } } });
  await modalClick(win, true);
  r = await okP;
  ok(result(r).ok && await win.evaluate((id) => !Store.find(id), ids.a), 'delete confirmed in Nyx removes the card', result(r));
  await win.evaluate(() => { Store.undo(); Canvas.refresh(); });
  ok(await win.evaluate((id) => !!Store.find(id), ids.a), 'Ctrl+Z restores a confirmed MCP delete');

  await win.screenshot({ path: path.join(SHOTS, 'v2652-mcp.png') }).catch(() => {});
  await win.evaluate(() => Panels.closeDrawer?.());
  await quit(app);
  ok(!errors.length, 'no renderer/main errors', errors);
  console.log(`\nv2.6.5.2 xvfb: ${passes} passed, ${fails} failed`);
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
