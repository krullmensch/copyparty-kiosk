#!/usr/bin/env bash
#
# Agora FRESH reset.
#
# Wipes runtime DATA and returns the kiosk to name-based (mDNS) addressing so
# the whole setup is portable to a new network: run this, move to the new net,
# plug in, boot -- kiosk2.local resolves via avahi, no IP reconfiguration.
#
# Role-aware (reads ~/.agora/role, written by the setup scripts):
#   main (kiosk2): stops services, wipes copyparty files + tracking DB + stale
#                  shares, drops the admin/session-reset password, un-pins the
#                  host, restarts services + app.
#   client:        drops the admin password, un-pins the host + any stale
#                  /etc/hosts kiosk2.local override, restarts app.
#
# KEEPS on every role: QR-share password (~/.agora/share.pw) and the copyparty
# `qr:` account (Agora-net QR codes + the /up page keep working), FritzBox
# tracking password (~/.agora/fritz.env), the copyparty.service unit, role,
# display stack, and the built app.
#
# DESTRUCTIVE. Run as the kiosk user (sudo available). Confirm with a typed
# "yes", or set YES=1 for non-interactive:
#   ./deploy/reset-fresh.sh
#   YES=1 ./deploy/reset-fresh.sh
#
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib-kiosk.sh"

# --- role -------------------------------------------------------------------
ROLE="$(cat "$AGORA_HOME/role" 2>/dev/null || true)"
if [ -z "$ROLE" ]; then
  # fall back to hostname: the main kiosk is kiosk2
  if [ "$(hostname)" = "kiosk2" ]; then ROLE=main; else ROLE=client; fi
  warn "no $AGORA_HOME/role file; assuming role=$ROLE from hostname"
fi
log "Agora FRESH reset  (role: $ROLE, host: $(hostname))"

# --- confirmation (destructive) --------------------------------------------
echo "This will PERMANENTLY delete:"
if [ "$ROLE" = "main" ]; then
  echo "  - all files in $USER_HOME/copyparty-data/  (incl. index/.hist)"
  echo "  - tracking database $AGORA_HOME/agora.db  (sessions + samples)"
  echo "  - stale QR shares  ~/.config/copyparty/shares.db"
fi
echo "  - admin/session-reset password  $AGORA_HOME/admin.hash"
echo "and switch addressing back to name-based (kiosk2.local via mDNS)."
echo "KEPT: QR-share password, FritzBox password, services, app build."
if [ "${YES:-0}" != "1" ]; then
  read -rp "Type 'yes' to proceed: " CONFIRM
  [ "$CONFIRM" = "yes" ] || { warn "aborted"; exit 1; }
fi

# --- main: wipe data (stop services first to release locks) -----------------
if [ "$ROLE" = "main" ]; then
  log "stopping services"
  sudo systemctl stop copyparty.service 2>/dev/null || true
  systemctl --user stop agora-server.service agora-poller.service 2>/dev/null || true

  log "wiping copyparty data"
  rm -rf "$USER_HOME/copyparty-data"
  mkdir -p "$USER_HOME/copyparty-data"
  ok "copyparty-data emptied"

  rm -f "$AGORA_HOME/agora.db"
  ok "tracking DB removed (fresh session on next poll)"

  rm -f "$USER_HOME/.config/copyparty/shares.db"
  ok "stale QR shares removed (share.pw + qr: account kept)"
fi

# --- every role: drop admin password + go name-based ------------------------
rm -f "$AGORA_HOME/admin.hash"
ok "admin/session-reset password removed (re-set via FORCE=1 setup on demand)"

rm -f "$AGORA_HOME/host"
ok "host un-pinned -> app uses kiosk2.local (mDNS)"

# remove any stale IP pin of kiosk2.local in /etc/hosts (keep 127.0.0.1 line on
# the main kiosk -- that's the self-loopback fix, not an IP pin).
if grep -qE '^192\.168\..* kiosk2\.local' /etc/hosts 2>/dev/null; then
  sudo sed -i.bak-resetfresh '/^192\.168\..* kiosk2\.local/d' /etc/hosts
  ok "removed stale kiosk2.local IP pin from /etc/hosts"
fi

# --- restart -----------------------------------------------------------------
if [ "$ROLE" = "main" ]; then
  log "restarting services"
  sudo systemctl start copyparty.service 2>/dev/null || true
  systemctl --user start agora-server.service 2>/dev/null || true
  [ -f "$AGORA_HOME/fritz.env" ] && systemctl --user start agora-poller.service 2>/dev/null || true
  ok "services restarted"
fi

restart_app

log "FRESH reset complete. Move to the new network, plug in, boot."
echo "  - addressing: kiosk2.local (mDNS) -- portable, no IP config"
echo "  - admin reset panel: locked until an admin password is set again"
echo "    (FORCE=1 ./deploy/setup-main.sh, or write ~/.agora/admin.hash by hand)"
