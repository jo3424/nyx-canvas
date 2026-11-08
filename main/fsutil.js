'use strict';
// Crash-safe file writes: unique tmp file -> write -> fsync -> rename (with retries for Windows EPERM/EBUSY
// when an antivirus / indexer / Syncthing briefly holds the target). Used for small JSON state files.
const fs = require('fs'), fsp = fs.promises, path = require('path'), crypto = require('crypto');
const RETRY = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
const tmpOf = (file) => path.join(path.dirname(file), '.' + path.basename(file) + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp');
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {} };

function writeFileAtomicSync(file, data, opts = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tmpOf(file); let fd = null;
  try {
    fd = fs.openSync(tmp, 'w', opts.mode); fs.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    if (opts.backup) { try { fs.copyFileSync(file, file + '.bak'); } catch (e) {} }
    for (let i = 0; ; i++) { try { fs.renameSync(tmp, file); break; } catch (e) { if (!RETRY.has(e.code) || i >= 8) throw e; sleepSync(25 * (i + 1)); } }
  } catch (e) { if (fd != null) try { fs.closeSync(fd); } catch (_) {} try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
}
async function writeFileAtomic(file, data, opts = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = tmpOf(file); let fh = null;
  try {
    fh = await fsp.open(tmp, 'w', opts.mode); await fh.writeFile(typeof data === 'string' ? Buffer.from(data, 'utf8') : data); await fh.sync(); await fh.close(); fh = null;
    if (opts.backup) await fsp.copyFile(file, file + '.bak').catch(() => {});
    // commit(): optional last-moment check (same tick as rename) — return false to drop a superseded write
    if (opts.commit && opts.commit() === false) { await fsp.unlink(tmp).catch(() => {}); return false; }
    for (let i = 0; ; i++) { try { fs.renameSync(tmp, file); break; } catch (e) { if (!RETRY.has(e.code) || i >= 8) throw e; await new Promise(r => setTimeout(r, 40 * (i + 1))); if (opts.commit && opts.commit() === false) { await fsp.unlink(tmp).catch(() => {}); return false; } } }
    return true;
  } catch (e) { if (fh) await fh.close().catch(() => {}); await fsp.unlink(tmp).catch(() => {}); throw e; }
}
// true when `p` is strictly inside `base` (not equal, no '..' escape, same drive)
function isInside(base, p) { const r = path.relative(path.resolve(base), path.resolve(p)); return !!r && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); }
module.exports = { writeFileAtomicSync, writeFileAtomic, isInside };
