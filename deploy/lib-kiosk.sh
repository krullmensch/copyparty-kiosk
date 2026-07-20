#!/usr/bin/env bash
# shared helpers for the Agora kiosk setup scripts. sourced, not run directly.
# everything here is idempotent: safe to re-run on an already-provisioned kiosk.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="$(id -un)"
USER_HOME="$HOME"
AGORA_HOME="$USER_HOME/.agora"
FORCE="${FORCE:-0}"  # FORCE=1 overwrites display-stack files instead of gap-filling

log()  { printf '\033[36m::\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m ok\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  !\033[0m %s\n' "$*" >&2; }

# write $2 to file $1 only if missing, unless FORCE=1. returns 0 if written.
write_file() {
  local path="$1" content="$2"
  if [ "$FORCE" != "1" ] && [ -f "$path" ]; then
    ok "exists: $path (FORCE=1 to overwrite)"
    return 0
  fi
  mkdir -p "$(dirname "$path")"
  printf '%s' "$content" > "$path"
  ok "wrote: $path"
}

install_base_packages() {
  log "installing base packages (avahi/mDNS, X stack, helpers)"
  sudo apt-get update -q
  sudo apt-get install -y -q \
    avahi-daemon avahi-utils libnss-mdns \
    xserver-xorg xinit openbox unclutter x11vnc \
    scrot xdotool curl alsa-utils
  sudo systemctl enable --now avahi-daemon
  ok "base packages + avahi"
}

# The Optiplex analog output (front headphone jack) ships with Master muted at
# 0% on a fresh install, so Chromium plays silently. Unmute and raise the
# analog controls, then persist via alsactl so alsa-restore reapplies it on
# boot. Best-effort: missing controls (different codec) are skipped.
ensure_audio() {
  log "unmuting analog audio output"
  for ctl in Master Headphone Speaker "Line Out" PCM; do
    amixer -q sset "$ctl" unmute 2>/dev/null || true
  done
  amixer -q sset Master 80% 2>/dev/null || true
  sudo alsactl store 2>/dev/null || true
  ok "audio: analog output unmuted + stored"
}

write_role() {
  local role="$1"  # main | client
  mkdir -p "$AGORA_HOME"
  printf '%s\n' "$role" > "$AGORA_HOME/role"
  ok "role: $role  ($AGORA_HOME/role)"
}

# Admin password gating both the in-app reset panel (main only) and host
# changes in the admin panel (every kiosk) -- one password, one file
# (~/.agora/admin.hash, hex sha256; see agora-dashboard/server.py ADMIN_HASH).
# On the main kiosk this is normally set interactively in setup-main.sh; this
# is for kiosks without that prompt (clients). Provisioned from
# $AGORA_ADMIN_PW if set; without it the host stays locked (fail-closed) and
# can be set later by hand:
#   printf '%s' 'PW' | sha256sum | cut -d' ' -f1 > ~/.agora/admin.hash
provision_admin_password() {
  mkdir -p "$AGORA_HOME"
  if [ -n "${AGORA_ADMIN_PW:-}" ]; then
    printf '%s' "$AGORA_ADMIN_PW" | sha256sum | cut -d' ' -f1 > "$AGORA_HOME/admin.hash"
    chmod 600 "$AGORA_HOME/admin.hash"
    ok "admin password set ($AGORA_HOME/admin.hash)"
  elif [ ! -f "$AGORA_HOME/admin.hash" ]; then
    warn "no admin password: host changes stay locked until ~/.agora/admin.hash is set"
    warn "  set AGORA_ADMIN_PW and re-run, or: printf '%s' 'PW' | sha256sum | cut -d' ' -f1 > $AGORA_HOME/admin.hash"
  fi
}

# X autostart chain: getty autologin -> startx -> openbox -> electron kiosk.
# network-independent; only fills gaps unless FORCE=1.
ensure_display_stack() {
  log "ensuring display/autostart stack"

  write_file "$USER_HOME/xorg-monitor.conf" 'Section "Device"
    Identifier "Card0"
    Driver "modesetting"
EndSection
'
  write_file "$USER_HOME/xorg-headless.conf" 'Section "Monitor"
    Identifier "Monitor0"
    HorizSync 28.0-80.0
    VertRefresh 48.0-75.0
    Modeline "1920x1080" 172.80 1920 2040 2248 2576 1080 1081 1084 1118
EndSection

Section "Device"
    Identifier "Card0"
    Driver "dummy"
    VideoRam 256000
EndSection

Section "Screen"
    Identifier "Screen0"
    Device "Card0"
    Monitor "Monitor0"
    DefaultDepth 24
    SubSection "Display"
        Depth 24
        Modes "1920x1080"
        Virtual 1920 1080
    EndSubSection
EndSection
'

  write_file "$USER_HOME/start-electron.sh" '#!/bin/bash
sleep 3
export DISPLAY=:0
export XAUTHORITY='"$USER_HOME"'/.Xauthority
cd '"$REPO_DIR"'
exec /usr/bin/npx electron ./out/main/index.js --kiosk
'
  chmod +x "$USER_HOME/start-electron.sh"

  write_file "$USER_HOME/.xinitrc" '#!/bin/sh
exec openbox-session
'

  write_file "$USER_HOME/.config/openbox/autostart" '#!/bin/sh
xset s off
xset -dpms
xset s noblank
unclutter -idle 120 -root &

# VNC (optional): needs ~/.vnc/passwd (x11vnc -storepasswd)
if [ -f '"$USER_HOME"'/.vnc/passwd ]; then
  x11vnc -display :0 -auth '"$USER_HOME"'/.Xauthority -forever -loop \
    -noxdamage -repeat -rfbauth '"$USER_HOME"'/.vnc/passwd \
    -rfbport 5900 -shared -o /tmp/x11vnc.log &
fi

nohup '"$USER_HOME"'/start-electron.sh > /tmp/electron.log 2>&1 &
'

  # startx on tty1 login (append snippet once)
  if ! grep -q 'AGORA-AUTOSTART' "$USER_HOME/.bash_profile" 2>/dev/null; then
    cat >> "$USER_HOME/.bash_profile" <<EOF

# AGORA-AUTOSTART
if [ -z "\$DISPLAY" ] && [ "\$(tty)" = "/dev/tty1" ]; then
    if grep -l "^connected\$" /sys/class/drm/card*/status 2>/dev/null | grep -q . ; then
        sudo cp -f "\$HOME/xorg-monitor.conf" /etc/X11/xorg.conf.d/10-display.conf
    else
        sudo cp -f "\$HOME/xorg-headless.conf" /etc/X11/xorg.conf.d/10-display.conf
    fi
    exec startx -- vt1 &> /tmp/startx.log
fi
EOF
    ok "appended startx snippet to .bash_profile"
  else
    ok ".bash_profile autostart present"
  fi

  # getty autologin on tty1
  sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
  sudo tee /etc/systemd/system/getty@tty1.service.d/override.conf >/dev/null <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $USER_NAME --noclear %I \$TERM
EOF
  sudo mkdir -p /etc/X11/xorg.conf.d
  ok "getty autologin -> $USER_NAME"
}

build_app() {
  log "building Electron app (npm install + build)"
  command -v node >/dev/null || { warn "node not found; install Node.js first"; return 1; }
  cd "$REPO_DIR"
  npm install
  npm run build
  ok "app built -> out/"
}

# kill + relaunch the kiosk app into the running X session (if one is up)
restart_app() {
  pkill -f "electron ./out/main" 2>/dev/null || true
  sleep 2
  if [ -e /tmp/.X11-unix/X0 ]; then
    DISPLAY=:0 XAUTHORITY="$USER_HOME/.Xauthority" XDG_RUNTIME_DIR="/run/user/$(id -u)" \
      setsid bash -c "exec $USER_HOME/start-electron.sh" >/tmp/electron.log 2>&1 < /dev/null &
    ok "app relaunched on :0"
  else
    ok "no X session yet; app will start on next boot"
  fi
}
