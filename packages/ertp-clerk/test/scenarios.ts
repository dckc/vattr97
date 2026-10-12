/**
 * @file ERTP scenarios against a remote ledger bootstrap, shared by the
 * in-process and workerd tests.
 */
import type { ExecutionContext } from 'ava';
import { E, type ERef } from '@endo/far';
import type {
  DepositFacet,
  Issuer,
  NatAmount,
  Payment,
} from '@vattr/ertp-books/src/ertp-types.js';
import type { makeLedgerBootstrap } from '../src/ledger.js';

/**
 * What a ledger's peer claims its bootstrap is; a test that connects
 * over the network asserts it, since nothing on the wire checks.
 */
export type Ledger = ReturnType<typeof makeLedgerBootstrap>;

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
