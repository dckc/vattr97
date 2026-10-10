/**
 * @file ERTP scenarios against a remote ledger bootstrap, shared by the
 * in-process and workerd tests.
 */
import type { ExecutionContext } from 'ava';
import { E } from '@endo/far';

export const aliceSendsBob10Bucks = async (
  t: ExecutionContext,
  ledger: any,
) => {
  const { issuer, brand, mint } = await E(ledger).makeIssuerKit('BUCKS');
  t.is(await E(brand).getAllegedName(), 'BUCKS');

  const alice = await E(issuer).makeEmptyPurse();
  const bob = await E(issuer).makeEmptyPurse();
  const amount = harden({ brand, value: 10n });

  const payment = await E(mint).mintPayment(amount);
  await E(alice).deposit(payment);
  const paymentToBob = await E(alice).withdraw(amount);
  await E(bob).deposit(paymentToBob);

  const aliceAmount = await E(alice).getCurrentAmount();
  const bobAmount = await E(bob).getCurrentAmount();
  t.is(aliceAmount.value, 0n);
  t.is(bobAmount.value, 10n);
  t.is(bobAmount.brand, brand, 'brand comes back as the same presence');
  t.is(await E(issuer).getBrand(), brand);
};

export const spentPaymentIsNotLive = async (
  t: ExecutionContext,
  ledger: any,
) => {
  const { issuer, brand, mint } = await E(ledger).makeIssuerKit('BUCKS');
  const alice = await E(issuer).makeEmptyPurse();
  const payment = await E(mint).mintPayment(harden({ brand, value: 10n }));
  await E(alice).deposit(payment);
  await t.throwsAsync(() => E(alice).deposit(payment), {
    message: /payment not live/,
  });
};
