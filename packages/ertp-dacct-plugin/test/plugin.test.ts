import test from 'ava';
import Database from 'better-sqlite3';
import { initGnuCashSchema, mockMakeGuid } from '@finquick/ertp-dacct';
import { makeConfinedDacct } from '../src/index.js';

test('makeConfinedDacct creates issuer kit via confined maker', async t => {
  const rawDb = new Database(':memory:');
  const { wrapBetterSqlite3DatabaseAsync } = await import('@finquick/ertp-dacct');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const dacct = await makeConfinedDacct(db);
  const makeGuid = mockMakeGuid();
  const nowMs = () => Date.now();

  const kit = await dacct.createIssuerKit({
    commodity: { mnemonic: 'USD' },
    makeGuid,
    nowMs,
  });

  t.truthy(kit.brand);
  t.truthy(kit.issuer);
  t.truthy(kit.mint);
  t.is(kit.brand.getAllegedName(), 'USD');
});

test('makeConfinedDacct openIssuerKit round-trips', async t => {
  const rawDb = new Database(':memory:');
  const { wrapBetterSqlite3DatabaseAsync } = await import('@finquick/ertp-dacct');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const dacct = await makeConfinedDacct(db);
  const makeGuid = mockMakeGuid();
  const nowMs = () => Date.now();
  const commodityGuid = makeGuid();

  const kit = await dacct.createIssuerKit({
    commodity: { mnemonic: 'BTC' },
    makeGuid,
    nowMs,
  });
  const reOpened = await dacct.openIssuerKit({ commodityGuid: kit.commodityGuid, makeGuid, nowMs });

  t.is(reOpened.kit.brand.getAllegedName(), 'BTC');
  t.not(reOpened.kit.brand, kit.brand);
});
