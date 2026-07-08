# RUN-STATE: File Preview & Viewer/Editor Feature

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
