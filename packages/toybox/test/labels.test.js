/** @file Labels merge as Flower's do. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLabels } from '../src/labels.js';

test('labels merge; a key both give must agree, whatever its name', () => {
  assert.deepEqual(mergeLabels({ a: '1' }, { a: '1', b: '2' }), {
    a: '1',
    b: '2',
  });
  assert.throws(
    () => mergeLabels({ a: '1' }, { a: '2' }),
    /label a is already set/,
  );
  for (const k of ['constructor', 'toString', '__proto__']) {
    const merged = mergeLabels({}, JSON.parse(`{"${k}": "x"}`));
    assert.ok(Object.hasOwn(merged, k));
    assert.equal(mergeLabels(merged, JSON.parse(`{"${k}": "x"}`))[k], 'x');
    assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  }
  // @ts-expect-error a label's value is a string
  assert.throws(() => mergeLabels({}, { a: 1 }), /label a is not a string/);
});
