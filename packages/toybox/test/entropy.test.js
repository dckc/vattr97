/** @file Entropy devices answer swiss numbers of 128 bits. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntropy } from '../src/devices/entropy.js';

/** @import { KernelPowers } from '../src/kernel/types.js' */

const powers = /** @type {KernelPowers} the device's kinds use none of them */ (
  harden({})
);

test('swiss() answers 32 hex digits, and only from 16 random bytes', () => {
  /** @param {number} size */
  const entropyOf = size =>
    makeEntropy(powers, { random: n => new Uint8Array(size).fill(n) }).kinds
      .entropy;
  assert.equal(entropyOf(16).deliver('1', 'swiss', []), '10'.repeat(16));
  for (const size of [15, 17])
    assert.throws(() => entropyOf(size).deliver('1', 'swiss', []), /16 bytes/);
});
