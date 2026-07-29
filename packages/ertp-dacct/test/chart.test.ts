import test from 'ava';
import { makeTestDb, mockMakeGuid } from './mock-io.js';
import { createIssuerKit } from '../src/index.js';
import { makeChartFacet } from '../src/chart.js';
import { makeSealerUnsealerPair } from '../src/sealer.js';
import type { Guid, IssuerKitWithPurseGuids } from '../src/types.js';

test('placePurse updates account name and type', async t => {
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
  await chart.placePurse({
    sealedPurse,
    name: 'Alice Wallet',
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
      }
    >(
      'SELECT name, account_type, parent_guid, commodity_scu FROM accounts WHERE guid = ?',
    )
    .get(guid);
  t.is(row?.name, 'Alice Wallet');
  t.is(row?.account_type, 'ASSET');
  t.is(row?.commodity_scu, 100);
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

test('placePurse rejects non-existent parent', async t => {
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
  const bogusGuid = '0000000000000000deadbeefcafebabe' as Guid;
  await t.throwsAsync(
    () => chart.placePurse({ sealedPurse, name: 'Bad', parentGuid: bogusGuid }),
    { message: 'parent account not found' },
  );
});
