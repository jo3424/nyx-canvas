'use strict';
// Local image import for the MCP add_image tool: user-folder / Nyx data only, images only, size limit from opts.maxBytes (default 30 MB), no file:// or UNC.
const fs = require('fs'), path = require('path'), os = require('os');

const MAX = 30 * 1024 * 1024;
const EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;

function isInside(root, p) {
  const R = path.resolve(root), Q = path.resolve(p);
  if (process.platform === 'win32') {
    const r = R.toLowerCase(), q = Q.toLowerCase();
    return q === r || q.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
  }
  return Q === R || Q.startsWith(R.endsWith(path.sep) ? R : R + path.sep);
}
function sniffImage(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'image/avif';
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  const head = buf.slice(0, 256).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^<svg\b/i.test(head) || (/^<\?xml/i.test(head) && /<svg\b/i.test(head))) return 'image/svg+xml';
  return null;
}
function allowedRoots(opts) {
  const roots = [];
  const home = opts && opts.home != null ? opts.home : os.homedir();
  if (home) roots.push(home);
  if (opts && opts.dataRoot) roots.push(opts.dataRoot);
  if (opts && opts.mediaDir) roots.push(opts.mediaDir);
  return [...new Set(roots.map(r => path.resolve(r)))];
}
function fmtLimit(bytes) {
  const n = +bytes || 0;
  if (n >= 1048576) { const mb = n / 1048576; return (Number.isInteger(mb) ? String(mb) : mb.toFixed(1)) + ' MB'; }
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' bytes';
}
function checkUserImage(src, opts) {
  opts = opts || {};
  const max = opts.maxBytes || MAX;
  const lim = fmtLimit(max);
  if (typeof src !== 'string' || !src || src.includes('\0') || /^file:/i.test(src) || /^[\\/]{2}/.test(src)) {
    const e = new Error('Invalid local path. file:// and network paths are not allowed.'); e.code = 'BAD_PATH'; throw e;
  }
  let resolved;
  try { resolved = fs.realpathSync(src); } catch (err) {
    const e = new Error('The file was not found.'); e.code = 'NOT_FOUND'; throw e;
  }
  let st;
  try { st = fs.statSync(resolved); } catch (err) {
    const e = new Error('The file was not found.'); e.code = 'NOT_FOUND'; throw e;
  }
  if (!st.isFile()) { const e = new Error('Not a file.'); e.code = 'NOT_FILE'; throw e; }
  const roots = allowedRoots(opts);
  if (!roots.some(r => isInside(r, resolved))) {
    const e = new Error('The path must be under your user folder or the Nyx data folder. Limit: ' + lim + ', images only.'); e.code = 'NOT_ALLOWED'; throw e;
  }
  if (!EXT.test(resolved)) {
    const e = new Error('Only image files are accepted (png, jpeg, gif, webp, bmp, svg, avif, ico). Limit: ' + lim + '.'); e.code = 'NOT_IMAGE'; throw e;
  }
  if (st.size > max) {
    const e = new Error('The image is larger than the limit of ' + lim + '.'); e.code = 'TOO_LARGE'; throw e;
  }
  const fd = fs.openSync(resolved, 'r');
  const head = Buffer.alloc(Math.min(4096, st.size));
  try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
  const mime = sniffImage(head);
  if (!mime) {
    const e = new Error('The file is not a recognized image (magic-byte check failed).'); e.code = 'NOT_IMAGE'; throw e;
  }
  return { path: resolved, size: st.size, mime };
}
module.exports = { checkUserImage, sniffImage, isInside, allowedRoots, MAX, fmtLimit };
