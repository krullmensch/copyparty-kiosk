#!/usr/bin/env bash
#
# Agora CLIENT kiosk setup.
#
# Provisions a kiosk that only runs the Electron app and connects to the main
# kiosk (kiosk2.local) for files and stats. No copyparty, no tracking backend.
#
# Idempotent: safe to re-run. Run as the kiosk user (with sudo available):
#   ./deploy/setup-client.sh
#
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib-kiosk.sh"

log "Agora CLIENT kiosk setup  (repo: $REPO_DIR)"

install_base_packages
write_role client
ensure_display_stack
build_app
restart_app

log "CLIENT kiosk setup complete."
echo "  - app connects to http://kiosk2.local:3923 (files) + :8080 (stats)"
echo "  - ensure the MAIN kiosk (kiosk2) is set up and reachable on the LAN"
