// v2.3: offline Greek intent parser (accent/case-insensitive, polite prefixes, reminders, panels)
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../app/js/v2/assistant.js'), 'utf8');
const a = src.indexOf('const LocalIntent'), b = src.indexOf('const Assistant =');
const ctx = { norm: (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), t: (k) => k, Date, RegExp, Math, String, Number };
vm.createContext(ctx); vm.runInContext(src.slice(a, b) + ';this.LocalIntent=LocalIntent;', ctx);
const P = (s) => ctx.LocalIntent.parse(s);
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const cases = [
  ['γράψε note για το γάλα', 'create_card', x => x.kind === 'note' && x.text === 'το γάλα' || x.text === 'γάλα'],
  ['Θέλω να γράψεις σημείωμα για τη συνάντηση', 'create_card', x => x.kind === 'note' && /συνάντηση/.test(x.text)],
  ['ΦΤΙΑΞΕ ΜΙΑ ΛΙΣΤΑ με ψώνια', 'create_card', x => x.kind === 'checklist' && /ψώνια/i.test(x.text)],
  ['σε παρακαλώ φτιάξε μου ένα χαρτάκι: κλήση γιατρό', 'create_card', x => x.kind === 'note' && /κλήση γιατρό/.test(x.text)],
  ['σημείωσε ότι πληρώθηκε το νοίκι', 'create_card', x => /νοίκι/.test(x.text)],
  ['γράψε ψωμί και αυγά', 'create_card', x => x.text === 'ψωμί και αυγά'],
  ['υπενθύμισέ μου να πάρω τη Μαρία αύριο στις 10', 'create_card', x => x.kind === 'reminder' && /πάρω τη Μαρία/.test(x.text) && new Date(x.date).getHours() === 10],
  ['υπενθυμισε με σε 15 λεπτα για το φουρνο', 'create_card', x => x.kind === 'reminder' && /φουρνο/.test(x.text) && Math.abs(new Date(x.date) - Date.now() - 15 * 60e3) < 5000],
  ['βάλε υπενθύμιση για λογαριασμό ΔΕΗ', 'create_card', x => x.kind === 'reminder' && /ΔΕΗ/.test(x.text)],
  ['δείξε μου τη σημείωση για το γάλα', 'show_card', x => /γαλα/.test(x.query)],
  ['ΣΒΗΣΕ τις σημειώσεις για test', 'delete_cards', x => x.query === 'test'],
  ['μπορείς να σβήσεις το χαρτάκι για test', 'delete_cards', x => x.query === 'test'],
  ['άνοιξε τις συνδρομές', 'open_panel', x => x.panel === 'subs'],
  ['άνοιξε τα μοντέλα AI', 'open_panel', x => x.panel === 'ai'],
  ['άνοιξε Ιδέες', 'open_board', x => x.name === 'ιδεες'],
  ['άνοιξε example.com', 'open_url', x => x.url === 'example.com'],
  ['τακτοποίησε τον πίνακα', 'tidy_board', x => true],
];
for (const [q, tool, chk] of cases) { const r = P(q); ok(r && r[0].tool === tool && chk(r[0].args), q + ' → ' + JSON.stringify(r)); }
ok(P('τι καιρό κάνει;') === null, 'unknown → null');
console.log(fail ? `\n${fail} FAILED` : '\nALL OK'); process.exit(fail ? 1 : 0);
