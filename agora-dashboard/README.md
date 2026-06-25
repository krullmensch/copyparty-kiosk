# Agora Dashboard (Prototyp)

Client-Tracking-Dienst für den Agora-Sneakernet-Tisch. Läuft **nur auf Kiosk2**.
Pollt die FritzBox 7490 via **TR-064** und führt pro Session Buch über gesehene
Geräte. MAC-Adressen werden ausschließlich als `SHA256(mac + session_salt)`
gespeichert — kein Klartext, nicht über Sessions korrelierbar (DSGVO, MAC =
personenbezogen nach Breyer 2016).

Stand: **Poller-Prototyp**. Flask/FastAPI-Dashboard (`localhost:8080`) kommt
als nächstes.

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
- `samples(session_id, ts, live_count, ever_count, wlan_bytes)` — Zeitreihe der
  aktiven Clients + Gesamtzahl je gesehener

## Bekannte Lücke: Bytes

MikroTik lieferte per-Client-Bytes (`/rest/interface`). Die FritzBox 7490 gibt
über TR-064 nur **WLAN-Paket**-Zähler, keine verlässlichen Byte-Summen pro WLAN
oder Gerät. `wlan_bytes` bleibt vorerst `NULL` (`wlan_bytes_best_effort()` in
`poller.py`). Optionen für später: WLAN-Statistik-Aggregat (Pakete → grobe
Schätzung) oder copyparty-seitige Transfer-Bytes statt Router-Zählung.
