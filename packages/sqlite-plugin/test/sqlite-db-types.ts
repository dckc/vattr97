import type { SqliteDb, SqliteStatement } from '../src/sqlite-db.js';

declare const db: SqliteDb;

const byName = db.prepare<[string], { name: string }>(
  'SELECT name FROM item WHERE name = ?',
);
const statement: SqliteStatement<[string], { name: string }> = byName;

statement.run('first');
statement.get('first')?.name;
statement.all('first')[0]?.name;

// @ts-expect-error The statement requires a string parameter.
statement.get(1);
