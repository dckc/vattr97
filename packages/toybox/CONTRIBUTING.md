# Contributing to toybox

## Testing

```sh
yarn test        # builds, then runs real workerds: vats, references, restarts and crashes, upgrades, devices, ingress
yarn typecheck   # tsc --checkJs, tests included
```

The nixStore tests put files in the nix store (`nix store add-path`), and the git tests run `git`; CI installs nix. From the workspace root, `nix flake check` builds the package and checks the NixOS module.

## Layout of the code

toybox itself is in [src/](src/); [build.js](build.js) bundles it into `dist/`, which [config.capnp](config.capnp) embeds. Beside it are [test/](test/), [examples/](examples/), and [scripts/](scripts/).

- [kernel.js](src/kernel.js): the `Kernel` Durable Object, which hosts many vats, and `Syscall`, a vat's only way out.
- [kernel/](src/kernel/): the kernel's own objects, one module per kind: what it runs vats with (bundles, the boot directory, vatAdmin, ingress, and endowments).
- [devices/](src/devices/): toybox's I/O devices: networks, the nix store, git trees, and entropy. [devices/index.js](src/devices/index.js) makes them, and [supervisor.js](src/supervisor.js) hands them to the kernel (`makeKernelClass`), which knows each only as a `Device`, `{ kinds, make }` ([types.ts](src/types.ts)).
- [liveslots.js](src/liveslots.js) and [vat-runtime.js](src/vat-runtime.js): a vat's side: vrefs, presences, its durable zone, and its SQLite.
- [supervisor.js](src/supervisor.js): workerd's entrypoints, `Public` (the ingress), `App` (the boot vat's socket), and `Admin`, and the `Directory` of ingress mounts.
- [orm.js](src/orm.js): rows as records, for single-table statements on the kernel's SQLite. A module exports its `TABLES`, and the kernel gives it a `db` limited to those; no kind of kernel object holds `sql`.
- [labels.js](src/labels.js): [Flower](https://github.com/NuxiNL/flower)'s label rule for mounts.
- [config.capnp](config.capnp): workerd's config. Its sockets have no addresses; whoever starts workerd hands them in, so holding a socket is the authority it grants.
- [types.ts](src/types.ts) and [worker-env.d.ts](src/worker-env.d.ts): the types the kernel, vats, and devices share, and workerd's bindings. The I/O devices' own types are in [devices/types.ts](src/devices/types.ts).
- [examples/](examples/): vats built on toybox rather than part of it; the tests exercise them: counters, a hello page, a WebApp maker, and a store maker. [probes/](examples/probes/) holds vats that test the kernel's limits: one that looks for ambient authority, one that forges vrefs, and one that answers whatever status it's asked for, or throws. A scenario of several vats has a directory: [rights-transfer/](examples/rights-transfer/) (a mint, purses, and a payer), [neighbor/](examples/neighbor/) (lend-the-mower), and [bookmarks/](examples/bookmarks/) (a bookmark cache and the bootstrap vat that wires it).
- [examples/wallet/](examples/wallet/): a boot directory: a boot vat, counters, issuer kits, and a gateway that keeps a NameHub per client and serves the app socket. [scripts/serve.js](scripts/serve.js) runs a toybox from any boot directory, and prints the boot vat's `ownerLink()` if it answers one; [scripts/service.sh](scripts/service.sh) runs that as a transient systemd user service, and `yarn wallet` runs the wallet that way.

| socket  | reaches  | what its holder can do                                                                                   |
| ------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `http`  | `Public` | reach the handler served at the ingress mounted at labels the request carries                            |
| `app`   | `App`    | reach the handler the boot vat of the kernel `main` serves at the app socket's ingress                   |
| `admin` | `Admin`  | a WebSocket to `/kernel/<name>`: a session with that kernel, which can make vats, devices, and ingresses |

## Vats and references

A vat names objects only by vrefs in its own namespace (see liveslots.js). The kernel keeps each vat's c-list from vrefs to krefs and translates every message through it, so a vat that calls its syscall directly still reaches only what it holds. Passing a reference to another vat adds a row to the receiver's c-list. The c-lists are in the kernel's SQLite and durable objects in each vat's, so references between vats survive a vat restarting, an upgrade, or a crash of the whole toybox.

A vat's `buildRootObject({ E, Far, M, zone, db }, params)` gets:

- `M`, from `@endo/patterns`, for interface guards;
- `db`, its own SQLite, in ertp-books' `SqlDatabase` shape; the vatstore is its `vatstore` table;
- `zone`, whose kinds are `@endo/exo`'s, so their guards are checked: `exoClassKit` (two or more facets sharing one state, each a reference of its own, `o+d<kind>/<n>:<facet>`), `exoClass` (one facet, `o+d<kind>/<n>`), `exo`, `makeOnce`, `mapStore(name)`, and `detached().mapStore(label)`;
- `endowment(name)`, the service binding granted to it as `name`, if any ([adding a device](#adding-a-device)).

Every incarnation must define every kind, with the facets it had: a kind can't change between one facet and a kit, since references to its objects are stored by facet. Other exports are ephemeral, gone when the vat restarts.

Not yet: promise pipelining between vats (each message waits for its answer), messages that outlive an eviction, and dropping c-list entries nobody holds.

## The boot vat

The kernel named `main` has a boot vat, after SwingSet's bootstrap vat, if config.capnp's `boot` directory (`-d boot=<dir>`) has a `boot.js`, or `boot`, a directory bundle of several modules. The first request to the app socket starts it. It is the service's root of authority: its params are a vatAdmin, the boot directory's bundles, an entropy device, the app socket's ingress, a nixStore, git trees, a fetch and a LAN device, and the grantable endowments, for it to hand on as it sees fit. On each later start of the kernel, if its code there changed, the kernel upgrades the boot vat to it. Either way it then sends the boot vat `start()`, where it makes, or upgrades, the vats it keeps ([test/boot/boot.js](test/boot/boot.js)). So a service's boot directory says what runs, and restarting the service runs what it says.

## Adding a device

A device is an ordinary vat whose facet env has one more binding, so a project built on toybox adds one without touching the kernel. Its code runs in its own isolate, comes hash-pinned from the boot directory or the nix store, and upgrades through its admin node like any vat's.

1. **Config:** in a config.capnp of your own, declare the service and bind it, and list the binding in `GRANTABLE` ([test/config-device.capnp](test/config-device.capnp)). workerd can't add a binding to a worker it inherits, so this config restates the supervisor's bindings, and takes its modules and Durable Object namespaces from toybox's constants. Only service bindings cross into a vat; a KV namespace or R2 bucket needs a service in front of it.
2. **Grant:** the boot vat gets `endowments`, whose `get('GNUCASH')` answers that binding's endowment, and grants it when making the device: `E(vatAdmin).createVat(bundle, params, { endowments: { gnucash } })`. The key is the vat's own name for it. The kernel records the grant with the vat, so it survives restarts and upgrades.
3. **Device vat:** it reaches the binding with `endowment('gnucash')`, and hands out whatever attenuated objects it likes ([test/device/](test/device/)).

Taking a binding out of `GRANTABLE` revokes it: a vat granted it can't start.

## The admin session

A client reaches a kernel with a WebSocket to `/kernel/<name>` on the admin socket ([kernel-client.js](src/kernel-client.js)). Its session can `createVat(src, params)`, which answers the vat's root and its admin node; `vats()`, every vat's root and admin node, for a new session to find them again; and make kernel objects: `makeIngress(labels)`, `makeVatAdmin()`, `installBundle(src)`, and `makeDevice(name)`, for the I/O devices in [devices/index.js](src/devices/index.js): `entropy`, `fetch`, `gitTrees`, `lan`, and `nixStore`.

## The kernel's own objects

Each kind is a module, given only the kernel powers it uses, and an `@endo/exo` class whose interface guard checks each message ([kernel/objects.js](src/kernel/objects.js)). A kernel object's key, `<prefix>:<rest>`, names its kind. The kernel runs vats with the kinds in [kernel/](src/kernel/):

- **Ingress** ([ingress.js](src/kernel/ingress.js)): `serve(handler)` records the handler's kref, so the next request starts its vat if need be.
- **vatAdmin and admin node** ([vat-admin.js](src/kernel/vat-admin.js)), after SwingSet's: `createVat(bundleCap, params, { endowments })` answers `{ root, adminNode }`; the admin node's `upgrade(bundleCap)` keeps the vat's durable objects, params, and endowments, and `restart()` stops it as an eviction would. There are no vat ids to hold.
- **Endowments and endowment** ([endowments.js](src/kernel/endowments.js)): a binding in `GRANTABLE`, as a reference a vatAdmin's `createVat` can grant. An endowment has no methods; what it reaches is the granted vat's to attenuate.
- **bundleCap** ([bundles.js](src/kernel/bundles.js)): one per bundle hash, so knowing a hash grants nothing. A bundle is files and a manifest; its hash is SHA-256 over the manifest and each file's name and SHA-256, so the same files give the same bundle wherever they were read from. A file alone is a bundle of one module; a directory's files are its modules, its `worker.json` naming the main one ([tree.js](src/kernel/tree.js), [test/greeter/](test/greeter/)).
- **Boot bundles** ([boot.js](src/kernel/boot.js)): the boot vat's `getBundleCap(name)` for a name in the boot directory, a file or a directory.

The I/O devices in [devices/](src/devices/) are toybox's own, built into the kernel by the worker's entry module; a project built on toybox adds its own as device vats ([adding a device](#adding-a-device)):

- **nixStore** ([nix/store.js](src/devices/nix/store.js)): `getBundleCap(path)` reads a store path through config.capnp's read-only `nix-store` service as a bundle. Symlinks, and anything not in the store, are refused.
- **Git trees, tree, and reader** ([git/trees.js](src/devices/git/trees.js)): for files that must stay out of the world-readable nix store. `getTree(tree, listing)` takes what `git ls-tree -r` lists ([git/object-ids.js](src/devices/git/object-ids.js)); a tree reads a file from config.capnp's `git-checkout` directory only if it lists it, and only while it hashes to the blob id listed. `open(path)` streams a big file, checked before any chunk is given out and again as they are; a reader says done only if what it gave out matches, and doesn't outlive a kernel restart. Text only: our marshal can't carry bytes yet.
- **Entropy** ([entropy.js](src/devices/entropy.js)): `swiss()` answers 128 random bits in hex. Vats have no randomness of their own.
- **Fetch and LAN devices** ([fetch.js](src/devices/fetch.js)), after SwingSet's devices: `fetch(url, { method, headers, body })` answers `{ status, headers, body }`. A fetch device reaches config.capnp's `internet` service (public addresses); a LAN device, its `lan` service (private addresses, a tailnet's included, not loopback). Neither attenuates; a WebApp vat ([examples/webapp.js](examples/webapp.js)) does.

## Ingress routing

A request's labels are its query parameters; a key given twice is a 400. A mount must conflict with every other (some shared key, different values), so no request can carry two mounts' labels, and a request reaches a mount only by carrying every one of its labels. That's stricter than Flower's match: an ingress client holds no constrained handle that supplies labels for it. The handler sees the mount's and the request's labels together. Responses carry `Referrer-Policy: no-referrer`, and `Content-Security-Policy: script-src 'none'`: every mount shares the http socket's origin, so a script on one vat's page could read what another's keeps. The app socket's origin is the boot vat's alone, and its pages may run their own scripts.

Routing carries no secrets: a URL ends up in logs and `Referer`s. A secret travels in-band, as on a webkey page: the page keeps it in its fragment, reaches the vat by public labels, and sends it in the body of a call.

## No ambient authority

Clocks, randomness, and I/O start at the edge: the tests (`*.test.js`) and scripts (files with a shebang, whose `main` takes its I/O as default arguments). Every other module takes what it uses as a parameter: the kernel from workerd's `env`, a vat from its params and powers, the test helpers from the tests. Lint holds it: `Math.random`, `Date.now`, `fetch`, `setTimeout`, and imports of `node:fs`, `node:child_process`, `node:net`, `ws`, and the like are errors anywhere else. A Durable Object class that needs an exception gets an inline `eslint-disable` saying why.

## Types

The code is JavaScript, run as it is by workerd; the Worker Loader takes no TypeScript. Types live in [types.ts](src/types.ts), imported with JSDoc `@import`, and `tsc --checkJs` checks everything. `Remote`, a reference to another vat's object, is the one place `any` stands for types a vat can't name; each remaining cast says why.

## Under nix and systemd

`toybox-serve` runs the workerd that nixpkgs' wrangler carries (nixpkgs has no workerd of its own), on this package's config and bundles. That workerd is wrangler's `workerd-linux-64` build, so the flake is for `x86_64-linux` only. Its sockets come from systemd, as `-S http=3 -S admin=4 -S app=5`, and its boot directory is the package's wallet unless the `boot` option names another.

- On NixOS, `nixosModules.toybox` adds `services.toybox`: `listen` (the public port), `appListen` (the app port), `boot`, `stateDir`, `gitCheckout`, `user`, and `network`. By default it runs as a DynamicUser, with state and an empty checkout in StateDirectories; a `gitCheckout` or `stateDir` of your own needs a `user` who can reach it. Given a checkout under `/home`, home is read-only to it rather than hidden.
- Elsewhere, the package ships units for the defaults, expecting the package in the nix profile `/nix/var/nix/profiles/toybox`; `lib.x86_64-linux.toyboxUnits { ... }` renders them with other options ([nix/units.nix](../../nix/units.nix)).

By default toybox gets no network of its own (`PrivateNetwork=yes`), only the sockets it is handed, so its fetch and LAN devices reach nothing; with `network`, they reach what config.capnp's services allow. The admin socket is root's alone: whoever can open it can install code. The units haven't been run under the system manager yet.

A change to yarn.lock changes the flake's fixed-output hash for the JS dependencies: rerun `nix build .#toybox`, and take the hash it reports into flake.nix (and missing-hashes.json, from `yarn-berry-fetcher missing-hashes yarn.lock`).
