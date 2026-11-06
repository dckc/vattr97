# toybox: kernels whose vats run code installed at runtime, each vat a Durable Object facet.
#
# Sockets have no address here: whoever starts workerd hands them in
# (-S name=fd from systemd, or -s name=addr), so holding a socket is the
# authority it grants. `state` is likewise overridden with -d state=<dir>.
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .supervisor),
    (name = "nowhere", network = (allow = [])),
    (name = "state", disk = (path = "state", writable = true)),
  ],
  sockets = [
    # a kernel session: create vats, install code, make devices
    (name = "admin", http = (), service = (name = "main", entrypoint = "Admin")),
  ],
);

const compatibilityDate :Text = "2026-10-01";

# bundled by build.js
const modules :List(Workerd.Worker.Module) = [
  (name = "supervisor.js", esModule = embed "dist/supervisor.js"),
  (name = "vat-runtime.txt", text = embed "dist/vat-runtime.js"),
];

const durableObjectNamespaces :List(Workerd.Worker.DurableObjectNamespace) = [
  (className = "Kernel", uniqueKey = "toybox-kernel", enableSql = true),
];

const supervisor :Workerd.Worker = (
  compatibilityDate = .compatibilityDate,
  modules = .modules,
  durableObjectNamespaces = .durableObjectNamespaces,
  durableObjectStorage = (localDisk = "state"),
  bindings = [
    (name = "KERNEL", durableObjectNamespace = "Kernel"),
    (name = "LOADER", workerLoader = ()),
  ],
  globalOutbound = "nowhere",
);
