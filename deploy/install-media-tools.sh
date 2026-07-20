#!/usr/bin/env bash
# Installs the optical-media rip/burn stack the kiosk app shells out to.
# Idempotent — safe to re-run. Requires internet.
#
#   sudo bash deploy/install-media-tools.sh
#
set -euo pipefail

log()  { printf '\033[1;34m[media]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[media] WARN:\033[0m %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

. /etc/os-release
CODENAME="${VERSION_CODENAME:-$(lsb_release -cs 2>/dev/null || echo unknown)}"
log "distro: ${ID:-?} ${VERSION_ID:-?} ($CODENAME)"

# ---- enable contrib (Debian) / multiverse (Ubuntu) for libdvdcss ----
enable_nonfree_repo() {
  if [ "${ID:-}" = "ubuntu" ]; then
    log "enabling multiverse"
    add-apt-repository -y multiverse || warn "add-apt-repository failed"
  elif [ -f /etc/apt/sources.list.d/debian.sources ]; then
    # deb822 format (Debian 12+/trixie)
    log "adding contrib to debian.sources (deb822)"
    sed -i '/^Components:/ { /contrib/! s/$/ contrib/ }' /etc/apt/sources.list.d/debian.sources
  elif grep -q "$CODENAME" /etc/apt/sources.list 2>/dev/null; then
    log "adding contrib to sources.list (one-line)"
    sed -i "/^deb .* $CODENAME .*main/ { /contrib/! s/ main\b/ main contrib non-free non-free-firmware/ }" /etc/apt/sources.list
  else
    warn "could not locate sources file to enable contrib/multiverse"
  fi
}
enable_nonfree_repo

log "apt update"
apt-get update -q

# ---- core rip/burn stack (all in main/universe) ----
log "installing rip/burn tools"
DEBIAN_FRONTEND=noninteractive apt-get install -y -q \
  handbrake-cli cdparanoia ffmpeg xorriso dvd+rw-tools \
  dvdauthor eject udisks2 util-linux

# ---- libdvdcss2 for encrypted video DVDs (needs contrib/multiverse) ----
log "installing libdvd-pkg (builds libdvdcss2)"
if DEBIAN_FRONTEND=noninteractive apt-get install -y -q libdvd-pkg; then
  dpkg-reconfigure -f noninteractive libdvd-pkg || warn "libdvdcss2 build failed"
else
  warn "libdvd-pkg not found — encrypted retail DVDs won't rip; own/unencrypted media still works"
fi

# ---- verify ----
log "verifying binaries"
MISSING=0
for b in HandBrakeCLI cdparanoia ffmpeg ffprobe xorriso growisofs dvdauthor eject udisksctl findmnt; do
  if command -v "$b" >/dev/null; then
    printf '  ok   %s\n' "$b"
  else
    printf '  MISS %s\n' "$b"; MISSING=1
  fi
done
if ldconfig -p | grep -q dvdcss; then printf '  ok   libdvdcss2\n'; else printf '  MISS libdvdcss2 (encrypted DVDs only)\n'; fi

[ "$MISSING" -eq 0 ] && log "all core tools present" || warn "some tools missing — see MISS above"
