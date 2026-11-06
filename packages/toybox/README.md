# toybox

A platform for programs that hold only the authority they're handed, and keep their objects across restarts, upgrades, and crashes. Each program is a vat, after Agoric's SwingSet, running on [workerd](https://github.com/cloudflare/workerd) as a Durable Object facet, with code installed at runtime.

## Getting started

From a clone of this repository, with Node 22 or later:

```sh
corepack enable
yarn install
cd packages/toybox
yarn build
./scripts/hello.js
```

It prints a URL; open it to see a page served by a vat ([examples/hello.js](examples/hello.js)). Ctrl-C stops it.

## A wallet, from one secret

```sh
yarn wallet
```

That starts it as a systemd user service, `toybox-wallet`, keeping its state in `~/.local/state/toybox-wallet` ([scripts/wallet-service.sh](scripts/wallet-service.sh)); `systemctl --user stop toybox-wallet` stops it. It prints a link to your hub, a NameHub in the wallet's gateway vat. Your browser keeps the hub's secret, and nothing else: everything you hold has a name in your hub. It starts with a counter maker and an issuer-kit maker, so `makeIssuerKit` gives you a mint. Invite someone with a one-time link, and each of you gets a mailbox to the other; send them your issuer, and they can send back a purse's deposit facet for you to pay into. Use a browser profile per person: each profile keeps one hub. The wallet is a boot directory ([examples/wallet/](examples/wallet/)), so its state survives restarts, and changing its code upgrades its vats on the next start.

## Separation of powers, wired by reference

A vat is a [brain in a vat](https://en.wikipedia.org/wiki/Brain_in_a_vat): all it knows of the world is what the kernel feeds it, and all it can do is send messages to the references it holds. It can't forge one, and its global `fetch` reaches nothing. So who can do what is a matter of who handed whom which reference.

The bookmark cache in [examples/](examples/) splits one job (keep a copy of a bookmark site that needs a login cookie, and serve it as a page) across four vats:

```
+----------------------------------------------+
| boot                                         |
|   holds: vatAdmin, nixStore, fetch device,   |
|          ingress, templates (a git tree),    |
|          the cookie store (read-write)       |
|   can:   make the vats; rotate the cookie    |
+----------------------------------------------+
     | fetch device,                    | asks for a
     | store's read-only facet          | cookie store
     v                                  v
+-------------------------+        +------------------+
| webApp                  |  reads | storeMaker       |
|   reaches the network   |------->|   keeps the      |
|   through the fetch     |        |   cookie store   |
|   device                |        +------------------+
+-------------------------+
     | a WebApp for one site, sending the cookie
     | (and, from boot: the ingress, the templates)
     v
+-------------------------+
| cache                   |
|   GETs that site;       |
|   serves it as a page,  |
|   rendered from the     |
|   templates; can't see  |
|   the cookie, change    |
|   it, or go elsewhere   |
+-------------------------+
```

The cache, the part that runs most often, holds the least: one WebApp, narrowed to one site, a place to serve its page, and read-only templates. Boot is a [bootstrap vat](examples/bookmarks/boot.js) that makes the others and introduces them by passing references; [the test](test/kernel.test.js) wires it up, restarts every vat, and finds everything still in place.

## Devices: how a vat reaches the world

A vat reaches outside only through the kernel's own objects. Whoever holds the admin socket makes them, and hands each to the vat that needs it. So the admin socket is for the operator alone: it checks nothing, and anyone who can open it can make any device and install any code. The bookmark cache uses each of these:

- **vatAdmin**: makes vats. Boot holds it to make the other three.
- **nixStore**: runs code from a nix store path, kept by the hash of its contents. Boot gets each vat's code from one, so what runs is exactly what was built into the store.
- **Fetch device**: the public internet. The webApp vat holds it, and hands the cache a WebApp narrowed to one site, with the cookie as a header. (A LAN device is the same, for private addresses.)
- **Ingress**: serves web requests at some labels (`?app=bookmarks`). The cache serves its page through one.
- **Git trees**: read files from a git checkout as a git tree lists them, and only while they still match. The cache renders its page from a template in one, so the page's template is exactly the one committed.

A project built on toybox can add its own: a device is an ordinary vat granted a service binding from the config, and who gets the I/O is up to the boot vat. See [adding a device](CONTRIBUTING.md#adding-a-device).

## Durable objects, upgradable code

A vat's objects (`exoClass`, `exoClassKit`, map stores) live in its own SQLite, and their interface guards are checked as anywhere in Endo. References between vats live in the kernel's. `createVat` answers the vat's root and its admin node, which can upgrade it to new code that keeps its objects.

## Packaged with nix

The workspace's [flake](../../flake.nix) builds a `toybox-serve` and a NixOS module, `services.toybox`, with units for hosts that aren't NixOS.

How it works, and how to work on it: [CONTRIBUTING.md](CONTRIBUTING.md).
