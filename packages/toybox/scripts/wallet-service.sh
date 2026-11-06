#!/bin/sh
# Start the wallet (examples/wallet) as a transient systemd user service,
# `toybox-wallet`, and print the first client's link.
#
# usage: scripts/wallet-service.sh [STATE_DIR [PORT]]
#
# STATE_DIR is ~/.local/state/toybox-wallet by default; PORT, 8788. Stop it
# with `systemctl --user stop toybox-wallet`; the state stays. The boot vat
# reads its code from this checkout's examples/ as it starts, and upgrades
# what changed.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
state=${1:-$HOME/.local/state/toybox-wallet}
exec "$here/scripts/service.sh" toybox-wallet "$state" "$here/examples/wallet" \
  --source "$here/examples" --port "${2:-8788}"
