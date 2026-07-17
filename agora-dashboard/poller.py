#!/usr/bin/env python3
"""
Agora client-tracking poller (FritzBox 7490 / TR-064).

Polls the FritzBox host list every --interval seconds and records, per
session, which devices have been seen. MAC addresses are NEVER stored in
clear: only SHA256(mac + per-session salt), so hashes cannot be correlated
across sessions (DSGVO: a MAC is personal data, Breyer 2016).

Data source is TR-064 via the `fritzconnection` lib (FritzHosts). Use
--mock to exercise the full DB pipeline without a FritzBox or credentials.

Subcommands:
  run     (default) poll forever, or once with --once
  reset   start a fresh session (new salt) and drop all samples/seen_macs
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

DEFAULT_DB = Path.home() / ".agora" / "agora.db"
# "fritz.box" resolves on any FritzBox network via the box's own DNS, so the
# poller needs no per-network reconfiguration. Override with $FRITZ_ADDRESS.
DEFAULT_ADDRESS = os.environ.get("FRITZ_ADDRESS", "fritz.box")

# infrastructure that is always on the Agora net but is NOT a guest: the router
# and the three kiosks. Everything else active on the net counts as a guest.
# Matched case-insensitively by hostname; any "fritz.*" (box, repeater) is infra.
# (interface type is unreliable via get_hosts_info on the 7490, so we filter by
# identity instead of WLAN-vs-LAN.)
INFRA_NAMES = {"kiosk1", "kiosk2", "kiosk3"}


def is_infra(host: dict, exclude: set[str]) -> bool:
    name = (host.get("name") or "").strip().lower()
    if name.startswith("fritz."):  # fritz.box, fritz.repeater
        return True
    return name in INFRA_NAMES or name in exclude

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     REAL NOT NULL,
  salt           TEXT NOT NULL,
  baseline_bytes INTEGER          -- rx+tx of the server iface at session start; NULL if unavailable
);
CREATE TABLE IF NOT EXISTS seen_macs (
  session_id INTEGER NOT NULL,
  mac_hash   TEXT NOT NULL,
  hostname   TEXT,
  first_seen REAL NOT NULL,
  last_seen  REAL NOT NULL,
  PRIMARY KEY (session_id, mac_hash)
);
CREATE TABLE IF NOT EXISTS samples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL,
  ts            REAL NOT NULL,
  live_count    INTEGER NOT NULL,
  ever_count    INTEGER NOT NULL,
  traffic_bytes INTEGER          -- raw cumulative rx+tx of the server iface at poll time; NULL if unavailable
);
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL,
  ts         REAL NOT NULL,
  kiosk      TEXT NOT NULL,
  kind       TEXT NOT NULL,   -- usb_connected | disc_inserted | transfer | qr_share
  direction  TEXT,            -- transfer only: up | down
  files      INTEGER,         -- transfer/qr_share: file count
  bytes      INTEGER,         -- transfer/qr_share: total bytes
  exts_json  TEXT             -- transfer/qr_share: JSON {ext: {"count": N, "bytes": N}}
);
"""

VALID_EVENT_KINDS = {"usb_connected", "disc_inserted", "transfer", "qr_share"}


# --- database -------------------------------------------------------------

def _migrate(con: sqlite3.Connection) -> None:
    """upgrades DBs created before server-side byte tracking existed."""
    try:
        con.execute("ALTER TABLE sessions ADD COLUMN baseline_bytes INTEGER")
    except sqlite3.OperationalError:
        pass  # already has it
    try:
        con.execute("ALTER TABLE samples RENAME COLUMN wlan_bytes TO traffic_bytes")
    except sqlite3.OperationalError:
        pass  # already renamed, or fresh DB never had the old name
    try:
        con.execute("ALTER TABLE events ADD COLUMN bytes INTEGER")
    except sqlite3.OperationalError:
        pass
    con.commit()


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    _migrate(con)
    return con


def new_salt() -> str:
    return os.urandom(16).hex()


def current_session(con: sqlite3.Connection) -> sqlite3.Row:
    """latest session, creating one if the db is fresh."""
    row = con.execute("SELECT * FROM sessions ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        con.execute(
            "INSERT INTO sessions (started_at, salt, baseline_bytes) VALUES (?, ?, ?)",
            (time.time(), new_salt(), iface_bytes(default_iface())),
        )
        con.commit()
        row = con.execute("SELECT * FROM sessions ORDER BY id DESC LIMIT 1").fetchone()
    return row


def reset_session(con: sqlite3.Connection) -> int:
    """drop all observation data and open a brand-new session (new salt)."""
    con.execute("DELETE FROM samples")
    con.execute("DELETE FROM seen_macs")
    con.execute("DELETE FROM events")
    con.execute(
        "INSERT INTO sessions (started_at, salt, baseline_bytes) VALUES (?, ?, ?)",
        (time.time(), new_salt(), iface_bytes(default_iface())),
    )
    con.commit()
    return con.execute("SELECT MAX(id) AS id FROM sessions").fetchone()["id"]


# --- events ---------------------------------------------------------------

def insert_event(con: sqlite3.Connection, session_id: int, event: dict) -> None:
    """
    record a kiosk-reported event. `event` is the posted JSON:
      {"kind": "usb_connected", "kiosk": "kiosk1"}
      {"kind": "disc_inserted", "kiosk": "kiosk1"}
      {"kind": "transfer", "kiosk": "kiosk1", "direction": "up"|"down",
       "files": 3, "bytes": 1024, "exts": {"mp3": {"count": 2, "bytes": 1000}, "jpg": {"count": 1, "bytes": 24}}}
      {"kind": "qr_share", "kiosk": "kiosk1",
       "files": 3, "bytes": 1024, "exts": {"mp3": {"count": 2, "bytes": 1000}, "jpg": {"count": 1, "bytes": 24}}}
    invalid input raises ValueError.
    """
    kind = event.get("kind")
    if kind not in VALID_EVENT_KINDS:
        raise ValueError(f"invalid kind: {kind!r}")
    kiosk = event.get("kiosk")
    if not isinstance(kiosk, str) or not kiosk:
        raise ValueError("kiosk must be a non-empty string")

    direction = None
    files = None
    bytes_ = None
    exts_json = None
    if kind == "transfer":
        direction = event.get("direction")
        if direction not in {"up", "down"}:
            raise ValueError(f"invalid direction: {direction!r}")
    if kind in ("transfer", "qr_share"):
        files = event.get("files")
        if not isinstance(files, int) or isinstance(files, bool) or files < 0:
            raise ValueError("files must be an int >= 0")
        bytes_ = event.get("bytes")
        if not isinstance(bytes_, int) or isinstance(bytes_, bool) or bytes_ < 0:
            raise ValueError("bytes must be an int >= 0")
        exts = event.get("exts")
        if not isinstance(exts, dict) or not all(
            isinstance(k, str) and isinstance(v, dict) and "count" in v and "bytes" in v
            for k, v in exts.items()
        ):
            raise ValueError("exts must be a dict[str, dict[count, bytes]]")
        exts_json = json.dumps(exts)

    con.execute(
        "INSERT INTO events (session_id, ts, kiosk, kind, direction, files, bytes, exts_json) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (session_id, time.time(), kiosk, kind, direction, files, bytes_, exts_json),
    )
    con.commit()


def event_stats(con: sqlite3.Connection, session_id: int) -> dict:
    """aggregate the events of one session for the dashboard."""
    usb_count = con.execute(
        "SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND kind = 'usb_connected'",
        (session_id,),
    ).fetchone()["n"]
    disc_count = con.execute(
        "SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND kind = 'disc_inserted'",
        (session_id,),
    ).fetchone()["n"]
    files_transferred = con.execute(
        "SELECT COALESCE(SUM(files), 0) AS n FROM events "
        "WHERE session_id = ? AND kind = 'transfer'",
        (session_id,),
    ).fetchone()["n"]
    bytes_transferred = con.execute(
        "SELECT COALESCE(SUM(bytes), 0) AS n FROM events "
        "WHERE session_id = ? AND kind = 'transfer'",
        (session_id,),
    ).fetchone()["n"]
    qr_shares = con.execute(
        "SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND kind = 'qr_share'",
        (session_id,),
    ).fetchone()["n"]
    qr_bytes = con.execute(
        "SELECT COALESCE(SUM(bytes), 0) AS n FROM events "
        "WHERE session_id = ? AND kind = 'qr_share'",
        (session_id,),
    ).fetchone()["n"]

    tally: dict[str, dict] = {}
    rows = con.execute(
        "SELECT exts_json FROM events "
        "WHERE session_id = ? AND kind = 'transfer' AND exts_json IS NOT NULL",
        (session_id,),
    ).fetchall()
    for r in rows:
        try:
            exts = json.loads(r["exts_json"])
        except (ValueError, TypeError):
            continue
        if isinstance(exts, dict):
            for ext, stats in exts.items():
                if ext not in tally:
                    tally[ext] = {"count": 0, "bytes": 0}
                if isinstance(stats, int):
                    tally[ext]["count"] += stats
                elif isinstance(stats, dict):
                    tally[ext]["count"] += stats.get("count", 0)
                    tally[ext]["bytes"] += stats.get("bytes", 0)

    by_ext = [
        {"ext": ext, "count": st["count"], "bytes": st["bytes"]}
        for ext, st in sorted(tally.items(), key=lambda kv: (-kv[1]["bytes"], -kv[1]["count"], kv[0]))
    ][:8]

    return {
        "usb_count": usb_count,
        "disc_count": disc_count,
        "files_transferred": files_transferred,
        "bytes_transferred": bytes_transferred,
        "qr_shares": qr_shares,
        "qr_bytes": qr_bytes,
        "by_ext": by_ext,
    }


# --- data source ----------------------------------------------------------

def fetch_hosts_real(address: str, user: str | None, password: str) -> list[dict]:
    """returns [{mac, ip, name, active, interface}, ...] via TR-064."""
    from fritzconnection.lib.fritzhosts import FritzHosts

    fh = FritzHosts(address=address, user=user, password=password)
    out = []
    for h in fh.get_hosts_info():
        out.append(
            {
                "mac": (h.get("mac") or "").upper(),
                "ip": h.get("ip") or "",
                "name": h.get("name") or "",
                "active": bool(h.get("status")),
                "interface": h.get("interface") or "",
            }
        )
    return out


def fetch_hosts_mock() -> list[dict]:
    """deterministic-ish fake hosts so the DB pipeline is testable offline."""
    import random

    pool = [
        ("AA:BB:CC:00:00:00", "fritz.box"),   # infra -> filtered
        ("AA:BB:CC:00:00:01", "phone-anna"),
        ("AA:BB:CC:00:00:02", "laptop-ben"),
        ("AA:BB:CC:00:00:03", "tablet-cyk"),
        ("AA:BB:CC:00:00:04", "kiosk2"),      # infra -> filtered
        ("AA:BB:CC:00:00:05", "phone-dora"),
    ]
    hosts = []
    for i, (mac, name) in enumerate(pool):
        hosts.append(
            {
                "mac": mac,
                "ip": f"192.168.178.{60 + i}",
                "name": name,
                # randomly toggle some devices "away" to exercise live vs ever
                "active": random.random() > 0.3,
                "interface": "",  # 7490 leaves this blank via get_hosts_info
            }
        )
    return hosts


def default_iface() -> str | None:
    """name of the interface holding the default route (LAN or WLAN)."""
    try:
        with open("/proc/net/route") as f:
            next(f)  # header line
            for line in f:
                fields = line.split()
                if len(fields) >= 2 and fields[1] == "00000000":
                    return fields[0]
    except OSError:
        pass
    return None


def iface_bytes(iface: str | None) -> int | None:
    """
    Cumulative rx+tx bytes of `iface` since it last came up (kernel counter,
    resets on reboot/interface restart). kiosk2 is the sneakernet hub every
    transfer passes through, so this stands in for "traffic to/from the
    server" without needing FritzBox TR-064 (which only exposes WLAN packet
    counts, not bytes, and no per-client breakdown -- see README).
    """
    if not iface:
        return None
    try:
        stats = Path("/sys/class/net") / iface / "statistics"
        rx = int((stats / "rx_bytes").read_text())
        tx = int((stats / "tx_bytes").read_text())
        return rx + tx
    except (OSError, ValueError):
        return None


# --- polling --------------------------------------------------------------

def hash_mac(mac: str, salt: str) -> str:
    return hashlib.sha256((mac + salt).encode("utf-8")).hexdigest()


def poll_once(con: sqlite3.Connection, hosts: list[dict], exclude: set[str]) -> dict:
    session = current_session(con)
    sid, salt = session["id"], session["salt"]
    baseline = session["baseline_bytes"]
    now = time.time()

    # guests only: active, has a MAC, and not infra (router/kiosks/--exclude)
    active = [h for h in hosts if h["active"] and h["mac"] and not is_infra(h, exclude)]
    for h in active:
        mh = hash_mac(h["mac"], salt)
        con.execute(
            """
            INSERT INTO seen_macs (session_id, mac_hash, hostname, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_id, mac_hash)
            DO UPDATE SET last_seen = excluded.last_seen,
                          hostname  = excluded.hostname
            """,
            (sid, mh, h["name"], now, now),
        )

    ever = con.execute(
        "SELECT COUNT(*) AS n FROM seen_macs WHERE session_id = ?", (sid,)
    ).fetchone()["n"]
    live = len(active)

    raw = iface_bytes(default_iface())
    if baseline is None and raw is not None:
        # upgrade path: session predates byte tracking -> adopt now as baseline
        con.execute("UPDATE sessions SET baseline_bytes = ? WHERE id = ?", (raw, sid))
        baseline = raw
    traffic = None if raw is None or baseline is None else max(0, raw - baseline)

    con.execute(
        "INSERT INTO samples (session_id, ts, live_count, ever_count, traffic_bytes) "
        "VALUES (?, ?, ?, ?, ?)",
        (sid, now, live, ever, raw),
    )
    con.commit()
    return {"session": sid, "live": live, "ever": ever, "traffic_bytes": traffic}


def get_hosts(args: argparse.Namespace) -> list[dict]:
    if args.mock:
        return fetch_hosts_mock()
    password = args.password or os.environ.get("FRITZ_PASSWORD")
    if not password:
        sys.exit("ERROR: set FRITZ_PASSWORD (or --password), or use --mock")
    user = args.user or os.environ.get("FRITZ_USER")
    return fetch_hosts_real(args.address, user, password)


# --- cli ------------------------------------------------------------------

def cmd_run(args: argparse.Namespace) -> None:
    con = connect(args.db)
    current_session(con)  # ensure one exists
    exclude = {x.strip().lower() for x in (args.exclude or [])}
    src = "mock" if args.mock else f"TR-064 @ {args.address}"
    while True:
        try:
            hosts = get_hosts(args)
            r = poll_once(con, hosts, exclude)
            print(
                f"[{time.strftime('%H:%M:%S')}] session {r['session']}: "
                f"live={r['live']} ever={r['ever']} "
                f"bytes={'n/a' if r['traffic_bytes'] is None else r['traffic_bytes']} ({src})"
            )
        except Exception as ex:  # poller must survive a flaky FritzBox
            print(f"[{time.strftime('%H:%M:%S')}] poll failed: {ex}", file=sys.stderr)
        if args.once:
            return
        time.sleep(args.interval)


def cmd_reset(args: argparse.Namespace) -> None:
    con = connect(args.db)
    sid = reset_session(con)
    print(f"reset done; new session {sid} (samples + seen_macs dropped)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Agora FritzBox TR-064 client-tracking poller")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"sqlite path (default {DEFAULT_DB})")
    sub = ap.add_subparsers(dest="cmd")

    run = sub.add_parser("run", help="poll the FritzBox (default)")
    run.add_argument("--address", default=DEFAULT_ADDRESS, help="FritzBox IP")
    run.add_argument("--user", default=None, help="FritzBox user (or $FRITZ_USER)")
    run.add_argument("--password", default=None, help="FritzBox password (or $FRITZ_PASSWORD)")
    run.add_argument("--interval", type=float, default=60.0, help="seconds between polls")
    run.add_argument("--once", action="store_true", help="poll once and exit")
    run.add_argument("--mock", action="store_true", help="use fake hosts (no FritzBox needed)")
    run.add_argument(
        "--exclude", action="append", metavar="NAME",
        help="extra hostname to treat as infra (repeatable); router + kiosk1-3 are always excluded",
    )
    run.set_defaults(func=cmd_run)

    rs = sub.add_parser("reset", help="new session, drop all observations (agora-reset)")
    rs.set_defaults(func=cmd_reset)

    args = ap.parse_args()
    if args.cmd is None:  # default to `run` with its defaults
        args = ap.parse_args(["run", *sys.argv[1:]])
    args.func(args)


if __name__ == "__main__":
    main()
