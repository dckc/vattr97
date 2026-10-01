# Contributing to cf-webkey-ipfs

Keep it runnable and small. Do not `wrangler deploy`.

## Style

- Jessie-style JavaScript: no classes, no `this`. An object is a hardened
  record of closures returned by a `make…` function. The one class is the
  Durable Object in `src/index.js`, which the Workers runtime requires.
- `harden` (from `@endo/harden`) every export and every record that leaves
  the function that made it. Do not harden byte arrays.
- Inject all I/O, randomness and time. Only `src/index.js`, `scripts/` and
  the last lines of `public/app.js` touch ambient authority.
- Give each function the least authority it needs.
- Check every argument that arrives over RPC before using it.
- JSDoc types with `// @ts-check`; prettier settings in `.prettierrc.json`.

## Tests

Test files are `.spec.js`: each `it` states a behavior. Run `yarn check`
before presenting work as done.

`src/` modules are tested against in-memory stand-ins from `test/support.js`;
`test/worker.spec.js` drives the real Worker and Durable Object.
