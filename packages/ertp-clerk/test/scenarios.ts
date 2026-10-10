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

/** A party's own USDC and STOCK purses, and a read of their balances. */
const makePurses = async (issuers: Issuers) => {
  const usdc = await E(issuers.usdc).makeEmptyPurse();
  const stock = await E(issuers.stock).makeEmptyPurse();
  const getBalances = async () => [
    (await E(usdc).getCurrentAmount()).value,
    (await E(stock).getCurrentAmount()).value,
  ];
  return { usdc, stock, getBalances };
};

/** USDC per share */
const PRICE = 100n;

/**
 * Bob sells shares for USDC. Buyers reach him only through his shop.
 *
 * @param shares - Bob's starting shares
 */
const makeBob = async (issuers: Issuers, shares: Payment<'nat'>) => {
  const { usdc, stock, getBalances } = await makePurses(issuers);
  await E(stock).deposit(shares);
  const stockBrand = await E(issuers.stock).getBrand();
  const shop = Far('BobShop', {
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
type Shop = Awaited<ReturnType<typeof makeBob>>['shop'];

/**
 * Alice buys shares with USDC. Without escrow, she pays first and
 * trusts the seller.
 *
 * @param dollars - Alice's starting USDC
 */
const makeAlice = async (issuers: Issuers, dollars: Payment<'nat'>) => {
  const { usdc, stock, getBalances } = await makePurses(issuers);
  await E(usdc).deposit(dollars);
  return harden({
    buy: async (shop: ERef<Shop>, price: NatAmount) =>
      E(shop).sell(
        await E(usdc).withdraw(price),
        await E(stock).getDepositFacet(),
      ),
    getBalances,
  });
};

/**
 * Alice buys 3 shares from Bob for 300 USDC, each kind of asset on its
 * own ledger. The test holds the mints and introduces Alice to Bob's
 * shop.
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

  const alice = await makeAlice(
    issuers,
    await E(usdc.mint).mintPayment(dollars(1000n)),
  );
  const bob = await makeBob(
    issuers,
    await E(stock.mint).mintPayment(shares(10n)),
  );
  await alice.buy(bob.shop, dollars(300n));

  t.deepEqual(await alice.getBalances(), [700n, 3n]);
  t.deepEqual(await bob.getBalances(), [300n, 7n]);
};
