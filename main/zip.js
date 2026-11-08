'use strict';
// Minimal ZIP reader/writer (store + deflate, no zip64). Used by the updater (read) and scripts/make-patch.js (write).
const fs = require('fs'), zlib = require('zlib');
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { if (zlib.crc32) return zlib.crc32(buf) >>> 0; let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

// read(bufOrPath) → { names: [...], has(name), get(name) → Buffer }
function read(src) {
  const buf = Buffer.isBuffer(src) ? src : fs.readFileSync(src);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen).replace(/\\/g, '/');
    if (!name.endsWith('/')) entries.set(name, { flags, method, crc, csize, usize, off });
    p += 46 + nlen + xlen + clen;
  }
  const get = (name) => {
    const e = entries.get(name); if (!e) return null;
    if (buf.readUInt32LE(e.off) !== 0x04034b50) throw new Error('bad zip local header: ' + name);
    const start = e.off + 30 + buf.readUInt16LE(e.off + 26) + buf.readUInt16LE(e.off + 28);
    const raw = buf.subarray(start, start + e.csize);
    const out = e.method === 0 ? Buffer.from(raw) : e.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.usize + 1) }) : null;
    if (!out) throw new Error('unsupported zip method ' + e.method + ': ' + name);
    if (out.length !== e.usize || crc32(out) !== e.crc) throw new Error('zip CRC error: ' + name);
    return out;
  };
  const info = (n) => { const e = entries.get(n); return e ? { usize: e.usize, csize: e.csize, method: e.method, encrypted: !!(e.flags & 1) } : null; };
  return { names: [...entries.keys()], has: (n) => entries.has(n), get, info, size: buf.length };
}

// write(files: [{ name, data: Buffer }]) → Buffer
function write(files) {
  const locals = [], central = []; let off = 0;
  const dt = new Date(), dosTime = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1), dosDate = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8'), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const crc = crc32(data); let comp = zlib.deflateRawSync(data, { level: 9 }); let method = 8;
    if (comp.length >= data.length) { comp = data; method = 0; }
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, comp); central.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
module.exports = { read, write, crc32 };
