# TODO — offene Punkte (Stand 2026-07-16)

Abgleich gegen Marvins Anforderungsliste ([[kiosk-requirements]] Memory, 2026-07-06) + Session-Nachträge. Details/Kontext siehe git log.

## Offen aus der Anforderungsliste

- **#9 Transfer-Statistik unvollständig** — **DONE**. GB gesamt, Dateianzahl und Aufschlüsselung nach Format inklusive der jeweiligen Byte-Größen sind nun in Event-Schema, Datenbank und Agora-Stats-Panel integriert.

## Burn-Feature (DVD brennen)

- xorriso ist auf kiosk2 + kiosk3 installiert (Blocker von damals weg), aber **kein einziger echter Brennvorgang wurde verifiziert**. Kompletter Pfad (`cdburn.ts`, `OpticalDropZone.tsx`, `BurnDialog.tsx`) ungetestet mit echter Disc.

## Admin-Panel

- Host-Wechsel nutzt jetzt **dasselbe Passwort wie der Session-Reset** (eine Datei `~/.agora/admin.hash`, die auch das Dashboard prüft — kein zweites Passwort mehr zu pflegen).
- ✅ **kiosk2** hat `~/.agora/admin.hash` (aus dem originalen setup-main.sh-Prompt, 2026-07-06).
- ✅ **kiosk3** hat `~/.agora/admin.hash` jetzt auch gesetzt (2026-07-16). Beide Kioske erledigt.

## kiosk1

- Bleibt bewusst aus. Wenn er dazukommt, fehlt komplett:
  - WLAN-Setup (wpasupplicant, iw powersave off, dup-wpa disable)
  - Rip-Toolchain (handbrake-cli, libdvdcss)
  - `/etc/hosts`-Eintrag falls mDNS im jeweiligen Netz wackelt
  - `~/.agora/admin-pw` setzen

## Audio-CD-Ripping

- Eigenes Feature, bewusst auf später verschoben (siehe [[audio-cd-ripping-planned]] Memory). CDDA hat kein Dateisystem — aktuell würde eine Musik-CD fälschlich als Burn-Ziel erscheinen statt als rippbar erkannt zu werden.

## Ungeprüft / möglicherweise obsolet

- Notiz vom 2026-07-11: hochgeladenes MP4 „lässt sich schlecht schließen" im Player, Verdacht VNC-Interaktion — nie untersucht. Player wurde seither komplett auf video.js v10 umgebaut; alter Befund evtl. nicht mehr relevant, aber nicht verifiziert.
