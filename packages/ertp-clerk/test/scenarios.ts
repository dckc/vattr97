/**
 * @file ERTP scenarios against a remote ledger bootstrap, shared by the
 * in-process and workerd tests.
 */
import type { ExecutionContext } from 'ava';
import { E, Far, type ERef } from '@endo/far';
import type {
  DepositFacet,
  Issuer,
  NatAmount,
  Payment,
  Purse,
} from '@vattr/ertp-books/src/ertp-types.js';
import type { makeLedger } from '../src/ledger.js';

/**
 * What a ledger's peer claims its bootstrap is; a test that connects
 * over the network asserts it, since nothing on the wire checks.
 */
export type Ledger = ReturnType<typeof makeLedger>['bootstrap'];

/** Bob keeps a purse and hands anyone its deposit facet. */
const makeBob = async (issuer: ERef<Issuer<'nat'>>) => {
  const purse = await E(issuer).makeEmptyPurse();
  return harden({
    depositFacet: await E(purse).getDepositFacet(),
    getBalance: () => E(purse).getCurrentAmount(),
  });
};

/**
 * Alice starts with `savings`; when run, she pays `amount` to `payee`.
 */
const makeAlice = async (
  issuer: ERef<Issuer<'nat'>>,
  savings: Payment<'nat'>,
  payee: ERef<DepositFacet<'nat'>>,
  amount: NatAmount,
) => {
  const purse = await E(issuer).makeEmptyPurse();
  await E(purse).deposit(savings);
  return harden({
    run: async () => E(payee).receive(await E(purse).withdraw(amount)),
    getBalance: () => E(purse).getCurrentAmount(),
  });
};

/** The test holds the mint and introduces Alice to Bob's deposit facet. */
export const aliceSendsBob10Bucks = async (
  t: ExecutionContext,
  ledger: ERef<Ledger>,
) => {
  const { issuer, brand, mint } = await E(ledger).makeIssuerKit('BUCKS');
  t.is(await E(brand).getAllegedName(), 'BUCKS');
  const bucks = (value: bigint) => harden({ brand, value });
  const bob = await makeBob(issuer);
  const alice = await makeAlice(
    issuer,
    await E(mint).mintPayment(bucks(10n)),
    bob.depositFacet,
    bucks(10n),
  );

  await alice.run();

  t.is((await alice.getBalance()).value, 0n);
  const bobAmount = await bob.getBalance();
  t.is(bobAmount.value, 10n);
  t.is(bobAmount.brand, brand, 'brand comes back as the same presence');
  t.is(await E(issuer).getBrand(), brand);
};

export const spentPaymentIsNotLive = async (
  t: ExecutionContext,
  ledger: ERef<Ledger>,
) => {
  const { issuer, brand, mint } = await E(ledger).makeIssuerKit('BUCKS');
  const bob = await makeBob(issuer);
  const payment = await E(mint).mintPayment(harden({ brand, value: 10n }));
  await E(bob.depositFacet).receive(payment);
  await t.throwsAsync(() => E(bob.depositFacet).receive(payment), {
    message: /payment not live/,
  });
};

type Issuers = { usdc: ERef<Issuer<'nat'>>; stock: ERef<Issuer<'nat'>> };

type Purses = { usdc: ERef<Purse<'nat'>>; stock: ERef<Purse<'nat'>> };
const balancesOf = async ({ usdc, stock }: Purses) => [
  (await E(usdc).getCurrentAmount()).value,
  (await E(stock).getCurrentAmount()).value,
];

/** A party's own USDC and STOCK purses, and a read of their balances. */
const makePurses = async (issuers: Issuers) => {
  const usdc = await E(issuers.usdc).makeEmptyPurse();
  const stock = await E(issuers.stock).makeEmptyPurse();
  return { usdc, stock, getBalances: () => balancesOf({ usdc, stock }) };
};

/** USDC per share */
const PRICE = 100n;

/**
 * A seller of shares for USDC. Buyers reach it only through its shop;
 * it acts only when a buyer calls.
 *
 * @param shares - the seller's starting shares
 */
const makeSeller = async (issuers: Issuers, shares: Payment<'nat'>) => {
  const { usdc, stock, getBalances } = await makePurses(issuers);
  await E(stock).deposit(shares);
  const stockBrand = await E(issuers.stock).getBrand();
  const shop = Far('Shop', {
    /** deliver as many shares as `payment` covers to `deliverTo` */
    sell: async (
      payment: Payment<'nat'>,
      deliverTo: ERef<DepositFacet<'nat'>>,
    ) => {
      const paid = await E(usdc).deposit(payment);
      const count = paid.value / PRICE;
      const goods = await E(stock).withdraw(
        harden({ brand: stockBrand, value: count }),
      );
      await E(deliverTo).receive(goods);
    },
  });
  return harden({ shop, getBalances });
};
type Shop = Awaited<ReturnType<typeof makeSeller>>['shop'];

/**
 * A buyer of shares with USDC. Without escrow, it pays first and trusts
 * the seller.
 *
 * @param dollars - the buyer's starting USDC
 * @param count - how many shares it wants
 */
const makeBuyer = async (
  issuers: Issuers,
  dollars: Payment<'nat'>,
  count: bigint,
) => {
  const { usdc, stock, getBalances } = await makePurses(issuers);
  await E(usdc).deposit(dollars);
  const usdcBrand = await E(issuers.usdc).getBrand();
  return harden({
    tradeWith: async (seller: { shop: ERef<Shop> }) =>
      E(seller.shop).sell(
        await E(usdc).withdraw(
          harden({ brand: usdcBrand, value: count * PRICE }),
        ),
        await E(stock).getDepositFacet(),
      ),
    getBalances,
  });
};

/**
 * Alice buys 3 shares from Bob for 300 USDC, each kind of asset on its
 * own ledger. The test holds the mints, makes Alice and Bob, and has
 * Alice trade with Bob.
 */
export const aliceBuysStockFromBob = async (
  t: ExecutionContext,
  usdcLedger: ERef<Ledger>,
  stockLedger: ERef<Ledger>,
) => {
  const usdc = await E(usdcLedger).makeIssuerKit('USDC');
  const stock = await E(stockLedger).makeIssuerKit('STOCK');
  t.not(usdc.brand, stock.brand);
  const issuers = { usdc: usdc.issuer, stock: stock.issuer };
  const dollars = (value: bigint) => harden({ brand: usdc.brand, value });
  const shares = (value: bigint) => harden({ brand: stock.brand, value });

  const alice = await makeBuyer(
    issuers,
    await E(usdc.mint).mintPayment(dollars(1000n)),
    3n,
  );
  const bob = await makeSeller(
    issuers,
    await E(stock.mint).mintPayment(shares(10n)),
  );
  await alice.tradeWith(bob);

  t.deepEqual(await alice.getBalances(), [700n, 3n]);
  t.deepEqual(await bob.getBalances(), [300n, 7n]);
};

type Kind = keyof Purses;
const otherKind = (kind: Kind): Kind => (kind === 'usdc' ? 'stock' : 'usdc');
type Seat = Awaited<ReturnType<Ledger['makeEscrow']>>['a'];

/**
 * Where a trader keeps sturdyrefs to its own purses and payout facet,
 * so a later incarnation of it can go on. The test supplies it, as an
 * operating system supplies a disk.
 */
type Disk = Map<Kind | 'payout', string>;

/**
 * A party to escrows who gives `kind` for the other kind. Given a seat,
 * it offers what the seat says it gives, from its own purse; refunds
 * and payouts reach it only through its deposit facets. A refused
 * offer goes back into its purse.
 *
 * @param shortBy - how much less than the terms it gives; a cheat
 */
const makeTrader = (
  kind: Kind,
  purses: Purses,
  payout: ERef<DepositFacet<'nat'>>,
  shortBy = 0n,
) =>
  harden({
    trade: async (seat: ERef<Seat>) => {
      // the seat's terms name this ledger's brands, so they are nat amounts
      const terms = (await E(seat).getTerms()).give as NatAmount;
      const give = harden({ ...terms, value: terms.value - shortBy });
      const payment = await E(purses[kind]).withdraw(give);
      try {
        return await E(seat).offer(
          payment,
          await E(purses[kind]).getDepositFacet(),
          payout,
        );
      } catch (err) {
        await E(purses[kind]).deposit(payment);
        throw err;
      }
    },
    getBalances: () => balancesOf(purses),
  });

/**
 * @param endowment - what the trader starts with, of `kind`
 * @param persist - if given, the trader saves its sturdyrefs there
 */
const startTrader = async (
  issuers: Issuers,
  kind: Kind,
  endowment: Payment<'nat'>,
  {
    shortBy,
    persist,
  }: {
    shortBy?: bigint;
    persist?: {
      makeSturdyRef: (obj: object) => Promise<string>;
      disk: Disk;
    };
  } = {},
) => {
  const { usdc, stock } = await makePurses(issuers);
  const purses = { usdc, stock };
  await E(purses[kind]).deposit(endowment);
  const payout = await E(purses[otherKind(kind)]).getDepositFacet();
  if (persist) {
    const { makeSturdyRef, disk } = persist;
    disk.set('usdc', await makeSturdyRef(usdc));
    disk.set('stock', await makeSturdyRef(stock));
    disk.set('payout', await makeSturdyRef(payout));
  }
  return makeTrader(kind, purses, payout, shortBy);
};

const reviveTrader = async (
  kind: Kind,
  disk: Disk,
  enliven: (swissnum: string) => Promise<unknown>,
) => {
  const revive = async (key: Kind | 'payout') => enliven(disk.get(key)!);
  return makeTrader(
    kind,
    {
      usdc: (await revive('usdc')) as Purse<'nat'>,
      stock: (await revive('stock')) as Purse<'nat'>,
    },
    (await revive('payout')) as DepositFacet<'nat'>,
  );
};

/**
 * Alice buys 3 shares from Bob for 300 USDC through an escrow, so
 * neither has to trust the other; Mallory's short offer is refused.
 * Then an escrow Bob never joins refunds Alice. The test holds the
 * mints, makes the escrows, and hands each trader a seat.
 */
export const escrowSwapsUsdcForStock = async (
  t: ExecutionContext,
  ledger: ERef<Ledger>,
) => {
  const usdc = await E(ledger).makeIssuerKit('USDC');
  const stock = await E(ledger).makeIssuerKit('STOCK');
  const issuers = { usdc: usdc.issuer, stock: stock.issuer };
  const dollars = (value: bigint) => harden({ brand: usdc.brand, value });
  const shares = (value: bigint) => harden({ brand: stock.brand, value });
  const alice = await startTrader(
    issuers,
    'usdc',
    await E(usdc.mint).mintPayment(dollars(1000n)),
  );
  const bob = await startTrader(
    issuers,
    'stock',
    await E(stock.mint).mintPayment(shares(10n)),
  );
  const mallory = await startTrader(
    issuers,
    'stock',
    await E(stock.mint).mintPayment(shares(10n)),
    { shortBy: 1n },
  );

  const { a, b } = await E(ledger).makeEscrow(dollars(300n), shares(3n));
  const terms = await E(b).getTerms();
  t.is(terms.give.brand, stock.brand);
  t.is(terms.want.value, 300n);

  t.is(await alice.trade(a), 'open');
  t.deepEqual(await alice.getBalances(), [700n, 0n], 'escrow holds the 300');
  await t.throwsAsync(() => mallory.trade(b), { message: /exactly 3/ });
  t.deepEqual(await mallory.getBalances(), [0n, 10n], 'refused, kept');
  t.is(await bob.trade(b), 'settled');
  t.deepEqual(await alice.getBalances(), [700n, 3n]);
  t.deepEqual(await bob.getBalances(), [300n, 7n]);
  await t.throwsAsync(() => E(a).cancel(), { message: /escrow settled/ });

  const second = await E(ledger).makeEscrow(dollars(100n), shares(1n));
  await alice.trade(second.a);
  t.deepEqual(await alice.getBalances(), [600n, 3n]);
  // Bob never takes his seat; the test, still holding it, cancels
  t.is(await E(second.b).cancel(), 'cancelled');
  t.deepEqual(await alice.getBalances(), [700n, 3n], 'refunded');
  await t.throwsAsync(() => bob.trade(second.b), {
    message: /escrow cancelled/,
  });
};

type Incarnation = {
  ledger: ERef<Ledger>;
  enliven: (swissnum: string) => Promise<unknown>;
  stop: () => unknown;
};

/**
 * Alice offers; the ledger restarts; Bob, from the sturdyrefs on his
 * disk, completes the swap.
 *
 * @param start - start the ledger over the same storage, and connect
 */
export const escrowOutlivesRestart = async (
  t: ExecutionContext,
  start: () => Promise<Incarnation>,
) => {
  const one = await start();
  const { ledger } = one;
  const usdc = await E(ledger).makeIssuerKit('USDC');
  const stock = await E(ledger).makeIssuerKit('STOCK');
  const issuers = { usdc: usdc.issuer, stock: stock.issuer };
  const dollars = harden({ brand: usdc.brand, value: 300n });
  const shares = harden({ brand: stock.brand, value: 3n });
  const makeSturdyRef = (obj: object) => E(ledger).makeSturdyRef(obj);
  const disks = { alice: new Map() as Disk, bob: new Map() as Disk };
  const alice = await startTrader(
    issuers,
    'usdc',
    await E(usdc.mint).mintPayment(dollars),
    { persist: { makeSturdyRef, disk: disks.alice } },
  );
  await startTrader(issuers, 'stock', await E(stock.mint).mintPayment(shares), {
    persist: { makeSturdyRef, disk: disks.bob },
  });
  const { a, b } = await E(ledger).makeEscrow(dollars, shares);
  await alice.trade(a);
  const seatB = await makeSturdyRef(b);
  t.is(await one.enliven(seatB), b, 'same live seat');
  await one.stop();

  const two = await start();
  t.teardown(two.stop);
  const b2 = (await two.enliven(seatB)) as Seat;
  t.is(await E(b2).getState(), 'open');
  const bob = await reviveTrader('stock', disks.bob, two.enliven);
  t.is(await bob.trade(b2), 'settled');
  const alice2 = await reviveTrader('usdc', disks.alice, two.enliven);
  t.deepEqual(await alice2.getBalances(), [0n, 3n]);
  t.deepEqual(await bob.getBalances(), [300n, 0n]);
};
