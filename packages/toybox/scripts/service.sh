#!/bin/sh
# Start a toybox (scripts/serve.js) as a transient systemd user service, and
# print the boot vat's link.
#
# usage: scripts/service.sh UNIT STATE_DIR BOOT_DIR [serve.js options]
#
# Stop it with `systemctl --user stop UNIT`; the state stays.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
unit=$1 state=$2 boot=$3
shift 3

# node's own path: under `yarn run`, the node on PATH is a shim yarn removes
node=$(node -p process.execPath)
since=$(date +%s)
systemd-run --user --quiet --unit "$unit" --working-directory="$here" \
  "$node" scripts/serve.js "$state" "$boot" "$@"
for _ in $(seq 100); do
  if link=$(journalctl --user -u "$unit" --since "@$since" -o cat | grep -m1 '^open:'); then
    echo "$link"
    exit 0
  fi
  systemctl --user -q is-active "$unit" || break
  sleep 0.2
done
journalctl --user -u "$unit" --since "@$since" -o cat | tail -20 >&2
exit 1
