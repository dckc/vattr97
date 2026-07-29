import test from 'ava';
import { makeTestDb, mockMakeGuid } from './mock-io.js';
import { createIssuerKit } from '../src/index.js';
import { makeChartFacet } from '../src/chart.js';
import { makeSealerUnsealerPair } from '../src/sealer.js';
import type { Guid, IssuerKitWithPurseGuids } from '../src/types.js';

test('placePurseAtPath creates and resolves a root-relative account path', async t => {
  const { freeze } = Object;
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const makeGuid = mockMakeGuid();
  const commodity = freeze({
    namespace: 'COMMODITY',
    mnemonic: 'BUCKS',
    fraction: 100,
  });
  const nowMs = () => Date.UTC(2020, 0, 1);
  const kit = (await createIssuerKit(
    freeze({ db, commodity, makeGuid, nowMs }),
  )) as IssuerKitWithPurseGuids;

  const purse = await kit.issuer.makeEmptyPurse();
  const chart = makeChartFacet({
    db,
    commodityGuid: kit.commodityGuid,
    getGuidFromSealed: kit.purses.getGuidFromSealed,
  });

  const sealedPurse = kit.sealer.seal(purse);
  await chart.placePurseAtPath({
    sealedPurse,
    path: ['Alice', 'Wallet'],
    accountType: 'ASSET',
  });

  const guid = kit.purses.getGuid(purse);
  const row = await db
    .prepare<
      [string],
      {
        name: string;
        account_type: string;
        parent_guid: string | null;
        commodity_scu: number;
        parent_name: string;
        grandparent_type: string;
      }
    >(
      `
        SELECT
          child.name,
          child.account_type,
          child.parent_guid,
          child.commodity_scu,
          parent.name AS parent_name,
          grandparent.account_type AS grandparent_type
        FROM accounts AS child
        JOIN accounts AS parent ON parent.guid = child.parent_guid
        JOIN accounts AS grandparent ON grandparent.guid = parent.parent_guid
        WHERE child.guid = ?
      `,
    )
    .get(guid);
  t.is(row?.name, 'Wallet');
  t.is(row?.account_type, 'ASSET');
  t.is(row?.commodity_scu, 100);
  t.is(row?.parent_name, 'Alice');
  t.is(row?.grandparent_type, 'ROOT');
});

test('placePurse places beneath an explicit parent', async t => {
  const { freeze } = Object;
  const { db, close } = await makeTestDb();
  t.teardown(() => close());
  const kit = (await createIssuerKit(
    freeze({
      db,
      commodity: freeze({
        namespace: 'COMMODITY',
        mnemonic: 'TOKENS',
      }),
      makeGuid: mockMakeGuid(),
      nowMs: () => Date.UTC(2020, 0, 1),
    }),
  )) as IssuerKitWithPurseGuids;
  const purse = await kit.issuer.makeEmptyPurse();
  const chart = makeChartFacet({
    db,
    commodityGuid: kit.commodityGuid,
    getGuidFromSealed: kit.purses.getGuidFromSealed,
  });
  const root = await db
    .prepare<[], { root_account_guid: Guid }>(
      'SELECT root_account_guid FROM books LIMIT 1',
    )
    .get();

  await chart.placePurse({
    sealedPurse: kit.sealer.seal(purse),
    name: 'Wallet',
    parentGuid: root?.root_account_guid,
  });

  const row = await db
    .prepare<[Guid], { name: string; parent_guid: Guid | null }>(
      'SELECT name, parent_guid FROM accounts WHERE guid = ?',
    );
  const placed = await row.get(kit.purses.getGuid(purse));
  t.deepEqual(placed, {
    name: 'Wallet',
    parent_guid: root?.root_account_guid,
  });
});

test('placeAccount updates an account directly', async t => {
  const { freeze } = Object;
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const nowMs = () => Date.UTC(2020, 0, 1);
  const kit = (await createIssuerKit(
    freeze({ db, commodity, makeGuid, nowMs }),
  )) as IssuerKitWithPurseGuids;

  const purse = await kit.issuer.makeEmptyPurse();
  const purseGuid = kit.purses.getGuid(purse);

  const chart = makeChartFacet({
    db,
    commodityGuid: kit.commodityGuid,
    getGuidFromSealed: kit.purses.getGuidFromSealed,
  });

  await chart.placeAccount({
    accountGuid: purseGuid,
    name: 'Savings',
    accountType: 'BANK',
  });

  const row = await db
    .prepare<[string], { name: string; account_type: string }>(
      'SELECT name, account_type FROM accounts WHERE guid = ?',
    )
    .get(purseGuid);
  t.is(row?.name, 'Savings');
  t.is(row?.account_type, 'BANK');
});

test('placePurseAtPath rejects an empty path', async t => {
  const { freeze } = Object;
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const nowMs = () => Date.UTC(2020, 0, 1);
  const kit = (await createIssuerKit(
    freeze({ db, commodity, makeGuid, nowMs }),
  )) as IssuerKitWithPurseGuids;

  const purse = await kit.issuer.makeEmptyPurse();
  const chart = makeChartFacet({
    db,
    commodityGuid: kit.commodityGuid,
    getGuidFromSealed: kit.purses.getGuidFromSealed,
  });

  const sealedPurse = kit.sealer.seal(purse);
  await t.throwsAsync(
    () => chart.placePurseAtPath({ sealedPurse, path: [] }),
    { message: 'account path must not be empty' },
  );
});
