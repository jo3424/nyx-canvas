'use strict';
// v2.7.0 unit: (α) widget data (pure NyxWidgetData) from a fixed «now»; (β) fixes: model size from the real files
// (MTP / mmproj never count, split GGUF summed), VRAM from the processes, board delete is an undo step + bin prune,
// the assistant ignores Voice Studio; (γ) static guards vs 2.6.13.1 (296da39): main/ untouched, no new URL / spawn,
// settings only added, Electron 45.2.3, router / ctx / models-max untouched, locales complete, versions / CHANGELOG.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const R = process.env.NYX_ROOT || path.join(__dirname, '..');
let passes = 0, fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); c ? passes++ : fails++; };
const read = (f) => { try { return fs.readFileSync(path.join(R, f), 'utf8'); } catch (_) { return ''; } };
const git = (a) => { try { return cp.execSync('git ' + a, { cwd: R, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }).toString(); } catch (e) { return null; } };
const D = require(path.join(R, 'app/js/v27/widgetdata.js'));
const F = require(path.join(R, 'app/js/v27/fixes270.js'));

console.log('(α) widget data');
const NOW = new Date(2026, 10, 19, 12, 0, 0).getTime(); // Thu 19 Nov 2026 12:00 local
const at = (d, hh, mm) => { const x = new Date(NOW); x.setDate(x.getDate() + d); x.setHours(hh, mm || 0, 0, 0); return x.toISOString(); };
const S = { active: 'b1', boards: [
  { id: 'b1', name: 'Αρχική', items: [
    { id: 'r1', type: 'sticky', html: 'Πότισμα φυτών', reminder: { on: true, at: at(0, 14) } },
    { id: 'r2', type: 'sticky', html: 'Τηλέφωνο στον λογιστή', reminder: { on: true, at: at(1, 10) } },
    { id: 'r3', type: 'sticky', html: 'Γενέθλια φίλου 🎂', reminder: { on: true, at: at(4, 9), repeat: 'yearly' } },
    { id: 'r4', type: 'sticky', html: 'Παλιό', reminder: { on: true, at: at(-3, 9) } },
    { id: 'r5', type: 'sticky', html: 'Σβηστή', reminder: { on: false, at: at(2, 9) } },
    { id: 't1', type: 'sticky', html: 'Ιδέα 1', tags: ['ιδέες'] }, { id: 't2', type: 'sticky', html: 'Ιδέα 2', tags: ['#Ιδέες', 'δώρα'] },
  ] },
  { id: 'b2', name: 'Δουλειά', items: [{ id: 't3', type: 'sticky', html: 'Γραφείο', tags: ['ιδέες'] }] },
], subs: [] };
const rem = D.reminders(S, NOW, 3);
ok(rem.items.map((e) => e.id).join() === 'r1,r2,r3' && rem.total >= 3, 'reminders: upcoming, sorted, switched-off and long-past left out', rem.items.map((e) => e.id));
ok(D.rel(at(0, 14), NOW).k === 'in_h' && D.rel(at(1, 10), NOW).k === 'tomorrow' && D.rel(at(4, 9), NOW).k === 'days' && D.rel(at(4, 9), NOW).n === 4, 'rel: «σε 2 ώρες» / «αύριο» / «σε 4 μέρες»');
const td = D.today(S, NOW, {});
ok(td.items.some((e) => e.id === 'r1') && !td.items.some((e) => e.id === 'r2') && td.tomorrow === 1 && td.next && td.next.id === 'r2', 'today: today\'s items; tomorrow counted + «next» = r2', td);
const cal = D.calendar(S, 2026, 11, NOW, {});
const flat = cal.weeks.flat(); const c19 = flat.find((c) => c.inMonth && c.d === 19);
ok(cal.weeks.length === 6 && cal.weeks.every((w) => w.length === 7) && flat[0].d === 26 && !flat[0].inMonth, 'calendar: 6×7 grid, Monday first (Nov 2026 starts on Sun → 26 Oct first)', flat[0]);
ok(c19 && c19.today && flat.find((c) => c.inMonth && c.d === 23).n >= 1, 'calendar: today marked, a dot on the birthday day', c19);
const tg = D.tagged(S, '#ΙΔΈΕΣ', 10);
ok(tg.total === 3 && tg.items.map((x) => x.id).sort().join() === 't1,t2,t3' && tg.items.find((x) => x.id === 't3').board === 'Δουλειά', '#tag: case / accent / «#» insensitive, across boards', tg);
ok(D.allTags(S)[0].tag === 'ιδέες' && D.allTags(S)[0].n === 3, 'allTags: most used first');
const it = D.newItem('calendar', 'l', { title: 'x' });
ok(it.type === 'widget' && it.wkind === 'calendar' && it.wsize === 'l' && it.w === D.sizeFor('calendar', 'l').w, 'newItem: a normal canvas item (type widget, only new fields)', it);
let threw = false; try { D.newItem('weather', 'm'); } catch (e) { threw = true; } ok(threw, 'newItem: kinds not in 2.7.0 (weather) refused');
ok(D.KINDS.join() === 'today,subs,reminders,calendar,tag', 'kinds in 2.7.0: today, subs, reminders, calendar, tag');

console.log('(β) fixes');
const G = 1e9; const QW = 'Qwen3.8-27B-UD-Q4_K_XL';
const files = [{ name: 'mtp-Qwen3.8-27B-Q4_0.gguf', rel: QW + '/mtp-Qwen3.8-27B-Q4_0.gguf', size: 1.68 * G }, { name: 'mmproj-F16.gguf', rel: QW + '/mmproj-F16.gguf', size: 0.9 * G }, { name: QW + '.gguf', rel: QW + '/' + QW + '.gguf', size: 17.7 * G },
  { name: 'Big-00001-of-00002.gguf', rel: 'Big/Big-00001-of-00002.gguf', size: 10 * G }, { name: 'Big-00002-of-00002.gguf', rel: 'Big/Big-00002-of-00002.gguf', size: 5 * G }, { name: 'draft-small.gguf', rel: 'Odd/draft-small.gguf', size: 0.5 * G }, { name: 'odd-main.gguf', rel: 'Odd/odd-main.gguf', size: 4 * G }];
ok(F.modelBytes(QW, files).bytes === 17.7 * G, '(a) Qwen = 17,7 GB from its file — not the 1,68 GB MTP draft, not the mmproj');
ok(F.modelBytes(QW, files.filter((f) => f.name !== QW + '.gguf')).bytes === 0, '(a) only MTP + mmproj in the folder → unknown (0 → «—»), never the draft size');
ok(F.modelBytes('Big', files).bytes === 15 * G, '(a) split GGUF (-00001-of-00002…) summed');
ok(F.modelBytes('Odd', files).bytes === 4 * G, '(a) model named after its folder → biggest main file, drafts skipped');
ok(F.isAux('mtp-x.gguf') && F.isAux('mmproj-x.gguf') && F.isAux('x-draft.gguf') && !F.isAux(QW + '.gguf'), '(a) MTP / mmproj / draft recognised');
const hubSrc = read('app/js/v2/hub-tabs.js');
ok(/NyxFix270\.modelBytes\(name, files\)\.bytes : 0\) \|\| m\.size/.test(hubSrc) && !/m\.size \|\| m\.bytes \|\| \(f && f\.size\)/.test(hubSrc), '(a) Hub card bytes come from modelBytes (the old first-file-in-folder size is gone)');
ok(!/1[.,]7 ?GB|17[.,]7 ?GB|17700000000/.test((hubSrc + '\n' + read('app/js/v27/fixes270.js')).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')), '(a) no size hard-coded');
const GiB = 1073741824;
const snap = { gpu: { adapter: { total: 24 * GiB, used: 22 * GiB }, procs: [{ pid: 1, name: 'llama-server', owner: 'llama', path: 'C:\\llama\\llama-server.exe', vram: 20 * GiB }, { pid: 2, name: 'llama-server', path: 'D:\\GPU-Voice-Studio\\llama-server.exe', vram: 1 * GiB }, { pid: 3, name: 'Nyx Canvas', owner: 'nyx:GPU', vram: 0.5 * GiB }, { pid: 4, name: 'x', vram: 0 }] } };
const V = F.vramFromProcs(snap);
ok(V.total === 21.5 * GiB && V.llama === 20 * GiB && V.count === 3 && V.top[0].label === 'llama-server' && V.top.some((x) => /Voice Studio/.test(x.label)), '(b) VRAM = sum of the processes; router llama-server alone for the model chip (Voice Studio excluded)', V);
ok(F.vramFromProcs({ gpu: { adapter: { used: 1 } } }) === null && F.vramFromProcs(null) === null, '(b) no per-process numbers → null (Hub falls back to the card total, labelled as such)');
ok(/vramFromProcs\(pf\)/.test(hubSrc) && /'data-vram-src', 'procs'/.test(hubSrc) && /'data-vram-src', 'adapter'/.test(hubSrc), '(b) Hub status + model chip use the processes, adapter only as fallback');
ok(/procs/.test(read('main/res/gpu.ps1')) || /GPUProcessMemory/.test(read('main/res/gpu.ps1')), '(b) the per-process source is the existing gpu.ps1 (since 2.5)');
const app = read('app/js/app.js');
ok(/Store\.change\(\(\) => \{ Store\.state\.boards\.splice\(i, 1\);/.test(app) && /Store\.binPrune\(\); Bin\.badge\(\);/.test(app) && /boards\.some\(\(x\) => x\.id === tr\.b\.id\)/.test(app), '(c) board delete is one undo step; toast «Αναίρεση» prunes the Bin and never duplicates the board');
// (c) the real Bin logic: after the board comes back, prune drops its cards
const NyxBin = require(path.join(R, 'app/js/v26/bin.js'));
const st = { boards: [{ id: 'a', items: [] }], subs: [], bin: [{ kind: 'card', id: 'k1' }, { kind: 'card', id: 'k2' }, { kind: 'card', id: 'other' }] };
st.boards.push({ id: 'bx', items: [{ id: 'k1' }, { id: 'k2' }] });
ok(NyxBin.prune(st) === 2 && st.bin.map((e) => e.id).join() === 'other', '(c) prune: the restored board\'s cards leave the Bin, others stay');
const as = read('app/js/v2/assistant.js');
ok(/NyxLimits\.vramWarn\(snap, \{ ignoreGvs: true \}\)/.test(as) && !/NyxLimits\.vramWarn\(snap\)/.test(as), '(d) assistant chat: vramWarn ignores Voice Studio (as the Hub since 2.6.13.1)');

console.log('(γ) static guards vs 2.6.13.1');
const base = '296da39';
if (git('cat-file -e ' + base) !== null) {
  ok(git(`diff --name-only ${base} -- main electron-builder.yml build`).trim() === '', '(γ) main/ untouched (no new IPC, no new system query)');
  const add = git(`diff -U0 ${base} -- app main`).split('\n').filter((l) => /^\+(?!\+\+)/.test(l));
  ok(!add.some((l) => /https?:\/\//.test(l)), '(γ) no new URL', add.filter((l) => /https?:\/\//.test(l)));
  ok(!add.some((l) => /\b(spawn|execFile|exec|fork)\s*\(/.test(l)), '(γ) no new spawn / exec');
  ok(!add.some((l) => /localStorage\.removeItem|delete Store\.state\.settings|delete S\.settings/.test(l)), '(γ) no setting removed');
  const del = git(`diff -U0 ${base} -- app/locales/el.json app/locales/en.json`).split('\n').filter((l) => /^-(?!--)/.test(l));
  ok(del.every((l) => /^-\s*"[^"]+": .*[^,]$/.test(l)), '(γ) locales: only additions (the last line got a comma)', del.slice(0, 4));
  const coreD = git(`diff ${base} -- app/js/v2/core.js app/js/store.js`);
  ok(coreD === '', '(γ) settings defaults (core.js) + Store untouched — settings only added');
} else ok(false, '(γ) base 296da39 not in this checkout');
const el = JSON.parse(read('app/locales/el.json')), en = JSON.parse(read('app/locales/en.json'));
const used = new Set([...(read('app/js/v27/widgets.js') + read('app/js/v2/hub-tabs.js') + read('app/js/app.js') + read('app/js/panels.js') + read('app/index.html')).matchAll(/v270\.[a-z_0-9]+/g)].map((m) => m[0]).filter((k) => !/_$/.test(k) && k !== 'v270.css'));
const miss = [...used].filter((k) => !el[k] || !en[k]);
ok(used.size > 40 && !miss.length, `(γ) every v270.* string used exists in el + en (${used.size})`, miss);
const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json')), CH = JSON.parse(read('CHANGELOG.json'));
ok(pkg.version === '2.7.0' && lock.version === '2.7.0' && lock.packages[''].version === '2.7.0', '(γ) version 2.7.0 (package.json + package-lock)');
ok(pkg.devDependencies.electron === '45.2.3', '(γ) Electron 45.2.3');
ok(Object.keys(CH)[0] === '2.7.0' && CH['2.7.0'].el.length === CH['2.7.0'].en.length && CH['2.6.13.1'], '(γ) CHANGELOG 2.7.0 first, el/en same length');
const addAll = (git(`diff -U0 ${base} -- app main`) || '').split('\n').filter((l) => /^\+(?!\+\+)/.test(l)).join('\n');
ok(!/models-max|servers\.llama\.(ctx|extra|exe|model)\s*=|ai:routerStart|proc:start/.test(addAll), '(γ) router / models / ctx 32768 / models-max 1: nothing in the new lines touches them');
const idx = read('app/index.html');
ok(idx.indexOf('js/v27/fixes270.js') > 0 && idx.indexOf('js/v27/fixes270.js') < idx.indexOf('js/v2/hub-tabs.js') && /v270\.css/.test(idx) && /id="btn-widgets"/.test(idx), '(γ) index.html: fixes270 before hub-tabs, v270.css, top-bar «Widgets» button');
ok(!/omnivoice|vs-engine|vsengine/i.test(read('app/js/v27/widgets.js') + read('app/js/v27/widgetdata.js') + read('app/js/v27/fixes270.js')), '(γ) no local voice anywhere in the new code');
console.log(`\nv2.7.0 unit: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
