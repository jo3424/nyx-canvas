'use strict';
// Nyx bootstrap loader (never updated in place — it ships inside app.asar).
// Loads the newest verified app-code folder from the code root if there is one, otherwise the bundled code.
// A new version that fails to start twice in a row is rolled back automatically (see main/update-core.js).
const path = require('path'), fs = require('fs');
const { app } = require('electron');
const core = require('./main/update-core');
const builtinVersion = require('./package.json').version;
function codeRoot() {
  if (process.env.NYX_CODE_DIR) return process.env.NYX_CODE_DIR;
  if (!app.isPackaged) return null; // dev run: always bundled code
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  if (fs.existsSync(path.join(exeDir, 'NyxData'))) return path.join(exeDir, 'NyxData', 'app-code');
  const base = process.env.LOCALAPPDATA || app.getPath('appData');
  return path.join(base, 'Nyx Canvas', 'app-code');
}
const root = codeRoot();
let pick = { dir: null, version: builtinVersion, rolledBack: null };
try { if (root && !process.argv.includes('--nyx-bundled')) pick = core.chooseBoot(root, { builtinVersion, electron: process.versions.electron, publicKey: require('./main/update-key') }); } catch (e) { console.error('[nyx boot]', e); }
global.__nyxBoot = { root, builtinVersion, bundledDir: __dirname, dir: pick.dir || __dirname, version: pick.version, external: !!pick.dir, rolledBack: pick.rolledBack };
if (pick.dir) {
  try { require(path.join(pick.dir, 'main.js')); }
  catch (e) {
    console.error('[nyx boot] updated code failed to load, rolling back', e);
    try { core.rollback(root, builtinVersion); } catch (_) {}
    app.relaunch({ args: process.argv.slice(1).concat('--nyx-bundled') }); app.exit(0);
  }
} else require('./main.js');
