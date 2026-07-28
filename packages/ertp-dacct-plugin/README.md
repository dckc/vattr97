# Endo daemon SQLite example

This package splits ambient database access from confined application logic:

- `src/sqlite-db.js` is an **unconfined** plugin. It loads the native
  `better-sqlite3` module and opens the one path injected as `DB_PATH`.
- `src/confined-store.js` is a **confined** plugin. It has no filesystem or
  native-module access. It obtains the database capability by asking its
  powers for the `sqlite-db` petname.

Set `ENDO` to the Endo CLI you want to use, then run:

```sh
cd packages/ertp-dacct-plugin
ENDO=${ENDO:-endo}
DB_PATH=${DB_PATH:-/tmp/vattr97.sqlite}

"$ENDO" make --UNCONFINED src/sqlite-db.js \
  -n sqlite-db -E DB_PATH="$DB_PATH"
"$ENDO" make src/confined-store.js -p @agent -n confined-store

"$ENDO" eval 'E(confinedStore).set("answer", "42")' \
  confinedStore:confined-store
"$ENDO" eval 'E(confinedStore).get("answer")' \
  confinedStore:confined-store
```

The final command prints `"42"`. The `-p @agent` grant gives the confined
plugin a name hub whose `lookup("sqlite-db")` resolves the database petname.
The service retains the resulting remote `execute` and `query` capability; it
never receives the database path or Node.js filesystem authority.

`confined-store.js` uses the `E` and `Far` globals supplied by its Endo worker.
Keeping its archive import-free also avoids the transitive JSDoc
`import(...)` rejection fixed by
[endo-but-for-bots#427](https://github.com/endojs/endo-but-for-bots/pull/427).
