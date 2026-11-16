'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const R = path.join(__dirname, '..');
const el = require(R + '/app/locales/el.json'), en = require(R + '/app/locales/en.json');
const redact = require(R + '/main/redact');
const L = require(R + '/main/limits');
let pass = 0, fail = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); c ? pass++ : fail++; };

console.log('version + leftovers');
const pkg = require(R + '/package.json');
ok(((pkg.version.startsWith('2.6.9') || pkg.version.startsWith('2.6.10') || pkg.version.startsWith('2.6.11') || pkg.version.startsWith('2.6.12') || pkg.version === '2.6.13') || pkg.version === '2.6.8' || pkg.version.startsWith('2.6.8') || pkg.version === '2.6.7' || pkg.version.startsWith('2.6.7.')) && pkg.devDependencies.electron === '45.2.3', 'version 2.6.7+/2.6.8, Electron 45.2.3', pkg.version);
const core = fs.readFileSync(R + '/app/js/v2/core.js', 'utf8');
ok(!/\bMODEL_RECS\b/.test(core) && !/\bMODEL_FIT_NOTE\b/.test(core), 'MODEL_RECS / MODEL_FIT_NOTE removed from core.js');
ok(!/core\.r_fit/.test(core), 'core.r_fit not referenced in core.js');
const log = require(R + '/CHANGELOG.json')['2.6.7'];
ok(log && log.el.length === log.en.length && log.el.length > 0, 'CHANGELOG 2.6.7 el+en');
ok(/2\.6\.8/.test(log.el.join(' ')) && /streaming/.test(log.en.join(' ').toLowerCase()), '2.6.8 mentioned only as upcoming');
ok(!/stream[ing]* του βοηθού|faster file/.test(fs.readFileSync(R + '/app/js/v2/hub-tabs.js', 'utf8')), 'hub-tabs does not add 2.6.8 streaming');

console.log('i18n + stop label');
ok(el['hub.065'].includes('Διακοπή') && !el['hub.065'].includes('Τέλος'), 'Stop button is Διακοπή, not Τέλος');
ok(en['hub.065'].includes('Stop'), 'EN stop label');
ok(el['v267.tab_status'] && en['v267.tab_status'] && el['v267.task_greek'] && en['v267.cloud_note'].includes('safeStorage'), 'key v267 strings present');
ok(/DPAPI/.test(el['v267.cloud_note']) && /DPAPI/.test(en['v267.cloud_note']) && /safeStorage/.test(en['v267.cloud_note']), 'cloud note: safeStorage, DPAPI only as the Windows fact');
ok(el['v267.cloud_note'] && !/κλειδιά κρυπτογραφημένα \(DPAPI\) μόνο/.test(el['v267.cloud_note'] || ''), 'does not claim DPAPI as the only mechanism');

console.log('redaction');
const dirty = JSON.stringify({
  settings: { ai: { providers: [{ id: 'groq', api_key: 'gsk_LIVESECRETVALUE', keyRef: 'key:groq' }] }, openai: { token: 'sk-ABCDEF1234567890' } },
  Authorization: 'Bearer gho_abcdefghijklmnopqrstuv',
  note: 'normal text',
});
const clean = redact.redactText(dirty);
ok(!/LIVESECRETVALUE/.test(clean) && !/ABCDEF1234567890/.test(clean) && !/gho_abcdefghijklmnopqrstuv/.test(clean), 'redactText strips key values and tokens', clean);
ok(/key:groq/.test(clean) && /normal text/.test(clean), 'non-secret fields remain');
const pub = redact.publicAiSettings({
  providers: [{ id: 'groq', key: 'gsk_XXX', keyRef: 'key:groq', enabled: false, base: 'https://api.groq.com/openai/v1' }],
  servers: { llama: { ctx: 32768, extra: '--models-max 2' } },
  password: 'hunter2',
});
ok(pub.password === '***' && pub.providers[0].key === undefined || pub.providers[0].key === '***', 'publicAiSettings redacts password/key');
ok(pub.providers[0].base === 'https://api.groq.com/openai/v1' && pub.servers.llama.ctx === 32768, 'public AI settings keep non-secret config');
ok(!JSON.stringify(pub).includes('hunter2') && !JSON.stringify(pub).includes('gsk_XXX'), 'no secret leftovers in public AI settings');

console.log('ctx is never auto-raised');
ok(L.resolveLaunchCtx({ ctx: 32768 }, { ctx: 262144 }).ctx === 32768, 'user 32768 kept');
ok(L.resolveLaunchCtx({ ctx: 0 }, { ctx: 262144 }).omitted, 'ctx 0 omits -c');

console.log('hub source shape');
const hub = fs.readFileSync(R + '/app/js/v2/hub.js', 'utf8') + fs.readFileSync(R + '/app/js/v2/hub-tabs.js', 'utf8');
ok(/paintHubTabs/.test(hub) && /data-hub-tab/.test(hub), '4-tab hub shell exists');
ok(/greekFlag/.test(hub) && /flag-gr/.test(hub) && !/🇬🇷/.test(hub), 'Greek flag is SVG, not the emoji');
ok(/assistantForm/.test(hub) && /speechForm/.test(hub), 'assistant and speech forms exist to move into Settings');
ok(/Προχωρημένα|v267.advanced/.test(hub), 'Advanced section for exe paths');
ok(/rentedGpu|v267.rented/.test(hub), 'rented GPU row present');

console.log('placeholders match');
for (const k of Object.keys(el).filter((k) => k.startsWith('v267.'))) {
  const a = (el[k].match(/\{v\d+\}/g) || []).sort().join();
  const b = (en[k].match(/\{v\d+\}/g) || []).sort().join();
  ok(a === b, 'placeholders ' + k);
}

console.log('candidate cap');
{
  const z = require(R + '/app/js/v2/model-zones.js');
  ok(z.ZONE_CANDIDATE_MAX === 3 && Object.values(z.MODEL_ZONES.candidates).every((a) => a.length <= 3), 'MODEL_ZONES has ≤3 candidates per category');
  const fake = { candidates: { image: [1, 2, 3, 4].map((n) => ({ id: 'img-' + n })), video: [{ id: 'vid-1' }] }, other: [] };
  const lim = z.limitZoneCandidates(fake);
  ok(lim.candidates.image.length === 3 && lim.other.some((c) => c.id === 'img-4') && lim.candidates.video.length === 1, 'limitZoneCandidates moves the 4th image to other');
  const hub = fs.readFileSync(R + '/app/js/v2/hub.js', 'utf8') + fs.readFileSync(R + '/app/js/v2/hub-tabs.js', 'utf8');
  ok(/limitZoneCandidates/.test(hub) && /v267\.zone_cand_cat/.test(hub), 'Hub groups candidates with a per-category count');
  ok(!/zones_summary/.test(hub), 'Hub no longer uses a single combined Υποψήφια count');
  ok(!/\{v0\}/.test(el['v267.zones_summary'] || ''), 'zones_summary has no combined numeric placeholder');
}

console.log(`\nv2.6.7 unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
