# Contributing to toybox

## Testing

```sh
yarn test        # builds, then runs real workerds: vats, references, restarts and crashes, upgrades, devices, ingress
yarn typecheck   # tsc --checkJs, tests included
```

The nixStore tests put files in the nix store (`nix store add-path`), and the git tests run `git`; CI installs nix. From the workspace root, `nix flake check` builds the package and checks the NixOS module.

## Layout of the code

- [kernel.js](kernel.js): the `Kernel` Durable Object, which hosts many vats, and `Syscall`, a vat's only way out.
- [devices/](devices/): each kind of the kernel's own objects, one module apiece.
- [liveslots.js](liveslots.js) and [kvat-runtime.js](kvat-runtime.js): a vat's side: vrefs, presences, its durable zone, and its SQLite.
- [supervisor.js](supervisor.js): workerd's entrypoints, `Public` (the ingress), `App` (the boot vat's socket), and `Admin`, and the `Directory` of ingress mounts.
- [labels.js](labels.js): [Flower](https://github.com/NuxiNL/flower)'s label rule for mounts.
- [config.capnp](config.capnp): workerd's config. Its sockets have no addresses; whoever starts workerd hands them in, so holding a socket is the authority it grants.
- [types.ts](types.ts) and [worker-env.d.ts](worker-env.d.ts): the types the modules share, and workerd's bindings.
- [kvats/](kvats/): vats the tests exercise: counters, a mint and purses, lend-the-mower, hello, a WebApp maker, a store maker, a bookmark cache, and a bootstrap vat that wires them.
- [kvats/wallet/](kvats/wallet/): a boot directory: a boot vat, counters, issuer kits, and a gateway that keeps a NameHub per client and serves the app socket. [scripts/wallet.js](scripts/wallet.js) runs it.

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
- `zone`, whose kinds are `@endo/exo`'s, so their guards are checked: `exoClassKit` (two or more facets sharing one state, each a reference of its own, `o+d<kind>/<n>:<facet>`), `exoClass` (one facet, `o+d<kind>/<n>`), `exo`, `makeOnce`, `mapStore(name)`, and `detached().mapStore(label)`.

Every incarnation must define every kind, with the facets it had: a kind can't change between one facet and a kit, since references to its objects are stored by facet. Other exports are ephemeral, gone when the vat restarts.

Not yet: promise pipelining between vats (each message waits for its answer), messages that outlive an eviction, and dropping c-list entries nobody holds.

## The boot vat

The kernel named `main` has a boot vat, after SwingSet's bootstrap vat, if config.capnp's `boot` directory (`-d boot=<dir>`) has a `boot.js`. The first request to the app socket starts it, with a vatAdmin, the boot directory's bundles, an entropy device, and the app socket's ingress as its params. On each later start of the kernel, if `boot.js` changed, the kernel upgrades the boot vat to it. Either way it then sends the boot vat `start()`, where it makes, or upgrades, the vats it keeps ([test/boot/boot.js](test/boot/boot.js)). So a service's boot directory says what runs, and restarting the service runs what it says.

## The admin session

A client reaches a kernel with a WebSocket to `/kernel/<name>` on the admin socket ([kernel-client.js](kernel-client.js)). Its session can `createVat(src, params)`, which answers the vat's root and its admin node; `vats()`, every vat's root and admin node, for a new session to find them again; and make kernel objects: `makeIngress(labels)`, `makeFetchDevice()`, `makeLanDevice()`, `makeVatAdmin()`, `installBundle(src)`, `makeNixStore()`, `makeGitWorktree()`.

## The kernel's own objects

Each kind is a module in devices/, given only the kernel powers it uses, and an `@endo/exo` class whose interface guard checks each message ([devices/objects.js](devices/objects.js)). A kernel object's key, `<prefix>:<rest>`, names its kind.

- **Ingress** ([ingress.js](devices/ingress.js)): `serve(handler)` records the handler's kref, so the next request starts its vat if need be.
- **vatAdmin and admin node** ([vat-admin.js](devices/vat-admin.js)), after SwingSet's: `createVat(bundleCap, params)` answers `{ root, adminNode }`; the admin node's `upgrade(bundleCap)` keeps the vat's durable objects and params, and `restart()` stops it as an eviction would. There are no vat ids to hold.
- **bundleCap** ([bundles.js](devices/bundles.js)): one per bundle hash, so knowing a hash grants nothing.
- **nixStore** ([nix-store.js](devices/nix-store.js)): `getBundleCap(path)` reads a store path through config.capnp's read-only `nix-store` service and keys its bundle by NAR hash ([nar.js](nar.js)). A file is a bundle of one module; a directory's files are its modules, its `worker.json` naming the main one ([test/greeter/](test/greeter/)). Symlinks, and anything not in the store, are refused.
- **Git worktree, tree, and reader** ([git.js](devices/git.js)): for files that must stay out of the world-readable nix store. `getTree(tree, listing)` takes what `git ls-tree -r` lists ([git-tree.js](git-tree.js)); a tree reads a file from config.capnp's `git-worktree` directory only if it lists it, and only while it hashes to the blob id listed. `open(path)` streams a big file, checked before any chunk is given out and again as they are; a reader says done only if what it gave out matches, and doesn't outlive a kernel restart. Text only: our marshal can't carry bytes yet.
- **Boot bundles** ([boot.js](devices/boot.js)): the boot vat's `getBundleCap(name)` for a name in the boot directory, a file or a directory, read as a nix store path is.
- **Entropy** ([entropy.js](devices/entropy.js)): `swiss()` answers 128 random bits in hex. Vats have no randomness of their own.
- **Fetch and LAN devices** ([fetch.js](devices/fetch.js)), after SwingSet's devices: `fetch(url, { method, headers, body })` answers `{ status, headers, body }`. A fetch device reaches config.capnp's `internet` service (public addresses); a LAN device, its `lan` service (private addresses, a tailnet's included, not loopback). Neither attenuates; a WebApp vat ([kvats/webapp.js](kvats/webapp.js)) does.

## Ingress routing

A request's labels are its query parameters; a key given twice is a 400. A mount must conflict with every other (some shared key, different values), so no request can carry two mounts' labels, and a request reaches a mount only by carrying every one of its labels. That's stricter than Flower's match: an ingress client holds no constrained handle that supplies labels for it. The handler sees the mount's and the request's labels together. Responses carry `Referrer-Policy: no-referrer`, and `Content-Security-Policy: script-src 'none'`: every mount shares the http socket's origin, so a script on one vat's page could read what another's keeps. The app socket's origin is the boot vat's alone, and its pages may run their own scripts.

Routing carries no secrets: a URL ends up in logs and `Referer`s. A secret travels in-band, as on a webkey page: the page keeps it in its fragment, reaches the vat by public labels, and sends it in the body of a call.

## No ambient authority

Clocks, randomness, and I/O start at the edge: the tests (`*.test.js`) and scripts (files with a shebang, whose `main` takes its I/O as default arguments). Every other module takes what it uses as a parameter: the kernel from workerd's `env`, a vat from its params and powers, the test helpers from the tests. Lint holds it: `Math.random`, `Date.now`, `fetch`, `setTimeout`, and imports of `node:fs`, `node:child_process`, `node:net`, `ws`, and the like are errors anywhere else. A Durable Object class that needs an exception gets an inline `eslint-disable` saying why.

## Types

The code is JavaScript, run as it is by workerd; the Worker Loader takes no TypeScript. Types live in [types.ts](types.ts), imported with JSDoc `@import`, and `tsc --checkJs` checks everything. `Remote`, a reference to another vat's object, is the one place `any` stands for types a vat can't name; each remaining cast says why.

## Under nix and systemd

`toybox-serve` runs the workerd that nixpkgs' wrangler carries (nixpkgs has no workerd of its own), on this package's config and bundles. Its sockets come from systemd, as `-S http=3 -S admin=4 -S app=5`, and its boot directory is the package's wallet unless the `boot` option names another.

- On NixOS, `nixosModules.toybox` adds `services.toybox`: `listen` (the public port), `appListen` (the app port), `boot`, `stateDir`, `gitWorktree`, `user`, and `network`. By default it runs as a DynamicUser, with state and an empty worktree in StateDirectories; a `gitWorktree` or `stateDir` of your own needs a `user` who can reach it. Given a worktree under `/home`, home is read-only to it rather than hidden.
- Elsewhere, the package ships units for the defaults, expecting the package in the nix profile `/nix/var/nix/profiles/toybox`; `lib.x86_64-linux.toyboxUnits { ... }` renders them with other options ([nix/units.nix](../../nix/units.nix)).

By default toybox gets no network of its own (`PrivateNetwork=yes`), only the sockets it is handed, so its fetch and LAN devices reach nothing; with `network`, they reach what config.capnp's services allow. The admin socket is root's alone: whoever can open it can install code. The units haven't been run under the system manager yet.

A change to yarn.lock changes the flake's fixed-output hash for the JS dependencies: rerun `nix build .#toybox`, and take the hash it reports into flake.nix (and missing-hashes.json, from `yarn-berry-fetcher missing-hashes yarn.lock`).
