/** @file Worker Loader modules of a bundle's files, typed by extension. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loaderModule } from '../src/kernel/bundles.js';

const bytes = (/** @type {string} */ text) => new TextEncoder().encode(text);

test('a file is a module of the type its extension names, or data', () => {
  assert.deepEqual(loaderModule('main.js', bytes('export {};')), {
    js: 'export {};',
  });
  assert.deepEqual(loaderModule('x.json', bytes('{"a": 1}')), {
    json: { a: 1 },
  });
  // an extension that names an Object.prototype property is no type
  for (const name of ['x.constructor', 'x.toString', 'x.__proto__'])
    assert.deepEqual(Object.keys(loaderModule(name, bytes('hi'))), ['data']);
});
