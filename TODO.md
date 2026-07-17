# TODO — offene Punkte (Stand 2026-07-16, Audio-CD-Update)

Abgleich gegen Marvins Anforderungsliste ([[kiosk-requirements]] Memory, 2026-07-06) + Session-Nachträge. Details/Kontext siehe git log.

## Offen aus der Anforderungsliste

- **#9 Transfer-Statistik unvollständig** — **DONE**. GB gesamt, Dateianzahl und Aufschlüsselung nach Format inklusive der jeweiligen Byte-Größen sind nun in Event-Schema, Datenbank und Agora-Stats-Panel integriert.

## Burn-Feature (DVD brennen)

- xorriso ist auf kiosk2 + kiosk3 installiert (Blocker von damals weg), aber **kein einziger echter Brennvorgang wurde verifiziert**. Kompletter Pfad (`cdburn.ts`, `OpticalDropZone.tsx`, `BurnDialog.tsx`) ungetestet mit echter Disc. Nächster sinnvoller offener Punkt.

### Geplant: Video-DVD-Autoring bei Einzel-Videodatei

- Marvins Anforderung (2026-07-17): Wenn nur eine einzelne Videodatei zum Brennen ausgewählt ist, soll ein Pop-up nach Klick auf „Brennen" die Wahl geben: **echte Video-DVD** (im DVD-Player abspielbar) vs. **Daten-DVD** (aktuelles Verhalten, Datei 1:1).
- Umfang (noch nicht begonnen):
  - Neues Backend-Modul (analog `cdrip.ts`/`cdburn.ts`): `ffmpeg -target pal-dvd` transcodiert zu DVD-konformem MPEG-2/AC3 (PAL fest, kein NTSC — Agora ist europäisch), dann **`dvdauthor`** (neues apt-Paket, baut VIDEO_TS-Struktur), dann **`growisofs`** aus `dvd+rw-tools` (neues apt-Paket, brennt DVD-Video-kompatibel — xorriso allein reicht dafür nicht zuverlässig).
  - 3-Stufen-Progress (Transcode-% → Autoring → Brenn-%), neue Types/IPC/preload-Gruppe.
  - Single-Video-Erkennung + Pop-up-Choice in `BurnDialog`/`OpticalDropZone`.
  - Tests für die reinen Parser (ffmpeg-`time=`-Progress, growisofs-Progress).
- **Risiko/Aufwand höher als beim Audio-CD-Feature:** baut auf dem selbst noch unverifizierten Daten-Brennpfad auf; echter Transcode einer Spielfilmlänge dauert mehrere Minuten (E2E-Test kostet echte Wartezeit, kein Shortcut wie beim Audio-Rip); growisofs-DVD-Video-Burning hat bekannte Eigenheiten (Padding, Layer-Break bei Dual-Layer), nur mit echter Disc verifizierbar.
- Grobe Schätzung (Vergleich Audio-CD-Feature als Maßstab): ähnliche oder etwas größere Größenordnung an Subagent-Durchläufen, deutlich mehr Wartezeit wegen echtem Transcode.

## Admin-Panel

- Host-Wechsel nutzt jetzt **dasselbe Passwort wie der Session-Reset** (eine Datei `~/.agora/admin.hash`, die auch das Dashboard prüft — kein zweites Passwort mehr zu pflegen).
- ✅ **kiosk2** hat `~/.agora/admin.hash` (aus dem originalen setup-main.sh-Prompt, 2026-07-06).
- ✅ **kiosk3** hat `~/.agora/admin.hash` jetzt auch gesetzt (2026-07-16). Beide Kioske erledigt.

## kiosk1

- Bleibt bewusst aus. Wenn er dazukommt, fehlt komplett:
  - WLAN-Setup (wpasupplicant, iw powersave off, dup-wpa disable)
  - Rip-Toolchain (handbrake-cli, libdvdcss, **cdparanoia, libcdio-utils, ffmpeg**)
  - `/etc/hosts`-Eintrag falls mDNS im jeweiligen Netz wackelt
  - `~/.agora/admin-pw` setzen

## Audio-CD-Ripping

- **DONE 2026-07-16.** CDDA→FLAC über cdparanoia (Fehlerkorrektur) + ffmpeg, CD-TEXT (Album/Interpret/Titel) wird jetzt sowohl für Datei-/Ordnernamen als auch als echte FLAC-Metadaten (`-metadata title/album/artist/track`) geschrieben. Erkennung via udev `ID_CDROM_MEDIA_TRACK_COUNT_AUDIO` (vorher fiel eine Musik-CD fälschlich in die Burn-Zone). End-to-end auf kiosk3 verifiziert (echte CD, 11 Tracks, korrekte FLACs + Metadaten-Panel zeigt Titel/Autor). Playback lief zuerst nicht (wavesurfer hing bei FLAC-Decode) — gefixt auf natives `<audio>` über den media-server, `wavesurfer.js`-Dependency entfernt. Details: [[audio-cd-ripping-planned]] Memory.
- **Offen:** kiosk2s optisches Laufwerk (USB-Bridge, Initio INIC-1618L) kann kein CDDA lesen — nur Daten-DVDs. Audio-CD-Rip nur auf kiosk3 (natives SATA-Laufwerk) getestet/nutzbar. kiosk1 fehlt Toolchain komplett (siehe oben).
- **Offen:** Rip-Fortschrittsbalken ist Track-basiert (n/total), nicht Intra-Track-% (cdparanoia liefert keine parsebare Prozentanzeige) — funktioniert, aber grob.

## QR-Share offene Punkte

- **Byte-Zählung:** Event `qr_share` misst *freigegebene* Bytes bei Share-Erstellung, nicht tatsächlich übertragene. copypartys `metrics.py` hat keinen TX-Byte-Counter; Access-Log-Parsing ist ANSI-verseucht + fragil. Mögliches späteres Upgrade: Redirect-Endpoint `/g/<key>` am agora-dashboard, der echte Hits zählt und auf die copyparty-Share-URL weiterleitet.
- **Handy-Zählung per Netzwerkscan:** Noch nicht gebaut. Poller könnte zusätzlich zu MAC-Samples auch Handy-Verbindungen tracken (z.B. via ARP oder `iw dev`-Parse). Ist separates Feature am Poller, berührt QR-Share nicht.
- **Ordner-Share unterzählt Bytes:** `qr_bytes` zählt bei Ordner-Shares systematisch 0 freigegebene Bytes, weil `RemoteEntry` für Verzeichnisse `size: 0` liefert und keine rekursive Größenermittlung stattfindet (bewusste Entscheidung: N Requests pro Share wären Latenz + neue Fehlerpfade für ein Nebenziel). Ein 1-Ordner-Share meldet 0 Bytes trotz realem Inhalt.

## Screensaver-Spec (noch nicht gebaut)

- **Idle-Schwelle:** 3 Minuten (nicht 20 s wie in CLAUDE.md geplant).
- **Trigger nur wenn:** kein QR-Dialog offen UND kein Medium (Viewer/Player) aktiv. Braucht Suppression-Flag vom Renderer an Main-Prozess (`ipcRenderer.send('screensaver:suppress', boolean)`).
- **Implementierung existiert noch nicht:** kein `powerMonitor` in `src/`, keine Screensaver-Route. Renderer-Route `/screensaver` würde fetchs zu `http://kiosk2.local:8080/stats` machen wie geplant (CLAUDE.md Zeile 125 ff). Details siehe CLAUDE.md Abschnitt "Screensaver-Modus".

## Ungeprüft / möglicherweise obsolet

- Notiz vom 2026-07-11: hochgeladenes MP4 „lässt sich schlecht schließen" im Player, Verdacht VNC-Interaktion — nie untersucht. Player wurde seither komplett auf video.js v10 umgebaut; alter Befund evtl. nicht mehr relevant, aber nicht verifiziert.
