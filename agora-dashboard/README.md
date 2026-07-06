# Agora Dashboard (Prototyp)

Client-Tracking-Dienst für den Agora-Sneakernet-Tisch. Läuft **nur auf Kiosk2**.
Pollt die FritzBox 7490 via **TR-064** und führt pro Session Buch über gesehene
Geräte. MAC-Adressen werden ausschließlich als `SHA256(mac + session_salt)`
gespeichert — kein Klartext, nicht über Sessions korrelierbar (DSGVO, MAC =
personenbezogen nach Breyer 2016).

Zwei Prozesse auf Kiosk2:
- **`poller.py`** schreibt Beobachtungen in `~/.agora/agora.db` (FritzBox-Poll)
- **`server.py`** (Flask, Port 8080) liest die DB read-only und liefert `/stats`

Die Electron-Kioske holen sich die Stats über den **„Netz-Statistik"-Button**
(Users-Icon) in der Topbar → `http://192.168.178.61:8080/stats`.

## Setup

```bash
cd agora-dashboard
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### FritzBox vorbereiten (einmalig)

TR-064 freigeben: **Heimnetz → Netzwerk → Netzwerkeinstellungen →
„Zugriff für Anwendungen zulassen"**. Dann einen FritzBox-Benutzer mit Passwort
nutzen (`$FRITZ_USER` optional, `$FRITZ_PASSWORD` nötig).

## Benutzung

```bash
# offline testen, ganze DB-Pipeline ohne FritzBox:
python3 poller.py run --mock --once
python3 poller.py run --mock --interval 5     # Schleife mit Fake-Hosts

# echt gegen FritzBox:
export FRITZ_PASSWORD=...            # FRITZ_USER optional
python3 poller.py run                # alle 60 s, default 192.168.178.1
python3 poller.py run --once         # einmal pollen, raus

# Session zurücksetzen (= agora-reset): neue session-row, samples+seen_macs DROP
python3 poller.py reset
```

DB liegt unter `~/.agora/agora.db` (reboot-fest), abänderbar mit `--db`.

### Dashboard-Server

```bash
# auf Kiosk2, neben dem laufenden Poller:
.venv/bin/python server.py            # Flask, 0.0.0.0:8080
# Endpunkte:
#   GET /stats      JSON (CORS: *)  <- Electron-Button + Screensaver
#   GET /dashboard  Mini-HTML-Ansicht (Standalone / andere Kioske)
#   GET /healthz    "ok"
```

Beide Prozesse später als systemd-User-Services auf Kiosk2 (`poller run` +
`server`). Der Poller braucht `FRITZ_PASSWORD` im Service-Environment.

### Gäste vs Infrastruktur

`live`/`ever` zählen nur **Gäste**. Als Infrastruktur (nicht gezählt, MAC wird
nicht mal gehasht) gelten automatisch: der Router (`fritz.*` → box & repeater)
und die drei Kioske (`kiosk1`/`kiosk2`/`kiosk3`). Im echten Agora-Netz sind
standardmäßig nur diese da — alles weitere ist ein Besucher.

Weitere Namen ausschließen:

```bash
python3 poller.py run --exclude nas-dxp2800 --exclude drucker
```

> Hinweis: TR-064 `get_hosts_info()` füllt das `interface`-Feld auf der 7490
> nicht (WLAN vs LAN nicht unterscheidbar), daher Filter über Identität
> (Hostname) statt Verbindungstyp.

## Schema

- `sessions(id, started_at, salt)` — pro Reset eine neue Zeile mit frischem Salt
- `seen_macs(session_id, mac_hash, hostname, first_seen, last_seen)` — je Session
  einmal pro Gerät; `mac_hash` = SHA256(mac+salt)
- `sessions(..., baseline_bytes)` — rx+tx-Zähler des Server-Interface bei
  Session-Start; Referenzpunkt für die Bytes-Anzeige
- `samples(session_id, ts, live_count, ever_count, traffic_bytes)` — Zeitreihe
  der aktiven Clients + Gesamtzahl je gesehener; `traffic_bytes` = roher
  kumulativer rx+tx-Zähler des Server-Interface zum Poll-Zeitpunkt

## Bytes: Server-Interface statt FritzBox

MikroTik lieferte per-Client-Bytes (`/rest/interface`), das ging beim
Router-Wechsel verloren. Die FritzBox 7490 gibt über TR-064 ohnehin nur
**WLAN-Paket**-Zähler als Aggregat übers ganze Interface, keine Bytes und
keine per-Client-Aufschlüsselung — also keine echte Alternative gewesen.

Stattdessen: kiosk2 ist der Sneakernet-Hub, durch den jeder Transfer läuft.
`poller.py` liest `/sys/class/net/<iface>/statistics/{rx,tx}_bytes` des
Interface mit Default-Route (`default_iface()`/`iface_bytes()` in
`poller.py`) — kernelseitig gezählt, kein FritzBox-Zugriff nötig. Die
Anzeige ist Bytes zu/von kiosk2 gesamt (copyparty-Transfers, Dashboard-HTTP,
SSH, …), nicht mehr WLAN-spezifisch und nicht per Client — aber real, nicht
geschätzt.

**Caveat:** der Kernel-Zähler ist kumulativ seit Interface-Up, nicht seit
Agora-Session-Start. `sessions.baseline_bytes` hält den Zählerstand bei
Session-Beginn fest; angezeigt wird die Differenz. Bootet der Server
*innerhalb* einer laufenden Session neu, springt der Zähler auf 0 zurück und
die Differenz würde negativ werden — das wird auf 0 geklemmt, macht die
Anzeige aber bis zum nächsten Reset (`agora-reset`/Admin-Panel) ungenau.
