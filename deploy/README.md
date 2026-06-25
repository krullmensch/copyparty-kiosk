# Agora Kiosk Deployment

Provisioning für die drei Kioske. Ziel: **in jedem Netzwerk einstecken und
loslegen** — keine IP-Konfiguration nötig.

## Wie Netz-Unabhängigkeit funktioniert

Alles wird **per Name statt IP** adressiert:

| Was | Adresse | Warum netz-egal |
|---|---|---|
| App → Dateien | `kiosk2.local:3923` | mDNS (avahi) |
| App → Stats | `kiosk2.local:8080` | mDNS (avahi) |
| Poller → Router | `fritz.box` | FritzBox-eigenes DNS |

Neues Netz = neue DHCP-IPs, aber die Namen bleiben. Alle Dienste sind
reboot-fest (systemd + Display-Autostart). Also: **anschließen, booten, läuft.**

> Voraussetzung: Der Haupt-Kiosk heißt `kiosk2` (avahi annonciert `kiosk2.local`).
> Anderer Name → Konstanten in `src/main/ipc/agora.ts` + `src/renderer/src/App.tsx` anpassen.

## Rollen

- **Haupt-Kiosk (kiosk2):** copyparty + Tracking-Poller + Dashboard-Server + App
- **Client-Kioske (kiosk1, kiosk3):** nur App, zieht von `kiosk2.local`

## Erst-Setup (pro Kiosk, einmalig)

Repo klonen, dann das passende Script. Beide sind **idempotent** (gefahrlos
wiederholbar) und füllen beim Display-Stack nur Lücken (`FORCE=1` überschreibt).

```bash
git clone https://github.com/krullmensch/copyparty-kiosk ~/copyparty-kiosk
cd ~/copyparty-kiosk

# auf kiosk2:
./deploy/setup-main.sh        # fragt Admin-PW + (optional) FritzBox-PW

# auf kiosk1 / kiosk3:
./deploy/setup-client.sh
```

`setup-main.sh` fragt:
1. **Admin-Passwort** — schaltet das Reset-Panel in der App frei (Pflicht).
2. **FritzBox-Passwort** — optional. Leer = Client-Tracking aus, Stats-Button
   wird in der App ausgeblendet (graceful degradation).

Voraussetzungen Haupt-Kiosk: `~/copyparty-sfx.py` vorhanden
([copyparty release](https://github.com/9001/copyparty/releases)), Node.js,
sudo. VNC optional: `x11vnc -storepasswd ~/.vnc/passwd`.

## Neues Netzwerk

Nichts zu tun. Einstecken, booten. Gleiche FritzBox → Tracking läuft weiter.
**Andere FritzBox** (anderes PW) → einmalig `FORCE=1 ./deploy/setup-main.sh`
und neues PW eingeben (oder leer für Tracking-aus).

## Session-Tracking & Reset

- **Session** = ein Event. Zeile in `sessions` (Startzeit + Zufalls-Salt). Alle
  Beobachtungen tragen `session_id`; MAC nur als `SHA256(mac+salt)` (DSGVO).
  Überlebt Reboots — eine Session bis zum manuellen Reset.
- **Reset** (= neues Event): in der App **5× auf den Titel „Agora" klicken** →
  Admin-Passwort → Reset. Erzeugt neue Session (neuer Salt), löscht alte
  `samples` + `seen_macs`.
- CLI-Alternative auf kiosk2:
  ```bash
  agora-dashboard/.venv/bin/python agora-dashboard/poller.py reset
  ```

## Dienste-Übersicht (Haupt-Kiosk)

| Dienst | Typ | Autostart |
|---|---|---|
| copyparty | systemd system | `multi-user.target` |
| agora-server (:8080) | systemd user | linger |
| agora-poller (60 s) | systemd user | linger (nur bei FritzBox-PW) |
| Electron-App | getty-autologin → startx → openbox → `start-electron.sh` | tty1 |
| avahi (mDNS) | systemd system | enabled |

Status prüfen:
```bash
systemctl --user status agora-server agora-poller
systemctl status copyparty avahi-daemon
```
