import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../index.js';

describe('@vattr/skel', () => {
  it('greet', () => {
    assert.equal(greet('World'), 'Hello, World!');
  });
});
