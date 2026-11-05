/** @file Kernel objects as guarded exos: a message reaches only the kind's own methods, through its guard. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M } from '@endo/patterns';
import { kzone } from '../devices/objects.js';

test("a kernel object's message reaches only its kind's own methods, through the guard", () => {
  const greeters = kzone.exoClass(
    'Greeter',
    M.interface('Greeter', { hi: M.call().returns(M.string()) }),
    {
      hi() {
        return `hi from ${this.state.rest}`;
      },
    },
  );
  assert.equal(greeters.deliver('1', 'hi', []), 'hi from 1');
  assert.throws(
    () => greeters.deliver('1', 'hi', ['extra']),
    /at most 0 arguments/,
  );
  for (const method of ['toString', 'constructor', 'hasOwnProperty'])
    assert.throws(() => greeters.deliver('1', method, []), /a Greeter has no/);
});

test("a kernel object's key may be empty or hold a colon; __proto__ is no method", () => {
  const greeters = kzone.exoClass(
    'Greeter',
    M.interface('Greeter', { hi: M.call().returns(M.string()) }),
    {
      hi() {
        return `hi from ${this.state.rest}`;
      },
    },
  );
  assert.equal(greeters.deliver('', 'hi', []), 'hi from ');
  assert.equal(greeters.deliver('a:b', 'hi', []), 'hi from a:b');
  assert.throws(
    () => greeters.deliver('1', '__proto__', []),
    /a Greeter has no/,
  );
});
