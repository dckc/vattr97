# @vattr/ertp-clerk

An ERTP ledger ([ertp-books](../ertp-books/)) in a Cloudflare Durable Object, reached by OCapN with Cap'n Web as the netlayer.

Plain Cap'n Web doesn't preserve identity: a payment or brand sent back to the Worker arrives as a fresh stub, so ERTP's `WeakMap` checks fail (`payment not live`). Here Cap'n Web carries only a byte inbox in each direction, one OCapN message per call ([ocapn-capnweb-netlayer.ts](src/ocapn-capnweb-netlayer.ts)). OCapN's tables decide identity, so a brand that goes out and comes back is `===` to the original.

## Usage

```sh
yarn test     # in-process, then the Durable Object under `wrangler dev`
yarn dev      # serves /api and /api/<name>
```

Each ledger is a Durable Object named by the path: `/api/usdc` and `/api/stock` are separate ledgers, and `/api` is the one named `default`. A ledger's OCapN designator is its name.

A client reaches a ledger by sturdyref (swissnum `ledger`):

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

One client can hold several ledgers, in one workerd or several; `openGateway` maps a ledger's name to a connection:

```js
const client = await makeLedgerClient(name =>
  newWebSocketRpcSession(`${origins[name]}/api/${name}`),
);
const usdc = await client.ledger('usdc');
const stock = await client.ledger('stock');
```

## Escrow

`E(ledger).makeEscrow(give, want)` makes a two-party escrow and returns a seat for each party. Each party calls `E(seat).offer(payment, refund, payout)`, where `refund` and `payout` are deposit facets: the escrow can put assets in, never take them out; the second offer settles the swap. Either party may `cancel()` before then, which refunds what was offered. The escrow's state lives in the ledger's database ([escrow-seats.ts](../ertp-books/src/escrow-seats.ts)), so a seat's sturdyref works across restarts. Both commodities must be on the same ledger ([#36](https://github.com/dckc/vattr97/issues/36)).

Both ends run under SES (`@endo/init`), workerd included.

## Limits

- Live references die with the WebSocket. Every object the ledger exports can have a sturdyref (`makeSturdyRef`): issuers, brands, mints, purses, deposit facets, payments, and escrow seats. Sturdyrefs survive restarts ([ledger.ts](src/ledger.ts)). A payment's liveness comes from its hold in the ledger; once spent, its sturdyref fails with `payment not live`.
- Ledgers don't dial out, so one ledger can't take another's objects: handing a USDC payment to the STOCK ledger starts an OCapN handoff that fails (`ledger does not dial out`) and the deposit is rejected.
- The ledger's OCapN key pair is regenerated each time the Durable Object starts. Clients dial by URL, so nothing checks it yet.
- wrangler can't run in a locked-down process, so the workerd test starts `wrangler dev` as a child process.
