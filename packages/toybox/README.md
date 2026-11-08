# toybox

Durable objects whose state can hold objects. Like a Cloudflare Durable Object's, toybox's state outlives restarts, upgrades, and crashes, but it can hold other objects, and references to objects in other programs, not only rows of data. And a program can do only what the references it's handed let it do.

## Getting started

From a clone of this repository, with Node 22 or later:

```sh
corepack enable
yarn install
cd packages/toybox
yarn build
./scripts/hello.js
```

It prints a URL; open it to see a page served by a program running in toybox ([examples/hello-page.js](examples/hello-page.js)), which counts its hits. Ctrl-C stops it.

## Objects that outlive restarts

A program defines kinds of durable objects in its zone:

```js
const makeCounter = zone.exoClass(
  'Counter',
  undefined,
  (count = 0) => ({ count }),
  {
    incr() {
      this.state.count += 1;
      return this.state.count;
    },
  },
);
const counter = zone.makeOnce('counter', () => makeCounter());
```

`this.state.count += 1` is stored at once, as a write to Durable Object storage would be. But `counter` is an object: the program can keep it in another object's state or in a store, or hand it to another program, which can keep it in turn and call it after a restart. When the program is upgraded to new code, its objects keep their state and take on the new code's methods. [src/types.ts](src/types.ts) is the guide to the rest: kinds with several facets, stores, and what else a program gets.

## Separation of powers, wired by reference

Each program runs as a _vat_: a module of its own, in a Durable Object facet of its own, run by toybox's kernel. Like a [brain in a vat](https://en.wikipedia.org/wiki/Brain_in_a_vat), all it knows of the world is what the kernel feeds it, and all it can do is send messages to the references it holds. It can't forge one, and its global `fetch` reaches nothing. So who can do what is a matter of who handed whom which reference.

The bookmark cache in [examples/bookmarks/](examples/bookmarks/) splits one job (keep a copy of a bookmark site that needs a login cookie, and serve it as a page) across four vats:

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

The cache, the part that runs most often, holds the least: one WebApp, narrowed to one site, a place to serve its page, and read-only templates. Boot makes the others and introduces them by passing references; [the test](test/kernel.test.js) wires it up, restarts every vat, and finds everything still in place.

## Devices: how a vat reaches the world

A vat reaches outside only through objects the kernel provides, its devices. Whoever holds the admin socket makes them, and hands each to the vat that needs it. So the admin socket is for the operator alone: it checks nothing, and anyone who can open it can make any device and install any code. The bookmark cache uses each of these:

- **vatAdmin**: makes vats. Boot holds it to make the other three.
- **nixStore**: runs code from a nix store path, kept by the hash of its contents. Boot gets each vat's code from one, so what runs is exactly what was built into the store.
- **Fetch device**: the public internet. The webApp vat holds it, and hands the cache a WebApp narrowed to one site, with the cookie as a header. (A LAN device is the same, for private addresses.)
- **Ingress**: serves web requests at some labels (`?app=bookmarks`). The cache serves its page through one.
- **Git trees**: read files from a git checkout as a git tree lists them, and only while they still match. The cache renders its page from a template in one, so the page's template is exactly the one committed.

A project built on toybox can add its own: a device is an ordinary vat granted a service binding from the config, and who gets the I/O is up to the boot vat. See [adding a device](CONTRIBUTING.md#adding-a-device).

## A wallet, from one secret

```sh
yarn wallet
```

That starts a wallet as a systemd user service, `toybox-wallet`, keeping its state in `~/.local/state/toybox-wallet` ([scripts/wallet-service.sh](scripts/wallet-service.sh)); `systemctl --user stop toybox-wallet` stops it. It prints a link to your hub, where everything you hold has a name. Your browser keeps the hub's secret, and nothing else. The hub starts with a counter maker and a currency maker, so you can make counters and mint money. Invite someone with a one-time link, and each of you gets a mailbox to the other: send them a reference, and they can use it, or send one back, such as a way to pay them that can receive money but not spend it. Use a browser profile per person: each profile keeps one hub. The wallet is a boot directory ([examples/wallet/](examples/wallet/)), so its state survives restarts, and changing its code upgrades it on the next start.

## Packaged with nix, or deployed to Cloudflare

The workspace's [flake](../../flake.nix) builds a `toybox-serve` and a NixOS module, `services.toybox`, with units for hosts that aren't NixOS. Or toybox runs as a Cloudflare Worker, with a boot directory built in: see [on Cloudflare](CONTRIBUTING.md#on-cloudflare).

## Prior art

toybox follows Agoric's [SwingSet](https://github.com/Agoric/agoric-sdk/tree/master/packages/SwingSet): its kernel, vats, and devices. Its objects, and the way they pass between vats, are [Endo](https://github.com/endojs/endo)'s. You needn't know either to use toybox; they're where to read more.

How it works, and how to work on it: [CONTRIBUTING.md](CONTRIBUTING.md).
