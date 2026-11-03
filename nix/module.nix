# A NixOS module for one toybox service: workerd on toybox's config, handed
# its public port and admin socket by systemd (see units.nix).
{
  config,
  lib,
  ...
}:
let
  cfg = config.services.toybox;
  units = import ./units.nix {
    inherit lib;
    bin = "${cfg.package}/bin";
    inherit (cfg)
      listen
      appListen
      boot
      stateDir
      gitWorktree
      user
      network
      ;
  };
in
{
  options.services.toybox = {
    enable = lib.mkEnableOption "toybox, kernels of vats installed at runtime, on workerd";
    package = lib.mkOption {
      type = lib.types.package;
      description = "The toybox package (its toybox-serve).";
    };
    listen = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1:8787";
      description = "The public (ingress) port, as systemd's ListenStream= takes it.";
    };
    appListen = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1:8788";
      description = "The app port, the boot vat's own origin, as systemd's ListenStream= takes it.";
    };
    boot = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "The boot directory: boot.js, and the bundles the boot vat makes vats from; by default, the package's (the wallet).";
    };
    stateDir = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Where kernels keep their state; by default, the StateDirectory /var/lib/toybox.";
    };
    gitWorktree = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "The directory the kernel's git trees read files from; by default, an empty StateDirectory.";
    };
    network = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether the kernel's fetch and LAN devices may reach the network; config.capnp's services still decide which addresses.";
    };
    user = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "The user to run as, to read a git worktree that user owns; by default, a DynamicUser.";
    };
  };

  config = lib.mkIf cfg.enable {
    # a DynamicUser owns nothing outside its StateDirectories, so it can't
    # read a worktree, or write a state directory, that is someone else's
    assertions = [
      {
        assertion = cfg.user != null || (cfg.gitWorktree == null && cfg.stateDir == null);
        message = "services.toybox: a gitWorktree or stateDir of your own needs a user who can reach it";
      }
    ];
    systemd.sockets = units.sockets;
    systemd.services = units.services;
  };
}
