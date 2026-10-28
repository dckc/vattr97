import test from 'ava';
import { E } from '@endo/eventual-send';

import { make as makeSqliteDbMaker } from '../src/sqlite-db.js';

const dbMaker = makeSqliteDbMaker();
const makeMemoryDb = () => dbMaker.makeDb(':memory:');

test('maker opens databases at independent paths', async t => {
  const first = dbMaker.makeDb(':memory:');
  const second = dbMaker.makeDb(':memory:');
  t.teardown(() => E(first).close());
  t.teardown(() => E(second).close());

  await E(first).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');
  await E(first).execute('INSERT INTO item (name) VALUES (?)', ['first']);
  await E(second).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');

  t.deepEqual(await E(first).query('SELECT name FROM item'), [
    { name: 'first' },
  ]);
  t.deepEqual(await E(second).query('SELECT name FROM item'), []);
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

test('root capability supports prepared statements', async t => {
  const db = makeMemoryDb();
  t.teardown(() => E(db).close());

  await E(db).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');
  const insertP = E(db).prepare('INSERT INTO item (name) VALUES (?)');
  await E(insertP).run('first');
  await E(insertP).run('second');

  const selectP = E(db).prepare(
    'SELECT name FROM item WHERE name >= ? ORDER BY name',
  );
  t.deepEqual(await E(selectP).get('first'), { name: 'first' });
  t.deepEqual(await E(selectP).all('first'), [
    { name: 'first' },
    { name: 'second' },
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

test('transaction owns its prepared statements', async t => {
  const db = makeMemoryDb();
  t.teardown(() => E(db).close());
  await E(db).execute('CREATE TABLE item (name TEXT PRIMARY KEY)');

  const txP = E(db).begin();
  const insertP = E(txP).prepare('INSERT INTO item (name) VALUES (?)');
  await E(insertP).run('committed');
  await E(txP).commit();

  await t.throwsAsync(E(insertP).run('too late'), {
    message: /no longer active/,
  });
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
  const rootStatement = await E(db).prepare('SELECT * FROM item');

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
  await t.throwsAsync(E(db).prepare('SELECT * FROM item'), {
    message: /active transaction/,
  });
  await t.throwsAsync(E(rootStatement).all(), {
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
