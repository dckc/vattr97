# diigo-cache's systemd unit, in the shape of units.nix's, for
# render-units.nix: a system service, as a uid that exists only while it
# runs, so nothing else on the host reads the cache's state (every
# bookmark, and the diigo session cookie).
#
# It reaches diigo over the network, and serves the app socket on
# loopback, for a proxy (such as `tailscale serve`) to put in front. The
# owner's link goes to a file in its runtime directory, readable by root;
# the journal gets only the link's fingerprint.
{
  lib,
  # where diigo-cache-serve is
  bin,
  # the app socket's port; the http socket is the next one
  port ? 8790,
}:
{
  sockets = { };

  services.diigo-cache = {
    description = "diigo-cache: diigo bookmarks cached in toybox vats";
    after = [ "network-online.target" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      ExecStart = "${bin}/diigo-cache-serve %S/diigo-cache --port ${toString port} --link-file %t/diigo-cache/owner-link";
      DynamicUser = true;
      StateDirectory = "diigo-cache";
      StateDirectoryMode = "0700";
      RuntimeDirectory = "diigo-cache";
      RuntimeDirectoryMode = "0700";
      UMask = "0077";
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      NoNewPrivileges = true;
      RestrictAddressFamilies = "AF_UNIX AF_INET AF_INET6";
      SystemCallFilter = "@system-service";
      # not MemoryDenyWriteExecute: V8's JIT needs W+X
      Restart = "on-failure";
      RestartSec = 10;
    };
  };
}
