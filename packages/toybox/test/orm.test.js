/** @file Rows as records, on real SQLite, and the limit to a module's own tables. */
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeORM } from '../src/orm.js';
import { makeSql } from './memory-sql.js';

/** @import { ORM } from '../src/orm.js' */

/** @typedef {{ pet: { name: string, legs: number | null } }} Tables */

const makeDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE pet (name TEXT PRIMARY KEY, legs INTEGER)');
  db.exec('CREATE TABLE secret (name TEXT PRIMARY KEY)');
  const sql = makeSql(db);
  /** @type {ORM<Tables>} */
  const orm = makeORM(sql, ['pet']);
  return orm;
};

test('rows go in, change, and come out as records', () => {
  const db = makeDb();
  db.insert('pet', { name: 'rex', legs: 4 });
  db.insert('pet', { name: 'tweety', legs: null });
  assert.deepEqual(db.lookup('pet', { name: 'rex' }).get(), {
    name: 'rex',
    legs: 4,
  });
  assert.equal(db.query('pet').length, 2);
  assert.deepEqual(
    db.query('pet', { legs: 4 }).map(({ name }) => name),
    ['rex'],
  );
  db.lookup('pet', { name: 'rex' }).update({ legs: 3 });
  assert.equal(db.lookup('pet', { name: 'rex' }).one().legs, 3);
  db.lookup('pet', { name: 'rex' }).delete();
  assert.equal(db.lookup('pet', { name: 'rex' }).get(), undefined);
  assert.throws(() => db.lookup('pet', { name: 'rex' }).one(), /exactly one/);
});

test('insertOrIgnore keeps the row a key already has; insert refuses', () => {
  const db = makeDb();
  db.insert('pet', { name: 'rex', legs: 4 });
  db.insertOrIgnore('pet', { name: 'rex', legs: 3 });
  assert.equal(db.lookup('pet', { name: 'rex' }).one().legs, 4);
  assert.throws(() => db.insert('pet', { name: 'rex', legs: 3 }), /UNIQUE/);
});

test('every statement stays within its own tables', () => {
  const db = makeDb();
  const refused = /secret is not a table here/;
  // @ts-expect-error not one of its tables
  assert.throws(() => db.query('secret'), refused);
  // @ts-expect-error not one of its tables
  assert.throws(() => db.lookup('secret', { name: 'x' }).get(), refused);
  // @ts-expect-error not one of its tables
  assert.throws(() => db.lookup('secret', { name: 'x' }).one(), refused);
  assert.throws(
    // @ts-expect-error not one of its tables
    () => db.lookup('secret', { name: 'x' }).update({ name: 'y' }),
    refused,
  );
  // @ts-expect-error not one of its tables
  assert.throws(() => db.lookup('secret', { name: 'x' }).delete(), refused);
  // @ts-expect-error not one of its tables
  assert.throws(() => db.insert('secret', { name: 'x' }), refused);
  // @ts-expect-error not one of its tables
  assert.throws(() => db.insertOrIgnore('secret', { name: 'x' }), refused);
  // @ts-expect-error not one of its tables
  assert.throws(() => db.atMost('secret', 'name', 'x'), refused);
  // @ts-expect-error not one of its tables
  assert.throws(() => db.least('secret', 'name'), refused);
});

test('atMost answers the rows at or below a value, in order; least, the row with the least', () => {
  const db = makeDb();
  assert.equal(db.least('pet', 'legs'), undefined);
  for (const [name, legs] of /** @type {const} */ ([
    ['spider', 8],
    ['rex', 4],
    ['tweety', 2],
    ['fish', 0],
  ]))
    db.insert('pet', { name, legs });
  assert.deepEqual(
    db.atMost('pet', 'legs', 4).map(({ name }) => name),
    ['fish', 'tweety', 'rex'],
  );
  assert.deepEqual(db.atMost('pet', 'legs', -1), []);
  assert.equal(db.least('pet', 'legs')?.name, 'fish');
  // a column name goes into the SQL as it is, so it must be a plain name
  assert.throws(
    // @ts-expect-error not a column
    () => db.least('pet', 'legs; DROP TABLE pet'),
    /not a column name/,
  );
});
