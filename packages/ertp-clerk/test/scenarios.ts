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
/** sturdyrefs to a trader's purses and payout facet */
type TraderMemory = Record<Kind | 'payout', string>;

/**
 * A party to escrows who gives `kind` for the other kind. It gives from
 * its own purse; refunds and payouts reach it only through its deposit
 * facets. `self` shows its balances; `puppet`, for the test alone,
 * makes it offer and remember.
 *
 * @param payout - deposit facet for what it wants
 */
const makeTrader = (
  kind: Kind,
  purses: Purses,
  payout: ERef<DepositFacet<'nat'>>,
) =>
  harden({
    self: { getBalances: () => balancesOf(purses) },
    puppet: {
      /** offer `amount` to `seat`, or by default what the seat gives */
      offer: async (seat: ERef<Seat>, amount?: NatAmount) => {
        // the seat's terms name this ledger's brands, so they are nat amounts
        const give = amount ?? ((await E(seat).getTerms()).give as NatAmount);
        const payment = await E(purses[kind]).withdraw(give);
        try {
          return await E(seat).offer(
            payment,
            await E(purses[kind]).getDepositFacet(),
            payout,
          );
        } catch (err) {
          await E(purses[kind]).deposit(payment); // a refused offer
          throw err;
        }
      },
      /**
       * sturdyrefs for a later incarnation, which the test keeps for the
       * trader; see `reviveTrader`
       */
      remember: async (
        makeSturdyRef: (obj: object) => Promise<string>,
      ): Promise<TraderMemory> => ({
        usdc: await makeSturdyRef(purses.usdc),
        stock: await makeSturdyRef(purses.stock),
        payout: await makeSturdyRef(payout),
      }),
    },
  });

/** @param endowment - what the trader starts with, of `kind` */
const startTrader = async (
  issuers: Issuers,
  kind: Kind,
  endowment: Payment<'nat'>,
) => {
  const { usdc, stock } = await makePurses(issuers);
  const purses = { usdc, stock };
  await E(purses[kind]).deposit(endowment);
  const payout = await E(purses[otherKind(kind)]).getDepositFacet();
  return makeTrader(kind, purses, payout);
};

const reviveTrader = async (
  kind: Kind,
  memory: TraderMemory,
  enliven: (swissnum: string) => Promise<unknown>,
) =>
  makeTrader(
    kind,
    {
      usdc: (await enliven(memory.usdc)) as Purse<'nat'>,
      stock: (await enliven(memory.stock)) as Purse<'nat'>,
    },
    (await enliven(memory.payout)) as DepositFacet<'nat'>,
  );

/**
 * Alice buys 3 shares from Bob for 300 USDC through an escrow, so
 * neither has to trust the other; then an escrow Bob abandons refunds
 * Alice. The test holds the mints, makes the escrows, and hands each
 * party only its own seat.
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

  const { a, b } = await E(ledger).makeEscrow(dollars(300n), shares(3n));
  const terms = await E(b).getTerms();
  t.is(terms.give.brand, stock.brand);
  t.is(terms.want.value, 300n);

  t.is(await alice.puppet.offer(a), 'open');
  t.deepEqual(
    await alice.self.getBalances(),
    [700n, 0n],
    'escrow holds the 300',
  );
  await t.throwsAsync(() => bob.puppet.offer(b, shares(2n)), {
    message: /exactly 3/,
  });
  t.is(await bob.puppet.offer(b), 'settled');
  t.deepEqual(await alice.self.getBalances(), [700n, 3n]);
  t.deepEqual(
    await bob.self.getBalances(),
    [300n, 7n],
    'the short offer came back',
  );
  await t.throwsAsync(() => E(a).cancel(), { message: /escrow settled/ });

  const second = await E(ledger).makeEscrow(dollars(100n), shares(1n));
  await alice.puppet.offer(second.a);
  t.deepEqual(await alice.self.getBalances(), [600n, 3n]);
  t.is(await E(second.b).cancel(), 'cancelled');
  t.deepEqual(await alice.self.getBalances(), [700n, 3n], 'refunded');
  await t.throwsAsync(() => bob.puppet.offer(second.b), {
    message: /escrow cancelled/,
  });
};

type Incarnation = {
  ledger: ERef<Ledger>;
  enliven: (swissnum: string) => Promise<unknown>;
  stop: () => unknown;
};

/**
 * Alice offers; the ledger restarts; Bob, holding only sturdyrefs,
 * completes the swap.
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
  const alice = await startTrader(
    issuers,
    'usdc',
    await E(usdc.mint).mintPayment(dollars),
  );
  const bob = await startTrader(
    issuers,
    'stock',
    await E(stock.mint).mintPayment(shares),
  );
  const { a, b } = await E(ledger).makeEscrow(dollars, shares);
  await alice.puppet.offer(a);
  const makeSturdyRef = (obj: object) => E(ledger).makeSturdyRef(obj);
  const memory = {
    alice: await alice.puppet.remember(makeSturdyRef),
    bob: await bob.puppet.remember(makeSturdyRef),
    seatB: await makeSturdyRef(b),
  };
  t.is(await one.enliven(memory.seatB), b, 'same live seat');
  await one.stop();

  const two = await start();
  t.teardown(two.stop);
  const b2 = (await two.enliven(memory.seatB)) as Seat;
  t.is(await E(b2).getState(), 'open');
  const bob2 = await reviveTrader('stock', memory.bob, two.enliven);
  t.is(await bob2.puppet.offer(b2), 'settled');
  const alice2 = await reviveTrader('usdc', memory.alice, two.enliven);
  t.deepEqual(await alice2.self.getBalances(), [0n, 3n]);
  t.deepEqual(await bob2.self.getBalances(), [300n, 0n]);
};
