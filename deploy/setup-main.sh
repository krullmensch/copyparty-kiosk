#!/usr/bin/env bash
#
# Agora MAIN kiosk setup.
#
# Provisions the one kiosk that runs the shared services: copyparty file
# server, the FritzBox client-tracking poller, and the dashboard HTTP server.
# Also sets up the display/autostart stack and builds the Electron app.
#
# Idempotent: safe to re-run. Run as the kiosk user (with sudo available):
#   ./deploy/setup-main.sh
#
# Network portability: all addressing is by name (kiosk2.local via avahi,
# fritz.box via the FritzBox's own DNS), so moving to another network needs
# no reconfiguration -- plug in and boot.
#
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib-kiosk.sh"

AGORA_SRC="$REPO_DIR/agora-dashboard"
VENV="$AGORA_SRC/.venv"
PY="$VENV/bin/python"

log "Agora MAIN kiosk setup  (repo: $REPO_DIR)"

install_base_packages
sudo apt-get install -y -q python3-venv python3-full
write_role main

# --- python env for the dashboard backend ---
log "python venv for agora-dashboard"
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r "$AGORA_SRC/requirements.txt"
ok "venv ready ($("$PY" -c 'import flask,fritzconnection;print("flask",flask.__version__)'))"

mkdir -p "$AGORA_HOME"; chmod 700 "$AGORA_HOME"

# --- admin password (gates the in-app reset panel) ---
if [ "$FORCE" = "1" ] || [ ! -f "$AGORA_HOME/admin.hash" ]; then
  read -rsp "Set ADMIN password (for the in-app reset panel): " A1; echo
  read -rsp "Repeat admin password: " A2; echo
  if [ -z "$A1" ] || [ "$A1" != "$A2" ]; then
    warn "passwords empty or mismatched; keeping any existing admin.hash"
  else
    printf '%s' "$A1" | sha256sum | cut -d' ' -f1 > "$AGORA_HOME/admin.hash"
    chmod 600 "$AGORA_HOME/admin.hash"
    ok "admin password set"
  fi
else
  ok "admin password already set (FORCE=1 to change)"
fi

# --- QR-share password (auth for copyparty qr: account) ---
# Charset hard-limited to [A-Za-z0-9]: this value is interpolated unquoted
# into the copyparty.service ExecStart= line below (SHARE_ARGS="-a qr:$SHARE_PW ...").
# A space would inject an extra positional arg into copyparty-sfx.py; a "%"
# is parsed by systemd as a (usually invalid) unit-file specifier. Either one
# crashes the WHOLE copyparty service (crash-loop), not just QR-share -- same
# ExecStart line. Escaping is fragile here, so the charset is restricted
# instead of trying to quote it correctly.
if [ "$FORCE" = "1" ] || [ ! -f "$AGORA_HOME/share.pw" ]; then
  SHP=""
  while [ -z "$SHP" ]; do
    read -rsp "Set QR-SHARE password (letters/digits only, empty = generate): " INPUT; echo
    if [ -z "$INPUT" ]; then
      SHP=$(openssl rand -hex 16)
      echo "  Generated: $SHP"
    elif [[ "$INPUT" =~ ^[A-Za-z0-9]+$ ]]; then
      SHP="$INPUT"
    else
      warn "password must match ^[A-Za-z0-9]+\$ (no spaces, no '%', no punctuation) -- try again"
    fi
  done
  printf '%s' "$SHP" > "$AGORA_HOME/share.pw"
  chmod 600 "$AGORA_HOME/share.pw"
  ok "QR-share password set"
else
  ok "QR-share password already set (FORCE=1 to change)"
fi

# --- FritzBox password (optional; absent => tracking disabled + button hidden) ---
TRACKING=0
if [ "$FORCE" = "1" ] || [ ! -f "$AGORA_HOME/fritz.env" ]; then
  read -rsp "FritzBox password (empty = disable client tracking): " FP; echo
  if [ -n "$FP" ]; then
    umask 077
    printf 'FRITZ_PASSWORD=%s\n' "$FP" > "$AGORA_HOME/fritz.env"
    chmod 600 "$AGORA_HOME/fritz.env"
    TRACKING=1
    ok "FritzBox password stored -> tracking enabled"
  else
    rm -f "$AGORA_HOME/fritz.env"
    warn "no FritzBox password -> tracking disabled, stats button hidden"
  fi
else
  TRACKING=1
  ok "FritzBox password already set (FORCE=1 to change)"
fi

# --- copyparty system service ---
if [ -f "$USER_HOME/copyparty-sfx.py" ]; then
  log "installing copyparty.service"
  SHARE_PW=$(cat "$AGORA_HOME/share.pw" 2>/dev/null || echo "")
  if [ -z "$SHARE_PW" ]; then
    warn "share.pw not found; QR-share will not work. Re-run setup-main.sh to set it."
    SHARE_ARGS=""
  else
    SHARE_ARGS="-a qr:$SHARE_PW --shr /s --shr-rt 60"
  fi
  sudo tee /etc/systemd/system/copyparty.service >/dev/null <<EOF
[Unit]
Description=copyparty file server
After=network.target

[Service]
Type=simple
User=$USER_NAME
ExecStart=/usr/bin/python3 $USER_HOME/copyparty-sfx.py -p 3923 -i 0.0.0.0 -v $USER_HOME/copyparty-data:/:rwd -e2dsa --no-ses --daw --u2ow 2 -lo $USER_HOME/copyparty-logs/cpp-%%Y-%%m-%%d.txt $SHARE_ARGS
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  mkdir -p "$USER_HOME/copyparty-data" "$USER_HOME/copyparty-logs"
  sudo systemctl daemon-reload
  sudo systemctl enable copyparty.service
  # always restart (not enable --now): --now is a no-op on an already-active
  # unit, so a re-run against an existing kiosk2 would keep the OLD ExecStart
  # args running (e.g. stale/missing SHARE_ARGS) while claiming "enabled".
  # Restarting unconditionally makes the running process match what was just
  # written, so this status line is never a lie.
  sudo systemctl restart copyparty.service
  ok "copyparty.service (re)started on :3923 (QR-share: $([ -n "$SHARE_ARGS" ] && echo enabled || echo DISABLED))"
else
  warn "copyparty-sfx.py not at $USER_HOME -- skipping copyparty.service"
  warn "  download it from https://github.com/9001/copyparty/releases and re-run"
fi

# --- self-resolution of <hostname>.local to loopback ---
# The kiosk app addresses copyparty as <this-host>.local:3923 everywhere. On the
# main kiosk that name refers to itself, and avahi may resolve it to an IPv6
# address copyparty (IPv4 0.0.0.0) isn't listening on -- the in-process media
# server's fetch() then fails with 502 and video preview shows "codec not
# supported". Pin the own .local name to IPv4 loopback so self-requests work.
SELF_LOCAL="$(hostname).local"
if ! grep -q "127.0.0.1 $SELF_LOCAL" /etc/hosts; then
  log "pinning $SELF_LOCAL -> 127.0.0.1 in /etc/hosts"
  echo "127.0.0.1 $SELF_LOCAL" | sudo tee -a /etc/hosts >/dev/null
  ok "$SELF_LOCAL resolves to loopback"
fi

# --- agora user services (server always; poller only if tracking on) ---
log "installing agora systemd user services"
mkdir -p "$USER_HOME/.config/systemd/user"

cat > "$USER_HOME/.config/systemd/user/agora-server.service" <<EOF
[Unit]
Description=Agora dashboard HTTP server (port 8080)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$AGORA_SRC
ExecStart=$PY server.py
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

cat > "$USER_HOME/.config/systemd/user/agora-poller.service" <<EOF
[Unit]
Description=Agora FritzBox client-tracking poller
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$AGORA_SRC
EnvironmentFile=$AGORA_HOME/fritz.env
ExecStart=$PY poller.py run --interval 60
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

sudo loginctl enable-linger "$USER_NAME"
systemctl --user daemon-reload
systemctl --user enable --now agora-server.service
if [ "$TRACKING" = "1" ]; then
  systemctl --user enable --now agora-poller.service
  ok "poller + server running"
else
  systemctl --user disable --now agora-poller.service 2>/dev/null || true
  ok "server running, poller disabled (no FritzBox password)"
fi

ensure_audio
ensure_display_stack
build_app
restart_app

log "MAIN kiosk setup complete."
echo "  - dashboard:  http://kiosk2.local:8080/stats   (also /dashboard, /healthz)"
echo "  - copyparty:  http://kiosk2.local:3923"
echo "  - tracking:   $([ "$TRACKING" = 1 ] && echo enabled || echo DISABLED)"
echo "  - reset:      5 clicks on the title in the app -> admin password"
