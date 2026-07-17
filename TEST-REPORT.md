# TEST-REPORT — Anforderungs-Verifikation 2026-07-09/10

Echte Tests auf den drei Kiosken durch 4 Subagents (10-80-10):
**VER-A** Backend/API (kiosk2, SSH) · **VER-B** Viewer/Metadaten (kiosk2, UI via xdotool+scrot) · **VER-C** Sort/Suche (kiosk1, UI) · **VER-D** DnD/ZIP-Expand (kiosk3, UI, DnD real per xdotool).
**DVD/Burn (#1 optisch, #4 Brennen) ausgeklammert — testet Marvin selbst am Gerät.**
Regel des Runs: nur dokumentieren, **nichts gefixt**. Alle Testartefakte (Dateien, copyparty-Uploads, Stats-Events, simulierte Laufwerke) aufgeräumt, Apps laufen normal weiter.

## Ergebnis pro Anforderung

| # | Anforderung | Ergebnis | Beweis (Kurzform) |
|---|---|---|---|
| 1 | Dateien von USB + CD/DVD anzeigen | ⚠️ **USB PASS (Hot-Plug-Vorbehalt)** · **DVD FAIL — App zeigt Disc nie an** (2026-07-10 mit echtem Laufwerk + Daten-DVD getestet) | USB: lokale Pane rendert removable Drive korrekt. **DVD:** HW+OS ok (Laufwerk erkannt, Disc lesbar, Auto-Mount jetzt eingerichtet) — aber App zeigt sie nicht, weil `drivelist` `/dev/sr*` strukturell herausfiltert → Finding **F8** (Blocker für DVD-Browse UND Burn-Erkennung). Hot-Plug-Vorbehalt USB → F2 |
| 2 | Dateien auf Agora anzeigen | ✅ **PASS** | `?ls` Root + Unterordner valides JSON; Remote-Pane zeigt Listing; Remote-Öffnen/Streaming funktioniert |
| 3 | Sortieren nach Name/Größe/Datum/Format | ✅ **PASS (vollständig)** | Alle 4 Felder + beide Richtungen korrekt, dirs-first bleibt immer, Sort überlebt Ordnerwechsel, funktioniert in **beiden** Panes (remote inkl. Größe/Richtung geprüft) |
| 4 | Drag'n'Drop auf anderes Medium | ✅ **PASS** (local→remote UND remote→local) / Burn nicht getestet (Marvin) | Echtes xdotool-DnD; md5 serverseitig bzw. lokal identisch; Transfer-Events feuerten korrekt (up/1 … down/1) |
| 5 | Dateien öffnen/abspielen | ⚠️ **PASS mit 2 QuickLook-Bugs** | FullView: alle Kategorien PASS lokal (JPG+EXIF+Zoom, PNG, TIFF-Konvert, SVG, MD/CodeMirror, MP3 Waveform+Spektrogramm, MP4 spielt, PDF blätterbar, CSV-Tabelle, DOCX-Text, STL rotierbar + 4 Shading-Modi, EXE bleibt korrekt QuickLook) und remote (JPG/MD/MP4). **QuickLook von PDF und DOCX zeigt aber Roh-/Binärmüll** → F1 |
| 6 | Metadaten anzeigen + editieren | ✅ **PASS lokal + remote** | Lokal: Kommentar geschrieben, per exiftool auf Disk verifiziert. Remote: Download→exiftool→PUT-Flow, Kommentar serverseitig verifiziert. Remote-Text-Editor (Ctrl+S, WebDAV PUT) ebenfalls serverseitig verifiziert. Kleiner Handle-Leak → F4 |
| 7 | Zähler USB-Sticks / CDs | ⚠️ **PASS (Pipeline + App-Trigger), echter Stecktest offen** | `POST /event` → `/stats`-Aggregation exakt spec-konform (usb/disc +1, invalid kind → 400). App-seitiger Trigger real belegt: simuliertes removable Drive feuerte `usb_connected` aus dem laufenden Main-Process. Offen: Stecktest mit physischem Stick (scsi_debug ≠ echter udev-Pfad) |
| 8 | WiFi-Geräte verbunden + jemals | ✅ **PASS** | `/stats`: live=13, ever=28, peak=16 (plausibel, ever≥live); poller+server-Units aktiv, 60s-Samples laufen |
| 9 | GB übertragen + Dateizahl, sortierbar nach Format | ⚠️ **PARTIAL — GB pro Format fehlt strukturell** | GB gesamt ✅ (`traffic_bytes` ~11 GB, Interface-Aggregat). Dateizahl ✅ (+3 bei transfer-Event). Format-**Anzahl** ✅ (`by_ext` korrekt aggregiert/sortiert). **GB pro Format ❌:** `events`-Schema hat kein Bytes-Feld (nur `files` + `exts_json`) → mit aktuellem Schema nicht erfüllbar |
| 10 | Nach Dateinamen suchen | ✅ **PASS lokal UND remote** | Lokal: rekursiv ab Pane-Root, case-insensitiv, Unterordner-Treffer mit relPath, leere Query/kein Treffer sauber. **Remote-Suche existiert entgegen Doku-Stand und funktioniert** (`?srch`, live gegen copyparty verifiziert). Kosmetik → F5 |
| 11 | Ordner/ZIPs kopieren → als Einheit entpackt | ✅ **PASS (alle 5 Semantik-Fälle)** | Ordner landet als EIN intakter Ordner (Struktur + md5 identisch); single-root-ZIP kollabiert zu `game/`; ZIP ohne Root → ein Ordner nach ZIP-Basename; Kollision → `„… (2)"`; keine Doppel-Nestung |

**Repo-Gesundheit:** `npm run typecheck` grün (node+web), `npm test` 102/102 grün.

## Findings (dokumentiert, NICHT gefixt)

| ID | Schwere | Fund | Ort/Details | Quelle |
|---|---|---|---|---|
| F1 | 🔴 mittel | **QuickLook zeigt PDF als Roh-Quelltext und DOCX als ZIP-Binärmüll (Mojibake).** FullView rendert beide korrekt — QuickLook behandelt Binär-Dokumente als Text | `QuickLookOverlay.tsx` (document-Kategorie → readText-Pfad) | VER-B |
| F2 | 🔴 mittel | **Hot-Plug-Lücke im Drive-Poller:** `tick()` feuert Added/Removed nur bei Geräte-ID-Änderung; erscheint der **Mountpoint** erst nach der Erkennung (langsames Auto-Mount), gibt es kein Update → lokale Pane bleibt bis App-Neustart unsichtbar. Zweifach unabhängig beobachtet (kiosk2 + kiosk3). Vorbehalt: mit echtem USB-Stick gegenprüfen (scsi_debug-udev-Pfad weicht ggf. ab) | `src/main/ipc/drives.ts` (`tick()`) | VER-B + VER-D |
| F3 | 🟡 klein | **Escape schließt Video-FullView nicht**, wenn `<video>` den Fokus hat (Taste geht ans Element); nur X-Button schließt. Inkonsistent zu allen anderen Viewern | `VideoPlayer.tsx` / `FullView.tsx` Key-Handling | VER-B |
| F4 | 🟡 klein | **File-Handle-Leak nach lokalem Metadaten-Write:** Electron hält Handle auf gelöschten alten Inode (`lsof: DEL`), blockierte im Test den Unmount des Sticks | exiftool-Schreibpfad, `src/main/ipc/metadata.ts` | VER-B |
| F5 | ⚪ kosmetisch | Fußzeile zeigt während lokaler Suche weiterhin cwd-Item-Zähler statt Trefferzahl | `FileBrowserPane.tsx` | VER-C |
| F6 | 🟠 Anforderungslücke | **#9 „GB sortierbar nach Format" strukturell nicht erfüllbar:** `events`-Tabelle trackt keine Bytes pro Transfer/Extension; `traffic_bytes` ist Interface-Gesamtaggregat. Bräuchte Schema-Erweiterung (bytes-Feld) + Event-Payload + /stats-Aggregation | `agora-dashboard/poller.py`/`server.py`, `agora-events` | VER-A |
| F7 | ⚪ Doku | Memory/CLAUDE.md veraltet: Remote-Suche (#10) ist implementiert und funktioniert; lokale Pane rootet am USB-Mount (nicht Home) | Doku, kein Code | VER-A/C/B |
| F8 | 🔴 **Blocker DVD** | **App zeigt eingelegte DVD nie an** — `drivelist` (Lib hinter `drives.ts`) filtert `/dev/sr*` auf Linux hart heraus, BEVOR der App-Filter greift. Verifiziert 2026-07-10 mit echtem USB-DVD-Writer (Optiarc AD-7710H) + Daten-DVD (UDF, Label „Bläserklasse") auf kiosk2: `drivelist.list()` liefert nur sda/sdb, sr0 fehlt trotz sauberem Mount `/media/marvin/Bläserklasse`. Der gesamte `isOptical`/`burnDrive`/`dataDrive`-Code (drives.ts + App.tsx) läuft auf Linux daher **nie** an. Kein Bug im Projektcode — Fremdlib-Grenze (drivelist=Etcher/balena, DVDs bewusst außen vor). **Fix = Architektur-Entscheidung:** eigener Optical-Detector (lsblk/udev auf `/dev/sr*`) parallel zu drivelist + Merge in drives.ts; ODER drivelist forken. **Betrifft #1 DVD-Browse UND #4 Burn-Erkennung.** Codestelle: `node_modules/drivelist/js/lsblk/json.js:65-68` (`!device.name.startsWith('/dev/sr')`) | `src/main/ipc/drives.ts` (`snapshot()`/`isOpticalDrive`), drivelist-Lib | Marvin-Test 2026-07-10 |

### F8-Nebenbefund: Auto-Mount fehlte auf kiosk2 (behoben, Infra)
Unabhängig von F8: kiosk2 hatte keinen Auto-Mount-Stack (im Gegensatz zu kiosk1). Eingerichtet 2026-07-10 (reine Infra, kein App-Code): `udisks2`+`udiskie`+`polkitd` per apt installiert, `udiskie --no-tray --no-notify &` in `~/.config/openbox/autostart` ergänzt (Backup: `autostart.bak-2026-07-10`). Caveat: `udisks2` cacht „polkit unavailable" für die Prozess-Lebensdauer — nach polkit-Reparatur `systemctl restart udisks2` nötig. Auto-Mount jetzt verifiziert: DVD → `/media/marvin/Bläserklasse` (ro, uid marvin). Selbe Einrichtung fehlt vermutlich auch auf kiosk3.

## Offene manuelle Tests (Marvin am Gerät)

1. **DVD-Browse (#1):** blockiert durch **F8** — erst App-Code für Optical-Detection nötig, dann browsen + zur Agora kopieren testbar.
2. **DVD-Burn (#4):** xorriso vorher offline installieren (auf keinem Kiosk vorhanden). Burn-Zone-Erkennung hängt ebenfalls an F8 (leerer Rohling = `/dev/sr0` ohne Mount, wird von drivelist genauso verschluckt).
3. **Echter USB-Stecktest:** Zähler +1 im Panel UND ob lokale Pane ohne Neustart erscheint (klärt F2 endgültig).
