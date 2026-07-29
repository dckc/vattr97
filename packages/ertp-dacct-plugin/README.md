# Endo daemon SQLite example

This package demonstrates the split between ambient database access and
confined application logic:

- `@finquick/sqlite-plugin` is the reusable **unconfined** plugin. The
  plugin loads `better-sqlite3` and opens the path injected as `DB_PATH`.
- `src/confined-store.js` is a **confined** plugin. It has no filesystem or
  native-module access. It obtains the database capability by asking its
  powers for the `sqlite-db` petname.

The pieces can be composed directly through the Endo daemon's JavaScript API.
This script uses the checkout at `~/projects/endo` by default:

```sh
cd packages/ertp-dacct-plugin
node scripts/compose.js
```

Set `ENDO_ROOT` to use another Endo checkout and `DB_PATH` to choose another
database file. The script prints `42`.

The `@agent` grant gives the confined plugin a name hub whose
`lookup("sqlite-db")` resolves the database petname.
The service retains the resulting remote `execute` and `query` capability; it
never receives the database path or Node.js filesystem authority.

The database capability also provides `begin()`. It reserves the connection
and returns a transaction Exo; root and competing transaction operations
reject until that Exo commits or rolls back. See
`packages/sqlite-plugin/README.md`.

`confined-store.js` uses the `E` and `Far` globals supplied by its Endo worker.
Keeping its archive import-free also avoids the transitive JSDoc
`import(...)` rejection fixed by
[endo-but-for-bots#427](https://github.com/endojs/endo-but-for-bots/pull/427).
