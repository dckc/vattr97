import test from 'ava';
import { make as makeClock } from '../scripts/devices/clock.js';

test('unconfined clock reads the real clock', t => {
  const before = Date.now();
  const clock = makeClock();
  const now = clock.now();
  const after = Date.now();

  t.true(now >= before);
  t.true(now <= after);
});
