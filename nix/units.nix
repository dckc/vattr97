# toybox's systemd units, in the shape of NixOS's systemd.services and
# systemd.sockets: the NixOS module (module.nix) uses them as they are, and
# the package renders them to unit files (render-units.nix) for hosts that
# aren't NixOS.
#
# By default toybox gets no network of its own, only the sockets it is
# handed, so its fetch and LAN devices reach nothing. With `network`, they
# reach what their config.capnp services allow: public addresses for the
# fetch device, private ones but not loopback for the LAN device.
{
  lib,
  # where toybox-serve is
  bin,
  # the public port, as systemd's ListenStream= takes it
  listen ? "127.0.0.1:8787",
  # the app port: the boot vat's own origin
  appListen ? "127.0.0.1:8788",
  # the boot directory; the default is the package's, the wallet
  boot ? null,
  # kernel state; the default is a StateDirectory
  stateDir ? null,
  # what the kernel's git trees read from; the default is an empty StateDirectory
  gitWorktree ? null,
  # the user to run as; the default is a DynamicUser
  user ? null,
  # whether the devices may reach the network
  network ? false,
}:
let
  state = if stateDir == null then "/var/lib/toybox" else stateDir;
  worktree = if gitWorktree == null then "/var/lib/toybox-worktree" else gitWorktree;
  bootDir = if boot == null then "${dirOf bin}/share/toybox/boot" else boot;
  stateDirectories =
    lib.optional (stateDir == null) "toybox" ++ lib.optional (gitWorktree == null) "toybox-worktree";
  inHome = lib.hasPrefix "/home/" worktree || lib.hasPrefix "/home/" state;
in
{
  sockets.toybox = {
    description = "toybox: public port, admin socket, and app port";
    wantedBy = [ "sockets.target" ];
    # order sets the fds: http=3, admin=4, app=5
    listenStreams = [
      listen
      "/run/toybox/admin.sock"
      appListen
    ];
    socketConfig = {
      # whoever can open admin.sock can install code
      SocketUser = "root";
      SocketMode = "0600";
    };
  };

  services.toybox = {
    description = "toybox: kernels of vats installed at runtime (workerd)";
    requires = [ "toybox.socket" ];
    after = [ "toybox.socket" ];
    serviceConfig = {
      ExecStart = "${bin}/toybox-serve -S http=3 -S admin=4 -S app=5 -d state=${state} -d git-worktree=${worktree} -d boot=${bootDir}";
      PrivateNetwork = !network;
      RestrictAddressFamilies = if network then "AF_UNIX AF_INET AF_INET6" else "AF_UNIX";
      ProtectSystem = "strict";
      # a worktree or state under /home is read, or kept, there
      ProtectHome = if inHome then "read-only" else true;
      PrivateTmp = true;
      SystemCallFilter = "@system-service";
      # not MemoryDenyWriteExecute: V8's JIT needs W+X
    }
    // lib.optionalAttrs (stateDirectories != [ ]) {
      StateDirectory = lib.concatStringsSep " " stateDirectories;
      StateDirectoryMode = "0700";
    }
    // lib.optionalAttrs (stateDir != null) { ReadWritePaths = state; }
    // (if user == null then { DynamicUser = true; } else { User = user; });
  };
}
