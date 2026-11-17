/**
 * @file Timers: the time, and wakeups, for vats, which have no clock. A
 * vat given a timer asks `now()`, or `wakeAt(at, handler)` to have
 * `handler.wake(at)` called once `at` has passed; `cancel(handler)` drops
 * its pending wakeups. The kernel keeps the wakeups in its SQLite, and
 * wakes on its Durable Object's alarm, so they outlive restarts and
 * evictions; a wakeup whose time passed while the kernel was down comes
 * when it next starts.
 *
 * Each wakeup is delivered at most once: it's forgotten before its
 * `wake` is sent, so a vat that fails to wake isn't asked again.
 */
import { Fail, q } from '@endo/errors';
import { M } from '@endo/patterns';
import { kzone } from '../kernel/objects.js';

/** @import { Device, Kref, TablePowers } from '../kernel/types.js' */

export const TABLES = {
  // a pending wakeup: which timer object set it, when, and whom to wake
  ktimer:
    'CREATE TABLE IF NOT EXISTS ktimer (id INTEGER PRIMARY KEY, timer TEXT NOT NULL, at INTEGER NOT NULL, handler TEXT NOT NULL)',
  // what's due, and what's next, without reading every wakeup
  ktimerAt: 'CREATE INDEX IF NOT EXISTS ktimer_at ON ktimer (at)',
};

/** @typedef {{ ktimer: { id: number, timer: string, at: number, handler: Kref } }} Tables */

/**
 * The kernel's timers.
 *
 * @param {TablePowers<Tables>} powers
 * @param {object} io
 * @param {() => number} io.now the time, in milliseconds since the epoch
 * @param {(kref: Kref, method: string, args: unknown[]) => Promise<unknown>} io.send deliver to a vat's object
 * @param {() => void} io.rearm the kernel sets its alarm to the earliest wakeup any device wants
 * @param {(message: string) => void} io.log where a failed wakeup is reported
 * @returns {Device}
 */
export const makeTimers = (
  { db, next, kernelObject, krefOf },
  { now, send, rearm, log },
) =>
  harden({
    kinds: {
      timer: kzone.exoClass(
        'Timer',
        M.interface('Timer', {
          now: M.call().returns(M.number()),
          wakeAt: M.call(M.number(), M.remotable()).returns(M.undefined()),
          cancel: M.call(M.remotable()).returns(M.undefined()),
        }),
        {
          /** The time, in milliseconds since the epoch. */
          now: () => now(),
          /**
           * Call `handler.wake(now)` once `at` (milliseconds since the
           * epoch) has passed.
           *
           * @param {number} at
           * @param {object} handler
           */
          wakeAt(at, handler) {
            Number.isSafeInteger(at) ||
              Fail`wakeAt: ${q(at)} is not whole milliseconds`;
            const kref = krefOf(handler);
            if (!kref)
              throw Error('wakeAt takes a reference the kernel handed out');
            db.insert('ktimer', {
              id: next('wakeup'),
              timer: this.state.rest,
              at,
              handler: kref,
            });
            rearm();
          },
          /**
           * Drop the wakeups this timer set for `handler`.
           *
           * @param {object} handler
           */
          cancel(handler) {
            const kref = krefOf(handler);
            if (!kref) return;
            for (const { id } of db.query('ktimer', {
              timer: this.state.rest,
              handler: kref,
            }))
              db.lookup('ktimer', { id }).delete();
            rearm();
          },
        },
      ),
    },
    /** A timer: whoever holds it can read the time and set wakeups. */
    make: () => kernelObject(`timer:${next('timer')}`),
    alarm: {
      /** When the earliest wakeup is due, if any is pending. */
      next: () => db.least('ktimer', 'at')?.at,
      /** Wake each handler whose time has passed, forgetting its wakeup first. */
      async fire() {
        const t = now();
        const due = db.atMost('ktimer', 'at', t);
        for (const { id } of due) db.lookup('ktimer', { id }).delete();
        await Promise.all(
          due.map(({ handler }) =>
            send(handler, 'wake', [t]).catch(err =>
              log(`timer: wake ${handler} failed: ${err}`),
            ),
          ),
        );
      },
    },
  });
