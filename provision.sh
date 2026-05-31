#!/bin/bash
# Copyparty-Kiosk ThinClient Provisioning Script
# Idempotent — safe to re-run.
#
# Voraussetzungen am Ziel-ThinClient:
#   - Frische Debian 12/13 minimal Installation (kein Desktop)
#   - User `marvin` existiert
#   - sudo NOPASSWD für marvin eingerichtet
#   - SSH-Server aktiv, Key vom Mac kopiert
#   - Internet-Verbindung
#
# Aufruf am ThinClient (via SSH oder lokal als marvin):
#   curl -fsSL https://raw.githubusercontent.com/krullmensch/copyparty-kiosk/main/provision.sh -o provision.sh
#   bash provision.sh

set -euo pipefail

# ---- Style ----
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

log()   { echo -e "${GREEN}==>${RESET} ${BOLD}$*${RESET}"; }
warn()  { echo -e "${YELLOW}!! ${RESET} $*"; }
fail()  { echo -e "${RED}XX ${RESET} $*" >&2; exit 1; }

# ---- Preflight ----
[[ $EUID -eq 0 ]] && fail "Nicht als root starten — laufe als User marvin. sudo wird im Skript genutzt."
[[ "$(whoami)" != "marvin" ]] && fail "Skript erwartet User 'marvin' (aktuell: $(whoami))."
command -v sudo >/dev/null || fail "sudo fehlt. Erst: 'su -' und 'apt install sudo && usermod -aG sudo marvin && echo \"marvin ALL=(ALL) NOPASSWD:ALL\" > /etc/sudoers.d/marvin'"
sudo -n true 2>/dev/null || fail "sudo NOPASSWD nicht eingerichtet. Erst: 'echo \"marvin ALL=(ALL) NOPASSWD:ALL\" | sudo tee /etc/sudoers.d/marvin'"

# ---- Interactive setup ----
echo
echo -e "${BOLD}=== Copyparty-Kiosk ThinClient Provisioning ===${RESET}"
echo

DEFAULT_HOSTNAME="kiosk$(hostname | grep -oE '[0-9]+$' || echo 1)"
read -rp "Hostname für diesen Client [${DEFAULT_HOSTNAME}]: " HOSTNAME_INPUT
KIOSK_HOSTNAME="${HOSTNAME_INPUT:-$DEFAULT_HOSTNAME}"

read -rsp "VNC-Passwort (für x11vnc, mind. 6 Zeichen): " VNC_PASSWORD
echo
[[ ${#VNC_PASSWORD} -lt 6 ]] && fail "VNC-Passwort zu kurz."

read -rp "Git-Branch von copyparty-kiosk [main]: " GIT_BRANCH
GIT_BRANCH="${GIT_BRANCH:-main}"

REPO_URL="https://github.com/krullmensch/copyparty-kiosk.git"
APP_DIR="$HOME/copyparty-kiosk"

echo
log "Konfiguration:"
echo "    Hostname:    $KIOSK_HOSTNAME"
echo "    Git-Branch:  $GIT_BRANCH"
echo "    App-Dir:     $APP_DIR"
echo "    Repo:        $REPO_URL"
echo
read -rp "Weiter? [Y/n] " CONFIRM
[[ "${CONFIRM:-Y}" =~ ^[Yy]?$ ]] || fail "Abgebrochen."

# ---- Hostname ----
log "Setze Hostname auf $KIOSK_HOSTNAME"
sudo hostnamectl set-hostname "$KIOSK_HOSTNAME"
if ! grep -q "127.0.1.1.*$KIOSK_HOSTNAME" /etc/hosts; then
    sudo sed -i "s/^127.0.1.1.*/127.0.1.1\t$KIOSK_HOSTNAME/" /etc/hosts || \
        echo "127.0.1.1 $KIOSK_HOSTNAME" | sudo tee -a /etc/hosts
fi

# ---- APT update + base packages ----
log "Aktualisiere System + installiere Basis-Pakete"
sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt -y full-upgrade
sudo DEBIAN_FRONTEND=noninteractive apt install -y \
    curl wget git vim nano unattended-upgrades \
    build-essential ca-certificates gnupg lsb-release rsync

echo unattended-upgrades unattended-upgrades/enable_auto_updates boolean true | sudo debconf-set-selections
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

# ---- SSH hardening ----
log "Härte SSH (key-only, no root)"
sudo tee /etc/ssh/sshd_config.d/hardening.conf > /dev/null <<EOF
PasswordAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl restart ssh

# ---- X11 + Openbox + Xdummy + Electron deps ----
log "Installiere X11, Openbox, x11vnc, Electron-Abhängigkeiten"
# libasound2t64 auf Debian 13, libasound2 auf Debian 12 — beide versuchen
sudo DEBIAN_FRONTEND=noninteractive apt install -y --no-install-recommends \
    xserver-xorg xserver-xorg-video-dummy xinit \
    x11-xserver-utils openbox xterm x11vnc unclutter \
    libgtk-3-0 libnotify4 libnss3 libxss1 \
    libxtst6 xdg-utils libatspi2.0-0 libdrm2 libgbm1 || true
# Audio-Lib version-abhängig
sudo DEBIAN_FRONTEND=noninteractive apt install -y libasound2t64 2>/dev/null || \
    sudo DEBIAN_FRONTEND=noninteractive apt install -y libasound2 2>/dev/null || \
    warn "libasound2 nicht installierbar — Electron audio evtl. eingeschränkt"

# ---- Xorg dummy config ----
log "Schreibe Xorg dummy-Driver Config (headless display 1920x1080)"
sudo mkdir -p /etc/X11/xorg.conf.d
sudo tee /etc/X11/xorg.conf.d/10-headless.conf > /dev/null <<'EOF'
Section "Monitor"
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
EOF

# ---- Autologin tty1 ----
log "Aktiviere Autologin auf tty1 für marvin"
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/override.conf > /dev/null <<'EOF'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin marvin --noclear %I $TERM
EOF
sudo systemctl daemon-reload

# ---- .xinitrc + .bash_profile ----
log "Schreibe .xinitrc + .bash_profile (startx auf tty1)"
cat > ~/.xinitrc <<'EOF'
#!/bin/sh
exec openbox-session
EOF
chmod +x ~/.xinitrc

cat > ~/.bash_profile <<'EOF'
if [ -f ~/.bashrc ]; then . ~/.bashrc; fi

if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec startx -- vt1 &> /tmp/startx.log
fi
EOF

# ---- VNC password ----
log "Setze VNC-Passwort"
mkdir -p ~/.vnc
x11vnc -storepasswd "$VNC_PASSWORD" ~/.vnc/passwd >/dev/null
chmod 600 ~/.vnc/passwd

# ---- Node 20 via NodeSource ----
if ! command -v node >/dev/null || [[ "$(node -v 2>/dev/null)" != v20.* ]]; then
    log "Installiere Node.js 20 (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo DEBIAN_FRONTEND=noninteractive apt install -y nodejs
else
    log "Node.js 20 bereits installiert: $(node -v)"
fi

# ---- Clone / pull copyparty-kiosk ----
if [[ -d "$APP_DIR/.git" ]]; then
    log "App-Repo existiert — pulle Updates aus Branch $GIT_BRANCH"
    git -C "$APP_DIR" fetch origin
    git -C "$APP_DIR" checkout "$GIT_BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$GIT_BRANCH"
else
    log "Clone Repo nach $APP_DIR (Branch $GIT_BRANCH)"
    git clone --branch "$GIT_BRANCH" "$REPO_URL" "$APP_DIR"
fi

# ---- npm install + build ----
log "npm install"
cd "$APP_DIR"
npm install
log "npm run build"
npm run build

# ---- Electron-Launcher + Dev-Script ----
log "Schreibe ~/start-electron.sh + ~/dev.sh"
cat > ~/start-electron.sh <<EOF
#!/bin/bash
sleep 3
export DISPLAY=:0
export XAUTHORITY=$HOME/.Xauthority
cd $APP_DIR
exec /usr/bin/npx electron ./out/main/index.js --kiosk
EOF
chmod +x ~/start-electron.sh

cat > ~/dev.sh <<EOF
#!/bin/bash
pkill -9 -f "electron" || true
sleep 2
cd $APP_DIR
DISPLAY=:0 nohup npx electron ./out/main/index.js --kiosk > /tmp/electron.log 2>&1 &
echo "started, pid=\$!"
EOF
chmod +x ~/dev.sh

# ---- Openbox autostart ----
log "Schreibe Openbox-Autostart (x11vnc + electron)"
mkdir -p ~/.config/openbox
cat > ~/.config/openbox/autostart <<EOF
#!/bin/sh
xset s off
xset -dpms
xset s noblank
unclutter -idle 0.1 -root &

# VNC server (background mit & — sonst blockt -loop den Autostart)
x11vnc -display :0 -auth /home/marvin/.Xauthority -forever -loop \\
    -noxdamage -repeat -rfbauth /home/marvin/.vnc/passwd \\
    -rfbport 5900 -shared -o /tmp/x11vnc.log &

# Electron-Kiosk via standalone launcher
nohup /home/marvin/start-electron.sh > /tmp/electron.log 2>&1 &
EOF

# ---- Done ----
echo
log "Provisionierung fertig."
echo
echo "  Hostname:      $KIOSK_HOSTNAME"
echo "  IP:            $(hostname -I | awk '{print $1}')"
echo "  VNC:           vnc://$(hostname -I | awk '{print $1}'):5900"
echo "  SSH:           ssh marvin@$(hostname -I | awk '{print $1}')"
echo
echo "  Reboot empfohlen — alle Services starten automatisch."
read -rp "  Jetzt rebooten? [Y/n] " REBOOT_NOW
[[ "${REBOOT_NOW:-Y}" =~ ^[Yy]?$ ]] && sudo reboot
