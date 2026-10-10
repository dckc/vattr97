# @vattr/ertp-clerk

An ERTP ledger ([ertp-books](../ertp-books/)) in a Cloudflare Durable Object, reached by CapTP with Cap'n Web as the netlayer.

Plain Cap'n Web doesn't preserve identity: a payment or brand sent back to the Worker arrives as a fresh stub, so ERTP's `WeakMap` checks fail (`payment not live`). Here Cap'n Web carries only an inbox of serialized CapTP messages in each direction ([captp-over-capnweb.ts](src/captp-over-capnweb.ts)). CapTP's tables decide identity, so a brand that goes out and comes back is `===` to the original.

## Usage

```sh
yarn test     # in-process, then the Durable Object under `wrangler dev`
yarn dev      # serves /api for a CapTP-over-Cap'n Web client
```

A client connects with `connectCapTP(newWebSocketRpcSession(url), name)` and gets the ledger bootstrap from `getBootstrap()`. See [test/worker.test.ts](test/worker.test.ts).

Both ends run under SES (`@endo/init`), workerd included.

## Limits

- One CapTP connection per WebSocket. References die with the session; reconnecting starts over with the bootstrap. Durable references (sturdyrefs) need OCapN, not CapTP.
- wrangler can't run in a locked-down process, so the workerd test starts `wrangler dev` as a child process.
