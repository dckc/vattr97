#!/bin/sh
# Start the wallet (examples/wallet) as a transient systemd user service,
# `toybox-wallet`, and print the first client's link.
#
# usage: scripts/wallet-service.sh [STATE_DIR [PORT]]
#
# STATE_DIR is ~/.local/state/toybox-wallet by default; PORT, 8788. Stop it
# with `systemctl --user stop toybox-wallet`; the state stays.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
exec "$here/scripts/service.sh" toybox-wallet \
  "${1:-$HOME/.local/state/toybox-wallet}" "$here/examples/wallet" --port "${2:-8788}"
