import { describe, it, expect } from 'vitest';
import { decodeBase32, encodeBase32 } from '../src/base32.js';
import { isRawCid } from '../src/cid.js';
import { getRandomValues, rawCidOf, utf8 } from './support.js';

describe('base32', () => {
  it('matches the RFC 4648 test vectors, lowercase and unpadded', () => {
    expect(encodeBase32(utf8(''))).toBe('');
    expect(encodeBase32(utf8('f'))).toBe('my');
    expect(encodeBase32(utf8('fo'))).toBe('mzxq');
    expect(encodeBase32(utf8('foobar'))).toBe('mzxw6ytboi');
  });

  it('round-trips bytes of any length', () => {
    for (const length of [0, 1, 2, 5, 16, 32, 36, 257]) {
      const bytes = getRandomValues(new Uint8Array(length));
      expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes);
    }
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => decodeBase32('ab1')).toThrow(TypeError);
  });
});

describe('raw CIDs', () => {
  it('names a block the way IPFS does', async () => {
    expect(await rawCidOf(utf8('hello world'))).toBe(
      'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e',
    );
  });

  it('recognizes only CIDv1 raw sha2-256', async () => {
    expect(isRawCid(await rawCidOf(utf8('x')))).toBe(true);
    expect(isRawCid('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).toBe(
      false,
    );
    expect(isRawCid('bafkrei/../../api/v0/id')).toBe(false);
    expect(isRawCid(undefined)).toBe(false);
  });
});
