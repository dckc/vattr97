#!/bin/sh
# Start the wallet (scripts/wallet.js) as a transient systemd user service,
# and print the first client's link.
#
# usage: scripts/wallet-service.sh [STATE_DIR [PORT]]
#
# STATE_DIR is ~/.local/state/toybox-wallet by default; PORT, 8788. Stop it
# with `systemctl --user stop toybox-wallet`; the state stays.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
state=${1:-$HOME/.local/state/toybox-wallet}
port=${2:-8788}
unit=toybox-wallet

since=$(date +%s)
systemd-run --user --quiet --unit "$unit" --working-directory="$here" \
  "$(command -v node)" scripts/wallet.js "$state" "$port"
for _ in $(seq 100); do
  if link=$(journalctl --user -u "$unit" --since "@$since" -o cat | grep -m1 '^wallet:'); then
    echo "$link"
    exit 0
  fi
  systemctl --user -q is-active "$unit" || break
  sleep 0.2
done
journalctl --user -u "$unit" --since "@$since" -o cat | tail -20 >&2
exit 1
