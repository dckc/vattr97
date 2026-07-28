import test from 'ava';
import { E } from '@endo/eventual-send';

import { make as makeStore } from '../src/confined-store.js';
import { make as makeSqliteDb } from '../src/sqlite-db.js';

test('unconfined database requires an injected path', t => {
  const error = t.throws(() => makeSqliteDb());
  t.regex(error?.message || '', /DB_PATH/);
});

test('confined store uses the database found by petname', async t => {
  const db = makeSqliteDb(undefined, undefined, {
    env: { DB_PATH: ':memory:' },
  });
  t.teardown(() => E(db).close());

  /** @type {string[]} */
  const lookups = [];
  const powers = harden({
    /** @param {string} name */
    lookup(name) {
      lookups.push(name);
      return db;
    },
  });

  const store = await makeStore(powers);
  await E(store).set('answer', '42');

  t.deepEqual(lookups, ['sqlite-db']);
  t.is(await E(store).get('answer'), '42');
  t.is(await E(store).get('missing'), undefined);
});
