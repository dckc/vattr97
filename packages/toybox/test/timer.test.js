/** @file Timer devices: the time, and wakeups kept in a table, fired when due, at most once. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Far } from '@endo/far';
import { makeTimers, TABLES } from '../src/devices/timer.js';
import { makeORM } from '../src/orm.js';
import { makeSql } from './memory-sql.js';

/** @import { Kref } from '../src/kernel/types.js' */
/** @import { Tables } from '../src/devices/timer.js' */
/** @import { ORM } from '../src/orm.js' */

/** @type {WeakMap<object, Kref>} each stand-in's kref, as the kernel's marshal keeps them */
const krefs = new WeakMap();
/** A stand-in for `kref`, as the kernel hands one to a device. @param {Kref} kref */
const handler = kref => {
  const obj = Far('standIn', {});
  krefs.set(obj, kref);
  return obj;
};

/**
 * A timer device over an in-memory table, a clock the test sets, and a
 * `send` that records each wake.
 */
const setup = () => {
  const sql = makeSql(new DatabaseSync(':memory:'));
  for (const ddl of Object.values(TABLES)) sql.exec(ddl);
  let t = 1000;
  let n = 0;
  /** @type {[string, string, unknown[]][]} */
  const sent = [];
  /** @type {string[]} */
  const logged = [];
  let rearmed = 0;
  const timers = makeTimers(
    harden({
      db: /** @type {ORM<Tables>} */ (makeORM(sql, Object.keys(TABLES))),
      next: () => (n += 1),
      kernelObject: () => `ko${(n += 1)}`,
      standIn: handler,
      krefOf: obj =>
        typeof obj === 'object' && obj ? krefs.get(obj) : undefined,
      keyOf: () => undefined,
    }),
    {
      now: () => t,
      send: async (kref, method, args) => {
        sent.push([kref, method, args]);
        if (kref === 'ko9') throw Error('vat gone');
      },
      rearm: () => {
        rearmed += 1;
      },
      log: message => logged.push(message),
    },
  );
  const kind = timers.kinds.timer;
  return {
    timers,
    sent,
    logged,
    rearms: () => rearmed,
    at: (/** @type {number} */ ms) => {
      t = ms;
    },
    /** @param {string} timer @param {string} method @param {unknown[]} args */
    call: (timer, method, ...args) => kind.deliver(timer, method, args),
  };
};

test('now() answers the clock; wakeAt keeps a wakeup and asks the kernel to rearm', () => {
  const s = setup();
  assert.equal(s.call('1', 'now'), 1000);
  assert.equal(s.timers.alarm?.next(), undefined);
  s.call('1', 'wakeAt', 5000, handler('ko1'));
  s.call('1', 'wakeAt', 3000, handler('ko2'));
  assert.equal(s.timers.alarm?.next(), 3000);
  assert.equal(s.rearms(), 2);
});

test('fire wakes what is due, in order, once, and leaves the rest', async () => {
  const s = setup();
  s.call('1', 'wakeAt', 5000, handler('ko1'));
  s.call('1', 'wakeAt', 3000, handler('ko2'));
  s.call('1', 'wakeAt', 9000, handler('ko3'));
  s.at(6000);
  await s.timers.alarm?.fire();
  assert.deepEqual(s.sent, [
    ['ko2', 'wake', [6000]],
    ['ko1', 'wake', [6000]],
  ]);
  assert.equal(s.timers.alarm?.next(), 9000);
  await s.timers.alarm?.fire();
  assert.equal(s.sent.length, 2, 'at most once');
});

test('a wake that fails is reported, not retried, and does not stop the others', async () => {
  const s = setup();
  s.call('1', 'wakeAt', 2000, handler('ko9'));
  s.call('1', 'wakeAt', 2000, handler('ko1'));
  s.at(2000);
  await s.timers.alarm?.fire();
  assert.equal(s.sent.length, 2);
  assert.match(s.logged.join('\n'), /wake ko9 failed: Error: vat gone/);
  assert.equal(s.timers.alarm?.next(), undefined);
});

test("cancel drops a handler's wakeups from this timer alone", () => {
  const s = setup();
  s.call('1', 'wakeAt', 5000, handler('ko1'));
  s.call('2', 'wakeAt', 7000, handler('ko1'));
  s.call('1', 'cancel', handler('ko1'));
  assert.equal(s.timers.alarm?.next(), 7000);
});

test('wakeAt refuses a time that is not whole milliseconds, and an object the kernel did not hand out', () => {
  const s = setup();
  assert.throws(
    () => s.call('1', 'wakeAt', 1.5, handler('ko1')),
    /whole milliseconds/,
  );
  assert.throws(
    () => s.call('1', 'wakeAt', 1000, Far('stranger', {})),
    /reference the kernel handed out/,
  );
});
