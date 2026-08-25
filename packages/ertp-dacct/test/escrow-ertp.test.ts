import test from 'ava';
import Database from 'better-sqlite3';
import {
  initGnuCashSchema,
  createIssuerKit,
  wrapBetterSqlite3DatabaseAsync,
  makeErtpEscrow,
} from '../src/index.js';
import { mockMakeGuid } from '../src/guids.js';
import { makeTestClock } from './mock-io.js';
import type { Guid, IssuerKitWithPurseGuids } from '../src/types.js';

test('escrow exchange completes money-for-stock swap', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const clock = makeTestClock();
  const moneyKit = (await createIssuerKit(
    freeze({
      db,
      clock,
      commodity: { mnemonic: 'USD' },
      makeGuid,
    }),
  )) as unknown as IssuerKitWithPurseGuids;
  const stockKit = (await createIssuerKit(
    freeze({
      db,
      clock,
      commodity: { mnemonic: 'STOCK' },
      makeGuid: mockMakeGuid(1000n),
    }),
  )) as unknown as IssuerKitWithPurseGuids;

  const escrowExchange = (
    await makeErtpEscrow({
      issuers: { A: moneyKit.issuer, B: stockKit.issuer } as any,
    })
  ).escrowExchange as any;

  const aliceRefund = await moneyKit.issuer.makeEmptyPurse();
  const aliceWantDeposit = (
    await stockKit.issuer.makeEmptyPurse()
  ).getDepositFacet();
  const bobRefund = await stockKit.issuer.makeEmptyPurse();
  const bobWantDeposit = (
    await moneyKit.issuer.makeEmptyPurse()
  ).getDepositFacet();

  const moneyPayment = await moneyKit.mint.mintPayment({
    brand: moneyKit.brand,
    value: 100n,
  });
  const stockPayment = await stockKit.mint.mintPayment({
    brand: stockKit.brand,
    value: 10n,
  });

  const result = escrowExchange(
    {
      give: Promise.resolve(moneyPayment),
      want: freeze({ brand: stockKit.brand, value: 10n }),
      payouts: {
        refund: await aliceRefund.getDepositFacet(),
        want: aliceWantDeposit,
      },
      cancellationP: new Promise(() => {}),
    },
    {
      give: Promise.resolve(stockPayment),
      want: freeze({ brand: moneyKit.brand, value: 100n }),
      payouts: {
        refund: await bobRefund.getDepositFacet(),
        want: bobWantDeposit,
      },
      cancellationP: new Promise(() => {}),
    },
  );

  const [bobPayout, alicePayout] = await result;
  t.is(alicePayout.value, 10n);
  t.is(bobPayout.value, 100n);
});

test('escrow exchange refunds on cancellation', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const clock = makeTestClock();
  const moneyKit = (await createIssuerKit(
    freeze({
      db,
      clock,
      commodity: { mnemonic: 'USD' },
      makeGuid,
    }),
  )) as unknown as IssuerKitWithPurseGuids;
  const stockKit = (await createIssuerKit(
    freeze({
      db,
      clock,
      commodity: { mnemonic: 'STOCK' },
      makeGuid: mockMakeGuid(1000n),
    }),
  )) as unknown as IssuerKitWithPurseGuids;

  const escrowExchange = (
    await makeErtpEscrow({
      issuers: { A: moneyKit.issuer, B: stockKit.issuer } as any,
    })
  ).escrowExchange as any;

  const cancel = Promise.withResolvers();

  const moneyPayment = await moneyKit.mint.mintPayment({
    brand: moneyKit.brand,
    value: 100n,
  });
  const stockPayment = await stockKit.mint.mintPayment({
    brand: stockKit.brand,
    value: 10n,
  });

  const bobCancels = escrowExchange(
    {
      give: Promise.resolve(moneyPayment),
      want: freeze({ brand: stockKit.brand, value: 10n }),
      payouts: {
        refund: await (
          await moneyKit.issuer.makeEmptyPurse()
        ).getDepositFacet(),
        want: await (await moneyKit.issuer.makeEmptyPurse()).getDepositFacet(),
      },
      cancellationP: new Promise(() => {}),
    },
    {
      give: Promise.resolve(stockPayment),
      want: freeze({ brand: moneyKit.brand, value: 100n }),
      payouts: {
        refund: await (
          await stockKit.issuer.makeEmptyPurse()
        ).getDepositFacet(),
        want: await (await stockKit.issuer.makeEmptyPurse()).getDepositFacet(),
      },
      cancellationP: cancel.promise,
    },
  );

  cancel.resolve(new Error('bob cancelled'));

  await t.throwsAsync(() => bobCancels, { message: 'bob cancelled' });
});

test('escrow exchange refunds on insufficient offer', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const clock = makeTestClock();
  const moneyKit = (await createIssuerKit(
    freeze({
      db,
      clock,
      commodity: { mnemonic: 'USD' },
      makeGuid,
    }),
  )) as unknown as IssuerKitWithPurseGuids;
  const stockKit = (await createIssuerKit(
    freeze({
      db,
      clock,
      commodity: { mnemonic: 'STOCK' },
      makeGuid: mockMakeGuid(1000n),
    }),
  )) as unknown as IssuerKitWithPurseGuids;

  const escrowExchange = (
    await makeErtpEscrow({
      issuers: { A: moneyKit.issuer, B: stockKit.issuer } as any,
    })
  ).escrowExchange as any;

  const moneyPayment = await moneyKit.mint.mintPayment({
    brand: moneyKit.brand,
    value: 50n,
  });
  const stockPayment = await stockKit.mint.mintPayment({
    brand: stockKit.brand,
    value: 10n,
  });

  const result = escrowExchange(
    {
      give: Promise.resolve(moneyPayment),
      want: freeze({ brand: stockKit.brand, value: 10n }),
      payouts: {
        refund: await (
          await moneyKit.issuer.makeEmptyPurse()
        ).getDepositFacet(),
        want: await (await stockKit.issuer.makeEmptyPurse()).getDepositFacet(),
      },
      cancellationP: new Promise(() => {}),
    },
    {
      give: Promise.resolve(stockPayment),
      want: freeze({ brand: moneyKit.brand, value: 100n }),
      payouts: {
        refund: await (
          await stockKit.issuer.makeEmptyPurse()
        ).getDepositFacet(),
        want: await (await moneyKit.issuer.makeEmptyPurse()).getDepositFacet(),
      },
      cancellationP: new Promise(() => {}),
    },
  );

  await t.throwsAsync(() => result, { message: 'insufficient offer: party A' });
});
