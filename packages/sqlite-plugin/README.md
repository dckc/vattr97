# SQLite plugin

`@finquick/sqlite-plugin` is an unconfined Endo plugin that exposes a maker
capability. Its `makeDb(path)` method opens an independent attenuated SQLite
capability for the given path.

The root capability provides autocommit `execute`, `query`, and `prepare`
methods. `prepare<TParams, TRow>()` returns a typed statement capability with
`run`, `get`, and `all` methods. `begin()` executes `BEGIN IMMEDIATE` and
returns a transaction Exo with the same SQL operations plus `commit` and
`rollback`.

While a transaction is active:

- only its transaction Exo can use the connection;
- root operations and competing `begin()` calls reject;
- raw transaction-control SQL rejects; and
- `commit()` or `rollback()` permanently disables the transaction Exo and
  releases the connection.

The transaction result is promise-pipelineable, so a batch needs no
intermediate round trips:

```js
const txP = E(db).begin();
const writes = [
  E(txP).execute('INSERT INTO item (name) VALUES (?)', ['first']),
  E(txP).execute('INSERT INTO item (name) VALUES (?)', ['second']),
];
const commitP = E(txP).commit();
await Promise.all([...writes, commitP]);
```

Calls sent to the same transaction are processed in order. The first failed
statement poisons the transaction, causing an already-pipelined `commit()` to
roll back and reject rather than commit partial work.

Prepared statement calls target a separate statement capability. Await
transaction statement operations before sending `commit()`; for a fully
pipelined transaction, use `execute` and `query` directly on the transaction
as shown above.

`close()` rolls back an active transaction before closing the database.
Process or connection termination also causes SQLite to roll back an
uncommitted transaction.

An abandoned transaction currently keeps the live plugin connection reserved
until `close()` or process termination; the package does not yet impose a
transaction lease.

Transaction ownership prevents unrelated callers from accidentally joining a
connection-level transaction. It does not make daemon state, mail, or other
external effects part of the SQLite transaction, and it does not remove the
ambiguous-result window if a commit succeeds but its response is lost.

## Endo

```sh
endo make --UNCONFINED packages/sqlite-plugin/src/sqlite-db.js \
  -n sqlite-db-maker
```
