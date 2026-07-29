# Refine database references

- [x] Inspect the current database types, API boundaries, and tests.
- [x] Add a failing test that exercises an `ERef<DB>`.
- [x] Refine `ertp-dacct` APIs and internals to accept an `ERef<DB>`.
- [x] Run type checks and focused tests.
- [x] Run the full package check.

## JavaScript daemon composition

- [x] Verify the API against `~/projects/endo`.
- [x] Add a JavaScript composer for the SQLite and confined plugins.
- [x] Update the plugin README with the JavaScript entry point.
- [x] Verify package checks and the composer setup.

## Escrow integration script

- [x] Extract the successful escrow swap scenario into a standalone script.
- [x] Compose the script with the Endo daemon SQLite capability.
- [x] Add a package command and usage documentation.
- [x] Run the script and package checks.

## Endo package imports

- [x] Replace runtime checkout-path imports with Yarn link dependencies.
- [x] Preload Endo initialization before evaluating the integration script.
- [x] Document the required Endo checkout location.
- [x] Reinstall dependencies and rerun verification.

## Actor-oriented escrow integration

- [x] Model Alice, Bob, and escrow as actors with narrow protocols.
- [x] Drive the exchange exclusively with eventual sends.
- [x] Verify the actor interaction against the remote database.
- [x] Rerun package checks.

## Testable composition root

- [x] Export `main(argv, env, powers)` with production power defaults.
- [x] Move daemon, filesystem, clock, and output authority behind `powers`.
- [x] Guard executable invocation so imports have no operational effects.
- [x] Rerun the integration and existing package checks.

## Power boundary

- [x] Keep application constructors and actor primitives as lexical imports.
- [x] Limit `main` powers to ambient and effectful capabilities.
- [x] Update documentation and rerun verification.

## Narrated account names

- [x] Let the trusted composition root provision trader purses.
- [x] Name each purse through commodity-specific chart facets.
- [x] Keep naming authority out of the Alice and Bob actors.
- [x] Verify the resulting integration and package checks.

## Trader authority boundary

- [x] Reproduce the leaked mint authority.
- [x] Mint initial payments in the trusted composition root.
- [x] Endow traders only with payment, wanted brand, and payout purses.
- [x] Verify the integration and package checks.

## Trader-owned purses

- [x] Specify trader purse creation and sealed-purse disclosure.
- [x] Endow traders with issuers, payments, and narrow purse sealers.
- [x] Let the narrator name accounts from sealed purse identities.
- [x] Verify the integration and package checks.

## GnuCash account tree

- [x] Read the active book's root account from the database.
- [x] Place all narrated trader accounts beneath that root.
- [x] Verify persisted parent links and package checks.

## Canonical currency commodity

- [x] Reproduce duplicate commodity identity and incorrect account SCU.
- [x] Reject duplicate commodity namespace/mnemonic identities.
- [x] Support a chart-capable issuer kit over an existing commodity.
- [x] Use the existing `CURRENCY:USD` in the integration scenario.
- [x] Derive account SCU from commodity fraction and verify GnuCash rows.

## Commodity row access

- [x] Add a typed helper that fetches the complete commodity row.
- [x] Refactor alleged-name and fraction access through that helper.
- [x] Verify row access, fallback behavior, and package checks.

## Namespace-specific issuer accounts

- [x] Reproduce currency mint accounts classified as `STOCK`.
- [x] Fetch the commodity row once in `makeIssuerKitForCommodity`.
- [x] Derive its label and internal account type from the row.
- [x] Verify currency and security issuer account classifications.

## Narrated mint accounts

- [x] Read internal account identities through each kit's `mintInfo`.
- [x] Place and name mint accounts through chart facets.
- [x] Verify mint accounts are rooted and retain their transactions.

## Endo guest isolation

- [x] Verify the current guest/caplet composition API against the local Endo checkout.
- [x] Package Alice, Bob, and ledger as separate guest programs.
- [x] Give each guest only the names and capabilities required by its role.
- [x] Drive the narrated escrow exchange across the three guest boundaries.
- [x] Verify the integration and package checks.

## Native TypeScript guest bundle

- [x] Replace the generated `dist` guest build with Endo TypeScript bundling.
- [x] Use explicit TypeScript module specifiers throughout the bundled source.
- [x] Remove obsolete build scripts and dependencies.
- [x] Verify the TypeScript archive with the daemon and rerun package checks.

## Generic ledger guest helper

- [x] Separate generic issuer/chart construction from the escrow scenario.
- [x] Export a `makeIssuerKit` variant that includes its chart facet.
- [x] Keep currency, security, trader, and narration choices in the scenario.
- [x] Verify the refactored guest archive and package checks.

## Top-level escrow scenario

- [x] Make `ledger.js` the generic ledger guest entry point.
- [x] Make ERTP escrow operate on eventual issuer and purse references.
- [x] Move commodity, trader, minting, narration, and exchange composition to the top-level script.
- [x] Remove the escrow guest module.
- [x] Verify all guest boundaries and package checks.

## Programmatic Endo make

- [x] Encapsulate bundling, blob storage, caplet creation, and archive cleanup.
- [x] Support multiple caplets from one archive.
- [x] Remove archive mechanics from the integration `main`.
- [x] Verify the refactored composition and package checks.

## Persistent scenario actors

- [x] Give Alice, Bob, and the ledger stable Endo pet names.
- [x] Retain their guest profiles, workers, and formula dependencies.
- [x] Use a persistent database path and leave its service open.
- [x] Clean up only transient archives and the client connection.
- [x] Verify the retained actors after the script exits.

## Endo client scope

- [x] Encapsulate daemon connection and bootstrap details in an async IIFE.
- [x] Expose only the host agent and client shutdown operation to `main`.
- [x] Rerun package checks.

## Exclusive database authority

- [x] Drop the host's ledger-profile pet name after creating the ledger.
- [x] Keep SQLite reachable only through the ledger formula's powers dependency.
- [x] Verify code and package checks.

## Trader endowment shape

- [x] Group offered-side issuer, payment, and sealer under `give`.
- [x] Group wanted-side issuer, value, and sealer under `want`.
- [x] Update durable formulas and focused tests.
- [x] Rerun package checks.

## Narration helpers

- [x] Hoist mint-account placement out of `main`.
- [x] Hoist trader-purse placement out of `main`.
- [x] Keep `main` focused on scenario sequencing.
- [x] Rerun package checks.

## Narration authority

- [x] Limit trader-account placement to chart facets.
- [x] Limit mint-account placement to chart, brand, and mint-info facets.
- [x] Rerun package checks.

## Ledger setup scope

- [x] Encapsulate SQLite and ledger construction in an async IIFE.
- [x] Include issuer-kit creation and mint-account placement in that scope.
- [x] Return only the durable names and narrow facets needed by the scenario.
- [x] Rerun package checks.

## Hoisted setup functions

- [x] Hoist Endo connection setup to `connectEndo`.
- [x] Hoist ledger construction to `setupLedger`.
- [x] Keep their runtime-power and result boundaries narrow.
- [x] Rerun package checks.
