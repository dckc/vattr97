import test from 'ava';
import Database from 'better-sqlite3';
import { Far } from '@endo/far';
import {
  makeLedger,
  makeCommodityIssuerKit,
  makeCurrencyIssuerKit,
} from '../scripts/guests/ledger.js';
import {
  initGnuCashSchema,
  wrapBetterSqlite3DatabaseAsync,
} from '../src/index.ts';
import { defaultZone } from '../src/jessie-tools.ts';
import { mockMakeGuid } from '../src/guids.ts';
import { makeTestClock } from './mock-io.ts';

const makeRawDb = t => {
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  return db;
};

const makeDb = async t => {
  const db = makeRawDb(t);
  await initGnuCashSchema(db);
  return db;
};

const makeRemoteClock = () => makeTestClock();

test('ledger guest places commodity mint accounts', async t => {
  const db = await makeDb(t);
  const kit = await makeCommodityIssuerKit(
    harden({
      db,
      clock: makeRemoteClock(),
      commodity: harden({ namespace: 'COMMODITY', mnemonic: 'STOCK' }),
      makeGuid: mockMakeGuid(),
      zone: defaultZone,
    }),
  );
  const { holdingAccountGuid, recoveryPurseGuid } = kit.mintInfo.getMintInfo();
  const rows = await db
    .prepare(
      `
        SELECT name, account_type, parent_guid
        FROM accounts
        WHERE guid IN (?, ?)
        ORDER BY name
      `,
    )
    .all(holdingAccountGuid, recoveryPurseGuid);
  const root = await db
    .prepare('SELECT root_account_guid FROM books LIMIT 1')
    .get();

  t.deepEqual(kit.mintAccountNames, [
    'STOCK Mint Holding',
    'STOCK Mint Recovery',
  ]);
  t.deepEqual(rows, [
    {
      name: 'STOCK Mint Holding',
      account_type: 'STOCK',
      parent_guid: root?.root_account_guid,
    },
    {
      name: 'STOCK Mint Recovery',
      account_type: 'STOCK',
      parent_guid: root?.root_account_guid,
    },
  ]);
});

test('ledger guest opens a currency and places its mint accounts', async t => {
  const db = await makeDb(t);
  const usd = await db
    .prepare(
      `
        SELECT guid
        FROM commodities
        WHERE namespace = 'CURRENCY' AND mnemonic = 'USD'
      `,
    )
    .get();
  const kit = await makeCurrencyIssuerKit(
    harden({
      db,
      clock: makeRemoteClock(),
      commodityGuid: usd.guid,
      makeGuid: mockMakeGuid(),
      zone: defaultZone,
    }),
  );
  const { holdingAccountGuid, recoveryPurseGuid } = kit.mintInfo.getMintInfo();
  const rows = await db
    .prepare(
      `
        SELECT name, account_type
        FROM accounts
        WHERE guid IN (?, ?)
        ORDER BY name
      `,
    )
    .all(holdingAccountGuid, recoveryPurseGuid);

  t.deepEqual(kit.mintAccountNames, [
    'US Dollar Mint Holding',
    'US Dollar Mint Recovery',
  ]);
  t.deepEqual(rows, [
    { name: 'US Dollar Mint Holding', account_type: 'BANK' },
    { name: 'US Dollar Mint Recovery', account_type: 'BANK' },
  ]);
});

test('ledger gives traders scoped account name admins', async t => {
  const db = makeRawDb(t);
  const clockNow = Date.UTC(2031, 3, 5, 6, 7);
  let clockReads = 0;
  const clock = Far('clock', {
    now: () => {
      clockReads += 1;
      return clockNow;
    },
  });
  const powers = Far('ledger powers', {
    lookup: name => {
      if (name === 'sqlite-db') {
        return db;
      }
      if (name === 'clock') {
        return clock;
      }
      throw Error(`unknown ledger power: ${name}`);
    },
  });
  const ledger = await makeLedger(powers, { env: {} });
  const [moneyKit, stockKit] = await Promise.all([
    ledger.makeCurrencyIssuerKit({ mnemonic: 'USD' }),
    ledger.makeCommodityIssuerKit({ mnemonic: 'STOCK' }),
  ]);
  t.not(moneyKit.nameAdmin, stockKit.nameAdmin);

  const { nameAdmin: myAccounts, nameHub: myAccountNames } =
    await moneyKit.nameAdmin.provideChild('Alice');
  const purse = await moneyKit.issuer.makeEmptyPurse();
  const sealedPurse = moneyKit.sealer.seal(purse);
  await myAccounts.update('USD', sealedPurse);

  t.true(myAccountNames.has('USD'));
  t.is(myAccountNames.lookup('USD'), sealedPurse);
  const purseGuid = moneyKit.purses.getGuid(purse);
  const row = await db
    .prepare(
      `
        SELECT child.name, parent.name AS parent_name
        FROM accounts AS child
        JOIN accounts AS parent ON parent.guid = child.parent_guid
        WHERE child.guid = ?
      `,
    )
    .get(purseGuid);
  t.deepEqual(row, { name: 'USD', parent_name: 'Alice' });

  const stockPurse = await stockKit.issuer.makeEmptyPurse();
  await t.throwsAsync(
    () => myAccounts.update('USD', stockKit.sealer.seal(stockPurse)),
    { message: "That's not my sealed object!" },
  );

  await moneyKit.mint.mintPayment(harden({ brand: moneyKit.brand, value: 1n }));
  const transaction = await db
    .prepare('SELECT num, post_date FROM transactions')
    .get();
  t.is(clockReads, 2);
  t.deepEqual(transaction, {
    num: '06:07',
    post_date: '2031-04-05 00:00:00',
  });
});
