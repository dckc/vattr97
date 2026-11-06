# Contributing to toybox

## How it works, in brief

toybox is a Durable Object class, the **kernel**, that runs other code. Each program it runs is a **vat**: a module installed at runtime, run in a Durable Object facet of its own, with its own SQLite. Vats share nothing but references: a vat calls an object in another vat by asking the kernel to deliver a message, and the kernel delivers it only if the vat holds that reference. What a vat can do beyond computing, from reaching the network to making other vats, it does through an object someone handed it: another vat's, or one of the kernel's own, such as a **device** for I/O. The **boot vat** starts with every device, and decides who gets what.

A vat names objects by _vrefs_, names of its own; the kernel names them by _krefs_, and keeps each vat's _c-list_ (capability list) from one to the other, translating every message through it. So a vat that skips its runtime and calls the kernel directly still reaches only what it holds. A vat keeps its objects in its SQLite, and the kernel keeps the c-lists in its own, so references survive restarts, upgrades, and crashes. The README's [prior art](README.md#prior-art) is where the design comes from.

## Testing

```sh
yarn test        # builds, then runs real workerds: vats, references, restarts and crashes, upgrades, devices, ingress
yarn typecheck   # tsc --checkJs, tests included
```

The nixStore tests put files in the nix store (`nix store add-path`), and the git tests run `git`; CI installs nix. From the workspace root, `nix flake check` builds the package and checks the NixOS module.

## Layout of the code

toybox itself is in [src/](src/), in three parts: the kernel ([kernel.js](src/kernel.js), and the objects it runs vats with, in [kernel/](src/kernel/)), a vat's side of it ([vat/](src/vat/)), and the I/O devices ([devices/](src/devices/)). [src/types.ts](src/types.ts) is what a vat's author writes against; each part has a `types.ts` of its own. [supervisor.js](src/supervisor.js) is workerd's entry module, and [config.capnp](config.capnp) its config, whose sockets are handed in by whoever starts workerd:

| socket  | what its holder can do                                                                       |
| ------- | -------------------------------------------------------------------------------------------- |
| `http`  | reach the handler served at the ingress mounted at labels the request carries                |
| `app`   | reach the handler the boot vat of the kernel `main` serves, on an origin of its own          |
| `admin` | open a session with any kernel, which can make vats and devices, and so install and run code |

Beside src/ are [test/](test/), [examples/](examples/) (vats built on toybox, which the tests exercise), and [scripts/](scripts/), which run a toybox: `yarn wallet` runs [examples/wallet/](examples/wallet/) as a systemd user service.

## The boot vat

The kernel named `main` boots from config.capnp's `boot` directory (`-d boot=<dir>`): its `boot.js`, or `boot/`, a directory of modules. The boot vat's params are a vatAdmin, the boot directory's bundles, and the kernel's devices, for it to hand on as it sees fit. Each time the kernel starts, it upgrades the boot vat if its code there changed, then sends it `start()`, where it makes or upgrades the vats it keeps ([test/boot/boot.js](test/boot/boot.js)). So a service's boot directory says what runs, and restarting the service runs what it says.

## Adding a device

A device is an ordinary vat whose facet env has one more binding, so a project built on toybox adds one without touching the kernel.

1. **Config:** in a config.capnp of your own, declare the service and bind it, and list the binding in `GRANTABLE` ([test/config-device.capnp](test/config-device.capnp)). workerd can't add a binding to a worker it inherits, so this config restates the supervisor's bindings. Only service bindings cross into a vat; a KV namespace or R2 bucket needs a service in front of it.
2. **Grant:** the boot vat gets `endowments`, whose `get('GNUCASH')` answers that binding's endowment, and grants it when making the device: `E(vatAdmin).createVat(bundle, params, { endowments: { gnucash } })`. The kernel records the grant with the vat, so it survives restarts and upgrades.
3. **Device vat:** it reaches the binding with `endowment('gnucash')`, and hands out whatever attenuated objects it likes ([test/device/](test/device/)).

Taking a binding out of `GRANTABLE` revokes it: a vat granted it can't start.

## Conventions

- **No ambient authority.** Clocks, randomness, and I/O start at the edge: the tests (`*.test.js`) and scripts (files with a shebang, whose `main` takes its I/O as default arguments). Every other module takes what it uses as a parameter, and lint holds it: `Math.random`, `Date.now`, `fetch`, `setTimeout`, and imports of `node:fs`, `node:net`, `ws`, and the like are errors anywhere else.
- **Types without TypeScript.** The Worker Loader takes no TypeScript, so the code is JavaScript, its types in `.ts` files imported with JSDoc `@import`, and `tsc --checkJs` checks everything. `Remote`, a reference to another vat's object, is the one place `any` stands for types a vat can't name; each remaining cast says why.
- **Docs in the code.** What a module, kind, or device does is in its JSDoc; this file says only what the code can't.

Not yet: promise pipelining between vats (each message waits for its answer), messages that outlive an eviction, and dropping c-list entries nobody holds.

## Under nix and systemd

`toybox-serve` runs the workerd that nixpkgs' wrangler carries, so the flake is for `x86_64-linux` only. Its sockets come from systemd, as `-S http=3 -S admin=4 -S app=5`, and its boot directory is the package's wallet unless the `boot` option names another. On NixOS, `nixosModules.toybox` adds `services.toybox` ([nix/module.nix](../../nix/module.nix)); elsewhere, `lib.x86_64-linux.toyboxUnits { ... }` renders units ([nix/units.nix](../../nix/units.nix)). By default toybox gets no network of its own, only the sockets it's handed; the admin socket is root's alone. The units haven't been run under the system manager yet.

A change to yarn.lock changes the flake's fixed-output hash for the JS dependencies: rerun `nix build .#toybox`, and take the hash it reports into flake.nix (and missing-hashes.json, from `yarn-berry-fetcher missing-hashes yarn.lock`).
