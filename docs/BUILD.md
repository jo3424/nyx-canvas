# Nyx Canvas 2.6.10.1 — BUILD

Ημερομηνία: 15/11/2026 (Europe/Athens). Commit `b530ab4` (branch `v2.6.10.1`).
Όλες οι εκδόσεις εδώ είναι οι πραγματικές, από το `package.json`, το `package-lock.json` και το build box (Linux x64) όπου χτίστηκε και δοκιμάστηκε η 2.6.10.1.

## Εκδόσεις

| Τι | Έκδοση | Πηγή |
|---|---|---|
| Electron | **45.2.3** (ακριβής, χωρίς `^`) | `package.json` devDependencies + `package-lock.json` |
| Chromium / Node μέσα στο Electron | 156.0.8078.80 / 24.22.2 | `process.versions` του electron 45.2.3 |
| Node (για scripts/τεστ) | v24.22.1 | build box (`node -v`) |
| npm | 11.21.1 | build box (`npm -v`) |
| playwright-core (UI τεστ) | 1.65.0 | `package-lock.json` (δήλωση `^1.64.1`) |
| @electron/packager / fuses / asar | ^20.3.0 / ^2.1.3 / ^4.3.1 | `package.json` |
| lockfileVersion | 3 | `package-lock.json` |

Το `package.json` δεν έχει `engines`. Στο box δοκιμάστηκε μόνο το Node 24.22.1· άλλες εκδόσεις δεν έχουν ελεγχθεί.
**Κανόνας: το Electron μένει 45.2.3.** Αλλαγή Electron = πλήρης εγκατάσταση, όχι patch (βλ. PATCHES.md).

## Από το bundle ή τον φάκελο

```bash
# α) με όλο το ιστορικό
git clone code/nyx-canvas.bundle nyx-canvas
cd nyx-canvas && git checkout v2.6.10.1      # = b530ab4
# β) ή απλός φάκελος (χωρίς .git): code/nyx-canvas/
```
Ο απλός φάκελος δεν έχει τον φάκελο `shots/` (screenshots τεστ, κανόνας «όχι screenshots σε παραδόσεις»). Το bundle τον έχει στο ιστορικό, γιατί δεν αλλάζουμε το ιστορικό.

## Εγκατάσταση εξαρτήσεων

```bash
npm ci            # ακριβώς ό,τι λέει το package-lock.json, φέρνει και το Electron 45.2.3
```
Όλες οι εξαρτήσεις είναι devDependencies. Το app δεν έχει runtime dependencies από npm (ό,τι χρειάζεται είναι στο `app/vendor`, `main/vendor`).
`npm run assets` (scripts/build-assets.js) ξαναφτιάχνει εικονίδια/emoji στο `app/assets`. Δεν χρειάζεται για απλό build, τα αρχεία είναι ήδη στο repo.

## Dev run

```bash
npm start                         # = electron .   (boot.js → main.js, φορτώνει πάντα τον κώδικα του repo)
NYX_DATA_DIR=/tmp/nyx-dev npm start   # χωριστός φάκελος δεδομένων, για να μην αγγίξεις πραγματικά δεδομένα
```
- Ποτέ `--no-sandbox`, `--disable-web-security` κ.λπ.: το `main.js` αρνείται να ξεκινήσει με αυτά.
- Στο Linux χρειάζεται οθόνη (ή `xvfb-run -a npm start`). Το Chromium sandbox δουλεύει με user namespaces (στο box: `/proc/sys/user/max_user_namespaces` = 63991). Το `chrome-sandbox` δεν είναι setuid.
- Χρήσιμες μεταβλητές: `NYX_DATA_DIR` (φάκελος δεδομένων), `NYX_TEST=1` (λειτουργία τεστ), `NYX_CODE_DIR` (φάκελος app-code του updater), `NYX_STARTUP_DIR` (φάκελος Εκκίνησης Windows, για τεστ του autostart).

## Build για Windows

Δεν υπάρχει installer τύπου NSIS/MSI. Το Nyx βγαίνει **portable zip** Windows x64:
```bash
node scripts/pack.js                   # ή npm run pack
#  → dist/NyxCanvas-v<ver>-win-x64.zip
#  → dist/parts-v<ver>/ (κομμάτια ≤ 24 MB + ENOSE-ME.bat + MD5SUMS.txt)
#  → dist/updates/tree-<ver>.json   (το ακριβές δέντρο κώδικα, βάση για το επόμενο patch)
node scripts/pack.js --platform linux  # δοκιμαστικό fused build: dist/NyxCanvas-linux-x64
```
Τι κάνει το pack.js:
1. Τρέχει `scripts/gen-unpacked-hashes.js` (→ `main/unpacked-sha256.json`).
2. `@electron/packager`, με asar και unpack `main/res/**`, `app/plugins/**`.
3. Γυρίζει τα Electron fuses: RunAsNode, NODE_OPTIONS και --inspect κλειστά· embedded asar integrity και only-load-from-asar ανοιχτά.
4. Ελέγχει ότι το hash του asar είναι μέσα στο exe, ότι το asar = το φιλτραρισμένο δέντρο και ότι δεν υπάρχουν `.pem/.key/nebula-keys/node_modules`.

Το `pack.js` χτίζει win32 και από Linux. Το icon και τα metadata του exe (rcedit) στο Linux συνήθως θέλουν wine. Το Windows zip δεν το ξαναέχτισα σε αυτή τη φάση· οι παραδόσεις από την 2.6.5 είναι υπογεγραμμένα zip κώδικα (make-patch).
Οι πλήρεις και οι μικρές ενημερώσεις κώδικα φτιάχνονται με το `scripts/make-patch.js` (βλ. PATCHES.md). Αυτές στέλνουμε στον χρήστη από την 2.6.5 και μετά.

## Τεστ

```bash
node tests/v26101-unit.js                                    # unit: σκέτο node, χωρίς οθόνη
xvfb-run -a -s "-screen 0 2048x1280x24" node tests/v26101.js # UI: Electron + playwright-core
npm run test:v26101unit ; npm run test:v26101                # το ίδιο μέσω package.json
```
- Υπάρχουν 56 scripts `test*` στο package.json, ένα ή δύο ανά έκδοση: `test:vXXXunit` (node) και `test:vXXX` (Electron UI).
- **Linux χωρίς GPU:**
  - Χρειάζεται `xvfb-run` (πακέτο xvfb). Το Chromium αποδίδει με software rendering, δεν χρειάζεται GPU.
  - Τα UI τεστ ανοίγουν το Electron με `chromiumSandbox: true`, γι' αυτό χρειάζονται user namespaces (βλ. πάνω).
  - Κάθε UI τεστ φτιάχνει δικό του προσωρινό `NYX_DATA_DIR` και βάζει `NYX_TEST=1`.
- Τα UI τεστ γράφουν screenshots στο `shots/`. Δεν τα κάνουμε commit και δεν μπαίνουν σε παραδόσεις.
- **Γνωστά αποτελέσματα στο box που δεν είναι σφάλματα της 2.6.10.1** (ίδια και στην 2.6.10):
  - `test:dnd-browsers`: θέλει `electron` στο PATH (exit 127).
  - `test:v22update`, `test:v23update`, `test:v24update`, `test:v25update`, `test:v264fused`: θέλουν παλιά patch/build στο `dist/` (π.χ. `nyx-2.1.0-to-2.2.0.zip`, `NyxCanvas-linux-x64`).
  - Τα παλιά UI τεστ ελέγχουν και τον αριθμό έκδοσης της εποχής τους (π.χ. «app version 2.6.7»), οπότε αποτυγχάνουν σε αυτό το ένα σημείο.
  - `v2` titlebar, `v21` «Settings has 3 tabs», `v22` llama base, `v25agent`, `v251unit` (σημαία στο `tests/v2671-unit.js`): ίδια αποτυχία και στην 2.6.10.
- Αποτέλεσμα 2.6.10.1 στο box (15/11/2026): v26101-unit 64/0, v26101 UI 27/0 με πραγματικό llama-server. Οι 54 παλιές σουίτες έχουν ίδιο αποτέλεσμα με την 2.6.10 (σύνολο 1615 ✓).

## Ψεύτικος router (για τεστ χωρίς GPU)

Τα τεστ δεν χρειάζονται πραγματικό μοντέλο. Υπάρχουν τρεις τρόποι:

1. **`tests/stubs.js`**: OpenAI-compatible stub (chat με tool calls από «προθέσεις», embeddings, whisper `/inference`, μικρό site). Ακούει σε τυχαία θύρα 127.0.0.1.
2. **Μέσα σε κάθε τεστ**: π.χ. `tests/v2671.js` (router που απαντά `/props` με models-max), `tests/v2692.js` (router που «σκέφτεται» σαν τον Qwen). Είναι απλό `http.createServer`.
3. **Ελάχιστος router με τους κανόνες κλειδιού της 2.6.10.1** (ίδιος με το fallback του `tests/v26101.js`):

```js
// fake-router.js — node fake-router.js --port 8080   (κλειδί: LLAMA_API_KEY=... όπως ο llama-server)
const http = require('http'); const a = process.argv; const port = +a[a.indexOf('--port') + 1] || 8080;
const key = process.env.LLAMA_API_KEY || '';
http.createServer((q, s) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
  s.setHeader('Content-Type', 'application/json');
  const pub = /^\/(v1\/)?health$/.test(q.url);                       // /health μένει δημόσιο, όπως στον llama-server
  if (key && !pub && q.headers.authorization !== 'Bearer ' + key) { s.writeHead(401); return s.end('{"error":{"message":"Invalid API Key","code":401}}'); }
  if (/health/.test(q.url)) return s.end('{"status":"ok"}');
  if (/models/.test(q.url)) return s.end('{"data":[{"id":"stories260K"}]}');
  if (/props/.test(q.url)) return s.end('{"default_generation_settings":{"n_ctx":32768},"role":"router"}');
  s.end('{"choices":[{"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}]}');
}); }).listen(port, '127.0.0.1');
```

**Πραγματικός llama-server στο box (αυτό χρησιμοποίησα για την 2.6.10.1):**
- Το επίσημο prebuilt llama.cpp release **b12387** Linux x64 (CPU), γιατί το box δεν έχει compiler/GPU.
- Μικροσκοπικό μοντέλο `stories260K.gguf` (ggml-org/models στο Hugging Face, ~1 MB).
- Router mode:
```bash
mkdir -p models && cp stories260K.gguf models/
LLAMA_API_KEY=<κλειδί> ./llama-server --models-dir ./models --host 127.0.0.1 --port 8080 -np 1
```
- Το `tests/v26101.js` το βρίσκει από `NYX_LLAMA_SERVER` / `NYX_TEST_GGUF` (προεπιλογή `/workspace/llama-build/bin/llama-b12387/llama-server`, `/tmp/rmodels/stories260K.gguf`). Αν λείπουν, πέφτει στον ψεύτικο router και το γράφει.
- Επαληθευμένα στο b12387: το `LLAMA_API_KEY` = `--api-key`, το `LLAMA_ARG_API_KEY_FILE` = `--api-key-file`. Το `/health` είναι δημόσιο· `/v1/models`, `/props`, `/slots`, `/metrics`, `/tokenize`, chat και embeddings δίνουν 401 χωρίς κλειδί. Τα παιδιά-μοντέλα του router κληρονομούν το κλειδί.
- Στο PC του χρήστη τρέχει **b12230 Vulkan**, όχι b12387 (βλ. STATE.md).

## Ποτέ στο repo / στα zip
- Το `/workspace/nebula-keys/` (ιδιωτικά κλειδιά υπογραφής), `*.pem`, `*.key`, `node_modules/`, `dist/`, `build/` εξόδου (τα `build/icon.*` και `build/ΔΙΑΒΑΣΕ-ΜΕ.txt` είναι tracked και μένουν).
- Δεδομένα χρήστη (`nyx.json`, `secrets.json`, `router-api-key.txt`, backups, snapshots).
