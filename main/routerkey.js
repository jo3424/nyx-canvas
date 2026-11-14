'use strict';
// v2.6.10.1 — API key for the local llama-server router.
// Without a key, any web page open in any browser of the PC (and any program) could use the router on 127.0.0.1:<port>.
// - One random key (32 bytes, base64url) is generated once and kept in Nyx secrets (secrets.json, OS-encrypted) — never in
//   nyx.json, never logged, never sent to the renderer (the Hub only gets «active» + a copy-to-clipboard done here).
// - Nyx starts the router with it through the LLAMA_API_KEY environment variable (llama-server's own env for --api-key),
//   so the key is not in the process command line. The Windows autostart script points --api-key-file at a key file
//   in the Nyx data folder (the path is in the command line, the key is not).
// - Every request Nyx makes to the router carries «Authorization: Bearer <key>» (chat, /v1/models, /props, /tokenize,
//   /health, retries, embeddings, vision, Hub, plugin fetches) — see withAuth()/authFor().
// - A router that answers WITHOUT a key was started outside Nyx → probe() says 'open' and the Hub shows a warning.
//   Nyx never restarts it on its own.
const crypto = require('crypto'), path = require('path'), fs = require('fs');
const NAME = 'router.apiKey';
const KEY_FILE = 'router-api-key.txt';
let DIR = null, port = 8080, mem = '';
let secrets = null;
const S = () => secrets || (secrets = require('./secrets'));
function init(dir, opts = {}) { DIR = dir; if (opts.secrets) secrets = opts.secrets; }
function key() {
  let k = '';
  try { k = S().get(NAME) || ''; } catch (e) { k = ''; }
  if (/^[A-Za-z0-9_-]{32,}$/.test(k)) return k;
  if (mem) return mem;
  k = crypto.randomBytes(32).toString('base64url');
  // secrets not writable (no data folder yet / disk error) → keep it for this run only; never written anywhere else
  try { S().set(NAME, k); } catch (e) { mem = k; console.warn('router key: not saved (' + (e && e.code || 'error') + ') — kept for this run'); }
  return k;
}
function active() { try { return S().has(NAME); } catch (e) { return false; } }
function setPort(p) { p = +p; if (Number.isInteger(p) && p > 0 && p < 65536) port = p; return port; }
function getPort() { return port; }
const LOOP = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]|::1|0\.0\.0\.0)$/i;
function urlOf(u) { try { return new URL(String(u)); } catch (e) { return null; } }
function isLoopback(u) { const x = urlOf(u); return !!(x && /^https?:$/.test(x.protocol) && LOOP.test(x.hostname)); }
function portOf(x) { return +(x.port || (x.protocol === 'https:' ? 443 : 80)); }
// a URL of the router Nyx manages: loopback host + the router port (default 8080, or the one in Μηχανές)
function isRouterUrl(u, p) { const x = urlOf(u); return !!(x && isLoopback(x.href) && portOf(x) === (+p || port)); }
// the «llama» provider (any loopback port) or any provider whose base is the router URL
function isRouterProvider(p) { if (!p || !p.base || !isLoopback(p.base)) return false; return p.id === 'llama' || isRouterUrl(p.base); }
function hasAuth(h) {
  if (!h) return false;
  if (typeof h.has === 'function') return h.has('authorization');
  return Object.keys(h).some((k) => k.toLowerCase() === 'authorization' && h[k]);
}
function authFor(url) { return isRouterUrl(url) ? { Authorization: 'Bearer ' + key() } : {}; }
// fetch options with the router key added (only for router URLs, only when the caller did not set Authorization itself)
function withAuth(url, opts) {
  opts = opts || {};
  if (!isRouterUrl(url) || hasAuth(opts.headers)) return opts;
  const k = key();
  if (opts.headers && typeof opts.headers.set === 'function') { const h = new Headers(opts.headers); h.set('Authorization', 'Bearer ' + k); return { ...opts, headers: h }; }
  return { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + k } };
}
// extra args in Μηχανές › extra that already set a key → Nyx does not add its own (and the Hub may say «άλλο κλειδί»)
const userKeyArg = (extra) => /(^|\s)--api-key(-file)?(\s|=|$)/.test(String(extra || ''));
// environment for the router process: LLAMA_API_KEY (llama-server reads it as --api-key; not visible in the command line)
function routerEnv(c, base = process.env) {
  const env = { ...base };
  if (userKeyArg(c && c.extra)) return env;
  env.LLAMA_API_KEY = key();
  return env;
}
function keyFilePath() { return DIR ? path.join(DIR, KEY_FILE) : ''; }
// key file for the Windows autostart script (--api-key-file). Written only when autostart is switched on / rewritten.
function writeKeyFile() {
  const f = keyFilePath(); if (!f) throw new Error('router key: no data folder');
  const { writeFileAtomicSync } = require('./fsutil');
  writeFileAtomicSync(f, key() + '\n', { mode: 0o600 });
  return f;
}
function removeKeyFile() { const f = keyFilePath(); try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {} }
// What is listening on the router port?  GET /v1/models (protected by llama-server --api-key; /health is not).
//   down      — nothing answers
//   open      — answers WITHOUT a key → started outside Nyx (or by an old autostart script) → warning, no restart
//   ok        — refuses without a key, accepts Nyx's key
//   mismatch  — refuses Nyx's key too (started outside Nyx with another key)
//   unknown   — something else answers (not a llama-server router)
async function probe(p, opts = {}) {
  const pt = setPort(p || port);
  const fetchFn = opts.fetch || fetch; const ms = opts.ms || 1500;
  const base = 'http://127.0.0.1:' + pt;
  const get = async (h) => {
    const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms);
    try { const r = await fetchFn(base + '/v1/models', { headers: h, signal: c.signal }); try { await r.arrayBuffer(); } catch (e) {} return r.status; } catch (e) { return 0; } finally { clearTimeout(tm); }
  };
  let open = await get({});
  if (!open) { await new Promise((r) => setTimeout(r, 150)); open = await get({}); } // a pooled socket of a restarted router fails once
  if (!open) return { state: 'down', port: pt };
  if (open >= 200 && open < 300) return { state: 'open', port: pt };
  if (open === 401 || open === 403) {
    const s = await get({ Authorization: 'Bearer ' + key() });
    if (s >= 200 && s < 300) return { state: 'ok', port: pt };
    if (s === 401 || s === 403) return { state: 'mismatch', port: pt };
    return { state: 'unknown', port: pt, status: s };
  }
  return { state: 'unknown', port: pt, status: open };
}
module.exports = { init, key, active, setPort, getPort, isLoopback, isRouterUrl, isRouterProvider, hasAuth, authFor, withAuth, userKeyArg, routerEnv, keyFilePath, writeKeyFile, removeKeyFile, probe, NAME, KEY_FILE };
