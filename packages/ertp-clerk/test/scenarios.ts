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
} from '@vattr/ertp-books/src/ertp-types.js';
import type { makeLedgerBootstrap } from '../src/ledger.js';

/**
 * What a ledger's peer claims its bootstrap is; a test that connects
 * over the network asserts it, since nothing on the wire checks.
 */
export type Ledger = ReturnType<typeof makeLedgerBootstrap>;

/**
 * A party with a purse of its own. Others get only its deposit facet;
 * the test gets a read of its balance.
 */
const makeParty = async (issuer: ERef<Issuer<'nat'>>) => {
  const purse = await E(issuer).makeEmptyPurse();
  return harden({
    depositFacet: await E(purse).getDepositFacet(),
    pay: async (to: ERef<DepositFacet<'nat'>>, amount: NatAmount) =>
      E(to).receive(await E(purse).withdraw(amount)),
    getBalance: () => E(purse).getCurrentAmount(),
  });
};

/** The test holds the mint; Alice and Bob each hold only their purse. */
export const aliceSendsBob10Bucks = async (
  t: ExecutionContext,
  ledger: ERef<Ledger>,
) => {
  const { issuer, brand, mint } = await E(ledger).makeIssuerKit('BUCKS');
  t.is(await E(brand).getAllegedName(), 'BUCKS');
  const bucks = (value: bigint) => harden({ brand, value });
  const alice = await makeParty(issuer);
  const bob = await makeParty(issuer);

  await E(alice.depositFacet).receive(await E(mint).mintPayment(bucks(10n)));
  await alice.pay(bob.depositFacet, bucks(10n));

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
  const alice = await makeParty(issuer);
  const payment = await E(mint).mintPayment(harden({ brand, value: 10n }));
  await E(alice.depositFacet).receive(payment);
  await t.throwsAsync(() => E(alice.depositFacet).receive(payment), {
    message: /payment not live/,
  });
};
