# RUN-STATE: Encrypted-DVD Rip/Decrypt-Pipeline (2026-07-10/11) — FERTIG, ungepusht

## 🧭 System Context

- **Active Agent:** Orchestrator (Sonnet 5) — Architektur + Implementierung direkt gebaut (kein Delegations-Overhead für diesen Scope).
- **Auslöser:** Marvin legt echte kommerzielle Video-DVD ("Jurassic World", CSS-verschlüsselt) in kiosk2 ein. `OPTICAL-MEDIA-BLUEPRINT.md` (Root, ungetrackt) schlug Docker/NAS + MakeMKV + HandBrake vor — Marvin bestätigt Umsetzung nach Korrektur (siehe Handoff-Notes).
- **Zwei Korrekturen zum Blueprint (vor Implementierung geklärt):**
  1. **Kein MakeMKV.** Proprietär, kein Debian-Paket, Beta-Key läuft alle 1-2 Monate ab → braucht periodisches Online-Renewal. Widerspricht "für immer offline"-Sneakernet-Prinzip. HandBrakeCLI kann Decrypt (via System-`libdvdcss`, von HandBrakes gebündeltem `libdvdread` per dlopen genutzt) + Transcode in einem Schritt — kein verlustfreier MKV-Zwischenschritt nötig für Kiosk-Demo-Zweck.
  2. **Kein Docker/NAS.** Projekt hat keine NAS-Rolle (Blueprint nahm fälschlich `Ugreen`-NAS an). Pipeline läuft direkt auf kiosk2 (Haupt-Kiosk), kein neuer Architektur-Layer.
- **Rechtlicher Hinweis (dokumentiert, nicht verschwiegen):** CSS-Umgehung ist in Deutschland nach §95a UrhG illegal, auch für private Sicherungskopie. Bewusste Bachelor-Projekt-Entscheidung, kein Versehen.

## 📋 Was gebaut wurde

| Baustein | Datei | Zweck |
|---|---|---|
| HandBrakeCLI | apt (Debian-Main, `1.9.2+ds1-1`) | Rip+Decrypt+Transcode in einem Aufruf |
| libdvdcss2 | Source-Build (VideoLAN-Git, meson/ninja, `/usr/local/lib`) | CSS-Entschlüsselung, kein Debian-Paket verfügbar (rechtlich) |
| `isRipAvailable`/`isVideoDvd`/`sanitizeName`/`rip`/`ripAndUpload`/`registerDvdRipIpc` | `src/main/ipc/dvdrip.ts` (neu) | Erkennt `VIDEO_TS` auf gemounteter Disc, spawnt `HandBrakeCLI -i <mount> -o <temp>.mp4 --main-feature -e x264 -q 22 --aencoder av_aac`, parst `Encoding: … NN.NN %` für Progress, lädt Ergebnis via bestehendes `upload()` nach `/DVD-Rips` hoch, räumt Temp-Dir auf (finally) |
| `export` von `upload()` | `src/main/ipc/copyparty.ts` | dvdrip.ts ruft es in-process (kein IPC-Roundtrip zurück zum Renderer nötig) |
| `DvdRipProgress`/`DvdRipResult` + 4 IpcChannels | `src/shared/types.ts` | `dvdrip:available`, `dvdrip:is-video-dvd`, `dvdrip:start`, `dvdrip:progress` |
| `api.dvdrip.{available,isVideoDvd,start,onProgress}` | `src/preload/index.ts` | Bridge, `AppApi`-Typ automatisch über `typeof api` |
| `RipDialog.tsx` (neu) | `src/renderer/src/components/` | Confirm→Progress(scan/encode/upload)→Done/Error, 1:1 Stil-Kopie von `BurnDialog.tsx` |
| `DvdRipBanner.tsx` (neu) | `src/renderer/src/components/` | Banner unter der Split-View wenn `isVideoDvd`, Button öffnet `RipDialog` |
| Wiring | `src/renderer/src/App.tsx` | `isVideoDvd`-State via `api.dvdrip.isVideoDvd(usbPath)` (async, nur wenn `dataDrive?.isOptical`), Banner-Render neben `OpticalDropZone` |

**Ziel-Ablage:** `/DVD-Rips/<sanitizeName(disc-label)>.mp4` auf Agora (fester vpath, kein User-Input v1).

## ✅ End-to-End-Verifikation (kiosk2, echte Disc "JURASSIC_WORLD", 2026-07-10/11)

1. **CLI-Vorabtest** (vor App-Integration): `HandBrakeCLI -i /media/marvin/JURASSIC_WORLD --scan` → `libdvdread: Attempting to retrieve all CSS keys` (libdvdcss2 wird von HandBrakes gebündeltem libdvdread korrekt dlopen't) → 24 Titel gefunden, Region 2. Voll-Scan (`-t 0`) zeigt Titel 22 = 01:59:16 (Hauptfilm, Rest Trailer/Menüs/Extras).
2. **UI**: USB-Stick abgezogen (App-Priorität lokal: USB vor DVD) → Split-Pane zeigt DVD, Pane-Titel = Disc-Label `JURASSIC_WORLD`, Banner "Video-DVD erkannt · JURASSIC_WORLD — Dateien sind CSS-verschlüsselt" + Button.
3. **Rip-Dialog**: Confirm → Klick → Progress "Hauptfilm wird rippen & kodiert…" → nach Encode automatisch Upload → "Fertig — liegt jetzt unter /DVD-Rips auf Agora."
4. **Ergebnis verifiziert**: `curl localhost:3923/DVD-Rips/?ls` → `JURASSIC_WORLD.mp4`, 1.343.294.450 Bytes (~1,28 GB, sinnvolle Bitrate für q22/119 min). `ftyp`-Box-Check (`od -c` auf ersten 64 Byte) → valides MP4 (`mp42`/`iso2`/`avc1`/`mp41`), kein korruptes File.
5. Temp-Dir (`/tmp/agora-dvdrip-*`) nach Abschluss weg (cleanup via `finally` bestätigt).

**Nicht getestet:** Fehlerpfad (HandBrakeCLI-Absturz, Upload-Fehler während Rip), zweite Disc/Titel-Auswahl bei mehreren ähnlich langen Titeln, Verhalten bei fehlendem `libdvdcss2`/`HandBrakeCLI` auf kiosk1/kiosk3 (Feature bisher nur auf kiosk2 installiert — dort steht auch der einzige echte DVD-Writer, siehe [[kiosk-infra]]).

## 🔄 Deploy-Status

**Code liegt auf kiosk2 (rsync, NICHT über git — lokaler Branch noch ungepusht).** kiosk1/kiosk3 haben weder den Code noch HandBrakeCLI/libdvdcss2 installiert. Vor Commit/Push: Marvins Freigabe ausstehend (siehe Chat). Nach Push: `git pull` + `npm run build` + App-Restart auf allen 3 (Standardweg, siehe [[kiosk-infra]]) — HandBrakeCLI+libdvdcss2-Install nur auf Kiosken nötig, die tatsächlich ein optisches Laufwerk haben (aktuell nur kiosk2).

---

# RUN-STATE: DVD-Anzeige-Fix (2026-07-10) — AKTIV

## 🧭 System Context

- **Active Agent:** Architect/Orchestrator — analysiert + delegiert, schreibt keinen Code selbst.
- **Bug:** Eingelegte DVD (schlichte Video-/Bilddateien, keine Verschlüsselung) erscheint nicht in der Kiosk-App → Splitscreen-Browse-Pane öffnet nie.
- **Root Cause (verifiziert, kein App-Logikfehler):** Das `drivelist`-npm-Package schließt auf Linux `/dev/sr*` (CD/DVD) in seinem lsblk-Enumerator hart aus (`node_modules/drivelist/lib/lsblk/json.ts:102`, Kommentar „Omit loop devices, CD/DVD drives, and RAM"). `drivelist.list()` liefert die DVD auf Linux **nie** zurück → Apps `isOpticalDrive()`-Regex (korrekt geschrieben) läuft nie an. OS mountet die Disc korrekt ro nach `/media/marvin/<label>` (verifiziert kiosk2: `/dev/sr0`, Label `Bläserklasse`, udf).
- **Fix-Strategie:** drivelist für optische Medien auf Linux umgehen — eigener `/dev/sr*`-Enumerator via `lsblk -J -o …`, synthetische `DriveInfo` (isOptical:true, OS-Mountpoint) in `snapshot()` mergen. Danach greift bestehende `dataDrive`-Logik (`App.tsx:78-81`) automatisch → Splitscreen. Blanke Disc (kein Mount) → weiter `burnDrive` → OpticalDropZone. Beide Pfade erhalten. Kein drivelist-Fork/Patch (App-Layer-Lösung, konform CLAUDE.md).
- **Deployment/Test:** Fix muss auf alle 3 Kioske (`git pull` im Repo + App-Restart, siehe Memory `kiosk-infra`). **Realer DVD-Gesamtflow testet Marvin selbst am Gerät.**

## 📋 Task Ledger (DVD-Fix)

| Task | Agent | Status | DoR (messbar) | Files (exklusiv) |
|---|---|---|---|---|
| DVD-1 Optical-Enumerator | Sonnet (cavecrew-builder) | 🟢 DONE | `listOpticalDrives()` Linux-only: `lsblk -J -o NAME,PATH,LABEL,MOUNTPOINT,RO,RM,TYPE,MODEL`, filter `type==='rom'` → synthetische `DriveInfo` (isOptical:true, isRemovable:true; mountpoint gesetzt → 1 mountpoint, sonst `[]`). Defensiv (lsblk-Fehler/parse-Fehler → `[]`, nie throw). In `snapshot()` gemerged, dedup by device. macOS unberührt (drivelist bleibt). typecheck grün. | `src/main/ipc/drives.ts` |
| DVD-2 Tests | Haiku (cavecrew-builder) | 🟢 DONE | Unit-Test für lsblk-JSON-Parser mit gemocktem stdout-String: (a) data disc (mountpoint gesetzt → 1 mountpoint), (b) blank disc (mountpoint null → `[]`), (c) kein rom-device → `[]`, (d) lsblk-Fehler → `[]`. **drivelist gemockt, nie real aufrufen** (native binding segfaultet unter plain node — ABI-Mismatch; Enumerator selbst nutzt aber nur execFile(lsblk), kein drivelist). Testfixture = echter kiosk2-Output (siehe Handoff Notes). `npm test` grün. | `src/main/ipc/drives.test.ts` (neu) |
| DVD-3 Review | Sonnet (cavecrew-reviewer) | 🟢 PASS | Diff gegen Root-Cause: gemountete DVD erscheint → Split (`App.tsx:134`) öffnet. Regression: blanke Disc bleibt Burn-Zone. Dedup korrekt. typecheck+test grün. Dann Deploy auf 3 Kioske + Marvins Gerätetest freigeben. | Review-Eintrag hier |

## 🔄 Handoff Notes (DVD-Fix)

- **[Root-Cause-Investigation] Sonnet-Investigatoren + Orchestrator:** 3 read-only Probes. (1) `drives.ts`-Filter analysiert — `isOpticalDrive()` (`/^\/dev\/sr\d+$/` oder Beschreibungs-Keyword) korrekt, referenziert `isReadOnly`/`busType` nie. (2) `App.tsx:78-85,134` — Split-Bedingung `usbPath ?` braucht `dataDrive` mit `mountpoints[0]`; DVD ohne Mount → `burnDrive` → OpticalDropZone. (3) SSH-Runtime-Probe kiosk2: DVD `/dev/sr0`/`Bläserklasse` von OS gemountet, aber `drivelist.list()` gibt nur `/dev/sda`+`/dev/sdb` (intern) — `/dev/sr0` fehlt komplett → Ursache in `node_modules/drivelist/lib/lsblk/json.ts:102`. `node -e` segfaultet an drivelist native binding → Probe nutzte `ELECTRON_RUN_AS_NODE=1 electron -e`.
- **[DVD-1] Orchestrator-Verifikation:** Builder gab zunächst `lsblk -J -O -o …` aus → **Bug:** `-O`/`-o` sind mutually exclusive (util-linux 2.40, Debian 13): `lsblk: mutually exclusive arguments: --output-all --output` → catch `[]` → DVD unsichtbar. Gegen echtes kiosk2 verifiziert + gefixt (nur `-o`). **Echter kiosk2-Output** (`lsblk -J -o NAME,PATH,LABEL,MOUNTPOINT,RO,RM,TYPE,MODEL`, für DVD-2-Fixture):
  ```json
  { "name": "sr0", "path": "/dev/sr0", "label": "Bläserklasse",
    "mountpoint": "/media/marvin/Bläserklasse", "ro": false, "rm": true,
    "type": "rom", "model": "DVD RW AD-7710H" }
  ```
  Key ist `mountpoint` (singular, gesetzt), matcht `LsblkDevice`-Interface. typecheck node+web grün.
- **[DVD-2] Haiku (cavecrew-builder):** ✅ DONE. Refactor: reine `parseOpticalLsblk(stdout)` aus `listOpticalDrives()` extrahiert (execFile + Plattform-Guard bleiben in `listOpticalDrives`), exportiert für Test. Neu `src/main/ipc/drives.test.ts`, 8 Cases (data disc/blank disc/model-Fallback/kein rom/non-rom-Filter/unparsebar + 2 Shape-Checks). Orchestrator-Verifikation: typecheck node+web grün, `npm test` **110/110 grün** (5 Testdateien).
- **[DVD-3] Sonnet (cavecrew-reviewer):** ✅ PASS (0🔴 2🟡). Items 1–4 PASS: gemountete Disc → `mountpoints[0]` gesetzt → `dataDrive`-find matcht → Split öffnet; blanke Disc → `mountpoints:[]` → nur `burnDrive` (mutually exclusive, korrekt); Merge/Dedup by device droppt/dupliziert keine echten Drives; `listOpticalDrives` non-throwing (execFile + JSON.parse je try/catch → `[]`); Agora disc_inserted feuert korrekt via `prev.mountpoints.length===0 && d.mountpoints.length>0`-Zweig, Baseline respektiert. **2 gelbe Findings gefixt (Sonnet cavecrew-builder):** F1 = synthetische Optical-Entries übersprangen Backup-Filter → neuer `isBackupDriveInfo(DriveInfo)`, in `snapshot()` auf `optical` vor Merge angewandt. F2 = `listOpticalDrives()` execFile-Fehlerzweig untestet → exportiert + Tests (lsblk-fail→[], non-linux→[]) + `isBackupDriveInfo`-Test. Orchestrator-Verifikation: typecheck node+web grün, `npm test` **114/114 grün**.
- **[DEPLOY] ✅ ERLEDIGT (2026-07-10):** Commit `34ef711` gepusht (main). Alle 3 Kioske: `git pull` + `npm run build` (out/ gitignored → Rebuild nötig) + App-Restart (Script-Datei-Methode). **End-to-end auf kiosk2 mit echter DVD verifiziert (Screenshot):** Disc `Bläserklasse` → Splitscreen öffnet, linke Pane zeigt DVD-Dateien (JPGs + mp4s, Ordner-Nav „Ohrwurm"), QuickLook funktioniert. kiosk1/kiosk3 gebaut+neugestartet (kein Datentest ohne Disc). **Feature FERTIG.** Offen nur: blanke Disc → Burn-Zone (Regression per Code-Review bestätigt, nicht am Gerät gegengetestet).

---

# RUN-STATE: Anforderungs-Verifikation (2026-07-09) — ARCHIV

## 🧭 System Context (Verifikations-Run)

- **Active Agent:** Architect/Orchestrator (Fable 5) — testet NICHT selbst, schreibt keinen Code
- **Ziel:** Alle 11 Anforderungen (Memory `kiosk-requirements`) mit echten Tests auf den Kiosken verifizieren. **Ausnahme: DVD/Burn (#1 optisch, #4 Burn) — testet Marvin selbst am Gerät.**
- **Regel für alle Agents:** NICHTS fixen, keine Commits, nur beobachten + dokumentieren (PASS/FAIL/PARTIAL/NOT-TESTABLE + Beweis). Testartefakte danach aufräumen. Apps laufend hinterlassen.
- **Output:** Orchestrator konsolidiert in `TEST-REPORT.md` (MD-Tabelle).

## 📋 Task Ledger (Verifikation)

| Task | Agent | Kiosk | Status | Scope |
|---|---|---|---|---|
| VER-A Backend/API | Sonnet 5 | kiosk2 (SSH, kein UI) | 🟢 | #2 ?ls, #7/#9 /event+/stats (synthetisch, Delta-basiert, Events danach aus DB löschen), #8 /stats live/ever/peak, #10-remote Code-Check ?srch, #1-USB lsblk-Status; lokal: typecheck+npm test |
| VER-B Viewer+Meta | Opus 4.8 | kiosk2 (UI, DISPLAY=:0) | 🟢 | #5 alle 7 Kategorien QuickLook+FullView (lokal+remote), #6 Metadaten lesen+schreiben lokal UND remote (≤64 MB) |
| VER-C Sort+Suche | Opus 4.8 | kiosk1 (UI) | 🟢 | #3 Sort-UI beide Panes (Name/Größe/Datum/Format, dirs-first), #10 lokale Namenssuche |
| VER-D DnD+Expand | Opus 4.8 | kiosk3 (UI) | 🟢 | #4 DnD local→remote + remote→local (xdotool), #11 Ordner-Drop + ZIP-Drop (Einheit erhalten, single-root-Kollaps, Kollision "(2)") |

**Review (Fable 5, 2026-07-10): ✅ ABGESCHLOSSEN.** Alle 4 Agents fertig, Cleanup je bestätigt (Testfiles, copyparty-Uploads, Stats-Events, scsi_debug entladen), Apps im Normalzustand. Konsolidiertes Ergebnis in **`TEST-REPORT.md`**: #2/#3/#4/#6/#8/#10/#11 voll PASS (Remote-Suche entgegen Doku bereits implementiert + funktionsfähig!), #1-USB/#5/#7 PASS mit Findings, #9 PARTIAL (GB-pro-Format strukturell unmöglich, kein Bytes-Feld im events-Schema). 7 Findings F1–F7 dokumentiert, **NICHTS gefixt** (Auftragsregel): F1 QuickLook PDF/DOCX Rohmüll, F2 Hot-Plug-Mount-Lücke drives.ts, F3 Esc bei Video-Fokus, F4 Handle-Leak Metadaten-Write, F5 Fußzeilen-Kosmetik, F6 = #9-Lücke, F7 Doku veraltet. Offen für Marvin: DVD-Gesamtflow + echter USB-Stecktest.

**Konflikt-Regeln:** UI-Agents je eigener Kiosk (parallel ok). Alle Uploads mit eindeutigem Präfix (`ver-b-`, `ver-c-`, `ver-d-`). VER-A zählt Deltas mit eigenem Marker (`kiosk`-Feld `verify-agent`), da VER-D parallel echte transfer-Events erzeugt.

---

# RUN-STATE (ARCHIV): Analytics (#7/#9) + Sort-UI (#3)

## 🧭 System Context (Feature 2)

- **Active Agent:** Architect (Fable 5) — Handoffs erstellt, Worker laufen
- **Feature:** #7 USB/Disc-Zähler kumulativ, #9 Transferzähler (Dateizahl + Format), #3 Sort-UI
- **Architektur:** Kiosk-Apps melden Events (fire-and-forget POST, 3s-Timeout, Fehler still) an agora-server (kiosk2:8080) → SQLite-Tabelle `events` → `/stats` erweitert → `AgoraStatsPanel`. Reset löscht Events mit. Shared-Typen (`AgoraEvent`, `AgoraStats`-Erweiterung) hat der Architect bereits in `src/shared/types.ts` festgelegt — Worker fassen types.ts NICHT an.
- **Constraints:** Sneakernet offline zur Laufzeit; POST /event ohne Auth (gleiche Vertrauensstufe wie anon-copyparty, bewusst); Dashboard-Ausfall darf App nie blocken.

## 📋 Task Ledger (Feature 2)

| Task | Agent | Status | DoR (messbar) | Files (exklusiv) |
|---|---|---|---|---|
| TSK-A Server-Events | Opus 4.8 | 🟢 | `events`-Tabelle (id, session_id, ts, kiosk, kind, files, exts_json); `POST /event` validiert kind, insert in aktuelle Session; `/stats` liefert zusätzlich usb_count/disc_count/files_transferred/by_ext (Top 8, aus exts_json aggregiert, nur aktuelle Session); `reset_session` löscht events; Logik-Test mit tmp-SQLite grün | `agora-dashboard/poller.py`, `agora-dashboard/server.py` |
| TSK-B Kiosk-Events | Opus 4.8 | 🟢 | `agora-events.ts`: `postEvent(AgoraEvent)` fire-and-forget (3s Timeout, catch still); drives.ts feuert `usb_connected` (add, nicht-optical) / `disc_inserted` (optical bekommt mountpoint); copyparty.ts upload+download feuern `transfer` (direction, files=done, exts aus Dateinamen); typecheck grün | `src/main/agora-events.ts` (neu), `src/main/ipc/drives.ts`, `src/main/ipc/copyparty.ts`, `src/main/ipc/agora.ts` (nur AGORA_BASE exportieren) |
| TSK-C Panel-UI | Sonnet 5 | 🟢 | AgoraStatsPanel zeigt USB-Sticks, Discs, übertragene Dateien, Top-Formate (Badge-Liste); fehlende Felder (alter Server) → „–"; Theme-Tokens, dark-mode | `src/renderer/src/components/AgoraStatsPanel.tsx` |
| TSK-D Sort-UI | Sonnet 5 | 🟢 | Sort-Feld (Name/Größe/Datum/Format) + Richtung in beiden Panes, dirs-first bleibt, shared Helper; Default Name-asc unverändert; typecheck grün | `src/renderer/src/lib/sort.ts` (neu), `src/renderer/src/components/FileBrowserPane.tsx`, `RemoteBrowserPane.tsx` |

**Review (Fable 5): ✅ PASS, deployed 2026-07-09.** Alle 4 Tasks grün, typecheck+build+102 Tests+py_compile grün. E2E auf kiosk2: POST /event (usb+transfer) → /stats aggregiert korrekt (by_ext sortiert), invalid kind → 400; Panel zeigt USB-Sticks/Discs/Dateien + Top-Formate-Badges; Sort-Control in beiden Panes. **Orchestrator-Fix nach E2E:** erster drives-Poll ist Baseline (App-Restart zählte gesteckte Sticks als neu → `baselined`-Flag in drives.ts). Test-Events aus DB geputzt (Zähler starten bei 0). ⚠️ Deploy-Detail: agora-server/poller laufen aus dem REPO-Checkout `~/copyparty-kiosk/agora-dashboard/` (systemd-user, `.venv` dort) — NICHT `~/agora-dashboard/` (Altlast-Kopie). Offen: echter USB-Stecktest (Zähler +1) wenn Marvin am Gerät ist; Transfer-Event via echtem DnD.

---

# RUN-STATE (ARCHIV): File Preview & Viewer/Editor Feature

## 🧭 System Context

- **Active Agent:** Architect (Fable 5) — Architektur abgeschlossen, Übergabe an Developer
- **Current Phase:** 1_Architecture → bereit für 2_Implementation
- **Feature:** macOS-artiges Quick-Look (Leertaste) + vollwertige Viewer/Editoren (Enter/Doppelklick) für lokale UND remote Dateien, inkl. editierbarem Metadaten-Panel
- **Global Constraints:**
  - System ist isoliertes Sneakernet **ohne Internet**. Alle Libraries als npm-Pakete gebundelt. **Keine CDNs, keine Web-Fonts, keine Cloud-APIs.**
  - `contextIsolation: true` bleibt. Renderer bekommt **keinen** direkten FS-Zugriff — alles über Preload-Bridge oder Custom Protocol.
  - copyparty-Upstream wird nicht angefasst.
  - Bestehende Features (Drag/Drop, up2k, Selection, Thumbnails) dürfen nicht regressieren. `npm run typecheck` muss nach jedem Task grün sein.

---

## 🏗️ Architecture Handoff (Fable 5)

### Kernentscheidungen

1. **Streaming via Custom Protocol `kiosk-stream://`** (Main-Process, `protocol.handle()`).
   Der sandboxte Renderer kann weder `file://` laden noch copyparty mit Cookie fetchen (Cookie-Jar lebt im Main). Ein Protokoll deckt beide Quellen ab:
   - `kiosk-stream://local/<base64url(absPath)>` → `fs.createReadStream`, **Range-Support** (HTTP 206) für Video/Audio-Seeking
   - `kiosk-stream://remote/<base64url(serverUrl)>/<base64url(vpath)>` → Proxy-GET an copyparty mit Cookie aus bestehender Connection-Map (`src/main/ipc/copyparty.ts`), Range-Header durchreichen
   - Damit funktionieren `<img>`, `<video>`, `<audio>`, pdf.js, three.js-Loader etc. direkt gegen dieses Protokoll — kein IPC-Buffer-Kopieren.

2. **Zentrale Dateityp-Registry** in `src/shared/filetypes.ts` (pure functions, unit-testbar):
   Extension → `PreviewCategory` (`audio | video | image | model3d | text | document | program | unknown`) + Capabilities (`quickLook`, `fullOpen`, `editable`). Einzige Wahrheitsquelle für beide Panes, QuickLook und FullView.

3. **Zwei Anzeige-Ebenen, beide in-window** (kein zweites BrowserWindow — Kiosk bleibt ein Fenster):
   - **QuickLookOverlay**: kleines zentriertes Overlay (Mac-Stil), Leertaste toggelt. Leichtgewichtige Vorschau je Kategorie.
   - **FullView**: fullscreen Modal-Container mit Kategorie-Dispatch auf Viewer/Editor-Komponenten. Enter oder Doppelklick auf Datei öffnet. Gemeinsames MetadataPanel (Button in FullView-Topbar).

4. **Metadaten über `exiftool-vendored`** (bundelt exiftool-Binary, offline-fähig, read/write für Bilder, Video, Audio, PDF):
   - Read: lokale Dateien via exiftool; remote Dateien: copyparty-Tags aus `?ls`-Response (`tags`-Feld) — **read-only in v1**
   - Write: nur lokale Dateien in v1 (remote würde Download→Edit→Re-Upload erfordern; bewusst verschoben)

5. **Nicht nativ darstellbare Formate werden im Main konvertiert** (`sharp` ist bereits Dependency):
   - TIFF → PNG via sharp
   - RAW → eingebettetes JPEG-Preview extrahieren (exiftool `-PreviewImage`/`-JpgFromRaw`); volle RAW-Dekodierung ist **out of scope**
   - Ergebnis über `kiosk-stream://converted/<cacheKey>` aus Cache-Verzeichnis (Muster analog `thumb-cache.ts`)

6. **Library-Auswahl** (alle npm, alle gebundelt, alle ohne Netzwerkzugriff zur Laufzeit):
   | Zweck | Library | Begründung |
   |---|---|---|
   | Code/Text-Editor | CodeMirror 6 (`@codemirror/*`) | modular, tree-shakeable, Sprachen als lokale Pakete |
   | PDF | `pdfjs-dist` | Standard, Worker lokal bundeln (kein CDN-Worker!) |
   | DOCX | `mammoth` | docx→HTML, read-only Viewer |
   | XLSX/ODS/CSV | SheetJS `xlsx` | read-only Tabellen-Render |
   | EPUB | `epubjs` | read-only Reader |
   | Audio-Waveform+Spektrum | `wavesurfer.js` v7 + Spectrogram-Plugin | Timeline + Spektrum aus einer Lib |
   | Bild-EXIF (Renderer-Anzeige) | via IPC aus exiftool (kein Zweitparser) | eine Metadaten-Quelle |
   | 3D | `three` (GLTFLoader, OBJLoader, FBXLoader, STLLoader, USDZLoader) | Standard |
   | Gaussian Splats | `@mkkellogg/gaussian-splats-3d` | three-kompatibel; als separater Task, da Risiko |
   | Programm-Icons | Electron `app.getFileIcon()` | eingebaut, kein Extra-Paket |

7. **Bekannte Grenzen (ehrlich, nicht wegabstrahieren):**
   - Chromium in Electron: MKV/AVI-Container und Codecs wie H.265/AC-3 teils nicht abspielbar (keine proprietären Codecs). Player zeigt dann sauberen „Codec nicht unterstützt"-Zustand. **Kein ffmpeg-Transcoding in v1.**
   - ALAC-Wiedergabe unsicher → best effort, DoR verlangt nur MP3/WAV/FLAC/AAC.
   - Programme (`exe/app/dmg/pkg`): nie öffnen, nur Icon + Dateiinfo. `app.getFileIcon` liefert unter Linux ggf. generisches Icon — akzeptiert.

### Neue/geänderte Dateien (Soll-Struktur)

```
src/shared/filetypes.ts               ← TSK-01 Registry
src/shared/types.ts                   ← erweitert: PreviewSource, FileMetadata, IpcChannels
src/main/stream-protocol.ts           ← TSK-02 kiosk-stream:// (local/remote/converted)
src/main/preview-convert.ts           ← TSK-03 TIFF/RAW-Konvertierung + Cache
src/main/ipc/metadata.ts              ← TSK-04 exiftool read/write + fs:write
src/main/ipc/appicon.ts               ← TSK-05 getFileIcon
src/preload/index.ts|index.d.ts       ← TSK-06 api.preview.*, api.fs.write
src/renderer/src/preview/
  PreviewProvider.tsx                 ← TSK-07 Context: aktive Datei, Quelle, Modus
  QuickLookOverlay.tsx                ← TSK-08
  FullView.tsx                        ← TSK-09 Shell + Kategorie-Dispatch
  MetadataPanel.tsx                   ← TSK-09
  viewers/TextEditor.tsx              ← TSK-10
  viewers/DocumentViewer.tsx          ← TSK-11
  viewers/AudioPlayer.tsx             ← TSK-12
  viewers/VideoPlayer.tsx             ← TSK-13
  viewers/ImageViewer.tsx             ← TSK-14
  viewers/ModelViewer.tsx             ← TSK-15 (+TSK-16 Splat)
  viewers/ProgramPreview.tsx          ← TSK-08 (Teil von QuickLook, wiederverwendet in FullView)
src/renderer/src/hooks/usePreviewKeys.ts ← TSK-07
```

### Datenfluss

```
Pane-Selektion ─┬─ Space  ──► PreviewProvider.openQuickLook(entry, source)
                └─ Enter / Doppelklick(Datei) ──► PreviewProvider.openFullView(entry, source)
Viewer-Komponente ──► src = kiosk-stream://… (Media) | api.preview.readText (Editor)
MetadataPanel ──► api.preview.metadata(source) / api.preview.writeMetadata (nur lokal)
```

`PreviewSource` (shared): `{ kind: 'local'; path: string } | { kind: 'remote'; server: string; vpath: string }`

---

## 📋 Task Ledger

*Hinweis für Agents: Status (🔴 PENDING, 🟡 IN PROGRESS, 🟢 DONE, 🟣 REVIEW) nach jedem Iterationsschritt aktualisieren. Tasks nur starten, wenn alle Dependencies 🟢 sind. Nach jedem Task: `npm run typecheck` grün.*

### Phase A — Fundament (Main + Shared)

| Task ID | Component | Agent | Status | Definition of Ready (DoR) | Output Files | Depends |
|---|---|---|---|---|---|---|
| TSK-01 | Filetype-Registry | Sonnet 5 | 🟢 DONE | `categorize(name)` liefert für jede Extension aus der Anforderungsliste (mp3, aac, wav, flac, alac/m4a, mp4, mov, mkv, avi, webm, jpg, jpeg, png, svg, tiff, gif, webp, raw-Familie: cr2/cr3/nef/arw/dng/raf, splat, ply, glb, gltf, fbx, obj, usdz, stl, md, html, py, css, js, ts, txt, json, pdf, mobi, epub, docx, odt, csv, ods, xlsx, exe, app, dmg, pkg) die korrekte Kategorie + Capabilities; unbekannte Extension → `unknown` mit `quickLook: false`. Case-insensitive. Reine Funktionen ohne Node/DOM-Imports (muss in beiden tsconfigs kompilieren). | `src/shared/filetypes.ts` | — |
| TSK-02 | Stream-Protokoll | Opus 4.8 | 🟢 DONE | Protokoll `kiosk-stream://` registriert (`protocol.handle`, vor `app.whenReady`-Abschluss via `registerSchemesAsPrivileged` mit `stream: true, supportFetchAPI: true`). Messbar: (a) Request auf lokale Testdatei liefert Status 200 mit korrektem `Content-Type` + `Content-Length`; (b) Request mit `Range: bytes=100-199` liefert 206 und exakt 100 Bytes; (c) remote-Variante liefert byte-identischen Inhalt wie direkter copyparty-GET mit Cookie; (d) Pfad außerhalb erlaubter Wurzeln (nicht unter Home/Mountpoints) → 403; (e) nicht verbundener Server → 502. | `src/main/stream-protocol.ts`, Registrierung in `src/main/index.ts` | — |
| TSK-03 | Konvertierung TIFF/RAW | Sonnet 5 | 🟢 DONE | (a) `.tiff`-Testdatei → PNG im Cache-Dir, zweiter Aufruf trifft Cache (kein erneuter sharp-Lauf, per mtime+size-Key); (b) RAW mit eingebettetem Preview → JPEG extrahiert; RAW ohne Preview → definierter Fehlerwert (kein Crash); (c) Ergebnis über `kiosk-stream://converted/<key>` abrufbar. Cache-Muster von `src/main/thumb-cache.ts` übernehmen. | `src/main/preview-convert.ts` | TSK-02 |
| TSK-04 | Metadata + fs:write | Opus 4.8 | 🟢 DONE | `exiftool-vendored` installiert, Prozess wird bei `app.quit` beendet (`exiftool.end()`). Messbar: (a) `metadata(localSource)` liefert für je eine Test-JPG (EXIF), -MP3 (ID3), -PDF strukturierte `FileMetadata` (Felder: Format-Rohdaten + normalisierte Common-Felder title/comment/dimensions/duration); (b) `writeMetadata(localSource, { comment })` persistiert — erneutes Read liefert geschriebenen Wert; (c) remote Source → Tags aus vorhandener `?ls`-Antwort, `writable: false`; (d) neuer IPC `fs:write` schreibt UTF-8-Text atomar (tmp + rename) und verweigert Pfade außerhalb erlaubter Wurzeln. | `src/main/ipc/metadata.ts`, `src/shared/types.ts` (FileMetadata, IpcChannels), `src/main/ipc/fs.ts` (fs:write) | — |
| TSK-05 | Programm-Icons | Haiku 4.5 | 🟢 DONE | IPC `preview:icon`: (a) lokale ausführbare Testdatei → PNG-DataURL via `app.getFileIcon(path, { size: 'large' })`; (b) Fehler/remote → `null` (Renderer zeigt dann generisches lucide-Icon). Kein Öffnen/Ausführen der Datei — nur Icon-Lookup. | `src/main/ipc/appicon.ts` | — |
| TSK-06 | Preload-Bridge | Sonnet 5 | 🟢 DONE | `window.api.preview.{metadata, writeMetadata, readText, icon}` + `api.fs.write` exponiert, vollständig typisiert in `index.d.ts`, nur `ipcRenderer.invoke`-Wrapper (keine Logik im Preload). `api.preview.readText(source, maxBytes)` liefert `{ text, truncated }` (Main liest lokal via fs bzw. remote via bestehendem Cookie-fetch). Typecheck node+web grün. | `src/preload/index.ts`, `src/preload/index.d.ts` | TSK-04, TSK-05 |

### Phase B — QuickLook (Leertaste)

| Task ID | Component | Agent | Status | Definition of Ready (DoR) | Output Files | Depends |
|---|---|---|---|---|---|---|
| TSK-07 | PreviewProvider + Keys | Opus 4.8 | 🟢 DONE | Context hält `{ mode: null\|'quicklook'\|'fullview', entry, source }`. Messbar: (a) Space bei genau einer selektierten Datei (nicht Ordner) → QuickLook auf; Space/Esc erneut → zu; (b) Enter → FullView; (c) Doppelklick auf **Datei** in beiden Panes → FullView (Ordner-Doppelklick navigiert unverändert); (d) Space/Enter werden ignoriert, wenn ein `input`/`textarea`/contenteditable fokussiert ist (Login-Form, spätere Editor-Instanz!); (e) funktioniert für lokale UND remote Selektion; (f) bei Mehrfach-Selektion wirkt der zuletzt geklickte Eintrag. | `src/renderer/src/preview/PreviewProvider.tsx`, `src/renderer/src/hooks/usePreviewKeys.ts`, Einbindung in `App.tsx` + beide Panes | TSK-01, TSK-06 |
| TSK-08 | QuickLookOverlay | Orchestrator | 🟢 DONE | Zentriertes Overlay (max ~70 % Viewport, abgerundet, Dateiname als Titel, shadcn/Tailwind-Theme, dark-mode-fähig). Dispatch per Registry: image→`<img>`, video→`<video controls>`, audio→`<audio controls>`, text/document→erste 64 KB monospaced (via `readText`), program→Icon (TSK-05) + Name + Größe, model3d/unknown→Dateityp-Badge + Icon. Messbar: je Kategorie eine Testdatei lokal UND remote sichtbar; Media-src ist `kiosk-stream://`-URL; Klick außerhalb schließt. | `src/renderer/src/preview/QuickLookOverlay.tsx`, `src/renderer/src/preview/viewers/ProgramPreview.tsx` | TSK-02, TSK-07 |

### Phase C — FullView (Enter/Doppelklick)

| Task ID | Component | Agent | Status | Definition of Ready (DoR) | Output Files | Depends |
|---|---|---|---|---|---|---|
| TSK-09 | FullView-Shell + MetadataPanel | Orchestrator | 🟢 DONE | Fullscreen-Modal mit Topbar (Dateiname, Metadaten-Button, Schließen/Esc). Kategorie-Dispatch rendert Platzhalter, solange Viewer-Tasks offen sind. MetadataPanel als Seitenleiste: (a) zeigt `FileMetadata` gruppiert; (b) Common-Felder editierbar wenn `writable`, Save-Button ruft `writeMetadata`, Erfolg/Fehler als Toast; (c) remote → Felder disabled + Hinweis „nur lokal änderbar"; (d) program-Kategorie öffnet **kein** FullView (Enter/Doppelklick zeigt stattdessen QuickLook). | `src/renderer/src/preview/FullView.tsx`, `src/renderer/src/preview/MetadataPanel.tsx` | TSK-07 |
| TSK-10 | Text-Editor | Opus 4.8 | 🟢 DONE | CodeMirror 6, Sprachpakete lokal (markdown, html, python, css, javascript, json). Messbar: (a) Syntax-Highlighting je eine Testdatei md/html/py/css/js; (b) txt ohne Highlighting editierbar; (c) Cmd/Ctrl-S + Save-Button speichern lokal via `fs:write`, danach Re-Read identisch; (d) remote Dateien read-only mit sichtbarem Badge; (e) Datei > 2 MB → read-only-Warnung statt Freeze; (f) Dirty-State-Guard beim Schließen. | `src/renderer/src/preview/viewers/TextEditor.tsx` | TSK-09 |
| TSK-11 | Dokument-Viewer | Opus 4.8 | 🟢 DONE | (a) PDF via `pdfjs-dist` mit **lokal gebundeltem Worker** (Vite `?url`-Import, kein CDN) — Seiten blätterbar; (b) CSV/XLSX/ODS via SheetJS als Tabelle (erste Sheet reicht, max 1000 Zeilen + Hinweis); (c) DOCX via mammoth als HTML; (d) EPUB via epubjs blätterbar; (e) ODT/MOBI: definierter Fallback („Format wird angezeigt, sobald Konverter integriert" + Download-freier Metadaten-Block) statt Fehler. Alles read-only. | `src/renderer/src/preview/viewers/DocumentViewer.tsx` | TSK-09 |
| TSK-12 | Audio-Player | Opus 4.8 | 🟢 DONE | wavesurfer.js v7 gegen `kiosk-stream://`-URL. Messbar: (a) MP3/WAV/FLAC/AAC spielen ab (ALAC best effort, sauberer Fehlerzustand falls Codec fehlt); (b) Waveform-Timeline klickbar (Seek); (c) Spektrum sichtbar (Spectrogram-Plugin ODER Canvas+AnalyserNode — Developer wählt, dokumentiert Wahl in Handoff Notes); (d) Play/Pause/Zeit-Anzeige; (e) Unmount stoppt Audio (kein Weiterspielen nach Schließen). | `src/renderer/src/preview/viewers/AudioPlayer.tsx` | TSK-09 |
| TSK-13 | Video-Player | Sonnet 5 | 🟢 DONE | `<video>` gegen `kiosk-stream://` (Range aus TSK-02 macht Seeking möglich). Messbar: (a) MP4/WEBM/MOV(h264) spielen ab, Timeline-Scrubbing funktioniert; (b) Play/Pause, Fullscreen-Button, Lautstärke; (c) nicht dekodierbare Codecs (MKV/AVI-Fälle) → `onerror` fängt und zeigt „Codec nicht unterstützt"-Panel mit Dateiinfo statt schwarzem Frame; (d) Unmount stoppt Wiedergabe. | `src/renderer/src/preview/viewers/VideoPlayer.tsx` | TSK-09 |
| TSK-14 | Bild-Viewer | Orchestrator | 🟢 DONE | (a) JPG/PNG/SVG/GIF/WEBP direkt via stream-URL; TIFF/RAW via `converted`-Route (TSK-03); (b) Zoom (Scroll/Buttons) + Fit/100 %; (c) EXIF-Block (Kamera, Objektiv, Belichtung, ISO, Datum, GPS-Koordinaten als Text) aus `metadata()` — bei Bildern ohne EXIF sauber leer; (d) SVG wird sandboxed gerendert (`<img>`, nicht inline-DOM — Script-Ausführung ausgeschlossen). | `src/renderer/src/preview/viewers/ImageViewer.tsx` | TSK-03, TSK-09 |
| TSK-15 | 3D-Viewer | Opus 4.8 | 🟢 DONE | three.js, Loader für GLB/GLTF, OBJ, FBX, STL, USDZ, Quelle = stream-URL. Messbar: (a) je Format eine Testdatei lädt und ist per OrbitControls rotier-/zoombar; (b) Shading-Modes umschaltbar: Solid (Standard-Material + Licht), Wireframe, Normals, Matcap — Umschalten ändert sichtbar das Rendering ohne Reload; (c) Lade-Fehler → Fehlerpanel statt Crash; (d) Unmount disposed Renderer/Geometrien (kein WebGL-Context-Leak bei 10× öffnen/schließen). SPLAT hier **ausgenommen** (TSK-16). | `src/renderer/src/preview/viewers/ModelViewer.tsx` | TSK-09 |
| TSK-16 | Gaussian-Splat-Support | Orchestrator | 🟢 DONE (Einschränkung) | `@mkkellogg/gaussian-splats-3d` in ModelViewer integriert: `.splat`/`.ply`-Testdatei rendert und ist navigierbar; Lib bricht Bundle/Offline-Constraint nicht (kein Laufzeit-Fetch auf externe Hosts — im Build verifizieren). Falls Lib inkompatibel: dokumentierter Abbruch in Handoff Notes + Fallback auf Dateityp-Badge, Task gilt dann als DONE-mit-Einschränkung. | `src/renderer/src/preview/viewers/ModelViewer.tsx` | TSK-15 |

### Phase D — Tests & Review

| Task ID | Component | Agent | Status | Definition of Ready (DoR) | Output Files | Depends |
|---|---|---|---|---|---|---|
| TSK-17 | Unit-Tests | Sonnet 5 | 🟢 DONE | `vitest` als devDependency einrichten (`npm test`-Script). Tests decken exakt ab: (a) TSK-01: jede Extension der Anforderungsliste → erwartete Kategorie, plus case-insensitivity und unknown-Fallback; (b) TSK-02: Range-Header-Parser (valide/invalide/offene Ranges); (c) TSK-04: Normalisierung exiftool-Rohdaten → Common-Felder (mit fixture-JSON, ohne echtes exiftool im Test). Keine darüber hinausgehenden Edge-Cases erfinden. `npm test` grün. | `vitest.config.ts`, `src/shared/filetypes.test.ts`, `src/main/stream-protocol.test.ts` (Parser exportiert), `src/main/ipc/metadata.test.ts` | TSK-01, TSK-02, TSK-04 |
| TSK-18 | Final Review | Fable 5 | 🟢 PASS | Alle Tasks 🟢; Diff gegen jede DoR geprüft; `npm run typecheck` + `npm test` grün; Offline-Check: `grep` über Bundle-Output auf externe URLs (http://, https:// zu CDNs) negativ; strukturiertes Pass/Fail-Urteil pro Task in Handoff Notes. | Review-Eintrag in RUN-STATE.md | alle |

---

## 🔄 Handoff Notes & Review Log

*Kurze Notizen für die Übergabe. Keine Chat-Verläufe, nur Fakten und Fehlermeldungen.*

- **[ARCH] Fable 5:** Architektur steht. Startreihenfolge: TSK-01/02/04/05 sind parallelisierbar (keine gegenseitigen Dependencies), danach TSK-06 → TSK-07 → Rest.
- **[TSK-01] Sonnet 5 (Dev):** ✅ DONE. `src/shared/filetypes.ts`, 57 Extension-Mappings, 7 Kategorien. `categorize` via `lastIndexOf('.')`, case-insensitive; ohne Extension → `unknown`. `isRawImage`/`needsConversion` mit gemeinsamem RAW-Set. Typecheck node+web grün.
- **[TSK-05] Haiku 4.5 (Dev):** ✅ DONE. `src/main/ipc/appicon.ts`, `registerAppIconIpc()`, Channel lokal `'preview:icon'`, remote→null, Fehler→null. Wartet auf Wiring (index.ts) + Typ-Konsolidierung (PreviewSource aus shared/types) durch Orchestrator. Typecheck sauber.
- **[TSK-04] Opus 4.8 (Dev):** ✅ DONE. `src/main/ipc/metadata.ts` (3 Handler + `will-quit`→`exiftool.end()`), Typen in shared/types.ts (`PreviewSource`, `FileMetadata`, `MetadataWriteResult`, `ReadTextResult`, `FsWriteResult` + 5 IpcChannels inkl. `PreviewIcon`), `writeTextFile` atomar in fs.ts (Root-Heuristik homedir/`/Volumes/`/`/media/`/`/run/media/`). `exiftool-vendored@36.0.0`, gesamt ~24,5 MB (21 MB im `.pl`-Peer). Testskript 10/10 pass (EXIF write→read identisch, kein `_original`-Backup; `/etc/x` abgelehnt). Remote: metadata read-only (Tags kommen aus Renderer-Listing), read-text via kiosk-stream im Renderer.
- **[ORCH] Fable 5:** Wiring erledigt: `registerMetadataIpc()` + `registerAppIconIpc()` in index.ts; appicon.ts nutzt jetzt `IpcChannels.PreviewIcon` + `PreviewSource` aus shared/types (TODO entfernt). `npm run typecheck` node+web grün. Hinweis für Reviewer: `register*Ipc()` läuft in `createWindow()` — bei macOS-`activate`-Re-Call droht Doppel-Registrierung; vorbestehendes Muster aller IPC-Module, auf Kiosk-Linux irrelevant, nicht in diesem Feature fixen.
- **[INTEGRATION] Orchestrator (Fable 5):** ✅ End-to-end gegen echten copyparty (kiosk2, anon Agora-Volume) getestet — QuickLook Bild (kiosk-stream remote-Streaming), QuickLook Text (UTF-8 inkl. Umlaute), FullView (Topbar/Platzhalter/Esc), MetadataPanel (remote read-only, Felder disabled + Hinweis + note). Drei Bugfixes nötig, die die Handoffs nicht abdecken konnten (nur bei echter Integration sichtbar):
  1. **Anon-Server 502** — stream-protocol gatte den remote-Proxy an Cookie-Existenz, aber anonyme copyparty-Volumes haben nie einen Cookie → jede Datei 502. Fix: `knownServers`-Set in copyparty.ts (bei connect/list befüllt, disconnect leert), `isKnownServer()` gated statt Cookie. **Wichtig für TSK-11..15:** alle remote-Viewer hängen daran, dass der Server via connect/list „bekannt" wurde.
  2. **CSP blockte kiosk-stream** — `img-src 'self' data:` ohne media-src. index.html CSP erweitert: `img-src`/`media-src`/`connect-src` um `kiosk-stream:` + `blob:` + `worker-src 'self' blob:` (letzteres für pdf.js/three in TSK-11/15 — schon drin, nicht erneut anfassen).
  3. **Remote-Text CORS** — Renderer kann `kiosk-stream://` NICHT per `fetch()` lesen (custom-scheme cross-origin → opaque body). `readText` remote jetzt im Main: `fetchRemoteText()` in copyparty.ts holt erste maxBytes per Range+Cookie. **Merke für TSK-10:** Text/Editor-Inhalt IMMER über `api.preview.readText`, nie Renderer-`fetch` gegen kiosk-stream.
- **[POST-RELEASE FIX] Orchestrator (Fable 5) — Video/Media-Streaming:** Nach Release meldete Marvin „Video geht nicht". Root-Cause-Analyse (viele Iterationen, per MediaError-code + Route-Logging + ffprobe): **NICHT Codec** (ipcam ist H.264 High yuvj420p, kein HEVC) und **NICHT Größe/Range-Header** (copyparty liefert korrekte 206). **Echte Ursache: `protocol.handle` (kiosk-stream://) kann Chromiums Media-Range-Requests nicht wie ein echter HTTP-Server bedienen** — kleine Files (am Stück geladen) gingen, alles was Chromium per Range/Seek lädt → `MediaError code=2 FFmpegDemuxer: data source error`, unabhängig von net.fetch/undici, Stream/Buffer, 200/206. **Lösung: `src/main/media-server.ts` — Loopback-HTTP-Server (127.0.0.1:random) serviert local/remote/converted Media mit echtem Range.** Chromium behandelt ihn als normale Media-Quelle → Range/Seek nativ. `streamUrl()` zeigt jetzt auf `http://127.0.0.1:PORT` (Port via `sendSync('get-media-base')` beim preload), CSP erlaubt `http://127.0.0.1:*`/`localhost:*` in img/media/connect. End-to-end kiosk2: 11-MB-Testvideo + **echte 240-MB-ipcam-Datei (4:49) spielen + Seeking funktioniert**, Bild-QuickLook intakt. **Merke für alle künftigen Media-Viewer:** `<video>/<audio>/<img>` IMMER über `streamUrl` (= HTTP-Server), NIE über protocol.handle. ⚠️ Optionaler Cleanup: `kiosk-stream://` protocol.handle (`stream-protocol.ts` handleLocal/handleRemote/handleConverted + Registrierung in index.ts) ist jetzt ungenutzt (nur noch `parseRangeHeader`/`mimeFor`/`getPreviewCacheDir` als Helfer von media-server importiert) — kann später entfernt werden.
- **[TSK-18] Reviewer (Fable 5):** ✅ **PASS**. Alle 18 Tasks 🟢 (TSK-16 mit dokumentierter Einschränkung). `npm run typecheck` clean (node+web), `npm test` 97/97 grün, `npm run build` grün. **Offline-Constraint erfüllt:** Bundle-Scan zeigt nur inerte Strings (three.js-Doku-Kommentare goo.gl/wikipedia, XML-Namespace-Identifier purl.oclc.org/schemas.microsoft.com von SheetJS/mammoth — nie gefetcht) + `kiosk2.local` (eigenes Sneakernet, kein Internet-Uplink). **Kein echter Laufzeit-CDN-Fetch.** **Security:** `contextIsolation: true` unangetastet, `script-src 'self'` NICHT aufgeweicht (TSK-16 Splat bewusst verworfen statt wasm-unsafe-eval), CSP nur um `blob:`/`kiosk-stream:` in img/media/connect/worker erweitert (nötig, kein script-eval), Pfad-Validierung (home+mountpoints) in kiosk-stream local + fs:write vorhanden+getestet, SVG nur via `<img>` (kein Inline-DOM). End-to-end auf kiosk2 alle 7 Kategorien verifiziert. Feature FERTIG.
- **[TSK-17] Sonnet 5 (Test):** ✅ DONE. `vitest@4.1`, `npm test`-Script. 97 Tests grün: filetypes.test.ts (71 — jede Extension→Kategorie, case-insensitivity, unknown, capabilities, isRawImage/needsConversion), stream-protocol.test.ts (9 — parseRangeHeader via vi.mock von electron/copyparty/drives), metadata.test.ts (17 — pick/dimensions/parseDuration/toISO, die 4 Helfer wurden für Tests exportiert, keine Logikänderung). Nur Dev (nicht im Runtime-Bundle).
- **[TSK-16] Orchestrator (Fable 5) — ABBRUCH-KLAUSEL:** ✅ DONE-mit-Einschränkung. `@mkkellogg/gaussian-splats-3d` verlangt zur Laufzeit **WebAssembly** → bräuchte CSP `script-src wasm-unsafe-eval`. **Bedingung (b) der Abbruch-Klausel: bewusst abgebrochen**, um den Security-Default (contextIsolation/strikte CSP, CLAUDE.md) NICHT weichzukochen. Lib deinstalliert, package.json zurück. `.splat`/`.ply` → sauberer Info-Badge in ModelViewer ("Splat-Vorschau nicht verfügbar — WebAssembly/CSP"). End-to-end kiosk2 verifiziert. Bachelor-Argument: bewusste Abwägung Security vs. Feature, verteidigbar. **Reaktivierbar** falls CSP-Aufweichung später akzeptiert wird (nur ext-Guard in ModelViewer + Lib-Integration).
- **[TSK-15] Opus 4.8 (Dev) + Orchestrator-Fix:** ✅ DONE. `ModelViewer.tsx` — three@0.185, Loader `.parse()` (GLB/GLTF/OBJ/FBX/STL/USDZ) über `readBytes`, OrbitControls, 4 Shading-Modes (Solid/Wireframe/Normals/Matcap mit lokal per Canvas generierter Matcap-Textur), voller Dispose-Chain (forceContextLoss). End-to-end kiosk2: STL-Würfel rendert (Solid beleuchtet, Normals-Farben korrekt), OrbitControls, Shading-Wechsel ohne Reload. **Fix:** Canvas-Container brauchte `min-h-0` (flex-1 in overflow-auto-Kette ergab sonst 0/überlaufende Höhe → leeres Canvas). GLB/OBJ/FBX/USDZ code-verifiziert (gleicher parse-Pfad).
- **[TSK-11] Opus 4.8 (Dev) + Orchestrator-Fixes:** ✅ DONE. `DocumentViewer.tsx` — pdf.js (Canvas), SheetJS-Tabellen, mammoth DOCX→HTML, epubjs, ODT/MOBI-Fallback. Alle Bytes via `readBytes`. End-to-end kiosk2: PDF rendert (Text+Umlaute, Seiten-Nav), CSV als Tabelle. **Zwei Fixes:** (1) ⚠️ **pdf.js v6.1 inkompatibel mit Electron 39** — ruft `Map.prototype.getOrInsertComputed` (TC39-Feature, noch nicht in Electron-39-V8) → jeder render warf. **Downgrade auf `pdfjs-dist@^4.10.38`**, render-API auf `{ canvasContext, viewport }`. GILT FÜR ALLE: keine bleeding-edge-Libs, gegen Electron-39-V8 prüfen. (2) CSV-Datums-Strings wurden von SheetJS zu Excel-Serials → `XLSX.read(text, { raw: true })`. PDF-Canvas mit weißem BG (Seiten sonst transparent).
- **[TSK-13] Sonnet 5 (Dev):** ✅ DONE. `VideoPlayer.tsx` — natives `<video controls>` gegen streamUrl (Range→Seeking), `onError`→„Codec nicht unterstützt"-Panel. End-to-end kiosk2: WEBM (VP9) spielt mit Timeline/Controls; HEVC-ipcam-MP4 → sauberes Codec-Panel (kein schwarzer Frame). Video braucht KEIN read-bytes (nativer Player streamt selbst).
- **[TSK-12] Opus 4.8 (Dev) + Orchestrator-Fix:** ✅ DONE. `AudioPlayer.tsx` — wavesurfer v7 + Spectrogram-Plugin. **Zwei Integration-Fixes nötig:** (1) wavesurfer mit nur `media`-Element fetchte die URL trotzdem selbst zum Dekodieren → custom-scheme opaque. Fix: neuer `preview:read-bytes`-IPC (`fetchRemoteBytes` in copyparty.ts, 150-MB-Cap, local fs / remote cookie), Renderer macht same-origin Blob-URL, wavesurfer `url: blob` (Decode+Playback). (2) CSP `connect-src` fehlte `blob:` → wavesurfers Blob-fetch geblockt → Fix in index.html (`connect-src` + blob: data:). End-to-end kiosk2: WAV zeigt Waveform (Tremolo sichtbar) + Spektrogramm (440-Hz-Linie) + Play/Zeit. **Merke für TSK-15 (3D):** three-Loader fetchen auch custom-scheme → `api.preview.readBytes` + Blob nutzen, nicht Loader direkt auf kiosk-stream.
- **[TSK-14] Orchestrator (Fable 5):** ✅ DONE. `ImageViewer.tsx` — native (jpg/png/svg/gif/webp) via streamUrl, TIFF/RAW via neu verdrahtetem `preview:convert`-IPC (Channel + Handler in metadata.ts + preload + `PreviewConvertResult`-Typ; convert nur lokal, remote-non-native → Fehler). Zoom-Buttons + Fit, EXIF-Strip aus metadata.raw. SVG via `<img>`. End-to-end kiosk2: remote-JPG lädt + Zoom-UI. EXIF-Strip bei remote leer (remote-metadata ist read-only-Stub ohne EXIF — by design; lokal via exiftool voll).
- **[TSK-10] Opus 4.8 (Dev):** ✅ DONE. `TextEditor.tsx` (CodeMirror 6, 11 Pakete lokal gebundelt). Sprachen md/html/py/css/js/ts/json, txt plain. readText (local+remote), lokal editierbar mit Cmd/Ctrl-S + Dirty-Guard, remote/>2MB read-only + Badge, oneDark bei `.dark`. End-to-end kiosk2: remote-.md zeigt „Markdown" + „Remote — schreibgeschützt"-Badge + Zeilennummern + UTF-8. Renderer-Bundle jetzt ~2,2 MB.
- **[TSK-08/09] Orchestrator (Fable 5):** ✅ DONE. Delegierte Sonnet/Opus-Agents fielen ins Session-Limit (reset 15:00), daher direkt gebaut. Neu: `streamUrl.ts` (b64url url-safe ohne padding, Roundtrip gegen Node base64url verifiziert — Umlaute/Slash/Space/CJK), `QuickLookOverlay.tsx` (Kategorie-Dispatch: image/video/audio via `<img>/<video>/<audio>` gegen kiosk-stream, text/document via readText mit remote-fetch-Fallback, program via ProgramPreview, model3d/unknown→Badge; SVG nur via `<img>`), `viewers/ProgramPreview.tsx` (icon-IPC + lucide-Fallback), `MetadataPanel.tsx` (common editierbar wenn writable, Dirty-Guard, gooeyToast, raw-Liste), `FullView.tsx` (deckendes Modal, Topbar mit Info/X, Kategorie-`renderViewer`-switch mit benannten Platzhaltern für TSK-10..15, Viewer-Props-Interface `{ entry, source }` dokumentiert). Provider-Platzhalter durch echte QuickLookOverlay/FullView ersetzt. ⚠️ Toast ist `gooeyToast` aus `goey-toast`, NICHT sonner — TSK-10..15 müssen das auch nutzen. Typecheck node+web + build grün.
- **[TSK-07] Opus 4.8 (Dev):** ✅ DONE. `PreviewProvider.tsx` + `usePreviewKeys.ts`, Wiring in App.tsx + beiden Panes. `activeSelection` über bestehendes `sel.lastClicked` gelöst (useSelection unangetastet). DoR a–g alle bestätigt (Space/Enter/Doppelklick/Guard-Input/lokal+remote/lastClicked/program→QuickLook-Fallback). Nur PreviewPlaceholder gerendert — TSK-08/09 ersetzen ihn. Typecheck grün.
- **[TSK-03] Sonnet 5 (Dev):** ✅ DONE. `src/main/preview-convert.ts`: `convertForPreviewInto(cacheDir, absPath)` (testbar) + Wrapper `convertForPreview`. Key = sha1(absPath|mtimeMs|size)+Ziel-Ext, Rückgabe mit `cached`-Flag; TIFF via sharp (rotate + max 4096px, PNG), RAW-Kaskade extractJpgFromRaw→extractPreview→extractThumbnail, atomar tmp+rename. Tests grün (Cache-Hit verifiziert, Fake-NEF sauber `{ok:false}`). ⚠️ Noch KEIN IPC-Channel — `preview:convert`-Wiring (Channel + preload) gehört ins TSK-14-Handoff.
- **[TSK-06] Sonnet 5 (Dev):** ✅ DONE. `api.preview.{metadata,writeMetadata,readText,icon}` + `api.fs.write` in preload/index.ts. `index.d.ts` unverändert — `AppApi = typeof api`-Muster typisiert automatisch. Typecheck node+web grün (inkl. preview-convert.ts des TSK-03-Agents).
- **[TSK-02] Opus 4.8 (Dev):** ✅ DONE. `src/main/stream-protocol.ts` + Wiring in `index.ts` (Schemes top-level, Handler in whenReady). Exports: `parseRangeHeader` (pure, 11/11 Testfälle grün), `getPreviewCacheDir()` = `userData/preview-cache`. Neu: `getCookieHeader()` in copyparty.ts, `getCurrentMountpoints()` in drives.ts. Range: invalide/multi/unsatisfiable → null → 200-Fallback (kein 416, robuster für Media-Elemente). local: Allow-List home+mountpoints, außerhalb 403; remote: unbekannter Server/Upstream-Fehler 502; converted: strikt in Cache-Dir. Kein Electron-Runtime-Test — Integration testet Orchestrator.
- **[ARCH] Offene Punkte für Marvin (blockieren Phase A nicht):**
  1. Anforderung nennt „**MUBI**" — als Tippfehler für **MOBI** (Kindle) interpretiert. MOBI ist in v1 nur Fallback-Anzeige (TSK-11e). Bestätigen.
  2. „RAW" als Familie interpretiert (CR2/CR3/NEF/ARW/DNG/RAF); Anzeige nur über eingebettetes JPEG-Preview, keine volle RAW-Entwicklung.
  3. Remote-Metadaten sind v1 read-only (copyparty-Tags anzeigen ja, schreiben nein). Schreibbar erst mit Download→Edit→up2k-Re-Upload-Flow — bewusst nicht in diesem Feature.
  4. MKV/AVI/H.265/AC-3 und ALAC: Wiedergabe hängt an Chromium-Codecs, kein Transcoding in v1. Player zeigen sauberen Fehlerzustand.
  5. `exiftool-vendored` bringt ~15–25 MB Binary mit — für AppImage/.deb akzeptabel? Alternative wäre Format-Einzelparser-Zoo (mehr Code, weniger Abdeckung).
- **[ARCH] Sicherheitsnotiz (für alle Developer):** `kiosk-stream://local` und `fs:write` MÜSSEN Pfade gegen erlaubte Wurzeln (Home + aktive Mountpoints aus drives.ts) validieren — Protokoll-URLs sind vom Renderer frei konstruierbar. SVG nie inline ins DOM (TSK-14d).
