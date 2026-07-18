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

import base64
import hashlib
import hmac
import json
import sqlite3
import time
import urllib.request
from html import escape
from pathlib import Path
from urllib.parse import quote

from flask import Flask, Response, jsonify, request

import poller

AGORA_DIR = Path.home() / ".agora"
DB_PATH = AGORA_DIR / "agora.db"
FRITZ_ENV = AGORA_DIR / "fritz.env"
ADMIN_HASH = AGORA_DIR / "admin.hash"
HOST_FILE = AGORA_DIR / "host"
OO_SECRET_FILE = AGORA_DIR / "oo-jwt.secret"
DEFAULT_HOST = "kiosk2.local"
COPYPARTY_PORT = 3923
ONLYOFFICE_PORT = 8081
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
        "usb_count": 0,
        "disc_count": 0,
        "files_transferred": 0,
        "bytes_transferred": 0,
        "qr_shares": 0,
        "qr_bytes": 0,
        "by_ext": [],
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

        evstats = poller.event_stats(con, sid)

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
            "usb_count": evstats["usb_count"],
            "disc_count": evstats["disc_count"],
            "files_transferred": evstats["files_transferred"],
            "bytes_transferred": evstats["bytes_transferred"],
            "qr_shares": evstats["qr_shares"],
            "qr_bytes": evstats["qr_bytes"],
            "by_ext": evstats["by_ext"],
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


@app.post("/event")
def event() -> Response:
    """
    record a kiosk-reported event. No auth on purpose -- same trust level as
    the anonymous copyparty on this closed sneakernet.
    """
    body = request.get_json(silent=True) or {}
    con = read_db()
    sid = None
    if con is not None:
        try:
            row = con.execute(
                "SELECT id FROM sessions ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if row is not None:
                sid = row["id"]
        finally:
            con.close()
    if sid is None:
        return jsonify({"ok": False, "error": "no active session"}), 409

    rw = poller.connect(DB_PATH)
    try:
        poller.insert_event(rw, sid, body)
    except ValueError as ex:
        return jsonify({"ok": False, "error": str(ex)}), 400
    finally:
        rw.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# OnlyOffice Document Server -- VIEW-only wrapper (Task OO-2)
#
# Serves an HTML page that embeds OnlyOffice DS (api.js from the LAN host on
# :8081) as a pure viewer for a copyparty document. The Electron app loads this
# page in an iframe (OO-3). No editing, no callbackUrl, no save endpoint.
# ---------------------------------------------------------------------------

# extension (no dot, lowercase) -> OnlyOffice documentType
_OO_DOCTYPE = {
    # word
    "doc": "word", "docx": "word", "docm": "word", "dot": "word", "dotx": "word",
    "odt": "word", "ott": "word", "rtf": "word", "txt": "word", "fodt": "word",
    # cell
    "xls": "cell", "xlsx": "cell", "xlsm": "cell", "xlt": "cell", "xltx": "cell",
    "ods": "cell", "ots": "cell", "csv": "cell", "fods": "cell",
    # slide
    "ppt": "slide", "pptx": "slide", "pptm": "slide", "pot": "slide", "potx": "slide",
    "odp": "slide", "otp": "slide", "fodp": "slide",
}


def agora_host(override: str | None = None) -> str:
    """LAN address of the Agora host (kiosk2). Mirrors src/main/ipc/config.ts:
    read ~/.agora/host, fall back to kiosk2.local. An explicit ?host= wins so a
    client can point OnlyOffice at kiosk2's IP without touching the file."""
    if override:
        h = override.strip()
        if h:
            return h
    try:
        txt = HOST_FILE.read_text().strip()
        if txt:
            return txt
    except OSError:
        pass
    return DEFAULT_HOST


def oo_secret() -> str:
    """HS256 secret for the DS inner-config token (64 hex chars on kiosk2)."""
    return OO_SECRET_FILE.read_text().strip()


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def jwt_hs256(payload: dict, secret: str) -> str:
    """Minimal HS256 JWT. Inline stdlib (hmac/hashlib/base64/json) instead of
    pyjwt -- one less package to ship to the offline Sneakernet host."""
    header = {"alg": "HS256", "typ": "JWT"}
    seg = (
        _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
        + "."
        + _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    )
    sig = hmac.new(secret.encode("utf-8"), seg.encode("ascii"), hashlib.sha256).digest()
    return seg + "." + _b64url(sig)


def doctype_from_ext(ext: str) -> str:
    return _OO_DOCTYPE.get(ext.lower(), "word")


def _fetch_mtime(url: str) -> int | None:
    """HEAD the copyparty file for Last-Modified (epoch s). Best-effort: any
    failure returns None and the caller falls back to a time bucket."""
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=3) as resp:
            lm = resp.headers.get("Last-Modified")
        if lm:
            import email.utils

            ts = email.utils.parsedate_to_datetime(lm)
            return int(ts.timestamp())
    except Exception:
        pass
    return None


def _doc_key(vpath: str, mtime: int | None) -> str:
    """Stable DS cache key: [A-Za-z0-9._=-], <=128 chars. sha1 hex is safe.
    Without an mtime we bucket by hour, so an external file change is NOT
    cache-invalidated until the bucket rolls -- acceptable for a viewer."""
    if mtime is None:
        mtime = int(time.time()) // 3600  # hourly bucket fallback
    digest = hashlib.sha1(f"{vpath}:{mtime}".encode("utf-8")).hexdigest()
    return digest  # 40 hex chars


def build_oo_config(vpath: str, host: str) -> dict:
    """Assemble the DocEditor config (without token) for a copyparty vpath.

    document.url must be reachable from inside the DS *container*, not from the
    browser -- so it uses the LAN host address (not localhost, which in the
    container is the container itself). copyparty listens on 0.0.0.0:3923, so
    the LAN IP of kiosk2 works from the container's network. Prefer an IP in
    ~/.agora/host (or ?host=) over the mDNS name kiosk2.local, which a Docker
    container usually cannot resolve."""
    vpath = vpath.lstrip("/")
    ext = vpath.rsplit(".", 1)[-1].lower() if "." in vpath else ""
    name = vpath.rsplit("/", 1)[-1] or vpath
    doc_url = f"http://{host}:{COPYPARTY_PORT}/{quote(vpath, safe='/')}"
    mtime = _fetch_mtime(doc_url)
    return {
        "type": "desktop",
        "documentType": doctype_from_ext(ext),
        "document": {
            "fileType": ext,
            "key": _doc_key(vpath, mtime),
            "title": name,
            "url": doc_url,
            "permissions": {
                "edit": False,
                "comment": False,
                "download": True,
                "print": True,
                "fillForms": False,
                "review": False,
                "copy": True,
            },
        },
        "editorConfig": {
            "mode": "view",
        },
    }


def render_oo_view(vpath: str, host: str) -> str:
    """Full HTML page embedding DS as a viewer for `vpath`."""
    config = build_oo_config(vpath, host)
    try:
        config["token"] = jwt_hs256(config, oo_secret())
    except OSError:
        # No secret on this host (e.g. local dev): DS with JWT_ENABLED would
        # reject, but the page still renders so the wiring is inspectable.
        pass
    api_src = f"http://{host}:{ONLYOFFICE_PORT}/web-apps/apps/api/documents/api.js"
    config_json = json.dumps(config)
    return (
        "<!doctype html>\n"
        '<html lang="de"><head><meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{escape(config['document']['title'])}</title>\n"
        "<style>\n"
        "  html,body{margin:0;height:100%;background:#1a1a1a;}\n"
        "  #placeholder{width:100%;height:100vh;}\n"
        "</style></head><body>\n"
        '<div id="placeholder" style="width:100%;height:100vh"></div>\n'
        f'<script src="{escape(api_src)}"></script>\n'
        "<script>\n"
        f"  var config = {config_json};\n"
        '  new DocsAPI.DocEditor("placeholder", config);\n'
        "</script></body></html>"
    )


@app.get("/oo-view")
def oo_view() -> Response:
    doc = request.args.get("doc", "").strip()
    if not doc:
        return Response("missing ?doc=<vpath>", status=400, mimetype="text/plain")
    host = agora_host(request.args.get("host"))
    return Response(render_oo_view(doc, host), mimetype="text/html")


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
  .grid{display:grid;grid-template-columns:repeat(4,minmax(100px,1fr));gap:2rem;text-align:center}
  .n{font-size:3.5rem;font-weight:700;line-height:1}
  .l{font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;opacity:.6;margin-top:.5rem}
  .meta{position:fixed;bottom:1rem;width:100%;text-align:center;opacity:.4;font-size:.75rem}
</style></head><body>
<div>
  <div class="grid">
    <div><div class="n" id="live">–</div><div class="l">live</div></div>
    <div><div class="n" id="ever">–</div><div class="l">jemals</div></div>
    <div><div class="n" id="peak">–</div><div class="l">peak</div></div>
    <div><div class="n" id="traffic">–</div><div class="l">traffic</div></div>
    <div><div class="n" id="qrShares">–</div><div class="l">QR-Shares</div></div>
    <div><div class="n" id="qrBytes">–</div><div class="l">per QR freigegeben</div></div>
  </div>
  <div class="meta" id="meta"></div>
</div>
<script>
function fmtBytes(n){
  if(n==null) return '–';
  const units=['B','KB','MB','GB','TB'];let i=0;
  while(n>=1024 && i<units.length-1){n/=1024;i++;}
  return (n<10 && i>0 ? n.toFixed(1) : Math.round(n))+' '+units[i];
}
async function tick(){
  try{
    const r=await fetch('/stats');const d=await r.json();
    live.textContent=d.live;ever.textContent=d.ever;peak.textContent=d.peak_live;
    traffic.textContent=fmtBytes(d.traffic_bytes);
    qrShares.textContent=d.qr_shares==null?'–':d.qr_shares;
    qrBytes.textContent=fmtBytes(d.qr_bytes);
    const up=d.session?Math.round(d.session.uptime_s/60):0;
    meta.textContent='Session '+(d.session?d.session.id:'-')+' · '+up+' min · '
      +(d.stale_s==null?'keine Daten':'aktualisiert vor '+d.stale_s+'s');
  }catch(e){meta.textContent='offline';}
}
tick();setInterval(tick,5000);
</script></body></html>"""


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
