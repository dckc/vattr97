# toybox: kernels whose vats run code installed at runtime, each vat a Durable Object facet.
#
# Sockets have no address here: whoever starts workerd hands them in
# (-S name=fd from systemd, or -s name=addr), so holding a socket is the
# authority it grants. `state`, `git-worktree`, and `boot` are likewise
# overridden with -d state=<dir>, -d git-worktree=<dir>, and -d boot=<dir>.
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .supervisor),
    (name = "nowhere", network = (allow = [])),
    # the kernel's fetch device: the public internet
    (name = "internet", network = (allow = ["public"])),
    # the kernel's LAN device: private addresses, a tailnet's included
    # (workerd counts 100.64.0.0/10 as private), but not loopback, which
    # "private" otherwise includes: this host's own services are not the LAN
    (name = "lan", network = (allow = ["private"], deny = ["local"])),
    (name = "state", disk = (path = "state", writable = true)),
    # read-only; the kernel's nixStore makes bundleCaps from its files
    (name = "nix-store", disk = (path = "/nix/store", allowDotfiles = true)),
    # read-only; the kernel's git trees read the files they list from it
    (name = "git-worktree", disk = (path = "git-worktree")),
    # read-only; the kernel named `main` starts its boot vat from boot.js
    # here, if there is one, and the boot vat makes vats from the rest
    (name = "boot", disk = (path = "boot")),
  ],
  sockets = [
    # the ingress: reach the handler mounted at a request's labels
    (name = "http", http = (), service = (name = "main", entrypoint = "Public")),
    # the boot vat's own ingress, on an origin of its own: the one socket
    # whose pages may run scripts
    (name = "app", http = (), service = (name = "main", entrypoint = "App")),
    # a kernel session: create vats, install code, make devices and ingresses
    (name = "admin", http = (), service = (name = "main", entrypoint = "Admin")),
  ],
);

const supervisor :Workerd.Worker = (
  compatibilityDate = "2026-10-01",
  # bundled by build.js
  modules = [
    (name = "supervisor.js", esModule = embed "dist/supervisor.js"),
    (name = "kvat-runtime.txt", text = embed "dist/kvat-runtime.js"),
  ],
  durableObjectNamespaces = [
    (className = "Directory", uniqueKey = "toybox-directory", enableSql = true),
    (className = "Kernel", uniqueKey = "toybox-kernel", enableSql = true),
  ],
  durableObjectStorage = (localDisk = "state"),
  bindings = [
    (name = "DIRECTORY", durableObjectNamespace = "Directory"),
    (name = "KERNEL", durableObjectNamespace = "Kernel"),
    (name = "LOADER", workerLoader = ()),
    (name = "INTERNET", service = "internet"),
    (name = "LAN", service = "lan"),
    (name = "NIX_STORE", service = "nix-store"),
    (name = "GIT_WORKTREE", service = "git-worktree"),
    (name = "BOOT", service = "boot"),
  ],
  globalOutbound = "nowhere",
);
