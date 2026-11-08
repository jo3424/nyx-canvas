# Nyx Canvas v2 — οδηγός

Μαύρος άπειρος καμβάς + AI βοηθός (φωνή/κείμενο), browser με logins, βίντεο shorts, plugins.
Τα δεδομένα του v1 (`nyx.json`) μεταφέρονται αυτόματα στο v2 — δεν χάνεται τίποτα (κράτα πάντα κι ένα backup).

## Εγκατάσταση (portable)
1. Αν κατέβασες τα κομμάτια `NyxCanvas-v2.zip.partNN`: βάλ' τα όλα στον ίδιο φάκελο με το `ENOSE-ME.bat` και κάνε διπλό κλικ.
   Ενώνει τα κομμάτια (`copy /b`) και ελέγχει το MD5 (`certutil`). Οι σωστές τιμές είναι στο `MD5SUMS.txt`.
2. Δεξί κλικ στο `NyxCanvas-v2-win-x64.zip` → «Εξαγωγή όλων» → `NyxCanvas.exe`.
3. SmartScreen: «Περισσότερες πληροφορίες» → «Εκτέλεση οπωσδήποτε» (η εφαρμογή δεν είναι υπογεγραμμένη).

**Portable / Syncthing:** αν υπάρχει φάκελος `NyxData` δίπλα στο `NyxCanvas.exe`, τα δεδομένα μένουν εκεί (για USB).
Αλλιώς, από τις Ρυθμίσεις μπορείς να διαλέξεις φάκελο (π.χ. φάκελο του Syncthing). Μην ανοίγεις το ίδιο board ταυτόχρονα σε δύο PC.

## Συντομεύσεις
| Πλήκτρα | Τι κάνει |
|---|---|
| **Ctrl+Space** (και **Ctrl+Alt+Space** από οπουδήποτε) | Βοηθός / γραμμή εντολών (φωνή ή κείμενο) |
| **Ctrl+K** | Αναζήτηση σε όλα τα boards: λέξεις, σημασιολογική, `#tag` |
| **Ctrl+B** | Browser με αποθηκευμένα logins |
| **Ctrl+Shift+P** | Plugin Store |
| **Ctrl+Shift+D** | Σημερινή σημείωση (daily note) |
| **Ctrl+Shift+F** | Φίλτρο tags |
| **F5** | Παρουσίαση |
| **Ctrl+Alt+Q** | Γρήγορη σημείωση (quick capture) |
| **Ctrl+Alt+N** | Widget |

## AI Hub — τοπικά και cloud μοντέλα
Άνοιξε το **AI Hub** (εικονίδιο ✨ στη μπάρα).

### LM Studio (προτεινόμενο)
1. Στο LM Studio → Developer → **Start Server** (θύρα 1234). Το Nyx το εντοπίζει μόνο του στο `http://localhost:1234/v1`.
2. Μοντέλα:
   - **Κύριος βοηθός (εντολές/tool calling):** `Qwen3.6-35B-A3B` σε **UD-Q4_K_M** ή, για περισσότερο context στα 24GB της 7900 XTX, **IQ4_XS**.
     Το Q8 δεν χωράει άνετα με μεγάλο context.
   - **Vision / βαριές δουλειές:** `Qwen3.8-27B` (με το mmproj του), επιλέγεται στο «Όραση».
   - **Gemma 4 12B:** καλό για γρήγορο chat ή εναλλακτικό vision.
   - **Krikri 8B:** καλό για ελληνικά κείμενα, περιλήψεις και μετάφραση, **όχι** για κύριος agent (αδύναμο στο tool calling).
3. Στο Hub, κάθε εργασία (βοηθός, chat, vision, embeddings, περίληψη) έχει δικό της μοντέλο/πάροχο.
   Αν ένα μοντέλο δεν υποστηρίζει tools, το Nyx περνάει αυτόματα σε **JSON mode**. Χωρίς server, δουλεύει ένας απλός ελληνικός parser εντολών.

### Τοπικοί servers (GPU-Voice-Studio)
Στο Hub → «Τοπικοί servers» τα paths είναι προσυμπληρωμένα, αν υπάρχουν:
- **whisper-server:** `C:\Users\Administrator\GPU-Voice-Studio\third_party\whisper.cpp\build-vulkan\bin\Release\whisper-server.exe`
  με το `ggml-large-v3-turbo-q5_0.bin` (θύρα 8178, γλώσσα `el`).
  Χρειάζεται για το μικρόφωνο, τα voice memos και τις απομαγνητοφωνήσεις βίντεο.
- **llama-server:** `...\third_party\llama\llama-server.exe` (θύρα 8080) με οποιοδήποτε .gguf (π.χ. Krikri).

Πάτα **Start** / **Stop**. Τα logs φαίνονται εκεί. Το ffmpeg πρέπει να είναι στο PATH: το βλέπεις στο **Tools panel**.

### Cloud
OpenRouter, Venice, xAI, OpenAI ή οποιοσδήποτε OpenAI-compatible (custom).
Τα κλειδιά αποθηκεύονται κρυπτογραφημένα (Windows DPAPI / safeStorage), **όχι** μέσα στο `nyx.json`.

### TTS (φωνή απαντήσεων)
Η «Φωνή Windows (SAPI)» δουλεύει πάντα.
Το vs-engine / OmniVoice μπαίνει ως **πρότυπο εντολής**, που πρέπει να συμπληρώσεις εσύ: δεν έχει επαληθευτεί.

## Βοηθός — παραδείγματα
- «φτιάξε σημείωση για το ραντεβού αύριο στις 10»
- «άνοιξε το board Ταξίδι», «δείξε μου τις κάρτες με #ιδέες»
- «σβήσε τις σημειώσεις για το γυμναστήριο» (ρωτάει πριν σβήσει)
- «μάζεψε τις κάρτες για το βίντεο σε ομάδα», «συμμάζεψε τον καμβά»
- «γράψε μια περίληψη των σημειώσεων», «πρότεινε ιδέες για…»

Το μικρόφωνο στέλνει τον ήχο στο whisper και εκτελεί την εντολή. Το ιστορικό συζήτησης κρατιέται.

## Βίντεο (shorts)
Σύρε ένα βίντεο στον καμβά. Μπορείς να:
- κάνεις scrub, αλλάξεις ταχύτητα ή βάλεις loop·
- μαρκάρεις ένα **A→B highlight** ή να σου προτείνει highlights το AI·
- πάρεις **frame grab** ή thumbnail·
- βγάλεις απομαγνητοφώνηση με χρόνους·
- κάνεις **export clip** με ffmpeg.

Οι κάρτες σέρνονται έξω στον Explorer/Desktop (drag-out), ή γίνονται «Αποθήκευση ως…» / «Άνοιγμα φακέλου».

## Browser
Τα logins μένουν **μόνο** στο session του Electron (`persist:nyxweb`). Το Nyx δεν διαβάζει και δεν αποθηκεύει κωδικούς.
Μπορείς να καρφιτσώσεις μια σελίδα ως ζωντανή κάρτα, να τραβήξεις screenshot, να κάνεις clip κειμένου, και να φτιάξεις tracker.
Ο tracker χρησιμοποιεί το ίδιο session, άρα βλέπει και σελίδες με login.

## Plugins
**Ctrl+Shift+P** → 19 ενσωματωμένα. Κάθε plugin δείχνει περιγραφή και **δικαιώματα**, και ζητά έγκριση πριν ενεργοποιηθεί.

- **Telegram bot:**
  1. Στο @BotFather → `/newbot` → token.
  2. Βάλε το token στο plugin και στείλε `/start` στο bot σου. Θα σου απαντήσει με το chat id σου.
  3. Βάλε το chat id στα «Επιτρεπτά». Ό,τι στέλνεις γίνεται σημείωση ή εντολή στον βοηθό.
- **Nyx MCP server:** κάνει τον καμβά διαθέσιμο σε LM Studio, Claude Desktop, Cursor.
  - Ακούει μόνο στο 127.0.0.1:7801 και θέλει `Authorization: Bearer <token>`.
  - Το «Ρυθμίσεις σύνδεσης» δίνει το έτοιμο `mcp.json`. Με το «Νέο token» ακυρώνεις το παλιό.
- **Clipboard Inbox:** κατηγοριοποιεί ό,τι αντιγράφεις (link, email, κώδικας, χρώμα…) και καθαρίζει παραμέτρους tracking (utm, fbclid…).
  Αγνοεί ό,τι μοιάζει με κωδικό ή token.
- **Canvas → MP4 (HyperFrames):** απαιτεί ξεχωριστή εγκατάσταση (`npm i -g hyperframes` ή npx) **και** ffmpeg. Δεν έχει επαληθευτεί σε Windows.
- **Υπόλοιπα:**
  - Hermes Agent (μη επαληθευμένο), Webhooks, Status pill.
  - Καιρός, Ισοτιμίες, Crypto, Εορτολόγιο, RSS, ICS ημερολόγιο.
  - GitHub releases, HF trending.
  - JSON Canvas (Obsidian), Markdown export, Pomodoro, Μετάφραση.
- **Αυτοματισμοί:** «όταν/κάθε…» → ενέργεια plugin ή εντολή βοηθού.

⚠️ Τα plugins τρέχουν σε `node:vm` με API που ελέγχει τα δικαιώματα. Αυτό **δεν** είναι πραγματικό sandbox. Εγκατέστησε μόνο κώδικα που εμπιστεύεσαι.

## Γνωστά θέματα / περιορισμοί
- Ο browser χρησιμοποιεί `<webview>` (όχι WebContentsView) με μόνιμο partition.
- Τα «κλειδωμένα boards» κρύβουν και κλειδώνουν το περιεχόμενο των καρτών, αλλά **δεν** κρυπτογραφούν τα αρχεία media.
- Δεν έχουν δοκιμαστεί σε πραγματικά Windows: TTS με vs-engine/OmniVoice, Hermes, Windows OCR, Telegram (live), HyperFrames.
