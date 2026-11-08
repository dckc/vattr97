/**
 * @file Purses and payments in a durable zone: the vat restarts, and what
 * it kept is the same purse, the same payment, over the same ledger.
 * @see ../src/index.ts
 */

import test from 'ava';
import Database from 'better-sqlite3';
import { makeLiveslots } from '@vattr/toybox/src/vat/liveslots.js';
import { makeHeapZone } from '@vattr/toybox/src/vat/heap-zone.js';
import { makeMemoryVatstore } from '@vattr/toybox/test/memory-vatstore.js';
import type { MapStore, Zone } from '@vattr/toybox/src/types.js';
import type { Vatstore } from '@vattr/toybox/src/vat/types.js';
import type { NatAmount, Payment, Purse } from '../src/ertp-types.js';
import type { CommoditySpec, Guid } from '../src/types.js';
import {
  createIssuerKit,
  initGnuCashSchema,
  openIssuerKit,
  wrapBetterSqlite3Database,
} from '../src/index.js';
import { mockMakeGuid } from '../src/guids.js';
import { makeTestClock } from './mock-io.js';

/** The vat's root zone in one incarnation, over `kv`. */
const startVat = (kv: Vatstore): Zone => {
  const send = () => Promise.reject(Error('no kernel here'));
  const { zone } = makeLiveslots({ send, kv });
  if (!zone) throw Error('liveslots made no zone');
  return zone;
};

const makeLedger = () => {
  const rawDb = new Database(':memory:');
  const db = wrapBetterSqlite3Database(rawDb);
  initGnuCashSchema(db);
  return { db, close: () => rawDb.close() };
};

test('a purse and a payment kept in a durable zone work after a restart', t => {
  const { db, close } = makeLedger();
  t.teardown(close);
  const kv = makeMemoryVatstore();
  const makeGuid = mockMakeGuid();
  const commodity: CommoditySpec = harden({
    namespace: 'COMMODITY',
    mnemonic: 'BUCKS',
  });

  let commodityGuid: Guid;
  {
    const zone = startVat(kv);
    const kit = createIssuerKit(
      harden({ db, commodity, makeGuid, nowMs: makeTestClock(), zone }),
    );
    ({ commodityGuid } = kit);
    const bucks = (value: bigint): NatAmount =>
      harden({ brand: kit.brand, value });
    const purse = kit.issuer.makeEmptyPurse();
    purse.deposit(kit.mint.mintPayment(bucks(10n)));
    const kept: MapStore<string, Purse<'nat'> | Payment<'nat'>> =
      zone.mapStore('kept');
    kept.init('purse', purse);
    kept.init('payment', purse.withdraw(bucks(3n)));
  }

  const zone = startVat(kv);
  const { kit } = openIssuerKit(
    harden({ db, commodityGuid, makeGuid, nowMs: makeTestClock(), zone }),
  );
  const kept: MapStore<string, any> = zone.mapStore('kept');
  const purse: Purse<'nat'> = kept.get('purse');
  const payment: Payment<'nat'> = kept.get('payment');
  t.is(String(purse), '[object Alleged: BUCKS Purse purse]');
  t.is(purse.getCurrentAmount().value, 7n);
  t.is(purse.getCurrentAmount().brand, kit.brand, 'the same brand');
  t.is(purse.deposit(payment).value, 3n);
  t.is(purse.getCurrentAmount().value, 10n);
});

test('two payments reified from one check can deposit only once', t => {
  const { db, close } = makeLedger();
  t.teardown(close);
  const zone = makeHeapZone();
  const kit = createIssuerKit(
    harden({
      db,
      commodity: harden({ namespace: 'COMMODITY', mnemonic: 'BUCKS' } as const),
      makeGuid: mockMakeGuid(),
      nowMs: makeTestClock(),
      zone,
    }),
  );
  const payment = kit.mint.mintPayment(harden({ brand: kit.brand, value: 5n }));
  const checkNumber = kit.payments.getCheckNumber(payment);
  // PaymentAccess answers a bare object; it's one of this kit's payments
  const copy = kit.payments.openPayment(checkNumber) as Payment<'nat'>;
  const purse = kit.issuer.makeEmptyPurse();
  purse.deposit(copy);
  t.throws(() => purse.deposit(payment), { message: /not live/ });
  t.is(purse.getCurrentAmount().value, 5n);
});
