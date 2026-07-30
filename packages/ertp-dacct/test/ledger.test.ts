import test from 'ava';
import Database from 'better-sqlite3';
import { E } from '@endo/eventual-send';
import { make as makeSqliteDb } from '@finquick/sqlite-plugin';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Brand, NatAmount } from '../src/ertp-types.js';
import type { Guid } from '../src/types.js';
import {
  createIssuerKit,
  initGnuCashSchema,
  openIssuerKit,
  openIssuerKitWithPurseGuids,
  wrapBetterSqlite3DatabaseAsync,
} from '../src/index.js';
import { mockMakeGuid } from '../src/guids.js';
import { makeTestClock } from './mock-io.js';

const nodeRequire = createRequire(import.meta.url);
const asset = (spec: string) => readFile(nodeRequire.resolve(spec), 'utf8');
const parseCsv = (text: string): Record<string, string>[] => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);
  const headers = lines[0]?.split(',') ?? [];
  return lines
    .slice(1)
    .filter(Boolean)
    .map(line => {
      const values = line.split(',');
      return headers.reduce(
        (row, header, index) => ({ ...row, [header]: values[index] ?? '' }),
        {} as Record<string, string>,
      );
    });
};

test('initGnuCashSchema creates GnuCash tables', async t => {
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());

  await initGnuCashSchema(db);

  const row = await db
    .prepare<[], { name: string }>(
      "select name from sqlite_master where type='table' and name='accounts'",
    )
    .get();
  t.is(row?.name, 'accounts');
});

test('issuer internal account types follow commodity namespace', async t => {
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const usd = await db
    .prepare<[], { guid: string }>(
      "SELECT guid FROM commodities WHERE namespace = 'CURRENCY' AND mnemonic = 'USD'",
    )
    .get();
  const kit = await openIssuerKitWithPurseGuids({
    db,
    clock: makeTestClock(),
    commodityGuid: usd?.guid as Guid,
    makeGuid: mockMakeGuid(),
  });
  const { holdingAccountGuid, recoveryPurseGuid } = kit.mintInfo.getMintInfo();
  const rows = await db
    .prepare<[string, string], { name: string; account_type: string }>(
      'SELECT name, account_type FROM accounts WHERE guid IN (?, ?) ORDER BY name',
    )
    .all(holdingAccountGuid, recoveryPurseGuid);

  t.deepEqual(rows, [
    { name: 'US Dollar Mint Holding', account_type: 'BANK' },
    { name: 'US Dollar Mint Recovery', account_type: 'BANK' },
  ]);

  const stock = await createIssuerKit({
    db,
    clock: makeTestClock(),
    commodity: { namespace: 'COMMODITY', mnemonic: 'STOCK' },
    makeGuid: mockMakeGuid(1000n),
  });
  const stockInfo = stock.mintInfo.getMintInfo();
  const stockRows = await db
    .prepare<[string, string], { name: string; account_type: string }>(
      'SELECT name, account_type FROM accounts WHERE guid IN (?, ?) ORDER BY name',
    )
    .all(stockInfo.holdingAccountGuid, stockInfo.recoveryPurseGuid);
  t.deepEqual(stockRows, [
    { name: 'STOCK Mint Holding', account_type: 'STOCK' },
    { name: 'STOCK Mint Recovery', account_type: 'STOCK' },
  ]);
});

test('issuer kit accepts an eventual database reference', async t => {
  const { freeze } = Object;
  const db = makeSqliteDb(undefined, undefined, {
    env: { DB_PATH: ':memory:' },
  });
  const dbRef = Promise.resolve(db);
  t.teardown(() => E(db).close());

  await initGnuCashSchema(dbRef);

  const kit = await createIssuerKit(
    freeze({
      db: dbRef,
      clock: makeTestClock(),
      commodity: freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' }),
      makeGuid: mockMakeGuid(),
    }),
  );
  const purse = await kit.issuer.makeEmptyPurse();
  const payment = await kit.mint.mintPayment({ brand: kit.brand, value: 5n });
  await purse.deposit(payment);

  t.is((await purse.getCurrentAmount()).value, 5n);
});

test('brand.isMyIssuer rejects unrelated issuers', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const clock = makeTestClock();
  const kit = await createIssuerKit(freeze({ db, clock, commodity, makeGuid }));
  const other = await createIssuerKit(
    freeze({
      db,
      commodity: freeze({ namespace: 'COMMODITY', mnemonic: 'MOOLA' }),
      makeGuid,
      clock,
    }),
  );

  t.true(await kit.brand.isMyIssuer(kit.issuer));
  t.false(await kit.brand.isMyIssuer(other.issuer));
});

test('alice sends 10 to bob', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const clock = makeTestClock();
  const issuedKit = await createIssuerKit(
    freeze({ db, clock, commodity, makeGuid }),
  );
  const brand = issuedKit.brand as Brand<'nat'>;
  const bucks = (value: bigint): NatAmount => freeze({ brand, value });
  const alicePurse = await issuedKit.issuer.makeEmptyPurse();
  const bobPurse = await issuedKit.issuer.makeEmptyPurse();

  const payment = await issuedKit.mint.mintPayment(bucks(10n));
  await alicePurse.deposit(payment);
  await bobPurse.deposit(await alicePurse.withdraw(bucks(10n)));

  t.is((await alicePurse.getCurrentAmount()).value, 0n);
  t.is((await bobPurse.getCurrentAmount()).value, 10n);
});

test('deposit returns the payment amount', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const clock = makeTestClock();
  const issuedKit = await createIssuerKit(
    freeze({ db, clock, commodity, makeGuid }),
  );
  const brand = issuedKit.brand as Brand<'nat'>;
  const bucks = (value: bigint): NatAmount => freeze({ brand, value });
  const purse = await issuedKit.issuer.makeEmptyPurse();

  const mintPay1 = await issuedKit.mint.mintPayment(bucks(2n));
  const mintPay2 = await issuedKit.mint.mintPayment(bucks(3n));
  const firstDeposit = await purse.deposit(mintPay1);
  const secondDeposit = await purse.deposit(mintPay2);

  t.is(firstDeposit.value, 2n);
  t.is(secondDeposit.value, 3n);
});

test('fixture: withdraw-deposit matches ledger rows', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const clock = makeTestClock(Date.UTC(2026, 0, 24, 0, 0), 0);
  const issuedKit = await createIssuerKit(
    freeze({ db, clock, commodity, makeGuid }),
  );
  const brand = issuedKit.brand as Brand<'nat'>;
  const bucks = (value: bigint): NatAmount => freeze({ brand, value });
  const purse = await issuedKit.issuer.makeEmptyPurse();
  const payment = await issuedKit.mint.mintPayment(bucks(5000n));
  await purse.deposit(payment);

  const { recoveryPurseGuid } = issuedKit.mintInfo.getMintInfo();
  const destAccountGuid = issuedKit.purses.getGuid(purse);
  const expectedTx = parseCsv(
    await asset('./fixtures/withdraw-deposit-transactions.csv'),
  )[0];
  const expectedSplits = parseCsv(
    await asset('./fixtures/withdraw-deposit-splits.csv'),
  );
  const normalize = (row: Record<string, string>) => {
    const resolved = { ...row };
    if (resolved.currency_guid === 'comm-USD') {
      resolved.currency_guid = issuedKit.commodityGuid;
    }
    if (resolved.account_guid === 'acct-source') {
      resolved.account_guid = recoveryPurseGuid;
    }
    if (resolved.account_guid === 'acct-dest') {
      resolved.account_guid = destAccountGuid;
    }
    return resolved;
  };

  const txRows = await db
    .prepare<
      [],
      {
        guid: string;
        currency_guid: string;
        num: string;
        post_date: string;
        enter_date: string;
        description: string;
      }
    >(
      'SELECT guid, currency_guid, num, post_date, enter_date, description FROM transactions',
    )
    .all();
  t.is(txRows.length, 1);
  const actualTx = txRows[0];
  const expectedTxNormalized = normalize(expectedTx);
  t.deepEqual(
    {
      currency_guid: actualTx.currency_guid,
      num: actualTx.num,
      post_date: actualTx.post_date,
      enter_date: actualTx.enter_date,
      description: actualTx.description,
    },
    {
      currency_guid: expectedTxNormalized.currency_guid,
      num: expectedTxNormalized.num,
      post_date: expectedTxNormalized.post_date,
      enter_date: expectedTxNormalized.enter_date,
      description: expectedTxNormalized.description,
    },
  );

  const splitRows = await db
    .prepare<
      [string],
      {
        account_guid: string;
        value_num: string;
        value_denom: string;
        reconcile_state: string;
      }
    >(
      `
      SELECT account_guid, value_num, value_denom, reconcile_state
      FROM splits
      WHERE tx_guid = ?
    `,
    )
    .all(actualTx.guid);
  const actualSplits = splitRows
    .map(row => ({
      account_guid: row.account_guid,
      value_num: String(row.value_num),
      value_denom: String(row.value_denom),
      reconcile_state: row.reconcile_state,
    }))
    .sort((left, right) => left.account_guid.localeCompare(right.account_guid));
  const expectedSplitRows = expectedSplits
    .map(row => normalize(row))
    .map(row => ({
      account_guid: row.account_guid,
      value_num: row.value_num,
      value_denom: row.value_denom,
      reconcile_state: row.reconcile_state,
    }))
    .sort((left, right) => left.account_guid.localeCompare(right.account_guid));
  t.deepEqual(actualSplits, expectedSplitRows);
});

test('payments can be reified by check number', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const clock = makeTestClock();
  const created = await createIssuerKit(
    freeze({ db, clock, commodity, makeGuid }),
  );
  const brand = created.brand as Brand<'nat'>;
  const bucks = (value: bigint): NatAmount => freeze({ brand, value });
  const alicePurse = await created.issuer.makeEmptyPurse();
  const bobPurse = await created.issuer.makeEmptyPurse();
  const bobGuid = created.purses.getGuid(bobPurse);

  const payment = await created.mint.mintPayment(bucks(10n));
  await alicePurse.deposit(payment);
  const checkNumber = created.payments.getCheckNumber(
    await alicePurse.withdraw(bucks(10n)),
  );

  const reopened = await openIssuerKit(
    freeze({
      db,
      clock: makeTestClock(),
      commodityGuid: created.commodityGuid,
      makeGuid,
    }),
  );
  const reified = await reopened.payments.openPayment(checkNumber);
  const reopenedBob = await reopened.accounts.openAccountPurse(bobGuid);
  await reopenedBob.deposit(reified);

  t.is((await reopenedBob.getCurrentAmount()).value, 10n);
});

test('mint payments can be reified after reopen', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const infoP = Promise.withResolvers<{
    commodityGuid: Guid;
    checkNumber: string;
  }>();

  {
    const clock = makeTestClock();
    const created = await createIssuerKit(
      freeze({ db, clock, commodity, makeGuid }),
    );
    const brand = created.brand as Brand<'nat'>;
    const bucks = (value: bigint): NatAmount => freeze({ brand, value });
    const payment = await created.mint.mintPayment(bucks(10n));
    const checkNumber = created.payments.getCheckNumber(payment);
    infoP.resolve({ commodityGuid: created.commodityGuid, checkNumber });
  }

  {
    const { commodityGuid, checkNumber } = await infoP.promise;
    const reopened = await openIssuerKit(
      freeze({ db, clock: makeTestClock(), commodityGuid, makeGuid }),
    );
    const reified = await reopened.payments.openPayment(checkNumber);
    const live = await reopened.kit.issuer.isLive(reified as never);
    t.true(live);
  }
});

test('createIssuerKit persists balances across re-open', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });

  const [aliceGuid, bobGuid, createdCommodityGuid] = await (async () => {
    const clock = makeTestClock();
    const created = await createIssuerKit(
      freeze({ db, clock, commodity, makeGuid }),
    );
    t.truthy(created.issuer);
    t.truthy(created.brand);
    t.truthy(created.mint);
    const brand = created.brand as Brand<'nat'>;
    const bucks = (value: bigint): NatAmount => freeze({ brand, value });
    const alicePurse = await created.issuer.makeEmptyPurse();
    const bobPurse = await created.issuer.makeEmptyPurse();

    const payment = await created.mint.mintPayment(bucks(10n));
    await alicePurse.deposit(payment);
    await bobPurse.deposit(await alicePurse.withdraw(bucks(10n)));

    t.is((await alicePurse.getCurrentAmount()).value, 0n);
    t.is((await bobPurse.getCurrentAmount()).value, 10n);
    return [
      created.purses.getGuid(alicePurse),
      created.purses.getGuid(bobPurse),
      created.commodityGuid,
    ];
  })();

  const reopened = await openIssuerKit(
    freeze({
      db,
      clock: makeTestClock(),
      commodityGuid: createdCommodityGuid,
      makeGuid,
    }),
  );
  t.is(
    (
      await (
        await reopened.accounts.openAccountPurse(aliceGuid)
      ).getCurrentAmount()
    ).value,
    0n,
  );
  t.is(
    (
      await (
        await reopened.accounts.openAccountPurse(bobGuid)
      ).getCurrentAmount()
    ).value,
    10n,
  );
});
