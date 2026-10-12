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
 * A party with a purse of its own. `self` is what it would show anyone:
 * its deposit facet and its balance. `puppet` is for the test alone,
 * to make it act.
 */
const makeParty = async (issuer: ERef<Issuer<'nat'>>) => {
  const purse = await E(issuer).makeEmptyPurse();
  return harden({
    self: {
      depositFacet: await E(purse).getDepositFacet(),
      getBalance: () => E(purse).getCurrentAmount(),
    },
    puppet: {
      pay: async (to: ERef<DepositFacet<'nat'>>, amount: NatAmount) =>
        E(to).receive(await E(purse).withdraw(amount)),
    },
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

  await E(alice.self.depositFacet).receive(
    await E(mint).mintPayment(bucks(10n)),
  );
  await alice.puppet.pay(bob.self.depositFacet, bucks(10n));

  t.is((await alice.self.getBalance()).value, 0n);
  const bobAmount = await bob.self.getBalance();
  t.is(bobAmount.value, 10n);
  t.is(bobAmount.brand, brand, 'brand comes back as the same presence');
  t.is(await E(issuer).getBrand(), brand);
};

export const spentPaymentIsNotLive = async (
  t: ExecutionContext,
  ledger: ERef<Ledger>,
) => {
  const { issuer, brand, mint } = await E(ledger).makeIssuerKit('BUCKS');
  const { self: alice } = await makeParty(issuer);
  const payment = await E(mint).mintPayment(harden({ brand, value: 10n }));
  await E(alice.depositFacet).receive(payment);
  await t.throwsAsync(() => E(alice.depositFacet).receive(payment), {
    message: /payment not live/,
  });
};
