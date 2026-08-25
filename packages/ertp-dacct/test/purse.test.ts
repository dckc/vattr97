import test from 'ava';
import { makeTestClock, makeTestDb, mockMakeGuid } from './mock-io.js';
import {
  createCommodityRow,
  ensureAccountRow,
  getAccountBalance,
  makeTransferRecorder,
} from '../src/db-helpers.js';
import { makePurseFactory } from '../src/purse.js';
import { defaultZone } from '../src/jessie-tools.js';
import type { Guid, AmountLike } from '../src/types.js';
import type { Brand } from '../src/ertp-types.js';

const buildKit = async () => {
  const { db, close } = await makeTestDb();
  const makeGuid = mockMakeGuid();
  const commodityGuid = makeGuid() as Guid;
  await createCommodityRow({
    db,
    guid: commodityGuid,
    commodity: { mnemonic: 'BUCKS' },
  });
  const balanceGuid = makeGuid() as Guid;
  await ensureAccountRow({
    db,
    accountGuid: balanceGuid,
    name: 'Holding',
    commodityGuid,
    accountType: 'STOCK',
  });
  const makeAmount = (value: bigint): AmountLike => ({ brand, value });
  const brand = defaultZone.exo('BUCKS Brand', {
    isMyIssuer: async () => false,
    getAllegedName: () => 'BUCKS',
    getDisplayInfo: () => ({ assetKind: 'nat' as const }),
    getAmountShape: () => ({}),
  }) as unknown as Brand<'nat'>;
  const paymentRecords = new WeakMap();
  const livePayments = new Set<object>();
  const transferRecorder = makeTransferRecorder({
    db,
    clock: makeTestClock(Date.UTC(2026, 0, 1), 0),
    commodityGuid,
    holdingAccountGuid: balanceGuid,
    makeGuid,
  });
  const makePayment = (
    amount: AmountLike,
    sourceAccountGuid: Guid,
    txGuid: Guid,
    holdingSplitGuid: Guid,
    checkNumber: string,
  ) => {
    const payment = defaultZone.exo('Payment', {
      __getAllegedInterface__: () => {
        throw new Error('nope');
      },
    });
    paymentRecords.set(payment, {
      amount: amount.value,
      live: true,
      sourceAccountGuid,
      txGuid,
      holdingSplitGuid,
      checkNumber,
    });
    livePayments.add(payment);
    return payment;
  };
  const factory = makePurseFactory({
    db,
    commodityGuid,
    commodityLabel: 'BUCKS',
    makeAmount,
    makePayment,
    livePayments,
    paymentRecords,
    transferRecorder,
    getBrand: () => brand,
    zone: defaultZone,
  });
  return {
    db,
    close,
    factory,
    makeGuid,
    commodityGuid,
    brand,
    paymentRecords,
    livePayments,
    transferRecorder,
    makePayment,
  };
};

test('makeNewPurse creates a purse with zero balance', async t => {
  const { db, close, factory, brand } = await buildKit();
  t.teardown(() => close());

  const purse = await factory.makeNewPurse('guid1' as unknown as Guid, 'Alice');
  const balance = await purse.getCurrentAmount();
  t.is(balance.value, 0n);
  t.is(balance.brand, brand);
});

test('deposit and withdraw round-trips', async t => {
  const { db, close, factory, brand, transferRecorder, makeGuid, makePayment } =
    await buildKit();
  t.teardown(() => close());

  const alice = await factory.makeNewPurse('alice' as unknown as Guid, 'Alice');
  const bob = await factory.makeNewPurse('bob' as unknown as Guid, 'Bob');
  const mintAccountGuid = makeGuid() as Guid;
  await factory.makeNewPurse(mintAccountGuid, 'Mint');

  const { txGuid, holdingSplitGuid, checkNumber } =
    await transferRecorder.createHold({
      fromAccountGuid: mintAccountGuid,
      amount: 100n,
    });
  const payment = makePayment(
    { brand, value: 100n },
    mintAccountGuid,
    txGuid,
    holdingSplitGuid,
    checkNumber,
  );

  await alice.deposit(payment);
  const aliceBalance = await alice.getCurrentAmount();
  t.is(aliceBalance.value, 100n);

  const payment2 = await alice.withdraw({ brand, value: 40n });
  await bob.deposit(payment2);

  t.is((await alice.getCurrentAmount()).value, 60n);
  t.is((await bob.getCurrentAmount()).value, 40n);
});

test('withdraw rejects insufficient funds', async t => {
  const { db, close, factory, brand } = await buildKit();
  t.teardown(() => close());

  const purse = await factory.makeNewPurse('empty' as unknown as Guid, 'Empty');
  await t.throwsAsync(() => purse.withdraw({ brand, value: 1n }), {
    message: 'insufficient funds',
  });
});

test('ensurePurse and openPurse', async t => {
  const { db, close, factory } = await buildKit();
  t.teardown(() => close());

  const guid = 'test-guid' as unknown as Guid;
  await factory.ensurePurse(guid, 'Existing');
  const opened = await factory.openPurse(guid, 'Existing');
  t.truthy(opened);
});
