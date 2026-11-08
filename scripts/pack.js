// Portable Windows x64 build: node scripts/pack.js
//  → dist/NyxCanvas-v<ver>-win-x64.zip + dist/parts-v<ver>/ (parts ≤ 24 MB, ENOSE-ME.bat, MD5SUMS.txt)
//  → dist/updates/tree-<version>.json            (exact shipped code tree = base for the next signed delta, see make-patch.js)
// v2.5.1: Electron fuses are flipped on the packaged binary (RunAsNode, NODE_OPTIONS, --inspect off; embedded asar
// integrity + only-load-from-asar on). The old "asar swap" code patch is gone: with asar integrity the app.asar is bound
// to its exe, so app.asar must never be replaced on its own (code updates go through the signed updater instead).
//   node scripts/pack.js --platform linux   → dist/NyxCanvas-linux-x64 only (fused test build, no zip)
const { packager } = require('@electron/packager');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const asar = require('@electron/asar');
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto'), { execFileSync } = require('child_process');
const core = require('../main/update-core'); const { IGNORE, copyFiltered } = require('./pack-filter');
const ROOT = path.join(__dirname, '..'), DIST = path.join(ROOT, 'dist');
const VERSION = require('../package.json').version; const V = 'v' + VERSION.replace(/\.0$/, ''); // 2.1.0 → v2.1
const PLATFORM = process.argv.includes('--platform') ? process.argv[process.argv.indexOf('--platform') + 1] : 'win32';
const PARTS = path.join(DIST, 'parts-' + V), ZIPN = `NyxCanvas-${V}-win-x64.zip`;
const README = path.join(ROOT, `README-${V}.md`);
const PART = 24 * 1000 * 1000; // 24 MB (decimal, safely under any 24 MiB limit)
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const pyzip = (zip, base, dir) => execFileSync('python3', ['-c', `import shutil,sys; shutil.make_archive(sys.argv[1][:-4], 'zip', sys.argv[2], sys.argv[3])`, zip, base, dir], { stdio: 'inherit' });
(async () => {
  fs.mkdirSync(DIST, { recursive: true });
  execFileSync(process.execPath, [path.join(__dirname, 'gen-unpacked-hashes.js')], { stdio: 'inherit' }); // hashes for app.asar.unpacked live inside app.asar
  for (const p of (PLATFORM === 'win32' ? ['NyxCanvas-win32-x64', 'parts-' + V, ZIPN] : ['NyxCanvas-linux-x64'])) fs.rmSync(path.join(DIST, p), { recursive: true, force: true });
  const [out] = await packager({
    dir: ROOT, out: DIST, name: 'NyxCanvas', executableName: 'NyxCanvas', platform: PLATFORM, arch: 'x64', electronVersion: require('electron/package.json').version,
    icon: path.join(ROOT, 'build', 'icon.ico'), asar: { unpack: '{**/main/res/**,**/app/plugins/**}' }, prune: true, overwrite: true, appVersion: VERSION,
    appCopyright: 'jonh', win32metadata: { CompanyName: 'jonh', FileDescription: 'Nyx Canvas', ProductName: 'Nyx Canvas', InternalName: 'NyxCanvas' },
    ignore: IGNORE,
  });
  const RES = path.join(out, 'resources');
  // 0) Electron fuses (written into the exe; Windows/macOS also enforce the embedded app.asar integrity hash)
  const EXE = path.join(out, PLATFORM === 'win32' ? 'NyxCanvas.exe' : 'NyxCanvas');
  await flipFuses(EXE, {
    version: FuseVersion.V1, strictlyRequireAllFuses: false,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log('fuses flipped on', EXE);
  if (PLATFORM === 'win32') { const exe = fs.readFileSync(EXE), hdr = asar.getRawHeader(path.join(RES, 'app.asar')).headerString, h = crypto.createHash('sha256').update(hdr).digest('hex');
    if (!exe.includes(Buffer.from(h)) && !exe.includes(Buffer.from(h, 'utf16le'))) throw new Error('asar integrity hash not embedded in the exe'); console.log('asar integrity hash embedded in exe:', h.slice(0, 16) + '…'); }
  // 1) shipped code tree: extract app.asar (+ unpacked) and compare with the filtered worktree
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-pack-')); const ex = path.join(tmp, 'asar'); asar.extractAll(path.join(RES, 'app.asar'), ex);
  const shipped = core.treeManifest(ex), wt = core.treeManifest(copyFiltered(ROOT, path.join(tmp, 'wt')));
  const diff = [...new Set([...Object.keys(shipped), ...Object.keys(wt)])].filter(r => r !== 'package.json' && (!shipped[r] || !wt[r] || shipped[r].sha256 !== wt[r].sha256)); // packager strips scripts/devDependencies
  if (diff.length) throw new Error('asar ≠ filtered tree: ' + diff.slice(0, 10).join(', '));
  const bad = Object.keys(shipped).filter(r => /\.(pem|key)$|nebula-keys|node_modules\//i.test(r)); if (bad.length) throw new Error('forbidden files in asar: ' + bad.join(', '));
  if (JSON.parse(fs.readFileSync(path.join(ex, 'package.json'), 'utf8')).version !== VERSION) throw new Error('asar version mismatch');
  fs.mkdirSync(path.join(DIST, 'updates'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'updates', `tree-${VERSION}.json`), JSON.stringify({ version: VERSION, electron: require('electron/package.json').version, files: shipped }));
  console.log(`asar = filtered tree (${Object.keys(shipped).length} files) → dist/updates/tree-${VERSION}.json`);
  if (PLATFORM !== 'win32') { fs.rmSync(tmp, { recursive: true, force: true }); console.log('OK', out); return; }
  // 2) Greek README for Windows Notepad (UTF-8 BOM + CRLF)
  const readme = '\ufeff' + fs.readFileSync(README, 'utf8').replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(path.join(out, 'ΔΙΑΒΑΣΕ-ΜΕ.txt'), readme); fs.copyFileSync(README, path.join(out, path.basename(README)));
  // 3) full zip + parts
  const zip = path.join(DIST, ZIPN); pyzip(zip, DIST, path.basename(out));
  const buf = fs.readFileSync(zip), sum = md5(buf);
  fs.mkdirSync(PARTS, { recursive: true });
  const names = [];
  for (let i = 0, o = 0; o < buf.length; i++, o += PART) { const n = `NyxCanvas-${V}.zip.part${String(i).padStart(2, '0')}`; fs.writeFileSync(path.join(PARTS, n), buf.subarray(o, o + PART)); names.push(n); }
  fs.writeFileSync(path.join(PARTS, 'MD5SUMS.txt'), names.map(n => `${md5(fs.readFileSync(path.join(PARTS, n)))}  ${n}`).concat(`${sum}  ${ZIPN}`).join('\r\n') + '\r\n');
  const bat = [
    '@echo off', 'chcp 65001 >nul', 'cd /d "%~dp0"',
    'echo Enono ta kommatia...',
    `copy /b ${names.join('+')} ${ZIPN} >nul`,
    'if errorlevel 1 (echo SFALMA: leipei kapoio kommati & pause & exit /b 1)',
    'echo Elegxos MD5...',
    'set "SUM="',
    `for /f "skip=1 delims=" %%H in ('certutil -hashfile ${ZIPN} MD5') do if not defined SUM set "SUM=%%H"`,
    'set "SUM=%SUM: =%"',
    `if /i "%SUM%"=="${sum}" (echo OK - ${ZIPN}  MD5 %SUM%) else (echo SFALMA MD5: %SUM% anti gia ${sum} & pause & exit /b 1)`,
    'echo Kane deksi klik sto zip - Eksagogi olon, meta trekse to NyxCanvas.exe', 'pause', ''];
  fs.writeFileSync(path.join(PARTS, 'ENOSE-ME.bat'), bat.join('\r\n'));
  fs.writeFileSync(path.join(PARTS, 'ΔΙΑΒΑΣΕ-ΜΕ.txt'), readme);
  const joined = Buffer.concat(names.map(n => fs.readFileSync(path.join(PARTS, n))));
  if (md5(joined) !== sum) throw new Error('rejoin md5 mismatch');
  if (names.some(n => fs.statSync(path.join(PARTS, n)).size > PART)) throw new Error('part too large');
  console.log('OK', zip, (buf.length / 1048576).toFixed(1) + ' MB', 'md5', sum, names.length + ' parts (≤24MB), rejoin md5 verified');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
