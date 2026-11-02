/** @file Kernel objects as guarded exos: a message reaches only the kind's own methods, through its guard. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M } from '@endo/patterns';
import { kernelObjects } from '../devices/objects.js';

test("a kernel object's message reaches only its kind's own methods, through the guard", () => {
  const greeters = kernelObjects(
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
