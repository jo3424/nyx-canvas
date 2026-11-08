'use strict';
// v2.5.1: Electron's asar integrity (fuse EnableEmbeddedAsarIntegrityValidation) only covers files *inside* app.asar.
// Files shipped in app.asar.unpacked (built-in plugins, PowerShell helpers) are checked here against
// main/unpacked-sha256.json, which itself lives inside app.asar and is therefore covered by the asar integrity check.
// Enforced for files under …app.asar.unpacked and — in the packaged build — for the same files reached through the
// …app.asar/… path (Electron transparently redirects those reads to app.asar.unpacked). Signed external code folders are verified at boot.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'); // …/resources/app.asar (packaged) or the worktree
let table = null;
function hashes() { if (table === null) { try { table = require('./unpacked-sha256.json').files || {}; } catch (e) { table = {}; } } return table; }
function isUnpacked(p) { return /[\\/]app\.asar\.unpacked[\\/]/i.test(p); }
const PACKAGED = /app\.asar$/i.test(ROOT);
const UNPACKED_SET = /^(main\/res|app\/plugins)\//; // must match the asar `unpack` glob in scripts/pack.js
function relOf(p) { const a = path.resolve(p); for (const base of [ROOT.replace(/app\.asar$/i, 'app.asar.unpacked'), ROOT]) if (a.toLowerCase().startsWith((base + path.sep).toLowerCase())) return path.relative(base, a).split(path.sep).join('/'); return null; }
function mustVerify(p) { if (isUnpacked(p)) return true; if (!PACKAGED) return false; const rel = relOf(p); return !!rel && UNPACKED_SET.test(rel); }
// returns the file contents (Buffer) after verification; throws on mismatch / unknown file
function readVerified(p) {
  const buf = fs.readFileSync(p);
  if (!mustVerify(p)) return buf;
  const rel = relOf(p), want = rel && hashes()[rel];
  if (!want) throw new Error('integrity: unknown unpacked file ' + rel);
  if (crypto.createHash('sha256').update(buf).digest('hex') !== want) throw new Error('integrity: modified file ' + rel);
  return buf;
}
function verifyFile(p) { readVerified(p); return p; }
module.exports = { readVerified, verifyFile, isUnpacked, mustVerify, relOf };
