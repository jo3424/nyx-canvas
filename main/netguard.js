'use strict';
// v2.6 — SSRF guard for assistant web tools: only public internet addresses.
// Blocks loopback, private, link-local, CGNAT, multicast, reserved/documentation ranges, IPv6 ULA/link-local/site-local,
// IPv4-mapped / IPv4-compatible / NAT64 / 6to4 forms of blocked IPv4, Teredo, 'localhost' names — and checks every
// address a host name resolves to. 198.18.0.0/15 (benchmarking) is NOT blocked on purpose: VPN/proxy tools in
// 'fake-IP' mode (Clash, sing-box …) answer every DNS query with it, and blocking it would break all downloads.
// Pure Node (no Electron) so it can be unit-tested.
const net = require('net'), dns = require('dns');

const V4 = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) V4.addSubnet(a, p, 'ipv4');
const V6 = new net.BlockList();
for (const [a, p] of [['::', 96], ['::ffff:0:0', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) V6.addSubnet(a, p, 'ipv6');

// '::ffff:1.2.3.4' / '64:ff9b::7f00:1' → 8 numbers
function hextets(ip) {
  let s = ip.toLowerCase(); const z = s.indexOf('%'); if (z >= 0) s = s.slice(0, z);
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) { const o = m[1].split('.').map(Number); s = s.slice(0, -m[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16); }
  const [h, t] = s.split('::'); const a = h ? h.split(':') : [], b = t !== undefined ? (t ? t.split(':') : []) : [];
  const out = [...a, ...Array(t !== undefined ? 8 - a.length - b.length : 0).fill('0'), ...b].map(x => parseInt(x || '0', 16));
  return out.length === 8 && out.every(n => n >= 0 && n <= 0xffff) ? out : null;
}
const v4of = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
function isBlockedIP(ip) {
  ip = String(ip || '').replace(/^\[|\]$/g, '');
  const fam = net.isIP(ip);
  if (fam === 4) return ip === '255.255.255.255' || V4.check(ip, 'ipv4');
  if (fam !== 6) return true; // not an IP → caller's bug, refuse
  const h = hextets(ip); if (!h) return true;
  const all0 = (i, j) => h.slice(i, j).every(x => x === 0);
  if (all0(0, 5) && h[5] === 0xffff) return isBlockedIP(v4of(h[6], h[7]));        // IPv4-mapped
  if (h[0] === 0x64 && h[1] === 0xff9b && all0(2, 6)) return isBlockedIP(v4of(h[6], h[7])); // NAT64 well-known prefix
  if (h[0] === 0x2002) return isBlockedIP(v4of(h[1], h[2]));                         // 6to4
  return V6.check(h.map(x => x.toString(16)).join(':'), 'ipv6');
}
const BAD_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain)$/i;
function hostOf(u) { let x; try { x = new URL(u); } catch (e) { return null; } if (!/^https?:$/.test(x.protocol)) return null; if (x.username || x.password) return null; return x.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase(); }
// synchronous check (literal IPs + names only) — for will-redirect / will-navigate
function urlLooksPublic(u) {
  const h = hostOf(u); if (!h) return false;
  if (net.isIP(h)) return !isBlockedIP(h);
  if (BAD_NAME.test(h) || !h.includes('.')) return false;
  return true;
}
// full check: every resolved address must be public
async function assertPublicUrl(u, lookup = dns.promises.lookup) {
  if (!urlLooksPublic(u)) throw Object.assign(new Error('blocked URL (local/private address)'), { code: 'BLOCKED' });
  const h = hostOf(u); if (net.isIP(h)) return true;
  let addrs; try { addrs = await lookup(h, { all: true, verbatim: true }); } catch (e) { throw Object.assign(new Error('DNS: ' + (e.code || e.message)), { code: 'DNS' }); }
  if (!addrs.length || addrs.some(a => isBlockedIP(a.address))) throw Object.assign(new Error('blocked URL (' + h + ' resolves to a local/private address)'), { code: 'BLOCKED' });
  return true;
}
module.exports = { isBlockedIP, urlLooksPublic, assertPublicUrl, hextets };
