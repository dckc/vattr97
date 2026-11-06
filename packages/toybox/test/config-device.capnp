# toybox as a dependent adds a device: a disk service, `files`, and its
# binding, which the boot vat may grant. Override its directory with
# -d files=<dir>.
using Workerd = import "/workerd/workerd.capnp";
using Toybox = import "../config.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .supervisor),
    (name = "nowhere", network = (allow = [])),
    (name = "internet", network = (allow = ["public"])),
    (name = "lan", network = (allow = ["private"], deny = ["local"])),
    (name = "state", disk = (path = "state", writable = true)),
    (name = "nix-store", disk = (path = "/nix/store", allowDotfiles = true)),
    (name = "git-checkout", disk = (path = "git-checkout")),
    (name = "boot", disk = (path = "boot")),
    (name = "files", disk = (path = "files")),
  ],
  sockets = [
    (name = "http", http = (), service = (name = "main", entrypoint = "Public")),
    (name = "app", http = (), service = (name = "main", entrypoint = "App")),
    (name = "admin", http = (), service = (name = "main", entrypoint = "Admin")),
  ],
);

const supervisor :Workerd.Worker = (
  compatibilityDate = Toybox.compatibilityDate,
  modules = Toybox.modules,
  durableObjectNamespaces = Toybox.durableObjectNamespaces,
  durableObjectStorage = (localDisk = "state"),
  bindings = [
    (name = "DIRECTORY", durableObjectNamespace = "Directory"),
    (name = "KERNEL", durableObjectNamespace = "Kernel"),
    (name = "LOADER", workerLoader = ()),
    (name = "INTERNET", service = "internet"),
    (name = "LAN", service = "lan"),
    (name = "NIX_STORE", service = "nix-store"),
    (name = "GIT_CHECKOUT", service = "git-checkout"),
    (name = "BOOT", service = "boot"),
    (name = "FILES", service = "files"),
    (name = "GRANTABLE", json = "[\"FILES\"]"),
  ],
  globalOutbound = "nowhere",
);
