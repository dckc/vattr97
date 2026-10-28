import test from 'ava';
import Database from 'better-sqlite3';
import {
  initGnuCashSchema,
  createIssuerKit,
  openIssuerKit,
  wrapBetterSqlite3DatabaseAsync,
} from '../src/index.js';
import { mockMakeGuid } from '../src/guids.js';
import { makeTestClock } from './mock-io.js';
import type { Brand, NatAmount } from '../src/ertp-types.js';

test('negative amounts rejected', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const clock = makeTestClock();
  const kit = await createIssuerKit(freeze({ db, clock, commodity, makeGuid }));
  const brand = kit.brand as Brand<'nat'>;

  await t.throwsAsync(
    () =>
      kit.mint.mintPayment(
        freeze({ brand, value: -1n }),
      ) as unknown as Promise<unknown>,
    { message: 'amount must be non-negative' },
  );
});

test('wrong-brand payments rejected on deposit', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const clock = makeTestClock();
  const bucks = await createIssuerKit(
    freeze({
      db,
      commodity: freeze({ mnemonic: 'BUCKS' }),
      makeGuid,
      clock,
    }),
  );
  const euros = await createIssuerKit(
    freeze({
      db,
      commodity: freeze({ mnemonic: 'EUROS' }),
      makeGuid: mockMakeGuid(1000n),
      clock,
    }),
  );

  const purse = await bucks.issuer.makeEmptyPurse();
  const payment = await euros.mint.mintPayment(
    freeze({ brand: euros.brand, value: 5n }),
  );

  await t.throwsAsync(
    () => purse.deposit(payment) as unknown as Promise<unknown>,
    { message: 'payment not live' },
  );
});

test('holding account is not externally accessible', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const clock = makeTestClock();
  const kit = await createIssuerKit(freeze({ db, clock, commodity, makeGuid }));

  const { holdingAccountGuid } = kit.mintInfo.getMintInfo();
  const reopenedKit = await openIssuerKit(
    freeze({
      db,
      clock: makeTestClock(),
      commodityGuid: kit.commodityGuid,
      makeGuid,
    }),
  );
  await t.throwsAsync(
    () => reopenedKit.accounts.makeAccountPurse(holdingAccountGuid),
    { message: 'holding account is not externally accessible' },
  );
  await t.throwsAsync(
    () => reopenedKit.accounts.openAccountPurse(holdingAccountGuid),
    { message: 'holding account is not externally accessible' },
  );
});

test('payment not live after burn', async t => {
  const { freeze } = Object;
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3DatabaseAsync(rawDb);
  t.teardown(() => rawDb.close());
  await initGnuCashSchema(db);

  const makeGuid = mockMakeGuid();
  const commodity = freeze({ namespace: 'COMMODITY', mnemonic: 'BUCKS' });
  const clock = makeTestClock();
  const kit = await createIssuerKit(freeze({ db, clock, commodity, makeGuid }));
  const brand = kit.brand as Brand<'nat'>;
  const bucks = (value: bigint): NatAmount => freeze({ brand, value });

  const payment = await kit.mint.mintPayment(bucks(10n));
  t.true(await kit.issuer.isLive(payment as never));

  await kit.issuer.burn(payment as never);
  t.false(await kit.issuer.isLive(payment as never));
});
