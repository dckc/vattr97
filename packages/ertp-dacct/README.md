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
package command preloads the TypeScript loader for the composition script.
The confined ledger archive includes the TypeScript accounting sources
through `@endo/bundle-source`, which erases types with Amaro; no generated
`dist` tree is involved. Set `DB_PATH` before the first run to select a
database; otherwise the composition retains `./escrow.sqlite`.

The scenario runs three confined Endo guests. Alice and Bob each own the
preparation of their offer, payout facets, purses, and one-shot state. The
ledger guest owns the issuer kits, mints, and chart facets. The top-level
composition owns the scenario and escrow coordination. The test driver sends
messages across all three guest boundaries with `E(...)`.

Within that archive, `guests/ledger.js` is generic. Its distinct
`makeCurrencyIssuerKit` and `makeCommodityIssuerKit` methods return issuer
kits with chart-backed account name admins; chart facets and book-root GUIDs
remain inside the ledger. Trader roles, amounts, and narration live in the
top-level integration script. The ledger receives both its SQLite database
and clock as remote powers; timestamp authority remains outside the confined
worker.

The composition root acts as a trusted narrator. It gives each trader the two
issuers, an initial payment, and purse-only sealing capabilities. Each trader
creates its own refund and wanted-asset purses, derives the wanted brand from
its issuer, and exposes only sealed purse identities. For each trader, the
narrator derives one scoped child name admin from the money kit and another
from the stock kit. The trader names each sealed purse through its matching
admin, so a purse sealed by the other issuer is rejected. Account names are
resolved as paths beneath the active GnuCash book root.

The composition creates private name hubs with `provideGuest`. SQLite is
moved only into the ledger hub. Alice and Bob are created without trader-kit
powers. For each offer, a formula in the ledger worker mints the payment,
derives the trader's two scoped account name admins, and sends only those
offer terms directly to that trader. Neither trader receives the narrator
facet, mint authority, or the other trader's capabilities.

The resulting formulas persist after the script exits. The host inventory
retains `alice`, `bob`, and `ledger`, along with the ledger worker, issuer
kits, and their dependencies. After creating each actor, the composition
removes the host's pet name for its private profile. Each actor formula
retains its profile as a powers dependency, but the host can no longer
traverse the ledger profile to recover `sqlite-db`. Only the transient source
archives and the script's client connection are otherwise cleaned up.

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
