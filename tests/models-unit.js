// v2.6.7: model zones (MODEL_RECS / MODEL_FIT_NOTE removed). Static checks, no Electron.
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
const el = require(R + '/app/locales/el.json'), en = require(R + '/app/locales/en.json');
const { MODEL_ZONES, zoneMatchId } = require(R + '/app/js/v2/model-zones.js');
let pass = 0, fail = 0; const ok = (n, c) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };
ok('checkedAt is a DD/MM date', /^\d{2}\/\d{2}\/\d{4}$/.test(MODEL_ZONES.checkedAt));
ok('at most 3 candidates per category', Object.values(MODEL_ZONES.candidates || {}).every(a => (a || []).length <= 3));
ok('PuLID/InstantID require antelopev2 and mention InsightFace NC', (() => {
  const p = MODEL_ZONES.other.find(x => x.id === 'pulid'), i = MODEL_ZONES.other.find(x => x.id === 'instantid');
  return p && i && /antelopev2/i.test(p.requires + p.licenseNote) && /non-commercial|μη εμπορικ/i.test(p.licenseNote + i.licenseNote);
})());
ok('rejected zone is technical-only and empty', Array.isArray(MODEL_ZONES.rejected) && MODEL_ZONES.rejected.length === 0);
ok('zoneMatchId matches krikri-like names', zoneMatchId('llama-krikri-8b-instruct-q8_0', { id: 'krikri', name: 'Krikri', aliases: ['llama-krikri'] }) || zoneMatchId('gemma-4-12b', { id: 'gemma', name: 'Gemma' }));
ok('core.js no longer defines MODEL_RECS / MODEL_FIT_NOTE', (() => {
  const s = fs.readFileSync(R + '/app/js/v2/core.js', 'utf8');
  return !/\bMODEL_RECS\b/.test(s) && !/\bMODEL_FIT_NOTE\b/.test(s);
})());
ok('hub.js no longer renders recCard picks', (() => {
  const s = fs.readFileSync(R + '/app/js/v2/hub.js', 'utf8');
  return !/recCard\(/.test(s) && !/MODEL_RECS/.test(s);
})());
for (const [L, d] of [['el', el], ['en', en]]) {
  ok(L + ': HauhauCS is not called not-recommended', Object.values(d).filter(v => /hauhau/i.test(v)).every(v => !/(δεν είναι πια η σύσταση|no longer the pick|δεν προτείνεται)/.test(v)));
  ok(L + ': no leftover “raise ctx to 262144” nag in v267 strings', !Object.entries(d).filter(([k]) => k.startsWith('v267.')).some(([, v]) => /262144/.test(v) && /ανεβάσ|raise|προτεινόμενο ctx/i.test(v)));
}
ok('package.json version 2.6.7', require(R + '/package.json').version === '2.6.7');
ok('CHANGELOG has 2.6.6 el+en', (() => { const c = require(R + '/CHANGELOG.json')['2.6.6']; return c && c.el.length && c.el.length === c.en.length; })());
ok('CHANGELOG has 2.6.7 el+en', (() => { const c = require(R + '/CHANGELOG.json')['2.6.7']; return c && c.el.length && c.el.length === c.en.length; })());
console.log(`models-unit: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
