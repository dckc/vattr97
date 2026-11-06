/** @file The wallet's issuer kits, in one process: liveslots over an in-memory vatstore. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, Far } from '@endo/far';
import { M } from '@endo/patterns';
import { makeLiveslots } from '../src/liveslots.js';
import { buildRootObject } from '../examples/wallet/issuers.js';
import { makeMemoryVatstore } from './memory-vatstore.js';

/** @import { Remote, SqlDatabase } from '../src/types.js' */

/** @returns {Remote} */
const makeIssuers = () => {
  const send = () => Promise.reject(Error('this vat imports nothing'));
  const { zone } = makeLiveslots({ send, kv: makeMemoryVatstore() });
  assert.ok(zone);
  const db = /** @type {SqlDatabase} the issuers vat uses none */ (harden({}));
  const endowment = () => {
    throw Error('no endowments here');
  };
  return buildRootObject(harden({ E, Far, M, zone, db, endowment }), {});
};

test("a deposit that would take a balance past exact integers is refused, and the payment isn't spent", () => {
  const { mint, issuer } = makeIssuers().makeIssuerKit('Bucks');
  const purse = issuer.makeEmptyPurse();
  purse.deposit(mint.mintPayment(Number.MAX_SAFE_INTEGER));
  const more = mint.mintPayment(1);
  assert.throws(() => purse.deposit(more), /not a whole number of units/);
  assert.equal(purse.getBalance(), Number.MAX_SAFE_INTEGER);
  assert.equal(issuer.isLive(more), true);
});
