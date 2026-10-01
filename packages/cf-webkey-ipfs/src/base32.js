// @ts-check
import harden from '@endo/harden';

/** RFC 4648 base32 alphabet, lowercase, no padding. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {string}
 */
export const encodeBase32 = bytes => {
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) {
    out += ALPHABET[(acc << (5 - bits)) & 31];
  }
  return out;
};
harden(encodeBase32);

/**
 * @param {string} text base32 as produced by `encodeBase32`
 * @returns {Uint8Array<ArrayBuffer>}
 */
export const decodeBase32 = text => {
  const out = new Uint8Array(Math.floor((text.length * 5) / 8));
  let bits = 0;
  let acc = 0;
  let at = 0;
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) {
      throw TypeError('not base32');
    }
    acc = ((acc << 5) | value) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      out[at] = (acc >>> (bits - 8)) & 0xff;
      at += 1;
      bits -= 8;
    }
  }
  return out;
};
harden(decodeBase32);
