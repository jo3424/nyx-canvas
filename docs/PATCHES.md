# Nyx Canvas — PATCHES (υπογεγραμμένες ενημερώσεις κώδικα)

Ημερομηνία: 15/11/2026 (Europe/Athens). Περιγραφή από τον πραγματικό κώδικα στο commit `b530ab4`:
`main/update-core.js`, `main/update-key.js`, `main/updater.js`, `boot.js`, `scripts/make-patch.js`, `scripts/gen-unpacked-hashes.js`, `main/unpacked-integrity.js`.

## 1. Τι είναι ένα `nyx-A-to-B.zip`

Είναι zip με:
- `manifest.json`: JSON με εσοχή 1.
- `manifest.sig`: υπογραφή **ed25519** σε base64, πάνω στα **ακριβή bytes** του `manifest.json`.
- `files/<σχετική διαδρομή>`: μόνο τα αρχεία που άλλαξαν (delta) ή όλα (full).

```jsonc
{
  "format": 1, "app": "nyx-canvas",
  "version": "2.6.10.1",          // έκδοση-στόχος (B)
  "base": "2.6.10",               // έκδοση-βάση (A)· null στα full
  "full": false,
  "electron": "45.2.3",           // το runtime που απαιτεί
  "created": "2026-11-14T23:20:…Z",
  "changelog": { "el": [...], "en": [...] },   // από CHANGELOG.json[version]
  "files":   { "<rel>": { "sha256": "...", "size": 123 } },  // ΟΛΟΚΛΗΡΗ η λίστα αρχείων της B
  "changed": ["<rel>", ...],      // όσα είναι μέσα στο files/ του zip (νέα ή διαφορετικά από την A)
  "removed": ["<rel>", ...]       // όσα υπήρχαν στην A και φεύγουν
}
```
Τα `changed`/`removed` τα υπολογίζει το `buildPatch` συγκρίνοντας sha256 ανά αρχείο της A (`fromFiles`) με το δέντρο της B. Τα αρχεία που δεν άλλαξαν **δεν** μπαίνουν στο zip. Ο updater τα παίρνει από την τρέχουσα εγκατάσταση και ελέγχει το sha256 τους.

## 2. Πώς φτιάχνεται

```bash
# delta από git refs (commits/tags/branches) ή από αποθηκευμένο δέντρο dist/updates/tree-A.json
node scripts/make-patch.js --from 763a956 --to HEAD          # → dist/updates/nyx-2.6.10-to-2.6.10.1.zip
node scripts/make-patch.js --from dist/updates/tree-2.6.10.json --to HEAD
node scripts/make-patch.js --full                            # → nyx-<B>-full.zip (για κάθε παλιότερη 2.x με ίδιο Electron)
# επιλογές: --out <φάκελος>, --key <ιδιωτικό.pem> (ή $NYX_SIGN_KEY), --version <B>, --also-full
```
Βήματα του script:
1. Φορτώνει το ιδιωτικό κλειδί (προεπιλογή `/workspace/nebula-keys/nyx-update-ed25519.pem`, **εκτός repo**, ποτέ στο zip). Ελέγχει ότι ταιριάζει με ένα από τα δημόσια του `main/update-key.js`, αλλιώς σταματά.
2. Βγάζει τα δέντρα A και B με `git archive` (ή `WORKTREE`) και τα περνά από το `scripts/pack-filter.js` (ίδιο φίλτρο με το pack.js: χωρίς tests, shots, dist, node_modules κ.λπ.).
3. Αρνείται αν το δέντρο B έχει `.pem`, `.key` ή `nebula-keys`.
4. Φτιάχνει το manifest, το υπογράφει (`crypto.sign(null, manifestBytes, privateKey)`) και γράφει το zip.
5. **Self-check:** ανοίγει κάθε zip που έγραψε με το `core.openPatch(zip, PUBLIC_KEYS)`, όπως θα το έκανε η εφαρμογή.
6. Γράφει `dist/updates/nyx-latest.json` (version, electron, changelog, patches{base→zip}, fullCode) και `tree-B.json` (βάση για το επόμενο delta).

### `main/unpacked-sha256.json`
- Στο πακεταρισμένο app, τα `main/res/**` και `app/plugins/**` είναι **έξω** από το app.asar (`app.asar.unpacked`). Η ακεραιότητα asar του Electron δεν τα καλύπτει.
- Το `scripts/gen-unpacked-hashes.js` γράφει τα sha256 τους στο `main/unpacked-sha256.json`, που είναι **μέσα** στο asar, άρα προστατεύεται.
- Το `main/unpacked-integrity.js` (`readVerified`) αρνείται άγνωστο ή αλλαγμένο αρχείο.
- Πότε το τρέχεις:
  - πριν από κάθε patch που αλλάζει αρχεία κάτω από `main/res/` ή `app/plugins/`, με `node scripts/gen-unpacked-hashes.js`, και κάνεις commit το json.
  - Το `--check` λέει αν είναι παλιό. Το `pack.js` το τρέχει μόνο του.

## 3. Πώς το επαληθεύει ο updater (Ρυθμίσεις → Ενημέρωση)

`core.openPatch(zip, TRUSTED)` → `core.applyPatch(...)`:
1. Αν λείπει το `manifest.json` ή το `manifest.sig` → **NOT_PATCH**, «Το αρχείο δεν είναι πακέτο ενημέρωσης Nyx».
2. `verifySig`: δέχεται το zip αν η υπογραφή επαληθεύεται με **οποιοδήποτε** κλειδί της λίστας `TRUSTED = [LEGACY, CURRENT]` (`main/update-key.js`). Αλλιώς → **BAD_SIG**, «Η υπογραφή του πακέτου δεν είναι έγκυρη — απορρίφθηκε». Δεν γράφεται τίποτα στον δίσκο.
3. Λάθος `app`/`format` → **BAD_MANIFEST**.
4. `checkApplicable`:
   - έκδοση όχι νεότερη → **NOT_NEWER**·
   - `electron` ≠ τρέχον → **NEEDS_FULL** (θέλει πλήρη εγκατάσταση)·
   - delta για άλλη βάση → **WRONG_BASE**.
5. Κάθε διαδρομή περνά από `safeRel` (όχι απόλυτες, όχι `..`, όχι `C:`).
6. Στήνει `<root>/<B>.staging`: παίρνει αρχεία από το zip ή από την τρέχουσα έκδοση και ελέγχει **κάθε** αρχείο (μέγεθος + sha256) με το manifest.
   - Αρχείο λείπει → **BASE_MISSING**/**PATCH_MISSING**.
   - Λάθος hash → **HASH_MISMATCH**.
   - Τελικό πέρασμα: ίδιο σύνολο αρχείων (**TREE_MISMATCH**) και ίδια hash (**VERIFY_FAIL**).
   - Σε σφάλμα ο staging σβήνεται και η εφαρμογή μένει όπως ήταν.
7. Γράφει `.nyx-signed.json` (manifest + sig) στον φάκελο, τον μετονομάζει σε `<root>/<B>` και ενημερώνει το `state.json` (active/previous, confirmed=false).

**Σε κάθε εκκίνηση** (`boot.js` → `core.chooseBoot`):
- Ο φάκελος app-code φορτώνεται μόνο αν το `.nyx-signed.json` επαληθεύεται με τα δημόσια κλειδιά **και** κάθε αρχείο ταιριάζει ακόμα (`verifyCodeDir`).
- Αλλιώς (unsigned, αλλοιωμένος, άλλο κλειδί) αγνοείται και ξεκινά η ενσωματωμένη έκδοση του asar.
- Νέα έκδοση που δεν ξεκινά 2 φορές στη σειρά → αυτόματο rollback. Σφάλμα φόρτωσης → rollback + επανεκκίνηση με `--nyx-bundled`.

**Συνοπτικά:**

| Patch | Αποτέλεσμα |
|---|---|
| Χωρίς υπογραφή (λείπει το manifest.sig) | απορρίπτεται, NOT_PATCH |
| Υπογραφή με άλλο κλειδί ή αλλοιωμένο manifest | απορρίπτεται, BAD_SIG |
| Σωστή υπογραφή αλλά αρχείο που δεν ταιριάζει | απορρίπτεται στο staging, τίποτα δεν αλλάζει |
| Φάκελος app-code πειραγμένος μετά την εγκατάσταση | αγνοείται στην εκκίνηση, φορτώνει η ενσωματωμένη |

Ένα patch **δεν** μπορεί να αλλάξει το Electron, το `boot.js` ή τα fuses: είναι μέσα στο exe/asar, που προστατεύεται με asar integrity.

## 4. Δημόσιο κλειδί LEGACY

Αρχείο: `keys/nyx-update-LEGACY-public.pem` (και δίπλα στο zip).
```
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0BpU/HCp14nIU6nzueOwMEDg0y4HIvfraHwlrXvoRwo=
-----END PUBLIC KEY-----
```
- Τύπος: ed25519, **δημόσιο** (SPKI).
- Fingerprint (sha256 του SPKI DER): `26a93d3f3e2b3c0a31ed6071818f9521fe2dc3876007b172f43f72ae3511dcb6`.
- Ελέγχθηκε στις 15/11: είναι ίδιο με το `LEGACY` του `main/update-key.js` και αντιστοιχεί στο ιδιωτικό κλειδί υπογραφής, που **δεν** περιλαμβάνεται πουθενά.
- Το δεύτερο έμπιστο κλειδί της εφαρμογής, `CURRENT`, ήρθε από την 2.6.0 του άλλου λογαριασμού (fingerprint `68027240f3b9210542ac342d94b4c5430e3846fa8f94a3df7a9a13387e207ca6`). Το ιδιωτικό του δεν υπήρχε εδώ ως την 2.6.10.1· για την 2.6.11 δες §4β.

Επαλήθευση ενός patch με το χέρι:
```bash
unzip -o nyx-2.6.10-to-2.6.10.1.zip manifest.json manifest.sig
base64 -d manifest.sig > manifest.sig.bin
openssl pkeyutl -verify -pubin -inkey nyx-update-LEGACY-public.pem -rawin -in manifest.json -sigfile manifest.sig.bin
# → "Signature Verified Successfully"· μετά sha256sum για τα αρχεία του files/ σε σχέση με το manifest
```
Επαλήθευση αυτού του πακέτου:
```bash
openssl pkeyutl -verify -pubin -inkey nyx-update-LEGACY-public.pem -rawin -in nyx-full-2.6.10.1.zip -sigfile nyx-full-2.6.10.1.zip.sig
```

## 4β. 2.6.11: υπογραφή με το CURRENT (15/11/2026)

Το patch `nyx-2.6.10.1-to-2.6.11.zip` υπογράφεται με το **CURRENT**, όχι με το LEGACY (με οδηγία του χρήστη, 15/11).
- Το ιδιωτικό κλειδί LEGACY δεν βρέθηκε στο box της 2.6.11. Το ιδιωτικό CURRENT βρίσκεται **εκτός repo** και δεν μπαίνει ποτέ στο repo ή στο zip.
- Πριν από την υπογραφή ελέγχθηκε ότι το δημόσιο που βγαίνει από το ιδιωτικό είναι **ακριβώς** το `CURRENT` του `main/update-key.js` στο `b530ab4`, με fingerprint `68027240f3b9210542ac342d94b4c5430e3846fa8f94a3df7a9a13387e207ca6`.
- Η λίστα έμπιστων κλειδιών **δεν άλλαξε** (`TRUSTED = [LEGACY, CURRENT]`). Η 2.6.10.1 το δέχεται ήδη: το `verifySig` δέχεται οποιοδήποτε κλειδί της λίστας.
- Δημόσιο CURRENT (δίπλα στο zip ως `nyx-update-CURRENT-public.pem`):
```
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7bfsGpt4U8DsKLVQ861AQ7UdCiXT8W2YQhS86Zse6Bc=
-----END PUBLIC KEY-----
```
Επαλήθευση με το χέρι (ίδια βήματα με το §4, με το CURRENT):
```bash
unzip -o nyx-2.6.10.1-to-2.6.11.zip manifest.json manifest.sig
base64 -d manifest.sig > manifest.sig.bin
openssl pkeyutl -verify -pubin -inkey nyx-update-CURRENT-public.pem -rawin -in manifest.json -sigfile manifest.sig.bin
openssl pkeyutl -verify -pubin -inkey nyx-update-CURRENT-public.pem -rawin -in nyx-2.6.10.1-to-2.6.11.zip -sigfile nyx-2.6.10.1-to-2.6.11.zip.sig
```
Με το LEGACY η επαλήθευση **αποτυγχάνει** (αναμενόμενο: δεν υπογράφηκε με αυτό).

## 4γ. 2.6.11.1: υπογραφή με το CURRENT (15/11/2026)

Το patch `nyx-2.6.11-to-2.6.11.1.zip` υπογράφεται ξανά με το **CURRENT**, με τους ίδιους ελέγχους της §4β (οδηγία του χρήστη, 15/11).
- Πριν από την υπογραφή: το δημόσιο που βγαίνει από το ιδιωτικό είναι **ακριβώς** το `CURRENT` του `main/update-key.js` στο `b530ab4`, fingerprint `68027240…7ca6` (ίδιο με την §4β).
- Επαλήθευση με τη λίστα έμπιστων κλειδιών **και** της 2.6.10.1 (`b530ab4`) **και** της 2.6.11 (`b271669`): ίδια λίστα `[LEGACY, CURRENT]`. Το CURRENT περνά, το LEGACY αποτυγχάνει (αναμενόμενο).
- Η λίστα έμπιστων κλειδιών δεν άλλαξε· δεν φτιάχτηκε νέο κλειδί. Κανένα ιδιωτικό κλειδί στο repo ή στο zip.
- Βάση του patch: 2.6.11 (`b271669`). Για όποιον είναι ακόμα στην 2.6.10.1: πρώτα `nyx-2.6.10.1-to-2.6.11.zip`, μετά αυτό.
- Επαλήθευση με το χέρι: όπως στην §4β, με `nyx-2.6.11-to-2.6.11.1.zip`.

## 4δ. 2.6.12: υπογραφή με το CURRENT (15/11/2026)

Το patch `nyx-2.6.11.1-to-2.6.12.zip` υπογράφεται με το **CURRENT**, με τους ίδιους ελέγχους της §4β (οδηγία του χρήστη, 15/11).
- Πριν από την υπογραφή: το δημόσιο που βγαίνει από το ιδιωτικό είναι **ακριβώς** το `CURRENT` του `main/update-key.js` στο `b530ab4`, fingerprint `68027240…7ca6`.
- Επαλήθευση με τη λίστα έμπιστων κλειδιών της βάσης 2.6.11.1 (`fd0e31f`, ίδια λίστα `[LEGACY, CURRENT]`): το CURRENT περνά, το LEGACY αποτυγχάνει (αναμενόμενο).
- Η λίστα έμπιστων κλειδιών δεν άλλαξε· δεν φτιάχτηκε νέο κλειδί. Κανένα ιδιωτικό κλειδί στο repo ή στο zip.
- Βάση του patch: 2.6.11.1 (`fd0e31f`). Σε 2.6.11 ή παλιότερη απορρίπτεται (WRONG_BASE): πρώτα `nyx-2.6.11-to-2.6.11.1.zip`, μετά αυτό.
- Επαλήθευση με το χέρι: όπως στην §4β, με `nyx-2.6.11.1-to-2.6.12.zip`.

## 4ε. 2.6.12.1: υπογραφή με το CURRENT (15/11/2026)

Το patch `nyx-2.6.12-to-2.6.12.1.zip` υπογράφεται με το **CURRENT**, με τους ίδιους ελέγχους της §4β (οδηγία του χρήστη, 15/11).
- Πριν από την υπογραφή: το δημόσιο που βγαίνει από το ιδιωτικό είναι **ακριβώς** το `CURRENT` του `main/update-key.js` στο `b530ab4`, SPKI sha256 `68027240f3b9210542ac342d94b4c5430e3846fa8f94a3df7a9a13387e207ca6`.
- Επαλήθευση με τη λίστα έμπιστων κλειδιών της βάσης 2.6.12 (`81a993d`, ίδια λίστα `[LEGACY, CURRENT]` με το `b530ab4`): το CURRENT περνά, το LEGACY αποτυγχάνει (αναμενόμενο).
- Η λίστα έμπιστων κλειδιών δεν άλλαξε (`main/update-key.js`, `main/update-core.js` ίδια με το `81a993d`)· δεν φτιάχτηκε νέο κλειδί. Κανένα ιδιωτικό κλειδί στο repo ή στο zip.
- zip: 345.180 bytes, sha256 `2c7bc12c06af684b9c130146b892a4b44e7440e0dffcc7137c94dd6665ca162c`· `.sig` sha256 `72ed351ac073d17182bd9bd18af7c475f85c724d661014152b8f1d015935fb31`· 12 αλλαγμένα αρχεία, 0 διαγραμμένα, 3.989 στο δέντρο.
- Βάση του patch: 2.6.12 (`81a993d`). Σε 2.6.11.1, 2.6.11 ή 2.6.10.1 απορρίπτεται (WRONG_BASE)· σε άλλο Electron ζητά πλήρη εγκατάσταση (NEEDS_FULL).
- Επαλήθευση με το χέρι: όπως στην §4β, με `nyx-2.6.12-to-2.6.12.1.zip`.

## 4ζ. 2.6.12.2: υπογραφή με το CURRENT (16/11/2026)

Το patch `nyx-2.6.12.1-to-2.6.12.2.zip` υπογράφεται με το **CURRENT**, με τους ίδιους ελέγχους της §4β.
- Πριν από την υπογραφή: το δημόσιο που βγαίνει από το ιδιωτικό έχει SPKI sha256 `68027240f3b9210542ac342d94b4c5430e3846fa8f94a3df7a9a13387e207ca6` = **ακριβώς** το `CURRENT` του `main/update-key.js`.
- Επαλήθευση με τη λίστα έμπιστων κλειδιών της βάσης 2.6.12.1 (`0f01608`, ίδια λίστα `[LEGACY, CURRENT]`): περνά με CURRENT· με LEGACY μόνο → BAD_SIG.
- Η λίστα έμπιστων κλειδιών δεν άλλαξε (`main/update-key.js`, `main/update-core.js` ίδια με `81a993d` / `0f01608`)· δεν φτιάχτηκε νέο κλειδί. Κανένα ιδιωτικό κλειδί στο repo ή στο zip.
- zip: 249.544 bytes, sha256 `9e2f6b71dcd2ada8a9210863109251c651983ffe673776ab34f7cbeba318903f`· `.sig` sha256 `60c554584ae7338be0cf211913d2e5502f0eac672b628c65637bfb89c402fc70`· 10 αλλαγμένα αρχεία, 0 διαγραμμένα.
- Βάση του patch: 2.6.12.1 (`0f01608`). Σε 2.6.12, 2.6.11.1 ή 2.6.10.1 απορρίπτεται (WRONG_BASE)· σε άλλο Electron ζητά πλήρη εγκατάσταση (NEEDS_FULL).
- Επαλήθευση με το χέρι: όπως στην §4β, με `nyx-2.6.12.1-to-2.6.12.2.zip`.

## 4η. 2.6.13: υπογραφή με το CURRENT (17/11/2026)

Το patch `nyx-2.6.12.2-to-2.6.13.zip` υπογράφεται με το **CURRENT**, με τους ίδιους ελέγχους της §4β.
- Πριν από την υπογραφή: το δημόσιο που βγαίνει από το ιδιωτικό έχει SPKI sha256 `68027240f3b9210542ac342d94b4c5430e3846fa8f94a3df7a9a13387e207ca6` = **ακριβώς** το `CURRENT` του `main/update-key.js`.
- Επαλήθευση με τη λίστα έμπιστων κλειδιών της βάσης 2.6.12.2 (`c79c15e` = `main`, ίδια λίστα `[LEGACY, CURRENT]`): περνά με CURRENT· με LEGACY μόνο → BAD_SIG.
- Η λίστα έμπιστων κλειδιών δεν άλλαξε (`main/update-key.js`, `main/update-core.js` ίδια με `c79c15e`)· δεν φτιάχτηκε νέο κλειδί. Κανένα ιδιωτικό κλειδί στο repo ή στο zip.
- zip: 388.157 bytes, sha256 `ffa0537b2b95c62dcfacdb60c53f5512087f7347e4fcc54f91412c83b048b74b`· `.sig` sha256 `e8a4d939e61339a9dbd05ca5ca1d4dca0725e333d7488962d42ca957070848de`· 18 αλλαγμένα αρχεία, 0 διαγραμμένα.
- Βάση του patch: 2.6.12.2 (`c79c15e`). Σε 2.6.12.1, 2.6.12 ή 2.6.11.1 απορρίπτεται (WRONG_BASE)· σε άλλο Electron ζητά πλήρη εγκατάσταση (NEEDS_FULL).
- Επαλήθευση με το χέρι: όπως στην §4β, με `nyx-2.6.12.2-to-2.6.13.zip`.

## 4θ. 2.6.13.1: υπογραφή με το CURRENT (19/11/2026)

Βασικό patch: `nyx-2.6.13-to-2.6.13.1.zip` (το PC του χρήστη είναι στην 2.6.13). Δευτερεύον: `nyx-2.6.12.2-to-2.6.13.1.zip`. Και τα δύο με το **CURRENT**, με τους ελέγχους της §4β.
- Πριν από την υπογραφή: το δημόσιο που βγαίνει από το ιδιωτικό έχει SPKI sha256 `68027240f3b9210542ac342d94b4c5430e3846fa8f94a3df7a9a13387e207ca6` = **ακριβώς** το `CURRENT` (trusted[1]) του `main/update-key.js`.
- Επαλήθευση με τη λίστα έμπιστων κλειδιών της βάσης (2.6.13 `d8d6b9e` για το βασικό, 2.6.12.2 `c79c15e` για το δευτερεύον· ίδια λίστα `[LEGACY, CURRENT]`): περνά με CURRENT· με LEGACY μόνο → BAD_SIG· το detached `.sig` με LEGACY → Signature Verification Failure.
- Η λίστα έμπιστων κλειδιών δεν άλλαξε (`main/update-key.js`, `main/update-core.js` ίδια με `c79c15e` και `d8d6b9e`)· δεν φτιάχτηκε νέο κλειδί. Κανένα ιδιωτικό κλειδί στο repo ή στα zip.
- Βασικό: 411.058 bytes, sha256 `517637daae9813b49aa71295b949cbeef8e411b8787fad173d582e687a9ada1f`· `.sig` sha256 `43bfa3729a40c547d971dceace182cc97aa22755bcf62f6aade1e878b9d2d5a0`· 18 αλλαγμένα, 4 διαγραμμένα (`main/vsengine.js`, `main/voice2613.js`, `app/js/v26/voice2613.js`, `app/js/v26/voicehub2613.js`). Μόνο σε 2.6.13 → OK· σε 2.6.12.2 / 2.6.12.1 / 2.6.12 → WRONG_BASE· σε 2.6.13.1 → NOT_NEWER· άλλο Electron → NEEDS_FULL.
- Δευτερεύον: 430.829 bytes, sha256 `a7978c48287d44403472f4c06b989c087acea9c40d6c05e04ba932e504072e01`· `.sig` sha256 `f9aa2d2bfbcf9f4806f47c6879a84a5497bdad7797c4d64c9b3cef5b9d831774`· 23 αλλαγμένα, 1 διαγραμμένο (`main/vsengine.js`). Μόνο σε 2.6.12.2 → OK.
- Επαλήθευση με το χέρι: όπως στην §4β, με το αντίστοιχο zip.

## 4ι. 2.7.0: υπογραφή με το CURRENT (20/11/2026)

Patch: `nyx-2.6.13.1-to-2.7.0.zip` (το PC του χρήστη είναι στην 2.6.13.1, επιβεβαιωμένη 19/11). Με το **CURRENT**, με τους ελέγχους της §4β.
- Πριν από την υπογραφή: το δημόσιο που βγαίνει από το ιδιωτικό έχει SPKI sha256 `68027240f3b9210542ac342d94b4c5430e3846fa8f94a3df7a9a13387e207ca6` = **ακριβώς** το `CURRENT` (trusted[1]) του `main/update-key.js`.
- Επαλήθευση με τη λίστα έμπιστων κλειδιών της βάσης 2.6.13.1 (`296da39`, `[LEGACY, CURRENT]`): περνά με CURRENT· με LEGACY μόνο → BAD_SIG· το detached `.sig` με LEGACY → Signature Verification Failure.
- Η λίστα έμπιστων κλειδιών δεν άλλαξε (ο φάκελος `main/` είναι ίδιος με το `296da39`)· δεν φτιάχτηκε νέο κλειδί. Κανένα ιδιωτικό κλειδί στο repo ή στο zip.
- 399.327 bytes, sha256 `076738f7d04109d9dc74440e218567ccce41842d220688220d5a656767abcf60`· `.sig` sha256 `596aecc6f3d32576a1d3bf9a16ea33966ced2be1a41e10eeceba75b61fffb5df`· 15 αλλαγμένα, 0 διαγραμμένα. Μόνο σε 2.6.13.1 → OK· σε 2.6.13 / 2.6.12.2 → WRONG_BASE· σε 2.7.0 → NOT_NEWER· άλλο Electron (46) → NEEDS_FULL.
- Επαλήθευση με το χέρι: όπως στην §4β, με το zip αυτό.

## 4κ. 2.7.1: υπογραφή με το CURRENT (21/11/2026)

Patch: `nyx-2.7.0-to-2.7.1.zip` (μόνο πάνω στην 2.7.0, `release/2.7.0` = `e1c4387`). Με το **CURRENT**, με τους ελέγχους της §4β.
- Πριν από την υπογραφή: το δημόσιο που βγαίνει από το ιδιωτικό έχει SPKI sha256 `68027240f3b9210542ac342d94b4c5430e3846fa8f94a3df7a9a13387e207ca6` = **ακριβώς** το `CURRENT` (trusted[1]) του `main/update-key.js`.
- Επαλήθευση με τη λίστα έμπιστων κλειδιών της βάσης 2.7.0 (`e1c4387`, `[LEGACY, CURRENT]`): περνά με CURRENT· με LEGACY μόνο → BAD_SIG· το detached `.sig` με LEGACY → αποτυγχάνει (ED25519 digest_verify failure).
- Η λίστα έμπιστων κλειδιών δεν άλλαξε (`main/update-key.js`, `update-core.js`, `updater.js` ίδια με το `e1c4387`)· δεν φτιάχτηκε νέο κλειδί. Κανένα ιδιωτικό κλειδί στο repo ή στο zip.
- 360.069 bytes, sha256 `dae5ea4520813200f5220e401162f06ddee1cd357ee2fd775bec980364b1ba41`· `.sig` sha256 `4384d2ba196df274d2bda03424674c49b5f67a664fef0b5cdb5550a6aea80d6c`· 14 αλλαγμένα, 0 διαγραμμένα. Μόνο σε 2.7.0 → OK· σε 2.6.13.1 / 2.6.13 → WRONG_BASE· σε 2.7.1 → NOT_NEWER· άλλο Electron (46) → NEEDS_FULL.
- Εγκατάσταση σε αντίγραφο της εγκατεστημένης 2.7.0: active 2.7.1, previous 2.7.0, verifyCodeDir OK, αρχεία = repo· Εορτολόγιο plugin.js ίδιο (sha256 `24bd682b…`).
- Επαλήθευση με το χέρι: όπως στην §4β, με το zip αυτό.

## 5. ΠΡΟΤΑΣΗ (δεν υλοποιήθηκε): ο Hermes υπογράφει δικά του patch

Στόχος: ο Hermes να μπορεί να φτιάχνει patch όταν ο κύριος agent πιάνει όριο, χωρίς ποτέ να αποκτά το κλειδί LEGACY και χωρίς να μπορεί να το αντικαταστήσει.

1. **Δικό του κλειδί:** ο Hermes φτιάχνει ζεύγος ed25519 στον VPS. Το ιδιωτικό δεν φεύγει ποτέ από εκεί. Δίνει μόνο το δημόσιο.
2. **Ρητή έγκριση στις Ρυθμίσεις → Ενημέρωση → «Πρόσθετα κλειδιά υπογραφής»:**
   - επικόλληση δημόσιου κλειδιού·
   - το Nyx δείχνει όνομα («Hermes»), fingerprint sha256 και ημερομηνία·
   - χρειάζεται δεύτερο κλικ «Εγκρίνω», αφού ο χρήστης συγκρίνει το fingerprint με αυτό που δείχνει ο Hermes σε άλλο κανάλι.
   - Ποτέ αυτόματα, ποτέ μέσω MCP ή plugin.
3. **Αποθήκευση:** στα secrets (DPAPI) ή σε αρχείο που υπογράφει το Nyx, όχι στο nyx.json, όχι μέσα στον φάκελο app-code (για να μην αλλάζει με ένα patch).
4. **Δεν αντικαθιστά τίποτα:**
   - Το `TRUSTED = [LEGACY, CURRENT]` μένει hard-coded στο asar.
   - Τα πρόσθετα κλειδιά μπαίνουν σε **χωριστή** λίστα με μικρότερα δικαιώματα.
   - Patch με κλειδί Hermes δεν μπορεί να αλλάξει `main/update-key.js`, `main/update-core.js`, `main/updater.js`, `boot.js`, `main/secure.js`, `main/ipc-guard.js`, ούτε τη λίστα πρόσθετων κλειδιών (λίστα απαγορευμένων διαδρομών στο `applyPatch`).
5. **Ορατό:**
   - Κάθε εφαρμογή patch γράφει στο ιστορικό ποιο κλειδί το υπέγραψε.
   - Πριν την εφαρμογή, παράθυρο «Υπογραφή: Hermes (fingerprint …)» με τη λίστα αλλαγμένων αρχείων.
   - Ποτέ σιωπηλή εγκατάσταση.
6. **Ανάκληση:**
   - Κουμπί «Ανάκληση» δίπλα στο κλειδί.
   - Μετά την ανάκληση, όσοι φάκελοι app-code έχουν υπογραφή μόνο με αυτό το κλειδί δεν φορτώνουν πια (`verifyCodeDir` τους απορρίπτει) και γυρίζει στην τελευταία έκδοση με LEGACY/CURRENT.
7. **Τεστ που θα χρειαστούν:**
   - patch Hermes μετά από έγκριση → δεκτό·
   - χωρίς έγκριση → BAD_SIG·
   - που αγγίζει update-key.js → απορρίπτεται·
   - μετά από ανάκληση → δεν φορτώνει·
   - LEGACY δεκτό πάντα.

Χρειάζεται «Εγκρίνω» για να γίνει έκδοση (έως 3 παραδοτέα).
