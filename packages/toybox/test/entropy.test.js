/** @file Entropy devices answer swiss numbers of 128 bits. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntropy } from '../src/devices/entropy.js';

/** @import { KernelPowers } from '../src/kernel/types.js' */

const powers = /** @type {KernelPowers} the device's kinds use none of them */ (
  harden({})
);

test('swiss() answers 16 random bytes in base64url, unpadded, and only 16', () => {
  /** @param {number} size */
  const entropyOf = size =>
    makeEntropy(powers, { random: n => new Uint8Array(size).fill(n) }).kinds
      .entropy;
  assert.equal(
    entropyOf(16).deliver('1', 'swiss', []),
    'EBAQEBAQEBAQEBAQEBAQEA',
  );
  // 0xfb bytes are where base64 has + and /, which base64url has as - and _
  const urlSafe = makeEntropy(powers, {
    random: n => new Uint8Array(n).fill(0xfb),
  }).kinds.entropy;
  assert.equal(urlSafe.deliver('1', 'swiss', []), '-_v7-_v7-_v7-_v7-_v7-w');
  for (const size of [15, 17])
    assert.throws(() => entropyOf(size).deliver('1', 'swiss', []), /16 bytes/);
});
