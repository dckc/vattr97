/** @file The ingress's mount SQL, on node:sqlite: lookup, overlap, and mounts stored before mount_label. */
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOKUP,
  MOUNT,
  MOUNT_LABELS,
  MOUNT_SCHEMA,
  OVERLAP,
} from '../mounts-sql.js';

const makeDb = () => {
  const db = new DatabaseSync(':memory:');
  for (const statement of MOUNT_SCHEMA) db.exec(statement);
  /** @param {string} vat @param {Record<string, string>} labels */
  const mount = (vat, labels) => {
    const json = JSON.stringify(labels);
    db.prepare(MOUNT).run(vat, json);
    db.prepare(MOUNT_LABELS).run(vat, json);
  };
  /** @param {Record<string, string>} request */
  const lookup = request =>
    db.prepare(LOOKUP).get(JSON.stringify(request))?.vat ?? null;
  /** @param {string} vat @param {Record<string, string>} labels */
  const overlaps = (vat, labels) =>
    !!db.prepare(OVERLAP).get(JSON.stringify(labels), vat);
  return { db, mount, lookup, overlaps };
};

test('a request reaches the mount whose every label it carries', () => {
  const { mount, lookup } = makeDb();
  mount('a', { vat: 'alice', flavor: 'plain' });
  mount('b', { vat: 'bob' });
  assert.equal(lookup({ vat: 'alice', flavor: 'plain', page: '2' }), 'a');
  assert.equal(lookup({ vat: 'alice' }), null);
  assert.equal(lookup({ vat: 'alice', flavor: 'fancy' }), null);
  assert.equal(lookup({ vat: 'bob' }), 'b');
  assert.equal(lookup({}), null);
});

test('a mount with no labels matches any request', () => {
  const { mount, lookup } = makeDb();
  mount('only', {});
  assert.equal(lookup({ anything: 'x' }), 'only');
});

test('overlap: a mount must conflict with every other', () => {
  const { mount, overlaps } = makeDb();
  mount('a', { vat: 'alice' });
  assert.equal(overlaps('b', { vat: 'alice', n: '2' }), true);
  assert.equal(overlaps('b', { app: 'x' }), true);
  assert.equal(overlaps('b', { vat: 'bob' }), false);
  assert.equal(
    overlaps('a', { vat: 'alice', n: '2' }),
    false,
    "a vat's own mount doesn't count",
  );
});

test('mounts stored before mount_label are filled in when the schema runs', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE mount (vat TEXT PRIMARY KEY, labels TEXT)');
  db.prepare('INSERT INTO mount VALUES (?, ?)').run(
    'old',
    JSON.stringify({ vat: 'old' }),
  );
  for (const statement of MOUNT_SCHEMA) db.exec(statement);
  assert.equal(
    db.prepare(LOOKUP).get(JSON.stringify({ vat: 'old' }))?.vat,
    'old',
  );
  assert.equal(
    db.prepare(LOOKUP).get(JSON.stringify({ vat: 'other' })),
    undefined,
  );
});
