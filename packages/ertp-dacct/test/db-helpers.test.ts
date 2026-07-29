import test from 'ava';
import { makeTestDb, mockMakeGuid } from './mock-io.js';
import {
  createCommodityRow,
  ensureCommodityRow,
  createAccountRow,
  ensureAccountRow,
  requireAccountCommodity,
  getCommodityRow,
  getCommodityAllegedName,
  getAccountBalance,
  makeTransferRecorder,
} from '../src/db-helpers.js';
import type { Guid } from '../src/types.js';

test('createCommodityRow creates a commodity', async t => {
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const guid = mockMakeGuid()() as Guid;
  await createCommodityRow({ db, guid, commodity: { mnemonic: 'TEST' } });

  t.deepEqual(await getCommodityRow(db, guid), {
    guid,
    namespace: 'COMMODITY',
    mnemonic: 'TEST',
    fullname: 'TEST',
    cusip: null,
    fraction: 1,
    quote_flag: 0,
    quote_source: null,
    quote_tz: null,
  });
  const name = getCommodityAllegedName(await getCommodityRow(db, guid));
  t.is(name, 'TEST');
});

test('getCommodityAllegedName falls back to mnemonic', async t => {
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const guid = mockMakeGuid()();
  await createCommodityRow({
    db,
    guid,
    commodity: { mnemonic: 'TEST', fullname: 'Test Asset' },
  });
  await db
    .prepare<[string]>('UPDATE commodities SET fullname = NULL WHERE guid = ?')
    .run(guid);

  t.is(getCommodityAllegedName(await getCommodityRow(db, guid)), 'TEST');
});

test('createCommodityRow rejects duplicate', async t => {
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const guid = mockMakeGuid()() as Guid;
  await createCommodityRow({ db, guid, commodity: { mnemonic: 'TEST' } });
  await t.throwsAsync(
    () => createCommodityRow({ db, guid, commodity: { mnemonic: 'TEST' } }),
    { message: 'commodity already exists' },
  );
});

test('createCommodityRow rejects duplicate namespace and mnemonic', async t => {
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const makeGuid = mockMakeGuid();
  await createCommodityRow({
    db,
    guid: makeGuid(),
    commodity: { namespace: 'CURRENCY', mnemonic: 'TEST' },
  });
  await t.throwsAsync(
    () =>
      createCommodityRow({
        db,
        guid: makeGuid(),
        commodity: { namespace: 'CURRENCY', mnemonic: 'TEST' },
      }),
    { message: 'commodity already exists' },
  );
});

test('ensureCommodityRow is idempotent', async t => {
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const guid = mockMakeGuid()() as Guid;
  await ensureCommodityRow(db, guid, { mnemonic: 'TEST' });
  await ensureCommodityRow(db, guid, { mnemonic: 'TEST' });

  const name = getCommodityAllegedName(await getCommodityRow(db, guid));
  t.is(name, 'TEST');
});

test('createAccountRow creates an account', async t => {
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const makeGuid = mockMakeGuid();
  const commodityGuid = makeGuid();
  const accountGuid = makeGuid();
  await createCommodityRow({
    db,
    guid: commodityGuid,
    commodity: { mnemonic: 'TEST' },
  });
  await createAccountRow({
    db,
    accountGuid,
    name: 'Test Account',
    commodityGuid,
  });
  await t.notThrowsAsync(() =>
    requireAccountCommodity({ db, accountGuid, commodityGuid }),
  );
});

test('ensureAccountRow is idempotent', async t => {
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const makeGuid = mockMakeGuid();
  const commodityGuid = makeGuid();
  const accountGuid = makeGuid();
  await createCommodityRow({
    db,
    guid: commodityGuid,
    commodity: { mnemonic: 'TEST' },
  });
  await ensureAccountRow({
    db,
    accountGuid,
    name: 'Test',
    commodityGuid,
  });
  await ensureAccountRow({
    db,
    accountGuid,
    name: 'Test',
    commodityGuid,
  });
  await t.notThrowsAsync(() =>
    requireAccountCommodity({ db, accountGuid, commodityGuid }),
  );
});

test('getAccountBalance defaults to 0 for empty account', async t => {
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const guid = mockMakeGuid()() as Guid;
  const balance = await getAccountBalance(db, guid);
  t.is(balance, 0n);
});

test('createHold and finalizeHold transfer balance', async t => {
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const makeGuid = mockMakeGuid();
  const commodityGuid = makeGuid() as Guid;
  const holdingGuid = makeGuid() as Guid;
  const fromGuid = makeGuid() as Guid;
  const toGuid = makeGuid() as Guid;

  await createCommodityRow({
    db,
    guid: commodityGuid,
    commodity: { mnemonic: 'TEST' },
  });
  await ensureAccountRow({
    db,
    accountGuid: holdingGuid,
    name: 'Holding',
    commodityGuid,
    accountType: 'STOCK',
  });
  await createAccountRow({
    db,
    accountGuid: fromGuid,
    name: 'From',
    commodityGuid,
  });
  await createAccountRow({
    db,
    accountGuid: toGuid,
    name: 'To',
    commodityGuid,
  });

  const transferRecorder = makeTransferRecorder({
    db,
    commodityGuid,
    holdingAccountGuid: holdingGuid,
    makeGuid,
    nowMs: () => Date.UTC(2026, 0, 1),
  });

  const { txGuid, holdingSplitGuid, checkNumber } =
    await transferRecorder.createHold({
      fromAccountGuid: fromGuid,
      amount: 100n,
    });

  t.truthy(txGuid);
  t.truthy(holdingSplitGuid);
  t.truthy(checkNumber);

  await transferRecorder.finalizeHold({
    txGuid,
    holdingSplitGuid,
    toAccountGuid: toGuid,
  });

  const fromBalance = await getAccountBalance(db, fromGuid);
  const toBalance = await getAccountBalance(db, toGuid);

  t.is(fromBalance, -100n);
  t.is(toBalance, 100n);
});
