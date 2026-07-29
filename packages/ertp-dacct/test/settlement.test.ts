import test from 'ava';
import { makeTestDb, mockMakeGuid } from './mock-io.js';
import {
  createIssuerKit,
  makeSettlementFacet,
  openIssuerKitWithPurseGuids,
} from '../src/index.js';
import type {
  Guid,
  IssuerKitWithPurseGuids,
  AmountLike,
} from '../src/types.js';

test('settle wraps a single-tx operation', async t => {
  const { freeze } = Object;
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const makeGuid = mockMakeGuid();
  const nowMs = () => Date.UTC(2020, 0, 1);
  const usdRows = await db.query(
    "SELECT guid FROM commodities WHERE namespace = 'CURRENCY' AND mnemonic = 'USD'",
  );
  const currency = (await openIssuerKitWithPurseGuids(
    freeze({
      db,
      commodityGuid: usdRows[0]?.guid as Guid,
      makeGuid,
      nowMs,
    }),
  )) as IssuerKitWithPurseGuids;

  const settlement = makeSettlementFacet({
    db,
    currencyGuid: currency.commodityGuid,
    makeSettlementRef: () => 'SETTLE001',
  });

  const result = await settlement.settle(async () => {
    const purse = await currency.issuer.makeEmptyPurse();
    const payment = await currency.mint.mintPayment({
      brand: currency.brand,
      value: 100n,
    });
    await purse.deposit(payment);
    return 'done';
  });

  t.is(result.result, 'done');
  t.is(result.settlementRef, 'SETTLE001');
  t.truthy(result.txGuid);
});

test('settle consolidates multi-commodity txs', async t => {
  const { freeze } = Object;
  const { db, close } = await makeTestDb();
  t.teardown(() => close());

  const makeGuid = mockMakeGuid();
  const nowMs = () => Date.UTC(2020, 0, 1);
  const usdRows = await db.query(
    "SELECT guid FROM commodities WHERE namespace = 'CURRENCY' AND mnemonic = 'USD'",
  );
  const currency = (await openIssuerKitWithPurseGuids(
    freeze({
      db,
      commodityGuid: usdRows[0]?.guid as Guid,
      makeGuid,
      nowMs,
    }),
  )) as IssuerKitWithPurseGuids;
  const stock = (await createIssuerKit(
    freeze({
      db,
      commodity: { namespace: 'COMMODITY', mnemonic: 'STOCK' },
      makeGuid: mockMakeGuid(1000n),
      nowMs,
    }),
  )) as IssuerKitWithPurseGuids;

  const settlement = makeSettlementFacet({
    db,
    currencyGuid: currency.commodityGuid,
    makeSettlementRef: () => 'STK001',
  });

  const result = await settlement.settle(async () => {
    const usdPurse = await currency.issuer.makeEmptyPurse();
    const stockPurse = await stock.issuer.makeEmptyPurse();

    const usdPayment = await currency.mint.mintPayment({
      brand: currency.brand,
      value: 500n,
    });
    const stockPayment = await stock.mint.mintPayment({
      brand: stock.brand,
      value: 10n,
    });

    await usdPurse.deposit(usdPayment);
    await stockPurse.deposit(stockPayment);

    return { usdAmount: 500n, stockAmount: 10n };
  });

  t.is(result.result.usdAmount, 500n);
  t.is(result.result.stockAmount, 10n);
  t.is(result.settlementRef, 'STK001');
  t.truthy(result.txGuid);
});
