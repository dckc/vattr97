# toybox as config.capnp has it, but the kernel's fetch device reaches
# local addresses too, for tests whose site is on 127.0.0.1.
using Workerd = import "/workerd/workerd.capnp";
using Toybox = import "../config.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = Toybox.supervisor),
    (name = "nowhere", network = (allow = [])),
    (name = "internet", network = (allow = ["local"])),
    (name = "lan", network = (allow = ["local"])),
    (name = "state", disk = (path = "state", writable = true)),
    (name = "nix-store", disk = (path = "/nix/store", allowDotfiles = true)),
    (name = "git-checkout", disk = (path = "git-checkout")),
    (name = "boot", disk = (path = "boot")),
  ],
  sockets = [
    (name = "http", http = (), service = (name = "main", entrypoint = "Public")),
    (name = "app", http = (), service = (name = "main", entrypoint = "App")),
    (name = "admin", http = (), service = (name = "main", entrypoint = "Admin")),
  ],
);
