# Headless ThinClient Setup — Dell OptiPlex 3050

Kiosk-Setup für Electron-App `copyparty-kiosk` auf Dell OptiPlex 3050 (i5, 8 GB RAM). Headless, neben Router, von überall via WireGuard (Fritz!Box) erreichbar — WireGuard läuft Netz-weit auf Fritz, kein Client-Setup nötig.

**Stack:** Debian 13 (trixie) + Openbox + Xdummy (virtuelles Display) + x11vnc + SSH + Electron.

---

## TL;DR — Neuen ThinClient ausrollen

Nach erfolgreichem Debian-Minimal-Install (Phase 1) und sudo-Setup (Phase 2.1) genügt am Ziel-Client **ein einziger Befehl**:

```bash
curl -fsSL https://raw.githubusercontent.com/krullmensch/copyparty-kiosk/main/provision.sh -o provision.sh
bash provision.sh
```

Script ist idempotent — sicher mehrfach auszuführen. Fragt interaktiv:
- Hostname (Default: `kiosk<N>`)
- VNC-Passwort
- Git-Branch (Default: `main`)

Macht dann automatisch:
1. apt update + base packages
2. SSH-Hardening (key-only)
3. X11 + Openbox + Xdummy + alle Electron-Deps
4. Xorg dummy-Driver config (1920×1080 virtuelles Display)
5. Autologin tty1 → startx → Openbox
6. VNC-Passwort speichern
7. Node 20 (NodeSource)
8. Repo clonen / pullen
9. `npm install && npm run build`
10. `start-electron.sh` + `dev.sh` + Openbox-Autostart schreiben
11. Reboot (optional)

Phasen 2–7 weiter unten dokumentieren was das Script intern macht — falls man manuell debuggen oder einzelne Schritte nachvollziehen muss.

---

## Phase 1 — Debian Install (einmalig mit Monitor + Keyboard)

### 1.1 USB-Stick bauen
- Download: https://www.debian.org/CD/netinst/ → `debian-13.x.x-amd64-netinst.iso`
- macOS: [balenaEtcher](https://etcher.balena.io/) auf USB flashen

### 1.2 BIOS OptiPlex 3050 (F2 beim Boot)
- **AC Recovery: Power On** (Strom zurück = bootet automatisch)
- **Wake on LAN: Enable** (optional)
- Secure Boot: Disable
- Boot Mode: UEFI

### 1.3 Debian Installer
- **Graphical Install**
- Hostname: `kiosk1`
- Domain: leer
- Root-Passwort: setzen (merken — `sudo` standardmäßig nicht drauf)
- User: `marvin`, Passwort setzen
- Partitionierung: Guided, use entire disk, all files in one partition
- **Software selection — WICHTIG:**
  - [x] SSH server
  - [x] standard system utilities
  - [ ] alle Desktop-Environments AUS
- GRUB: ja, auf `/dev/sda` (oder NVMe)
- Reboot → IP merken: `ip a` am ThinClient

### 1.4 SSH-Key vom Mac kopieren

Falls noch kein Key:
```bash
ssh-keygen -t ed25519 -C "marvin@krullmensch.de"
```

Dann:
```bash
ssh-copy-id marvin@<lokale-ip>
ssh marvin@<lokale-ip>
```

Ab jetzt headless. Monitor/Keyboard ab.

### 1.5 Mac SSH-Konfig
`~/.ssh/config`:
```
Host kiosk
    HostName 192.168.178.59
    User marvin
    ForwardAgent yes
    SetEnv TERM=xterm-256color
```

`SetEnv TERM=xterm-256color` ist Pflicht bei Ghostty als Terminal-Emulator — verhindert `Error opening terminal: xterm-ghostty` weil Debian die Ghostty-Terminfo nicht kennt.

Permanent-Alternative: vom Mac einmalig `infocmp -x | ssh kiosk -- tic -x -`.

---

## Phase 2 — sudo nachinstallieren + Hardening

### 2.1 sudo + sudoers (einmalig, Root-Login am ThinClient nötig)
Am ThinClient lokal oder via `ssh marvin@<ip>` und dann:
```bash
su -
apt install -y sudo
usermod -aG sudo marvin
echo "marvin ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/marvin
exit
exit
```
Neu einloggen damit sudo-Gruppe greift.

### 2.2 System aktualisieren + Basis-Pakete
```bash
sudo apt update && sudo DEBIAN_FRONTEND=noninteractive apt -y full-upgrade
sudo apt install -y curl wget git vim nano unattended-upgrades \
    build-essential ca-certificates gnupg lsb-release rsync
echo unattended-upgrades unattended-upgrades/enable_auto_updates boolean true | sudo debconf-set-selections
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
```

### 2.3 SSH absichern (Key-only)
```bash
sudo tee /etc/ssh/sshd_config.d/hardening.conf > /dev/null <<EOF
PasswordAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl restart ssh
```
`sshd -t` testet Config bevor Reload — kein Lockout-Risiko.

---

## Phase 3 — WireGuard

Fritz!Box-WireGuard läuft netz-weit. Vom Mac einmalig Profil aus der Fritz-UI importieren (Internet → Freigaben → VPN (WireGuard) → Neue Verbindung → „Gerät mit Heimnetz verbinden") → Mac-WireGuard-App, fertig.

ThinClient braucht **keine** WireGuard-Config — er ist Teil des Heim-LANs.

---

## Phase 4 — X11 + Openbox + Auto-Detect Display + Autologin

ThinClient soll **mit oder ohne Monitor** booten:
- **Monitor angeschlossen:** X nutzt `modesetting` (Intel-GPU), App ist auf dem Bildschirm sichtbar. x11vnc spiegelt das Bild für Remote-Zugriff → echte Spiegelung, kein zweites Fenster.
- **Kein Monitor:** X nutzt `xserver-xorg-video-dummy` (virtueller Framebuffer 1920×1080). Nur VNC zeigt die App.

Detection läuft in `~/.bash_profile` direkt vor `startx`: liest `/sys/class/drm/card*/status`, kopiert passendes Template nach `/etc/X11/xorg.conf.d/10-display.conf`, dann `startx`.

### 4.1 Pakete
```bash
sudo DEBIAN_FRONTEND=noninteractive apt install -y --no-install-recommends \
    xserver-xorg xserver-xorg-video-dummy xinit \
    x11-xserver-utils openbox xterm x11vnc unclutter \
    libgtk-3-0 libnotify4 libnss3 libxss1 libasound2t64 \
    libxtst6 xdg-utils libatspi2.0-0 libdrm2 libgbm1
```

**Wichtig:** `x11-xserver-utils` liefert `xset` — sonst failt Openbox-Autostart. `libasound2t64` (nicht `libasound2`) auf Debian 13.

### 4.2 Xorg-Templates (zwei Modi)

```bash
# Headless: virtueller Framebuffer
tee ~/xorg-headless.conf > /dev/null <<'EOF'
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

# Monitor angeschlossen: modesetting (Intel-GPU)
tee ~/xorg-monitor.conf > /dev/null <<'EOF'
Section "Device"
    Identifier "Card0"
    Driver "modesetting"
EndSection
EOF

sudo mkdir -p /etc/X11/xorg.conf.d
sudo rm -f /etc/X11/xorg.conf.d/10-headless.conf /etc/X11/xorg.conf.d/10-display.conf
```

Aktive Config wird beim Boot von `.bash_profile` gewählt (siehe 4.4).

### 4.3 Autologin tty1
```bash
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/override.conf > /dev/null <<'EOF'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin marvin --noclear %I $TERM
EOF
sudo systemctl daemon-reload
```

### 4.4 startx + Openbox
```bash
cat > ~/.xinitrc <<'EOF'
#!/bin/sh
exec openbox-session
EOF
chmod +x ~/.xinitrc

cat > ~/.bash_profile <<'EOF'
if [ -f ~/.bashrc ]; then . ~/.bashrc; fi

if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
    # Pick Xorg config based on whether a real monitor is plugged in
    if grep -l "^connected$" /sys/class/drm/card*/status 2>/dev/null | grep -q . ; then
        sudo cp -f "$HOME/xorg-monitor.conf" /etc/X11/xorg.conf.d/10-display.conf
    else
        sudo cp -f "$HOME/xorg-headless.conf" /etc/X11/xorg.conf.d/10-display.conf
    fi
    exec startx -- vt1 &> /tmp/startx.log
fi
EOF
```

### 4.5 Trigger
```bash
sudo systemctl restart getty@tty1
```
Check: `ps aux | grep -E "Xorg|openbox"` muss beide zeigen.

---

## Phase 5 — x11vnc via Openbox-Autostart

**Wichtig:** x11vnc-systemd-Service produziert Ordering-Cycle mit `graphical.target`. Stattdessen aus Openbox-Autostart starten (X-Session bereits da, kein Race).

### 5.1 VNC-Passwort
```bash
mkdir -p ~/.vnc
x11vnc -storepasswd '<DEIN_PASSWORT>' ~/.vnc/passwd
```

### 5.2 Openbox-Autostart (Phase 5 + 6 kombiniert)
Wird in 6.3 zusammen mit Electron geschrieben.

---

## Phase 6 — Node + Electron App

### 6.1 Node 20 via NodeSource
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo DEBIAN_FRONTEND=noninteractive apt install -y nodejs
node -v && npm -v
```

### 6.2 App-Sync vom Mac
```bash
cd /Users/mkrullmann/Documents/GitHub/copyparty-kiosk
rsync -az --delete \
    --exclude node_modules --exclude out --exclude build \
    --exclude .git --exclude "*.tsbuildinfo" \
    ./ marvin@192.168.178.59:~/copyparty-kiosk/
```

Am ThinClient bauen:
```bash
ssh kiosk "cd ~/copyparty-kiosk && npm install && npm run build"
```

### 6.3 Electron-Launcher-Script
Standalone-Script wegen Detach-Problemen (siehe Troubleshooting):
```bash
cat > ~/start-electron.sh <<'EOF'
#!/bin/bash
sleep 3
export DISPLAY=:0
export XAUTHORITY=/home/marvin/.Xauthority
cd /home/marvin/copyparty-kiosk
exec /usr/bin/npx electron ./out/main/index.js --kiosk
EOF
chmod +x ~/start-electron.sh
```

**Anmerkung:** Kein `--remote-debugging-port`. Chrome-DevTools-Remote-Workflow wurde verworfen — siehe Abschnitt „Debugging-Strategie" unten.

### 6.4 Openbox-Autostart (final)
```bash
mkdir -p ~/.config/openbox
cat > ~/.config/openbox/autostart <<'EOF'
#!/bin/sh
xset s off
xset -dpms
xset s noblank
unclutter -idle 120 -root &

# VNC server — MUSS mit & im Hintergrund, sonst blockt -loop den Autostart
x11vnc -display :0 -auth /home/marvin/.Xauthority -forever -loop \
    -noxdamage -repeat -rfbauth /home/marvin/.vnc/passwd \
    -rfbport 5900 -shared -o /tmp/x11vnc.log &

# Electron via standalone script + nohup
nohup /home/marvin/start-electron.sh > /tmp/electron.log 2>&1 &
EOF
```

**Wichtige Lessons:**
- `x11vnc -loop` ignoriert `-bg`. Ohne `&` am Zeilenende blockt es und Electron wird nie gestartet.
- Inline-Electron-Start mit `setsid` / komplexen Subshells im Autostart ist fragil. Standalone-Script ist robust.
- Backslash-Quoting bei `--remote-allow-origins=*` über mehrere Heredoc-Ebenen ist fehleranfällig. Im Standalone-Script direkt.

### 6.5 Test
```bash
sudo reboot
```
Nach Reboot vom Mac:
```bash
ssh kiosk 'ss -tlnp | grep -E ":22|:5900"; ps aux | grep electron | grep -v grep | wc -l'
```
Sollte SSH-Port + VNC-Port + mehrere Electron-Prozesse zeigen.

---

## Phase 7 — Remote Dev-Workflow

### 7.1 VNC vom Mac
Finder → `Cmd+K` → `vnc://192.168.178.59:5900` → Passwort.
Alternative: [TigerVNC Viewer](https://github.com/TigerVNC/tigervnc/releases) / [RealVNC](https://www.realvnc.com/de/connect/download/viewer/).

### 7.2 Debugging-Strategie (Vibe-Coding mit Claude)

**Chrome-DevTools-Remote wurde verworfen.** Gründe nach Praxistest:
- `chrome://inspect`-Frontend lädt von Google-CDN; Electron-39-Chromium-Hash nicht (mehr) gehostet → 404 in der DevTools-UI.
- Workaround `devtools://devtools/bundled/...` lässt sich von außen nicht in Chrome navigieren (Chrome blockt internal schemes via window.location).
- DevTools direkt in Electron öffnen (`openDevTools`) funktioniert + via VNC sichtbar, aber im Kiosk-Display unpraktisch.
- 95 % der Debug-Aufgaben beim Vibe-Coding mit einem KI-Agent (Claude) decken sich mit dem, was `tail /tmp/electron.log` + Code-Lesen liefern.

**Effektiver Workflow stattdessen:**

| Debug-Bedarf | Werkzeug |
|---|---|
| Renderer-/Main-Console-Output, Errors | `ssh kiosk tail -f /tmp/electron.log` |
| System-Events, Crashes | `ssh kiosk journalctl -f` |
| App optisch testen | VNC |
| Code lesen / patchen | VS Code Remote-SSH oder Mac-Edit + rsync |
| DOM-Inspect, CSS-Live-Tweak | seltener Bedarf — bei Bedarf `KIOSK_DEVTOOLS=1` reaktivieren (siehe „On-Demand DevTools" unten) |

### 7.2a On-Demand DevTools (optional, falls mal nötig)

In `src/main/index.ts` (gated):
```ts
mainWindow.on('ready-to-show', () => {
  mainWindow.show()
  if (process.env.KIOSK_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
})
```
Start mit Flag:
```bash
ssh kiosk 'KIOSK_DEVTOOLS=1 ~/dev.sh'
```
DevTools-Fenster öffnet detached auf X-Display :0 → via VNC sichtbar.

### 7.3 VS Code Remote-SSH
- Extension: [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh)
- `Cmd+Shift+P` → Remote-SSH: Connect to Host → `kiosk`

### 7.4 Dev-Restart-Script
```bash
cat > ~/dev.sh <<'EOF'
#!/bin/bash
pkill -9 -f "electron" || true
sleep 2
cd /home/marvin/copyparty-kiosk
DISPLAY=:0 nohup npx electron ./out/main/index.js --kiosk > /tmp/electron.log 2>&1 &
echo "started, pid=$!"
EOF
chmod +x ~/dev.sh
```

**Wichtig:** `pkill -9 -f "electron"` killt **alle** Electron-Prozesse (Zygotes, Renderer, GPU-Helper). Engerer Pattern `electron .*copyparty-kiosk` matched nicht alle Helper → Port-Konflikte beim Neustart.

Vom Mac: `ssh kiosk ~/dev.sh`

### 7.5 Code-Sync-Workflow
Code editieren am Mac → push:
```bash
rsync -az --delete --exclude node_modules --exclude out --exclude .git \
    /Users/mkrullmann/Documents/GitHub/copyparty-kiosk/ \
    kiosk:~/copyparty-kiosk/
ssh kiosk 'cd ~/copyparty-kiosk && npm run build && ~/dev.sh'
```

### 7.6 Logs live
```bash
ssh kiosk tail -f /tmp/electron.log
ssh kiosk journalctl -f
```

---

## Cheatsheet

| Aufgabe | Befehl |
|---|---|
| Login | `ssh kiosk` |
| GUI sehen | `vnc://192.168.178.59:5900` |
| App neustarten | `ssh kiosk ~/dev.sh` |
| Code editieren | VS Code → Remote-SSH `kiosk` |
| Electron debuggen | `ssh kiosk tail -f /tmp/electron.log` (DevTools nur on-demand mit `KIOSK_DEVTOOLS=1`) |
| Code sync | `rsync -az --delete --exclude node_modules --exclude out --exclude .git ~/Documents/GitHub/copyparty-kiosk/ kiosk:~/copyparty-kiosk/` |
| Build remote | `ssh kiosk 'cd ~/copyparty-kiosk && npm run build'` |
| Reboot | `ssh kiosk sudo reboot` |
| Update | `ssh kiosk "sudo apt update && sudo apt full-upgrade -y"` |
| Electron log | `ssh kiosk tail -f /tmp/electron.log` |

---

## Troubleshooting / Lessons Learned aus diesem Setup

### `ssh-copy-id: No identities found`
Kein Mac-SSH-Key. `ssh-keygen -t ed25519` ausführen.

### `No route to host`
- ThinClient online? `ping <ip>`
- IP-Wechsel? http://fritz.box → Heimnetz → Netzwerk
- WireGuard am Mac an obwohl lokal? → aus

### `sudo: command not found`
Debian-Minimal hat kein sudo. Als root via `su -` einloggen, `apt install sudo`, `usermod -aG sudo marvin`.

### `Error opening terminal: xterm-ghostty`
Ghostty-Terminfo fehlt auf Debian. `SetEnv TERM=xterm-256color` in `~/.ssh/config` ODER `infocmp -x | ssh kiosk -- tic -x -` vom Mac.

### `systemctl edit` schreibt nichts / „after editing, new contents are empty"
Editor failed (oft Terminfo-Problem) → leeres File → systemd discard. Direkt mit `tee` an `/etc/systemd/system/<unit>.d/override.conf` arbeiten, dann `daemon-reload`.

### Heredoc `EOF` Warning
`EOF` muss am Zeilenanfang stehen, keine führenden Spaces.

### `xset: not found` in Openbox-Autostart
Paket `x11-xserver-utils` fehlt. Standard-Xorg-Install zieht das nicht automatisch.

### x11vnc startet beim Boot nicht (systemd-Variante)
systemd-Service mit `After=graphical.target` + `WantedBy=multi-user.target` produziert Ordering-Cycle. **Lösung:** x11vnc aus Openbox-Autostart starten — X läuft dann garantiert.

### Electron startet nicht aus Openbox-Autostart
Mehrere Ursachen erlebt:
1. **x11vnc -loop ohne `&`:** blockt Autostart → Electron-Zeile wird nie erreicht. Mit `&` backgrounden.
2. **`setsid sh -c "..."`-Konstrukt:** im Autostart fragil, Quoting über mehrere Heredoc-Ebenen failt still. → Standalone-Launcher-Script.
3. **`npx` nicht im PATH:** Openbox-Autostart erbt nicht zwingend interaktiven Shell-PATH. Absoluten Pfad `/usr/bin/npx` nutzen.
4. **Race mit X-Display:** Launcher-Script `sleep 3` vor Electron-Start, sonst „Missing X server or $DISPLAY".

### `Exiting GPU process due to errors during initialization`
Harmlos. `dummy`-Driver hat keine GPU-Beschleunigung. Electron fällt auf Software-Rendering zurück und läuft normal.

### Audio über VNC
Geht nicht. Bei Audio-Bedarf: PulseAudio über SSH oder NoMachine.

### Kasten bleibt nach Stromausfall aus
BIOS: AC Recovery = Power On.

### Electron als root
**Niemals.** Bleibt User `marvin`.

### Sich selbst aussperren beim Config-Editieren
Goldene Regel: **niemals SSH-Daemon-Config ändern ohne zweite SSH-Session offen UND `sudo sshd -t` vor Restart.** Bei Autologin-Änderungen: SSH-Session muss aktiv bleiben — über die kommst du wieder rein, egal was tty1 macht.

---

## Wichtige Links

- Debian netinst: https://www.debian.org/CD/netinst/
- Fritz!Box WireGuard: https://avm.de/service/wissensdatenbank/dok/FRITZ-Box-7590-AX/3683_WireGuard-VPN-zur-FRITZ-Box-einrichten/
- TigerVNC Viewer: https://github.com/TigerVNC/tigervnc/releases
- VS Code Remote-SSH: https://code.visualstudio.com/docs/remote/ssh
- Electron Debug-Flag: https://www.electronjs.org/docs/latest/tutorial/debugging-main-process
- Openbox Autostart: http://openbox.org/wiki/Help:Autostart
- balenaEtcher: https://etcher.balena.io/
- NodeSource Debian: https://github.com/nodesource/distributions
