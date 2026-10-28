/**
 * @file Escrow tests: the test plays the books' host; each trader holds
 * only purses it made from the issuers it was given.
 * @see ../src/escrow-seats.ts
 */

import test, { type ExecutionContext } from 'ava';
import Database from 'better-sqlite3';
import type { Brand, NatAmount, Payment } from '../src/ertp-types.js';
import {
  createIssuerKit,
  initGnuCashSchema,
  makeEscrows,
  openIssuerKit,
  type SqlDatabase,
} from '../src/index.js';
import { mockMakeGuid } from '../src/guids.js';
import { defaultZone } from '../src/jessie-tools.js';
import { wrapBetterSqlite3Database } from '../src/sqlite-shim.js';
import type { Guid, IssuerKitForCommodity } from '../src/types.js';
import { makeTestClock } from './mock-io.js';

const { freeze } = Object;

type Kind = 'usdc' | 'stock';
const otherKind = (kind: Kind): Kind => (kind === 'usdc' ? 'stock' : 'usdc');

/**
 * One incarnation of the books: kits and escrows over `db`, as the
 * ledger in ertp-clerk wires them.
 */
const openBooks = (
  db: SqlDatabase,
  commodities: Record<Kind, Guid>,
  makeGuid: () => Guid,
  nowMs: () => number,
) => {
  const kitsByGuid = new Map<Guid, IssuerKitForCommodity>();
  const provideKit = (commodityGuid: Guid) => {
    let kit = kitsByGuid.get(commodityGuid);
    if (!kit) {
      kit = openIssuerKit({ db, commodityGuid, makeGuid, nowMs });
      kitsByGuid.set(commodityGuid, kit);
    }
    return kit;
  };
  const kits = {
    usdc: provideKit(commodities.usdc),
    stock: provideKit(commodities.stock),
  };
  const commodityOfBrand = (brand: Brand<'nat'>) => {
    for (const [guid, { kit }] of kitsByGuid) {
      if (kit.brand === brand) return guid;
    }
    throw Error('not a brand of these books');
  };
  const openPurse = (commodityGuid: Guid, accountGuid: Guid) =>
    provideKit(commodityGuid).accounts.openAccountPurse(accountGuid);
  const escrows = makeEscrows({
    db,
    zone: defaultZone,
    makeGuid,
    commodityOfBrand,
    issuerOf: commodityGuid => {
      const { issuer, brand } = provideKit(commodityGuid).kit;
      return { issuer, brand };
    },
    makeHolding: commodityGuid => {
      const accountGuid = makeGuid();
      provideKit(commodityGuid).accounts.makeAccountPurse(accountGuid);
      return accountGuid;
    },
    openHolding: openPurse,
    depositFacetOf: (commodityGuid, accountGuid) =>
      openPurse(commodityGuid, accountGuid).getDepositFacet(),
    accountOfDepositFacet: (depositFacet, commodityGuid) => {
      const accountGuid =
        provideKit(commodityGuid).depositFacetGuids.get(depositFacet);
      if (!accountGuid) throw Error('not a deposit facet of that brand');
      return accountGuid;
    },
  });
  const issuers = { usdc: kits.usdc.kit.issuer, stock: kits.stock.kit.issuer };
  const amount = (kind: Kind, value: bigint): NatAmount =>
    freeze({ brand: kits[kind].kit.brand, value });
  return { kits, escrows, issuers, amount };
};
type Books = ReturnType<typeof openBooks>;
type Issuers = Books['issuers'];
type Seat = ReturnType<Books['escrows']['makeEscrow']>['a'];

const makeScenario = (t: ExecutionContext) => {
  const rawDb = new Database(':memory:');
  t.teardown(() => rawDb.close());
  const db = wrapBetterSqlite3Database(rawDb);
  initGnuCashSchema(db);
  const makeGuid = mockMakeGuid();
  const nowMs = makeTestClock();
  const createCommodity = (mnemonic: string) =>
    createIssuerKit({
      db,
      commodity: { namespace: 'COMMODITY', mnemonic },
      makeGuid,
      nowMs,
    }).commodityGuid;
  const commodities = {
    usdc: createCommodity('USDC'),
    stock: createCommodity('STOCK'),
  };
  const restart = () => openBooks(db, commodities, makeGuid, nowMs);
  return { books: restart(), restart };
};

/**
 * A party to escrows who gives `kind` for the other kind, from purses
 * it makes itself. Refunds and payouts reach it only through its
 * deposit facets. A refused offer goes back into its purse.
 *
 * @param endowment - what it starts with, of `kind`
 */
const makeTrader = (
  kind: Kind,
  issuers: Issuers,
  endowment: Payment<'nat'>,
) => {
  const purses = {
    usdc: issuers.usdc.makeEmptyPurse(),
    stock: issuers.stock.makeEmptyPurse(),
  };
  purses[kind].deposit(endowment);
  const payout = purses[otherKind(kind)].getDepositFacet();
  return freeze({
    /** @param shortBy - how much less than the terms it gives; a cheat */
    trade: async (seat: Seat, shortBy = 0n) => {
      const { give } = seat.getTerms();
      const payment = purses[kind].withdraw(
        freeze({ ...give, value: give.value - shortBy }),
      );
      try {
        return await seat.offer(
          payment,
          purses[kind].getDepositFacet(),
          payout,
        );
      } catch (err) {
        purses[kind].deposit(payment);
        throw err;
      }
    },
    /** a purse where a deposit facet belongs */
    offerPurseAsRefund: async (seat: Seat) => {
      const payment = purses[kind].withdraw(seat.getTerms().give);
      try {
        // @ts-expect-error a purse where a deposit facet belongs
        return await seat.offer(payment, purses[kind], payout);
      } catch (err) {
        purses[kind].deposit(payment);
        throw err;
      }
    },
    payout,
    getBalances: () =>
      [purses.usdc, purses.stock].map(p => p.getCurrentAmount().value),
  });
};

const startTraders = ({ kits, issuers }: Books) => {
  const mint = (kind: Kind, value: bigint) =>
    kits[kind].kit.mint.mintPayment(
      freeze({ brand: kits[kind].kit.brand, value }),
    );
  return {
    alice: makeTrader('usdc', issuers, mint('usdc', 1000n)),
    bob: makeTrader('stock', issuers, mint('stock', 10n)),
  };
};

test('escrow swaps USDC for stock', async t => {
  const { books } = makeScenario(t);
  const { alice, bob } = startTraders(books);
  const { a, b } = books.escrows.makeEscrow(
    books.amount('usdc', 300n),
    books.amount('stock', 3n),
  );
  t.is(await alice.trade(a), 'open');
  t.is(await bob.trade(b), 'settled');
  t.is(a.getState(), 'settled');
  t.deepEqual(alice.getBalances(), [700n, 3n]);
  t.deepEqual(bob.getBalances(), [300n, 7n]);
});

test('a short offer is refused and the escrow stays open', async t => {
  const { books } = makeScenario(t);
  const { alice, bob } = startTraders(books);
  const { a, b } = books.escrows.makeEscrow(
    books.amount('usdc', 300n),
    books.amount('stock', 3n),
  );
  await t.throwsAsync(() => alice.trade(a, 1n), {
    message: 'offer must give exactly 300',
  });
  t.deepEqual(alice.getBalances(), [1000n, 0n]);
  t.is(await bob.trade(b), 'open');
  t.is(await alice.trade(a), 'settled');
});

test('cancel refunds what was offered; later offers are refused', async t => {
  const { books } = makeScenario(t);
  const { alice, bob } = startTraders(books);
  const { a, b } = books.escrows.makeEscrow(
    books.amount('usdc', 300n),
    books.amount('stock', 3n),
  );
  await alice.trade(a);
  t.deepEqual(alice.getBalances(), [700n, 0n]);
  t.is(a.cancel(), 'cancelled');
  t.deepEqual(alice.getBalances(), [1000n, 0n]);
  await t.throwsAsync(() => bob.trade(b), { message: 'escrow cancelled' });
  t.deepEqual(bob.getBalances(), [0n, 10n]);
});

test('a settled escrow refuses offers and cancels', async t => {
  const { books } = makeScenario(t);
  const { alice, bob } = startTraders(books);
  const { a, b } = books.escrows.makeEscrow(
    books.amount('usdc', 300n),
    books.amount('stock', 3n),
  );
  await alice.trade(a);
  await bob.trade(b);
  await t.throwsAsync(() => alice.trade(a), { message: 'escrow settled' });
  t.throws(() => b.cancel(), { message: 'escrow settled' });
});

test('a purse in place of a deposit facet is refused', async t => {
  const { books } = makeScenario(t);
  const { alice } = startTraders(books);
  const { a } = books.escrows.makeEscrow(
    books.amount('usdc', 300n),
    books.amount('stock', 3n),
  );
  await t.throwsAsync(() => alice.offerPurseAsRefund(a), {
    message: 'not a deposit facet of that brand',
  });
  t.deepEqual(alice.getBalances(), [1000n, 0n]);
  t.is(a.getState(), 'open');
});

test('an escrow outlives a restart between the two offers', async t => {
  const { books: one, restart } = makeScenario(t);
  const { alice } = startTraders(one);
  const { a, b } = one.escrows.makeEscrow(
    one.amount('usdc', 300n),
    one.amount('stock', 3n),
  );
  await alice.trade(a);
  const seatB = one.escrows.describeSeat(b);
  const alicePayout = one.kits.stock.depositFacetGuids.get(alice.payout);
  if (!seatB || !alicePayout) throw Error('the books lost the seat or facet');

  const two = restart();
  const b2 = two.escrows.provideSeat(seatB.escrowGuid, seatB.side);
  t.is(b2.getState(), 'open');
  const { bob } = startTraders(two);
  t.is(await bob.trade(b2), 'settled');
  t.deepEqual(bob.getBalances(), [300n, 7n]);
  const aliceStock = two.kits.stock.accounts.openAccountPurse(alicePayout);
  t.is(aliceStock.getCurrentAmount().value, 3n);
});
