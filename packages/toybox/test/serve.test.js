/** @file What `scripts/serve.js` prints about a secret: a fingerprint, not the secret. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../src/serve.js';

test('a fingerprint is the first 6 bytes of SHA-256, in hex, and holds nothing of the secret', async () => {
  // sha256("abc") = ba7816bf8f01cfea414140de5dae2223...
  assert.equal(await fingerprint('abc'), 'ba7816bf8f01');
  const link = 'http://127.0.0.1:8788/#owner=EINeuB6mqD3iqOZh4VNgAA';
  assert.doesNotMatch(await fingerprint(link), /EINeuB6|owner/);
  assert.notEqual(await fingerprint(link), await fingerprint(`${link}B`));
});
