#!/usr/bin/env python3
"""
Agora dashboard HTTP server (read-only view over the poller DB).

Serves the stats that the poller writes into ~/.agora/agora.db. Runs on
Kiosk2; the Electron kiosks fetch JSON from http://kiosk2.local:8080/stats
(or http://192.168.178.61:8080/stats).

  GET /stats      -> JSON snapshot of the current session (CORS: any origin)
  GET /dashboard  -> minimal standalone HTML view (restyle later)
  GET /healthz    -> "ok"

The poller (poller.py) is the writer; this process only reads.
"""
from __future__ import annotations

import hashlib
import sqlite3
import time
from pathlib import Path

from flask import Flask, Response, jsonify, request

import poller

AGORA_DIR = Path.home() / ".agora"
DB_PATH = AGORA_DIR / "agora.db"
FRITZ_ENV = AGORA_DIR / "fritz.env"
ADMIN_HASH = AGORA_DIR / "admin.hash"
HISTORY_LIMIT = 120  # ~2h at 60s polling

app = Flask(__name__)


def tracking_enabled() -> bool:
    """tracking is on only if a FritzBox password is configured."""
    try:
        if not FRITZ_ENV.exists():
            return False
        for line in FRITZ_ENV.read_text().splitlines():
            if line.startswith("FRITZ_PASSWORD=") and line.split("=", 1)[1].strip():
                return True
    except OSError:
        pass
    return False


def read_db() -> sqlite3.Connection | None:
    if not DB_PATH.exists():
        return None
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def build_stats() -> dict:
    con = read_db()
    enabled = tracking_enabled()
    empty = {
        "enabled": enabled,
        "session": None,
        "live": 0,
        "ever": 0,
        "peak_live": 0,
        "traffic_bytes": None,
        "updated_at": None,
        "stale_s": None,
        "history": [],
    }
    if con is None:
        return empty
    try:
        session = con.execute(
            "SELECT id, started_at, baseline_bytes FROM sessions ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if session is None:
            return empty
        sid = session["id"]
        now = time.time()

        last = con.execute(
            "SELECT ts, live_count, ever_count, traffic_bytes FROM samples "
            "WHERE session_id = ? ORDER BY id DESC LIMIT 1",
            (sid,),
        ).fetchone()
        peak = con.execute(
            "SELECT MAX(live_count) AS p FROM samples WHERE session_id = ?", (sid,)
        ).fetchone()["p"]
        rows = con.execute(
            "SELECT ts, live_count FROM samples WHERE session_id = ? "
            "ORDER BY id DESC LIMIT ?",
            (sid, HISTORY_LIMIT),
        ).fetchall()
        history = [{"ts": r["ts"], "live": r["live_count"]} for r in reversed(rows)]

        traffic_bytes = None
        if last is not None and last["traffic_bytes"] is not None and session["baseline_bytes"] is not None:
            traffic_bytes = max(0, last["traffic_bytes"] - session["baseline_bytes"])

        return {
            "enabled": enabled,
            "session": {
                "id": sid,
                "started_at": session["started_at"],
                "uptime_s": round(now - session["started_at"]),
            },
            "live": last["live_count"] if last else 0,
            "ever": last["ever_count"] if last else 0,
            "peak_live": peak or 0,
            "traffic_bytes": traffic_bytes,
            "updated_at": last["ts"] if last else None,
            "stale_s": round(now - last["ts"]) if last else None,
            "history": history,
        }
    finally:
        con.close()


@app.after_request
def cors(resp: Response) -> Response:
    # kiosks fetch cross-origin (renderer origin is localhost or file://)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/stats")
def stats() -> Response:
    return jsonify(build_stats())


@app.get("/healthz")
def healthz() -> Response:
    return Response("ok", mimetype="text/plain")


def admin_password_ok(supplied: str) -> bool:
    """compares supplied password against the sha256 set at initial setup."""
    try:
        stored = ADMIN_HASH.read_text().strip()
    except OSError:
        return False  # no admin password configured -> reset disabled
    if not stored:
        return False
    return hashlib.sha256(supplied.encode("utf-8")).hexdigest() == stored


@app.post("/reset")
def reset() -> Response:
    """starts a fresh session and drops observations. requires admin password."""
    body = request.get_json(silent=True) or {}
    if not admin_password_ok(str(body.get("password", ""))):
        return jsonify({"ok": False, "error": "unauthorized"}), 403
    con = poller.connect(DB_PATH)
    try:
        sid = poller.reset_session(con)
    finally:
        con.close()
    return jsonify({"ok": True, "session": sid})


@app.get("/dashboard")
def dashboard() -> Response:
    # intentionally minimal; the real UI lives in the Electron app
    return Response(_DASHBOARD_HTML, mimetype="text/html")


_DASHBOARD_HTML = """<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>Agora</title>
<style>
  body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;
       display:flex;min-height:100vh;align-items:center;justify-content:center}
  .grid{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:2rem;text-align:center}
  .n{font-size:3.5rem;font-weight:700;line-height:1}
  .l{font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;opacity:.6;margin-top:.5rem}
  .meta{position:fixed;bottom:1rem;width:100%;text-align:center;opacity:.4;font-size:.75rem}
</style></head><body>
<div>
  <div class="grid">
    <div><div class="n" id="live">–</div><div class="l">live</div></div>
    <div><div class="n" id="ever">–</div><div class="l">jemals</div></div>
    <div><div class="n" id="peak">–</div><div class="l">peak</div></div>
  </div>
  <div class="meta" id="meta"></div>
</div>
<script>
async function tick(){
  try{
    const r=await fetch('/stats');const d=await r.json();
    live.textContent=d.live;ever.textContent=d.ever;peak.textContent=d.peak_live;
    const up=d.session?Math.round(d.session.uptime_s/60):0;
    meta.textContent='Session '+(d.session?d.session.id:'-')+' · '+up+' min · '
      +(d.stale_s==null?'keine Daten':'aktualisiert vor '+d.stale_s+'s');
  }catch(e){meta.textContent='offline';}
}
tick();setInterval(tick,5000);
</script></body></html>"""


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
