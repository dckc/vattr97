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
