# @vattr/ertp-clerk

An ERTP ledger ([ertp-books](../ertp-books/)) in a Cloudflare Durable Object, reached by OCapN with Cap'n Web as the netlayer.

Plain Cap'n Web doesn't preserve identity: a payment or brand sent back to the Worker arrives as a fresh stub, so ERTP's `WeakMap` checks fail (`payment not live`). Here Cap'n Web carries only a byte inbox in each direction, one OCapN message per call ([ocapn-capnweb-netlayer.ts](src/ocapn-capnweb-netlayer.ts)). OCapN's tables decide identity, so a brand that goes out and comes back is `===` to the original.

## Usage

```sh
yarn test     # in-process, then the Durable Object under `wrangler dev`
yarn dev      # serves /api
```

A client reaches the ledger by sturdyref (swissnum `ledger`):

```js
const { ledger, enliven } = await connectLedger(() =>
  newWebSocketRpcSession(url),
);
const { issuer, brand, mint } = await E(ledger).makeIssuerKit('BUCKS');
const purse = await E(issuer).makeEmptyPurse();
const swissnum = await E(ledger).makeSturdyRef(purse); // keep this
// ... later, perhaps after the Durable Object restarts:
const samePurse = await enliven(swissnum);
```

Both ends run under SES (`@endo/init`), workerd included.

## Limits

- Live references die with the WebSocket. Sturdyrefs to issuers, brands, mints, and purses survive restarts ([ledger.ts](src/ledger.ts)); payments don't, since their liveness is kept in memory.
- The ledger's OCapN key pair is regenerated each time the Durable Object starts. Clients dial by URL, so nothing checks it yet.
- wrangler can't run in a locked-down process, so the workerd test starts `wrangler dev` as a child process.
