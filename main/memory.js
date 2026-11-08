'use strict';
// v2.5 — local assistant memory: profile facts (deduped), dated journal, evolving skills. One JSON file in the data folder,
// written atomically. Nothing here talks to the network.
const fs = require('fs'), fsp = fs.promises, path = require('path'), crypto = require('crypto');
const { writeFileAtomic, writeFileAtomicSync } = require('./fsutil');

const KINDS = ['profile', 'preference', 'fact', 'person', 'project', 'correction'];
function normText(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ς/g, 'σ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(); } // i18n-ignore (Greek final sigma normalisation, not UI text)
const STOP = new Set('the a an and or of to in on is are be i my me it this that for with do not no να το τα η ο οι και σε στο στη στην στον με μου μας για απο από ειναι είναι θα δεν μη μην που τι αυτο αυτό'.split(' ').map(normText)); // i18n-ignore (search stop-words, not UI text)
function tokens(s) { return normText(s).split(' ').filter(w => w.length > 1 && !STOP.has(w)).map(w => w.length > 5 ? w.slice(0, w.length - 2) : w); }
function jaccard(a, b) { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); }
function similar(a, b) { const x = normText(a), y = normText(b); if (!x || !y) return false; if (x === y) return true; if (Math.min(x.length, y.length) > 14 && (x.includes(y) || y.includes(x))) return true; return jaccard(a, b) >= 0.72; }
function cosine(a, b) { if (!a || !b || a.length !== b.length) return 0; let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? d / Math.sqrt(x * y) : 0; }
const id = () => crypto.randomBytes(5).toString('hex');
const today = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

class Memory {
  constructor(file, opts = {}) { this.file = file; this.db = null; this.chain = Promise.resolve(); this.gen = 0; this.savedGen = 0; this.warn = opts.warn || (() => {}); this.warning = null; }
  // v2.6: a corrupt file is never silently replaced by an empty memory — it is kept as .corrupt-<time>,
  // the last good .bak is used if there is one, and the user is warned.
  load() {
    if (this.db) return this.db;
    const read = (f) => { const d = JSON.parse(fs.readFileSync(f, 'utf8')); if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('not an object'); return d; };
    if (fs.existsSync(this.file)) {
      try { this.db = read(this.file); }
      catch (e) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const bad = this.file + '.corrupt-' + stamp;
        try { fs.renameSync(this.file, bad); } catch (e2) { try { fs.copyFileSync(this.file, bad); } catch (e3) {} }
        let restored = false; try { this.db = read(this.file + '.bak'); restored = true; } catch (e4) { this.db = null; }
        this.warning = { file: path.basename(bad), restored };
        try { const { t } = require('./i18n'); this.warn(t(restored ? 'v26.mem_restored' : 'v26.mem_corrupt', { file: path.basename(bad) })); } catch (e5) {}
        console.warn('memory file corrupt → kept as', bad, restored ? '(restored .bak)' : '');
      }
    }
    if (!this.db || typeof this.db !== 'object') this.db = {};
    this.db.v = 1; this.db.facts ||= []; this.db.journal ||= {}; this.db.skills ||= [];
    return this.db;
  }
  // serialized, coalesced, crash-safe (unique tmp + fsync + rename with Windows retries, previous copy kept as .bak)
  save() {
    const gen = ++this.gen;
    this.chain = this.chain.then(async () => {
      if (gen < this.gen || this.savedGen >= gen) return; // a newer save is queued
      const text = JSON.stringify(this.db, null, 1); const g = this.gen;
      await writeFileAtomic(this.file, text, { backup: true, commit: () => this.savedGen < g });
      if (g > this.savedGen) this.savedGen = g;
    }).catch(e => console.warn('memory save', e.message));
    return this.chain;
  }
  // synchronous flush for quit: writes the current memory if anything is not on disk yet
  flushSync() {
    if (!this.db || this.savedGen >= this.gen) return false;
    try { const g = this.gen; writeFileAtomicSync(this.file, JSON.stringify(this.db, null, 1), { backup: true }); this.savedGen = g; return true; } catch (e) { console.warn('memory flush', e.message); return false; }
  }
  list() { const d = this.load(); return { facts: d.facts.map(({ emb, ...f }) => ({ ...f, hasEmb: !!emb })), skills: d.skills, days: Object.keys(d.journal).sort().reverse(), warning: this.warning }; }
  // add → { fact, merged: bool }
  add({ text, kind = 'fact', src = 'chat', emb = null, tags = [] }) {
    text = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 500); if (text.length < 3) throw new Error('empty');
    if (!KINDS.includes(kind)) kind = 'fact';
    const d = this.load(); const now = Date.now();
    const dup = d.facts.find(f => similar(f.text, text) || (emb && f.emb && cosine(emb, f.emb) > 0.93));
    if (dup) { if (text.length >= dup.text.length || kind === 'correction') dup.text = text; dup.upd = now; dup.n = (dup.n || 1) + 1; if (emb) dup.emb = emb; if (kind !== 'fact') dup.kind = kind; this.save(); return { fact: { ...dup, emb: undefined }, merged: true }; }
    const f = { id: id(), text, kind, src, tags, at: now, upd: now, n: 1 }; if (emb) f.emb = emb;
    d.facts.push(f); if (d.facts.length > 2000) d.facts.sort((a, b) => (b.upd - a.upd)).length = 2000;
    this.save(); return { fact: { ...f, emb: undefined }, merged: false };
  }
  update(fid, patch = {}) { const f = this.load().facts.find(x => x.id === fid); if (!f) return false; if (patch.text != null) { f.text = String(patch.text).slice(0, 500); delete f.emb; } if (patch.kind && KINDS.includes(patch.kind)) f.kind = patch.kind; if (patch.emb) f.emb = patch.emb; f.upd = Date.now(); this.save(); return true; }
  forget(ids) { const set = new Set([].concat(ids)); const d = this.load(); const n = d.facts.length; d.facts = d.facts.filter(f => !set.has(f.id)); this.save(); return n - d.facts.length; }
  forgetAll() { this.db = { v: 1, facts: [], journal: {}, skills: [] }; this.save(); return true; }
  // search(query, { emb, limit }) → facts ranked by keyword overlap (+ cosine when both sides have embeddings)
  search(q, { emb = null, limit = 6, kinds } = {}) {
    const d = this.load(); const qt = new Set(tokens(q));
    const scored = d.facts.filter(f => !kinds || kinds.includes(f.kind)).map(f => {
      const ft = tokens(f.text); let kw = 0; for (const w of ft) if (qt.has(w)) kw++; kw = qt.size ? kw / Math.sqrt(qt.size * Math.max(1, ft.length)) : 0;
      const cs = emb && f.emb ? Math.max(0, cosine(emb, f.emb)) : 0;
      const score = emb && f.emb ? 0.45 * kw + 0.55 * cs : kw;
      return { f, score };
    }).filter(x => x.score > 0.12).sort((a, b) => b.score - a.score).slice(0, limit);
    return scored.map(({ f, score }) => ({ id: f.id, text: f.text, kind: f.kind, score: +score.toFixed(3) }));
  }
  needEmb() { return this.load().facts.filter(f => !f.emb).map(f => ({ id: f.id, text: f.text })); }
  journal(entry) { const d = this.load(); const k = today(); const arr = (d.journal[k] ||= []); arr.push({ at: Date.now(), text: String(entry.text || '').slice(0, 300), acts: (entry.acts || []).slice(0, 20).map(String) }); if (arr.length > 80) arr.splice(0, arr.length - 80); const keys = Object.keys(d.journal).sort(); while (keys.length > 365) delete d.journal[keys.shift()]; this.save(); return true; }
  day(k) { return this.load().journal[k] || []; }
  // skills: { id, name, trigger, steps[], notes[], at, upd, uses }
  skillSave({ id: sid, name, trigger = '', steps = [], notes }) {
    name = String(name || '').trim().slice(0, 80); if (!name) throw new Error('name required');
    const d = this.load(); const now = Date.now(); let s = sid ? d.skills.find(x => x.id === sid) : d.skills.find(x => normText(x.name) === normText(name));
    const clean = (a) => [].concat(a || []).map(x => String(x).trim()).filter(Boolean).slice(0, 30).map(x => x.slice(0, 300));
    if (s) { s.name = name; s.trigger = String(trigger || s.trigger || '').slice(0, 200); if (steps.length) s.steps = clean(steps); if (notes) s.notes = clean(notes); s.upd = now; s.v = (s.v || 1) + 1; }
    else { s = { id: id(), name, trigger: String(trigger).slice(0, 200), steps: clean(steps), notes: clean(notes), at: now, upd: now, uses: 0, v: 1 }; d.skills.push(s); }
    this.save(); return s;
  }
  skillNote(sid, note) { const s = this.load().skills.find(x => x.id === sid); if (!s) return null; s.notes = [...(s.notes || []).filter(n => !similar(n, note)), String(note).slice(0, 300)].slice(-12); s.upd = Date.now(); s.v = (s.v || 1) + 1; this.save(); return s; }
  skillDel(sid) { const d = this.load(); const n = d.skills.length; d.skills = d.skills.filter(s => s.id !== sid); this.save(); return n !== d.skills.length; }
  skillUse(sid) { const s = this.load().skills.find(x => x.id === sid); if (s) { s.uses = (s.uses || 0) + 1; s.last = Date.now(); this.save(); } return !!s; }
  skillMatch(q, limit = 2) {
    const qt = new Set(tokens(q)); if (!qt.size) return [];
    return this.load().skills.map(s => { const st = tokens(s.name + ' ' + s.trigger); let n = 0; for (const w of st) if (qt.has(w)) n++; return { s, score: st.length ? n / Math.sqrt(st.length * qt.size) : 0 }; })
      .filter(x => x.score >= 0.34).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.s);
  }
  export() { const d = this.load(); return JSON.stringify({ app: 'nyx-canvas', kind: 'memory', exported: new Date().toISOString(), facts: d.facts.map(({ emb, ...f }) => f), journal: d.journal, skills: d.skills }, null, 2); }
}

function wire(H, C, opts = {}) {
  let mem = null; const M = () => (mem ||= new Memory(path.join(C.DATA_ROOT(), 'memory', 'assistant-memory.json'), { warn: opts.warn }));
  H('mem:list', () => M().list());
  H('mem:add', (f) => M().add(f || {}));
  H('mem:update', (i, p) => M().update(i, p));
  H('mem:forget', (ids) => M().forget(ids));
  H('mem:forgetAll', () => M().forgetAll());
  H('mem:search', (q, o) => M().search(q, o));
  H('mem:needEmb', () => M().needEmb());
  H('mem:journal', (e) => M().journal(e || {}));
  H('mem:day', (k) => M().day(k));
  H('mem:skillSave', (s) => M().skillSave(s || {}));
  H('mem:skillNote', (i, n) => M().skillNote(i, n));
  H('mem:skillDel', (i) => M().skillDel(i));
  H('mem:skillUse', (i) => M().skillUse(i));
  H('mem:skillMatch', (q, n) => M().skillMatch(q, n));
  H('mem:export', () => M().export());
  return { flush: () => mem?.chain, flushSync: () => mem?.flushSync() };
}
module.exports = { wire, Memory, similar, normText, tokens, cosine, today };
