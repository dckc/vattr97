import test from 'ava';
import { E } from '@endo/eventual-send';

import { make as makeSqliteDb } from '../src/sqlite-db.js';

const makeMemoryDb = () =>
  makeSqliteDb(undefined, undefined, {
    env: { DB_PATH: ':memory:' },
  });

test('requires an injected database path', t => {
  const error = t.throws(() => makeSqliteDb());
  t.regex(error?.message || '', /DB_PATH/);
});

test('root capability supports autocommit operations', async t => {
  const db = makeMemoryDb();
  t.teardown(() => E(db).close());

  await E(db).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');
  await E(db).execute('INSERT INTO item (name) VALUES (?)', ['outside']);

  t.deepEqual(await E(db).query('SELECT name FROM item'), [
    { name: 'outside' },
  ]);
});

test('transaction commits its statements atomically', async t => {
  const db = makeMemoryDb();
  t.teardown(() => E(db).close());
  await E(db).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');

  const tx = await E(db).begin();
  await E(tx).execute('INSERT INTO item (name) VALUES (?)', ['committed']);
  await E(tx).commit();

  t.deepEqual(await E(db).query('SELECT name FROM item'), [
    { name: 'committed' },
  ]);
});

test('transaction supports promise-pipelined statements and commit', async t => {
  const db = makeMemoryDb();
  t.teardown(() => E(db).close());
  await E(db).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');

  const txP = E(db).begin();
  const firstP = E(txP).execute('INSERT INTO item (name) VALUES (?)', [
    'first',
  ]);
  const secondP = E(txP).execute('INSERT INTO item (name) VALUES (?)', [
    'second',
  ]);
  const commitP = E(txP).commit();

  await Promise.all([firstP, secondP, commitP]);
  t.deepEqual(await E(db).query('SELECT name FROM item ORDER BY name'), [
    { name: 'first' },
    { name: 'second' },
  ]);
});

test('pipelined commit rolls back if an earlier statement fails', async t => {
  const db = makeMemoryDb();
  t.teardown(() => E(db).close());
  await E(db).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');

  const txP = E(db).begin();
  const firstP = E(txP).execute('INSERT INTO item (name) VALUES (?)', [
    'duplicate',
  ]);
  const duplicateP = E(txP).execute('INSERT INTO item (name) VALUES (?)', [
    'duplicate',
  ]);
  const commitP = E(txP).commit();

  await firstP;
  await t.throwsAsync(duplicateP, { message: /UNIQUE constraint failed/ });
  await t.throwsAsync(commitP, { message: /cannot commit failed/i });
  t.deepEqual(await E(db).query('SELECT name FROM item'), []);
});

test('transaction rollback discards its statements', async t => {
  const db = makeMemoryDb();
  t.teardown(() => E(db).close());
  await E(db).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');

  const tx = await E(db).begin();
  await E(tx).execute('INSERT INTO item (name) VALUES (?)', ['rolled-back']);
  await E(tx).rollback();

  t.deepEqual(await E(db).query('SELECT name FROM item'), []);
});

test('active transaction exclusively owns the connection', async t => {
  const db = makeMemoryDb();
  t.teardown(() => E(db).close());
  await E(db).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');

  const tx = await E(db).begin();

  await t.throwsAsync(E(db).query('SELECT * FROM item'), {
    message: /active transaction/,
  });
  await t.throwsAsync(E(db).execute('INSERT INTO item VALUES (?)', ['root']), {
    message: /active transaction/,
  });
  await t.throwsAsync(E(db).begin(), {
    message: /active transaction/,
  });

  await E(tx).rollback();
});

test('transaction capability is disabled after commit or rollback', async t => {
  const db = makeMemoryDb();
  t.teardown(() => E(db).close());
  await E(db).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');

  const committed = await E(db).begin();
  await E(committed).commit();
  await t.throwsAsync(E(committed).query('SELECT * FROM item'), {
    message: /no longer active/,
  });

  const rolledBack = await E(db).begin();
  await E(rolledBack).rollback();
  await t.throwsAsync(E(rolledBack).commit(), {
    message: /no longer active/,
  });
});

test('transaction control SQL must use the capability API', async t => {
  const db = makeMemoryDb();
  t.teardown(() => E(db).close());

  await t.throwsAsync(E(db).execute('/* comment */ BEGIN'), {
    message: /begin\(\)/i,
  });

  const tx = await E(db).begin();
  await t.throwsAsync(E(tx).execute('-- comment\nCOMMIT'), {
    message: /commit\(\)|rollback\(\)/i,
  });
  await E(tx).rollback();
});

test('closing the root capability rolls back its active transaction', async t => {
  const db = makeMemoryDb();
  const tx = await E(db).begin();

  await E(db).close();

  await t.throwsAsync(E(tx).rollback(), {
    message: /closed|no longer active/,
  });
});
