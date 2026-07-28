# SQLite plugin

`@finquick/sqlite-plugin` is an unconfined Endo plugin that opens one
injected SQLite path and exposes an attenuated SQL capability.

The root capability provides autocommit `execute` and `query` methods.
`begin()` executes `BEGIN IMMEDIATE` and returns a transaction Exo with
`execute`, `query`, `commit`, and `rollback`.

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
  -n sqlite-db -E DB_PATH=/path/to/ledger.sqlite
```
