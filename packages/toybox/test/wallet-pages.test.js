/** @file Served pages: their swiss number goes in a body, never a path, and their forms post back with it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOADER_SCRIPT,
  pageRequestOf,
  postingBack,
} from '../examples/wallet/gateway/pages.js';

test("a served page's request: its number, its path, and the rest as labels", () => {
  assert.deepEqual(pageRequestOf('page=abc&path=%2Fofx&since=2026-03-01'), {
    page: 'abc',
    path: '/ofx',
    labels: { since: '2026-03-01' },
  });
  assert.deepEqual(pageRequestOf('page=abc'), {
    page: 'abc',
    path: '/',
    labels: {},
  });
  assert.equal(pageRequestOf('page=abc&path=csv').path, '/csv');
});

test("a served page's forms post back with its number, whatever they said", () => {
  const html = postingBack(
    `<form action="ofx" method=get><button formaction='csv' name="path" value="/csv">CSV</button></form>`,
    'abc"<',
  );
  assert.equal(
    html,
    `<form method="post" action="/s/" action="ofx" method=get><input type="hidden" name="page" value="abc&quot;&lt;"><button name="path" value="/csv">CSV</button></form>`,
  );
});

test("the loader's script parses, and reads the number from the fragment", () => {
  assert.doesNotThrow(() => Function(LOADER_SCRIPT));
  assert.match(LOADER_SCRIPT, /location\.hash/);
});
