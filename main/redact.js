'use strict';
// Redact secrets from text or a settings object. Used by Gather-Logs tests (and the same rules as the PowerShell helper).
const KEY_NAME = /^(api[_-]?key|token|secret|password|authorization|auth|bearer|keyref|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)$/i;
const TOKEN_RE = /(?<![A-Za-z0-9_\-])(ghp|gho|github_pat|sk-|xai-|gsk_|Bearer\s+)[A-Za-z0-9_\-\.]+/gi;
const JSON_KV_RE = /("(?:api[_-]?key|token|secret|password|authorization|auth|bearer|access_token|refresh_token|client_secret|private_key)"\s*:\s*")[^"]*(")/gi;

function redactText(text) {
  if (text == null) return '';
  let s = String(text);
  s = s.replace(JSON_KV_RE, '$1***$2');
  s = s.replace(TOKEN_RE, (m) => {
    const pre = /^(Bearer\s+)/i.exec(m);
    return (pre ? pre[1] : m.replace(/[A-Za-z0-9_\-\.]+$/, '')) + '***';
  });
  return s;
}

function isSecretKey(k) { return KEY_NAME.test(String(k || '')); }

function redactValue(v, key) {
  if (isSecretKey(key)) return '***';
  if (v == null) return v;
  if (typeof v === 'string') return redactText(v);
  if (Array.isArray(v)) return v.map((x) => redactValue(x, key));
  if (typeof v === 'object') return redactObject(v);
  return v;
}

function redactObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((x) => redactObject(x));
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = redactValue(v, k);
  return out;
}

function publicAiSettings(ai) {
  const src = ai && typeof ai === 'object' ? ai : {};
  const copy = redactObject(JSON.parse(JSON.stringify(src)));
  if (Array.isArray(copy.providers)) {
    copy.providers = copy.providers.map((p) => {
      const o = { ...p };
      delete o.key; delete o.apiKey; delete o.token;
      if (o.keyRef) o.hasKeyRef = true;
      // keep keyRef name (not a secret), never a value
      return o;
    });
  }
  return copy;
}

module.exports = { redactText, redactObject, publicAiSettings, isSecretKey };
