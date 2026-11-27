/**
 * @file Hashes, of hex, in hex: pure functions, so every vat gets them
 * among its powers, beside `E` and `M`, as it gets `JSON`. They take no
 * authority; a signer, which does, is the crypto device's (devices/crypto.js).
 */
import { blake2b } from '@noble/hashes/blake2b';
import { sha256 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Fail, q } from '@endo/errors';

/**
 * Bytes of `hex`, an even number of hex digits.
 *
 * @param {string} hex
 * @param {string} what names the caller in an error
 */
export const bytesOf = (hex, what) =>
  typeof hex === 'string' && /^([0-9a-fA-F]{2})*$/.test(hex)
    ? hexToBytes(hex)
    : Fail`${q(what)}: not hex, an even number of hex digits`;

/** @type {import('./types.js').Hashes} */
export const hashes = harden({
  sha256: hex => bytesToHex(sha256(bytesOf(hex, 'sha256'))),
  blake2b256: hex =>
    bytesToHex(blake2b(bytesOf(hex, 'blake2b256'), { dkLen: 32 })),
  keccak256: hex => bytesToHex(keccak_256(bytesOf(hex, 'keccak256'))),
});
