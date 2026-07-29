# ERTP double-entry accounting

## Endo integration

The escrow integration test uses the Endo daemon APIs from a sibling Endo
checkout. The Yarn link dependencies in `package.json` expect this layout:

```text
~/projects/
├── endo/
└── vattr97/
```

In other words, Endo must be available at `~/projects/endo` when this
repository is at `~/projects/vattr97`. Run `yarn install` from the repository
root after creating or updating that checkout. The Endo checkout must also
have its own dependencies installed; the linked packages resolve their
internal workspace dependencies there.

Run the integration test with:

```sh
cd packages/ertp-dacct
npm run test:integration
```

The script imports `@endo/init` before its other Endo dependencies, while the
package command preloads the TypeScript loader. Set `DB_PATH` to retain and
inspect a particular SQLite database; otherwise the test uses and removes a
temporary database.

The scenario is actor-oriented: Alice and Bob each own the preparation of
their offer, payout facets, and one-shot state; an escrow actor owns the
exchange protocol. The test driver sends messages to all three with `E(...)`
and observes only the escrow actor's result.

The composition root acts as a trusted narrator. It gives each trader the two
issuers, an initial payment, and purse-only sealing capabilities. Each trader
creates its own refund and wanted-asset purses, derives the wanted brand from
its issuer, and exposes only sealed purse identities. The narrator assigns
account names through commodity-specific chart facets using those seals. It
also uses each kit's narrow `mintInfo` facet to identify and place the holding
and recovery accounts. All narrated trader and mint accounts sit beneath the
active GnuCash book's root; the narrator retains the mints, charts, and
database authority.

The money issuer opens the book's existing `CURRENCY:USD` commodity rather
than creating another USD row. Currency accounts inherit its fraction as
their GnuCash commodity SCU; the fixture's USD therefore uses SCU 100.
Issuer-internal accounts are `BANK` for the `CURRENCY` namespace and `STOCK`
for security commodities.

The exported `main(argv, env, powers)` is the composition root. Its powers are
limited to ambient and effectful capabilities such as daemon connection,
filesystem cleanup, signals, OS information, randomness, and output.
Application constructors and actor primitives remain ordinary lexical
imports. The guarded executable adapter is the only module-level invocation.
