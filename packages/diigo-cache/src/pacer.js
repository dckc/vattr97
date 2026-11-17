/**
 * diigo-cache's pacer vat: it holds the timer, and steps the cache along,
 * as capsite's cache did on its Durable Object's alarms. After a new
 * session: a fill step (20 pages) each second until every page is
 * stored; then a refresh every 3 hours. A step that fails (a session
 * diigo no longer takes, say) stops the stepping until the next session,
 * or the next try, 3 hours on; the cache's status says why.
 *
 * Who holds what: the boot vat holds this vat's root, to `start()` it on
 * each start; the session keeper holds `onSession()`, to say a new
 * session came. This vat holds the cache's root and a timer, and nothing
 * that reads diigo or the session. Its durable names start `pace.`, so
 * it can share a zone with the cache's, as the tests have it.
 */
/**
 * @import { BuildRootObject, MapStore, Remote, Timer } from '../../toybox/src/types.js';
 * @import { DiigoCache } from './cache/cache.js';
 */

/** The pause between fill steps, as capsite's. */
export const STEP_MS = 1000;
/** How often a filled cache refreshes, and how long a failure waits. */
export const REFRESH_MS = 3 * 60 * 60 * 1000;
/** How overdue a wakeup is when it's taken for lost: one due while the kernel was down comes as it starts. */
const LOST_MS = 60 * 1000;

/**
 * @typedef {object} Params
 * @property {Remote<Timer>} timer
 * @property {Remote<DiigoCache>} cache
 */

/**
 * The pacer's state: when it's set to wake, if it is, and why the last
 * step failed, if it did.
 *
 * @typedef {{ due: number | undefined, failed: string | undefined }} PaceState
 */

/** @typedef {ReturnType<typeof buildRootObject>} DiigoPacer this vat's root */

/** @satisfies {BuildRootObject<Params>} */
export const buildRootObject = ({ E, Far, M, zone }, { timer, cache }) => {
  /** @type {MapStore<'pace', PaceState>} */
  const kept = zone.mapStore('pace.state');
  if (!kept.has('pace'))
    kept.init('pace', harden({ due: undefined, failed: undefined }));
  /** @param {Partial<PaceState>} more */
  const update = more => {
    const now = harden({ ...kept.get('pace'), ...more });
    kept.set('pace', now);
    return now;
  };

  /** @param {number} ms */
  const iso = ms => new Date(ms).toISOString();

  /** Tell the cache what's next, for its status. @param {PaceState} pace */
  const report = pace =>
    E(cache).pace(
      harden({
        ...(pace.due === undefined ? {} : { next: iso(pace.due) }),
        ...(pace.failed === undefined ? {} : { failed: pace.failed }),
      }),
    );

  const makeWaker = zone.exoClass(
    'DiigoPaceWaker',
    M.interface('DiigoPaceWaker', {
      wake: M.callWhen(M.number()).returns(M.undefined()),
    }),
    () => ({}),
    {
      /** A step: fill if the walk isn't done, else refresh; then set the next. @param {number} now */
      async wake(now) {
        update({ due: undefined });
        let after = REFRESH_MS;
        /** @type {string | undefined} */
        let failed;
        try {
          const { walk } = await E(cache).status();
          if (walk.done) await E(cache).refresh(iso(now));
          else if (!(await E(cache).fill(iso(now))).done) after = STEP_MS;
        } catch (err) {
          failed = `${iso(now)}: ${err instanceof Error ? err.message : err}`;
        }
        await wakeIn(now, after, failed);
      },
    },
  );
  const waker = zone.makeOnce('pace.waker', () => makeWaker());

  /**
   * Set the one wakeup, `ms` after `now`, in place of any other.
   *
   * @param {number} now
   * @param {number} ms
   * @param {string | undefined} failed
   */
  const wakeIn = async (now, ms, failed) => {
    await E(timer).cancel(waker);
    await E(timer).wakeAt(now + ms, waker);
    await report(update({ due: now + ms, failed }));
  };

  const makeOnSession = zone.exoClass(
    'DiigoPaceOnSession',
    M.interface('DiigoPaceOnSession', {
      sessionSet: M.callWhen(M.string()).returns(M.string()),
    }),
    () => ({}),
    {
      /**
       * After a new session: the cache's own refresh and fill step, whose
       * summary the extension shows, then stepping on from here.
       *
       * @param {string} at
       */
      async sessionSet(at) {
        const summary = await E(E(cache).onSession()).sessionSet(at);
        await wakeIn(await E(timer).now(), STEP_MS, undefined);
        return summary;
      },
    },
  );
  const onSession = zone.makeOnce('pace.onSession', () => makeOnSession());

  return Far('diigoPacer', {
    /**
     * On each start: a wakeup that should have come and didn't (a wake
     * that failed is not tried again) is set again. Before the first
     * session there's none: nothing to step yet.
     */
    async start() {
      const now = await E(timer).now();
      const { due, failed } = kept.get('pace');
      if (due !== undefined && due < now - LOST_MS)
        await wakeIn(now, STEP_MS, failed);
    },
    /** The session keeper's hook: `sessionSet(at)` alone. */
    onSession: () => onSession,
  });
};
