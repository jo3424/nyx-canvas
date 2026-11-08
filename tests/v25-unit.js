// Nyx v2.5 unit tests (plain node): GGUF/VRAM fit, Linux GPU sysfs, sd-server args, Faces maths, Sogni params + consent filter,
// photo enhance, attachments (zip-slip / bomb / limits / nested / encrypted, docx/xlsx/pptx/odt/csv/encodings/binary), memory, robots, sniff.
const path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib');
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); c ? passes++ : fails++; };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-v25u '));
(async () => {
  console.log('GGUF header + VRAM fit (7900 XTX 24 GB)');
  const gguf = require('../main/gguf');
  const str = (s) => { const b = Buffer.from(s); const l = Buffer.alloc(8); l.writeBigUInt64LE(BigInt(b.length)); return Buffer.concat([l, b]); };
  const kvS = (k, v) => Buffer.concat([str(k), Buffer.from([8, 0, 0, 0]), str(v)]); const kvU = (k, v) => { const b = Buffer.alloc(8); b.writeUInt32LE(4); b.writeUInt32LE(v, 4); return Buffer.concat([str(k), b]); };
  const mk = (file, kvs) => { const h = Buffer.alloc(24); h.write("GGUF"); h.writeUInt32LE(3, 4); h.writeBigUInt64LE(0n, 8); h.writeBigUInt64LE(BigInt(kvs.length), 16); fs.writeFileSync(file, Buffer.concat([h, ...kvs, Buffer.alloc(4096)])); };
  const gf = path.join(T, 'Qwen3.6-27B-UD-Q4_K_XL.gguf');
  mk(gf, [kvS('general.architecture', 'qwen3'), kvS('general.name', 'Qwen3.6 27B'), kvU('qwen3.block_count', 64), kvU('qwen3.embedding_length', 5120), kvU('qwen3.attention.head_count', 40), kvU('qwen3.attention.head_count_kv', 8), kvU('qwen3.attention.key_length', 128), kvU('qwen3.context_length', 262144)]);
  const hd = gguf.readHeader(gf); ok(hd.kv['general.architecture'] === 'qwen3' && hd.kv['qwen3.block_count'] === 64, 'reads GGUF v3 key/values', hd.kv);
  const s16 = gguf.summarize(gf, hd, { ctx: 16384, vramGB: 24, totalSize: 17.2 * 2 ** 30 });
  ok(/Q4_K_XL/.test(s16.quant) && s16.layers === 64 && s16.kvPerTok === 64 * 8 * 256 * 2, 'quant from name, layers, KV bytes/token', s16);
  ok(s16.fit === 'yes', '17.2 GB Q4 + 16k ctx fits in 24 GB', s16.need / 2 ** 30);
  const sBig = gguf.summarize(gf, hd, { ctx: 262144, vramGB: 24, totalSize: 17.2 * 2 ** 30 }); ok(sBig.fit === 'ctx' && sBig.ctxFit > 16384 && sBig.ctxFit < 262144, '262k ctx does not fit → suggests a max ctx that does', sBig);
  ok(gguf.summarize(gf, hd, { ctx: 8192, vramGB: 24, totalSize: 30 * 2 ** 30 }).fit === 'no', '30 GB weights → does not fit');
  let threw = false; try { fs.writeFileSync(path.join(T, 'x.gguf'), 'nope'); gguf.readHeader(path.join(T, 'x.gguf')); } catch (e) { threw = true; } ok(threw, 'non-GGUF file rejected');

  console.log('Perf: Linux amdgpu sysfs');
  const perf = require('../main/perf'); const drm = path.join(T, 'drm'); const dev = path.join(drm, 'card1', 'device'); fs.mkdirSync(path.join(dev, 'hwmon', 'hwmon3'), { recursive: true });
  fs.writeFileSync(path.join(dev, 'mem_info_vram_total'), String(24 * 2 ** 30)); fs.writeFileSync(path.join(dev, 'mem_info_vram_used'), String(6 * 2 ** 30)); fs.writeFileSync(path.join(dev, 'gpu_busy_percent'), '37'); fs.writeFileSync(path.join(dev, 'product_name'), 'Radeon RX 7900 XTX');
  fs.writeFileSync(path.join(dev, 'hwmon', 'hwmon3', 'temp1_input'), '54000'); fs.writeFileSync(path.join(dev, 'hwmon', 'hwmon3', 'temp1_label'), 'edge'); fs.writeFileSync(path.join(dev, 'hwmon', 'hwmon3', 'temp2_input'), '71000'); fs.writeFileSync(path.join(dev, 'hwmon', 'hwmon3', 'temp2_label'), 'junction');
  const g = perf.linuxGpu(drm); ok(g.adapters[0]?.total === 24 * 2 ** 30 && g.adapters[0].used === 6 * 2 ** 30 && g.util === 37, 'VRAM total/used + busy %', g);
  ok(g.temp === 54 && g.hot === 71, 'edge + junction (hotspot) temperature', g);
  ok(perf.linuxGpu(path.join(T, 'none')).adapters.length === 0, 'no GPU → empty, no crash');

  console.log('sd-server (stable-diffusion.cpp) process args');
  const procs = require('../main/procs');
  const sa = procs.argsFor('sd', { modelDir: 'D:\\models\\sd', loraDir: 'D:\\models\\lora', port: 7861, extra: '--vae-tiling' });
  ok(JSON.stringify(sa) === JSON.stringify(['--model-dir', 'D:\\models\\sd', '--lora-model-dir', 'D:\\models\\lora', '--listen-ip', '127.0.0.1', '--listen-port', '7861', '--vae-tiling']), 'model/LoRA dirs, localhost only, port, extra args', sa);
  const exe = path.join(T, 'sd-server'); fs.writeFileSync(exe, '');
  ok(procs.precheck('sd', { exe, modelDir: path.join(T, 'missing') })?.field === 'modelDir' && procs.precheck('sd', { exe, modelDir: T }) === null, 'precheck: missing model folder reported, existing ok');
  ok(/windowsHide: true/.test(fs.readFileSync(path.join(__dirname, '..', 'main', 'procs.js'), 'utf8')), 'spawned servers use windowsHide');

  console.log('Faces maths (YuNet/SFace)');
  const fc = require('../main/faces-core');
  ok(Math.abs(fc.iou([0, 0, 10, 10], [5, 0, 10, 10]) - 1 / 3) < 1e-6, 'IoU');
  const M = fc.similarity(fc.TEMPLATE.map(([x, y]) => [x * 2 + 10, y * 2 + 5]), fc.TEMPLATE); ok(Array.isArray(M) || M?.length >= 6, 'similarity transform computed', M);
  const a = fc.l2([1, 2, 3]), b = fc.l2([1, 2, 3.1]), c2 = fc.l2([-3, 1, 0]); ok(fc.cos(a, b) > 0.99 && fc.cos(a, c2) < fc.SAME, 'cosine same/different vs SFace threshold');
  ok(fc.fromB64(fc.toB64(Float32Array.from([1.5, -2]))).join() === '1.5,-2', 'embedding base64 round-trip');

  console.log('Sogni params + consent filter');
  const sog = require('../main/sogni'); const { SEXUAL } = require('../main/v25');
  const p1 = sog.params('identity', { prompt: 'portrait in a forest', images: ['a', 'b'], w: 3000, h: 2000 }); ok(p1.type === 'image' && p1.width === 1024 && p1.height % 16 === 0 && p1.contextImages.length === 2, 'identity: 1024 long side, /16, reference images', p1);
  const p2 = sog.params('i2v', { prompt: 'x', images: ['a'], seconds: 30, w: 720, h: 1280 }); ok(p2.type === 'video' && p2.duration === 10 && p2.height === 832, 'i2v: duration capped at 10 s, 832 long side', p2);
  ok(SEXUAL.test('make her nude') && SEXUAL.test('βγάλε τα ρούχα, γυμνή') && SEXUAL.test('undress') && !SEXUAL.test('φωτορεαλιστικό πορτρέτο στο δάσος'), 'face/identity tools refuse sexual prompts (EL/EN)');

  console.log('Photo batch enhance');
  const { enhance } = require('../main/photo-worker'); const W = 64, H = 64; const px = Buffer.alloc(W * H * 4); for (let i = 0; i < W * H; i++) { const v = 60 + (i % W) * 1.5; px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v + 5; px[i * 4 + 3] = 255; }
  const out = enhance(px, W, H); let lo = 255, hi = 0; for (let i = 0; i < W * H; i++) { lo = Math.min(lo, out[i * 4 + 1]); hi = Math.max(hi, out[i * 4 + 1]); }
  ok(out.length === px.length && hi - lo > 120, 'auto-levels stretches a low-contrast image', { lo, hi }); ok(out[3] === 255, 'alpha kept');

  console.log('Attachments: classify / decode / office text');
  const at = require('../main/attach'); const zip = require('../main/zip');
  ok(at.kindOf('a.JPG') === 'image' && at.kindOf('x.docx') === 'docx' && at.kindOf('d.csv') === 'csv' && at.kindOf('Makefile') === 'text' && at.kindOf('a.py') === 'code' && at.kindOf('weird.xyz') === 'unknown', 'kind by extension');
  ok(at.decode(Buffer.from([0xff, 0xfe, 0x93, 0x03, 0xb5, 0x03])) === 'Γε', 'UTF-16LE BOM'); ok(at.decode(Buffer.from([0xc3, 0xe5, 0xe9, 0xdc])) === 'Γειά', 'windows-1253 Greek fallback');
  ok(at.isBinary(Buffer.from([0, 1, 2, 3, 0, 0])) && !at.isBinary(Buffer.from('γεια σου\n')), 'binary detection');
  ok(at.safeRel('../evil.txt') === null && at.safeRel('/etc/passwd') === null && at.safeRel('C:/x') === null && at.safeRel('a/../../b') === null && at.safeRel('a/./b.txt') === 'a/b.txt', 'zip-slip names rejected');
  const W_ = (n, s) => ({ name: n, data: Buffer.from(s) });
  const docx = zip.write([W_('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Σύμβαση φωτογράφισης</w:t></w:r></w:p><w:p><w:r><w:t>Μοντέλο: Μαρία</w:t></w:r></w:p></w:body></w:document>')]);
  const xlsx = zip.write([W_('xl/sharedStrings.xml', '<sst><si><t>Όνομα</t></si><si><t>Τιμή</t></si><si><t>Λίμνη</t></si></sst>'), W_('xl/workbook.xml', '<workbook><sheets><sheet name="Φύλλο1" sheetId="1" r:id="rId1"/></sheets></workbook>'), W_('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>')]);
  const pptx = zip.write([W_('ppt/slides/slide1.xml', '<p:sld><a:t>Διαφάνεια ένα</a:t></p:sld>'), W_('ppt/slides/slide2.xml', '<p:sld><a:t>Δεύτερη</a:t></p:sld>')]);
  const odt = zip.write([W_('content.xml', '<office:document-content><text:p>Κείμενο ODT</text:p></office:document-content>')]);
  for (const [n, d] of [['a.docx', docx], ['b.xlsx', xlsx], ['c.pptx', pptx], ['d.odt', odt]]) fs.writeFileSync(path.join(T, n), d);
  fs.writeFileSync(path.join(T, 'e.csv'), 'όνομα;ποσό\nΓιώργος;12\n'); fs.writeFileSync(path.join(T, 'f.bin'), Buffer.from([0, 1, 2, 0, 9, 0, 255, 0])); fs.writeFileSync(path.join(T, 'g.xyz'), 'plain text in an unknown extension');
  fs.writeFileSync(path.join(T, 'h.html'), '<html><script>evil()</script><p>Γεια</p></html>');
  const I = async (n) => at.inspect(path.join(T, n));
  let r = await I('a.docx'); ok(/Σύμβαση φωτογράφισης/.test(r.text) && /Μαρία/.test(r.text), 'docx text', r);
  r = await I('b.xlsx'); ok(/Όνομα/.test(r.text) && /Λίμνη/.test(r.text) && /42/.test(r.text), 'xlsx cells (shared strings + numbers)', r);
  r = await I('c.pptx'); ok(/Διαφάνεια ένα/.test(r.text) && /Δεύτερη/.test(r.text), 'pptx slides', r);
  r = await I('d.odt'); ok(/Κείμενο ODT/.test(r.text), 'odt', r);
  r = await I('e.csv'); ok(/Γιώργος/.test(r.text), 'csv', r);
  r = await I('f.bin'); ok(r.error === 'unsupported' && r.code === 'BINARY', 'binary unknown → reported as unreadable, not guessed', r);
  r = await I('g.xyz'); ok(r.kind === 'text' && /plain text/.test(r.text), 'unknown extension but text → read as text', r);
  r = await I('h.html'); ok(/Γεια/.test(r.text) && !/evil/.test(r.text), 'html: scripts stripped', r);

  console.log('Attachments: safe ZIP');
  const inner = zip.write([W_('deep.txt', 'βαθύ αρχείο')]);
  const encZip = (() => { const z = zip.write([W_('secret.txt', 'top secret')]); const b = Buffer.from(z); let i = -1; while ((i = b.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), i + 1)) >= 0) b[i + 6] |= 1; i = -1; while ((i = b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i + 1)) >= 0) b[i + 8] |= 1; return b; })();
  const bomb = zlib.deflateRawSync(Buffer.alloc(3 * 1024 * 1024));
  const main = zip.write([W_('notes/readme.md', '# Φωτογράφιση\nΛίμνη Πλαστήρα'), W_('../evil.txt', 'pwned'), W_('/abs.txt', 'pwned'), W_('__MACOSX/._x', 'junk'), { name: 'inner.zip', data: inner }, W_('zeros.bin', Buffer.alloc(3 * 1024 * 1024).toString())]);
  fs.writeFileSync(path.join(T, 'main.zip'), main); fs.writeFileSync(path.join(T, 'enc.zip'), encZip);
  const dest = path.join(T, 'out'); const u = await at.unzipSafe(path.join(T, 'main.zip'), dest);
  const names = at.flat(u.tree).map(n => n.rel);
  ok(names.includes('notes/readme.md') && names.includes('inner.zip') && names.includes('deep.txt'), 'regular + nested zip extracted', names);
  ok(!fs.existsSync(path.join(T, 'evil.txt')) && u.skipped.filter(s => s.reason === 'unsafe-path').length === 2, 'zip-slip (../ and absolute) blocked', u.skipped);
  ok(!names.some(n => /MACOSX/.test(n)), '__MACOSX junk ignored');
  ok(u.skipped.some(s => s.rel === 'zeros.bin' && s.reason === 'zip-bomb'), 'high-ratio entry skipped as zip bomb', u.skipped);
  ok(fs.readdirSync(dest).every(f => !f.startsWith('..')) && at.flat(u.tree).every(n => n.path.startsWith(dest)), 'everything stays inside the temp folder');
  const ue = await at.unzipSafe(path.join(T, 'enc.zip'), path.join(T, 'out2')); ok(ue.skipped.some(s => s.reason === 'encrypted'), 'encrypted entries reported, not extracted', ue.skipped);
  const many = zip.write(Array.from({ length: 12 }, (_, i) => W_(`f${i}.txt`, 'x' + i))); fs.writeFileSync(path.join(T, 'many.zip'), many);
  const um = await at.unzipSafe(path.join(T, 'many.zip'), path.join(T, 'out3'), { limits: { files: 5 } }); ok(um.files === 5 && um.skipped.filter(s => s.reason === 'too-many-files').length === 7, 'file-count limit', um.files);
  let lvl = zip.write([W_('l3.txt', 'x')]); for (let d = 2; d >= 0; d--) lvl = zip.write([{ name: `l${d}.zip`, data: lvl }]); fs.writeFileSync(path.join(T, 'nest.zip'), lvl);
  const un = await at.unzipSafe(path.join(T, 'nest.zip'), path.join(T, 'out4')); ok(at.flat(un.tree).some(n => n.note === 'nested-too-deep'), 'nesting depth limit', at.flat(un.tree).map(n => [n.rel, n.note]));
  ok(at.LIMITS.zipMax <= 512 * 2 ** 20 && at.LIMITS.totalMax <= 2 ** 30, 'size limits set (zip ≤512 MB, total ≤1 GB)');

  console.log('Memory (local JSON): dedupe / recall / skills / journal');
  const { Memory, similar } = require('../main/memory'); const mf = path.join(T, 'mem', 'm.json'); const m = new Memory(mf);
  const f1 = m.add({ text: 'Προτιμώ φωτορεαλιστικές εικόνες', kind: 'preference' }); const f2 = m.add({ text: 'προτιμώ φωτορεαλιστικές εικόνες!', kind: 'preference' });
  ok(f2.merged && m.list().facts.length === 1 && m.list().facts[0].n === 2, 'near-duplicate merged (accents/case/punctuation)', m.list());
  m.add({ text: 'Η κάρτα γραφικών μου είναι 7900 XTX', kind: 'profile' }); m.add({ text: 'Ο φωτογράφος συνεργάτης λέγεται Νίκος', kind: 'person' });
  const hits = m.search('ποια κάρτα γραφικών έχω;'); ok(hits[0] && /7900/.test(hits[0].text), 'keyword recall ranks the right fact', hits);
  ok(!similar('Μου αρέσουν οι γάτες', 'Δεν μου αρέσουν οι σκύλοι'), 'different facts not merged');
  const emb = (x) => Float32Array.from([x, 1 - x, 0.3]); m.add({ text: 'Αγαπημένο χρώμα: μωβ', kind: 'preference', emb: Array.from(emb(0.9)) });
  ok(m.search('purple', { emb: Array.from(emb(0.88)) }).some(h => /μωβ/.test(h.text)), 'embedding recall finds a fact with no shared words');
  ok(m.forget(f1.fact.id) === 1 && !m.list().facts.some(f => /φωτορεαλιστ/.test(f.text)), 'forget removes the fact');
  const sk = m.skillSave({ name: 'Ταπετσαρίες φύσης', trigger: 'nature wallpapers καμβά', steps: ['web_media_to_canvas nature wallpapers', 'group'] });
  ok(m.skillMatch('βρες nature wallpapers για τον καμβά')[0]?.id === sk.id, 'skill matched by trigger words');
  m.skillNote(sk.id, 'μόνο οριζόντιες'); m.skillNote(sk.id, 'Μόνο οριζόντιες'); ok(m.list().skills[0].notes.length === 1 && m.list().skills[0].v === 3, 'correction notes deduped, version bumps');
  m.journal({ text: 'έβαλα 2 εικόνες', acts: ['web_media_to_canvas'] }); const days = m.list().days; ok(days.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(days[0]) && m.day(days[0])[0].acts[0] === 'web_media_to_canvas', 'dated journal');
  await m.save(); ok(JSON.parse(fs.readFileSync(mf, 'utf8')).facts.length === 3 && !fs.existsSync(mf + '.tmp'), 'saved atomically to the data folder');
  ok(!/https?:\/\//.test(fs.readFileSync(path.join(__dirname, '..', 'main', 'memory.js'), 'utf8').replace(/\/\/.*$/gm, '')), 'memory module has no network code');

  console.log('Web agent: robots / sniff / blocked hosts');
  const wa = require('../main/webagent');
  const rules = wa.parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/\nAllow: /private/ok\nDisallow: /*.pdf$\n');
  ok(wa.robotsAllows(rules, '/img/1.png') && !wa.robotsAllows(rules, '/private/x.png') && wa.robotsAllows(rules, '/private/ok/a.png'), 'robots Disallow/Allow (longest match), only our group', rules);
  ok(!wa.robotsAllows(rules, '/doc/a.pdf') && wa.robotsAllows(rules, '/doc/a.pdf?x=1') === true, 'robots * and $ wildcards');
  ok(wa.sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])) === 'image/jpeg' && wa.sniff(Buffer.from('\x89PNG\r\n\x1a\n0000', 'latin1')) === 'image/png' && wa.sniff(Buffer.from('<html>hi</html>xxxx')) === '', 'magic-byte sniff (html posing as image rejected)');
  ok(['www.youtube.com', 'i.ytimg.com', 'scontent.cdninstagram.com', 'video.fbcdn.net', 'www.netflix.com', 'www.tiktok.com'].every(h => wa.NO_GRAB.test(h)) && !wa.NO_GRAB.test('upload.wikimedia.org') && !wa.NO_GRAB.test('live.staticflickr.com'), 'streaming/social hosts never downloaded');
  ok(/protected field/.test(wa.SCRIPTS.fill({ selector: 'input' })) && /password|card|otp/i.test(wa.SCRIPTS.fill({})), 'fill script refuses password/card/OTP fields');
  ok(!/eval\(|new Function/.test(Object.values(wa.SCRIPTS).map(f => f({})).join('\n')), 'fixed page scripts only (no eval of model text)');

  fs.rmSync(T, { recursive: true, force: true });
  console.log(`\nv2.5 unit: ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
