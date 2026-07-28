Here's a continuation prompt for the next session:

---

Continue building `@finquick/ertp-dacct` — an async SQL-based double-entry accounting package wrapping ERTP + GnuCash schemas for Endo daemon.

**Repo:** Monorepo at `/home/connolly/projects/vattr97`, package at `packages/ertp-dacct/`.

**What's done:**
- Scaffold: `package.json`, `tsconfig.json`, `.gitignore`, `.yarnrc.yml` (nodeLinker: node-modules)
- Async interfaces: `src/sql-db.ts`, `src/sqlite-shim.ts` (async wrapper)
- Async DB helpers: `src/db-helpers.ts` (commodity/account CRUD, transfer hold/finalize, balance)
- Async facet factories: `src/purse.ts`, `src/chart.ts`, `src/settlement.ts`
- Async issuer kit: `src/index.ts` (`createIssuerKit`, `openIssuerKit`, `initGnuCashSchema` all async)
- Copied unchanged: `ertp-types.ts`, `endo-types.ts`, `guids.ts`, `sealer.ts`, `jessie-tools.ts`, `gnucash-schema.ts`, `escrow-ertp.ts`, `sql/gc_empty.ts`, `sql/gc_empty.sql`, `scripts/codegen-sql.mjs`, `test/fixtures/*`
- Test infra: `test/mock-io.ts`, `test/gnucash-tools.ts`, `test/ertp-tools.ts`
- 10 test files (bottom-up): `jessie-tools`, `guids`, `sealer`, `escrow-ertp`, `db-helpers`, `purse`, `chart`, `settlement`, `ledger`, `adversarial`
- `test/shim.js` — provides `globalThis.harden` via deep-freeze (no WeakSet errors, no `@endo/harden` dependency)
- All tests pass (49/49), `npx tsc --noEmit` is clean, `yarn install` works.

**Key decisions made:**
- `Issuer.makeEmptyPurse()` is async → `makeErtpEscrow` also async (awaits `makeEmptyPurse`)
- `payoutOne` in escrow properly chains `withdraw → receive` to handle async purses
- Test uses `createIssuerKit` from dacct (not `@agoric/ertp` which needs SwingSet)
- `escrow-ertp.test.ts` correctly maps want deposit facets to matching brands
- `test/shim.js` uses inline `makeHardener` with `traversePrototypes: false`

**Commands:**
```sh
cd /home/connolly/projects/vattr97/packages/ertp-dacct
npm test        # 49 tests
npx tsc --noEmit
yarn check
```

**Next steps:**
- Integration/functional testing
- Consider whether `@endo/harden` and `@endo/eventual-send` should move from transitive to direct `devDependencies`
