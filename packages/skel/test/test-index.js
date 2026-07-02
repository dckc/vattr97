import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../index.js';

describe('@vattr/skel', () => {
  it('greet', () => {
    const msg = harden(greet('World'));
    assert.equal(msg, 'Hello, World!');
  });
});
